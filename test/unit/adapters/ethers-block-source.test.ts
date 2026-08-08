import type {
    EthersBlockLike,
    EthersLogLike,
    EthersProviderLike,
    EthersTransactionLike,
} from "../../../src/adapters/ethers-block-source.js";
import { EthersBlockSource } from "../../../src/adapters/ethers-block-source.js";
import type { Logger } from "../../../src/interfaces/logger.js";

const hash = (char: string): string => `0x${char.repeat(64)}`;
const address = (char: string): string => `0x${char.repeat(40)}`;

const createProviderMock = (): jest.Mocked<EthersProviderLike> => ({
    getNetwork: jest.fn(),
    getBlockNumber: jest.fn(),
    getBlock: jest.fn(),
    getTransaction: jest.fn(),
    getLogs: jest.fn(),
});

const createSource = async (
    provider: jest.Mocked<EthersProviderLike>,
    chainId = 7n,
    fallbackProvider?: jest.Mocked<EthersProviderLike>,
    logger?: Logger,
): Promise<EthersBlockSource> => {
    provider.getNetwork.mockResolvedValue({ chainId });
    fallbackProvider?.getNetwork.mockResolvedValue({ chainId });

    return EthersBlockSource.create({
        providerPairs: [{ provider, fallbackProvider }],
        logger,
    });
};

const createLoggerMock = (): jest.Mocked<Logger> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
});

test("maps latest block, transactions and logs from ethers provider", async () => {
    const blockCalls: Array<{ blockNumber: number; prefetchTxs?: boolean }> = [];
    const logCalls: Array<{ fromBlock: number; toBlock: number }> = [];

    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 7n });
    provider.getBlockNumber.mockResolvedValue(120);
    provider.getBlock.mockImplementation(async (blockNumber: number | "latest", prefetchTxs?: boolean) => {
        if (blockNumber === "latest") {
            throw new Error("latest block is not expected");
        }

        blockCalls.push({ blockNumber, prefetchTxs });
        const transaction: EthersTransactionLike = {
            chainId: 7n,
            blockNumber: 12,
            blockHash: hash("a"),
            index: 0,
            hash: hash("c"),
            from: address("1"),
            to: address("2"),
            value: 123n,
            data: "0x1234",
        };

        const block: EthersBlockLike = {
            number: 12,
            hash: hash("a"),
            parentHash: hash("b"),
            timestamp: 1000,
            transactions: [hash("c")],
            prefetchedTransactions: [transaction],
        };

        return block;
    });
    provider.getLogs.mockImplementation(async (filter: { fromBlock: number; toBlock: number }) => {
        logCalls.push(filter);
        const log: EthersLogLike = {
            blockNumber: 12,
            blockHash: hash("a"),
            transactionHash: hash("c"),
            transactionIndex: 0,
            index: 3,
            address: address("f"),
            topics: [hash("d"), hash("e")],
            data: "0x99",
        };

        return [log];
    });

    const source = await createSource(provider);

    await expect(source.getLatestBlockNumber(7)).resolves.toBe(120);

    const fetchedBlock = await source.getBlockData(7, 12);
    expect(fetchedBlock).toMatchObject({
        block: {
            chainId: 7,
            number: 12,
            hash: hash("a"),
            parentHash: hash("b"),
            timestamp: 1000,
        },
        transactions: [{
            chainId: 7,
            blockNumber: 12,
            blockHash: hash("a"),
            index: 0,
            hash: hash("c"),
            to: address("2"),
            from: address("1"),
            data: "0x1234",
            value: "123",
        }],
        logs: [{
            chainId: 7,
            blockNumber: 12,
            blockHash: hash("a"),
            transactionIndex: 0,
            transactionHash: hash("c"),
            address: address("f"),
            data: "0x99",
            topics: [hash("d"), hash("e")],
            index: 3,
        }],
    });
    expect(blockCalls).toEqual([{ blockNumber: 12, prefetchTxs: true }]);
    expect(logCalls).toEqual([{ fromBlock: 12, toBlock: 12 }]);
});

