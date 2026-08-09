import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applySqlFileToPostgresDb, validatePostgresSchema } from "../../../src/postgres/schema.js";

interface MockPool {
    query: jest.Mock;
}

type LoggerMeta = Record<string, unknown> | undefined;
type LoggerMockMethod = jest.Mock<unknown, [string, LoggerMeta?]>;

interface MockLogger {
    debug: LoggerMockMethod;
    info: LoggerMockMethod;
    warn: LoggerMockMethod;
    error: LoggerMockMethod;
}

interface SchemaColumnFixture {
    tableName: string;
    columnName: string;
    dataType: string;
    isNullable: "YES" | "NO";
    characterMaximumLength?: number;
    udtName: string;
}

interface SchemaFixture {
    tables: string[];
    columns: SchemaColumnFixture[];
    primaryKeys: Array<{ tableName: string; columnNames: string[] }>;
    indexes: Array<{ tableName: string; indexName: string; columnNames: string[] }>;
}

const createLogger = (): MockLogger => ({
    debug: jest.fn<unknown, [string, LoggerMeta?]>(),
    info: jest.fn<unknown, [string, LoggerMeta?]>(),
    warn: jest.fn<unknown, [string, LoggerMeta?]>(),
    error: jest.fn<unknown, [string, LoggerMeta?]>(),
});

const createValidSchemaFixture = (): SchemaFixture => ({
    tables: [
        "chain_cursor",
        "block_jobs",
        "blocks",
        "transactions",
        "events",
        "worker_cursors",
    ],
    columns: [
        column("chain_cursor", "chain_id", "integer", "NO", "int4"),
        column("chain_cursor", "last_enqueued_block", "bigint", "NO", "int8"),
        column("chain_cursor", "last_committed_block", "bigint", "NO", "int8"),
        column("chain_cursor", "last_committed_hash", "character varying", "NO", "varchar", 66),
        column("chain_cursor", "updated_at", "timestamp with time zone", "NO", "timestamptz"),
        column("block_jobs", "chain_id", "integer", "NO", "int4"),
        column("block_jobs", "block_number", "bigint", "NO", "int8"),
        column("block_jobs", "status", "text", "NO", "text"),
        column("block_jobs", "attempts", "integer", "NO", "int4"),
        column("block_jobs", "next_retry_at", "timestamp with time zone", "YES", "timestamptz"),
        column("block_jobs", "claimed_by", "text", "YES", "text"),
        column("block_jobs", "claimed_at", "timestamp with time zone", "YES", "timestamptz"),
        column("block_jobs", "error", "text", "YES", "text"),
        column("block_jobs", "updated_at", "timestamp with time zone", "NO", "timestamptz"),
        column("blocks", "chain_id", "integer", "NO", "int4"),
        column("blocks", "block_number", "bigint", "NO", "int8"),
        column("blocks", "block_hash", "character varying", "NO", "varchar", 66),
        column("blocks", "parent_hash", "character varying", "NO", "varchar", 66),
        column("blocks", "block_timestamp", "bigint", "NO", "int8"),
        column("blocks", "fetched_at", "timestamp with time zone", "NO", "timestamptz"),
        column("transactions", "chain_id", "integer", "NO", "int4"),
        column("transactions", "block_number", "bigint", "NO", "int8"),
        column("transactions", "block_hash", "character varying", "NO", "varchar", 66),
        column("transactions", "transaction_index", "integer", "NO", "int4"),
        column("transactions", "transaction_hash", "character varying", "NO", "varchar", 66),
        column("transactions", "from_address", "character varying", "NO", "varchar", 42),
        column("transactions", "to_address", "character varying", "YES", "varchar", 42),
        column("transactions", "value", "text", "NO", "text"),
        column("transactions", "data", "text", "NO", "text"),
        column("events", "chain_id", "integer", "NO", "int4"),
        column("events", "block_number", "bigint", "NO", "int8"),
        column("events", "block_hash", "character varying", "NO", "varchar", 66),
        column("events", "transaction_index", "integer", "NO", "int4"),
        column("events", "transaction_hash", "character varying", "NO", "varchar", 66),
        column("events", "log_index", "integer", "NO", "int4"),
        column("events", "address", "character varying", "NO", "varchar", 42),
        column("events", "topics", "ARRAY", "NO", "_text"),
        column("events", "data", "text", "NO", "text"),
        column("worker_cursors", "worker_name", "text", "NO", "text"),
        column("worker_cursors", "chain_id", "integer", "NO", "int4"),
        column("worker_cursors", "stream_type", "text", "NO", "text"),
        column("worker_cursors", "last_block_number", "bigint", "NO", "int8"),
        column("worker_cursors", "last_transaction_index", "integer", "NO", "int4"),
        column("worker_cursors", "last_log_index", "integer", "YES", "int4"),
        column("worker_cursors", "updated_at", "timestamp with time zone", "NO", "timestamptz"),
    ],
    primaryKeys: [
        { tableName: "chain_cursor", columnNames: ["chain_id"] },
        { tableName: "block_jobs", columnNames: ["chain_id", "block_number"] },
        { tableName: "blocks", columnNames: ["chain_id", "block_number"] },
        { tableName: "transactions", columnNames: ["chain_id", "block_number", "transaction_index"] },
        { tableName: "events", columnNames: ["chain_id", "block_number", "transaction_index", "log_index"] },
        { tableName: "worker_cursors", columnNames: ["worker_name", "chain_id", "stream_type"] },
    ],
    indexes: [
        {
            tableName: "block_jobs",
            indexName: "block_jobs_claim_idx",
            columnNames: ["chain_id", "status", "next_retry_at", "block_number"],
        },
    ],
});

