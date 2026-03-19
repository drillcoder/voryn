export const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === "object" && value !== null
);

export const toSafeInt = (value: unknown, label: string): number => {
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value)) {
            throw new Error(`Invalid ${label}: expected safe integer`);
        }

        return value;
    }

    if (typeof value === "string") {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed)) {
            throw new Error(`Invalid ${label}: expected safe integer`);
        }

        return parsed;
    }

    throw new Error(`Invalid ${label}: expected integer`);
};