test("falls back to getTransaction when prefetched transactions are unavailable", async () => {
    const requestedHashes: string[] = [];
    const transactionHashA = hash("a");
    const transactionHashB = hash("b");

    const provider = createProviderMock();
    const block: EthersBlockLike = {
        number: 55,
        hash: hash("c"),
        parentHash: hash("d"),
        timestamp: 77,
        transactions: [transactionHashA, transactionHashB],
        get prefetchedTransactions(): EthersTransactionLike[] {
            throw new Error("prefetch unsupported");
        },
    };

    provider.getNetwork.mockResolvedValue({ chainId: 1n });
    provider.getBlock.mockResolvedValue(block);
    provider.getTransaction.mockImplementation(async (transactionHash: string) => {
        requestedHashes.push(transactionHash);
        if (transactionHash === transactionHashA) {
            return {
                chainId: 1n,
                blockNumber: 55,
                blockHash: hash("c"),
                index: 0,
                hash: transactionHashA,
                from: address("1"),
                to: null,
                value: 1n,
                data: "0x",
            };
        }

        return {
            chainId: 1n,
            blockNumber: 55,
            blockHash: hash("c"),
            index: 1,
            hash: transactionHashB,
            from: address("2"),
            to: address("3"),
            value: 2n,
            data: "0x11",
        };
    });
    provider.getLogs.mockResolvedValue([]);

    const source = await createSource(provider, 1n);

    await expect(source.getBlockData(1, 55)).resolves.toMatchObject({
        block: {
            chainId: 1,
            number: 55,
        },
        transactions: [
            {
                chainId: 1,
                blockNumber: 55,
                blockHash: hash("c"),
                index: 0,
                hash: transactionHashA,
                to: null,
                data: "0x",
                value: "1",
            },
            {
                chainId: 1,
                blockNumber: 55,
                blockHash: hash("c"),
                index: 1,
                hash: transactionHashB,
                to: address("3"),
                data: "0x11",
                value: "2",
            },
        ],
        logs: [],
    });

    expect(requestedHashes).toEqual([transactionHashA, transactionHashB]);
});

test("reads latest block number from a single provider", async () => {
    const provider = createProviderMock();
    provider.getBlockNumber.mockResolvedValue(999);

    const source = await createSource(provider, 42n);

    await expect(source.getLatestBlockNumber(42)).resolves.toBe(999);
});

test("uses fallback provider and logs provider failure", async () => {
    const provider = createProviderMock();
    provider.getBlockNumber.mockRejectedValue(new Error("provider unavailable"));
    const fallbackProvider = createProviderMock();
    fallbackProvider.getBlockNumber.mockResolvedValue(999);
    const logger = createLoggerMock();
    const source = await createSource(provider, 42n, fallbackProvider, logger);

    await expect(source.getLatestBlockNumber(42)).resolves.toBe(999);

    expect(provider.getBlockNumber.mock.calls).toHaveLength(1);
    expect(fallbackProvider.getBlockNumber.mock.calls).toHaveLength(1);
    expect(logger.warn.mock.calls).toEqual([[
        "ethers_source_provider_failed_fallback_started", {
            chainId: 42,
            operation: "getLatestBlockNumber",
            error: "provider unavailable",
        },
    ]]);
});

test("does not call fallback provider when provider succeeds", async () => {
    const provider = createProviderMock();
    provider.getBlockNumber.mockResolvedValue(100);
    const fallbackProvider = createProviderMock();
    const source = await createSource(provider, 42n, fallbackProvider);

    await expect(source.getLatestBlockNumber(42)).resolves.toBe(100);

    expect(fallbackProvider.getBlockNumber.mock.calls).toHaveLength(0);
});

