import { asErrorMessage } from "../src/utils/errors.js";

test("asErrorMessage returns message from Error", () => {
    expect(asErrorMessage(new Error("boom"))).toBe("boom");
});

test("asErrorMessage converts non-error values to string", () => {
    expect(asErrorMessage("plain text")).toBe("plain text");
    expect(asErrorMessage(42)).toBe("42");
    expect(asErrorMessage({ foo: "bar" })).toBe("[object Object]");
});
