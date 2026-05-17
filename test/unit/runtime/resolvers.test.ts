import { Pool } from "pg";
import { EthersBlockSource } from "../../../src/adapters/ethers-block-source.js";
import { validatePostgresSchema } from "../../../src/postgres/schema.js";
import { resolveDbDependencies, resolveEthersSource } from "../../../src/runtime/resolvers.js";
import type { BlockSource } from "../../../src/interfaces/block-source.js";
import type { Logger } from "../../../src/interfaces/logger.js";

jest.mock("../../../src/postgres/schema.js", () => ({
    validatePostgresSchema: jest.fn(async () => undefined),
}));

interface TestDependencies {
    value: string;
    preserved: string;
}

beforeEach(() => {
    jest.mocked(validatePostgresSchema).mockResolvedValue(undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
    jest.mocked(validatePostgresSchema).mockReset();
});

test("resolveEthersSource returns provided source", () => {
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

    expect(resolveEthersSource({ source })).toBe(source);
});

test("resolveEthersSource creates ethers source from rpcUrl", () => {
    expect(resolveEthersSource({ rpcUrl: "http://127.0.0.1:8545" })).toBeInstanceOf(EthersBlockSource);
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

    const result = await resolveDbDependencies({ overrides }, buildDefaults);

    expect(result.dependencies).toBe(overrides);
    expect(result.dispose).toBeUndefined();
    expect(buildDefaults).not.toHaveBeenCalled();
    expect(validatePostgresSchema).not.toHaveBeenCalled();
});

test("resolveDbDependencies validates schema, merges overrides, and disposes pool", async () => {
    const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    const endSpy = jest.spyOn(Pool.prototype, "end");
    const buildDefaults = jest.fn(() => ({
        value: "default",
        preserved: "default",
    }));

    const result = await resolveDbDependencies<TestDependencies>(
        {
            dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
            logger,
            overrides: {
                value: "override",
            },
        },
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
            buildDefaults
        )
    ).rejects.toBe(validationError);

    expect(buildDefaults).not.toHaveBeenCalled();
    expect(endSpy).toHaveBeenCalledTimes(1);
});
