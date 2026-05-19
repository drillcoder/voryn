import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Logger } from "../../../src/interfaces/logger.js";
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

const createLogger = (): MockLogger => ({
    debug: jest.fn<unknown, [string, LoggerMeta?]>(),
    info: jest.fn<unknown, [string, LoggerMeta?]>(),
    warn: jest.fn<unknown, [string, LoggerMeta?]>(),
    error: jest.fn<unknown, [string, LoggerMeta?]>(),
});

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
            logger: logger as Logger,
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
                logger: logger as Logger,
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
                logger: logger as Logger,
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

test("validatePostgresSchema passes when all required tables exist", async () => {
    const pool: MockPool = {
        query: jest.fn().mockResolvedValue({
            rows: [
                { table_name: "chain_cursor" },
                { table_name: "block_jobs" },
                { table_name: "blocks" },
                { table_name: "transactions" },
                { table_name: "events" },
                { table_name: "worker_cursors" },
            ],
            rowCount: 6,
        }),
    };
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger: logger as Logger })
    ).resolves.toBeUndefined();

    expect(logger.info).toHaveBeenCalledWith("db_schema_validation_started");
    const completedCall = logger.info.mock.calls.find((call) => call[0] === "db_schema_validation_completed");
    expect(completedCall).toBeDefined();
    const completedMeta = completedCall?.[1];
    expect(completedMeta).toBeDefined();
    expect(typeof completedMeta?.durationMs).toBe("number");
    expect(logger.error).not.toHaveBeenCalled();
});

test("validatePostgresSchema throws when required table is missing", async () => {
    const pool: MockPool = {
        query: jest.fn().mockResolvedValue({
            rows: [{ table_name: "chain_cursor" }],
            rowCount: 1,
        }),
    };
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger: logger as Logger })
    ).rejects.toThrow(/missing tables/);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, validationFailedMeta] = logger.error.mock.calls[0] ?? [];
    expect(validationFailedMeta).toBeDefined();
    expect(typeof validationFailedMeta?.error).toBe("string");
    expect(String(validationFailedMeta?.error)).toContain("missing tables");
});

test("validatePostgresSchema logs unknown validation errors", async () => {
    const pool: MockPool = {
        query: jest.fn().mockRejectedValue("db down"),
    };
    const logger = createLogger();

    await expect(
        validatePostgresSchema({ pool: pool as never, logger: logger as Logger })
    ).rejects.toBe("db down");

    expect(logger.error).toHaveBeenCalledWith(
        "db_schema_validation_failed",
        expect.objectContaining({ error: "unknown error" })
    );
});
