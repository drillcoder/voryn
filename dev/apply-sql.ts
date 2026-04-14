import path from "node:path";
import { Pool } from "pg";
import { applySqlFileToPostgresDb, ConsoleLogger } from "../src/index.js";

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value || value.trim() === "") {
        throw new Error(`environment variable ${name} is required`);
    }

    return value;
}

function requireSqlFileArg(): string {
    const sqlFileArg = process.argv[2];
    if (!sqlFileArg || sqlFileArg.trim() === "") {
        throw new Error("sql file path argument is required");
    }

    return path.resolve(process.cwd(), sqlFileArg);
}

async function run(): Promise<void> {
    const logger = new ConsoleLogger({ minLevel: "info" });
    const dbUrl = requireEnv("DATABASE_URL");
    const sqlFilePath = requireSqlFileArg();
    const pool = new Pool({ connectionString: dbUrl });

    try {
        await applySqlFileToPostgresDb({ pool, sqlFilePath, logger });
    } finally {
        await pool.end();
    }
}

run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`apply-sql failed: ${message}`);
    process.exitCode = 1;
});
