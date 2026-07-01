Period: May 16, 2026 - May 22, 2026.

This week I changed Voryn's internal pipeline model.

Previously, fetch stored a downloaded block as a raw payload, and the sequencer later expanded it into canonical tables. That worked, but over time it got in the way: data was duplicated, repository contracts grew heavier, and reaction and retention layers depended on a separate canonical representation.

What changed:

- removed raw chain data storage;
- moved the PostgreSQL schema to normalized blocks, transactions, and events tables;
- taught the fetch worker to write downloaded data directly into those tables;
- turned the sequencer into a commit layer over fetched block jobs;
- moved reactions, retention, and metrics to the new storage model;
- added parallel processing for fetch jobs;
- added recovery from orphan block data;
- simplified reaction services and runtime options.

The main change: block data is now stored once, in normalized form. Fetch worker reads a block from RPC, writes the header, transactions, and events, then marks the job as fetched.

Sequencer no longer expands a raw payload. Its job is narrower: take the next fetched job, check the parent hash, verify that the block extends the committed chain, then advance the cursor and mark the job as committed.

This separation made the pipeline easier to reason about. Fetch loads and stores data. Sequencer handles ordering, reorg protection, and the committed position. Reaction workers read only data up to the committed block, so they do not see blocks already fetched but not yet confirmed by sequencer.

Reaction cursors changed as well. Instead of seq, they now store a position: block number, transaction index, and log index when needed. This matches the data shape better and removes the dependency on an artificial sequence id.

I also added fetch concurrency. A single fetch worker can now process several claimed jobs in parallel within one tick. For RPC-heavy workloads, this is more useful than only starting more processes: concurrency is explicit while PostgreSQL claims still preserve safety.

Another practical detail is orphan block data recovery. If a previous fetch attempt wrote part of the data but did not finish the job correctly, the next attempt clears data for that block number and writes it again in one transaction. This protects the pipeline from partially written state.

At the end of the week, I merged event and transaction reactions into shared service logic, added function-style handlers, and added logLevel to runtime options. The public API became simpler, while the internal model became closer to how the data lives in the database.

The main idea of the week: Voryn stopped being a pipeline that moves raw payloads between layers. It became more like a system with normalized storage, an explicit committed position, and separate layers for fetch, sequencing, and reactions.
