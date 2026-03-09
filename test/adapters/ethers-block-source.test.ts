import {
    EthersBlockSource,
    type EthersBlockLike,
    type EthersLogLike,
    type EthersProviderLike,
    type EthersTransactionLike,
} from "../../src/index.js";

const hash = (char: string): string => `0x${char.repeat(64)}`;
const address = (char: string): string => `0x${char.repeat(40)}`;

const createProviderMock = (): jest.Mocked<EthersProviderLike> => ({
    getNetwork: jest.fn(),
    getBlockNumber: jest.fn(),
    getBlock: jest.fn(),
    getTransaction: jest.fn(),
    getLogs: jest.fn(),
});

test("maps latest block, transactions and logs from ethers provider", async () => {
    const blockCalls: Array<{ blockNumber: number; prefetchTxs?: boolean }> = [];
    const logCalls: Array<{ fromBlock: number; toBlock: number }> = [];

    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 7n });
    provider.getBlockNumber.mockResolvedValue(120);
    provider.getBlock.mockImplementation(async (blockNumber: number, prefetchTxs?: boolean) => {
        blockCalls.push({ blockNumber, prefetchTxs });
        const tx: EthersTransactionLike = {
            blockNumber: 12,
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
            prefetchedTransactions: [tx],
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

    const source = new EthersBlockSource({
        providers: new Map([[7, provider]]),
    });

    await expect(source.getLatestBlockNumber(7)).resolves.toBe(120);
    await expect(source.getBlockData(7, 12)).resolves.toEqual({
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
            hash: hash("c"),
            index: 0,
            from: address("1"),
            to: address("2"),
            value: "123",
            input: "0x1234",
        }],
        logs: [{
            chainId: 7,
            blockNumber: 12,
            txHash: hash("c"),
            txIndex: 0,
            logIndex: 3,
            address: address("f"),
            topics: [hash("d"), hash("e")],
            data: "0x99",
        }],
    });

    expect(blockCalls).toEqual([{ blockNumber: 12, prefetchTxs: true }]);
    expect(logCalls).toEqual([{ fromBlock: 12, toBlock: 12 }]);
});

test("falls back to getTransaction when prefetched transactions are unavailable", async () => {
    const requestedHashes: string[] = [];
    const txHashA = hash("a");
    const txHashB = hash("b");

    const provider = createProviderMock();
    const block: EthersBlockLike = {
        number: 55,
        hash: hash("c"),
        parentHash: hash("d"),
        timestamp: 77,
        transactions: [txHashA, txHashB],
        get prefetchedTransactions(): EthersTransactionLike[] {
            throw new Error("prefetch unsupported");
        },
    };

    provider.getNetwork.mockResolvedValue({ chainId: 1n });
    provider.getBlock.mockResolvedValue(block);
    provider.getTransaction.mockImplementation(async (txHash: string) => {
        requestedHashes.push(txHash);
        if (txHash === txHashA) {
            return {
                blockNumber: 55,
                index: 0,
                hash: txHashA,
                from: address("1"),
                to: null,
                value: 1n,
                data: "0x",
            };
        }

        return {
            blockNumber: 55,
            index: 1,
            hash: txHashB,
            from: address("2"),
            to: address("3"),
            value: 2n,
            data: "0x11",
        };
    });
    provider.getLogs.mockResolvedValue([]);

    const source = new EthersBlockSource({
        providers: new Map([[1, provider]]),
    });

    await expect(source.getBlockData(1, 55)).resolves.toMatchObject({
        block: {
            chainId: 1,
            number: 55,
        },
        transactions: [
            {
                chainId: 1,
                blockNumber: 55,
                hash: txHashA,
                index: 0,
                to: null,
                value: "1",
            },
            {
                chainId: 1,
                blockNumber: 55,
                hash: txHashB,
                index: 1,
                to: address("3"),
                value: "2",
            },
        ],
        logs: [],
    });

    expect(requestedHashes).toEqual([txHashA, txHashB]);
});

test("throws for unsupported chain id", async () => {
    const source = new EthersBlockSource({
        providers: new Map(),
    });

    await expect(source.getLatestBlockNumber(999)).rejects.toThrow("unsupported chain 999");
});

