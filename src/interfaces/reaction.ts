import type { DbExecutor } from "./db.js";
import type { PipelineEvent, PipelineTransaction } from "./pipeline.js";

type ReactionFilter<TItem, TContext> = (item: TItem, context: TContext | undefined) => boolean;
type ReactionHandler<TItem, TContext> = (
    item: TItem,
    db: DbExecutor,
    workerName: string,
    context: TContext | undefined
) => Promise<void>;

export type EventReactionPrepare<TContext = undefined> =
    (events: readonly PipelineEvent[]) => Promise<TContext>;
export type EventReactionFilter<TContext = undefined> = ReactionFilter<PipelineEvent, TContext>;
export type EventReactionHandler<TContext = undefined> = ReactionHandler<PipelineEvent, TContext>;

export type TransactionReactionPrepare<TContext = undefined> =
    (transactions: readonly PipelineTransaction[]) => Promise<TContext>;
export type TransactionReactionFilter<TContext = undefined> = ReactionFilter<PipelineTransaction, TContext>;
export type TransactionReactionHandler<TContext = undefined> = ReactionHandler<PipelineTransaction, TContext>;

export interface ReactionCallbacks<TItem, TContext = undefined> {
    prepare?: (items: readonly TItem[]) => Promise<TContext>;
    filter?: ReactionFilter<TItem, NoInfer<TContext>>;
    handler: ReactionHandler<TItem, NoInfer<TContext>>;
}
