# Changelog

This file records the changes to the `create-ln-app` npm package in each release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The versions follow [Semantic Versioning](https://semver.org/).

## [1.4.0] - 2026-10-30

### Added

- A React JavaScript template. The CLI option `--template <name>` selects the template: `react-ts` (React and TypeScript) or `react` (React and JavaScript). The default is `react-ts`. Example: `npx create-ln-app my-lapp --template react`.
- A project from the `react` template has no TypeScript file and no `tsconfig` file. Each `.ts` file is a `.js` file and each `.tsx` file is a `.jsx` file. The API, the network, and the npm scripts are the same, but the project has no `typecheck` script.
- In the `react` template, the node clients and their comments point to `server/API.md` for the data and the errors of the API.

### Changed

- The CLI shows the template name in the "Made" line, for example `Made my-lapp in /home/me/my-lapp from the react template, with 3 LND nodes.`

## [1.3.0] - 2026-10-29

### Added

- Eclair 0.11.0 nodes, with the image `polarlightning/eclair:0.11.0`. In `network/nodes.json`, a node has the impl `lnd`, `cln`, or `eclair`. A network can have the 3 impls.
- The CLI value `--impl eclair`. It makes a project with only Eclair nodes.
- An Eclair client for the API server, `server/nodes/eclair.ts`. It uses the Eclair API. The API of the server and the error codes are the same for the 3 impls.
- `npm run env` writes the keys `ECLAIR_<NAME>_API_URL` and `ECLAIR_<NAME>_API_PASSWORD` for each Eclair node. An Eclair node uses the REST host port and the P2P host port of an LND node in the same position. It has no gRPC port.
- An Eclair node has no wallet of its own. It uses a bitcoind wallet with the node name. The node container makes the wallet before Eclair starts.
- `GET /api/nodes` sends the impl `eclair` for an Eclair node.
- `FLOW_NODES` selects the node pair of the integration test, for example `FLOW_NODES=alice,carol npm run test:integration`. The default is `alice,bob`.
- The project README has the `eclair-cli` command, the Eclair ports, the API password, and an Eclair API example.

### Changed

- bitcoind sends the ZMQ `hashblock` stream on port 28336 in the network. Eclair uses this stream.

## [1.2.0] - 2026-10-29

### Added

- Core Lightning (CLN) 25.12 nodes, with the image `polarlightning/clightning:25.12`. In `network/nodes.json`, a node has the impl `lnd` or `cln`. A network can have the two impls.
- The CLI option `--impl <impl>`. It sets the impl of all the nodes: `lnd` or `cln`. The default is `lnd`.
- A CLN client for the API server, `server/nodes/cln.ts`. It uses CLNRest. The API is the same for LND and CLN nodes.
- `npm run env` writes the keys `CLN_<NAME>_REST_URL`, `CLN_<NAME>_RUNE`, and `CLN_<NAME>_TLS_CERT_PATH` for each CLN node. The rune has no restrictions. A CLN node uses the same host ports as an LND node in the same position.
- `GET /api/nodes` sends the `impl` of each node.
- Each API error has a `code` field, for example `no_route` or `not_found`. The codes are the same for LND and CLN. `ApiError` in `frontend/src/api.ts` has the code. `server/API.md` has the table of codes.
- The project README has the `lightning-cli` command, the CLN ports, the rune, and a CLNRest example.

### Changed

- The message of a failed payment has the code, not the LND failure reason. For example, `alice: the payment failed: no_route` replaces `alice: the payment failed: FAILURE_REASON_NO_ROUTE`.
- The API server sends the nodes in name order.
- The LND client moved from `server/lnd.ts` to `server/nodes/lnd.ts`. It implements the node interface in `server/nodes/types.ts`.
- `npm run bootstrap` funds a CLN node to a `p2tr` address.

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

[1.3.0]: https://github.com/bnonni/create-ln-app/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/bnonni/create-ln-app/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/bnonni/create-ln-app/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/bnonni/create-ln-app/releases/tag/v1.0.0
