import type { PipelineEvent, PipelineTransaction } from "./pipeline.js";

export type ReactionHandlerResult = "processed" | "skipped";

export interface ReactionContext {
    workerName: string;
}

export type EventReactionHandler = (
    event: PipelineEvent,
    context: ReactionContext
) => Promise<ReactionHandlerResult>;

export type TransactionReactionHandler = (
    transaction: PipelineTransaction,
    context: ReactionContext
) => Promise<ReactionHandlerResult>;