test("reports provider and fallback errors when both providers fail", async () => {
    const provider = createProviderMock();
    provider.getBlockNumber.mockRejectedValue(new Error("provider unavailable"));
    const fallbackProvider = createProviderMock();
    fallbackProvider.getBlockNumber.mockRejectedValue("fallback unavailable");
    const source = await createSource(provider, 42n, fallbackProvider);

    await expect(source.getLatestBlockNumber(42)).rejects.toThrow(
        "Ethers source getLatestBlockNumber failed on provider and fallback provider for chain 42: "
        + "provider: provider unavailable; fallback: fallback unavailable"
    );

    expect(provider.getBlockNumber.mock.calls).toHaveLength(1);
    expect(fallbackProvider.getBlockNumber.mock.calls).toHaveLength(1);
});

test("throws when provider is missing for chain", async () => {
    const provider = createProviderMock();
    const source = await createSource(provider);

    await expect(source.getLatestBlockNumber(42)).rejects.toThrow(
        "provider not found for chain 42"
    );
});

test("creates source by detecting provider chain ids", async () => {
    const providerA = createProviderMock();
    providerA.getNetwork.mockResolvedValue({ chainId: 1n });
    providerA.getBlockNumber.mockResolvedValue(100);
    const providerB = createProviderMock();
    providerB.getNetwork.mockResolvedValue({ chainId: 56n });
    providerB.getBlockNumber.mockResolvedValue(200);

    const source = await EthersBlockSource.create({
        providerPairs: [
            { provider: providerA },
            { provider: providerB },
        ],
    });

    await expect(source.getLatestBlockNumber(1)).resolves.toBe(100);
    await expect(source.getLatestBlockNumber(56)).resolves.toBe(200);
});

test("rejects empty provider list", async () => {
    await expect(EthersBlockSource.create({ providerPairs: [] })).rejects.toThrow(
        "Ethers source providerPairs must not be empty"
    );
});

test("rejects duplicated detected chain ids", async () => {
    const providerA = createProviderMock();
    providerA.getNetwork.mockResolvedValue({ chainId: 1n });
    const providerB = createProviderMock();
    providerB.getNetwork.mockResolvedValue({ chainId: 1n });

    await expect(EthersBlockSource.create({
        providerPairs: [
            { provider: providerA },
            { provider: providerB },
        ],
    })).rejects.toThrow(
        "Ethers source chain id is duplicated: 1"
    );
});

test("rejects invalid detected chain id", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 0n });

    await expect(EthersBlockSource.create({
        providerPairs: [{ provider }],
    })).rejects.toThrow(
        "Ethers source chain id is invalid: 0"
    );
});

test("rejects mismatched fallback provider chain id", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 1n });
    const fallbackProvider = createProviderMock();
    fallbackProvider.getNetwork.mockResolvedValue({ chainId: 56n });

    await expect(EthersBlockSource.create({
        providerPairs: [{ provider, fallbackProvider }],
    })).rejects.toThrow(
        "Ethers fallback source chain id mismatch: expected 1, got 56"
    );
});

test("rejects invalid fallback provider chain id", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 1n });
    const fallbackProvider = createProviderMock();
    fallbackProvider.getNetwork.mockResolvedValue({ chainId: 0n });

    await expect(EthersBlockSource.create({
        providerPairs: [{ provider, fallbackProvider }],
    })).rejects.toThrow(
        "Ethers fallback source chain id is invalid: 0"
    );
});

test("rejects unavailable provider during startup", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockRejectedValue(new Error("provider startup failed"));

    await expect(EthersBlockSource.create({
        providerPairs: [{ provider }],
    })).rejects.toThrow("provider startup failed");
});

test("rejects unavailable fallback provider during startup", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 1n });
    const fallbackProvider = createProviderMock();
    fallbackProvider.getNetwork.mockRejectedValue(new Error("fallback startup failed"));

    await expect(EthersBlockSource.create({
        providerPairs: [{ provider, fallbackProvider }],
    })).rejects.toThrow("fallback startup failed");
});

test("reads block without prefetching transactions", async () => {
    const provider = createProviderMock();
    provider.getBlock.mockResolvedValue({
        number: 55,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1234,
        transactions: [],
        prefetchedTransactions: [],
    });

    const source = await createSource(provider);

    await expect(source.getBlock(7, 55)).resolves.toMatchObject({
        chainId: 7,
        number: 55,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1234,
    });

    expect(provider.getBlock.mock.calls).toEqual([[55, false]]);
});

