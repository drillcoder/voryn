import { expect, test } from "vitest";

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { EthersBlockSource } from "../../../src/adapters/ethers-block-source.js";

type FailureMode = "http-429" | "http-500" | "timeout" | "wrong-chain";

interface RpcRequest {
    id: number;
    method: string;
    params?: unknown[];
}

type LogsMode = "empty" | "unknown-block";

interface BlockDataRpcServer {
    close(): Promise<void>;
    logFilters: unknown[];
    url: string;
}

const blockHash = `0x${"a".repeat(64)}`;

interface TestRpcServer {
    close(): Promise<void>;
    requests: string[];
    url: string;
}

test.each<FailureMode>([
    "http-429",
    "http-500",
    "timeout",
    "wrong-chain",
])("switches endpoints after %s", async (failureMode) => {
    const failing = await startRpcServer(failureMode);
    const healthy = await startRpcServer("healthy");
    const source = await EthersBlockSource.create({
        networks: [{ chainId: 1, rpcUrls: [failing.url, healthy.url] }],
        requestTimeoutMs: 50,
        operationTimeoutMs: 2_000,
    });

    try {
        await expect(source.getLatestBlockNumber(1)).resolves.toBe(42);
        expect(failing.requests).toContain("eth_chainId");
        expect(healthy.requests).toContain("eth_chainId");
        expect(healthy.requests).toContain("eth_blockNumber");
    } finally {
        await source.close();
        await Promise.all([failing.close(), healthy.close()]);
    }
});

test("requests block logs by block hash", async () => {
    const server = await startBlockDataRpcServer("empty");
    const source = await EthersBlockSource.create({
        networks: [{ chainId: 1, rpcUrls: [server.url] }],
        requestTimeoutMs: 500,
        operationTimeoutMs: 2_000,
    });

    try {
        await expect(source.getBlockData(1, 9)).resolves.toMatchObject({
            block: { chainId: 1, number: 9, hash: blockHash },
            logs: [],
        });
        expect(server.logFilters).toEqual([{ blockHash }]);
    } finally {
        await source.close();
        await server.close();
    }
});

test("rejects block data when the endpoint does not know the block hash", async () => {
    const server = await startBlockDataRpcServer("unknown-block");
    const source = await EthersBlockSource.create({
        networks: [{ chainId: 1, rpcUrls: [server.url] }],
        requestTimeoutMs: 500,
        operationTimeoutMs: 2_000,
    });

    try {
        await expect(source.getBlockData(1, 9)).rejects.toThrow("unknown block");
        expect(server.logFilters).toEqual([{ blockHash }]);
    } finally {
        await source.close();
        await server.close();
    }
});

async function startBlockDataRpcServer(logsMode: LogsMode): Promise<BlockDataRpcServer> {
    const logFilters: unknown[] = [];
    const server = createServer((request, response) => {
        void handleBlockDataRequest(request, response, logsMode, logFilters);
    });

    await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("Expected local RPC server address");
    }

    return {
        logFilters,
        url: `http://127.0.0.1:${String(address.port)}`,
        close: async () => closeServer(server),
    };
}

async function handleBlockDataRequest(
    request: IncomingMessage,
    response: ServerResponse,
    logsMode: LogsMode,
    logFilters: unknown[],
): Promise<void> {
    const body = await readRequestBody(request);
    const rpcRequest = JSON.parse(body) as RpcRequest;

    switch (rpcRequest.method) {
        case "eth_chainId":
            writeRpcResult(response, rpcRequest.id, "0x1");
            return;
        case "eth_getBlockByNumber":
            writeRpcResult(response, rpcRequest.id, {
                number: "0x9",
                hash: blockHash,
                parentHash: `0x${"b".repeat(64)}`,
                timestamp: "0x1",
                nonce: "0x0000000000000000",
                difficulty: "0x0",
                gasLimit: "0x1c9c380",
                gasUsed: "0x0",
                miner: `0x${"0".repeat(40)}`,
                extraData: "0x",
                transactions: [],
            });
            return;
        case "eth_getLogs":
            logFilters.push(...(rpcRequest.params ?? []));
            if (logsMode === "unknown-block") {
                writeRpcError(response, rpcRequest.id, -32_000, "unknown block");
            } else {
                writeRpcResult(response, rpcRequest.id, []);
            }
            return;
        default:
            writeRpcError(response, rpcRequest.id, -32_601, "method not found");
    }
}

async function startRpcServer(mode: FailureMode | "healthy"): Promise<TestRpcServer> {
    const requests: string[] = [];
    const server = createServer((request, response) => {
        void handleRequest(request, response, mode, requests);
    });

    await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("Expected local RPC server address");
    }

    return {
        requests,
        url: `http://127.0.0.1:${String(address.port)}`,
        close: async () => closeServer(server),
    };
}

async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    mode: FailureMode | "healthy",
    requests: string[],
): Promise<void> {
    const body = await readRequestBody(request);
    const rpcRequest = JSON.parse(body) as RpcRequest;
    requests.push(rpcRequest.method);

    if (mode === "timeout") {
        setTimeout(() => {
            if (!response.destroyed) {
                writeRpcResult(response, rpcRequest.id, rpcRequest.method === "eth_chainId" ? "0x1" : "0x2a");
            }
        }, 200);
        return;
    }

    if (rpcRequest.method === "eth_chainId") {
        writeRpcResult(response, rpcRequest.id, mode === "wrong-chain" ? "0x2" : "0x1");
        return;
    }

    if (mode === "http-429") {
        response.writeHead(429, { "content-type": "application/json", "retry-after": "1" });
        response.end(JSON.stringify({ error: "rate limited" }));
        return;
    }

    if (mode === "http-500") {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unavailable" }));
        return;
    }

    writeRpcResult(response, rpcRequest.id, "0x2a");
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    const requestChunks: AsyncIterable<unknown> = request;
    for await (const chunk of requestChunks) {
        if (typeof chunk === "string" || chunk instanceof Uint8Array) {
            chunks.push(Buffer.from(chunk));
        } else {
            throw new TypeError("Unexpected HTTP request body chunk");
        }
    }
    return Buffer.concat(chunks).toString("utf8");
}

function writeRpcResult(response: ServerResponse, id: number, result: unknown): void {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function writeRpcError(response: ServerResponse, id: number, code: number, message: string): void {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
}

async function closeServer(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error === undefined) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}
