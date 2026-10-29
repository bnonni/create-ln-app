# Changelog

This file records the changes to the `create-ln-app` npm package in each release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The versions follow [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-10-29

### Added

- The CLI option `--nodes <n>`. It makes a network with n LND nodes, from 2 to 10. The default is 3. The node names come from one list: alice, bob, carol, dave, erin, frank, grace, heidi, ivan, and judy.
- `network/nodes.json` lists the LND nodes of a project. To add or remove a node, edit the file. The project README has the rules for the file.
- `npm run compose` writes `network/docker-compose.yml` from `network/nodes.json`. `npm run network` and `npm run doctor` run it first. Node n gets the host ports `8080+n` (REST), `10000+n` (gRPC), and `9734+n` (P2P).

### Changed

- The Docker Compose project name comes from the `name` in `package.json`. It is not `create-ln-app` for all projects. Thus, `npm run down` in one project does not stop the containers of a different project.
- `npm run bootstrap`, `npm run env`, and `npm run doctor` read `network/nodes.json`. The doctor checks the ports of all the nodes in the list.
- `npm run network`, `npm run down`, and `npm run reset` remove the containers of nodes that are not in the list.

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

[1.1.0]: https://github.com/bnonni/create-ln-app/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/bnonni/create-ln-app/releases/tag/v1.0.0
