import type { BlockSource } from "../interfaces/block-source.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { Logger } from "../interfaces/logger.js";
import type { BlockJobsRepository, ChainCursorRepository } from "../interfaces/repositories.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import type { HeadWorkerConfig } from "../interfaces/runtime.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";
import { noopLogger } from "../interfaces/logger.js";

export class HeadWorker extends SingletonPollingWorker {
    constructor(
        private readonly config: HeadWorkerConfig,
        private readonly source: BlockSource,
        private readonly chainCursorRepository: ChainCursorRepository,
        private readonly blockJobsRepository: BlockJobsRepository,
        private readonly transactionManager: TransactionManager,
        leaderLock: LeaderLock,
        logger?: Logger,
        ) {
        super(
            `head:${String(config.chainId)}`,
            config.pollIntervalMs,
            logger ?? noopLogger,
            leaderLock
        );
    }

    protected async tick(): Promise<void> {
        const { chainId, confirmations } = this.config;
        const latestBlock = await this.source.getLatestBlockNumber(chainId);

        if (await this.chainCursorRepository.get(chainId) === null) {
            const latestBlockData = await this.source.getBlockData(chainId, latestBlock);
            await this.chainCursorRepository.insert({
                chainId,
                lastEnqueuedBlock: latestBlock,
                lastCommittedBlock: latestBlock,
                lastCommittedHash: latestBlockData.block.hash,
            });
            return;
        }

        await this.transactionManager.run(async (transaction) => {
            const safeHead = latestBlock - confirmations;
            const chainCursor = await this.chainCursorRepository.get(chainId, transaction);

            if (chainCursor === null) {
                throw new Error(`Chain cursor not found for chain ${String(chainId)}`);
            }

            const fromBlock = chainCursor.lastEnqueuedBlock + 1;

            if (fromBlock > safeHead) {
                return;
            }

            await this.blockJobsRepository.enqueueRange(chainId, fromBlock, safeHead, transaction);
            await this.chainCursorRepository.setLastEnqueued(chainId, safeHead, transaction);
        });
    }
}
