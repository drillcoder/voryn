import type { LeaderLock } from "../contracts/leader-lock.js";
import type { Logger } from "../contracts/logger.js";
import { asErrorMessage } from "../utils/errors.js";
import { PollingWorker } from "./polling-worker.js";

export abstract class SingletonPollingWorker extends PollingWorker {
    private lockAcquired = false;

    protected constructor(
        name: string,
        pollIntervalMs: number,
        logger: Logger,
        private readonly leaderLock: LeaderLock
    ) {
        super(name, pollIntervalMs, logger);
    }

    override async start(): Promise<void> {
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

    override async stop(): Promise<void> {
        try {
            await super.stop();
        } finally {
            await this.releaseLock();
        }
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
