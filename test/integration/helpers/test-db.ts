import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const PIPELINE_TABLES = [
    "canonical_events",
    "canonical_transactions",
    "canonical_blocks",
    "raw_blocks",
    "block_jobs",
    "chain_cursor",
    "worker_cursors",
] as const;

type PipelineTableName = (typeof PIPELINE_TABLES)[number];

export interface IsolatedDbContext {
    pool: Pool;
    truncatePipelineTables: () => Promise<void>;
    countRows: (tableName: PipelineTableName, where?: string) => Promise<number>;
    close: () => Promise<void>;
}

export function getRequiredDatabaseUrl(): string {
    const value = process.env.DATABASE_URL;
    if (value === undefined || value === "") {
        throw new Error("DATABASE_URL is required for integration tests");
    }

    return value;
}

export async function createIsolatedDbContext(databaseUrlRaw: string): Promise<IsolatedDbContext> {
    const databaseUrl = new URL(databaseUrlRaw);
    const adminDatabaseUrl = new URL(databaseUrlRaw);
    adminDatabaseUrl.pathname = "/postgres";

    const testDatabaseName = "voryn_test_"
        + String(Date.now())
        + "_"
        + randomBytes(4).toString("hex");

    const adminPool = new Pool({ connectionString: adminDatabaseUrl.toString() });
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(testDatabaseName)}`);

    databaseUrl.pathname = `/${testDatabaseName}`;
    const pool = new Pool({ connectionString: databaseUrl.toString() });
    pool.on("error", (error: Error) => {
        if (!isPostgresTerminationError(error)) {
            throw error;
        }
    });

    const schemaSql = await readFile("src/sql/postgres-schema.sql", "utf8");
    await pool.query(schemaSql);

    return {
        pool,
        truncatePipelineTables: async () => {
            await pool.query(
                `TRUNCATE TABLE
                    canonical_events,
                    canonical_transactions,
                    canonical_blocks,
                    raw_blocks,
                    block_jobs,
                    chain_cursor,
                    worker_cursors
                 RESTART IDENTITY`
            );
        },
        countRows: async (tableName, where) => {
            const whereClause = where === undefined ? "" : ` WHERE ${where}`;
            const result = await pool.query<{ count: string }>(
                `SELECT COUNT(*)::TEXT AS count FROM ${tableName}${whereClause}`
            );
            return Number(result.rows[0]?.count ?? "0");
        },
        close: async () => {
            await pool.end();
            await adminPool.query(
                `SELECT pg_terminate_backend(pid)
                 FROM pg_stat_activity
                 WHERE datname = $1
                   AND pid <> pg_backend_pid()`,
                [testDatabaseName]
            );
            await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(testDatabaseName)}`);
            await adminPool.end();
        },
    };
}

function quoteIdentifier(value: string): string {
    return `"${value.replaceAll("\"", "\"\"")}"`;
}

function isPostgresTerminationError(error: Error): boolean {
    return "code" in error && error.code === "57P01";
}
