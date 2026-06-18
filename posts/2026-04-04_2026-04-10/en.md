Period: April 4, 2026 - April 10, 2026.

This week Voryn moved from "it can be started" toward "its pipeline behavior can be verified across different scenarios".

After the repository-layer refactor, the focus shifted to runtime worker behavior, recovery around tricky cases, and tests that check whole flows rather than isolated functions.

What changed:

- added head rebase depth flow for the head worker;
- added batched sequencer commits with a configurable per-tick limit;
- renamed polling interval to delay between ticks and added worker activity logs;
- updated worker defaults and environment variables;
- split tests into unit, integration, e2e, and live-rpc groups;
- added integration and e2e scenarios for the main working flows;
- added a live RPC pipeline test;
- moved development documentation, worker examples, and dev tooling.

The main part of the week was the test matrix.

Before this, many individual components were already covered. But for this kind of library, that is not enough: head, fetch, sequencer, retention, and reaction workers need to work both independently and together while moving shared state forward.

That is why integration and e2e scenarios appeared: fetch retries, idempotency, startup from an empty state, concurrent fetch workers, retention boundary, multi-chain isolation, and reaction handler failures.

The second important topic was worker behavior over time.

Head worker received rebase depth flow to handle chain changes near the head more carefully. Sequencer received a per-tick batch commit limit so it does not try to process too much in one pass. Delay between ticks and activity logs made worker behavior easier to understand during startup and debugging.

Worker examples and development documentation were also useful. Once a library has multiple worker types and startup modes, examples stop being decoration and become part of the developer experience.

This week was about confidence: not just writing the pipeline, but starting to prove that it behaves predictably in real working scenarios.

Next post: how this base started turning into a more stable public API.
