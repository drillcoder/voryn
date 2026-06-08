import type {
    CreateBlockJobRecoveryOptions,
    RetryAllFailedBlockJobsResult,
    RetryFailedBlockJobsResult,
} from "../src/index.js";
import { BlockJobRecovery } from "../src/index.js";
import { createDevLogger, envNumber, envValue, runWithErrorHandling } from "./runtime.js";

async function run(): Promise<void> {
    const options: CreateBlockJobRecoveryOptions = {
        dbUrl: envValue("DATABASE_URL", ""),
        logger: createDevLogger(),
        chainId: envNumber("VORYN_CHAIN_ID", "0"),
    };
    const recovery = await BlockJobRecovery.create(options);

    try {
        const allFailed = envValue("VORYN_RECOVERY_ALL_FAILED", "") === "true";
        const blockNumber = envOptionalNumber("VORYN_RECOVERY_BLOCK");
        const fromBlock = envOptionalNumber("VORYN_RECOVERY_FROM_BLOCK");
        const toBlock = envOptionalNumber("VORYN_RECOVERY_TO_BLOCK");
        if (allFailed && (blockNumber !== null || fromBlock !== null || toBlock !== null)) {
            throw new Error("Set VORYN_RECOVERY_ALL_FAILED without block or range variables");
        }
        if (blockNumber !== null && (fromBlock !== null || toBlock !== null)) {
            throw new Error(
                "Set either VORYN_RECOVERY_BLOCK or VORYN_RECOVERY_FROM_BLOCK/VORYN_RECOVERY_TO_BLOCK"
            );
        }

        let result: RetryAllFailedBlockJobsResult | RetryFailedBlockJobsResult;
        if (allFailed) {
            result = await recovery.retryAllFailedBlocks();
        } else if (blockNumber === null) {
            result = await recovery.retryFailedBlockRange(
                requiredRangeBlock(fromBlock, "VORYN_RECOVERY_FROM_BLOCK"),
                requiredRangeBlock(toBlock, "VORYN_RECOVERY_TO_BLOCK"),
            );
        } else {
            result = await recovery.retryFailedBlock(blockNumber);
        }

        console.log(JSON.stringify(result, null, 2));
    } finally {
        await recovery.close();
    }
}

function envOptionalNumber(name: string): number | null {
    const raw = envValue(name, "");
    if (raw === "") {
        return null;
    }

    return Number(raw);
}

function requiredRangeBlock(value: number | null, name: string): number {
    if (value === null) {
        throw new Error(`${name} is required when VORYN_RECOVERY_BLOCK is not set`);
    }

    return value;
}

runWithErrorHandling("block-job-recovery", run);
