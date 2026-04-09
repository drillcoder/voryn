import { PostgresTransactionManager } from "../../../src/postgres/transaction-manager.js";
import { PostgresBlockJobsRepository } from "../../../src/repositories/postgres/block-jobs-repository.js";
import { PostgresCanonicalBlocksRepository } from "../../../src/repositories/postgres/canonical-blocks-repository.js";
import { PostgresChainCursorRepository } from "../../../src/repositories/postgres/chain-cursor-repository.js";
import { PostgresRawBlocksRepository } from "../../../src/repositories/postgres/raw-blocks-repository.js";
import { buildFetchedBlock, CHAIN_ID, hashFromNumber } from "../helpers/fixtures.js";
import type { IsolatedDbContext } from "../helpers/test-db.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../helpers/test-db.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("integration transaction manager", () => {
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

    test("transaction manager rolls back a multi-table operation atomically", async () => {
        const transactionManager = new PostgresTransactionManager(db.pool);
        const chainCursorRepository = new PostgresChainCursorRepository(db.pool);
        const blockJobsRepository = new PostgresBlockJobsRepository(db.pool);
        const rawBlocksRepository = new PostgresRawBlocksRepository(db.pool);
        const canonicalBlocksRepository = new PostgresCanonicalBlocksRepository(db.pool);
        const payload = buildFetchedBlock(600, hashFromNumber(599));

        await expect(
            transactionManager.run(async (transaction) => {
                await chainCursorRepository.insert({
                    chainId: CHAIN_ID,
                    lastEnqueuedBlock: 600,
                    lastCommittedBlock: 599,
                    lastCommittedHash: hashFromNumber(599),
                }, transaction);
                await blockJobsRepository.enqueueRange(CHAIN_ID, 600, 600, transaction);
                await rawBlocksRepository.save({
                    chainId: CHAIN_ID,
                    blockNumber: 600,
                    blockHash: payload.block.hash,
                    parentHash: payload.block.parentHash,
                    payload,
                    fetchedAt: new Date(),
                }, transaction);
                await canonicalBlocksRepository.insert(payload.block, transaction);
                throw new Error("force rollback");
            })
        ).rejects.toThrow("force rollback");

        await expect(db.countRows("chain_cursor")).resolves.toBe(0);
        await expect(db.countRows("block_jobs")).resolves.toBe(0);
        await expect(db.countRows("raw_blocks")).resolves.toBe(0);
        await expect(db.countRows("canonical_blocks")).resolves.toBe(0);
    });
});
