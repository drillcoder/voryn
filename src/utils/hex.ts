import { getBytes, isAddress, isHexString } from "ethers";
import type { AddressHex, ChainId, DataHex, HashHex } from "../types/chain.js";

export interface HexFieldContext {
    field: string;
    chainId: ChainId;
    blockNumber: number;
}

const buildContext = (context: HexFieldContext): string => (
    `${context.field} for chain ${String(context.chainId)} block ${String(context.blockNumber)}`
);

const buildError = (context: HexFieldContext, expected: string): Error => (
    new Error(`invalid ${buildContext(context)}: expected ${expected}`)
);

export const asHash32 = (value: string, context: HexFieldContext): HashHex => {
    if (!isHexString(value, 32)) {
        throw buildError(context, "0x-prefixed 32-byte hex");
    }

    return value as HashHex;
};

export const asAddress = (value: string, context: HexFieldContext): AddressHex => {
    if (!isHexString(value, 20) || !isAddress(value)) {
        throw buildError(context, "0x-prefixed 20-byte address");
    }

    return value as AddressHex;
};

export const asHexData = (value: string, context: HexFieldContext): DataHex => {
    try {
        getBytes(value);
    } catch {
        throw buildError(context, "0x-prefixed byte data");
    }

    return value as DataHex;
};
