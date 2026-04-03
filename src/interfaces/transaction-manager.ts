import type { DbExecutor } from "./db.js";

export interface TransactionManager {
    run<TResult>(callback: (transaction: DbExecutor) => Promise<TResult>): Promise<TResult>;
}
