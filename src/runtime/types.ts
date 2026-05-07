import type { Logger } from "../interfaces/logger.js";
import type { LeaderLock } from "../interfaces/leader-lock.js";

export interface RuntimeBaseOptions<TConfig> {
    config: TConfig;
    logger?: Logger;
}

export interface ReactionWorkerBaseOptions<TConfig, THandler> extends RuntimeBaseOptions<TConfig> {
    handler: THandler;
}

export type RuntimeSourceOptions<TSource> =
    | { source: TSource; rpcUrl?: never }
    | { source?: never; rpcUrl: string };

export interface ResolveDbDependenciesResult<TDependencies extends object> {
    dependencies: TDependencies;
    dispose?: () => Promise<void>;
}

export type RuntimeDbOptions<TDependencies extends object> =
    | {
        dbUrl: string;
        overrides?: Partial<TDependencies>;
    }
    | {
        dbUrl?: undefined;
        overrides: TDependencies;
    };

type DbOptionsWithUrl<TDependencies extends { leaderLock: LeaderLock }> =
    | {
        dbUrl: string;
        overrides?: Partial<TDependencies>;
        lockKey: bigint;
    }
    | {
        dbUrl: string;
        overrides: Partial<TDependencies> & Pick<TDependencies, "leaderLock">;
        lockKey?: never;
    };

interface DbOptionsWithOverrides<TDependencies> {
    dbUrl?: undefined;
    overrides: TDependencies;
    lockKey?: never;
}

export type ReactionWorkerOptions<TConfig, THandler, TDependencies extends { leaderLock: LeaderLock }> =
    ReactionWorkerBaseOptions<TConfig, THandler>
    & (DbOptionsWithUrl<TDependencies> | DbOptionsWithOverrides<TDependencies>);
