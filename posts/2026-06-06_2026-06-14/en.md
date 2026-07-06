Period: June 6, 2026 - June 14, 2026.

At this stage I moved Voryn toward a state where the library can be not only started, but also safely operated after failures.

The focus landed on three things: recovery for failed jobs, controlled reorg rollback, and release automation.

What changed:

- added retry all failed block recovery;
- changed reorg rollback to bounded ranges;
- removed the old delete-after API from repository contracts;
- simplified Prometheus metrics for failed blocks;
- clarified Voryn as a library;
- added semantic-release and npm Trusted Publishing;
- simplified public hex types;
- released versions 0.4.5 and 0.4.6.

The most practical change was recovery for all failed blocks. Before this, it was possible to retry one block or a block range. But after an RPC incident, the practical need is often to return all failed jobs to the queue.

That is what retryAllFailedBlocks is for. The runbook still says not to run recovery while the root cause is active. But once the cause is fixed, the operator does not have to manually discover ranges.

The second change was reorg rollback. Previously, rollback deleted data “after block N”. I changed this to a bounded range: from the block after the common ancestor to the current lastEnqueuedBlock. The old deleteAfterBlockNumber API is no longer needed.

This better matches how the pipeline thinks about data. A reorg does not mean “delete everything after N in an open-ended way”. It means “rollback this known tail and move the cursor back to the common ancestor”.

I also cleaned up Prometheus output. Details for individual failed blocks stay in the JSON snapshot, while Prometheus exposes failed jobs through the shared block job status counter. Prometheus is for gauges and alerts; snapshot is for details.

Another change was project positioning. In README and package metadata, Voryn became “a TypeScript library for reliable EVM indexing with PostgreSQL”. That is more accurate than the older ethers-based package description: the project had grown into an indexing pipeline.

At the end, I added semantic-release with Conventional Commits and npm Trusted Publishing. The release job runs after successful CI on main, calculates the next version, updates changelog/package files, creates a GitHub Release, and publishes to npm without a manual npm token.

The final cleanup was simplifying public hex types. Instead of branded aliases, the API now uses template literal types like 0x${string}. For users, this is easier: the types still describe hex-shaped values, but they do not force internal brands into application code.

This is the last post in the weekly format: after June 14, active development slowed down. From here, it makes more sense to write posts by release.

The main idea of the period: after observability, the next step was controllability - how to recover failed jobs, rollback a reorg tail safely, and publish versions without manual release routine.
