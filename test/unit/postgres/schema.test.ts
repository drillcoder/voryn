import type { Mock } from "vitest";
import { expect, test, vi } from "vitest";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applySqlFileToPostgresDb, validatePostgresSchema } from "../../../src/postgres/schema.js";

interface MockPool {
    query: Mock;
}

type LoggerMeta = Record<string, unknown> | undefined;
type LoggerMockMethod = Mock<(message: string, meta?: LoggerMeta) => unknown>;

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
    debug: vi.fn<(message: string, meta?: LoggerMeta) => unknown>(),
    info: vi.fn<(message: string, meta?: LoggerMeta) => unknown>(),
    warn: vi.fn<(message: string, meta?: LoggerMeta) => unknown>(),
    error: vi.fn<(message: string, meta?: LoggerMeta) => unknown>(),
});

const createValidSchemaFixture = (): SchemaFixture => ({
    tables: [
        "voryn_chain_cursor",
        "voryn_block_jobs",
        "voryn_blocks",
        "voryn_transactions",
        "voryn_events",
        "voryn_worker_cursors",
    ],
    columns: [
        column("voryn_chain_cursor", "chain_id", "integer", "NO", "int4"),
        column("voryn_chain_cursor", "last_enqueued_block", "bigint", "NO", "int8"),
        column("voryn_chain_cursor", "last_committed_block", "bigint", "NO", "int8"),
        column("voryn_chain_cursor", "last_committed_hash", "character varying", "NO", "varchar", 66),
        column("voryn_chain_cursor", "reorg_version", "bigint", "NO", "int8"),
        column("voryn_chain_cursor", "updated_at", "timestamp with time zone", "NO", "timestamptz"),
        column("voryn_block_jobs", "chain_id", "integer", "NO", "int4"),
        column("voryn_block_jobs", "block_number", "bigint", "NO", "int8"),
        column("voryn_block_jobs", "status", "text", "NO", "text"),
        column("voryn_block_jobs", "attempts", "integer", "NO", "int4"),
        column("voryn_block_jobs", "next_retry_at", "timestamp with time zone", "YES", "timestamptz"),
        column("voryn_block_jobs", "claimed_by", "text", "YES", "text"),
        column("voryn_block_jobs", "claimed_at", "timestamp with time zone", "YES", "timestamptz"),
        column("voryn_block_jobs", "error", "text", "YES", "text"),
        column("voryn_block_jobs", "updated_at", "timestamp with time zone", "NO", "timestamptz"),
        column("voryn_blocks", "chain_id", "integer", "NO", "int4"),
        column("voryn_blocks", "block_number", "bigint", "NO", "int8"),
        column("voryn_blocks", "block_hash", "character varying", "NO", "varchar", 66),
        column("voryn_blocks", "parent_hash", "character varying", "NO", "varchar", 66),
        column("voryn_blocks", "block_timestamp", "bigint", "NO", "int8"),
        column("voryn_blocks", "fetched_at", "timestamp with time zone", "NO", "timestamptz"),
        column("voryn_transactions", "chain_id", "integer", "NO", "int4"),
        column("voryn_transactions", "block_number", "bigint", "NO", "int8"),
        column("voryn_transactions", "block_hash", "character varying", "NO", "varchar", 66),
        column("voryn_transactions", "transaction_index", "integer", "NO", "int4"),
        column("voryn_transactions", "transaction_hash", "character varying", "NO", "varchar", 66),
        column("voryn_transactions", "from_address", "character varying", "NO", "varchar", 42),
        column("voryn_transactions", "to_address", "character varying", "YES", "varchar", 42),
        column("voryn_transactions", "value", "text", "NO", "text"),
        column("voryn_transactions", "data", "text", "NO", "text"),
        column("voryn_events", "chain_id", "integer", "NO", "int4"),
        column("voryn_events", "block_number", "bigint", "NO", "int8"),
        column("voryn_events", "block_hash", "character varying", "NO", "varchar", 66),
        column("voryn_events", "transaction_index", "integer", "NO", "int4"),
        column("voryn_events", "transaction_hash", "character varying", "NO", "varchar", 66),
        column("voryn_events", "log_index", "integer", "NO", "int4"),
        column("voryn_events", "address", "character varying", "NO", "varchar", 42),
        column("voryn_events", "topics", "ARRAY", "NO", "_text"),
        column("voryn_events", "data", "text", "NO", "text"),
        column("voryn_worker_cursors", "worker_name", "text", "NO", "text"),
        column("voryn_worker_cursors", "chain_id", "integer", "NO", "int4"),
        column("voryn_worker_cursors", "stream_type", "text", "NO", "text"),
        column("voryn_worker_cursors", "last_block_number", "bigint", "NO", "int8"),
        column("voryn_worker_cursors", "last_transaction_index", "integer", "NO", "int4"),
        column("voryn_worker_cursors", "last_log_index", "integer", "NO", "int4"),
        column("voryn_worker_cursors", "reorg_version", "bigint", "NO", "int8"),
        column("voryn_worker_cursors", "updated_at", "timestamp with time zone", "NO", "timestamptz"),
    ],
    primaryKeys: [
        { tableName: "voryn_chain_cursor", columnNames: ["chain_id"] },
        { tableName: "voryn_block_jobs", columnNames: ["chain_id", "block_number"] },
        { tableName: "voryn_blocks", columnNames: ["chain_id", "block_number"] },
        { tableName: "voryn_transactions", columnNames: ["chain_id", "block_number", "transaction_index"] },
        { tableName: "voryn_events", columnNames: ["chain_id", "block_number", "transaction_index", "log_index"] },
        { tableName: "voryn_worker_cursors", columnNames: ["worker_name", "chain_id", "stream_type"] },
    ],
    indexes: [
        {
            tableName: "voryn_block_jobs",
            indexName: "voryn_block_jobs_claim_idx",
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
    characterMaximumLength?: number,
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
        query: vi.fn()
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
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
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
        expect.objectContaining({ sqlFilePath }),
    );
    expect(logger.error).not.toHaveBeenCalled();
});

test("applySqlFileToPostgresDb logs and rethrows query error", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "voryn-schema-"));
    const sqlFilePath = join(tempDir, "schema.sql");
    await writeFile(sqlFilePath, "SELECT fail();\n", "utf8");

    const pool: MockPool = {
        query: vi.fn().mockRejectedValue(new Error("db down")),
    };
    const logger = createLogger();

    try {
        await expect(
            applySqlFileToPostgresDb({
                pool: pool as never,
                sqlFilePath,
                logger,
            }),
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
        }),
    );
});

