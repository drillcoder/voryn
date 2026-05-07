import { Pool } from "pg";

import type { BlockJobsRepository } from "../../../src/interfaces/repositories.js";
import { validatePostgresSchema } from "../../../src/postgres/schema.js";
import { BlockJobRecovery } from "../../../src/recovery/block-job-recovery.js";
import { PostgresBlockJobsRepository } from "../../../src/repositories/postgres/block-jobs-repository.js";
import { createNoopBlockJobsRepository } from "../helpers/pipeline-test-helpers.js";

jest.mock("../../../src/postgres/schema.js", () => ({
    validatePostgresSchema: jest.fn(async () => undefined),
}));

interface BlockJobRecoveryInternals {
    service: {
        blockJobsRepository: BlockJobsRepository;
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

test("block job recovery create wires retry execution", async () => {
    const retryFailed = jest.fn(async () => 2);
    const blockJobsRepository: BlockJobsRepository = {
        ...createNoopBlockJobsRepository(),
        retryFailed,
    };
    const recovery = await BlockJobRecovery.create({
        config: { chainId: 7 },
        overrides: { blockJobsRepository },
    });

    const result = await recovery.retryFailedRange(10, 11);

    await recovery.close();

    expect(retryFailed).toHaveBeenCalledWith(7, 10, 11);
    expect(result.retried).toBe(2);
});

test("block job recovery retries one block", async () => {
    const retryFailed = jest.fn(async () => 1);
    const blockJobsRepository: BlockJobsRepository = {
        ...createNoopBlockJobsRepository(),
        retryFailed,
    };
    const recovery = await BlockJobRecovery.create({
        config: { chainId: 7 },
        overrides: { blockJobsRepository },
    });

    const result = await recovery.retryFailedBlock(10);

    await recovery.close();

    expect(retryFailed).toHaveBeenCalledWith(7, 10, 10);
    expect(result.retried).toBe(1);
});

test("block job recovery merges db defaults with overrides and returns disposer", async () => {
    const blockJobsRepository = createNoopBlockJobsRepository();
    const endSpy = jest.spyOn(Pool.prototype, "end");
    const recovery = await BlockJobRecovery.create({
        config: { chainId: 7 },
        dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
        overrides: {
            blockJobsRepository,
        },
    });
    const recoveryInternals = recovery as unknown as BlockJobRecoveryInternals;

    expect(recoveryInternals.service.blockJobsRepository).toBe(blockJobsRepository);
    expect(validatePostgresSchema).toHaveBeenCalledTimes(1);

    await recovery.close();

    expect(endSpy).toHaveBeenCalledTimes(1);
    endSpy.mockRestore();
});

test("block job recovery builds postgres repository by default with db url", async () => {
    const endSpy = jest.spyOn(Pool.prototype, "end");
    const recovery = await BlockJobRecovery.create({
        config: { chainId: 7 },
        dbUrl: "postgresql://voryn:voryn@127.0.0.1:5432/voryn",
    });
    const recoveryInternals = recovery as unknown as BlockJobRecoveryInternals;

    expect(recoveryInternals.service.blockJobsRepository).toBeInstanceOf(PostgresBlockJobsRepository);

    await recovery.close();

    endSpy.mockRestore();
});
