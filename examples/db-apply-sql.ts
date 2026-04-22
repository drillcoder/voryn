import { Pool } from "pg";
import { ConsoleLogger, applySqlFileToPostgresDb } from "@drillcoder/voryn";

(async () => {
    const dbUrl = "postgres://user:pass@localhost:5432/voryn";
    const sqlFilePath = "src/sql/postgres-schema.sql";

    const pool = new Pool({ connectionString: dbUrl });
    const logger = new ConsoleLogger({ minLevel: "info" });

    try {
        await applySqlFileToPostgresDb({ pool, sqlFilePath, logger });
    } finally {
        await pool.end();
    }
})().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
