import type { Logger } from "../interfaces/logger.js";
import type { WorkerLifecycle } from "../interfaces/worker-lifecycle.js";
import { asErrorMessage } from "../utils/errors.js";

export abstract class PollingWorker implements WorkerLifecycle {
    private active = false;
    private runPromise: Promise<void> | null = null;
    private finalized = false;

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
            this.finalized = true;
            await this.runCleanup();
            throw error;
        }
    }

    async stop(): Promise<void> {
        if (this.lifecycleFinalized) {
            return;
        }

        try {
            if (!this.active) {
                return;
            }

            this.active = false;
            await this.runPromise;
            this.runPromise = null;
            this.logger.info("worker_stopped", { worker: this.workerName });
        } finally {
            this.finalized = true;
            await this.runCleanup();
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

            await new Promise((resolve) => setTimeout(resolve, this.delayBetweenTicksMs));
        }
    }

    protected buildStartLogMeta(): Record<string, unknown> {
        return {};
    }

    protected get lifecycleFinalized(): boolean {
        return this.finalized;
    }

    private async runCleanup(): Promise<void> {
        if (this.cleanupFn === undefined) {
            return;
        }

        await this.cleanupFn();
    }

    protected abstract tick(): Promise<void>;
}
