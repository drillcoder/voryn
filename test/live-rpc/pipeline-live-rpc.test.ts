import { JsonRpcProvider } from "ethers";
import { PostgresTransactionManager } from "../../src/postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresBlocksRepository } from "../../src/repositories/postgres/blocks-repository.js";
import { PostgresChainCursorRepository } from "../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresEventsRepository } from "../../src/repositories/postgres/events-repository.js";
import { PostgresTransactionsRepository } from "../../src/repositories/postgres/transactions-repository.js";
import { EthersBlockSource } from "../../src/adapters/ethers-block-source.js";
import { FetchService } from "../../src/services/fetch-service.js";
import { SequencerService } from "../../src/services/sequencer-service.js";
import type { IsolatedDbContext } from "../integration/helpers/test-db.js";
import { createIsolatedDbContext } from "../integration/helpers/test-db.js";

const LIVE_RPC_URL = process.env.VORYN_TEST_RPC_URL;
const LIVE_CHAIN_ID_RAW = process.env.VORYN_TEST_CHAIN_ID;
const DATABASE_URL = process.env.DATABASE_URL;
const HAS_LIVE_CONFIG = LIVE_RPC_URL !== undefined
    && LIVE_RPC_URL !== ""
    && LIVE_CHAIN_ID_RAW !== undefined
    && LIVE_CHAIN_ID_RAW !== ""
    && DATABASE_URL !== undefined
    && DATABASE_URL !== "";
const LIVE_CHAIN_ID = LIVE_CHAIN_ID_RAW === undefined ? null : Number(LIVE_CHAIN_ID_RAW);

const describeLive = HAS_LIVE_CONFIG ? describe : describe.skip;

describeLive("live rpc pipeline", () => {
    let db: IsolatedDbContext | undefined;

    beforeAll(async () => {
        if (!HAS_LIVE_CONFIG) {
            return;
        }

        if (!Number.isSafeInteger(LIVE_CHAIN_ID) || (LIVE_CHAIN_ID ?? 0) <= 0) {
            throw new Error("VORYN_TEST_CHAIN_ID must be a positive safe integer");
        }

        db = await createIsolatedDbContext(DATABASE_URL);
    });

    afterAll(async () => {
        if (!HAS_LIVE_CONFIG) {
            return;
        }

        await db?.close();
    });

    test("fetches and commits one real block from rpc", async () => {
        if (LIVE_CHAIN_ID === null || LIVE_RPC_URL === undefined) {
            throw new Error("live-rpc configuration is missing");
        }
        if (db === undefined) {
            throw new Error("live-rpc database context was not initialized");
        }

        const chainId = LIVE_CHAIN_ID;
        const rpcUrl = LIVE_RPC_URL;

        const transactionManager = new PostgresTransactionManager(db.pool);
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const blocksRepository = new PostgresBlocksRepository(db.pool);
        const transactionsRepository = new PostgresTransactionsRepository(db.pool);
        const eventsRepository = new PostgresEventsRepository(db.pool);

        const source = await EthersBlockSource.create([new JsonRpcProvider(rpcUrl)]);

        const latest = await source.getLatestBlockNumber(chainId);
        const previous = await source.getBlockData(chainId, latest - 1);
        const expected = await source.getBlockData(chainId, latest);

        await chainCursorRepository.insert({
            chainId,
            lastEnqueuedBlock: latest - 1,
            lastCommittedBlock: latest - 1,
            lastCommittedHash: previous.block.hash,
        });
        await blockJobsRepository.enqueueRange(chainId, latest, latest);

        const fetchService = new FetchService(
            {
                chainId,
                delayBetweenTicksMs: 1,
                instanceId: "fetch-instance-live-rpc",
                fetchBatchSize: 1,
                fetchConcurrency: 1,
                fetchClaimTtlMs: 60_000,
                retryMaxAttempts: 3,
                retryBaseDelayMs: 10,
                retryMaxDelayMs: 100,
            },
            source,
            blockJobsRepository,
            blocksRepository,
            transactionsRepository,
            eventsRepository,
            transactionManager,
        );
        const sequencerService = new SequencerService(
            {
                chainId,
                delayBetweenTicksMs: 1,
                maxBlocksPerTick: 1,
            },
            source,
            chainCursorRepository,
            blocksRepository,
            transactionsRepository,
            eventsRepository,
            blockJobsRepository,
            transactionManager,
        );

        await fetchService.execute();
        await sequencerService.execute();

        const cursor = await chainCursorRepository.get(chainId);
        expect(cursor?.lastCommittedBlock).toBe(latest);
        expect(cursor?.lastCommittedHash).toBe(expected.block.hash);

        await expect(db.countRows(
            "block_jobs",
            `chain_id = ${String(chainId)} AND block_number = ${String(latest)} AND status = 'committed'`
        )).resolves.toBe(1);
        await expect(db.countRows(
            "blocks",
            `chain_id = ${String(chainId)} AND block_number = ${String(latest)}`
        )).resolves.toBe(1);
        await expect(db.countRows(
            "transactions",
            `chain_id = ${String(chainId)} AND block_number = ${String(latest)}`
        )).resolves.toBe(expected.transactions.length);
        await expect(db.countRows(
            "events",
            `chain_id = ${String(chainId)} AND block_number = ${String(latest)}`
        )).resolves.toBe(expected.logs.length);
    }, 30_000);
});
