import { getBytes, isAddress, isHexString } from "ethers";
import type { AddressHex, DataHex, HashHex, } from "../types/chain.js";

export const asHash32 = (value: string): HashHex => {
    if (!isHexString(value, 32)) {
        throw new Error("invalid hash: expected 0x-prefixed 32-byte hex");
    }

    return value as HashHex;
};

export const asAddress = (value: string): AddressHex => {
    if (!isHexString(value, 20) || !isAddress(value)) {
        throw new Error("invalid address: expected 0x-prefixed 20-byte address");
    }

    return value as AddressHex;
};

export const asHexData = (value: string): DataHex => {
    try {
        getBytes(value);
    } catch {
        throw new Error("invalid hex data: expected 0x-prefixed byte data");
    }

    return value as DataHex;
};
