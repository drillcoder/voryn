import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { WorkerCursorPosition } from "../interfaces/pipeline.js";
import type {
    EventReactionHandler,
    ReactionContext,
    ReactionHandlerResult,
    TransactionReactionHandler,
} from "../interfaces/reaction.js";
import type {
    ChainCursorRepository,
    EventsRepository,
    TransactionsRepository,
    WorkerCursorsRepository,
} from "../interfaces/repositories.js";
import type { ReactionWorkerConfig } from "../interfaces/runtime.js";
import type { StreamType } from "../types/pipeline.js";

interface ReactionServiceBaseOptions<TStreamType extends StreamType> {
    config: ReactionWorkerConfig;
    streamType: TStreamType;
    chainCursorRepository: ChainCursorRepository;
    workerCursorsRepository: WorkerCursorsRepository;
    logger?: Logger;
}

type ReactionServiceOptions = EventReactionServiceOptions | TransactionReactionServiceOptions;

interface EventReactionServiceOptions extends ReactionServiceBaseOptions<"event"> {
    handler: EventReactionHandler;
    eventsRepository: EventsRepository;
}

interface TransactionReactionServiceOptions extends ReactionServiceBaseOptions<"transaction"> {
    handler: TransactionReactionHandler;
    transactionsRepository: TransactionsRepository;
}

export class ReactionService {
    private readonly logger: Logger;

    constructor(private readonly options: ReactionServiceOptions) {
        this.logger = options.logger ?? noopLogger;
    }

    public async execute(): Promise<void> {
        const options = this.options;
        const { config, chainCursorRepository } = options;
        const { workerName, chainId, batchSize } = config;

        const chainCursor = await chainCursorRepository.get(chainId);
        if (chainCursor === null) {
            throw new Error(
                `Chain cursor is missing for ${options.streamType} reaction chain ${String(chainId)}`
            );
        }

        const cursor = await this.getOrCreateCursor(chainCursor.lastCommittedBlock);

        if (options.streamType === "event") {
            if (cursor.lastLogIndex == null) {
                throw new Error(
                    `Event worker cursor has no log index for worker "${workerName}", chain ${String(chainId)}`
                );
            }

            const events = await options.eventsRepository.listAfterPosition(
                chainId,
                chainCursor.lastCommittedBlock,
                cursor.lastBlockNumber,
                cursor.lastTransactionIndex,
                cursor.lastLogIndex,
                batchSize
            );
            await this.processItems(
                events,
                (event) => ({
                    lastBlockNumber: event.blockNumber,
                    lastTransactionIndex: event.transactionIndex,
                    lastLogIndex: event.index,
                }),
                options.handler
            );

            return;
        }

        const transactions = await options.transactionsRepository.listAfterPosition(
            chainId,
            chainCursor.lastCommittedBlock,
            cursor.lastBlockNumber,
            cursor.lastTransactionIndex,
            batchSize
        );
        await this.processItems(
            transactions,
            (transaction) => ({
                lastBlockNumber: transaction.blockNumber,
                lastTransactionIndex: transaction.index,
            }),
            options.handler
        );
    }

    private async processItems<TItem>(
        items: TItem[],
        getPosition: (item: TItem) => WorkerCursorPosition,
        handle: (item: TItem, context: ReactionContext) => Promise<ReactionHandlerResult>
    ): Promise<void> {
        const { config, streamType, workerCursorsRepository } = this.options;
        const { workerName, chainId } = config;
        let pendingSkippedPosition: WorkerCursorPosition | null = null;
        let skippedSinceFlush = 0;
        let processedCount = 0;
        let skippedCount = 0;
        let lastAdvancedPosition: WorkerCursorPosition | null = null;

        const flushSkipped = async (): Promise<void> => {
            if (pendingSkippedPosition === null) {
                return;
            }

            await workerCursorsRepository.advance(workerName, chainId, streamType, pendingSkippedPosition);
            lastAdvancedPosition = pendingSkippedPosition;
            pendingSkippedPosition = null;
            skippedSinceFlush = 0;
        };

        for (const item of items) {
            const position = getPosition(item);

            try {
                const result = await handle(item, { workerName });
                if (result === "skipped") {
                    pendingSkippedPosition = position;
                    skippedSinceFlush += 1;
                    skippedCount += 1;

                    if (skippedSinceFlush >= config.skipFlushInterval) {
                        await flushSkipped();
                    }
                } else {
                    await workerCursorsRepository.advance(workerName, chainId, streamType, position);
                    lastAdvancedPosition = position;
                    pendingSkippedPosition = null;
                    skippedSinceFlush = 0;
                    processedCount += 1;
                }
            } catch (error) {
                await flushSkipped();
                throw error;
            }
        }

        await flushSkipped();

        if (items.length > 0) {
            this.logger.info(`${this.options.streamType}_reaction_tick_processed`, {
                chainId,
                workerName,
                processed: processedCount,
                skipped: skippedCount,
                lastProcessedPosition: lastAdvancedPosition,
            });
        } else {
            this.logger.debug(`${this.options.streamType}_reaction_tick_no_items`, { chainId, workerName });
        }
    }

    private async getOrCreateCursor(initialBlockNumber: number): Promise<WorkerCursorPosition> {
        const { config, streamType, workerCursorsRepository } = this.options;
        const { workerName, chainId } = config;
        const current = await workerCursorsRepository.get(workerName, chainId, streamType);
        if (current !== null) {
            return current.position;
        }

        const initialPosition: WorkerCursorPosition = streamType === "event"
            ? {
                lastBlockNumber: initialBlockNumber,
                lastTransactionIndex: -1,
                lastLogIndex: -1,
            }
            : {
                lastBlockNumber: initialBlockNumber,
                lastTransactionIndex: -1,
            };
        await workerCursorsRepository.insert(workerName, chainId, streamType, initialPosition);

        this.logger.info("worker_cursor_initialized", { workerName, chainId, initialPosition });

        return initialPosition;
    }
}
