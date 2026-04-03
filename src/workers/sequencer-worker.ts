import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { Logger } from "../interfaces/logger.js";
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
import { SingletonPollingWorker } from "./singleton-polling-worker.js";
import { noopLogger } from "../interfaces/logger.js";

export class SequencerWorker extends SingletonPollingWorker {
    constructor(
        private readonly config: SequencerWorkerConfig,
        private readonly chainCursorRepository: ChainCursorRepository,
        private readonly rawBlocksRepository: RawBlocksRepository,
        private readonly canonicalBlocksRepository: CanonicalBlocksRepository,
        private readonly canonicalTransactionsRepository: CanonicalTransactionsRepository,
        private readonly canonicalEventsRepository: CanonicalEventsRepository,
        private readonly blockJobsRepository: BlockJobsRepository,
        private readonly transactionManager: TransactionManager,
        leaderLock: LeaderLock,
        logger?: Logger,
    ) {
        super(
            `sequencer:${String(config.chainId)}`,
            config.pollIntervalMs,
            logger ?? noopLogger,
            leaderLock
        );
    }

    protected async tick(): Promise<void> {
        await this.transactionManager.run(async (transaction) => {
            const chainId = this.config.chainId;

            const cursor = await this.chainCursorRepository.get(chainId, transaction);
            if (cursor === null) {
                return;
            }
            const nextBlock = cursor.lastCommittedBlock + 1;

            const raw = await this.rawBlocksRepository.get(chainId, nextBlock, transaction);
            if (!raw) {
                return;
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
        });
    }
}
