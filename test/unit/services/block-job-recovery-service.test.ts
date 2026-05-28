import type { BlockJobsRepository } from "../../../src/interfaces/repositories.js";
import { BlockJobRecoveryService } from "../../../src/services/block-job-recovery-service.js";

const createBlockJobsRepository = (retryFailed: BlockJobsRepository["retryFailed"]): BlockJobsRepository => ({
    enqueueRange: async () => undefined,
    get: async () => null,
    claimForFetch: async () => null,
    markFetched: async () => undefined,
    markFetchFailed: async () => undefined,
    markCommitted: async () => undefined,
    getStatusCounts: async () => ({
        pending: 0,
        fetching: 0,
        fetched: 0,
        committed: 0,
        failed: 0,
    }),
    listFailedBlocks: async () => [],
    retryFailed,
    deleteBlockNumberRange: async () => 0,
    deleteAfterBlockNumber: async () => 0,
});

test("block job recovery service retries one failed block with fresh attempts", async () => {
    const retryFailed = jest.fn(async () => 1);
    const info = jest.fn();
    const service = new BlockJobRecoveryService({ chainId: 10 }, createBlockJobsRepository(retryFailed), {
        debug: jest.fn(),
        info,
        warn: jest.fn(),
        error: jest.fn(),
    });

    const result = await service.retryFailedBlock(42);

    expect(retryFailed).toHaveBeenCalledWith(10, 42, 42);
    expect(result).toEqual({
        chainId: 10,
        fromBlock: 42,
        toBlock: 42,
        retried: 1,
    });
    expect(info).toHaveBeenCalledWith("failed_block_jobs_retry_requested", result);
});

test("block job recovery service retries a range", async () => {
    const retryFailed = jest.fn(async () => 3);
    const service = new BlockJobRecoveryService({ chainId: 10 }, createBlockJobsRepository(retryFailed));

    const result = await service.retryFailedBlockRange(42, 44);

    expect(retryFailed).toHaveBeenCalledWith(10, 42, 44);
    expect(result.retried).toBe(3);
});

test("block job recovery service rejects invalid ranges", async () => {
    const retryFailed = jest.fn(async () => 0);
    const service = new BlockJobRecoveryService({ chainId: 10 }, createBlockJobsRepository(retryFailed));

    await expect(service.retryFailedBlockRange(44, 42))
        .rejects.toThrow("Cannot retry failed block jobs");
    expect(retryFailed).not.toHaveBeenCalled();
});
