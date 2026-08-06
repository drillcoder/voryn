export interface WorkerLifecycle {
    start(): Promise<void>;

    stop(): Promise<void>;
}

export interface WorkerLifecycleWithFailure extends WorkerLifecycle {
    onFailure(listener: (error: Error) => void): void;
}
