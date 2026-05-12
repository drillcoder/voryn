import type { BlockSource } from "../../src/interfaces/block-source.js";
import type { FetchedBlock } from "../../src/interfaces/chain.js";
import { PostgresTransactionManager } from "../../src/postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresCanonicalBlocksRepository } from "../../src/repositories/postgres/canonical-blocks-repository.js";
import { PostgresCanonicalEventsRepository } from "../../src/repositories/postgres/canonical-events-repository.js";
import {
    PostgresCanonicalTransactionsRepository
} from "../../src/repositories/postgres/canonical-transactions-repository.js";
import { PostgresChainCursorRepository } from "../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresRawBlocksRepository } from "../../src/repositories/postgres/raw-blocks-repository.js";
import { FetchWorker } from "../../src/workers/fetch-worker.js";
import { HeadWorker } from "../../src/workers/head-worker.js";
import { SequencerWorker } from "../../src/workers/sequencer-worker.js";
import { buildFetchedBlock, createLeaderLock, hashFromNumber } from "../integration/helpers/fixtures.js";
import type { IsolatedDbContext } from "../integration/helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../integration/helpers/test-db.js";
import { stopWorkers, waitFor } from "./helpers/async.js";

const DATABASE_URL = getRequiredDatabaseUrl();
const CHAIN_A = 1;
const CHAIN_B = 137;

describe("e2e multi-chain isolation", () => {
    let db: IsolatedDbContext;

    beforeAll(async () => {
        db = await createIsolatedDbContext(DATABASE_URL);
    });

    beforeEach(async () => {
        await db.truncatePipelineTables();
    });

    afterAll(async () => {
        await db.close();
    });

    test("two chain pipelines commit independently in one database", async () => {
        const transactionManager = new PostgresTransactionManager(db.pool);
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const rawBlocksRepository = new PostgresRawBlocksRepository(db.pool);
        const canonicalBlocksRepository = new PostgresCanonicalBlocksRepository(db.pool);
        const canonicalTransactionsRepository = new PostgresCanonicalTransactionsRepository(db.pool);
        const canonicalEventsRepository = new PostgresCanonicalEventsRepository(db.pool);

        const chainACommittedHash = hashFromNumber(9);
        const chainBCommittedHash = hashFromNumber(99);

        await chainCursorRepository.insert({
            chainId: CHAIN_A,
            lastEnqueuedBlock: 9,
            lastCommittedBlock: 9,
            lastCommittedHash: chainACommittedHash,
        });
        await chainCursorRepository.insert({
            chainId: CHAIN_B,
            lastEnqueuedBlock: 99,
            lastCommittedBlock: 99,
            lastCommittedHash: chainBCommittedHash,
        });

        const chainABlock10 = withChainId(buildFetchedBlock(10, chainACommittedHash, 1), CHAIN_A);
        const chainABlock11 = withChainId(buildFetchedBlock(11, chainABlock10.block.hash, 1), CHAIN_A);
        const chainBBlock100 = withChainId(buildFetchedBlock(100, chainBCommittedHash, 1), CHAIN_B);
        const chainBBlock101 = withChainId(buildFetchedBlock(101, chainBBlock100.block.hash, 1), CHAIN_B);
        const source = createMultiChainSource([
            [CHAIN_A, { latest: 11, blocks: [chainABlock10, chainABlock11] }],
            [CHAIN_B, { latest: 101, blocks: [chainBBlock100, chainBBlock101] }],
        ]);

        const workers = [
            await HeadWorker.create({
                config: { chainId: CHAIN_A, delayBetweenTicksMs: 5, confirmations: 0, depthBlocks: 64 },
                source,
                overrides: {
                    chainCursorRepository,
                    blockJobsRepository,
                    rawBlocksRepository,
                    transactionManager,
                    leaderLock: createLeaderLock(),
                },
            }),
            await FetchWorker.create({
                config: {
                    chainId: CHAIN_A,
                    delayBetweenTicksMs: 5,
                    workerId: "fetch-worker-chain-a",
                    fetchBatchSize: 2,
                    fetchClaimTtlMs: 60_000,
                    retryMaxAttempts: 3,
                    retryBaseDelayMs: 10,
                    retryMaxDelayMs: 100,
                },
                source,
                overrides: {
                    blockJobsRepository,
                    rawBlocksRepository,
                    transactionManager,
                },
            }),
            await SequencerWorker.create({
                config: { chainId: CHAIN_A, delayBetweenTicksMs: 5, maxBlocksPerTick: 2 },
                source,
                overrides: {
                    chainCursorRepository,
                    rawBlocksRepository,
                    canonicalBlocksRepository,
                    canonicalTransactionsRepository,
                    canonicalEventsRepository,
                    blockJobsRepository,
                    transactionManager,
                    leaderLock: createLeaderLock(),
                },
            }),
            await HeadWorker.create({
                config: { chainId: CHAIN_B, delayBetweenTicksMs: 5, confirmations: 0, depthBlocks: 64 },
                source,
                overrides: {
                    chainCursorRepository,
                    blockJobsRepository,
                    rawBlocksRepository,
                    transactionManager,
                    leaderLock: createLeaderLock(),
                },
            }),
            await FetchWorker.create({
                config: {
                    chainId: CHAIN_B,
                    delayBetweenTicksMs: 5,
                    workerId: "fetch-worker-chain-b",
                    fetchBatchSize: 2,
                    fetchClaimTtlMs: 60_000,
                    retryMaxAttempts: 3,
                    retryBaseDelayMs: 10,
                    retryMaxDelayMs: 100,
                },
                source,
                overrides: {
                    blockJobsRepository,
                    rawBlocksRepository,
                    transactionManager,
                },
            }),
            await SequencerWorker.create({
                config: { chainId: CHAIN_B, delayBetweenTicksMs: 5, maxBlocksPerTick: 2 },
                source,
                overrides: {
                    chainCursorRepository,
                    rawBlocksRepository,
                    canonicalBlocksRepository,
                    canonicalTransactionsRepository,
                    canonicalEventsRepository,
                    blockJobsRepository,
                    transactionManager,
                    leaderLock: createLeaderLock(),
                },
            }),
        ] as const;

        try {
            for (const worker of workers) {
                await worker.start();
            }

            await waitFor(async () => {
                const cursorA = await chainCursorRepository.get(CHAIN_A);
                const cursorB = await chainCursorRepository.get(CHAIN_B);
                return cursorA?.lastCommittedBlock === 11 && cursorB?.lastCommittedBlock === 101;
            });

            await expect(db.countRows("canonical_blocks", "chain_id = 1 AND block_number BETWEEN 10 AND 11"))
                .resolves.toBe(2);
            await expect(db.countRows("canonical_blocks", "chain_id = 137 AND block_number BETWEEN 100 AND 101"))
                .resolves.toBe(2);
            await expect(db.countRows("canonical_transactions", "chain_id = 1")).resolves.toBe(2);
            await expect(db.countRows("canonical_transactions", "chain_id = 137")).resolves.toBe(2);
            await expect(db.countRows("block_jobs", "chain_id = 1 AND status = 'committed'")).resolves.toBe(2);
            await expect(db.countRows("block_jobs", "chain_id = 137 AND status = 'committed'")).resolves.toBe(2);
        } finally {
            await stopWorkers(workers);
        }
    }, 20_000);
});