test("reads latest block without validating requested number", async () => {
    const provider = createProviderMock();
    provider.getBlock.mockResolvedValue({
        number: 56,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1235,
        transactions: [],
        prefetchedTransactions: [],
    });

    const source = await createSource(provider);

    await expect(source.getLatestBlock(7)).resolves.toMatchObject({
        chainId: 7,
        number: 56,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1235,
    });

    expect(provider.getBlock.mock.calls).toEqual([["latest", false]]);
});

test("throws when block is missing", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 7n });
    provider.getBlock.mockResolvedValue(null);

    const source = await createSource(provider);

    await expect(source.getBlockData(7, 42)).rejects.toThrow(
        "block not found for chain 7 at number 42"
    );
});

test("throws when requested block is missing", async () => {
    const provider = createProviderMock();
    provider.getBlock.mockResolvedValue(null);

    const source = await createSource(provider);

    await expect(source.getBlock(7, 42)).rejects.toThrow(
        "block not found for chain 7 at 42"
    );
});

test("throws when requested block number mismatches", async () => {
    const provider = createProviderMock();
    provider.getBlock.mockResolvedValue({
        number: 43,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1,
        transactions: [],
        prefetchedTransactions: [],
    });

    const source = await createSource(provider);

    await expect(source.getBlock(7, 42)).rejects.toThrow(
        "block number mismatch for chain 7: expected 42, got 43"
    );
});

test("throws when requested block hash is missing", async () => {
    const provider = createProviderMock();
    provider.getBlock.mockResolvedValue({
        number: 42,
        hash: null,
        parentHash: hash("b"),
        timestamp: 1,
        transactions: [],
        prefetchedTransactions: [],
    });

    const source = await createSource(provider);

    await expect(source.getBlock(7, 42)).rejects.toThrow(
        "block hash is missing for chain 7 at number 42"
    );
});

test("throws on log block hash mismatch", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 7n });
    const block: EthersBlockLike = {
        number: 9,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1,
        transactions: [],
        prefetchedTransactions: [],
    };
    const log: EthersLogLike = {
        blockNumber: 9,
        blockHash: hash("c"),
        transactionHash: hash("d"),
        transactionIndex: 0,
        index: 0,
        address: address("f"),
        topics: [],
        data: "0x",
    };
    provider.getBlock.mockResolvedValue(block);
    provider.getLogs.mockResolvedValue([log]);

    const source = await createSource(provider);

    await expect(source.getBlockData(7, 9)).rejects.toThrow(
        "log block hash mismatch for chain 7 block 9"
    );
});

test("restarts the whole block data load on fallback after invalid logs", async () => {
    const provider = createProviderMock();
    const fallbackProvider = createProviderMock();
    const block: EthersBlockLike = {
        number: 9,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1,
        transactions: [],
        prefetchedTransactions: [],
    };
    const invalidLog: EthersLogLike = {
        blockNumber: 9,
        blockHash: hash("c"),
        transactionHash: hash("d"),
        transactionIndex: 0,
        index: 0,
        address: address("f"),
        topics: [],
        data: "0x",
    };
    const validLog: EthersLogLike = {
        ...invalidLog,
        blockHash: hash("a"),
    };
    provider.getBlock.mockResolvedValue(block);
    provider.getLogs.mockResolvedValue([invalidLog]);
    fallbackProvider.getBlock.mockResolvedValue(block);
    fallbackProvider.getLogs.mockResolvedValue([validLog]);
    const source = await createSource(provider, 7n, fallbackProvider);

    await expect(source.getBlockData(7, 9)).resolves.toMatchObject({
        block: { number: 9, hash: hash("a") },
        logs: [{ blockHash: hash("a") }],
    });

    expect(provider.getBlock.mock.calls).toHaveLength(1);
    expect(provider.getLogs.mock.calls).toHaveLength(1);
    expect(fallbackProvider.getBlock.mock.calls).toHaveLength(1);
    expect(fallbackProvider.getLogs.mock.calls).toHaveLength(1);
});

