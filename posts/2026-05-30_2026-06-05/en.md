Period: May 30, 2026 - June 5, 2026.

This week Voryn became less like “a set of workers in code” and more like a library that can be run and supported in a live system.

The focus was not a new business feature. It was the operational layer: operations documentation, a stable public API, diagnostic logs, and cleaner reorg handling.

What changed:

- added operations runbooks;
- documented startup, scaling, monitoring, recovery, and common incidents;
- defined an explicit public API from the package root;
- documented package imports and the SQL schema path;
- added diagnostic logging for head, sequencer, and retention;
- moved reorg handling to light block reads;
- added optional git identity env for dev tools.

The biggest part of the week was operations documentation. The project already had README files, architecture docs, and a database schema, but it still needed a practical answer to: “How do I operate this in a real system?”.

The runbook now describes worker roles, startup order, which processes are singleton-style, and which ones can be scaled horizontally. I also documented fetch scaling: when to add FetchWorker processes, when to increase fetchConcurrency, and why RPC providers should not be pushed blindly with parallel requests.

Another important section covers reaction workers and retention. Reaction workers do not block ingestion, but their lag must stay inside the retention window. If a reaction falls too far behind, retention can delete old rows before the handler processes them. The runbook now connects reaction lag, retentionDepthBlocks, and alerts explicitly.

Recovery scenarios were documented too: how to retry failed blocks, when not to do it, and how to separate RPC issues from schema or data issues.

The second large topic was the public API. Previously, index.ts exported almost everything through export *. That is convenient early on, but it is not great for a library: users cannot easily tell what is stable contract and what is internal detail. Now exports are listed explicitly, and the README states that the stable import path is the package root.

I also moved options and recovery types into public interfaces. Workers, metrics, recovery, logger, PostgreSQL helpers, and repositories now look intentional instead of leaking out through broad exports.

Diagnostic logging improved as well. Head logs observed state and rebase decisions. Sequencer gives clearer reasons for being blocked: missing job, failed job, block not fetched yet, or parent hash mismatch. Retention logs why purge was skipped and which delete stage is running.

One internal improvement was light block reads for reorg handling. When services only need hash or parentHash, they no longer pull full block data. This reduces unnecessary source work.

The main idea of the week: the library started giving operators better tools to understand what is happening, where the pipeline stopped, and how to recover safely.
