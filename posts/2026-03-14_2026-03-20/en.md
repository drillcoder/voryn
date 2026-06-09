Period: March 14, 2026 - March 20, 2026.

This week Voryn moved much closer to a working PostgreSQL-backed pipeline.

The previous week was about the first store implementations. This one was about schema alignment, strict commits, and worker coordination through the database.

What changed:

- updated EthersBlockSource mapping for the current chain types;
- simplified hex validation and removed extra context-specific checks;
- aligned the canonical schema, SQL, types, stores, tests, and documentation;
- made createPostgresStores require PgPool for transaction support;
- implemented SequencerCommitStore for the new schema;
- added payload validation and strict row count checks during commit updates;
- implemented BlockJobQueueStore for block jobs;
- fixed stream store column names for the canonical schema;
- added a PostgreSQL LeaderLock implementation based on advisory locks.

The main part of the week was SequencerCommitStore.

It owns the most sensitive part of the pipeline: take a raw block, verify the link with the previous canonical block, write block/transactions/events, and move the cursor forward. This has to be atomic and strictly ordered.

BlockJobQueueStore was another important piece. Without a real queue, fetch workers cannot safely share work, retry failed jobs, and move block jobs between states.

The third important piece was LeaderLock. Critical workers like head, sequencer, and retention should run as singletons. For PostgreSQL, that became an advisory-lock-based implementation.

This week was about turning architecture rules into actual database-level guarantees.

Next post: how the pipeline started moving closer to an end-to-end flow.
