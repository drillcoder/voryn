import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
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

export class SequencerService {
    constructor(
        private readonly config: SequencerWorkerConfig,
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
            const committedBlock = await this.transactionManager.run(async (transaction): Promise<number | null> => {
                const cursor = await this.chainCursorRepository.get(chainId, transaction);
                if (cursor === null) {
                    return null;
                }
                const nextBlock = cursor.lastCommittedBlock + 1;

                const raw = await this.rawBlocksRepository.get(chainId, nextBlock, transaction);
                if (!raw) {
                    return null;
                }

                if (raw.parentHash !== cursor.lastCommittedHash) {
                    throw new Error(
                        "Raw block parent hash mismatch for chain "
                        + `${String(chainId)} block ${String(nextBlock)}: `
                        + `expected parent ${cursor.lastCommittedHash}, got ${raw.parentHash}`
                    );
                }

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
                    nextBlock,
                    raw.blockHash,
                    transaction
                );
                await this.blockJobsRepository.markCommitted(chainId, nextBlock, transaction);
                return nextBlock;
            });

            if (committedBlock === null) {
                break;
            }

            committedBlocks.push(committedBlock);
        }

        if (committedBlocks.length > 0) {
            const lastCommittedBlock = committedBlocks[committedBlocks.length - 1];
            this.logger.info("sequencer_blocks_committed", {
                chainId,
                committedCount: committedBlocks.length,
                firstBlockNumber: committedBlocks[0],
                lastBlockNumber: lastCommittedBlock,
            });
        } else {
            this.logger.debug("sequencer_no_block_to_commit", {
                chainId,
            });
        }
    }
}

