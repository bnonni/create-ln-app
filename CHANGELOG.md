# Changelog

This file records the changes to the `create-ln-app` npm package in each release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-28

The first release.

### Added

- The CLI: `npx create-ln-app <project-dir> [--skip-install]`. It copies the project template, runs `git init`, installs the npm packages, and runs `npm run doctor`.
- A local regtest network in Docker: Bitcoin Core 30.0 and 3 LND 0.20.0-beta nodes (alice, bob, and carol). Polar is not necessary.
- `npm run dev` starts the network, funds the nodes, writes `.env`, and starts the API server and the example app.
- An API server (Hono on Node 24). It holds the macaroons and the TLS certificates, so no secret goes into the browser. The contract is in `server/API.md`.
- An example app (Vite, React 19, and TypeScript). In the browser, a user selects a node, connects a peer, opens a channel, mines blocks, makes an invoice, and pays it.
- The project commands `network`, `down`, `reset`, `doctor`, `env`, and `test:integration`.
- The docs: a quick start, an [architecture](docs/architecture.md) page, and a [troubleshooting](docs/troubleshooting.md) page.

[1.0.0]: https://github.com/bnonni/create-ln-app/releases/tag/v1.0.0
