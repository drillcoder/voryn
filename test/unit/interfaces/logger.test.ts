import { noopLogger } from "../../../src/interfaces/logger.js";

test("noop logger methods are no-op and do not throw", () => {
    expect(() => {
        noopLogger.debug("debug message");
        noopLogger.info("info message", { step: 1 });
        noopLogger.warn("warn message");
        noopLogger.error("error message", { reason: "boom" });
    }).not.toThrow();
});
