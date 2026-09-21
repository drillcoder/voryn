import {
    afterEach,
    beforeEach,
    expect,
    test,
    vi,
} from "vitest";

import { Pool } from "pg";
import { EthersBlockSource } from "../../../src/adapters/ethers-block-source.js";
import { ConsoleLogger } from "../../../src/loggers/console-logger.js";
import { validatePostgresSchema } from "../../../src/postgres/schema.js";
import {
    combineDisposers,
    disposeAfterError,
    resolveDbDependencies,
    resolveSingleBlockSource,
    resolveMultiBlockSource,
    resolveLogger,
} from "../../../src/runtime/resolvers.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { Logger } from "../../../src/interfaces/logger.js";

vi.mock("../../../src/postgres/schema.js", () => ({
    validatePostgresSchema: vi.fn(async () => undefined),
}));

interface TestDependencies {
    value: string;
    preserved: string;
}

const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

beforeEach(() => {
    vi.mocked(validatePostgresSchema).mockResolvedValue(undefined);
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(validatePostgresSchema).mockClear();
});

test("resolveSingleBlockSource returns provided source", async () => {
    const source: BlockSource = {
        getLatestBlockNumber: async () => 0,
        getLatestBlock: async () => {
            throw new Error("not expected");
        },
        getBlock: async () => {
            throw new Error("not expected");
        },
        getBlockData: async () => {
            throw new Error("not expected");
        },
    };

    await expect(resolveSingleBlockSource({
        chainId: 1,
        source,
    })).resolves.toEqual({ source });
});

test("resolveSingleBlockSource creates ethers source from RPC config", async () => {
    const resolved = await resolveSingleBlockSource({
        network: {
            chainId: 1,
            rpcUrls: ["http://127.0.0.1/1"],
        },
    });

    expect(resolved.source).toBeInstanceOf(EthersBlockSource);
    expect(resolved.dispose).toBeDefined();
    await resolved.dispose?.();
});

test("resolveMultiBlockSource creates multi-chain ethers source", async () => {
    const resolved = await resolveMultiBlockSource({
        networks: [
            { chainId: 1, rpcUrls: ["http://127.0.0.1/1"] },
            { chainId: 56, rpcUrls: ["http://127.0.0.1/56"] },
        ],
        requestTimeoutMs: 23_456,
        operationTimeoutMs: 67_890,
    });

    expect(resolved.source).toBeInstanceOf(EthersBlockSource);
    await resolved.dispose?.();
});

test("resolveMultiBlockSource returns provided source", async () => {
    const source: BlockSource = {
        getLatestBlockNumber: async () => 0,
        getLatestBlock: async () => {
            throw new Error("not expected");
        },
        getBlock: async () => {
            throw new Error("not expected");
        },
        getBlockData: async () => {
            throw new Error("not expected");
        },
    };

    await expect(resolveMultiBlockSource({ chainIds: [1], source })).resolves.toEqual({ source });
});

test.each([
    [{ networks: [] }, "Ethers source networks must not be empty"],
    [
        {
            networks: [
                { chainId: 1, rpcUrls: ["http://127.0.0.1/1"] },
                { chainId: 1, rpcUrls: ["http://127.0.0.1/2"] },
            ],
        },
        "networks[1].chainId must be unique",
    ],
    [
        { networks: [{ chainId: 1, rpcUrls: [] }] },
        "networks[0].rpcUrls must not be empty",
    ],
    [
        { networks: [{ chainId: 1, rpcUrls: [" "] }] },
        "networks[0].rpcUrls[0] must be a valid HTTP or HTTPS URL",
    ],
    [
        {
            networks: [{ chainId: 1, rpcUrls: ["http://127.0.0.1/1"] }],
            requestTimeoutMs: 0,
        },
        "requestTimeoutMs must be a positive safe integer",
    ],
    [
        {
            networks: [{ chainId: 1, rpcUrls: ["http://127.0.0.1/1"] }],
            operationTimeoutMs: 1.5,
        },
        "operationTimeoutMs must be a positive safe integer",
    ],
])("resolveMultiBlockSource rejects invalid source config", async (config, expectedError) => {
    await expect(resolveMultiBlockSource(config)).rejects.toThrow(expectedError);
});

test("resolveLogger returns provided logger", () => {
    const providedLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };

    expect(resolveLogger({ logger: providedLogger })).toBe(providedLogger);
});