test("throws when block is missing", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 7n });
    provider.getBlock.mockResolvedValue(null);

    const source = new EthersBlockSource({
        providers: new Map([[7, provider]]),
    });

    await expect(source.getBlockData(7, 42)).rejects.toThrow(
        "block not found for chain 7 at number 42"
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

    const source = new EthersBlockSource({
        providers: new Map([[7, provider]]),
    });

    await expect(source.getBlockData(7, 9)).rejects.toThrow(
        "log block hash mismatch for chain 7 block 9"
    );
});

test("validates provider network chain id when enabled", async () => {
    let getBlockNumberCalled = false;

    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 10n });
    provider.getBlockNumber.mockImplementation(async () => {
        getBlockNumberCalled = true;
        return 1;
    });

    const source = new EthersBlockSource({
        providers: new Map([[1, provider]]),
        validateProviderChainId: true,
    });

    await expect(source.getLatestBlockNumber(1)).rejects.toThrow(
        "provider chain mismatch for chain 1: got 10"
    );
    expect(getBlockNumberCalled).toBe(false);
});

test("caches successful provider chain validation", async () => {
    const provider = createProviderMock();
    provider.getNetwork.mockResolvedValue({ chainId: 1n });
    provider.getBlockNumber.mockResolvedValue(123);

    const source = new EthersBlockSource({
        providers: new Map([[1, provider]]),
        validateProviderChainId: true,
    });

    await expect(source.getLatestBlockNumber(1)).resolves.toBe(123);
    await expect(source.getLatestBlockNumber(1)).resolves.toBe(123);

    expect(provider.getNetwork.mock.calls).toHaveLength(1);
    expect(provider.getBlockNumber.mock.calls).toHaveLength(2);
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

    const source = new EthersBlockSource({
        providers: new Map([[7, provider]]),
    });

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

    const source = new EthersBlockSource({
        providers: new Map([[7, provider]]),
    });

    await expect(source.getBlockData(7, 21)).rejects.toThrow(
        "block number mismatch for chain 7: expected 21, got 22"
    );
});

test("throws when fallback transaction is not found", async () => {
    const txHash = hash("a");
    const provider = createProviderMock();
    const block: EthersBlockLike = {
        number: 55,
        hash: hash("c"),
        parentHash: hash("d"),
        timestamp: 77,
        transactions: [txHash],
        get prefetchedTransactions(): EthersTransactionLike[] {
            throw new Error("prefetch unsupported");
        },
    };

    provider.getNetwork.mockResolvedValue({ chainId: 1n });
    provider.getBlock.mockResolvedValue(block);
    provider.getTransaction.mockResolvedValue(null);
    provider.getLogs.mockResolvedValue([]);

    const source = new EthersBlockSource({
        providers: new Map([[1, provider]]),
    });

    await expect(source.getBlockData(1, 55)).rejects.toThrow(
        `transaction not found for chain 1 block 55 hash ${txHash}`
    );
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
            blockNumber: 8,
            index: 0,
            hash: hash("c"),
            from: address("1"),
            to: address("2"),
            value: 1n,
            data: "0x",
        }],
    });
    provider.getLogs.mockResolvedValue([]);

    const source = new EthersBlockSource({
        providers: new Map([[7, provider]]),
    });

    await expect(source.getBlockData(7, 9)).rejects.toThrow(
        "transaction block number mismatch for chain 7 block 9"
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
            blockNumber: 9,
            index: -1,
            hash: hash("c"),
            from: address("1"),
            to: address("2"),
            value: 1n,
            data: "0x",
        }],
    });
    provider.getLogs.mockResolvedValue([]);

    const source = new EthersBlockSource({
        providers: new Map([[7, provider]]),
    });

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
            blockNumber: 9,
            index: 0.5,
            hash: hash("c"),
            from: address("1"),
            to: address("2"),
            value: 1n,
            data: "0x",
        }],
    });
    provider.getLogs.mockResolvedValue([]);

    const source = new EthersBlockSource({
        providers: new Map([[7, provider]]),
    });

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

    const source = new EthersBlockSource({
        providers: new Map([[7, provider]]),
    });

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

    const source = new EthersBlockSource({
        providers: new Map([[7, provider]]),
    });

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

    const source = new EthersBlockSource({
        providers: new Map([[7, provider]]),
    });

    await expect(source.getBlockData(7, 9)).rejects.toThrow(
        "log index is invalid for chain 7 block 9"
    );
});
