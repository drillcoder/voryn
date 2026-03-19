import { asAddress, asHash32, asHexData } from "../../utils/hex.js";
import { isObjectRecord, toSafeInt } from "../../utils/parsing.js";
import { withTransaction } from "./client.js";
import type { SequencerCommitStore } from "../../interfaces/stores.js";
import type {
    BlockNumber,
    ChainBlock,
    ChainId,
    ChainLog,
    ChainTransaction,
    FetchedBlock,
    HashHex,
} from "../../types/chain.js";
import type { PgPool, PgQueryExecutor } from "./client.js";

interface CursorRow {
    last_committed_hash: string;
}

interface CursorState {
    lastCommittedHash: HashHex;
}

interface RawBlockRow {
    block_hash: string;
    parent_hash: string;
    payload: unknown;
}

interface RawBlockData {
    blockHash: HashHex;
    parentHash: HashHex;
    payload: FetchedBlock;
}

export class PostgresSequencerCommitStore implements SequencerCommitStore {
    constructor(private readonly pool: PgPool) {
    }

    async commitNextBlock(chainId: ChainId, expectedBlockNumber: BlockNumber): Promise<void> {
        const cursor = await this.readCursor(chainId, expectedBlockNumber);
        if (!cursor) {
            throw new Error(
                `Chain cursor not found for chain ${String(chainId)}`
                + ` at expected committed block ${String(expectedBlockNumber - 1)}`
            );
        }

        const raw = await this.readRawBlock(chainId, expectedBlockNumber);
        if (!raw) {
            return;
        }

        if (raw.parentHash !== cursor.lastCommittedHash) {
            throw new Error(
                "Raw block parent hash mismatch for chain "
                + `${String(chainId)} block ${String(expectedBlockNumber)}: `
                + `expected parent ${cursor.lastCommittedHash}, got ${raw.parentHash}`
            );
        }

        const { block, transactions, logs } = raw.payload;

        await withTransaction(this.pool, async (client) => {
            await this.insertCanonicalBlock(
                client,
                chainId,
                expectedBlockNumber,
                raw.blockHash,
                raw.parentHash,
                block.timestamp,
                block.raw,
            );
            await this.insertTransactions(client, chainId, expectedBlockNumber, raw.blockHash, transactions);
            await this.insertEvents(client, chainId, expectedBlockNumber, raw.blockHash, logs);

            await client.query(
                `UPDATE chain_cursor
                 SET last_committed_block = $2,
                     last_committed_hash = $3,
                     updated_at = NOW()
                 WHERE chain_id = $1
                   AND last_committed_block = ($2 - 1)
                   AND last_committed_hash = $4`,
                [chainId, expectedBlockNumber, raw.blockHash, cursor.lastCommittedHash]
            );

            await client.query(
                `UPDATE block_jobs
                 SET status = 'committed',
                     updated_at = NOW()
                 WHERE chain_id = $1
                   AND block_number = $2
                   AND status <> 'committed'`,
                [chainId, expectedBlockNumber]
            );
        });
    }

    private async readCursor(chainId: ChainId, expectedBlockNumber: BlockNumber): Promise<CursorState | null> {
        const result = await this.pool.query<CursorRow>(
            `SELECT last_committed_hash
             FROM chain_cursor
             WHERE chain_id = $1
               AND last_committed_block = ($2 - 1)`,
            [chainId, expectedBlockNumber]
        );

        if (result.rows.length === 0) {
            return null;
        }

        return { lastCommittedHash: asHash32(result.rows[0].last_committed_hash) };
    }

    private async readRawBlock(chainId: ChainId, expectedBlockNumber: BlockNumber): Promise<RawBlockData | null> {
        const result = await this.pool.query<RawBlockRow>(
            `SELECT block_hash, parent_hash, payload
             FROM raw_blocks
             WHERE chain_id = $1
               AND block_number = $2`,
            [chainId, expectedBlockNumber]
        );

        if (result.rows.length === 0) {
            return null;
        }

        const label = `chain ${String(chainId)} block ${String(expectedBlockNumber)}`;

        return {
            blockHash: asHash32(result.rows[0].block_hash),
            parentHash: asHash32(result.rows[0].parent_hash),
            payload: parseFetchedBlockPayload(result.rows[0].payload, label),
        };
    }

    private async insertCanonicalBlock(
        client: PgQueryExecutor,
        chainId: ChainId,
        blockNumber: BlockNumber,
        blockHash: HashHex,
        parentHash: HashHex,
        blockTimestamp: number,
        raw: unknown
    ): Promise<void> {
        await client.query(
            `INSERT INTO canonical_blocks (chain_id, block_number, block_hash, parent_hash, block_timestamp, raw)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (chain_id, block_number) DO NOTHING`,
            [chainId, blockNumber, blockHash, parentHash, blockTimestamp, raw]
        );
    }

