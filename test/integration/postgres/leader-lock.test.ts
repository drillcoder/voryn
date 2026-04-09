import type { Pool } from "pg";
import { PostgresLeaderLock } from "../../../src/postgres/leader-lock.js";
import { createIsolatedDbContext, getRequiredDatabaseUrl } from "../helpers/test-db.js";
import type { IsolatedDbContext } from "../helpers/test-db.js";

const DATABASE_URL = getRequiredDatabaseUrl();

describe("integration postgres leader lock", () => {
    let db: IsolatedDbContext;

    beforeAll(async () => {
        db = await createIsolatedDbContext(DATABASE_URL);
    });

    afterAll(async () => {
        await db.close();
    });

    test("only one holder can acquire advisory lock key at a time", async () => {
        const pool = db.pool as unknown as Pool;
        const lockA = new PostgresLeaderLock(pool, 88_000_001n);
        const lockB = new PostgresLeaderLock(pool, 88_000_001n);

        await expect(lockA.tryAcquire()).resolves.toBe(true);
        await expect(lockB.tryAcquire()).resolves.toBe(false);

        await lockA.release();

        await expect(lockB.tryAcquire()).resolves.toBe(true);
        await lockB.release();
    });
});
