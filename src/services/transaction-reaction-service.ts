import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { WorkerCursorPosition } from "../interfaces/pipeline.js";
import type { TransactionReactionHandler } from "../interfaces/reaction.js";
import type {
    ChainCursorRepository,
    TransactionsRepository,
    WorkerCursorsRepository,
} from "../interfaces/repositories.js";
import type { ReactionWorkerConfig } from "../interfaces/runtime.js";

export class TransactionReactionService {
    constructor(
        private readonly config: ReactionWorkerConfig,
        private readonly handler: TransactionReactionHandler,
        private readonly chainCursorRepository: ChainCursorRepository,
        private readonly transactionsRepository: TransactionsRepository,
        private readonly workerCursorsRepository: WorkerCursorsRepository,
        private readonly logger: Logger = noopLogger,
    ) {
    }

    public async execute(): Promise<void> {
        const { workerName, chainId, batchSize } = this.config;

        const chainCursor = await this.chainCursorRepository.get(chainId);
        if (chainCursor === null) {
            throw new Error(`Chain cursor is missing for transaction reaction chain ${String(chainId)}`);
        }

        const cursor = await this.getOrCreateCursor(workerName, chainId, chainCursor.lastCommittedBlock);
        const transactions = await this.transactionsRepository.listAfterPosition(
            chainId,
            chainCursor.lastCommittedBlock,
            cursor.lastBlockNumber,
            cursor.lastTransactionIndex,
            batchSize
        );
        let lastProcessedPosition: WorkerCursorPosition | null = null;

        for (const transaction of transactions) {
            await this.handler.handle(transaction, { workerName });
            const position = {
                lastBlockNumber: transaction.blockNumber,
                lastTransactionIndex: transaction.index,
            };
            await this.workerCursorsRepository.advance(workerName, chainId, "tx", position);
            lastProcessedPosition = position;
        }

        if (transactions.length > 0) {
            this.logger.info("transaction_reaction_tick_processed", {
                chainId,
                workerName,
                processed: transactions.length,
                lastProcessedPosition,
            });
        } else {
            this.logger.debug("transaction_reaction_tick_no_transactions", { chainId, workerName });
        }
    }

    private async getOrCreateCursor(
        workerName: string,
        chainId: number,
        initialBlockNumber: number
    ): Promise<WorkerCursorPosition> {
        const current = await this.workerCursorsRepository.get(workerName, chainId, "tx");
        if (current !== null) {
            return current.position;
        }

        const initialPosition = {
            lastBlockNumber: initialBlockNumber,
            lastTransactionIndex: -1,
        };
        await this.workerCursorsRepository.insert(workerName, chainId, "tx", initialPosition);

        this.logger.info("worker_cursor_initialized", { workerName, chainId, initialPosition });

        return initialPosition;
    }
}
