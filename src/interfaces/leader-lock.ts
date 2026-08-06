export interface LeaderLock {
    tryAcquire(): Promise<boolean>;

    release(): Promise<void>;

    onLost(listener: (error: Error) => void): void;
}
