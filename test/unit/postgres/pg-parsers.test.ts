import { parsePgBigint, parsePgInt, parsePgTimestamp } from "../../../src/postgres/index.js";

test("parsePgBigint parses string and number values", () => {
    expect(parsePgBigint("123")).toBe(123n);
    expect(parsePgBigint(12)).toBe(12n);
});

test("parsePgInt parses safe numeric values", () => {
    expect(parsePgInt("44")).toBe(44);
    expect(parsePgInt(8n)).toBe(8);
});

test("parsePgBigint returns bigint input as is", () => {
    expect(parsePgBigint(99n)).toBe(99n);
});

test("parsePgInt returns number input as is", () => {
    expect(parsePgInt(44)).toBe(44);
});

test("parsePgInt throws for unsafe integers", () => {
    expect(() => parsePgInt("9007199254740993")).toThrow(RangeError);
});

test("parsePgInt throws for non-numeric values", () => {
    expect(() => parsePgInt("abc")).toThrow(RangeError);
});

test("parsePgTimestamp keeps Date and parses ISO string", () => {
    const date = new Date("2026-03-12T10:00:00.000Z");

    expect(parsePgTimestamp(date)).toBe(date);
    expect(parsePgTimestamp("2026-03-12T11:00:00.000Z").toISOString()).toBe("2026-03-12T11:00:00.000Z");
});
