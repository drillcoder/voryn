import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import type { Logger } from "../interfaces/logger.js";

interface ExpectedColumn {
    dataType: string;
    isNullable: boolean;
    characterMaximumLength?: number;
    udtName?: string;
}

interface ExpectedTable {
    columns: Record<string, ExpectedColumn>;
    primaryKey: readonly string[];
}

interface ExpectedIndex {
    tableName: string;
    columns: readonly string[];
}

interface SchemaTableRow {
    table_name: string;
}

interface SchemaColumnRow {
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: "YES" | "NO";
    character_maximum_length: number | null;
    udt_name: string;
}

interface SchemaKeyRow {
    table_name: string;
    column_names: string;
}

interface SchemaIndexRow {
    table_name: string;
    index_name: string;
    column_names: string;
}

const EXPECTED_SCHEMA = {
    chain_cursor: {
        columns: {
            chain_id: { dataType: "integer", isNullable: false },
            last_enqueued_block: { dataType: "bigint", isNullable: false },
            last_committed_block: { dataType: "bigint", isNullable: false },
            last_committed_hash: {
                dataType: "character varying",
                isNullable: false,
                characterMaximumLength: 66,
            },
            updated_at: { dataType: "timestamp with time zone", isNullable: false },
        },
        primaryKey: ["chain_id"],
    },
    block_jobs: {
        columns: {
            chain_id: { dataType: "integer", isNullable: false },
            block_number: { dataType: "bigint", isNullable: false },
            status: { dataType: "text", isNullable: false },
            attempts: { dataType: "integer", isNullable: false },
            next_retry_at: { dataType: "timestamp with time zone", isNullable: true },
            claimed_by: { dataType: "text", isNullable: true },
            claimed_at: { dataType: "timestamp with time zone", isNullable: true },
            error: { dataType: "text", isNullable: true },
            updated_at: { dataType: "timestamp with time zone", isNullable: false },
        },
        primaryKey: ["chain_id", "block_number"],
    },
    blocks: {
        columns: {
            chain_id: { dataType: "integer", isNullable: false },
            block_number: { dataType: "bigint", isNullable: false },
            block_hash: {
                dataType: "character varying",
                isNullable: false,
                characterMaximumLength: 66,
            },
            parent_hash: {
                dataType: "character varying",
                isNullable: false,
                characterMaximumLength: 66,
            },
            block_timestamp: { dataType: "bigint", isNullable: false },
            fetched_at: { dataType: "timestamp with time zone", isNullable: false },
        },
        primaryKey: ["chain_id", "block_number"],
    },
    transactions: {
        columns: {
            chain_id: { dataType: "integer", isNullable: false },
            block_number: { dataType: "bigint", isNullable: false },
            block_hash: {
                dataType: "character varying",
                isNullable: false,
                characterMaximumLength: 66,
            },
            transaction_index: { dataType: "integer", isNullable: false },
            transaction_hash: {
                dataType: "character varying",
                isNullable: false,
                characterMaximumLength: 66,
            },
            from_address: {
                dataType: "character varying",
                isNullable: false,
                characterMaximumLength: 42,
            },
            to_address: {
                dataType: "character varying",
                isNullable: true,
                characterMaximumLength: 42,
            },
            value: { dataType: "text", isNullable: false },
            data: { dataType: "text", isNullable: false },
        },
        primaryKey: ["chain_id", "block_number", "transaction_index"],
    },
    events: {
        columns: {
            chain_id: { dataType: "integer", isNullable: false },
            block_number: { dataType: "bigint", isNullable: false },
            block_hash: {
                dataType: "character varying",
                isNullable: false,
                characterMaximumLength: 66,
            },
            transaction_index: { dataType: "integer", isNullable: false },
            transaction_hash: {
                dataType: "character varying",
                isNullable: false,
                characterMaximumLength: 66,
            },
            log_index: { dataType: "integer", isNullable: false },
            address: {
                dataType: "character varying",
                isNullable: false,
                characterMaximumLength: 42,
            },
            topics: { dataType: "ARRAY", isNullable: false, udtName: "_text" },
            data: { dataType: "text", isNullable: false },
        },
        primaryKey: ["chain_id", "block_number", "transaction_index", "log_index"],
    },
    worker_cursors: {
        columns: {
            worker_name: { dataType: "text", isNullable: false },
            chain_id: { dataType: "integer", isNullable: false },
            stream_type: { dataType: "text", isNullable: false },
            last_block_number: { dataType: "bigint", isNullable: false },
            last_transaction_index: { dataType: "integer", isNullable: false },
            last_log_index: { dataType: "integer", isNullable: true },
            updated_at: { dataType: "timestamp with time zone", isNullable: false },
        },
        primaryKey: ["worker_name", "chain_id", "stream_type"],
    },
} as const satisfies Record<string, ExpectedTable>;

