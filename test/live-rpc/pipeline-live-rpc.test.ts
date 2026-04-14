import { JsonRpcProvider } from "ethers";
import { PostgresTransactionManager } from "../../src/postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresCanonicalBlocksRepository } from "../../src/repositories/postgres/canonical-blocks-repository.js";
import { PostgresCanonicalEventsRepository } from "../../src/repositories/postgres/canonical-events-repository.js";
import {
    PostgresCanonicalTransactionsRepository
} from "../../src/repositories/postgres/canonical-transactions-repository.js";
import { PostgresChainCursorRepository } from "../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresRawBlocksRepository } from "../../src/repositories/postgres/raw-blocks-repository.js";
import { EthersBlockSource } from "../../src/adapters/ethers-block-source.js";
import type { IsolatedDbContext } from "../integration/helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../integration/helpers/test-db.js";
import { TestFetchWorker, TestSequencerWorker } from "../integration/helpers/test-workers.js";

const LIVE_RPC_URL = process.env.VORYN_LIVE_RPC_URL
    ?? process.env.VORYN_FETCH_RPC_URL
    ?? process.env.VORYN_HEAD_RPC_URL;
const LIVE_CHAIN_ID_RAW = process.env.VORYN_LIVE_CHAIN_ID ?? process.env.VORYN_CHAIN_ID;
const LIVE_CONFIRMATIONS_RAW = process.env.VORYN_LIVE_CONFIRMATIONS;
const HAS_LIVE_CONFIG = LIVE_RPC_URL !== undefined && LIVE_CHAIN_ID_RAW !== undefined;
const LIVE_CHAIN_ID = LIVE_CHAIN_ID_RAW === undefined ? null : Number(LIVE_CHAIN_ID_RAW);
const LIVE_CONFIRMATIONS = LIVE_CONFIRMATIONS_RAW === undefined ? 6 : Number(LIVE_CONFIRMATIONS_RAW);
const DATABASE_URL = getRequiredDatabaseUrl();

const describeLive = HAS_LIVE_CONFIG ? describe : describe.skip;

describeLive("live rpc pipeline", () => {
    let db: IsolatedDbContext;

    beforeAll(async () => {
        if (!HAS_LIVE_CONFIG) {
            return;
        }

        if (!Number.isSafeInteger(LIVE_CHAIN_ID) || (LIVE_CHAIN_ID ?? 0) <= 0) {
            throw new Error("VORYN_LIVE_CHAIN_ID (or VORYN_CHAIN_ID) must be a positive safe integer");
        }

        if (!Number.isSafeInteger(LIVE_CONFIRMATIONS) || LIVE_CONFIRMATIONS < 0) {
            throw new Error("VORYN_LIVE_CONFIRMATIONS must be a non-negative safe integer");
        }

        db = await createIsolatedDbContext(DATABASE_URL);
    });

    afterAll(async () => {
        if (!HAS_LIVE_CONFIG) {
            return;
        }

        await db.close();
    });

    test("fetches and commits one real block from rpc", async () => {
        if (LIVE_CHAIN_ID === null || LIVE_RPC_URL === undefined) {
            throw new Error("live-rpc configuration is missing");
        }

        const chainId = LIVE_CHAIN_ID;
        const rpcUrl = LIVE_RPC_URL;

        const transactionManager = new PostgresTransactionManager(db.pool);
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const rawBlocksRepository = new PostgresRawBlocksRepository(db.pool);
        const canonicalBlocksRepository = new PostgresCanonicalBlocksRepository(db.pool);
        const canonicalTransactionsRepository = new PostgresCanonicalTransactionsRepository(db.pool);
        const canonicalEventsRepository = new PostgresCanonicalEventsRepository(db.pool);

        const source = new EthersBlockSource({
            provider: new JsonRpcProvider(rpcUrl),
            validateProviderChainId: true,
        });

        const latest = await source.getLatestBlockNumber(chainId);
        const targetBlock = latest - LIVE_CONFIRMATIONS;
        if (targetBlock <= 0) {
            throw new Error(
                `Not enough finalized blocks: latest=${String(latest)}, confirmations=${String(LIVE_CONFIRMATIONS)}`
            );
        }

        const previous = await source.getBlockData(chainId, targetBlock - 1);
        const expected = await source.getBlockData(chainId, targetBlock);

        await chainCursorRepository.insert({
            chainId,
            lastEnqueuedBlock: targetBlock - 1,
            lastCommittedBlock: targetBlock - 1,
            lastCommittedHash: previous.block.hash,
        });
        await blockJobsRepository.enqueueRange(chainId, targetBlock, targetBlock);

        const fetchWorker = new TestFetchWorker(
            {
                chainId,
                delayBetweenTicksMs: 1,
                workerId: "fetch-worker-live-rpc",
                fetchBatchSize: 1,
                fetchClaimTtlMs: 60_000,
                retryMaxAttempts: 3,
                retryBaseDelayMs: 10,
                retryMaxDelayMs: 100,
            },
            source,
            blockJobsRepository,
            rawBlocksRepository,
            transactionManager,
        );
        const sequencerWorker = new TestSequencerWorker(
            {
                chainId,
                delayBetweenTicksMs: 1,
                maxBlocksPerTick: 1,
            },
            chainCursorRepository,
            rawBlocksRepository,
            canonicalBlocksRepository,
            canonicalTransactionsRepository,
            canonicalEventsRepository,
            blockJobsRepository,
            transactionManager,
            {
                tryAcquire: async () => true,
                release: async () => undefined,
            },
        );

        await fetchWorker.runTick();
        await sequencerWorker.runTick();

        const cursor = await chainCursorRepository.get(chainId);
        expect(cursor?.lastCommittedBlock).toBe(targetBlock);
        expect(cursor?.lastCommittedHash).toBe(expected.block.hash);

        await expect(db.countRows(
            "block_jobs",
            `chain_id = ${String(chainId)} AND block_number = ${String(targetBlock)} AND status = 'committed'`
        )).resolves.toBe(1);
        await expect(db.countRows(
            "canonical_blocks",
            `chain_id = ${String(chainId)} AND block_number = ${String(targetBlock)}`
        )).resolves.toBe(1);
        await expect(db.countRows(
            "canonical_transactions",
            `chain_id = ${String(chainId)} AND block_number = ${String(targetBlock)}`
        )).resolves.toBe(expected.transactions.length);
        await expect(db.countRows(
            "canonical_events",
            `chain_id = ${String(chainId)} AND block_number = ${String(targetBlock)}`
        )).resolves.toBe(expected.logs.length);
    }, 30_000);
});
