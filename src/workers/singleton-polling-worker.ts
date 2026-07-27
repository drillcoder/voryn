import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { Logger } from "../interfaces/logger.js";
import { asErrorMessage } from "../utils/errors.js";
import { PollingWorker } from "./polling-worker.js";

export abstract class SingletonPollingWorker extends PollingWorker {
    private lockAcquired = false;

    protected constructor(
        name: string,
        delayBetweenTicksMs: number,
        logger: Logger,
        private readonly leaderLock: LeaderLock,
        cleanup?: () => Promise<void>,
    ) {
        super(name, delayBetweenTicksMs, logger, cleanup);
    }

    override async start(): Promise<void> {
        if (this.lifecycleFinalized) {
            throw new Error(`Worker "${this.workerName}" cannot be started because its lifecycle is finalized`);
        }

        if (!this.lockAcquired) {
            const acquired = await this.leaderLock.tryAcquire();
            if (!acquired) {
                this.logger.warn("worker_start_rejected_lock_held", {
                    worker: this.workerName,
                });
                throw new Error(
                    `Worker "${this.workerName}" did not start: lock is already held`
                );
            }

            this.lockAcquired = true;
        }

        try {
            await super.start();
        } catch (error) {
            await this.releaseLock();
            throw error;
        }
    }

    protected override async beforeCleanup(): Promise<void> {
        await this.releaseLock();
    }

    private async releaseLock(): Promise<void> {
        if (!this.lockAcquired) {
            return;
        }

        try {
            await this.leaderLock.release();
        } catch (error) {
            this.logger.error("worker_lock_release_failed", {
                worker: this.workerName,
                error: asErrorMessage(error),
            });
        } finally {
            this.lockAcquired = false;
        }
    }
}
