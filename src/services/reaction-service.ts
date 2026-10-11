import type { DbExecutor } from "../interfaces/db.js";
import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { ChainCursor, WorkerCursor, WorkerCursorPosition } from "../interfaces/pipeline.js";
import type {
    EventReactionHandler,
    EventReactionFilter,
    TransactionReactionFilter,
    TransactionReactionHandler,
} from "../interfaces/reaction.js";
import type {
    BlocksRepository,
    ChainCursorRepository,
    EventsRepository,
    TransactionsRepository,
    WorkerCursorsRepository,
} from "../interfaces/repositories.js";
import type { TransactionManager } from "../interfaces/transaction-manager.js";
import type { BlockNumber, ChainId } from "../types/chain.js";
import type { StreamType } from "../types/pipeline.js";

export interface ReactionServiceConfig {
    chainId: ChainId;
    delayBetweenTicksMs: number;
    workerName: string;
    batchSize: number;
    confirmations: number;
    initialBlock?: BlockNumber;
}

interface ReactionServiceBaseOptions<TStreamType extends StreamType> {
    config: ReactionServiceConfig;
    streamType: TStreamType;
    chainCursorRepository: ChainCursorRepository;
    blocksRepository: BlocksRepository;
    workerCursorsRepository: WorkerCursorsRepository;
    transactionManager: TransactionManager;
    logger?: Logger;
}

type ReactionServiceOptions = EventReactionServiceOptions | TransactionReactionServiceOptions;

interface EventReactionServiceOptions extends ReactionServiceBaseOptions<"event"> {
    filter: EventReactionFilter;
    handler: EventReactionHandler;
    eventsRepository: EventsRepository;
}

interface TransactionReactionServiceOptions extends ReactionServiceBaseOptions<"transaction"> {
    filter: TransactionReactionFilter;
    handler: TransactionReactionHandler;
    transactionsRepository: TransactionsRepository;
}

interface ReactionState {
    chainCursor: ChainCursor;
    workerCursor: WorkerCursor;
}

class InvalidatedReactionBatch extends Error {}

export class ReactionService {
    private readonly logger: Logger;

    constructor(private readonly options: ReactionServiceOptions) {
        if (!Number.isSafeInteger(options.config.confirmations) || options.config.confirmations < 0) {
            throw new Error("Reaction confirmations must be a non-negative safe integer");
        }
        this.logger = options.logger ?? noopLogger;
    }

    public async execute(): Promise<void> {
        const options = this.options;
        const { config, chainCursorRepository } = options;
        const { workerName, chainId, batchSize, confirmations } = config;
        const initialState = await this.getOrCreateState(chainCursorRepository);

        if (initialState.workerCursor.reorgVersion !== initialState.chainCursor.reorgVersion) {
            this.logger.debug(`${options.streamType}_reaction_tick_stale_state`, {
                chainId,
                workerName,
                chainReorgVersion: initialState.chainCursor.reorgVersion,
                workerReorgVersion: initialState.workerCursor.reorgVersion,
            });
            return;
        }

        const state = await this.accountForHistoryGap(initialState);
        if (state === null) {
            return;
        }
        const { chainCursor, workerCursor: cursor } = state;

        const maxBlockNumber = Math.min(
            chainCursor.lastCommittedBlock,
            chainCursor.lastEnqueuedBlock - confirmations,
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
                batchSize,
            );
            await this.processItems(
                events,
                (event) => ({
                    lastBlockNumber: event.blockNumber,
                    lastTransactionIndex: event.transactionIndex,
                    lastLogIndex: event.index,
                }),
                options.filter,
                options.handler,
                cursor.reorgVersion,
            );

            return;
        }

