import type { WorkerLifecycle } from "../../../src/interfaces/worker-lifecycle.js";

export async function waitFor(
    condition: () => Promise<boolean>,
    timeoutMs = 8_000,
    intervalMs = 25,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (await condition()) {
            return;
        }

        await sleep(intervalMs);
    }

    throw new Error(`Condition was not met within ${String(timeoutMs)}ms`);
}

export async function sleep(durationMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
}

export async function stopWorkers(workers: readonly WorkerLifecycle[]): Promise<void> {
    await Promise.all(workers.map(async (worker) => worker.stop()));
}
