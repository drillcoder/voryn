import type { Logger } from "../contracts/logger.js";
import type { WorkerLifecycle } from "../types/runtime.js";
import { asErrorMessage } from "../utils/errors.js";


export abstract class PollingWorker implements WorkerLifecycle {
    private active = false;
    private runPromise: Promise<void> | null = null;

    protected constructor(
        protected readonly workerName: string,
        private readonly pollIntervalMs: number,
        protected readonly logger: Logger
    ) {
    }

    async start(): Promise<void> {
        if (this.active) {
            return;
        }

        this.active = true;
        this.logger.info("worker_started", { worker: this.workerName });
        this.runPromise = this.runLoop();
    }

    async stop(): Promise<void> {
        if (!this.active) {
            return;
        }

        this.active = false;
        await this.runPromise;
        this.runPromise = null;
        this.logger.info("worker_stopped", { worker: this.workerName });
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

            if (!this.active) {
                break;
            }

            await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
        }
    }

    protected abstract tick(): Promise<void>;
}
