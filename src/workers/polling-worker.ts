import type { Logger } from "../interfaces/logger.js";
import type { WorkerLifecycle } from "../interfaces/worker-lifecycle.js";
import { asErrorMessage } from "../utils/errors.js";

export abstract class PollingWorker implements WorkerLifecycle {
    private active = false;
    private runPromise: Promise<void> | null = null;
    private finalized = false;
    private stopPromise: Promise<void> | null = null;
    private finalizationPromise: Promise<void> | null = null;
    private pendingDelay: {
        timer: ReturnType<typeof setTimeout>;
        resolve: () => void;
    } | null = null;

    protected constructor(
        protected readonly workerName: string,
        private readonly delayBetweenTicksMs: number,
        protected readonly logger: Logger,
        private readonly cleanupFn?: () => Promise<void>,
    ) {
    }

    async start(): Promise<void> {
        if (this.active) {
            return;
        }

        if (this.lifecycleFinalized) {
            throw new Error(`Worker "${this.workerName}" cannot be started because its lifecycle is finalized`);
        }

        try {
            this.active = true;
            this.logger.info("worker_started", {
                workerName: this.workerName,
                delayBetweenTicksMs: this.delayBetweenTicksMs,
                ...this.buildStartLogMeta(),
            });
            this.runPromise = this.runLoop();
        } catch (error) {
            this.active = false;
            await this.finalizeLifecycle();
            throw error;
        }
    }

    async stop(): Promise<void> {
        this.stopPromise ??= this.stopOnce();
        await this.stopPromise;
    }

    private async stopOnce(): Promise<void> {
        if (this.lifecycleFinalized) {
            await this.finalizeLifecycle();
            return;
        }

        this.finalized = true;

        try {
            if (!this.active) {
                return;
            }

            this.active = false;
            this.cancelPendingDelay();
            await this.runPromise;
            this.runPromise = null;
            this.logger.info("worker_stopped", { worker: this.workerName });
        } finally {
            await this.finalizeLifecycle();
        }
    }

    private async runLoop(): Promise<void> {
        while (this.active) {
            try {
                await this.tick();
            } catch (error) {
                this.logger.error("worker_tick_failed", {
                    worker: this.workerName,
                    error: asErrorMessage(error),
                });
            }

            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- may change during awaited tick()
            if (!this.active) {
                break;
            }

            await this.waitForNextTick();
        }
    }

    protected buildStartLogMeta(): Record<string, unknown> {
        return {};
    }

    protected get lifecycleFinalized(): boolean {
        return this.finalized;
    }

    protected beforeCleanup(): Promise<void> {
        return Promise.resolve();
    }

    private async finalizeLifecycle(): Promise<void> {
        this.finalized = true;
        this.finalizationPromise ??= this.runCleanup();
        await this.finalizationPromise;
    }

    private async runCleanup(): Promise<void> {
        try {
            await this.beforeCleanup();
        } finally {
            if (this.cleanupFn !== undefined) {
                await this.cleanupFn();
            }
        }
    }

    private async waitForNextTick(): Promise<void> {
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                this.pendingDelay = null;
                resolve();
            }, this.delayBetweenTicksMs);

            this.pendingDelay = { timer, resolve };
        });
    }

    private cancelPendingDelay(): void {
        const pendingDelay = this.pendingDelay;
        if (pendingDelay === null) {
            return;
        }

        this.pendingDelay = null;
        clearTimeout(pendingDelay.timer);
        pendingDelay.resolve();
    }

    protected abstract tick(): Promise<void>;
}
