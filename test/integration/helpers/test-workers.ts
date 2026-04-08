import { EventReactionWorker } from "../../../src/workers/event-reaction-worker.js";
import { FetchWorker } from "../../../src/workers/fetch-worker.js";
import { HeadWorker } from "../../../src/workers/head-worker.js";
import { RetentionWorker } from "../../../src/workers/retention-worker.js";
import { SequencerWorker } from "../../../src/workers/sequencer-worker.js";
import { TransactionReactionWorker } from "../../../src/workers/transaction-reaction-worker.js";

export class TestHeadWorker extends HeadWorker {
    runTick(): Promise<void> {
        return this.tick();
    }
}

export class TestFetchWorker extends FetchWorker {
    runTick(): Promise<void> {
        return this.tick();
    }
}

export class TestSequencerWorker extends SequencerWorker {
    runTick(): Promise<void> {
        return this.tick();
    }
}

export class TestRetentionWorker extends RetentionWorker {
    runTick(): Promise<void> {
        return this.tick();
    }
}

export class TestEventReactionWorker extends EventReactionWorker {
    runTick(): Promise<void> {
        return this.tick();
    }
}

export class TestTransactionReactionWorker extends TransactionReactionWorker {
    runTick(): Promise<void> {
        return this.tick();
    }
}
