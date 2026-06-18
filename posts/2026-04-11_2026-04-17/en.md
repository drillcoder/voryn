Period: April 11, 2026 - April 17, 2026.

This week I simplified PostgreSQL setup for Voryn and took another step toward a more consistent public API.

Previously, the database schema was applied through a dedicated CLI command. That works for a quick start, but it does not fit naturally into real projects that already have their own migrations, deployment scripts, and CI/CD pipelines.

What changed:

- removed the dedicated initialization CLI command;
- added a function for applying a SQL file to PostgreSQL;
- added validation for the tables required by Voryn;
- exported the new functions through the library's public API;
- moved the fetch workerId into the shared worker configuration.

The main change was removing the PostgreSQL schema from a single prescribed startup flow.

Users can now apply the SQL through their own migrations, psql, or CI/CD. For projects that need a ready-made option, the library provides a small function that reads a SQL file, executes it, and logs the result.

A schema validation function was added alongside it. It checks that the database contains the tables required by the pipeline. This makes configuration problems visible during startup instead of after a worker has already started processing data.

I also moved the fetch workerId into its configuration. It is a small change, but it makes worker creation more consistent: all parameters describing the worker's behavior and identity now live in one place.

This week was about integration. A library should not dictate how an application manages its database. It should provide clear building blocks that fit into existing infrastructure.

Next post: how schema validation became part of worker creation and how a more convenient API for starting workers began to take shape.
