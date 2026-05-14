import type { Logger } from "../interfaces/logger.js";

export interface RuntimeBaseOptions<TConfig> {
    config: TConfig;
    logger?: Logger;
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

export type ReactionWorkerOptions<TConfig, THandler, TDependencies extends object> =
    RuntimeBaseOptions<TConfig>
    & RuntimeDbOptions<TDependencies>
    & { handler: THandler };
