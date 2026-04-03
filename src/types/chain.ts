type Brand<TValue, TName extends string> = TValue & { readonly __brand: TName };

export type ChainId = number;
export type BlockNumber = number;
export type Hex = `0x${string}`;
export type HashHex = Brand<Hex, "hash32">;
export type AddressHex = Brand<Hex, "address20">;
export type DataHex = Brand<Hex, "bytes">;
