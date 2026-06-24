Period: April 25, 2026 - May 1, 2026.

This week I worked on one of the more uncomfortable parts of EVM indexing: reorgs.

As long as the chain moves linearly, the sequencer is straightforward: take a raw block, check its parent hash, move the block, transactions, and events into canonical tables, then advance the cursor.

But when the next block no longer extends the already committed chain, simply moving forward is not enough. Some canonical data may belong to a branch that is no longer the main one.

What changed:

- added common ancestor detection between the canonical chain and the current RPC state;
- taught the sequencer to roll back canonical blocks, transactions, events, raw blocks, and jobs after that ancestor;
- made the rollback transactional;
- added cursor locking for critical state changes;
- updated the sequencer worker example;
- released versions 0.1.2 and 0.1.3.

Now, when the parent hash does not match, the sequencer does not just fail and leave the database in an inconsistent state. It finds the latest point where the local canonical chain still matches the source, deletes data after that point, and moves the cursor back.

The important detail is that rollback touches several tables at once. If only canonical_blocks are deleted while events, transactions, or jobs from the old branch remain, the data starts to diverge. So rollback became a single operation over the whole sequencer state.

After that, I tightened cursor handling. During head rebase and sequencer rollback, the cursor is now reread with a lock inside the transaction. This protects against a process making a decision from stale state while another process has already changed it.

As a result, the library became better at handling blockchain reality: not only “read a block and write it”, but also “notice that history changed, roll back carefully, and continue from the correct place”.

Next step: make event and transaction processing more application-oriented, so custom reactions can be built on top of canonical data.
