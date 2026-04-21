import type { Logger } from "../interfaces/logger.js";
import { noopLogger } from "../interfaces/logger.js";
import type { EventReactionHandler } from "../interfaces/reaction.js";
import type { CanonicalEventsRepository, WorkerCursorsRepository } from "../interfaces/repositories.js";
import type { ReactionWorkerConfig } from "../interfaces/runtime.js";

export class EventReactionService {
    constructor(
        private readonly config: ReactionWorkerConfig,
        private readonly handler: EventReactionHandler,
        private readonly eventsRepository: CanonicalEventsRepository,
        private readonly workerCursorsRepository: WorkerCursorsRepository,
        private readonly logger: Logger = noopLogger,
    ) {
    }

    public async execute(): Promise<void> {
        const { workerName, chainId, batchSize } = this.config;

        const cursor = await this.getOrCreateCursor(workerName, chainId);
        const events = await this.eventsRepository.readFromSeq(chainId, cursor.lastSeq, batchSize);
        let lastProcessedSeq: bigint | null = null;

        for (const event of events) {
            await this.handler.handle(event, { workerName });
            await this.workerCursorsRepository.advance(workerName, chainId, "event", event.seq);
            lastProcessedSeq = event.seq;
        }

        if (events.length > 0) {
            this.logger.info("event_reaction_tick_processed", {
                chainId,
                workerName,
                processed: events.length,
                lastProcessedSeq,
            });
        } else {
            this.logger.debug("event_reaction_tick_no_events", {
                chainId,
                workerName,
            });
        }
    }

    private async getOrCreateCursor(workerName: string, chainId: number): Promise<{ lastSeq: bigint }> {
        const current = await this.workerCursorsRepository.get(workerName, chainId, "event");
        if (current !== null) {
            return { lastSeq: current.lastSeq };
        }

        const initialSeq = await this.eventsRepository.maxSeq(chainId);
        await this.workerCursorsRepository.insert(workerName, chainId, "event", initialSeq);
        return { lastSeq: initialSeq };
    }
}
