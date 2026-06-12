Period: March 21, 2026 - March 27, 2026.

This week Voryn moved much closer to something that can be started locally and exercised as a real working pipeline.

Before this, most of the work was inside the architecture: stores, commit flow, block queue, and leader lock. Now the focus shifted toward developer experience, worker startup, and PostgreSQL behavior under heavier data.

What changed:

- added a Docker Compose workflow for local development;
- added Makefile commands for environment startup, builds, tests, and database initialization;
- added .env.example for local configuration;
- refactored CLI commands for head, fetch, sequencer, and retention workers;
- added logging around PostgreSQL initialization;
- simplified EthersBlockSource by moving it to a single provider;
- allowed null chain id for transactions coming from ethers;
- removed the unused postgres factory;
- added batch inserts in SequencerCommitStore to avoid PostgreSQL parameter limits;
- switched retention cleanup to a block boundary;
- reworked retention around block depth, purge counters, and logging;
- split RPC and polling environment variables by worker;
- added poll interval to the worker startup log.

The main theme of the week was local startup.

Voryn started gaining the everyday tooling around the library: docker compose, Makefile, .env.example, and CLI commands for individual workers. This does not look like a big external feature, but it is what makes the full flow easy to verify: start the database, run head, fetch, sequencer, retention, and watch how they behave together.

The second important part was PostgreSQL reliability.

Batch inserts in SequencerCommitStore handle a practical limit: large blocks can contain many transactions and events, while PostgreSQL limits the number of parameters in a query. Writes need to be split into safe batches without breaking commit atomicity.

Retention also moved closer to real usage. Instead of abstract cleanup, it started working from a block boundary and block depth. Logs and purge counters made the behavior easier to understand in operation.

This week was about moving from "the code exists" to "this can be started, configured, and observed".

Next post: how the project moved further toward a production-ready runtime.
