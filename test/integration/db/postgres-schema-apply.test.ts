import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";
import { getRequiredDatabaseUrl } from "../helpers/test-db.js";

const execFileAsync = promisify(execFile);
const BASE_DATABASE_URL = getRequiredDatabaseUrl();

describe("integration postgres schema apply script", () => {
    test("db:apply-sql applies postgres schema to empty database", async () => {
        const db = await createEmptyDatabase(BASE_DATABASE_URL);

        try {
            await execFileAsync(
                "npm",
                ["run", "db:apply-sql", "--", "src/sql/postgres-schema.sql"],
                {
                    cwd: process.cwd(),
                    env: {
                        ...process.env,
                        DATABASE_URL: db.databaseUrl,
                    },
                },
            );

            const checkPool = new Pool({ connectionString: db.databaseUrl });
            try {
                await expect(hasTable(checkPool, "chain_cursor")).resolves.toBe(true);
                await expect(hasTable(checkPool, "block_jobs")).resolves.toBe(true);
                await expect(hasTable(checkPool, "raw_blocks")).resolves.toBe(true);
                await expect(hasTable(checkPool, "canonical_blocks")).resolves.toBe(true);
                await expect(hasTable(checkPool, "canonical_transactions")).resolves.toBe(true);
                await expect(hasTable(checkPool, "canonical_events")).resolves.toBe(true);
                await expect(hasTable(checkPool, "worker_cursors")).resolves.toBe(true);
            } finally {
                await checkPool.end();
            }
        } finally {
            await db.close();
        }
    }, 20_000);
});

async function hasTable(pool: Pool, tableName: string): Promise<boolean> {
    const result = await pool.query<{ exists: boolean }>(
        "SELECT to_regclass($1) IS NOT NULL AS exists",
        [`public.${tableName}`]
    );
    return result.rows[0]?.exists ?? false;
}

async function createEmptyDatabase(baseDatabaseUrlRaw: string): Promise<{
    databaseUrl: string;
    close: () => Promise<void>;
}> {
    const baseDatabaseUrl = new URL(baseDatabaseUrlRaw);
    const adminDatabaseUrl = new URL(baseDatabaseUrlRaw);
    adminDatabaseUrl.pathname = "/postgres";

    const databaseName = `voryn_test_db_schema_${String(Date.now())}_${randomBytes(4).toString("hex")}`;
    const adminPool = new Pool({ connectionString: adminDatabaseUrl.toString() });
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);

    baseDatabaseUrl.pathname = `/${databaseName}`;

    return {
        databaseUrl: baseDatabaseUrl.toString(),
        close: async () => {
            await adminPool.query(
                `SELECT pg_terminate_backend(pid)
                 FROM pg_stat_activity
                 WHERE datname = $1
                   AND pid <> pg_backend_pid()`,
                [databaseName]
            );
            await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
            await adminPool.end();
        },
    };
}

function quoteIdentifier(value: string): string {
    return `"${value.replaceAll("\"", "\"\"")}"`;
}