function column(
    tableName: string,
    columnName: string,
    dataType: string,
    isNullable: "YES" | "NO",
    udtName: string,
    characterMaximumLength?: number
): SchemaColumnFixture {
    return {
        tableName,
        columnName,
        dataType,
        isNullable,
        characterMaximumLength,
        udtName,
    };
}

function createSchemaPool(fixture: SchemaFixture): MockPool {
    return {
        query: jest.fn()
            .mockResolvedValueOnce({
                rows: fixture.tables.map((tableName) => ({ table_name: tableName })),
                rowCount: fixture.tables.length,
            })
            .mockResolvedValueOnce({
                rows: fixture.columns.map((schemaColumn) => ({
                    table_name: schemaColumn.tableName,
                    column_name: schemaColumn.columnName,
                    data_type: schemaColumn.dataType,
                    is_nullable: schemaColumn.isNullable,
                    character_maximum_length: schemaColumn.characterMaximumLength ?? null,
                    udt_name: schemaColumn.udtName,
                })),
                rowCount: fixture.columns.length,
            })
            .mockResolvedValueOnce({
                rows: fixture.primaryKeys.map((primaryKey) => ({
                    table_name: primaryKey.tableName,
                    column_names: primaryKey.columnNames.join(","),
                })),
                rowCount: fixture.primaryKeys.length,
            })
            .mockResolvedValueOnce({
                rows: fixture.indexes.map((index) => ({
                    table_name: index.tableName,
                    index_name: index.indexName,
                    column_names: index.columnNames.join(","),
                })),
                rowCount: fixture.indexes.length,
            }),
    };
}

test("applySqlFileToPostgresDb executes sql from file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "voryn-schema-"));
    const sqlFilePath = join(tempDir, "schema.sql");
    await writeFile(sqlFilePath, "SELECT 1;\n", "utf8");

    const pool: MockPool = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    };
    const logger = createLogger();

    try {
        await applySqlFileToPostgresDb({
            pool: pool as never,
            sqlFilePath,
            logger,
        });
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith("SELECT 1;\n");
    expect(logger.info).toHaveBeenCalledWith("db_sql_apply_started", { sqlFilePath });
    expect(logger.info).toHaveBeenCalledWith(
        "db_sql_apply_completed",
        expect.objectContaining({ sqlFilePath })
    );
    expect(logger.error).not.toHaveBeenCalled();
});

test("applySqlFileToPostgresDb logs and rethrows query error", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "voryn-schema-"));
    const sqlFilePath = join(tempDir, "schema.sql");
    await writeFile(sqlFilePath, "SELECT fail();\n", "utf8");

    const pool: MockPool = {
        query: jest.fn().mockRejectedValue(new Error("db down")),
    };
    const logger = createLogger();

    try {
        await expect(
            applySqlFileToPostgresDb({
                pool: pool as never,
                sqlFilePath,
                logger,
            })
        ).rejects.toThrow("db down");
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, failedMeta] = logger.error.mock.calls[0] ?? [];
    expect(failedMeta).toEqual(
        expect.objectContaining({
            sqlFilePath,
            error: "db down",
        })
    );
});

test("applySqlFileToPostgresDb logs unknown query errors", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "voryn-schema-"));
    const sqlFilePath = join(tempDir, "schema.sql");
    await writeFile(sqlFilePath, "SELECT fail();\n", "utf8");

    const pool: MockPool = {
        query: jest.fn().mockRejectedValue("db down"),
    };
    const logger = createLogger();

    try {
        await expect(
            applySqlFileToPostgresDb({
                pool: pool as never,
                sqlFilePath,
                logger,
            })
        ).rejects.toBe("db down");
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }

    expect(logger.error).toHaveBeenCalledWith(
        "db_sql_apply_failed",
        expect.objectContaining({
            sqlFilePath,
            error: "unknown error",
        })
    );
});

test("validatePostgresSchema passes when required schema matches", async () => {
    const pool = createSchemaPool(createValidSchemaFixture());
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger })
    ).resolves.toBeUndefined();

    expect(pool.query).toHaveBeenCalledTimes(4);
    expect(logger.info).toHaveBeenCalledWith("db_schema_validation_started");
    const completedCall = logger.info.mock.calls.find((call) => call[0] === "db_schema_validation_completed");
    expect(completedCall).toBeDefined();
    const completedMeta = completedCall?.[1];
    expect(completedMeta).toBeDefined();
    expect(typeof completedMeta?.durationMs).toBe("number");
    expect(logger.error).not.toHaveBeenCalled();
});

