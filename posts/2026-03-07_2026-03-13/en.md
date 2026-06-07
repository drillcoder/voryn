Continuing the retrospective series about building Voryn. The posts are published now, but I am going through the project history week by week.

Period covered by this post: March 7, 2026 - March 13, 2026.

Library: https://github.com/drillcoder/voryn

This week Voryn started moving from an architectural skeleton toward the first real implementations around it.

The main focus was library infrastructure:

- added `ConsoleLogger`, so workers and services could produce readable logs during local development;
- renamed `contracts` to `interfaces`, because that better described the role of this layer;
- reorganized tests into folders aligned with the source structure;
- added branded hex types and validation helpers for hash, address, and data fields;
- implemented the first block source adapter based on `ethers`;
- started building the PostgreSQL layer: factory, client, parsers, and initial store implementations;
- added implementations and tests for chain cursor, raw blocks, event stream, transaction stream, and retention store.

For me, this week was about an important transition: interfaces stopped being only a description of the future system and started getting concrete implementations.

The PostgreSQL layer was the most important part of that shift. It is the place where the ingestion pipeline coordinates block jobs, raw data, canonical streams, and worker cursors.

I also started tightening the data boundaries. RPC responses can contain unexpected values, so hashes, addresses, and data fields should be validated before they move deeper into the pipeline.

The first week was about the foundation. The second week was about connecting that foundation to real data sources and storage.

Next post: how the PostgreSQL layer kept evolving and how Voryn moved closer to a complete pipeline.
