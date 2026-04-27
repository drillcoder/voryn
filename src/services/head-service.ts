import type { BlockSource } from "../interfaces/block-source.js";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { BlockJobsRepository, ChainCursorRepository, RawBlocksRepository } from "../interfaces/repositories.js";
import type { HeadWorkerConfig } from "../interfaces/runtime.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";

export class HeadService {
    constructor(
        private readonly config: HeadWorkerConfig,
        private readonly source: BlockSource,
        private readonly chainCursorRepository: ChainCursorRepository,
        private readonly blockJobsRepository: BlockJobsRepository,
        private readonly rawBlocksRepository: RawBlocksRepository,
        private readonly transactionManager: TransactionManager,
        private readonly logger: Logger = noopLogger,
    ) {
    }

    async execute(): Promise<void> {
        const { chainId, confirmations, depthBlocks } = this.config;
        const latestBlock = await this.source.getLatestBlockNumber(chainId);
        const safeHead = latestBlock - confirmations;

        if (safeHead < 0) {
            this.logger.debug("head_waiting_for_safe_head", {
                chainId,
                latestBlock,
                confirmations,
                safeHead,
            });
            return;
        }

        const floor = safeHead - depthBlocks + 1;
        const floorBlock = floor > 0 ? floor : 0;
        const cursorBeforeTx = await this.chainCursorRepository.get(chainId);

        if (cursorBeforeTx === null) {
            const latestBlockData = await this.source.getBlockData(chainId, latestBlock);
            await this.chainCursorRepository.insert({
                chainId,
                lastEnqueuedBlock: latestBlock,
                lastCommittedBlock: latestBlock,
                lastCommittedHash: latestBlockData.block.hash,
            });

            this.logger.info("chain_cursor_initialized", {
                chainId,
                latestBlock,
                latestBlockHash: latestBlockData.block.hash,
            });

            return;
        }

        if (cursorBeforeTx.lastCommittedBlock < floorBlock - 1) {
            const floorData = await this.source.getBlockData(chainId, floorBlock);
            const floorParentHash = floorData.block.parentHash;
            await this.transactionManager.run(async (transaction) => {
                const chainCursor = await this.chainCursorRepository.getForUpdate(chainId, transaction);

                if (chainCursor === null) {
                    throw new Error(`Chain cursor not found for chain ${String(chainId)}`);
                }

                if (chainCursor.lastCommittedBlock >= floorBlock - 1) {
                    return;
                }

                const rebaseTo = floorBlock - 1;
                await this.chainCursorRepository.setPositions(
                    chainId,
                    rebaseTo,
                    floorParentHash,
                    rebaseTo,
                    transaction,
                );
                await this.blockJobsRepository.deleteUpToBlock(chainId, rebaseTo, transaction);
                await this.rawBlocksRepository.deleteUpToBlock(chainId, rebaseTo, transaction);

                this.logger.info("chain_cursor_rebased", {
                    chainId,
                    safeHead,
                    depthBlocks,
                    floorBlock,
                    rebasedToBlock: rebaseTo,
                });
            });
            return;
        }

        await this.transactionManager.run(async (transaction) => {
            const chainCursor = await this.chainCursorRepository.get(chainId, transaction);

            if (chainCursor === null) {
                throw new Error(`Chain cursor not found for chain ${String(chainId)}`);
            }

            const fromBlock = Math.max(chainCursor.lastEnqueuedBlock + 1, floorBlock);

            if (fromBlock > safeHead) {
                return;
            }

            await this.blockJobsRepository.enqueueRange(chainId, fromBlock, safeHead, transaction);
            await this.chainCursorRepository.setLastEnqueued(chainId, safeHead, transaction);

            this.logger.info("enqueued_block_jobs", {
                chainId,
                fromBlock,
                toBlock: safeHead,
            });
        });
    }
}