    private async insertTransactions(
        client: PgQueryExecutor,
        chainId: ChainId,
        blockNumber: BlockNumber,
        blockHash: HashHex,
        transactions: ChainTransaction[]
    ): Promise<void> {
        if (transactions.length === 0) {
            return;
        }

        const params = transactions.flatMap((tx) => [
            chainId,
            blockNumber,
            blockHash,
            tx.index,
            tx.hash,
            tx.from,
            tx.to,
            tx.value,
            tx.data,
            tx.raw,
        ]);
        const placeholders = buildValuesPlaceholders(transactions.length, 10);

        await client.query(
            `INSERT INTO canonical_transactions
                (
                    chain_id,
                    block_number,
                    block_hash,
                    transaction_index,
                    transaction_hash,
                    from_address,
                    to_address,
                    value,
                    data,
                    raw
                 )
             VALUES ${placeholders}
             ON CONFLICT (chain_id, block_number, transaction_index) DO NOTHING`,
            params
        );
    }

    private async insertEvents(
        client: PgQueryExecutor,
        chainId: ChainId,
        blockNumber: BlockNumber,
        blockHash: HashHex,
        logs: ChainLog[]
    ): Promise<void> {
        if (logs.length === 0) {
            return;
        }

        const params = logs.flatMap((log) => [
                chainId,
                blockNumber,
                blockHash,
                log.transactionIndex,
                log.transactionHash,
                log.index,
                log.address,
                log.topics,
                log.data,
                log.raw
            ]);
        const placeholders = buildValuesPlaceholders(logs.length, 10);

        await client.query(
            `INSERT INTO canonical_events
             (
                chain_id,
                block_number,
                block_hash,
                transaction_index,
                transaction_hash,
                log_index,
                address,
                topics,
                data,
                raw
              )
             VALUES ${placeholders}
             ON CONFLICT (chain_id, block_number, transaction_index, log_index) DO NOTHING`,
            params
        );
    }
}

function buildValuesPlaceholders(rowCount: number, columnsPerRow: number): string {
    let paramIndex = 1;

    return Array.from({ length: rowCount }, () => (
        `(${Array.from({ length: columnsPerRow }, () => `$${String(paramIndex++)}`).join(", ")})`
    )).join(", ");
}

function parseFetchedBlockPayload(value: unknown, label: string): FetchedBlock {
    if (!isObjectRecord(value)) {
        throw new Error(`Invalid raw block payload for ${label}: expected object`);
    }

    const block = parseBlock(value.block, `${label} block`);

    if (!Array.isArray(value.transactions)) {
        throw new Error(`Invalid raw block payload for ${label}: missing transactions array`);
    }

    const transactions = value.transactions.map(
        (item: unknown, i: number) => parseTransaction(item, `${label} transactions[${String(i)}]`)
    );

    if (!Array.isArray(value.logs)) {
        throw new Error(`Invalid raw block payload for ${label}: missing logs array`);
    }

    const logs = value.logs.map(
        (item: unknown, i: number) => parseLog(item, `${label} logs[${String(i)}]`)
    );

    return { block, transactions, logs };
}

function parseBlock(value: unknown, label: string): ChainBlock {
    if (!isObjectRecord(value)) {
        throw new Error(`Invalid ${label}: expected object`);
    }

    return {
        chainId: toSafeInt(value.chainId, `${label}.chainId`),
        number: toSafeInt(value.number, `${label}.number`),
        hash: asHash32(value.hash),
        parentHash: asHash32(value.parentHash),
        timestamp: toSafeInt(value.timestamp, `${label}.timestamp`),
        raw: value.raw,
    };
}

function parseTransaction(value: unknown, label: string): ChainTransaction {
    if (!isObjectRecord(value)) {
        throw new Error(`Invalid ${label}: expected object`);
    }

    if (typeof value.value !== "string") {
        throw new Error(`Invalid ${label}.value: expected string`);
    }

    return {
        chainId: toSafeInt(value.chainId, `${label}.chainId`),
        blockNumber: toSafeInt(value.blockNumber, `${label}.blockNumber`),
        blockHash: asHash32(value.blockHash),
        index: toSafeInt(value.index, `${label}.index`),
        hash: asHash32(value.hash),
        from: asAddress(value.from),
        to: value.to === null || value.to === undefined ? null : asAddress(value.to),
        value: value.value,
        data: asHexData(value.data),
        raw: value.raw,
    };
}

function parseLog(value: unknown, label: string): ChainLog {
    if (!isObjectRecord(value)) {
        throw new Error(`Invalid ${label}: expected object`);
    }

    if (!Array.isArray(value.topics)) {
        throw new Error(`Invalid ${label}.topics: expected array`);
    }

    return {
        chainId: toSafeInt(value.chainId, `${label}.chainId`),
        blockNumber: toSafeInt(value.blockNumber, `${label}.blockNumber`),
        blockHash: asHash32(value.blockHash),
        transactionIndex: toSafeInt(value.transactionIndex, `${label}.transactionIndex`),
        transactionHash: asHash32(value.transactionHash),
        index: toSafeInt(value.index, `${label}.index`),
        address: asAddress(value.address),
        topics: value.topics.map((item: unknown) => asHash32(item)),
        data: asHexData(value.data),
        raw: value.raw,
    };
}