        const transactions = await options.transactionsRepository.listAfterPosition(
            chainId,
            maxBlockNumber,
            cursor.position.lastBlockNumber,
            cursor.position.lastTransactionIndex,
            batchSize,
        );
        await this.processItems(
            transactions,
            (transaction) => ({
                lastBlockNumber: transaction.blockNumber,
                lastTransactionIndex: transaction.index,
                lastLogIndex: -1,
            }),
            options.filter,
            options.handler,
            cursor.reorgVersion,
        );
    }

    public async deleteCursor(): Promise<boolean> {
        const { config, streamType, workerCursorsRepository } = this.options;
        return workerCursorsRepository.delete(config.workerName, config.chainId, streamType);
    }

    private async processItems<TItem>(
        items: TItem[],
        getPosition: (item: TItem) => WorkerCursorPosition,
        filter: (item: TItem) => boolean,
        handle: (item: TItem, db: DbExecutor, workerName: string) => Promise<void>,
        reorgVersion: number,
    ): Promise<void> {
        const { config, streamType, workerCursorsRepository } = this.options;
        const { workerName, chainId } = config;
        let pendingSkippedPosition: WorkerCursorPosition | null = null;
        let processedCount = 0;
        let skippedCount = 0;
        let lastAdvancedPosition: WorkerCursorPosition | null = null;

        const advance = async (position: WorkerCursorPosition, db?: DbExecutor): Promise<boolean> => {
            const advanced = await workerCursorsRepository.advanceIfVersion(
                workerName,
                chainId,
                streamType,
                position,
                reorgVersion,
                db,
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
            return true;
        };

        for (const item of items) {
            const position = getPosition(item);

            try {
                const accepted = filter(item);
                if (typeof accepted !== "boolean") {
                    throw new Error("Reaction filter must return a boolean synchronously");
                }
                if (!accepted) {
                    pendingSkippedPosition = position;
                    skippedCount += 1;
                    continue;
                }

                await this.options.transactionManager.run(async (db) => {
                    await handle(item, db, workerName);
                    if (!await advance(position, db)) {
                        throw new InvalidatedReactionBatch();
                    }
                });
                lastAdvancedPosition = position;
                pendingSkippedPosition = null;
                processedCount += 1;
            } catch (error) {
                if (error instanceof InvalidatedReactionBatch) {
                    return;
                }
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

    private async getOrCreateState(chainCursorRepository: ChainCursorRepository): Promise<ReactionState> {
        const { config, streamType, workerCursorsRepository, transactionManager } = this.options;
        const { workerName, chainId } = config;
        const chainCursor = await chainCursorRepository.get(chainId);
        if (chainCursor === null) {
            throw new Error(
                `Chain cursor is missing for ${streamType} reaction chain ${String(chainId)}`,
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
                    `Chain cursor is missing for ${streamType} reaction chain ${String(chainId)}`,
                );
            }
            const existing = await workerCursorsRepository.get(workerName, chainId, streamType, transaction);
            if (existing !== null) {
                return { chainCursor: lockedChainCursor, workerCursor: existing };
            }

            if (config.initialBlock !== undefined
                && (!Number.isSafeInteger(config.initialBlock) || config.initialBlock < 0)) {
                throw new Error("Reaction initialBlock must be a non-negative safe integer");
            }

            const initialPosition: WorkerCursorPosition = {
                lastBlockNumber: config.initialBlock ?? lockedChainCursor.lastCommittedBlock,
                lastTransactionIndex: -1,
                lastLogIndex: -1,
            };
            await workerCursorsRepository.insert(
                workerName,
                chainId,
                streamType,
                initialPosition,
                lockedChainCursor.reorgVersion,
                transaction,
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

    private async accountForHistoryGap(initialState: ReactionState): Promise<ReactionState | null> {
        const {
            config, streamType, blocksRepository, chainCursorRepository, workerCursorsRepository, transactionManager,
        } = this.options;
        const { chainId, workerName } = config;
        const oldestBlock = await blocksRepository.getOldestBlockNumber(chainId);
        if (!this.isHistoryGap(oldestBlock, initialState)) {
            return initialState;
        }

        const result = await transactionManager.run(async (transaction) => {
            const chainCursor = await chainCursorRepository.getForUpdate(chainId, transaction);
            const workerCursor = await workerCursorsRepository.get(workerName, chainId, streamType, transaction);
            if (
                chainCursor === null
                || workerCursor === null
                || chainCursor.reorgVersion !== initialState.chainCursor.reorgVersion
                || workerCursor.reorgVersion !== chainCursor.reorgVersion
            ) {
                return null;
            }
            const state = { chainCursor, workerCursor };
            const firstAvailableBlock = await blocksRepository.getOldestBlockNumber(chainId, transaction);
            if (!this.isHistoryGap(firstAvailableBlock, state)) {
                return { state, previousPosition: null };
            }

            const position: WorkerCursorPosition = {
                lastBlockNumber: firstAvailableBlock,
                lastTransactionIndex: -1,
                lastLogIndex: -1,
            };
            const advanced = await workerCursorsRepository.advanceIfVersion(
                workerName, chainId, streamType, position, chainCursor.reorgVersion, transaction,
            );
            if (!advanced) {
                return null;
            }
            return {
                state: { chainCursor, workerCursor: { ...workerCursor, position, updatedAt: new Date() } },
                previousPosition: workerCursor.position,
            };
        });

        if (result === null) {
            return null;
        }
        if (result.previousPosition !== null) {
            const firstAvailableBlock = result.state.workerCursor.position.lastBlockNumber;
            this.logger.warn("reaction_history_gap", {
                chainId,
                workerName,
                streamType,
                previousPosition: result.previousPosition,
                fromBlock: Math.max(0, result.previousPosition.lastBlockNumber),
                toBlock: firstAvailableBlock - 1,
                firstAvailableBlock,
            });
        }
        return result.state;
    }

    private isHistoryGap(
        firstAvailableBlock: BlockNumber | null,
        state: ReactionState,
    ): firstAvailableBlock is BlockNumber {
        return firstAvailableBlock !== null
            && firstAvailableBlock <= state.chainCursor.lastCommittedBlock
            && state.workerCursor.position.lastBlockNumber < firstAvailableBlock;
    }
}
