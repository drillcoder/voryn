import { getBytes, isAddress, isHexString } from "ethers";
import type {
    AddressHex,
    ChainId,
    DataHex,
    HashHex,
} from "../types/chain.js";

export interface HexFieldContext {
    field: string;
    chainId: ChainId;
    blockNumber: number;
}

const buildContextError = (context: HexFieldContext, expected: string): Error => (
    new Error(
        `invalid ${context.field} for chain ${String(context.chainId)} ` +
            `block ${String(context.blockNumber)}: expected ${expected}`
    )
);

const buildError = (fieldName: string, expected: string): Error => (
    new Error(`invalid ${fieldName}: expected ${expected}`)
);

export const asHash32 = (value: string): HashHex => {
    if (!isHexString(value, 32)) {
        throw buildError("hash", "0x-prefixed 32-byte hex");
    }

    return value as HashHex;
};

export const asHash32WithContext = (value: string, context: HexFieldContext): HashHex => {
    if (!isHexString(value, 32)) {
        throw buildContextError(context, "0x-prefixed 32-byte hex");
    }

    return value as HashHex;
};

export const asAddress = (value: string): AddressHex => {
    if (!isHexString(value, 20) || !isAddress(value)) {
        throw buildError("address", "0x-prefixed 20-byte address");
    }

    return value as AddressHex;
};

export const asAddressWithContext = (value: string, context: HexFieldContext): AddressHex => {
    if (!isHexString(value, 20) || !isAddress(value)) {
        throw buildContextError(context, "0x-prefixed 20-byte address");
    }

    return value as AddressHex;
};

export const asHexData = (value: string): DataHex => {
    try {
        getBytes(value);
    } catch {
        throw buildError("hex data", "0x-prefixed byte data");
    }

    return value as DataHex;
};

export const asHexDataWithContext = (value: string, context: HexFieldContext): DataHex => {
    try {
        getBytes(value);
    } catch {
        throw buildContextError(context, "0x-prefixed byte data");
    }

    return value as DataHex;
};
