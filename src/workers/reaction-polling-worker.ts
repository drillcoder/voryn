import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { Logger } from "../interfaces/logger.js";
import type { ReactionService } from "../services/reaction-service.js";
import { SingletonPollingWorker } from "./singleton-polling-worker.js";

export abstract class ReactionPollingWorker extends SingletonPollingWorker {
    private destroyRequested = false;
    private destroyPromise: Promise<void> | null = null;

    protected constructor(
        name: string,
        delayBetweenTicksMs: number,
        logger: Logger,
        leaderLock: LeaderLock,
        protected readonly service: ReactionService,
        dispose?: () => Promise<void>,
    ) {
        super(name, delayBetweenTicksMs, logger, leaderLock, dispose);
    }

    protected async tick(): Promise<void> {
        await this.service.execute();
    }

    async destroy(): Promise<void> {
        if (this.destroyPromise !== null) {
            await this.destroyPromise;
            return;
        }
        if (!this.lifecycleActive) {
            throw new Error(`Worker "${this.workerName}" must be running to be destroyed`);
        }

        this.destroyRequested = true;
        this.destroyPromise = super.stop();
        await this.destroyPromise;
    }

    protected override async beforeCleanup(): Promise<void> {
        try {
            if (this.destroyRequested) {
                if (!this.hasLeaderLock) {
                    throw new Error(`Worker "${this.workerName}" lost its leader lock before cursor deletion`);
                }
                await this.service.deleteCursor();
            }
        } finally {
            await super.beforeCleanup();
        }
    }
}
