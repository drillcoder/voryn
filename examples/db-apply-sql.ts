import { Pool } from "pg";
import { applySqlFileToPostgresDb, ConsoleLogger } from "@drillcoder/voryn";

(async () => {
    const pool = new Pool({ connectionString: "postgres://user:pass@localhost:5432/voryn" });
    const sqlFilePath = "src/sql/postgres-schema.sql";
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