test("resolveLogger creates console logger with min level", () => {
    const resolvedLogger = resolveLogger({ logLevel: "warn" });

    expect(resolvedLogger).toBeInstanceOf(ConsoleLogger);
    expect(Reflect.get(resolvedLogger, "minLevel")).toBe("warn");
});

test("combineDisposers returns undefined without resources", () => {
    expect(combineDisposers(undefined)).toBeUndefined();
});

test("combineDisposers runs every resource cleanup and returns one failure", async () => {
    const cleanupError = new Error("cleanup failed");
    const successfulDispose = vi.fn(async () => undefined);
    const failingDispose = vi.fn(async () => {
        throw cleanupError;
    });
    const dispose = combineDisposers(failingDispose, undefined, successfulDispose);

    await expect(dispose?.()).rejects.toBe(cleanupError);
    expect(failingDispose).toHaveBeenCalledTimes(1);
    expect(successfulDispose).toHaveBeenCalledTimes(1);
});

test("combineDisposers aggregates multiple cleanup failures", async () => {
    const firstError = new Error("first cleanup failed");
    const secondError = new Error("second cleanup failed");
    const dispose = combineDisposers(
        async () => {
            throw firstError;
        },
        async () => {
            throw secondError;
        },
    );

    await expect(dispose?.()).rejects.toMatchObject({
        errors: [firstError, secondError],
        message: "Multiple resource cleanup operations failed",
    });
});

test("disposeAfterError preserves initialization failure after successful cleanup", async () => {
    const initializationError = new Error("initialization failed");
    const dispose = vi.fn(async () => undefined);

    await expect(disposeAfterError(initializationError, dispose)).rejects.toBe(initializationError);
    expect(dispose).toHaveBeenCalledTimes(1);
});

test("disposeAfterError aggregates initialization and cleanup failures", async () => {
    const initializationError = new Error("initialization failed");
    const cleanupError = new Error("cleanup failed");

    await expect(disposeAfterError(initializationError, async () => {
        throw cleanupError;
    })).rejects.toMatchObject({
        errors: [initializationError, cleanupError],
        message: "Initialization and resource cleanup failed",
    });
});

test("resolveDbDependencies returns overrides without dbUrl", async () => {
    const overrides: TestDependencies = {
        value: "override",
        preserved: "override",
    };
    const buildDefaults = vi.fn(() => ({
        value: "default",
        preserved: "default",
    }));

    const result = await resolveDbDependencies({ overrides }, logger, buildDefaults);

    expect(result.dependencies).toBe(overrides);
    expect(result.dispose).toBeUndefined();
    expect(buildDefaults).not.toHaveBeenCalled();
    expect(validatePostgresSchema).not.toHaveBeenCalled();
});

test("resolveDbDependencies validates schema, merges overrides, and disposes pool", async () => {
    const endSpy = vi.spyOn(Pool.prototype, "end");
    const buildDefaults = vi.fn(() => ({
        value: "default",
        preserved: "default",
    }));

    const result = await resolveDbDependencies<TestDependencies>(
        {
            dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
            overrides: {
                value: "override",
            },
        },
        logger,
        buildDefaults
    );

    expect(validatePostgresSchema).toHaveBeenCalledTimes(1);
    const validationConfig = vi.mocked(validatePostgresSchema).mock.calls[0]?.[0];

    expect(validationConfig.pool).toBeInstanceOf(Pool);
    expect(validationConfig.logger).toBe(logger);
    expect(validationConfig.pool.options).toMatchObject({
        keepAlive: true,
        keepAliveInitialDelayMillis: 30_000,
    });
    expect(buildDefaults).toHaveBeenCalledWith(expect.any(Pool));
    expect(result.dependencies).toEqual({
        value: "override",
        preserved: "default",
    });
    expect(result.dispose).toBeDefined();

    await result.dispose?.();

    expect(endSpy).toHaveBeenCalledTimes(1);
});

test("resolveDbDependencies closes pool and rethrows validation errors", async () => {
    const validationError = new Error("schema is invalid");
    const endSpy = vi.spyOn(Pool.prototype, "end");
    const buildDefaults = vi.fn(() => ({
        value: "default",
        preserved: "default",
    }));
    vi.mocked(validatePostgresSchema).mockRejectedValueOnce(validationError);

    await expect(
        resolveDbDependencies<TestDependencies>(
            {
                dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
            },
            logger,
            buildDefaults
        )
    ).rejects.toBe(validationError);

    expect(buildDefaults).not.toHaveBeenCalled();
    expect(endSpy).toHaveBeenCalledTimes(1);
});
