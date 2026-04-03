import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { Logger } from "../interfaces/logger.js";
import type { TransactionReactionHandler } from "../interfaces/reaction.js";
import type { CanonicalTransactionsRepository, WorkerCursorsRepository } from "../interfaces/repositories.js";
import type { ReactionWorkerConfig } from "../interfaces/runtime.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";
import { noopLogger } from "../interfaces/logger.js";

export class TransactionReactionWorker extends SingletonPollingWorker {
    constructor(
        private readonly config: ReactionWorkerConfig,
        private readonly handler: TransactionReactionHandler,
        private readonly transactionsRepository: CanonicalTransactionsRepository,
        private readonly workerCursorsRepository: WorkerCursorsRepository,
        leaderLock: LeaderLock,
        logger?: Logger,
    ) {
        super(
            `reaction-tx:${String(config.chainId)}:${config.workerName}`,
            config.pollIntervalMs,
            logger ?? noopLogger,
            leaderLock
        );
    }

    protected async tick(): Promise<void> {
        const { workerName, chainId, batchSize } = this.config;

        const cursor = await this.getOrCreateCursor(workerName, chainId);
        const transactions = await this.transactionsRepository.readFromSeq(chainId, cursor.lastSeq, batchSize);

        for (const transaction of transactions) {
            await this.handler.handle(transaction, { workerName });
            await this.workerCursorsRepository.advance(workerName, chainId, "tx", transaction.seq);
        }
    }

    private async getOrCreateCursor(workerName: string, chainId: number): Promise<{ lastSeq: bigint }> {
        const current = await this.workerCursorsRepository.get(workerName, chainId, "tx");
        if (current !== null) {
            return { lastSeq: current.lastSeq };
        }

        const initialSeq = await this.transactionsRepository.maxSeq(chainId);
        await this.workerCursorsRepository.insert(workerName, chainId, "tx", initialSeq);
        return { lastSeq: initialSeq };
    }
}
