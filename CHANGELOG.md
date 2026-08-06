## [0.5.1](https://github.com/drillcoder/voryn/compare/v0.5.0...v0.5.1) (2026-08-06)

### Bug Fixes

* **postgres:** keep and monitor singleton leader locks ([9b45b49](https://github.com/drillcoder/voryn/commit/9b45b496c94c5d26ce5b6f6212ed10472cd19017))

## [0.5.0](https://github.com/drillcoder/voryn/compare/v0.4.7...v0.5.0) (2026-08-03)

### Features

* **head:** add tick phase logging ([d63c00f](https://github.com/drillcoder/voryn/commit/d63c00f99b2fcaffaa433b4f1e9c8cbc98b87023))
* **head:** log cursor initialization requirement ([d40a69d](https://github.com/drillcoder/voryn/commit/d40a69d58c7e68e2e514a9e5975ec06aa0c0a150))
* **rpc:** add request timeouts and disable 429 retries ([23dbdb5](https://github.com/drillcoder/voryn/commit/23dbdb57eb2a97cd32c5e108c6f50d2ae8af4f87))
* **workers:** standardize tick lifecycle logs ([e5655f1](https://github.com/drillcoder/voryn/commit/e5655f105ab164368bad911305de64592fa713fb))

### Bug Fixes

* **examples:** use block range recovery method ([7c7fbca](https://github.com/drillcoder/voryn/commit/7c7fbca468bc3e1d3245b05e632158d222696f7f))

## [0.4.7](https://github.com/drillcoder/voryn/compare/v0.4.6...v0.4.7) (2026-07-27)

### Bug Fixes

* **workers:** prevent singleton shutdown deadlock ([ae0824e](https://github.com/drillcoder/voryn/commit/ae0824e3f489b03714f36804b54b28f889f6d652))

## [0.4.6](https://github.com/drillcoder/voryn/compare/v0.4.5...v0.4.6) (2026-06-10)

### Bug Fixes

* **metrics:** remove failed block details from prometheus ([5cf4097](https://github.com/drillcoder/voryn/commit/5cf4097fc6f03ed0cbdf249bc184913d6e71c5c3))
