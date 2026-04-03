export interface WorkerLifecycle {
    start(): Promise<void>;

    stop(): Promise<void>;
}
