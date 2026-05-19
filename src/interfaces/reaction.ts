import type { PipelineEvent, PipelineTransaction } from "./pipeline.js";

export interface ReactionContext {
    workerName: string;
}

export interface EventReactionHandler {
    handle(event: PipelineEvent, context: ReactionContext): Promise<void>;
}

export interface TransactionReactionHandler {
    handle(tx: PipelineTransaction, context: ReactionContext): Promise<void>;
}
