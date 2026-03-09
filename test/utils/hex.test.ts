import { asAddress, asHash32, asHexData } from "../../src/utils/hex.js";

const hash = (char: string): string => `0x${char.repeat(64)}`;
const address = (char: string): string => `0x${char.repeat(40)}`;

const context = { field: "test.field", chainId: 1, blockNumber: 2 };

test("asHash32 accepts valid 32-byte hex", () => {
    expect(asHash32(hash("a"), context)).toBe(hash("a"));
});

test("asHash32 rejects invalid value", () => {
    expect(() => asHash32("0x1234", context)).toThrow(
        "invalid test.field for chain 1 block 2: expected 0x-prefixed 32-byte hex"
    );
});

test("asAddress accepts valid address", () => {
    expect(asAddress(address("f"), context)).toBe(address("f"));
});

test("asAddress rejects non-address value", () => {
    expect(() => asAddress("0x1234", context)).toThrow(
        "invalid test.field for chain 1 block 2: expected 0x-prefixed 20-byte address"
    );
});

test("asHexData accepts valid byte data", () => {
    expect(asHexData("0x", context)).toBe("0x");
    expect(asHexData("0x12ab", context)).toBe("0x12ab");
});

test("asHexData rejects odd-length hex data", () => {
    expect(() => asHexData("0x1", context)).toThrow(
        "invalid test.field for chain 1 block 2: expected 0x-prefixed byte data"
    );
});
