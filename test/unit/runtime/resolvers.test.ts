import { FetchRequest, FetchResponse, JsonRpcProvider } from "ethers";
import { Pool } from "pg";
import { EthersBlockSource } from "../../../src/adapters/ethers-block-source.js";
import { ConsoleLogger } from "../../../src/loggers/console-logger.js";
import { validatePostgresSchema } from "../../../src/postgres/schema.js";
import {
    resolveDbDependencies,
    resolveSingleBlockSource,
    resolveMultiBlockSource,
    resolveLogger,
} from "../../../src/runtime/resolvers.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { Logger } from "../../../src/interfaces/logger.js";

jest.mock("ethers", () => {
    const actual = jest.requireActual<{
        FetchRequest: typeof FetchRequest;
        FetchResponse: typeof FetchResponse;
    }>("ethers");

    return {
        FetchRequest: actual.FetchRequest,
        FetchResponse: actual.FetchResponse,
        JsonRpcProvider: jest.fn().mockImplementation((request: { url: string }) => ({
            getNetwork: async () => ({ chainId: BigInt(request.url.endsWith("/56") ? 56 : 1) }),
        })),
    };
});

jest.mock("../../../src/postgres/schema.js", () => ({
    validatePostgresSchema: jest.fn(async () => undefined),
}));

interface TestDependencies {
    value: string;
    preserved: string;
}

const logger: Logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

function getProviderRequest(index = 0): FetchRequest {
    const connection = jest.mocked(JsonRpcProvider).mock.calls[index]?.[0];

    if (!(connection instanceof FetchRequest)) {
        throw new Error("Expected JsonRpcProvider to receive a FetchRequest");
    }

    return connection;
}

beforeEach(() => {
    jest.mocked(validatePostgresSchema).mockResolvedValue(undefined);
    jest.clearAllMocks();
});

afterEach(() => {
    jest.restoreAllMocks();
    jest.mocked(validatePostgresSchema).mockReset();
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

    await expect(resolveSingleBlockSource({ source })).resolves.toBe(source);
});

test("resolveSingleBlockSource creates ethers source from rpcUrl", async () => {
    await expect(resolveSingleBlockSource({ rpcUrl: "http://127.0.0.1/1" }))
        .resolves.toBeInstanceOf(EthersBlockSource);

    const request = getProviderRequest();

    expect(request.url).toBe("http://127.0.0.1/1");
    expect(request.timeout).toBe(30_000);
    expect(request.retryFunc).not.toBeNull();

    if (request.retryFunc === null) {
        throw new Error("Expected RPC retry policy to be configured");
    }

    await expect(request.retryFunc(
        request,
        new FetchResponse(429, "Too Many Requests", {}, null, request),
        0,
    )).resolves.toBe(false);
});

test("resolveSingleBlockSource applies configured rpc request timeout", async () => {
    await expect(resolveSingleBlockSource({
        rpcUrl: "http://127.0.0.1/1",
        rpcRequestTimeoutMs: 12_345,
    })).resolves.toBeInstanceOf(EthersBlockSource);

    expect(getProviderRequest().timeout).toBe(12_345);
});

test("resolveMultiBlockSource creates multi-chain ethers source", async () => {
    await expect(resolveMultiBlockSource({
        rpcUrls: [
            "http://127.0.0.1/1",
            "http://127.0.0.1/56",
        ],
        rpcRequestTimeoutMs: 23_456,
    })).resolves.toBeInstanceOf(EthersBlockSource);

    expect(getProviderRequest(0).timeout).toBe(23_456);
    expect(getProviderRequest(1).timeout).toBe(23_456);
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

    await expect(resolveMultiBlockSource({ source })).resolves.toBe(source);
});

test.each([
    [{ rpcUrls: [] }, "Ethers source rpcUrls config must not be empty"],
    [
        { rpcUrls: ["http://127.0.0.1/1", "http://127.0.0.1/1"] },
        "Ethers source chain id is duplicated: 1",
    ],
    [
        { rpcUrls: [""] },
        "Ethers source rpcUrl is empty",
    ],
    [
        { rpcUrls: ["http://127.0.0.1/1"], rpcRequestTimeoutMs: 0 },
        "Ethers source rpcRequestTimeoutMs must be a positive safe integer",
    ],
    [
        { rpcUrls: ["http://127.0.0.1/1"], rpcRequestTimeoutMs: 1.5 },
        "Ethers source rpcRequestTimeoutMs must be a positive safe integer",
    ],
])("resolveMultiBlockSource rejects invalid source config", async (config, expectedError) => {
    await expect(resolveMultiBlockSource(config)).rejects.toThrow(expectedError);
});

test("resolveLogger returns provided logger", () => {
    const providedLogger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };

    expect(resolveLogger({ logger: providedLogger })).toBe(providedLogger);
});

test("resolveLogger creates console logger with min level", () => {
    const resolvedLogger = resolveLogger({ logLevel: "warn" });

    expect(resolvedLogger).toBeInstanceOf(ConsoleLogger);
    expect(Reflect.get(resolvedLogger, "minLevel")).toBe("warn");
});

test("resolveDbDependencies returns overrides without dbUrl", async () => {
    const overrides: TestDependencies = {
        value: "override",
        preserved: "override",
    };
    const buildDefaults = jest.fn(() => ({
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
    const endSpy = jest.spyOn(Pool.prototype, "end");
    const buildDefaults = jest.fn(() => ({
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
    const validationConfig = jest.mocked(validatePostgresSchema).mock.calls[0]?.[0];

    expect(validationConfig.pool).toBeInstanceOf(Pool);
    expect(validationConfig.logger).toBe(logger);
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
    const endSpy = jest.spyOn(Pool.prototype, "end");
    const buildDefaults = jest.fn(() => ({
        value: "default",
        preserved: "default",
    }));
    jest.mocked(validatePostgresSchema).mockRejectedValueOnce(validationError);

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
