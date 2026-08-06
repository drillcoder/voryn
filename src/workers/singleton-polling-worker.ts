import type { LeaderLock } from "../interfaces/leader-lock.js";
import type { Logger } from "../interfaces/logger.js";
import type { WorkerLifecycleWithFailure } from "../interfaces/worker-lifecycle.js";
import { asErrorMessage } from "../utils/errors.js";
import { PollingWorker } from "./polling-worker.js";

export abstract class SingletonPollingWorker extends PollingWorker implements WorkerLifecycleWithFailure {
    private lockAcquired = false;
    private releasingLock = false;
    private failureListener: ((error: Error) => void) | undefined;

    protected constructor(
        name: string,
        delayBetweenTicksMs: number,
        logger: Logger,
        private readonly leaderLock: LeaderLock,
        cleanup?: () => Promise<void>,
    ) {
        super(name, delayBetweenTicksMs, logger, cleanup);
        leaderLock.onLost((error) => {
            this.handleLockLost(error);
        });
    }

    onFailure(listener: (error: Error) => void): void {
        this.failureListener = listener;
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

    private handleLockLost(error: Error): void {
        if (!this.lockAcquired || this.releasingLock) {
            return;
        }

        this.failureListener?.(new Error(`Worker "${this.workerName}" lost its leader lock: ${error.message}`));
        void this.stop().catch(() => undefined);
        this.logger.error("worker_lock_lost", {
            worker: this.workerName,
            error: asErrorMessage(error),
        });
    }

    private async releaseLock(): Promise<void> {
        if (!this.lockAcquired) {
            return;
        }

        this.releasingLock = true;
        try {
            await this.leaderLock.release();
        } catch (error) {
            this.logger.error("worker_lock_release_failed", {
                worker: this.workerName,
                error: asErrorMessage(error),
            });
        } finally {
            this.lockAcquired = false;
            this.releasingLock = false;
        }
    }
}
