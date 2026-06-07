This is the first post in a retrospective series about building Voryn. The posts are published now, but I will go through the project history week by week.

Period covered by this post: February 28, 2026 - March 6, 2026.

Library: https://github.com/drillcoder/voryn

This week I started building Voryn.

At the start, I focused on the core architecture: a TypeScript library for monitoring EVM-like networks, where blocks can be fetched, stored, and processed in strict order.

What was done during the first week:

- created the npm TypeScript package structure;
- added the initial PostgreSQL schema for block jobs, raw blocks, canonical data, and worker cursors;
- designed the core architecture for the indexing pipeline;
- introduced contracts for block sources, stores, reactions, logging, and leader locks;
- added the first workers: head, fetch, sequencer, retention, event reaction, and transaction reaction;
- configured ESLint with strict rules;
- added Jest and unit tests for the worker layer with full coverage at that stage.

The main architectural decision was to separate ingestion from reactions.

Ingestion is responsible for fetching blocks, storing raw data, and committing canonical data strictly in block order. Reaction workers read only confirmed canonical streams and run user-defined logic independently.

That gives the library a simple rule: the system should process blockchain data in order, but business logic should stay isolated and replaceable.

The first week was mostly about creating the base that future features could stand on.

Next post: what changed after the initial architecture started meeting real implementation details.