test("applySqlFileToPostgresDb logs unknown query errors", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "voryn-schema-"));
    const sqlFilePath = join(tempDir, "schema.sql");
    await writeFile(sqlFilePath, "SELECT fail();\n", "utf8");

    const pool: MockPool = {
        query: vi.fn().mockRejectedValue("db down"),
    };
    const logger = createLogger();

    try {
        await expect(
            applySqlFileToPostgresDb({
                pool: pool as never,
                sqlFilePath,
                logger,
            }),
        ).rejects.toBe("db down");
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }

    expect(logger.error).toHaveBeenCalledWith(
        "db_sql_apply_failed",
        expect.objectContaining({
            sqlFilePath,
            error: "unknown error",
        }),
    );
});

test("validatePostgresSchema passes when required schema matches", async () => {
    const pool = createSchemaPool(createValidSchemaFixture());
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger }),
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
    fixture.tables = fixture.tables.filter((tableName) => tableName !== "voryn_block_jobs");
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger }),
    ).rejects.toThrow("postgres schema is invalid: missing table voryn_block_jobs");

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, validationFailedMeta] = logger.error.mock.calls[0] ?? [];
    expect(validationFailedMeta).toBeDefined();
    expect(typeof validationFailedMeta?.error).toBe("string");
    expect(String(validationFailedMeta?.error)).toContain("missing table voryn_block_jobs");
});

test("validatePostgresSchema throws when required column is missing", async () => {
    const fixture = createValidSchemaFixture();
    fixture.columns = fixture.columns.filter(
        (schemaColumn) => !(schemaColumn.tableName === "voryn_blocks" && schemaColumn.columnName === "parent_hash"),
    );
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger }),
    ).rejects.toThrow("missing column voryn_blocks.parent_hash");
});

