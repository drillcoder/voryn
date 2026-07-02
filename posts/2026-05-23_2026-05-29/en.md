Period: May 23, 2026 - May 29, 2026.

This week I continued moving Voryn toward a proper multi-chain runtime.

After the normalized storage work, the next important layer was operations. The library should behave predictably not only for one network, but for several of them: collect metrics, validate data sources, check the PostgreSQL schema, and keep retention safe.

What changed:

- added multi-chain PipelineMetrics;
- made Prometheus output cover all configured chains;
- taught EthersBlockSource to detect chainId from providers;
- simplified runtime options and examples;
- added GitHub Actions CI;
- updated test scripts and live RPC skip behavior;
- strengthened PostgreSQL schema validation;
- changed retention purge to bounded ranges.

The main part of the week was multi-chain metrics. Before this, the metrics config was tied to a single network. Now PipelineMetrics accepts a list of chains and returns one shared snapshot with per-chain state.

If the pipeline watches Ethereum, BNB Chain, and a few other EVM networks, I do not want a separate metrics setup for each one. It is cleaner to have one entry point that collects the state of all chain workers and exposes it in one shape.

Prometheus output became multi-chain as well. The library can expose a single metrics endpoint for all configured chains. Operationally, that means less glue around the library and a lower chance that one network disappears from monitoring by accident.

I also changed the ethers source setup. EthersBlockSource.create now receives providers and detects chainId through getNetwork. If the provider already knows its network, the library does not need the same value to be written again. It still validates empty provider lists and duplicate chain ids.

Runtime options and examples were simplified in the same week. As an API grows, configuration can easily become too nested. I tried to keep the options closer to how they would actually be used.

GitHub Actions CI was added as well. Changes started going through build and test checks outside my local machine. Alongside that, I updated test scripts and made live RPC tests easier to skip in environments without access to real RPC endpoints.

Another practical piece was PostgreSQL schema validation. Previously, validation mostly checked that required tables existed. Now it checks the schema more precisely: columns, types, nullable flags, primary keys, and important indexes. A schema mismatch should fail early instead of turning into odd worker behavior later.

Retention became safer too. Instead of deleting “everything up to block N”, the service now finds the oldest stored block and purges data through a bounded block range. This matches the actual storage state better and makes cleanup more controlled.

The main idea of the week: Voryn started moving from “the pipeline works” toward “the pipeline can be operated and observed in a multi-chain environment”.
