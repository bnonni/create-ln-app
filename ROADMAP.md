# Roadmap to MVP 1.0

Status: accepted, 2026-10-27. Audit base: commit `d4ce9d7`.

This repo is the main `create-ln-app` project. It started as a fork of [ATLBitLab/create-ln-app](https://github.com/ATLBitLab/create-ln-app) (formerly `terminus-btc/create-ln-app`). The original repo is old and does not get updates.

## Goal

`create-ln-app` is "create-react-app" for the Bitcoin Lightning Network. One command must give a developer two things:

1. A local regtest network: Bitcoin Core and LND nodes, funded and ready.
2. An example Lightning app (Lapp) that connects to that network.

The developer then changes the example app into their own Lapp. They do not configure nodes, macaroons, or TLS by hand.

## Definition of done for 1.0

Release 1.0 when these 5 checks pass in CI and on a clean macOS and Linux machine:

1. `npx create-ln-app my-lapp` makes a new project.
2. `npm run dev` in that project starts the network, funds the nodes, and starts the app. Polar is not necessary.
3. In the browser, a user can select a node, connect a peer, open a channel, mine blocks, make an invoice, and pay it.
4. No macaroon or other secret goes into git or into the browser bundle.
5. The README quickstart takes less than 5 minutes after Node and Docker are installed.

## Work protocol: one chunk per session

All work happens in chunks. One chunk must fit in 20% or less of the context window. After each chunk, run `/save` and then `/clear`.

1. **Start.** Read the session handoff in memory. Then read only your chunk entry, for example `grep -A4 '\*\*C1\.1 ' ROADMAP.md`.
2. **Read little.** Read only the files on the "Read" line. Pipe long output (installs, Docker logs, test runs) through `tail` or `grep`. Use a subagent for wide searches.
3. **Stay small.** A chunk changes 8 files or fewer (file moves do not count). If a chunk needs more, stop at a clean point, commit, and split the chunk in this file.
4. **Finish.** Run the exit check. Keep `npm run lint` and `npm run typecheck` green. Commit without a signature. Mark the chunk `[x]` in this file.
5. **Hand off.** Run `/save`, then `/clear`. At the end of a milestone, the owner signs, pushes, and opens a PR.

## Conventions

1. Scripts and the server are TypeScript. They run with Node 24 native type stripping. Use only erasable syntax and `.ts` import extensions. Do not add tsx or ts-node.
2. Node does not strip types in `node_modules`. The published CLI (M4) must compile to JavaScript.
3. Use one branch per milestone: `m1-network`, `m2-api`, `m3-app`, `m4-cli`, `m5-release`.
4. After C4.1, all app paths are relative to `packages/create-ln-app/template/`.

## Decisions

Decisions 4 and 5 have owner confirmation (2026-10-27). The owner can change decisions 1 to 3 before the related chunk starts.

1. **Ship a CLI.** `npx create-ln-app <name>` replaces "fork this repo". The npm name `create-ln-app` is free (checked 2026-10-27).
2. **Add a thin API server (Hono on Node 24).** The browser talks only to this server. The server talks to LND and bitcoind. This keeps macaroons out of the browser, removes the TLS and CORS problems, and gives access to bitcoind RPC to mine blocks.
3. **Use Vite, React, TypeScript, and plain CSS.** Replace Create React App. Remove MUI and styled-components. Ship one template (TypeScript) in 1.0.
4. **Own the network config. Use LND only in 1.0.** Remove the Polar export dependency. Latest tags on 2026-10-27: `polarlightning/lnd:0.20.0-beta`, `polarlightning/bitcoind:30.0`, `lightninglabs/lnd:v0.21.5-beta`.
5. **This fork is the main project.** Detach it from the ATLBitLab fork network. Use `bnonni/create-ln-app` in all URLs. Publish to npm from the owner account. Keep the original MIT copyright line.

## Audit (commit `d4ce9d7`)

M0 fixed the hygiene problems. These blockers remain. M1 to M3 fix them.

| # | Problem | Fixed in |
|---|---|---|
| 1 | The env script writes `NODE_1_*`. The app reads `REACT_APP_NODE_1_*`. The app gets no credentials. | C3.2 |
| 2 | `export.json` contains absolute macaroon paths from one Mac. The env script fails on all other machines. | C1.3 |
| 3 | `npm start` starts the env script, Docker, and the app at the same time. The env script runs before LND writes the macaroons. | C1.4 |
| 4 | The browser calls LND REST directly. The self-signed TLS cert and CORS block the calls. | C2.1, C3.2 |
| 5 | Only "list peers" calls LND, with the wrong path. The other steps are stubs. Nothing funds the wallets. | C1.2, C2.2 to C3.4 |

## Milestones

Estimates are for one developer who knows TypeScript and LND. Total: 15 to 22 work days.

| Milestone | Result | Chunks | Estimate |
|---|---|---|---|
| M0 Clean base | Repo is clean. CI runs. | done | 1-2 days |
| M1 Regtest network | `npm run dev` gives 3 funded LND nodes. | C1.1 to C1.4 | 3-4 days |
| M2 API server | The full payment flow works with `curl`. | C2.1 to C2.4 | 3-4 days |
| M3 Example Lapp | The full payment flow works in the browser. | C3.1 to C3.4 | 3-5 days |
| M4 CLI | `npx create-ln-app` works. | C4.1 to C4.4 | 3-4 days |
| M5 Release 1.0 | E2E test in CI, docs, npm publish. | C5.1 to C5.3 | 2-3 days |

### M0: Clean base

- [x] Code: remove `frontend/.env` and unused files, rewrite the README, add `lint`, `typecheck`, and CI. Branch `chore/m0-clean-base`.
- [ ] Owner: detach the fork: **Settings > General > Danger Zone > Leave fork network**. The fork has 0 child forks, 0 issues, and 0 stars, so it loses no data. This change is permanent. Reference: [Detaching a fork](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/detaching-a-fork).
- [ ] Owner: open a PR for `chore/m0-clean-base` and make sure that CI is green. Detach first. Before the detach, `gh pr create` targets ATLBitLab, so use `gh pr create -R bnonni/create-ln-app --base master`.

### M1: Regtest network (branch `m1-network`)

- [x] **C1.1 Compose file.** Create `network/docker-compose.yml`: 1 bitcoind and 3 LND nodes (alice, bob, carol).
  - Do: keep the current ports. Pin versions. Add health checks. Add `--tlsextraip=127.0.0.1` to each LND node. Store data in `network/data/` and ignore it in git. Update the npm scripts and the README "Network reference" to the new paths. Delete `backend/docker/compose/docker-compose.yml`.
  - Decide: use the Polar images if `docker manifest inspect` shows amd64 and arm64. If not, use `lightninglabs/lnd`.
  - Read: `backend/docker/compose/docker-compose.yml`, `package.json`, `README.md` ("Network reference" only).
  - Exit: `docker compose -f network/docker-compose.yml up -d --wait` exits 0. `lncli -n regtest getinfo` works in all 3 LND containers. Then run `down`.
- [x] **C1.2 Bootstrap script.** Add `scripts/bootstrap.ts` and `npm run bootstrap`.
  - Do: wait for healthy containers. Fund each LND wallet: mine 1 block to a new address of each node, then mine 100 blocks (no bitcoind wallet is necessary). Wait until each node shows `synced_to_chain: true`. Use `docker compose exec` with `bitcoin-cli` and `lncli`. Run `lncli` as the `lnd` user (`exec -u lnd`). Skip the funding if the balance is already more than 0.
  - Also: add a root `tsconfig.json` (`noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`), `typescript` and `@types/node` as dev dependencies, and root files in `typecheck`.
  - Read: `network/docker-compose.yml`, `package.json`.
  - Exit: `npm run bootstrap` passes 2 times in sequence. Each node has a confirmed balance more than 0.
- [x] **C1.3 Env script.** Add `scripts/env.ts`, `npm run env`, and `.env.example`.
  - Do: for each node, write `LND_<NAME>_REST_URL`, `LND_<NAME>_MACAROON_HEX`, and `LND_<NAME>_TLS_CERT_PATH` to a root `.env`. Also write `BITCOIND_RPC_URL`, `BITCOIND_RPC_USER`, and `BITCOIND_RPC_PASS`. If the host cannot read a file, read it with `docker compose exec`. Delete `scripts/setup.env.cjs` and `backend/`.
  - Read: `network/docker-compose.yml`, `scripts/setup.env.cjs`, `package.json`.
  - Exit: with values from `.env`, `curl --cacert <tls.cert> -H "Grpc-Metadata-macaroon: <hex>" https://127.0.0.1:8081/v1/getinfo` returns the alice pubkey.
- [x] **C1.4 Dev command.** Add `npm run network`, `npm run dev`, `npm run down`, and `npm run reset`.
  - Do: `network` runs `docker compose up`, `bootstrap`, and `env` in sequence. `dev` runs `network`, then the frontend. `reset` deletes the node data in `network/data/`, but keeps `network/data/.gitkeep`. On Linux, Docker creates a missing bind-mount directory as root, and then the user cannot delete it. Remove the old `start`, `watch:*`, and `start:backend:*` scripts. Update the README "Quick start".
  - Read: `package.json`, `README.md` ("Quick start" only).
  - Exit: on a clean clone, `npm run dev` gives 3 funded nodes and the app. After `npm run reset`, `network/data/` contains only `.gitkeep`. Owner: run the same check on macOS (Apple Silicon).

### M2: API server (branch `m2-api`)

- [x] **C2.1 Server and LND client.** Add `server/` (Hono on `@hono/node-server`) and `npm run server`.
  - Do: add `server/lnd.ts`, a typed LND REST client that trusts each node TLS cert (`undici` `Agent` with `ca`). Add `GET /api/health` and `GET /api/nodes` (name, pubkey, alias, balance, channel count). Use `API_PORT` (default 3001). Make `npm run dev` start the server and the frontend in parallel.
  - Read: `.env.example`, `package.json`.
  - Exit: `curl localhost:3001/api/nodes` returns 3 nodes with pubkeys and balances more than 0.
- [x] **C2.2 Peers, channels, and mine.** Add `server/bitcoind.ts`, a JSON-RPC client.
  - Do: add `POST /api/mine` (`{ blocks }`), `POST /api/nodes/:name/peers` (`{ peer }`), and `POST /api/nodes/:name/channels` (`{ peer, amountSats }`). Add the channel list to `GET /api/nodes`. Return JSON errors with correct HTTP status codes.
  - Read: `server/lnd.ts`, the server entry file.
  - Exit: with `curl`, alice connects to bob, opens a 1,000,000 sat channel, and mines 6 blocks. Then `GET /api/nodes` shows an active channel.
- [x] **C2.3 Invoices and payments.** Add the payment endpoints and the API contract.
  - Do: add `POST /api/nodes/:name/invoices` (`{ amountSats, memo }`), `GET /api/nodes/:name/invoices/:hash`, and `POST /api/nodes/:name/payments` (`{ paymentRequest }`). For payments, use LND `POST /v2/router/send`. It streams JSON lines: read until `SUCCEEDED` or `FAILED`. Write `server/API.md` with each endpoint, body, and response.
  - Read: `server/lnd.ts`, the server entry file.
  - Exit: with `curl`, bob makes a 1,000 sat invoice, alice pays it, and the invoice lookup shows `SETTLED`.
- [x] **C2.4 Integration test.** Add `server/flow.test.ts` (`node:test`) and `npm run test:integration`.
  - Do: run the full flow against the live network: connect, open channel, mine, invoice, pay, settled. The test must pass on a new network and on a network that already has a channel.
  - Read: `server/API.md`.
  - Exit: `npm run reset && npm run network && npm run test:integration` passes. A second `npm run test:integration` also passes.

### M3: Example Lapp (branch `m3-app`)

- [x] **C3.1 Vite migration.** Replace Create React App with Vite (React, TypeScript) in `frontend/`.
  - Do: keep the current UI. Replace MUI and styled-components with plain CSS and a native `<select>`. Replace ESLint with oxlint (decision 2026-10-28: typescript-eslint does not support TypeScript 7; the create-vite template uses oxlint). Proxy `/api` to the server. Keep `lint` and `typecheck`. Add `build`. Update the app port in the README.
  - Read: `frontend/package.json`, `frontend/src/App.tsx`, `frontend/src/index.tsx`, `frontend/src/components/Page.tsx`.
  - Exit: `npm run lint`, `npm run typecheck`, and `npm --prefix frontend run build` pass.
- [x] **C3.2 API client and node state.** Add `frontend/src/api.ts`, a typed client for `server/API.md`.
  - Do: load the node list from `GET /api/nodes`. Show the balance and channels of the selected node, with a refresh button. Delete `Env.tsx` and the macaroon code in `LightningStore.ts`.
  - Done: `api.ts` has a function for each endpoint and replaces all of `LightningStore.ts`. `Page.tsx` keeps the node state. `components/NodeInfo.tsx` shows the selected node.
  - Read: `server/API.md`, `frontend/src/components/Page.tsx`, `frontend/src/lightning/LightningStore.ts`.
  - Exit: `curl` of `/api/nodes` through the Vite proxy returns 3 nodes. `grep -ri macaroon frontend/src` returns nothing. The build passes.
- [ ] **C3.3 Peer, channel, and mine steps.** Connect these 3 steps to the API.
  - Do: show a busy state and the API error for each step.
  - Read: `frontend/src/api.ts`, `frontend/src/components/Page.tsx`.
  - Exit: lint, typecheck, and build pass. Owner: in the browser, alice gets an active channel to bob (about 2 minutes).
- [ ] **C3.4 Invoice and pay steps.** Connect these 2 steps to the API.
  - Do: show the invoice status until it is `settled`. Add a short comment at each step that tells the developer where to add their own feature.
  - Read: `frontend/src/api.ts`, `frontend/src/components/Page.tsx`.
  - Exit: lint, typecheck, and build pass. Owner: complete all 6 steps in the browser in less than 5 minutes.

### M4: CLI (branch `m4-cli`)

- [ ] **C4.1 Workspace layout.** Move the app into `packages/create-ln-app/template/`.
  - Do: move `network/`, `scripts/`, `server/`, `frontend/`, `.env.example`, and a template README. Rename the template `.gitignore` to `gitignore`, because npm removes `.gitignore` files on publish. Make the root an npm workspace. Update the CI paths.
  - Read: root `package.json`, `.github/workflows/ci.yml`.
  - Exit: the CI steps pass locally. `npm run dev` in the template folder still works.
- [ ] **C4.2 CLI command.** Add `packages/create-ln-app/src/cli.ts`. Compile it to JavaScript with `tsc` in a `prepack` script.
  - Do: check Node 24 or later first. Copy the template, rename `gitignore` to `.gitignore`, set the package name, run `npm install` and `git init`, and show the next steps. Add `--skip-install`.
  - Read: `packages/create-ln-app/package.json`.
  - Exit: `npm pack`, then `npx ./create-ln-app-<version>.tgz /tmp/x` makes a project where `npm run lint` and `npm run typecheck` pass.
- [ ] **C4.3 Preflight check.** Add `scripts/doctor.ts` and `npm run doctor` to the template. The CLI runs it in the new project after install.
  - Do: check that the Docker daemon runs, that `docker compose version` works, and that ports 8081-8083, 10001-10003, 9735-9737, and 18443 are free. Show one fix for each failed check.
  - Read: `packages/create-ln-app/src/cli.ts`, the template `package.json`.
  - Exit: with Docker stopped, `npm run doctor` fails and shows the fix. With Docker on, it passes.
- [ ] **C4.4 Prerelease.** Set version `0.9.0` and the `bin`, `files`, and `engines` fields.
  - Do: run `npm publish --dry-run`. Write the publish steps in `CONTRIBUTING.md`.
  - Read: `packages/create-ln-app/package.json`.
  - Exit: the dry run lists only the CLI build and the template. Owner: run `npm publish --tag next`, then test `npx create-ln-app@next my-lapp && cd my-lapp && npm run dev` on clean macOS and Linux machines.

### M5: Release 1.0 (branch `m5-release`)

- [ ] **C5.1 E2E test.** Add a Playwright test for the 6 browser steps.
  - Do: add a CI job that packs the CLI, makes a project, runs `npm run network`, and runs Playwright.
  - Read: `.github/workflows/ci.yml`, the template `frontend/src/components/Page.tsx`.
  - Exit: the E2E test passes locally. Owner: the E2E job passes on the PR.
- [ ] **C5.2 Docs.** Write the user docs.
  - Do: rewrite the README quickstart for `npx create-ln-app`. Add `docs/architecture.md` (browser, API server, nodes) and `docs/troubleshooting.md` (ports, Docker memory, Apple Silicon, `npm run reset`).
  - Read: `README.md`, the template `server/API.md`.
  - Exit: owner: a new user follows the README to a paid invoice in less than 5 minutes.
- [ ] **C5.3 Landing page and release.** Prepare `v1.0.0`.
  - Do: select the landing page for `create-ln-app.dev`. GitHub Pages serves the repo root now, so `README.md` is the landing page. Remove the old to-do page in `docs/index.html`. Add `CHANGELOG.md`. Set version `1.0.0`.
  - Read: `docs/index.html`, the CLI `package.json`.
  - Exit: all 5 checks in "Definition of done for 1.0" pass. Owner: tag `v1.0.0`, merge, and run `npm publish`.

## After 1.0

These items are not in the MVP. Do them after the release, in this order:

1. Core Lightning (CLN) and Eclair nodes, for example `--impl cln`.
2. A network size option, for example `--nodes 5`.
3. More templates: JavaScript, Next.js.
4. More install options: Homebrew formula, `curl | bash` installer, Windows (WSL2).
5. Signet support and more examples (LNURL, Lightning Address, WebLN).