const EXPECTED_INDEXES = {
    block_jobs_claim_idx: {
        tableName: "block_jobs",
        columns: ["chain_id", "status", "next_retry_at", "block_number"],
    },
} as const satisfies Record<string, ExpectedIndex>;

const REQUIRED_SCHEMA_TABLES = Object.keys(EXPECTED_SCHEMA);

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
        const tableResult = await config.pool.query<SchemaTableRow>(
            `SELECT table_name
             FROM information_schema.tables
             WHERE table_schema = 'public'
               AND table_name = ANY($1::text[])`,
            [REQUIRED_SCHEMA_TABLES]
        );
        const columnResult = await config.pool.query<SchemaColumnRow>(
            `SELECT
                 table_name,
                 column_name,
                 data_type,
                 is_nullable,
                 character_maximum_length,
                 udt_name
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = ANY($1::text[])`,
            [REQUIRED_SCHEMA_TABLES]
        );
        const primaryKeyResult = await config.pool.query<SchemaKeyRow>(
             `SELECT
                 table_class.relname AS table_name,
                 STRING_AGG(attribute.attname, ',' ORDER BY key_column.ordinality) AS column_names
             FROM pg_index index_info
             JOIN pg_class table_class ON table_class.oid = index_info.indrelid
             JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
             JOIN LATERAL UNNEST(index_info.indkey) WITH ORDINALITY AS key_column(attribute_number, ordinality)
                 ON TRUE
             JOIN pg_attribute attribute
                 ON attribute.attrelid = table_class.oid
                AND attribute.attnum = key_column.attribute_number
             WHERE table_namespace.nspname = 'public'
               AND table_class.relname = ANY($1::text[])
               AND index_info.indisprimary
             GROUP BY table_class.relname`,
            [REQUIRED_SCHEMA_TABLES]
        );
        const indexResult = await config.pool.query<SchemaIndexRow>(
             `SELECT
                 table_class.relname AS table_name,
                 index_class.relname AS index_name,
                 STRING_AGG(attribute.attname, ',' ORDER BY key_column.ordinality) AS column_names
             FROM pg_index index_info
             JOIN pg_class table_class ON table_class.oid = index_info.indrelid
             JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
             JOIN pg_class index_class ON index_class.oid = index_info.indexrelid
             JOIN LATERAL UNNEST(index_info.indkey) WITH ORDINALITY AS key_column(attribute_number, ordinality)
                 ON TRUE
             JOIN pg_attribute attribute
                 ON attribute.attrelid = table_class.oid
                AND attribute.attnum = key_column.attribute_number
             WHERE table_namespace.nspname = 'public'
               AND index_class.relname = ANY($1::text[])
             GROUP BY table_class.relname, index_class.relname`,
            [Object.keys(EXPECTED_INDEXES)]
        );

        const errors = collectSchemaValidationErrors(
            tableResult.rows,
            columnResult.rows,
            primaryKeyResult.rows,
            indexResult.rows
        );

        if (errors.length > 0) {
            throw new Error(`postgres schema is invalid: ${errors.join("; ")}`);
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

function collectSchemaValidationErrors(
    tableRows: readonly SchemaTableRow[],
    columnRows: readonly SchemaColumnRow[],
    primaryKeyRows: readonly SchemaKeyRow[],
    indexRows: readonly SchemaIndexRow[]
): string[] {
    const errors: string[] = [];
    const existingTables = new Set(tableRows.map((row) => row.table_name));
    const columnsByTable = groupColumnsByTable(columnRows);
    const primaryKeysByTable = new Map(
        primaryKeyRows.map((row) => [row.table_name, parseColumnNames(row.column_names)])
    );
    const indexesByName = new Map(
        indexRows.map((row) => [
            row.index_name,
            {
                tableName: row.table_name,
                columnNames: parseColumnNames(row.column_names),
            },
        ])
    );

    for (const [tableName, expectedTable] of Object.entries(EXPECTED_SCHEMA)) {
        if (!existingTables.has(tableName)) {
            errors.push(`missing table ${tableName}`);
            continue;
        }

        const existingColumns = columnsByTable.get(tableName) ?? new Map<string, SchemaColumnRow>();
        errors.push(...validateColumns(tableName, expectedTable.columns, existingColumns));
        errors.push(...validatePrimaryKey(tableName, expectedTable.primaryKey, primaryKeysByTable.get(tableName)));
    }

    for (const [indexName, expectedIndex] of Object.entries(EXPECTED_INDEXES)) {
        errors.push(...validateIndex(indexName, expectedIndex, indexesByName.get(indexName)));
    }

    return errors;
}

function groupColumnsByTable(columnRows: readonly SchemaColumnRow[]): Map<string, Map<string, SchemaColumnRow>> {
    const columnsByTable = new Map<string, Map<string, SchemaColumnRow>>();

    for (const row of columnRows) {
        let tableColumns = columnsByTable.get(row.table_name);
        if (tableColumns === undefined) {
            tableColumns = new Map<string, SchemaColumnRow>();
            columnsByTable.set(row.table_name, tableColumns);
        }
        tableColumns.set(row.column_name, row);
    }

    return columnsByTable;
}

function validateColumns(
    tableName: string,
    expectedColumns: Record<string, ExpectedColumn>,
    existingColumns: ReadonlyMap<string, SchemaColumnRow>
): string[] {
    const errors: string[] = [];

    for (const [columnName, expectedColumn] of Object.entries(expectedColumns)) {
        const existingColumn = existingColumns.get(columnName);
        if (existingColumn === undefined) {
            errors.push(`missing column ${tableName}.${columnName}`);
            continue;
        }

        const expectedType = formatColumnType(expectedColumn);
        const actualType = formatColumnType({
            dataType: existingColumn.data_type,
            characterMaximumLength: existingColumn.character_maximum_length ?? undefined,
            udtName: existingColumn.udt_name,
        });

        if (actualType !== expectedType) {
            errors.push(`column ${tableName}.${columnName} type mismatch: expected ${expectedType}, got ${actualType}`);
        }

        const actualIsNullable = existingColumn.is_nullable === "YES";
        if (actualIsNullable !== expectedColumn.isNullable) {
            errors.push(
                `column ${tableName}.${columnName} nullable mismatch: `
                + `expected ${formatNullable(expectedColumn.isNullable)}, got ${formatNullable(actualIsNullable)}`
            );
        }
    }

    return errors;
}

function validatePrimaryKey(
    tableName: string,
    expectedColumns: readonly string[],
    actualColumns: readonly string[] | undefined
): string[] {
    if (actualColumns === undefined) {
        return [`primary key ${tableName} mismatch: expected ${formatColumnList(expectedColumns)}, got none`];
    }

    if (!areColumnListsEqual(actualColumns, expectedColumns)) {
        return [
            `primary key ${tableName} mismatch: `
            + `expected ${formatColumnList(expectedColumns)}, got ${formatColumnList(actualColumns)}`,
        ];
    }

    return [];
}

function validateIndex(
    indexName: string,
    expectedIndex: ExpectedIndex,
    actualIndex: { tableName: string; columnNames: readonly string[] } | undefined
): string[] {
    if (actualIndex === undefined) {
        return [
            `index ${indexName} mismatch: `
            + `expected ${expectedIndex.tableName}${formatColumnList(expectedIndex.columns)}, got none`,
        ];
    }

    if (
        actualIndex.tableName !== expectedIndex.tableName
        || !areColumnListsEqual(actualIndex.columnNames, expectedIndex.columns)
    ) {
        return [
            `index ${indexName} mismatch: `
            + `expected ${expectedIndex.tableName}${formatColumnList(expectedIndex.columns)}, `
            + `got ${actualIndex.tableName}${formatColumnList(actualIndex.columnNames)}`,
        ];
    }

    return [];
}

function parseColumnNames(columnNames: string): string[] {
    return columnNames.split(",");
}

function areColumnListsEqual(actualColumns: readonly string[], expectedColumns: readonly string[]): boolean {
    return (
        actualColumns.length === expectedColumns.length
        && actualColumns.every((columnName, index) => columnName === expectedColumns[index])
    );
}

function formatColumnType(column: Omit<ExpectedColumn, "isNullable">): string {
    if (column.dataType === "character varying" && column.characterMaximumLength !== undefined) {
        return `character varying(${String(column.characterMaximumLength)})`;
    }
    if (column.dataType === "ARRAY" && column.udtName === "_text") {
        return "text[]";
    }

    return column.dataType;
}

function formatNullable(isNullable: boolean): string {
    return isNullable ? "nullable" : "not nullable";
}

function formatColumnList(columns: readonly string[]): string {
    return `(${columns.join(", ")})`;
}
