import { PostgresCanonicalBlocksRepository } from "../../../../src/repositories/postgres/index.js";
import type { DbExecutor } from "../../../../src/interfaces/db.js";
import { asHash32 } from "../../../../src/utils/hex.js";

const HASH_A = asHash32("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const HASH_B = asHash32("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

const createExecutor = (query: jest.Mock): DbExecutor => ({ query: query as never });

test("insert writes canonical block", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 1 }));
    const repository = new PostgresCanonicalBlocksRepository(createExecutor(query));

    await repository.insert({
        chainId: 1,
        number: 10,
        hash: HASH_A,
        parentHash: HASH_B,
        timestamp: 123,
        raw: { any: true },
    });

    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>;
    expect(calls[0]?.[1]).toEqual([1, 10, HASH_A, HASH_B, 123, { any: true }]);
});

test("deleteUpToBlock returns deleted rows", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 2 }));
    const repository = new PostgresCanonicalBlocksRepository(createExecutor(query));

    await expect(repository.deleteUpToBlock(1, 100)).resolves.toBe(2);
});