test("validatePostgresSchema throws when required table is missing", async () => {
    const fixture = createValidSchemaFixture();
    fixture.tables = fixture.tables.filter((tableName) => tableName !== "block_jobs");
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger })
    ).rejects.toThrow("postgres schema is invalid: missing table block_jobs");

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, validationFailedMeta] = logger.error.mock.calls[0] ?? [];
    expect(validationFailedMeta).toBeDefined();
    expect(typeof validationFailedMeta?.error).toBe("string");
    expect(String(validationFailedMeta?.error)).toContain("missing table block_jobs");
});

test("validatePostgresSchema throws when required column is missing", async () => {
    const fixture = createValidSchemaFixture();
    fixture.columns = fixture.columns.filter(
        (schemaColumn) => !(schemaColumn.tableName === "blocks" && schemaColumn.columnName === "parent_hash")
    );
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger })
    ).rejects.toThrow("missing column blocks.parent_hash");
});

test("validatePostgresSchema throws when table column metadata is missing", async () => {
    const fixture = createValidSchemaFixture();
    fixture.columns = fixture.columns.filter((schemaColumn) => schemaColumn.tableName !== "chain_cursor");
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger })
    ).rejects.toThrow("missing column chain_cursor.chain_id");
});

test("validatePostgresSchema throws when column type does not match", async () => {
    const fixture = createValidSchemaFixture();
    const blockHashColumn = fixture.columns.find(
        (schemaColumn) => schemaColumn.tableName === "blocks" && schemaColumn.columnName === "block_hash"
    );
    if (blockHashColumn === undefined) {
        throw new Error("test fixture is invalid");
    }
    blockHashColumn.dataType = "text";
    blockHashColumn.udtName = "text";
    blockHashColumn.characterMaximumLength = undefined;
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger })
    ).rejects.toThrow("column blocks.block_hash type mismatch: expected character varying(66), got text");
});

test("validatePostgresSchema throws when column nullable does not match", async () => {
    const fixture = createValidSchemaFixture();
    const attemptsColumn = fixture.columns.find(
        (schemaColumn) => schemaColumn.tableName === "block_jobs" && schemaColumn.columnName === "attempts"
    );
    if (attemptsColumn === undefined) {
        throw new Error("test fixture is invalid");
    }
    attemptsColumn.isNullable = "YES";
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger })
    ).rejects.toThrow("column block_jobs.attempts nullable mismatch: expected not nullable, got nullable");
});

test("validatePostgresSchema throws when primary key does not match", async () => {
    const fixture = createValidSchemaFixture();
    const blockJobsPrimaryKey = fixture.primaryKeys.find((primaryKey) => primaryKey.tableName === "block_jobs");
    if (blockJobsPrimaryKey === undefined) {
        throw new Error("test fixture is invalid");
    }
    blockJobsPrimaryKey.columnNames = ["block_number", "chain_id"];
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger })
    ).rejects.toThrow(
        "primary key block_jobs mismatch: expected (chain_id, block_number), got (block_number, chain_id)"
    );
});

test("validatePostgresSchema throws when required index is missing", async () => {
    const fixture = createValidSchemaFixture();
    fixture.indexes = [];
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger })
    ).rejects.toThrow(
        "index block_jobs_claim_idx mismatch: "
        + "expected block_jobs(chain_id, status, next_retry_at, block_number), got none"
    );
});

test("validatePostgresSchema throws when required index columns do not match", async () => {
    const fixture = createValidSchemaFixture();
    fixture.indexes[0] = {
        tableName: "block_jobs",
        indexName: "block_jobs_claim_idx",
        columnNames: ["chain_id", "status", "block_number"],
    };
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger })
    ).rejects.toThrow(
        "index block_jobs_claim_idx mismatch: "
        + "expected block_jobs(chain_id, status, next_retry_at, block_number), "
        + "got block_jobs(chain_id, status, block_number)"
    );
});

test("validatePostgresSchema aggregates validation errors", async () => {
    const fixture = createValidSchemaFixture();
    fixture.tables = fixture.tables.filter((tableName) => tableName !== "events");
    fixture.columns = fixture.columns.filter(
        (schemaColumn) => !(schemaColumn.tableName === "blocks" && schemaColumn.columnName === "parent_hash")
    );
    fixture.primaryKeys = fixture.primaryKeys.filter((primaryKey) => primaryKey.tableName !== "chain_cursor");
    fixture.indexes = [];
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger })
    ).rejects.toThrow(
        "postgres schema is invalid: "
        + "primary key chain_cursor mismatch: expected (chain_id), got none; "
        + "missing column blocks.parent_hash; "
        + "missing table events; "
        + "index block_jobs_claim_idx mismatch: "
        + "expected block_jobs(chain_id, status, next_retry_at, block_number), got none"
    );
});

test("validatePostgresSchema logs unknown validation errors", async () => {
    const pool: MockPool = {
        query: jest.fn().mockRejectedValue("db down"),
    };
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger })
    ).rejects.toBe("db down");

    expect(logger.error).toHaveBeenCalledWith(
        "db_schema_validation_failed",
        expect.objectContaining({ error: "unknown error" })
    );
});