test("validatePostgresSchema throws when table column metadata is missing", async () => {
    const fixture = createValidSchemaFixture();
    fixture.columns = fixture.columns.filter((schemaColumn) => schemaColumn.tableName !== "voryn_chain_cursor");
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger }),
    ).rejects.toThrow("missing column voryn_chain_cursor.chain_id");
});

test("validatePostgresSchema throws when column type does not match", async () => {
    const fixture = createValidSchemaFixture();
    const blockHashColumn = fixture.columns.find(
        (schemaColumn) => schemaColumn.tableName === "voryn_blocks" && schemaColumn.columnName === "block_hash",
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
        validatePostgresSchema({ pool: pool as never, logger }),
    ).rejects.toThrow("column voryn_blocks.block_hash type mismatch: expected character varying(66), got text");
});

test("validatePostgresSchema throws when column nullable does not match", async () => {
    const fixture = createValidSchemaFixture();
    const attemptsColumn = fixture.columns.find(
        (schemaColumn) => schemaColumn.tableName === "voryn_block_jobs" && schemaColumn.columnName === "attempts",
    );
    if (attemptsColumn === undefined) {
        throw new Error("test fixture is invalid");
    }
    attemptsColumn.isNullable = "YES";
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger }),
    ).rejects.toThrow("column voryn_block_jobs.attempts nullable mismatch: expected not nullable, got nullable");
});

test("validatePostgresSchema throws when primary key does not match", async () => {
    const fixture = createValidSchemaFixture();
    const blockJobsPrimaryKey = fixture.primaryKeys.find((primaryKey) => primaryKey.tableName === "voryn_block_jobs");
    if (blockJobsPrimaryKey === undefined) {
        throw new Error("test fixture is invalid");
    }
    blockJobsPrimaryKey.columnNames = ["block_number", "chain_id"];
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger }),
    ).rejects.toThrow(
        "primary key voryn_block_jobs mismatch: expected (chain_id, block_number), got (block_number, chain_id)",
    );
});

test("validatePostgresSchema throws when required index is missing", async () => {
    const fixture = createValidSchemaFixture();
    fixture.indexes = [];
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger }),
    ).rejects.toThrow(
        "index voryn_block_jobs_claim_idx mismatch: "
        + "expected voryn_block_jobs(chain_id, status, next_retry_at, block_number), got none",
    );
});

test("validatePostgresSchema throws when required index columns do not match", async () => {
    const fixture = createValidSchemaFixture();
    fixture.indexes[0] = {
        tableName: "voryn_block_jobs",
        indexName: "voryn_block_jobs_claim_idx",
        columnNames: ["chain_id", "status", "block_number"],
    };
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger }),
    ).rejects.toThrow(
        "index voryn_block_jobs_claim_idx mismatch: "
        + "expected voryn_block_jobs(chain_id, status, next_retry_at, block_number), "
        + "got voryn_block_jobs(chain_id, status, block_number)",
    );
});

test("validatePostgresSchema aggregates validation errors", async () => {
    const fixture = createValidSchemaFixture();
    fixture.tables = fixture.tables.filter((tableName) => tableName !== "voryn_events");
    fixture.columns = fixture.columns.filter(
        (schemaColumn) => !(schemaColumn.tableName === "voryn_blocks" && schemaColumn.columnName === "parent_hash"),
    );
    fixture.primaryKeys = fixture.primaryKeys.filter((primaryKey) => primaryKey.tableName !== "voryn_chain_cursor");
    fixture.indexes = [];
    const pool = createSchemaPool(fixture);
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger }),
    ).rejects.toThrow(
        "postgres schema is invalid: "
        + "primary key voryn_chain_cursor mismatch: expected (chain_id), got none; "
        + "missing column voryn_blocks.parent_hash; "
        + "missing table voryn_events; "
        + "index voryn_block_jobs_claim_idx mismatch: "
        + "expected voryn_block_jobs(chain_id, status, next_retry_at, block_number), got none",
    );
});

test("validatePostgresSchema logs unknown validation errors", async () => {
    const pool: MockPool = {
        query: vi.fn().mockRejectedValue("db down"),
    };
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger }),
    ).rejects.toBe("db down");

    expect(logger.error).toHaveBeenCalledWith(
        "db_schema_validation_failed",
        expect.objectContaining({ error: "unknown error" }),
    );
});
