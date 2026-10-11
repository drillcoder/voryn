import type { DbExecutor } from "./db.js";
import type { PipelineEvent, PipelineTransaction } from "./pipeline.js";

export type EventReactionFilter = (event: PipelineEvent) => boolean;
export type TransactionReactionFilter = (transaction: PipelineTransaction) => boolean;

export type EventReactionHandler = (
    event: PipelineEvent,
    db: DbExecutor,
    workerName: string
) => Promise<void>;

export type TransactionReactionHandler = (
    transaction: PipelineTransaction,
    db: DbExecutor,
    workerName: string
) => Promise<void>;