test("throws when block hash is missing", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 7n });
    provider.getBlock.mockResolvedValue({
        number: 21,
        hash: null,
        parentHash: hash("b"),
        timestamp: 1,
        transactions: [],
        prefetchedTransactions: [],
    });

    const source = await createSource(provider);

    await expect(source.getBlockData(7, 21)).rejects.toThrow(
        "block hash is missing for chain 7 at number 21"
    );
});

test("throws when block number mismatches requested number", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 7n });
    provider.getBlock.mockResolvedValue({
        number: 22,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1,
        transactions: [],
        prefetchedTransactions: [],
    });

    const source = await createSource(provider);

    await expect(source.getBlockData(7, 21)).rejects.toThrow(
        "block number mismatch for chain 7: expected 21, got 22"
    );
});

test("throws when fallback transaction is not found", async () => {
    const transactionHash = hash("a");
    const provider = createProviderMock();
    const block: EthersBlockLike = {
        number: 55,
        hash: hash("c"),
        parentHash: hash("d"),
        timestamp: 77,
        transactions: [transactionHash],
        get prefetchedTransactions(): EthersTransactionLike[] {
            throw new Error("prefetch unsupported");
        },
    };

    provider.getNetwork.mockResolvedValue({ chainId: 1n });
    provider.getBlock.mockResolvedValue(block);
    provider.getTransaction.mockResolvedValue(null);
    provider.getLogs.mockResolvedValue([]);

    const source = await createSource(provider, 1n);

    await expect(source.getBlockData(1, 55)).rejects.toThrow(
        `transaction not found for chain 1 block 55 hash ${transactionHash}`
    );
});

test("throws on transaction chain id mismatch", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 7n });
    provider.getBlock.mockResolvedValue({
        number: 9,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1,
        transactions: [hash("c")],
        prefetchedTransactions: [{
            chainId: 8n,
            blockNumber: 9,
            blockHash: hash("a"),
            index: 0,
            hash: hash("c"),
            from: address("1"),
            to: address("2"),
            value: 1n,
            data: "0x",
        }],
    });
    provider.getLogs.mockResolvedValue([]);

    const source = await createSource(provider);

    await expect(source.getBlockData(7, 9)).rejects.toThrow(
        "transaction chain id mismatch for chain 7 block 9"
    );
});

test("allows transaction with null chain id", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 7n });
    provider.getBlock.mockResolvedValue({
        number: 9,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1,
        transactions: [hash("c")],
        prefetchedTransactions: [{
            chainId: null,
            blockNumber: 9,
            blockHash: hash("a"),
            index: 0,
            hash: hash("c"),
            from: address("1"),
            to: address("2"),
            value: 1n,
            data: "0x",
        }],
    });
    provider.getLogs.mockResolvedValue([]);

    const source = await createSource(provider);

    await expect(source.getBlockData(7, 9)).resolves.toMatchObject({
        block: {
            chainId: 7,
            number: 9,
        },
        transactions: [{
            chainId: 7,
            blockNumber: 9,
            blockHash: hash("a"),
            index: 0,
            hash: hash("c"),
            from: address("1"),
            to: address("2"),
            data: "0x",
            value: "1",
        }],
        logs: [],
    });
});

test("throws on transaction block number mismatch", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 7n });
    provider.getBlock.mockResolvedValue({
        number: 9,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1,
        transactions: [hash("c")],
        prefetchedTransactions: [{
            chainId: 7n,
            blockNumber: 8,
            blockHash: hash("a"),
            index: 0,
            hash: hash("c"),
            from: address("1"),
            to: address("2"),
            value: 1n,
            data: "0x",
        }],
    });
    provider.getLogs.mockResolvedValue([]);

    const source = await createSource(provider);

    await expect(source.getBlockData(7, 9)).rejects.toThrow(
        "transaction block number mismatch for chain 7 block 9"
    );
});

