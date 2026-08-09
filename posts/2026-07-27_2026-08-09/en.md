Voryn reached its first stable release with version 1.0.0.

Throughout this period, I was trialing Voryn in a real project. Production-like workloads exposed bugs and edge cases that are difficult to find in isolated tests. Most of the changes below came directly from that experience.

The path to 1.0 went through versions 0.4.7, 0.5.0, and 0.5.1. The focus was worker shutdown, diagnostics, PostgreSQL leader lock monitoring, and RPC resilience.

What changed:

- fixed singleton workers hanging during shutdown;
- standardized cycle and HeadWorker phase logs;
- added RPC timeouts and disabled retries for HTTP 429;
- added PostgreSQL leader lock monitoring;
- added fallback RPC providers;
- configured Dependabot and upgraded the project to TypeScript 6.

The first problem was singleton worker shutdown. A worker could be waiting for its current tick or the delay between ticks, while its PostgreSQL lock was released too late. With an unlucky shutdown order, this could deadlock.

Now stop interrupts a pending delay, concurrent calls are coalesced, and the leader lock is released before the connection pool closes. Version 0.4.7 fixed the kind of issue that is hard to see locally and expensive in production.

In 0.5.0, I focused on observability and RPC behavior. All polling workers now emit the same cycle events, while HeadWorker adds checkpoints for loading the latest block and initializing its cursor. The logs show whether a worker is stuck, waiting for the next cycle, or preparing its initial state.

RPC calls also received a configurable timeout. Retries for 429 responses were disabled: when a provider is already rate-limiting requests, hidden retries add load and delay the pipeline's controlled retry.

The next issue went deeper. A PostgreSQL advisory lock belongs to a specific session. If that connection was lost, a process could continue behaving as if it were still the leader. In 0.5.1, the lock gained a dedicated connection, a heartbeat, and explicit lock-loss handling. The worker stops and reports the failure so the process manager can restart it.

The defining change for 1.0.0 was fallback RPC providers. Each chain can now have a primary and fallback source. If the primary returns an error or invalid data, the entire operation is retried through the fallback. Both providers are checked at startup and must point to the same chain.

This required changing the public configuration from standalone URLs to rpcConfig and rpcConfigs. Instead of hiding that incompatibility in a minor update, I used it to mark Voryn's 1.0.0 release.

Version 1.0.1 followed, while Dependabot took over dependency and CI updates.

The main idea of this stage: a reliable indexer must recognize when it has lost control of its infrastructure and move into a predictable state - stop, report the cause, or switch to a fallback source.
