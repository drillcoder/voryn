export interface LeaderLock {
    tryAcquire(): Promise<boolean>;

    release(): Promise<void>;
}
