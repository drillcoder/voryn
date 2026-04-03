import type { CanonicalEvent, CanonicalTransaction } from "./pipeline.js";

export interface ReactionContext {
    workerName: string;
}

export interface EventReactionHandler {
    handle(event: CanonicalEvent, context: ReactionContext): Promise<void>;
}

export interface TransactionReactionHandler {
    handle(tx: CanonicalTransaction, context: ReactionContext): Promise<void>;
}
