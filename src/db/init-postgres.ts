import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";

function getSchemaPath(): string {
    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFilePath);
    return path.resolve(currentDir, "..", "sql", "postgres-schema.sql");
}

export interface InitPostgresDbConfig {
    url: string;
    logger: Logger;
}

export async function initPostgresDb(config: InitPostgresDbConfig): Promise<void> {
    const schemaPath = getSchemaPath();
    const schemaSql = await readFile(schemaPath, "utf8");
    const pool = new Pool({ connectionString: config.url });
    const startedAt = Date.now();

    config.logger.info("db_init_started");

    try {
        await pool.query(schemaSql);
        config.logger.info("db_init_completed", { durationMs: Date.now() - startedAt });
    } catch (error) {
        config.logger.error("db_init_failed", {
            error: error instanceof Error ? error.message : "unknown error",
            durationMs: Date.now() - startedAt,
        });
        throw error;
    } finally {
        await pool.end();
    }
}
