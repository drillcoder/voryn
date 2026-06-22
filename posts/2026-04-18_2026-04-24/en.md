Period: April 18, 2026 - April 24, 2026.

This week I significantly reworked Voryn's worker architecture and moved the library closer to an API that can be used comfortably inside an application.

Previously, each worker handled its execution loop, dependency setup, and core data-processing logic at the same time. As the project grew, those classes became harder to test and extend.

What changed:

- moved core worker logic into separate services;
- kept lifecycle, scheduling, and shutdown responsibilities in workers;
- added a shared builder for assembling dependencies;
- made worker creation asynchronous;
- added PostgreSQL schema validation before startup;
- prepared public exports and the scoped @drillcoder/voryn npm package.

Each layer now has a clearer responsibility.

A service performs one unit of work: it reads data, updates state, and calls the required repositories. A worker manages the lifecycle: when to run the service, how often to repeat it, and how to shut down cleanly.

This separation made testing much simpler. Processing logic can be tested without timers or process lifecycle concerns, while worker tests can focus on creation, startup, shutdown, and resource cleanup.

A worker builder was added as a separate layer. It assembles the standard PostgreSQL dependencies, RPC source, and leader lock, while still allowing applications to provide their own implementations. The simple startup path stays short without taking control away from more advanced integrations.

Worker creation became asynchronous because the library now validates the PostgreSQL schema before returning a ready instance. If the database is not prepared, the error appears during creation instead of inside the first processing cycle.

At the end of the week, I cleaned up public exports, examples, and npm package settings. The library received the scoped name @drillcoder/voryn and started looking more like something that could be installed and integrated, rather than only run inside its own repository.

Next post: handling reorgs in the sequencer and strengthening data consistency during chain rollbacks.