function withChainId(block: FetchedBlock, chainId: number): FetchedBlock {
    return {
        block: {
            ...block.block,
            chainId,
        },
        transactions: block.transactions.map((tx) => ({
            ...tx,
            chainId,
        })),
        logs: block.logs.map((log) => ({
            ...log,
            chainId,
        })),
    };
}

function createMultiChainSource(
    entries: ReadonlyArray<readonly [number, { latest: number; blocks: FetchedBlock[] }]>
): BlockSource {
    const chainLatest = new Map<number, number>();
    const chainBlocks = new Map<string, FetchedBlock>();

    for (const [chainId, data] of entries) {
        chainLatest.set(chainId, data.latest);
        for (const block of data.blocks) {
            chainBlocks.set(`${String(chainId)}:${String(block.block.number)}`, block);
        }
    }

    return {
        async getLatestBlockNumber(chainId: number): Promise<number> {
            const latest = chainLatest.get(chainId);
            if (latest === undefined) {
                throw new Error(`missing latest block for chain ${String(chainId)}`);
            }

            return latest;
        },
        async getLatestBlock(chainId: number) {
            const latest = await this.getLatestBlockNumber(chainId);

            return this.getBlock(chainId, latest);
        },
        async getBlock(chainId: number, blockNumber: number) {
            const block = chainBlocks.get(`${String(chainId)}:${String(blockNumber)}`);
            if (block === undefined) {
                throw new Error(`missing block ${String(blockNumber)} for chain ${String(chainId)}`);
            }

            return block.block;
        },
        async getBlockData(chainId: number, blockNumber: number): Promise<FetchedBlock> {
            const block = chainBlocks.get(`${String(chainId)}:${String(blockNumber)}`);
            if (block === undefined) {
                throw new Error(`missing block ${String(blockNumber)} for chain ${String(chainId)}`);
            }

            return block;
        },
    };
}
