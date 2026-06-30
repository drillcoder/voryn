Period: May 9, 2026 - May 15, 2026.

This week I continued moving Voryn toward a library that can be operated calmly inside a real application.

The previous week introduced a pipeline state snapshot. The next step was to make those metrics easier to expose, connect to monitoring, and reduce the amount of manual setup required when starting workers.

What changed:

- added Prometheus output for pipeline metrics;
- added max lag in blocks and seconds;
- taught the block source to read block headers without loading full transaction data;
- fixed head worker behavior after rebase and rollback;
- removed manual workerId from the fetch worker;
- removed manual lockKey from reaction workers;
- updated examples and README for the new API.

PipelineMetrics can now return not only the raw snapshot, but also Prometheus text exposition format. An application can call the method, return the result from its own metrics endpoint, and connect it to the usual monitoring stack.

I also added max lag. Previously, each stage had its own lag: head, fetch, and sequencer. But alerts often need one high-level signal: how far the pipeline is behind at the worst point. So max lag was added both in blocks and in time.

To calculate time-based lag, the metrics layer needed more than just the latest block number. It also needed timestamps. The block source therefore received separate methods for reading block headers without loading the full block with transactions and logs. This is cheaper and fits metrics better.

I also tightened the head worker. After a rebase, it now immediately enqueues the missing block jobs. And during a race with rollback, it no longer continues enqueueing from a stale cursor. This looks small, but it closes an unpleasant class of states where one part of the pipeline has already rolled back while another could continue from the old position.

At the end of the week, I simplified the public configuration. Fetch worker no longer requires a manual workerId: an instance id is generated internally. Reaction workers no longer require a manual lockKey: the key is derived from chainId, reaction type, and workerName. The external API became shorter, and copy-paste mistakes in examples became less likely.

Examples and README had to be updated as well: the extra parameters that previously had to be copied manually were removed from the public setup. This fits the broader goal of the week: less manual configuration and more predictable behavior out of the box.

The main idea of the week: Voryn should be correct internally, but also visible from the outside. If the pipeline is lagging or stuck, that should be easy to see without digging through the database.
