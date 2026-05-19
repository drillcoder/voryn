import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { WorkerCursorPosition } from "../interfaces/pipeline.js";
import type { EventReactionHandler } from "../interfaces/reaction.js";
import type { ChainCursorRepository, EventsRepository, WorkerCursorsRepository } from "../interfaces/repositories.js";
import type { ReactionWorkerConfig } from "../interfaces/runtime.js";

export class EventReactionService {
    constructor(
        private readonly config: ReactionWorkerConfig,
        private readonly handler: EventReactionHandler,
        private readonly chainCursorRepository: ChainCursorRepository,
        private readonly eventsRepository: EventsRepository,
        private readonly workerCursorsRepository: WorkerCursorsRepository,
        private readonly logger: Logger = noopLogger,
    ) {
    }

    public async execute(): Promise<void> {
        const { workerName, chainId, batchSize } = this.config;

        const chainCursor = await this.chainCursorRepository.get(chainId);
        if (chainCursor === null) {
            throw new Error(`Chain cursor is missing for event reaction chain ${String(chainId)}`);
        }

        const cursor = await this.getOrCreateCursor(workerName, chainId, chainCursor.lastCommittedBlock);
        if (cursor.lastLogIndex == null) {
            throw new Error(
                `Event worker cursor has no log index for worker "${workerName}", chain ${String(chainId)}`
            );
        }

        const events = await this.eventsRepository.listAfterPosition(
            chainId,
            chainCursor.lastCommittedBlock,
            cursor.lastBlockNumber,
            cursor.lastTransactionIndex,
            cursor.lastLogIndex,
            batchSize
        );
        let lastProcessedPosition: WorkerCursorPosition | null = null;

        for (const event of events) {
            await this.handler.handle(event, { workerName });
            const position = {
                lastBlockNumber: event.blockNumber,
                lastTransactionIndex: event.transactionIndex,
                lastLogIndex: event.index,
            };
            await this.workerCursorsRepository.advance(workerName, chainId, "event", position);
            lastProcessedPosition = position;
        }

        if (events.length > 0) {
            this.logger.info("event_reaction_tick_processed", {
                chainId,
                workerName,
                processed: events.length,
                lastProcessedPosition,
            });
        } else {
            this.logger.debug("event_reaction_tick_no_events", { chainId, workerName });
        }
    }

    private async getOrCreateCursor(
        workerName: string,
        chainId: number,
        initialBlockNumber: number
    ): Promise<WorkerCursorPosition> {
        const current = await this.workerCursorsRepository.get(workerName, chainId, "event");
        if (current !== null) {
            return current.position;
        }

        const initialPosition = {
            lastBlockNumber: initialBlockNumber,
            lastTransactionIndex: -1,
            lastLogIndex: -1,
        };
        await this.workerCursorsRepository.insert(workerName, chainId, "event", initialPosition);

        this.logger.info("worker_cursor_initialized", { workerName, chainId, initialPosition });

        return initialPosition;
    }
}
