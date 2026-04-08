import { ConsoleLogger, type ConsoleLogWriter } from "../../../src/index.js";

const createWriter = (isTTY = false) => {
    const lines: string[] = [];
    const writer: ConsoleLogWriter = {
        isTTY,
        write: (message) => {
            lines.push(message);
        },
    };

    return { writer, lines };
};

test("console logger writes colored levels and sends warn/error to stderr", () => {
    const stdout = createWriter();
    const stderr = createWriter();
    const logger = new ConsoleLogger({
        colorize: true,
        timestamp: false,
        stdout: stdout.writer,
        stderr: stderr.writer,
    });

    logger.debug("debug message");
    logger.info("info message", { step: 1 });
    logger.warn("warn message");
    logger.error("error message");

    expect(stdout.lines).toEqual([
        "\u001b[36mDEBUG\u001b[0m debug message\n",
        "\u001b[32mINFO\u001b[0m info message {\"step\":1}\n",
    ]);
    expect(stderr.lines).toEqual([
        "\u001b[33mWARN\u001b[0m warn message\n",
        "\u001b[31mERROR\u001b[0m error message\n",
    ]);
});

test("console logger respects minLevel", () => {
    const stdout = createWriter();
    const stderr = createWriter();
    const logger = new ConsoleLogger({
        minLevel: "warn",
        colorize: false,
        timestamp: false,
        stdout: stdout.writer,
        stderr: stderr.writer,
    });

    logger.debug("debug message");
    logger.info("info message");
    logger.warn("warn message");
    logger.error("error message");

    expect(stdout.lines).toEqual([]);
    expect(stderr.lines).toEqual(["WARN warn message\n", "ERROR error message\n"]);
});

test("console logger includes timestamp when enabled", () => {
    const stdout = createWriter();
    const stderr = createWriter();
    const logger = new ConsoleLogger({
        colorize: false,
        timestamp: true,
        stdout: stdout.writer,
        stderr: stderr.writer,
    });

    logger.info("hello");

    expect(stdout.lines).toHaveLength(1);
    expect(stdout.lines[0]).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO hello\n$/
    );
    expect(stderr.lines).toEqual([]);
});

test("console logger serializes error and circular meta safely", () => {
    const stdout = createWriter();
    const stderr = createWriter();
    const logger = new ConsoleLogger({
        colorize: false,
        timestamp: false,
        stdout: stdout.writer,
        stderr: stderr.writer,
    });
    const circularMeta: Record<string, unknown> = {};
    circularMeta.self = circularMeta;

    logger.error("failed", { err: new Error("boom"), circularMeta });

    expect(stderr.lines).toHaveLength(1);
    expect(stderr.lines[0]).toContain("ERROR failed ");
    expect(stderr.lines[0]).toContain("\"name\":\"Error\"");
    expect(stderr.lines[0]).toContain("\"message\":\"boom\"");
    expect(stderr.lines[0]).toContain("\"stack\":");
    expect(stderr.lines[0]).toContain("\"self\":\"[circular]\"");
});

test("console logger enables colors automatically when output is TTY", () => {
    const stdout = createWriter(true);
    const stderr = createWriter(false);
    const previousNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;

    try {
        const logger = new ConsoleLogger({
            timestamp: false,
            stdout: stdout.writer,
            stderr: stderr.writer,
        });

        logger.info("tty output");

        expect(stdout.lines).toEqual(["\u001b[32mINFO\u001b[0m tty output\n"]);
    } finally {
        if (previousNoColor === undefined) {
            delete process.env.NO_COLOR;
        } else {
            process.env.NO_COLOR = previousNoColor;
        }
    }
});

test("console logger disables colors when NO_COLOR is set", () => {
    const stdout = createWriter(true);
    const stderr = createWriter(true);
    const previousNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";

    try {
        const logger = new ConsoleLogger({
            timestamp: false,
            stdout: stdout.writer,
            stderr: stderr.writer,
        });

        logger.warn("no color");

        expect(stderr.lines).toEqual(["WARN no color\n"]);
    } finally {
        if (previousNoColor === undefined) {
            delete process.env.NO_COLOR;
        } else {
            process.env.NO_COLOR = previousNoColor;
        }
    }
});

test("console logger uses default options when no options provided", () => {
    const previousNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;

    const stdoutWriteSpy = jest
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
    const stderrWriteSpy = jest
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

    try {
        const logger = new ConsoleLogger();

        logger.info("defaults");

        expect(stdoutWriteSpy).toHaveBeenCalledTimes(1);
        expect(stdoutWriteSpy.mock.calls[0][0]).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO defaults\n$/
        );
        expect(stderrWriteSpy).not.toHaveBeenCalled();
    } finally {
        stdoutWriteSpy.mockRestore();
        stderrWriteSpy.mockRestore();
        if (previousNoColor === undefined) {
            delete process.env.NO_COLOR;
        } else {
            process.env.NO_COLOR = previousNoColor;
        }
    }
});
