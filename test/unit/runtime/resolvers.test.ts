import { Pool } from "pg";
import { EthersBlockSource } from "../../../src/adapters/ethers-block-source.js";
import { ConsoleLogger } from "../../../src/loggers/console-logger.js";
import { validatePostgresSchema } from "../../../src/postgres/schema.js";
import {
    resolveDbDependencies,
    resolveEthersSource,
    resolveEthersSources,
    resolveLogger,
} from "../../../src/runtime/resolvers.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { Logger } from "../../../src/interfaces/logger.js";

jest.mock("ethers", () => ({
    JsonRpcProvider: jest.fn().mockImplementation((rpcUrl: string) => ({
        getNetwork: async () => ({ chainId: BigInt(rpcUrl.endsWith("/56") ? 56 : 1) }),
    })),
}));

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

beforeEach(() => {
    jest.mocked(validatePostgresSchema).mockResolvedValue(undefined);
    jest.clearAllMocks();
});

afterEach(() => {
    jest.restoreAllMocks();
    jest.mocked(validatePostgresSchema).mockReset();
});

test("resolveEthersSource returns provided source", async () => {
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

    await expect(resolveEthersSource({ source })).resolves.toBe(source);
});

test("resolveEthersSource creates ethers source from rpcUrl", async () => {
    await expect(resolveEthersSource({ chain: { chainId: 1, rpcUrl: "http://127.0.0.1/1" } }))
        .resolves.toBeInstanceOf(EthersBlockSource);
});

test("resolveEthersSources creates multi-chain ethers source", async () => {
    await expect(resolveEthersSources({
        chains: [
            { chainId: 1, rpcUrl: "http://127.0.0.1/1" },
            { chainId: 56, rpcUrl: "http://127.0.0.1/56" },
        ],
    })).resolves.toBeInstanceOf(EthersBlockSource);
});

test("resolveEthersSources returns provided source", async () => {
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

    await expect(resolveEthersSources({ source })).resolves.toBe(source);
});

test.each([
    [{ chains: [] }, "Ethers source chains config must not be empty"],
    [
        { chains: [{ chainId: 0, rpcUrl: "http://127.0.0.1/0" }] },
        "Ethers source chain id is invalid: 0",
    ],
    [
        {
            chains: [
                { chainId: 1, rpcUrl: "http://127.0.0.1/1" },
                { chainId: 56, rpcUrl: "http://127.0.0.1/1" },
            ],
        },
        "Ethers source chain id is duplicated: 1",
    ],
    [
        { chains: [{ chainId: 1, rpcUrl: "" }] },
        "Ethers source rpcUrl is empty for chain 1",
    ],
])("resolveEthersSources rejects invalid chains", async (config, expectedError) => {
    await expect(resolveEthersSources(config)).rejects.toThrow(expectedError);
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
