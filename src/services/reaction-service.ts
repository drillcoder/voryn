import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { ChainCursor, WorkerCursor, WorkerCursorPosition } from "../interfaces/pipeline.js";
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
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import type { ChainId } from "../types/chain.js";
import type { StreamType } from "../types/pipeline.js";

export interface ReactionServiceConfig {
    chainId: ChainId;
    delayBetweenTicksMs: number;
    workerName: string;
    batchSize: number;
    skipFlushInterval: number;
    confirmations: number;
}

interface ReactionServiceBaseOptions<TStreamType extends StreamType> {
    config: ReactionServiceConfig;
    streamType: TStreamType;
    chainCursorRepository: ChainCursorRepository;
    workerCursorsRepository: WorkerCursorsRepository;
    transactionManager: TransactionManager;
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
        if (!Number.isInteger(options.config.confirmations) || options.config.confirmations < 0) {
            throw new Error("Reaction confirmations must be a non-negative integer");
        }
        this.logger = options.logger ?? noopLogger;
    }

    public async execute(): Promise<void> {
        const options = this.options;
        const { config, chainCursorRepository } = options;
        const { workerName, chainId, batchSize, confirmations } = config;
        const { chainCursor, workerCursor: cursor } = await this.getOrCreateState(chainCursorRepository);

        if (cursor.reorgVersion !== chainCursor.reorgVersion) {
            this.logger.debug(`${options.streamType}_reaction_tick_stale_state`, {
                chainId,
                workerName,
                chainReorgVersion: chainCursor.reorgVersion,
                workerReorgVersion: cursor.reorgVersion,
            });
            return;
        }

        const maxBlockNumber = Math.min(
            chainCursor.lastCommittedBlock,
            chainCursor.lastEnqueuedBlock - confirmations
        );
        if (maxBlockNumber < 0 || maxBlockNumber < cursor.position.lastBlockNumber) {
            this.logger.debug(`${options.streamType}_reaction_tick_waiting_for_confirmations`, {
                chainId,
                workerName,
                confirmations,
                maxBlockNumber,
                cursorBlock: cursor.position.lastBlockNumber,
            });
            return;
        }

        if (options.streamType === "event") {
            const events = await options.eventsRepository.listAfterPosition(
                chainId,
                maxBlockNumber,
                cursor.position.lastBlockNumber,
                cursor.position.lastTransactionIndex,
                cursor.position.lastLogIndex,
                batchSize
            );
            await this.processItems(
                events,
                (event) => ({
                    lastBlockNumber: event.blockNumber,
                    lastTransactionIndex: event.transactionIndex,
                    lastLogIndex: event.index,
                }),
                options.handler,
                cursor.reorgVersion
            );

            return;
        }

        const transactions = await options.transactionsRepository.listAfterPosition(
            chainId,
            maxBlockNumber,
            cursor.position.lastBlockNumber,
            cursor.position.lastTransactionIndex,
            batchSize
        );
        await this.processItems(
            transactions,
            (transaction) => ({
                lastBlockNumber: transaction.blockNumber,
                lastTransactionIndex: transaction.index,
                lastLogIndex: -1,
            }),
            options.handler,
            cursor.reorgVersion
        );
    }

    private async processItems<TItem>(
        items: TItem[],
        getPosition: (item: TItem) => WorkerCursorPosition,
        handle: (item: TItem, context: ReactionContext) => Promise<ReactionHandlerResult>,
        reorgVersion: number,
    ): Promise<void> {
        const { config, streamType, workerCursorsRepository } = this.options;
        const { workerName, chainId } = config;
        let pendingSkippedPosition: WorkerCursorPosition | null = null;
        let skippedSinceFlush = 0;
        let processedCount = 0;
        let skippedCount = 0;
        let lastAdvancedPosition: WorkerCursorPosition | null = null;

        const advance = async (position: WorkerCursorPosition): Promise<boolean> => {
            const advanced = await workerCursorsRepository.advanceIfVersion(
                workerName,
                chainId,
                streamType,
                position,
                reorgVersion
            );
            if (!advanced) {
                this.logger.debug(`${streamType}_reaction_batch_invalidated_by_reorg`, {
                    chainId,
                    workerName,
                    reorgVersion,
                });
            }

            return advanced;
        };

        const flushSkipped = async (): Promise<boolean> => {
            if (pendingSkippedPosition === null) {
                return true;
            }

            if (!await advance(pendingSkippedPosition)) {
                return false;
            }
            lastAdvancedPosition = pendingSkippedPosition;
            pendingSkippedPosition = null;
            skippedSinceFlush = 0;
            return true;
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
                        if (!await flushSkipped()) {
                            return;
                        }
                    }
                } else {
                    if (!await advance(position)) {
                        return;
                    }
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

        if (!await flushSkipped()) {
            return;
        }

        if (items.length > 0) {
            const message = `${this.options.streamType}_reaction_tick_scanned`;
            const meta = {
                chainId,
                workerName,
                processed: processedCount,
                skipped: skippedCount,
                lastAdvancedPosition,
            };

            if (processedCount > 0) {
                this.logger.info(message, meta);
            } else {
                this.logger.debug(message, meta);
            }
        } else {
            this.logger.debug(`${this.options.streamType}_reaction_tick_no_items`, { chainId, workerName });
        }
    }

    private async getOrCreateState(
        chainCursorRepository: ChainCursorRepository
    ): Promise<{ chainCursor: ChainCursor; workerCursor: WorkerCursor }> {
        const { config, streamType, workerCursorsRepository, transactionManager } = this.options;
        const { workerName, chainId } = config;
        const chainCursor = await chainCursorRepository.get(chainId);
        if (chainCursor === null) {
            throw new Error(
                `Chain cursor is missing for ${streamType} reaction chain ${String(chainId)}`
            );
        }
        const current = await workerCursorsRepository.get(workerName, chainId, streamType);
        if (current !== null) {
            return { chainCursor, workerCursor: current };
        }

        return transactionManager.run(async (transaction) => {
            const lockedChainCursor = await chainCursorRepository.getForUpdate(chainId, transaction);
            if (lockedChainCursor === null) {
                throw new Error(
                    `Chain cursor is missing for ${streamType} reaction chain ${String(chainId)}`
                );
            }
            const existing = await workerCursorsRepository.get(workerName, chainId, streamType, transaction);
            if (existing !== null) {
                return { chainCursor: lockedChainCursor, workerCursor: existing };
            }

            const initialPosition: WorkerCursorPosition = {
                lastBlockNumber: lockedChainCursor.lastCommittedBlock,
                lastTransactionIndex: -1,
                lastLogIndex: -1,
            };
            await workerCursorsRepository.insert(
                workerName,
                chainId,
                streamType,
                initialPosition,
                lockedChainCursor.reorgVersion,
                transaction
            );

            const workerCursor: WorkerCursor = {
                workerName,
                chainId,
                streamType,
                position: initialPosition,
                reorgVersion: lockedChainCursor.reorgVersion,
                updatedAt: new Date(),
            };
            this.logger.info("worker_cursor_initialized", {
                workerName,
                chainId,
                initialPosition,
                reorgVersion: lockedChainCursor.reorgVersion,
            });

            return { chainCursor: lockedChainCursor, workerCursor };
        });
    }
}
