import type { BlockSource } from "../interfaces/block-source.js";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { ChainCursor, RawBlock } from "../interfaces/pipeline.js";
import type {
    BlockJobsRepository,
    CanonicalBlocksRepository,
    CanonicalEventsRepository,
    CanonicalTransactionsRepository,
    ChainCursorRepository,
    RawBlocksRepository,
} from "../interfaces/repositories.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import type { SequencerWorkerConfig } from "../interfaces/runtime.js";
import type { BlockNumber, HashHex } from "../types/chain.js";

interface ReorgCandidate {
    cursor: ChainCursor;
    raw: RawBlock;
}

interface CommonAncestor {
    blockNumber: BlockNumber;
    blockHash: HashHex;
}

export class SequencerService {
    constructor(
        private readonly config: SequencerWorkerConfig,
        private readonly source: BlockSource,
        private readonly chainCursorRepository: ChainCursorRepository,
        private readonly rawBlocksRepository: RawBlocksRepository,
        private readonly canonicalBlocksRepository: CanonicalBlocksRepository,
        private readonly canonicalTransactionsRepository: CanonicalTransactionsRepository,
        private readonly canonicalEventsRepository: CanonicalEventsRepository,
        private readonly blockJobsRepository: BlockJobsRepository,
        private readonly transactionManager: TransactionManager,
        private readonly logger: Logger = noopLogger,
    ) {
    }

    async execute(): Promise<void> {
        const chainId = this.config.chainId;
        const maxBlocksPerTick = Math.max(1, this.config.maxBlocksPerTick);
        const committedBlocks: number[] = [];

        for (let index = 0; index < maxBlocksPerTick; index++) {
            const cursor = await this.chainCursorRepository.get(chainId);
            if (cursor === null) {
                break;
            }

            const raw = await this.rawBlocksRepository.get(chainId, cursor.lastCommittedBlock + 1);
            if (raw === null) {
                break;
            }

            if (raw.parentHash !== cursor.lastCommittedHash) {
                await this.rollbackReorg({ cursor, raw });
                break;
            }

            const committedBlock = await this.transactionManager.run(async (transaction): Promise<number> => {
                await this.canonicalBlocksRepository.insert(raw.payload.block, transaction);
                await this.canonicalTransactionsRepository.insertMany(
                    raw.payload.block.chainId,
                    raw.payload.block.number,
                    raw.blockHash,
                    raw.payload.transactions,
                    transaction
                );
                await this.canonicalEventsRepository.insertMany(
                    raw.payload.block.chainId,
                    raw.payload.block.number,
                    raw.blockHash,
                    raw.payload.logs,
                    transaction
                );
                await this.chainCursorRepository.advanceLastCommitted(
                    cursor.chainId,
                    cursor.lastCommittedBlock,
                    cursor.lastCommittedHash,
                    raw.blockNumber,
                    raw.blockHash,
                    transaction
                );
                await this.blockJobsRepository.markCommitted(cursor.chainId, raw.blockNumber, transaction);
                return raw.blockNumber;
            });
            committedBlocks.push(committedBlock);
        }

        if (committedBlocks.length > 0) {
            this.logger.info("sequencer_blocks_committed", {
                chainId,
                committedCount: committedBlocks.length,
                firstBlockNumber: committedBlocks[0],
                lastBlockNumber: committedBlocks[committedBlocks.length - 1],
            });
        } else {
            this.logger.debug("sequencer_no_block_to_commit", { chainId });
        }
    }

    private async rollbackReorg(candidate: ReorgCandidate): Promise<void> {
        const chainId = this.config.chainId;
        const ancestor = await this.findCommonAncestor(candidate.cursor);

        const result = await this.transactionManager.run(async (transaction) => {
            const cursor = await this.chainCursorRepository.getForUpdate(chainId, transaction);
            if (cursor === null) {
                return null;
            }

            if (
                cursor.lastCommittedBlock !== candidate.cursor.lastCommittedBlock
                || cursor.lastCommittedHash !== candidate.cursor.lastCommittedHash
            ) {
                return null;
            }

            const nextBlock = cursor.lastCommittedBlock + 1;
            const raw = await this.rawBlocksRepository.get(chainId, nextBlock, transaction);
            if (raw === null || raw.parentHash === cursor.lastCommittedHash) {
                return null;
            }

            const deletedCanonicalEvents = await this.canonicalEventsRepository.deleteAfterBlock(
                chainId,
                ancestor.blockNumber,
                transaction
            );
            const deletedCanonicalTransactions = await this.canonicalTransactionsRepository.deleteAfterBlock(
                chainId,
                ancestor.blockNumber,
                transaction
            );
            const deletedCanonicalBlocks = await this.canonicalBlocksRepository.deleteAfterBlock(
                chainId,
                ancestor.blockNumber,
                transaction
            );
            const deletedRawBlocks = await this.rawBlocksRepository.deleteAfterBlock(
                chainId,
                ancestor.blockNumber,
                transaction
            );
            const deletedBlockJobs = await this.blockJobsRepository.deleteAfterBlock(
                chainId,
                ancestor.blockNumber,
                transaction
            );

            await this.chainCursorRepository.setPositions(
                chainId,
                ancestor.blockNumber,
                ancestor.blockHash,
                ancestor.blockNumber,
                transaction
            );

            return {
                fromBlock: ancestor.blockNumber + 1,
                ancestorBlock: ancestor.blockNumber,
                ancestorHash: ancestor.blockHash,
                deletedBlockJobs,
                deletedRawBlocks,
                deletedCanonicalBlocks,
                deletedCanonicalTransactions,
                deletedCanonicalEvents,
            };
        });

        if (result !== null) {
            this.logger.warn("sequencer_reorg_rollback", { chainId, ...result });
        }
    }

    private async findCommonAncestor(cursor: ChainCursor): Promise<CommonAncestor> {
        for (let blockNumber = cursor.lastCommittedBlock; blockNumber >= 0; blockNumber--) {
            const [canonicalBlock, sourceBlock] = await Promise.all([
                this.canonicalBlocksRepository.get(cursor.chainId, blockNumber),
                this.source.getBlockData(cursor.chainId, blockNumber),
            ]);

            if (canonicalBlock !== null && canonicalBlock.hash === sourceBlock.block.hash) {
                return {
                    blockNumber,
                    blockHash: canonicalBlock.hash,
                };
            }
        }

        throw new Error(
            `Cannot find common ancestor for chain ${String(cursor.chainId)} `
            + `from block ${String(cursor.lastCommittedBlock)}`
        );
    }

}
