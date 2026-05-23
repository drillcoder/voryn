import type { ChainId } from "../types/chain.js";

export function asChainId(value: bigint | number, label = "chain id"): ChainId {
    const chainId = Number(value);

    if (
        !Number.isSafeInteger(chainId)
        || chainId <= 0
        || (typeof value === "bigint" && BigInt(chainId) !== value)
    ) {
        throw new Error(`${label} is invalid: ${String(value)}`);
    }

    return chainId;
}
