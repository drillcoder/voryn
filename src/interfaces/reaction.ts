import type { PipelineEvent, PipelineTransaction } from "./pipeline.js";

export type ReactionHandlerResult = "processed" | "skipped";

export interface ReactionContext {
    workerName: string;
}

export interface EventReactionHandler {
    handle(event: PipelineEvent, context: ReactionContext): Promise<ReactionHandlerResult>;
}

export interface TransactionReactionHandler {
    handle(transaction: PipelineTransaction, context: ReactionContext): Promise<ReactionHandlerResult>;
}