test("throws on transaction block hash mismatch", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 7n });
    provider.getBlock.mockResolvedValue({
        number: 9,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1,
        transactions: [hash("c")],
        prefetchedTransactions: [{
            chainId: 7n,
            blockNumber: 9,
            blockHash: hash("f"),
            index: 0,
            hash: hash("c"),
            from: address("1"),
            to: address("2"),
            value: 1n,
            data: "0x",
        }],
    });
    provider.getLogs.mockResolvedValue([]);

    const source = await createSource(provider);

    await expect(source.getBlockData(7, 9)).rejects.toThrow(
        "transaction block hash mismatch for chain 7 block 9"
    );
});

test("throws on negative transaction index", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 7n });
    provider.getBlock.mockResolvedValue({
        number: 9,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1,
        transactions: [hash("c")],
        prefetchedTransactions: [{
            chainId: 7n,
            blockNumber: 9,
            blockHash: hash("a"),
            index: -1,
            hash: hash("c"),
            from: address("1"),
            to: address("2"),
            value: 1n,
            data: "0x",
        }],
    });
    provider.getLogs.mockResolvedValue([]);

    const source = await createSource(provider);

    await expect(source.getBlockData(7, 9)).rejects.toThrow(
        "transaction index is invalid for chain 7 block 9"
    );
});

test("throws on non-integer transaction index", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 7n });
    provider.getBlock.mockResolvedValue({
        number: 9,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1,
        transactions: [hash("c")],
        prefetchedTransactions: [{
            chainId: 7n,
            blockNumber: 9,
            blockHash: hash("a"),
            index: 0.5,
            hash: hash("c"),
            from: address("1"),
            to: address("2"),
            value: 1n,
            data: "0x",
        }],
    });
    provider.getLogs.mockResolvedValue([]);

    const source = await createSource(provider);

    await expect(source.getBlockData(7, 9)).rejects.toThrow(
        "transaction index is invalid for chain 7 block 9"
    );
});

test("throws on log block number mismatch", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 7n });
    provider.getBlock.mockResolvedValue({
        number: 9,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1,
        transactions: [],
        prefetchedTransactions: [],
    });
    provider.getLogs.mockResolvedValue([{
        blockNumber: 10,
        blockHash: hash("a"),
        transactionHash: hash("d"),
        transactionIndex: 0,
        index: 0,
        address: address("f"),
        topics: [],
        data: "0x",
    }]);

    const source = await createSource(provider);

    await expect(source.getBlockData(7, 9)).rejects.toThrow(
        "log block number mismatch for chain 7 block 9"
    );
});

test("throws on invalid log transaction index", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 7n });
    provider.getBlock.mockResolvedValue({
        number: 9,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1,
        transactions: [],
        prefetchedTransactions: [],
    });
    provider.getLogs.mockResolvedValue([{
        blockNumber: 9,
        blockHash: hash("a"),
        transactionHash: hash("d"),
        transactionIndex: -1,
        index: 0,
        address: address("f"),
        topics: [],
        data: "0x",
    }]);

    const source = await createSource(provider);

    await expect(source.getBlockData(7, 9)).rejects.toThrow(
        "log transaction index is invalid for chain 7 block 9"
    );
});

test("throws on invalid log index", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 7n });
    provider.getBlock.mockResolvedValue({
        number: 9,
        hash: hash("a"),
        parentHash: hash("b"),
        timestamp: 1,
        transactions: [],
        prefetchedTransactions: [],
    });
    provider.getLogs.mockResolvedValue([{
        blockNumber: 9,
        blockHash: hash("a"),
        transactionHash: hash("d"),
        transactionIndex: 0,
        index: -1,
        address: address("f"),
        topics: [],
        data: "0x",
    }]);

    const source = await createSource(provider);

    await expect(source.getBlockData(7, 9)).rejects.toThrow(
        "log index is invalid for chain 7 block 9"
    );
});
