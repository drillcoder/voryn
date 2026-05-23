import { asChainId } from "../../../src/utils/chain.js";

test("asChainId accepts positive safe integers", () => {
    expect(asChainId(1)).toBe(1);
    expect(asChainId(56n)).toBe(56);
});

test.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    BigInt(Number.MAX_SAFE_INTEGER) + 1n,
])("asChainId rejects invalid chain id %p", (value) => {
    expect(() => asChainId(value)).toThrow(`chain id is invalid: ${String(value)}`);
});

test("asChainId uses provided error label", () => {
    expect(() => asChainId(0, "Ethers source chain id")).toThrow(
        "Ethers source chain id is invalid: 0"
    );
});
