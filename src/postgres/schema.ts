import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";

const REQUIRED_SCHEMA_TABLES = [
    "chain_cursor",
    "block_jobs",
    "raw_blocks",
    "canonical_blocks",
    "canonical_transactions",
    "canonical_events",
    "worker_cursors",
] as const;

export interface ApplySqlFileToPostgresDbConfig {
    pool: Pool;
    sqlFilePath: string;
    logger: Logger;
}

export interface ValidatePostgresSchemaConfig {
    pool: Pool;
    logger: Logger;
}

export async function applySqlFileToPostgresDb(config: ApplySqlFileToPostgresDbConfig): Promise<void> {
    const sql = await readFile(config.sqlFilePath, "utf8");
    const startedAt = Date.now();

    config.logger.info("db_sql_apply_started", { sqlFilePath: config.sqlFilePath });

    try {
        await config.pool.query(sql);
        config.logger.info("db_sql_apply_completed", {
            sqlFilePath: config.sqlFilePath,
            durationMs: Date.now() - startedAt,
        });
    } catch (error) {
        config.logger.error("db_sql_apply_failed", {
            sqlFilePath: config.sqlFilePath,
            error: error instanceof Error ? error.message : "unknown error",
            durationMs: Date.now() - startedAt,
        });
        throw error;
    }
}

export async function validatePostgresSchema(config: ValidatePostgresSchemaConfig): Promise<void> {
    const startedAt = Date.now();

    config.logger.info("db_schema_validation_started");

    try {
        const result = await config.pool.query<{ table_name: string }>(
            `SELECT table_name
             FROM information_schema.tables
             WHERE table_schema = 'public'
               AND table_name = ANY($1::text[])`,
            [REQUIRED_SCHEMA_TABLES]
        );

        const existingTables = new Set(result.rows.map((row) => row.table_name));
        const missingTables = REQUIRED_SCHEMA_TABLES.filter((tableName) => !existingTables.has(tableName));

        if (missingTables.length > 0) {
            throw new Error(`postgres schema is invalid, missing tables: ${missingTables.join(", ")}`);
        }

        config.logger.info("db_schema_validation_completed", { durationMs: Date.now() - startedAt });
    } catch (error) {
        config.logger.error("db_schema_validation_failed", {
            error: error instanceof Error ? error.message : "unknown error",
            durationMs: Date.now() - startedAt,
        });
        throw error;
    }
}
