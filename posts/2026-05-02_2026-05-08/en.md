Period: May 2, 2026 - May 8, 2026.

This week Voryn moved closer to a library that can not only be started, but also operated in a real service.

After reorg rollback, it became clear that correct block processing alone was not enough. In production, you need to quickly understand where the pipeline is, which stage is lagging, whether there are failed blocks, and why the sequencer stopped moving forward.

What changed:

- added a pipeline state snapshot;
- moved metrics into a public tool;
- added a metrics example;
- added data freshness, failed blocks, and reaction worker lag;
- added recovery for retrying failed block jobs;
- reached 100% unit coverage;
- updated the README and added Russian documentation.

PipelineMetrics collects state across the whole processing chain: current RPC head, head, fetch, and sequencer progress, block job statuses, failed blocks, and reaction worker lag.

This is not about nice charts by themselves. It is about answering simple operational questions: is the library catching up with the chain or stuck, are the data fresh or stale, and is the problem in fetch, sequencer, or a downstream handler.

I also added failed block job recovery. If a block exhausts its fetch attempts and is no longer retried automatically, it can be put back into processing manually: either a single block or a range. The sequencer also became better at explaining why it is waiting for the next raw block: the job is still being fetched, waiting for retry, or stuck in a failed state.

Another important step was testing. I brought unit coverage to 100%, especially around the new metrics, repository methods, runtime resolvers, and public exports. For a library with many background processes, this is not just a checkbox: regressions in cursor, retry, or status logic are too easy to notice only after the pipeline has already stopped.

At the end of the week, I rewrote the README: first improving the presentation, then making the English version primary and moving the Russian documentation to README.ru.md. This moved the project from “there is code and examples in the repository” toward “the project has a clear entry point”.

Next step: continue developing event and transaction handlers so application logic can be built more comfortably on top of the ingestion pipeline.
