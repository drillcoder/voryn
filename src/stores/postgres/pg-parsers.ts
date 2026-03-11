export function parsePgBigint(value: bigint | number | string): bigint {
    if (typeof value === "bigint") {
        return value;
    }

    return BigInt(value);
}

export function parsePgInt(value: bigint | number | string): number {
    if (typeof value === "number") {
        return value;
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
        throw new RangeError(`Integer value is outside Number safe range: ${String(value)}`);
    }

    return parsed;
}
