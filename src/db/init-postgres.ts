import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

function getSchemaPath(): string {
    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFilePath);
    return path.resolve(currentDir, "..", "sql", "postgres-schema.sql");
}

export interface InitPostgresDbConfig {
    url: string;
}

export async function initPostgresDb(config: InitPostgresDbConfig): Promise<void> {
    const { url } = config;
    const schemaPath = getSchemaPath();
    const schemaSql = await readFile(schemaPath, "utf8");
    const pool = new Pool({ connectionString: url });

    try {
        await pool.query(schemaSql);
    } finally {
        await pool.end();
    }
}
