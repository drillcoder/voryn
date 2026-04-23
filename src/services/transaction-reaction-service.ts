import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { TransactionReactionHandler } from "../interfaces/reaction.js";
import type { CanonicalTransactionsRepository, WorkerCursorsRepository } from "../interfaces/repositories.js";
import type { ReactionWorkerConfig } from "../interfaces/runtime.js";

export class TransactionReactionService {
    constructor(
        private readonly config: ReactionWorkerConfig,
        private readonly handler: TransactionReactionHandler,
        private readonly transactionsRepository: CanonicalTransactionsRepository,
        private readonly workerCursorsRepository: WorkerCursorsRepository,
        private readonly logger: Logger = noopLogger,
    ) {
    }

    public async execute(): Promise<void> {
        const { workerName, chainId, batchSize } = this.config;

        const cursor = await this.getOrCreateCursor(workerName, chainId);
        const transactions = await this.transactionsRepository.readFromSeq(chainId, cursor.lastSeq, batchSize);
        let lastProcessedSeq: bigint | null = null;

        for (const transaction of transactions) {
            await this.handler.handle(transaction, { workerName });
            await this.workerCursorsRepository.advance(workerName, chainId, "tx", transaction.seq);
            lastProcessedSeq = transaction.seq;
        }

        if (transactions.length > 0) {
            this.logger.info("transaction_reaction_tick_processed", {
                chainId,
                workerName,
                processed: transactions.length,
                lastProcessedSeq: lastProcessedSeq?.toString(),
            });
        } else {
            this.logger.debug("transaction_reaction_tick_no_transactions", {
                chainId,
                workerName,
            });
        }
    }

    private async getOrCreateCursor(workerName: string, chainId: number): Promise<{ lastSeq: bigint }> {
        const current = await this.workerCursorsRepository.get(workerName, chainId, "tx");
        if (current !== null) {
            return { lastSeq: current.lastSeq };
        }

        const initialSeq = await this.transactionsRepository.maxSeq(chainId);
        await this.workerCursorsRepository.insert(workerName, chainId, "tx", initialSeq);

        this.logger.info("worker_cursor_initialized", {
            workerName,
            chainId,
            initialSeq: initialSeq.toString(),
        });

        return { lastSeq: initialSeq };
    }
}
