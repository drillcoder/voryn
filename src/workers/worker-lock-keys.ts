import { createHash } from "node:crypto";
import type { ReactionWorkerOptions } from "../interfaces/runtime.js";

export const HEAD_WORKER_LOCK_KEY_BASE = 10_000_000n;
export const SEQUENCER_WORKER_LOCK_KEY_BASE = 20_000_000n;
export const RETENTION_WORKER_LOCK_KEY_BASE = 30_000_000n;

export type ReactionLockKind = "event" | "transaction";

export function buildReactionWorkerLockKey(kind: ReactionLockKind, config: ReactionWorkerOptions): bigint {
    const lockScope = `voryn:reaction:${kind}:${String(config.chainId)}:${config.workerName}`;
    const hash = createHash("sha256").update(lockScope).digest();

    return hash.readBigInt64BE(0);
}
