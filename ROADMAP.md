# Roadmap to MVP 1.0

Status: accepted, 2026-10-27. Audit base: commit `d4ce9d7`.

This repo is the main `create-ln-app` project.

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
5. **This fork is the main project.** Detach it from the fork network. Use `bnonni/create-ln-app` in all URLs. Publish to npm from the owner account. The MIT copyright line names `bnonni` (decision 2026-10-28).

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
- [ ] Owner: open a PR for `chore/m0-clean-base` and make sure that CI is green. Detach first. Before the detach, `gh pr create` targets the parent repo, so use `gh pr create -R bnonni/create-ln-app --base master`.

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
- [x] **C3.3 Peer, channel, and mine steps.** Connect these 3 steps to the API.
  - Do: show a busy state and the API error for each step.
  - Done: the `useStep` hook in `Page.tsx` keeps the busy state, the error, and the result text of a step. Step 1 has a peer select. Step 2 opens a 1,000,000 sat channel. Step 3 mines 6 blocks and loads the nodes again after 2 s, because LND takes some time to see the blocks.
  - Read: `frontend/src/api.ts`, `frontend/src/components/Page.tsx`.
  - Exit: lint, typecheck, and build pass. Owner: in the browser, alice gets an active channel to bob (about 2 minutes).
- [x] **C3.4 Invoice and pay steps.** Connect these 2 steps to the API.
  - Do: show the invoice status until it is `settled`. Add a short comment at each step that tells the developer where to add their own feature.
  - Done: step 4 requests a 1,000 sat invoice from the peer and loads its status each second until it is `settled` or `canceled`. Step 5 pays the invoice. If LND is not ready after a mine, step 5 sends the payment again, up to 5 times. Each step has a "Your feature" comment.
  - Read: `frontend/src/api.ts`, `frontend/src/components/Page.tsx`.
  - Exit: lint, typecheck, and build pass. Owner: complete all 6 steps in the browser in less than 5 minutes.

### M4: CLI (branch `m4-cli`)

- [x] **C4.1 Workspace layout.** Move the app into `packages/create-ln-app/template/`.
  - Do: move `network/`, `scripts/`, `server/`, `frontend/`, `.env.example`, and a template README. Rename the template `.gitignore` to `gitignore`, because npm removes `.gitignore` files on publish. Make the root an npm workspace. Update the CI paths.
  - Done: the template is a standalone npm project with its own lockfiles. It is not a workspace member, so a new project gets the same files. The root workspace has only the CLI package. The root `install:all`, `dev`, `lint`, `typecheck`, and `build` scripts run the template scripts. The template `gitignore` also has the `frontend/.gitignore` rules, so the CLI renames only one file.
  - Read: root `package.json`, `.github/workflows/ci.yml`.
  - Exit: the CI steps pass locally. `npm run dev` in the template folder still works.
- [x] **C4.2 CLI command.** Add `packages/create-ln-app/src/cli.ts`. Compile it to JavaScript with `tsc` in a `prepack` script.
  - Do: check Node 24 or later first. Copy the template, rename `gitignore` to `.gitignore`, set the package name, run `npm install` and `git init`, and show the next steps. Add `--skip-install`. Keep `template/.env`, `template/network/data/`, and `template/frontend/dist/` out of the package. Measured on 2026-10-28: `npm pack` includes them.
  - Done: the package has the `bin` and `files` fields. The `files` field also excludes the template `node_modules` folders, because an explicit `files` entry includes them. The CLI makes the package name from the folder name and sets it in `package.json` and `package-lock.json`. It runs `npm run install:all`, because the template has 2 lockfiles. It does not run `git init` if the project is in a git repository. The root `typecheck` and `build` scripts also check and build the CLI.
  - Read: `packages/create-ln-app/package.json`.
  - Exit: `npm pack`, then `npx ./create-ln-app-<version>.tgz /tmp/x` makes a project where `npm run lint` and `npm run typecheck` pass. The tarball has no `.env` file and no node data.
- [x] **C4.3 Preflight check.** Add `scripts/doctor.ts` and `npm run doctor` to the template. The CLI runs it in the new project after install.
  - Do: check that the Docker daemon runs, that `docker compose version` works, and that ports 8081-8083, 10001-10003, 9735-9737, and 18443 are free. Show one fix for each failed check.
  - Done: the script gets the host ports from `docker compose config`, so it also checks 19444, 28334, and 29335. It also checks the API server port (`API_PORT`, default 3001). The script uses only Node built-in modules, so the CLI runs it with `--skip-install` too. A failed check does not stop the CLI. The CLI then adds `npm run doctor` to the next steps.
  - Read: `packages/create-ln-app/src/cli.ts`, the template `package.json`.
  - Exit: with Docker stopped, `npm run doctor` fails and shows the fix. With Docker on, it passes.
- [x] **C4.4 Prerelease.** Set version `0.9.0`. Check the `bin`, `files`, and `engines` fields (C4.2 added them).
  - Do: run `npm publish --dry-run`. Write the publish steps in `CONTRIBUTING.md`.
  - Read: `packages/create-ln-app/package.json`.
  - Exit: the dry run lists only the CLI build and the template. Owner: run `npm publish --tag next`, then test `npx create-ln-app@next my-lapp && cd my-lapp && npm run dev` on clean macOS and Linux machines.
  - Done: version `0.9.0`. The `name` is free on npm. The dry run lists 40 files: `dist/cli.js`, `package.json`, a package `README.md` (the npm page), a `LICENSE` copy, and the 36 tracked template files. `CONTRIBUTING.md` has the checks, the CLI tests, and the publish steps. A packed tarball needs `npx --package <tgz> create-ln-app`, because npx runs an absolute `.tgz` path as a file.

### M5: Release 1.0 (branch `m5-release`)

- [x] **C5.1 E2E test.** Add a Playwright test for the 6 browser steps.
  - Do: add a CI job that packs the CLI, makes a project, runs `npm run network`, and runs Playwright.
  - Read: `.github/workflows/ci.yml`, the template `frontend/src/components/Page.tsx`.
  - Exit: the E2E test passes locally. Owner: the E2E job passes on the PR.
  - Done: `e2e/flow.spec.ts` selects alice, connects bob, opens a channel, mines 6 blocks, waits until the channel is active, requests an invoice, and pays it. The test checks the `settled` status and that the page has no exception. Playwright starts the API server and Vite. `LAPP_DIR` selects the project folder (default: the template). If the network does not run, the test stops in less than 1 s with the API error. The CI job `e2e` packs the CLI, makes a project in `$RUNNER_TEMP`, runs `npm run network`, and runs the test. It downloads the Chromium headless shell (about 130 MB). Local runs: on clean data 1 channel and 1 payment, a second run on the same network also passes, and the CI steps pass with `CI=1`.
- [x] **C5.2 Docs.** Write the user docs.
  - Do: rewrite the README quickstart for `npx create-ln-app`. Add `docs/architecture.md` (browser, API server, nodes) and `docs/troubleshooting.md` (ports, Docker memory, Apple Silicon, `npm run reset`).
  - Read: `README.md`, the template `server/API.md`.
  - Exit: owner: a new user follows the README to a paid invoice in less than 5 minutes.
  - Done: the README quick start is `npx create-ln-app my-lapp`, `npm run dev`, and the 6 steps on the page to a settled invoice. `docs/architecture.md` shows the browser, the Vite proxy, the API server, and the nodes. `docs/troubleshooting.md` has the fixes for Docker, the ports, the app errors, Apple Silicon, and `npm run reset`. Each error text in it comes from a local run. `npm run env` now keeps the `.env` lines that it does not own (all lines except `LND_` and `BITCOIND_`), so `API_PORT` in `.env` stays. The template README and the package README link to the new pages. `CONTRIBUTING.md` has the `npm run dev` step for a clone.
- [x] **C5.3 Landing page and release.** Prepare `v1.0.0`.
  - Do: select the landing page for `create-ln-app.dev`. GitHub Pages serves the repo root now, so `README.md` is the landing page. Remove the old to-do page in `docs/index.html`. Add `CHANGELOG.md`. Set version `1.0.0`.
  - Read: `docs/index.html`, the CLI `package.json`.
  - Exit: all 5 checks in "Definition of done for 1.0" pass. Owner: tag `v1.0.0`, merge, and run `npm publish`.
  - Done: `README.md` is the landing page. After the release, a short `index.html` at the repo root replaced it (owner request). The old to-do page `docs/index.html` is removed. `CHANGELOG.md` is at the repo root. The version is `1.0.0`. The "Status: pre-1.0" lines are removed. On Linux, the packed `1.0.0` tarball passes checks 1 to 4. The E2E test passes with `LAPP_DIR` set to the new project. With cached images and npm packages, the time from `npx` to a ready app is 22 s. The checks in CI and on macOS are for the owner.

## After 1.0

Status: accepted, 2026-10-28. Base: `v1.0.0` and the landing page (`230cc6a`).

The work protocol and the conventions of 1.0 also apply here. Each milestone ends with one minor release: M6 is `1.1.0`, M7 is `1.2.0`, M8 is `1.3.0`, M9 is `1.4.0`, M10 is `1.5.0`, M11 is `1.6.0`, M12 is `1.7.0`, and M13 is `1.8.0`. In this section, all app paths are relative to `packages/create-ln-app/template/`.

| Item | Milestone | Estimate |
|---|---|---|
| A network size option, for example `--nodes 5` | M6 | 2-3 days |
| Core Lightning (CLN) nodes, for example `--impl cln` | M7 | 4-6 days |
| Eclair nodes | M8 | 3-4 days |
| A React JavaScript template | M9 | 2-3 days |
| A Next.js TypeScript template | M10 | 4-6 days |
| More install options: Homebrew, `curl \| bash`, Windows (WSL2) | M11 | 2-3 days |
| Examples: Lightning Address (LNURL-pay), LNURL-withdraw, WebLN | M12 | 5-8 days |
| Signet: Mutinynet nodes, for example `--network mutinynet` | M13 | 6-9 days |

### Decisions after 1.0

The owner confirmed decisions 6 to 8 (2026-10-28), decision 9 (2026-10-29), and decisions 10 to 13 (2026-10-30). In C11.0 (2026-10-30), the owner selected the 3 install options. Claude proposed decisions 14 to 17. In C12.0 (2026-10-31), the owner selected Mutinynet in Docker and the 3 examples. Claude proposed decisions 18 to 25. The owner can change each one before the chunk that uses it.

6. **Node list first.** M6 adds one node list file and a compose generator. M7 (CLN) and M8 (Eclair) use them. Reason: in 1.0, the compose file is static, and 2 scripts each hardcode alice, bob, and carol.
7. **One impl for each node.** Each entry in `network/nodes.json` has a name and an impl (`lnd`, `cln`, or `eclair`). `--impl <impl>` sets all nodes. A developer edits `network/nodes.json` for a mix. The default stays 3 LND nodes.
8. **Compose project name from the package name.** The generator sets the compose `name` from `package.json`. Then `npm run down` in one app does not stop the network of a second app. In 1.0, all projects use `name: create-ln-app`.
9. **A neutral API.** The API must not show LND details. Each node client maps its errors and invoice states to one set. The app uses only that set.
10. **Two new templates.** M9 adds a React JavaScript template. M10 adds a Next.js TypeScript template. The flag `--template <name>` takes `react-ts` (the default), `react`, or `next-ts`. The names use the `create-vite` rule: a name with no `-ts` is JavaScript. Claude selected the names. The owner can change them before C9.2.
11. **Generated JavaScript.** The JavaScript template has no source in git. The `prepack` step makes it from `template/`. `ts-blank-space` removes the types, then `prettier` formats the result. Reason: one source, so the 2 templates cannot drift.
12. **Synced shared files.** Each template in git is a full folder that runs in the repo. `template/` is the source of the shared files (network, scripts, node clients, and React components). A sync script copies them to the other template folders. CI fails if a copy is different. Reason: the CLI still copies one folder, and the dev loop stays the same.
13. **Hono in Next.js.** The Next.js template mounts the shared Hono app in one route file with the `hono/vercel` adapter. Reason: one process and one port. The API, `API.md`, and the integration test stay the same as in the React template.
14. **WSL2 is the Windows path.** The docs tell Windows users to run the CLI in WSL2 (Ubuntu), with Docker Desktop and its WSL2 back end or with Docker Engine in WSL2. Node 24 must be in WSL2, and the project must be in the Linux file system (`~/`), not in `/mnt/c`. Native Windows is not tested. Reason: CI cannot start the network on Windows (fact 3 of the install options). WSL2 is Linux, so the Linux E2E jobs cover it.
15. **The install script only checks, then starts `npx`.** `install.sh` is at the repo root, so the site serves it. It does not install Node or Docker, and it does not use `sudo`. It stops if Node 24 or npm is missing, and shows one fix. If `docker compose` is missing, it shows the fix and continues, because the CLI can make the project with no Docker. Then it runs `npx --yes create-ln-app@latest` with the arguments of the user. Reason: no root access, and a small script to trust.
16. **A Homebrew tap, not homebrew-core.** A new repo `bnonni/homebrew-tap` has `Formula/create-ln-app.rb`. The formula installs the npm tarball and depends on `node`. A `workflow_dispatch` workflow in the tap sets `url` and `sha256` from the npm `latest` version. Reason: the repo does not meet the homebrew-core rules (fact 4 of the install options).
17. **Release `1.6.0`.** The npm README gets the install options, so M11 ends with `1.6.0`. The tap formula starts at `1.5.0`. After the publish of `1.6.0`, the bump workflow moves it to `1.6.0`.
18. **Examples first.** M12 adds the examples and ends with `1.7.0`. M13 adds Mutinynet and ends with `1.8.0`. Reason: the regtest CI jobs test the examples. M13 changes the page steps, so it must start from the final page.
19. **Two node changes for LNURL.** A new method `decodeInvoice(paymentRequest)` gives the payment hash, the amount, the description hash, and the expiry date. `createInvoice` gets an option `hashMemo`: the invoice then has the SHA-256 of the memo, not the memo. Reason: an LNURL payer must check the invoice amount (fact 7). The node decodes BOLT11, so the app needs no BOLT11 library.
20. **The app is the LNURL service and the LNURL client.** `server/lnurl.ts` serves a Lightning Address `<node>@<host>` for each node, and LNURL-withdraw links. New API routes let a node pay a Lightning Address and claim a withdraw link. The client accepts `http` only for `localhost` and `127.0.0.1`. Reason: LUD-01 allows only https or onion (fact 7), and a local demo has no certificate.
21. **The selected node pays.** In each new page step, the selected node sends the funds and its peer gets them. In the Lightning Address step, the selected node pays the address of the peer. In the withdraw step, the selected node makes the link, and the peer claims it. Reason: after the first payments, the peer has almost no funds on its side of the channel.
22. **A WebLN provider for development.** `frontend/src/webln.ts` implements `enable`, `getInfo`, `makeInvoice`, and `sendPayment` with the API of the selected node. Step 5 pays with `sendPayment` of this provider. A real provider (for example the Alby extension) uses the same calls (fact 8). Reason: the page shows the standard WebLN calls, and the E2E test needs no browser extension.
23. **Mutinynet with LND and CLN.** The flag `--network regtest|mutinynet` (default `regtest`) sets `config.network` in `package.json`. The CLI and `npm run compose` stop if the network is `mutinynet` and a node is Eclair. CI does not start Mutinynet, because of the sync time and the faucet token. The owner tests it by hand before each release. Reason: the owner selected this option in C12.0. Eclair on Mutinynet is not verified (fact 5).
24. **The faucet funds the nodes.** On Mutinynet, nothing mines. `npm run faucet:login` gets a faucet token with the GitHub device flow and writes it to `.env`. With the token, the bootstrap asks the faucet API for 200,000 sats for each unfunded node. With no token, it shows each address and the faucet URL. Then it waits for the funds. `npm run reset` keeps the bitcoind chain data. Reason: the faucet gives 1,000,000 sats a day (fact 3), and a new sync takes time.
25. **The page waits on Mutinynet.** `GET /api/network` gives the network name. On Mutinynet, step 3 waits until the channel is active, and `POST /api/mine` gives an error. The channel is 100,000 sats, not 1,000,000. Reason: a block comes every 30 s (fact 3), and the faucet limit is low.

### Facts from the 1.0 code

1. `network/docker-compose.yml` is static. Node ports: REST 8081-8083, gRPC 10001-10003, P2P 9735-9737.
2. `scripts/bootstrap.ts:12` and `scripts/env.ts:16` hardcode `const NODES = ['alice', 'bob', 'carol']`.
3. `scripts/doctor.ts` gets the ports from `docker compose config`. It needs no change for more nodes.
4. The server accepts any number of LND nodes. It finds each `LND_<NAME>_REST_URL` key in the env (`server/lnd.ts:250`).
5. The API and the app use LND details: the LND invoice state, the `FAILURE_REASON_*` error text (`frontend/src/components/Page.tsx:38`), and the peer URI from `getinfo`.

### M6: Network size (branch `m6-network-size`)

- [x] **C6.1 Node list and compose generator.** Add `network/nodes.json`, `scripts/compose.ts`, and `npm run compose`.
  - Do: `nodes.json` lists alice, bob, and carol, each with `"impl": "lnd"`. `compose.ts` writes `network/docker-compose.yml` from the list. Node `i` (from 0) gets REST port `8081+i`, gRPC port `10001+i`, and P2P port `9735+i`. Set the compose `name` from the package name (decision 8). Write a header line in the file: "Generated from nodes.json. Do not edit." `npm run network` runs `compose` first. Use only Node built-in modules, so that the CLI can run the script before install. Keep the generated file in git.
  - Read: `network/docker-compose.yml`, the template `package.json`.
  - Exit: `docker compose config` of the new file and of the `v1.0.0` file show the same services, ports, and volumes. Only `name` changes. `npm run network` gives 3 funded nodes. Before the test, run `npm run down` with the old file, because the new project name does not stop the old containers.
- [x] **C6.2 Scripts read the node list.** Add `scripts/nodes.ts`, one reader for `network/nodes.json`.
  - Do: replace the `NODES` arrays in `bootstrap.ts` and `env.ts`. `compose.ts` also uses the reader. The reader checks the file: 2 to 10 nodes, unique names that match `^[a-z][a-z0-9]*$`, and the impl `lnd`. Show one fix for each error.
  - Read: `scripts/bootstrap.ts`, `scripts/env.ts`, `scripts/compose.ts`.
  - Exit: with 5 nodes in `nodes.json`, `npm run reset && npm run network` funds 5 nodes. `.env` has 5 node blocks. `curl localhost:3001/api/nodes` returns 5 nodes. With the network down, `npm run doctor` checks the ports of 5 nodes.
- [x] **C6.3 CLI `--nodes <n>`.** Add the flag to `packages/create-ln-app/src/cli.ts`.
  - Do: accept 2 to 10 nodes (default 3). The names come from one list: alice, bob, carol, dave, erin, frank, grace, heidi, ivan, judy. After the package name change, the CLI writes `network/nodes.json` and runs `npm run compose` in the new project. Add the flag to the help text. Add a CI E2E job with `--nodes 5`.
  - Read: `packages/create-ln-app/src/cli.ts`, `.github/workflows/ci.yml`.
  - Exit: `npx --package <tgz> create-ln-app /tmp/x --nodes 5` makes a project. In `/tmp/x`, `npm run network` funds 5 nodes. The E2E test passes with `LAPP_DIR=/tmp/x`. `--nodes 11` fails and shows one fix.
- [x] **C6.4 Docs and release `1.1.0`.** Update the text about 3 nodes and the port tables.
  - Do: update the 3 README files, `docs/architecture.md`, `docs/troubleshooting.md`, `index.html`, and `.env.example`. Add the `1.1.0` entry to `CHANGELOG.md`. Set version `1.1.0`.
  - Read: only the lines that `grep -rn '3 LND\|8083\|carol'` finds in these files.
  - Exit: lint, typecheck, and build pass. `npm publish --dry-run` lists the new files. Owner: merge, tag `v1.1.0`, and run `npm publish`.

### M7: Core Lightning (branch `m7-cln`)

- [x] **C7.1 Neutral node interface.** Put the LND client behind an interface (decision 9).
  - Do: add `server/nodes/types.ts` with a `LightningNode` interface for the operations in `server/index.ts`. Move `server/lnd.ts` to `server/nodes/lnd.ts`. Map the LND errors and invoice states to one neutral set. Add `impl` to `GET /api/nodes`. Make the app use the neutral error codes, not the `FAILURE_REASON_*` text. Update `server/API.md`.
  - Read: `server/index.ts`, `server/lnd.ts`, `server/API.md`, `frontend/src/api.ts`.
  - Exit: lint, typecheck, and build pass. `npm run test:integration` and the E2E test pass on 3 LND nodes.
- [x] **C7.2 CLN in the network.** Add the `cln` impl to `compose.ts`, `bootstrap.ts`, `env.ts`, and `nodes.ts`.
  - Decide: use `polarlightning/clightning` if `docker manifest inspect` shows amd64 and arm64. If not, use `elementsproject/lightningd`.
  - Do: CLN gets blocks from bitcoind RPC and serves the CLNRest API. Bootstrap uses `lightning-cli newaddr`, `listfunds`, and `getinfo`. Env makes a rune with `lightning-cli createrune`. Env writes `CLN_<NAME>_REST_URL`, `CLN_<NAME>_RUNE`, and `CLN_<NAME>_TLS_CERT_PATH`. Map a gRPC host port only if the node has a gRPC port.
  - Read: `scripts/compose.ts`, `scripts/bootstrap.ts`, `scripts/env.ts`, `scripts/nodes.ts`.
  - Exit: with bob as `cln`, `npm run reset && npm run network` funds all 3 nodes. A `curl` to CLNRest `/v1/getinfo` with the rune returns the bob node id.
  - Done: the image is `polarlightning/clightning:25.12` (amd64 and arm64). CLN has a gRPC port, so it gets a gRPC host port. The CLNRest TLS cert names only `cln` and `localhost`, so `CLN_<NAME>_REST_URL` uses `localhost`. `CLN_<NAME>_TLS_CERT_PATH` is the CA cert `regtest/ca.pem`. Env uses the first rune with no restrictions, so the rune stays the same on each run. CLN announces its container IP, the same as LND.
- [x] **C7.3 CLN client.** Add `server/nodes/cln.ts`, a CLNRest client for the `LightningNode` interface.
  - Do: the server selects the client from the env prefix (`LND_` or `CLN_`). Map the CLN errors and invoice states to the neutral set. The integration test must also pay in the other direction (bob pays alice).
  - Read: `server/nodes/types.ts`, `server/API.md`, `server/flow.test.ts`.
  - Exit: with alice as `lnd` and bob as `cln`, `npm run test:integration` passes in the 2 directions. The E2E test passes.
  - Done: the client pays with `xpay`, because `pay` sends the error code 0 if it finds no route. `xpay` code 205 gives `no_route`, also for a low channel balance. Code 218 (already paid) gives `conflict`. `getInvoice` gets the creation date from `decode`. Each invoice gets a random label. The server sorts the nodes by name, because `process.env` puts the `CLN_` keys first. Bootstrap now funds a CLN node at a `p2tr` address: CLN 25.12 signed the coinbase output to its `bech32` address with the wrong key, so `fundchannel` failed. The 2 clients share `server/nodes/http.ts`. The integration test runs the flow in the 2 directions.
- [x] **C7.4 CLI `--impl`, CI, docs, and release `1.2.0`.** Add `--impl lnd|cln` (all nodes, default `lnd`).
  - Do: add a CI E2E matrix: `lnd`, `cln`, and a mix (a CI step edits `nodes.json`). Update the docs (CLN commands, the rune, the ports) and `CHANGELOG.md`. Set version `1.2.0`.
  - Read: `packages/create-ln-app/src/cli.ts`, `.github/workflows/ci.yml`.
  - Exit: `--impl cln` makes a project, and the E2E test passes in it. Owner: the E2E matrix passes on the PR. Merge, tag `v1.2.0`, and publish.
  - Done: the CI E2E jobs are `lnd`, `lnd-5-nodes`, `cln`, and `mix`. The `mix` job writes `nodes.json` with bob as `cln`. On Linux, a project from the packed CLI with `--impl cln` passes the E2E test and the integration test (16 of 16). The version is `1.2.0`. The E2E matrix on the PR, the merge, the tag, and the publish are for the owner.

### M8: Eclair (branch `m8-eclair`)

- [x] **C8.1 Eclair in the network.** Add the `eclair` impl to `compose.ts`, `bootstrap.ts`, `env.ts`, and `nodes.ts`.
  - Decide: the image, with the same rule as C7.2 (`polarlightning/eclair` or `acinq/eclair`).
  - Do: Eclair has no wallet of its own. It uses a bitcoind wallet, so bootstrap makes one bitcoind wallet for each Eclair node. Eclair also needs the bitcoind ZMQ `rawblock` and `rawtx` streams. Env writes `ECLAIR_<NAME>_API_URL` and `ECLAIR_<NAME>_API_PASSWORD`. The Eclair API uses plain HTTP, so it needs no TLS cert.
  - Read: `scripts/compose.ts`, `scripts/bootstrap.ts`, `scripts/env.ts`, `scripts/nodes.ts`.
  - Exit: with carol as `eclair`, `npm run reset && npm run network` funds all 3 nodes. `curl -u :<password> -X POST <url>/getinfo` returns the carol node id.
  - Done: the image is `polarlightning/eclair:0.11.0` (amd64 and arm64). C8.2 changed it from `0.13.1`. Eclair starts only if its bitcoind wallet exists. `npm run network` waits for healthy nodes before bootstrap, so the Eclair entrypoint makes the wallet, not bootstrap.
  - Done: the wallet has the node name and `load_on_startup`, so bitcoind loads it again after a restart. Eclair uses the ZMQ `hashblock` stream (port 28336) and the `rawtx` stream, not `rawblock`.
  - Done: the alias key is `node-alias`. The API password is `eclairpw`. The `feerate-tolerance` options accept all fee rates, as in Polar. A network with `lnd`, `cln`, and 2 `eclair` nodes also funds all nodes.
- [x] **C8.2 Eclair client.** Add `server/nodes/eclair.ts`.
  - Do: the Eclair API takes form-encoded POST bodies. `payinvoice` returns a payment id immediately, so the client asks `getsentinfo` until the payment succeeds or fails. Map the errors and invoice states to the neutral set. The integration test gets the node pair from the env.
  - Read: `server/nodes/types.ts`, `server/nodes/cln.ts`, `server/flow.test.ts`.
  - Exit: with alice as `lnd`, bob as `cln`, and carol as `eclair`, `npm run test:integration` passes for each pair in the 2 directions.
  - Done: the image is `polarlightning/eclair:0.11.0` (Debian, glibc), not `0.13.1`. The `0.12.0` and `0.13.1` images use Alpine Linux (musl). Their `libsecp256k1-jni.so` calls the glibc function `__memcpy_chk`, and musl does not have it. Thus, the JVM crashes with `SIGSEGV` when Eclair opens a channel. The `acinq/eclair` images are amd64 only.
  - Done: `open` and `connect` send HTTP 200 with a text result also if they fail. The client examines the text. `open` needs `fundingFeeBudgetSatoshis`, because the default budget (1000 sat) is too low for the regtest fee rate.
  - Done: Eclair pays an invoice again if it is already paid. Thus, the client looks for an earlier payment with `getsentinfo` first and gives `conflict`. The client also gives `payment_rejected` for an expired invoice, as the CLN client does.
  - Done: the server finds an Eclair node by its `ECLAIR_<NAME>_API_URL` key. `FLOW_NODES` selects the node pair of the integration test, for example `FLOW_NODES=alice,carol`. The default is `alice,bob`.
- [x] **C8.3 CLI, CI, docs, and release `1.3.0`.** Add `eclair` to `--impl`.
  - Do: add `eclair` to the CI E2E matrix. Use all 3 impls in the mix. Update the docs and `CHANGELOG.md`. Set version `1.3.0`.
  - Read: `packages/create-ln-app/src/cli.ts`, `.github/workflows/ci.yml`.
  - Exit: `--impl eclair` makes a project, and the E2E test passes in it. Owner: the E2E matrix passes on the PR. Merge, tag `v1.3.0`, and publish.
  - Done: the CI E2E jobs are `lnd`, `lnd-5-nodes`, `cln`, `eclair`, and `mix`. The `mix` job writes `nodes.json` with alice as `lnd`, bob as `cln`, and carol as `eclair`. The E2E test uses alice and bob, so the `mix` job also runs the integration test for the 3 node pairs.
  - Done: 2 Eclair nodes use dual funding. Thus, `open` returns before the peers sign the funding transaction, and the client gets the channel again until it has the funding transaction. C8.2 did not find this, because it tested Eclair only with LND and CLN peers.
  - Done: on Linux, a project from the packed CLI with `--impl eclair` passes the E2E test and the integration test (16 of 16). The mix passes the E2E test and the integration test for the 3 pairs (16 of 16 each). The version is `1.3.0`. The E2E matrix on the PR, the merge, the tag, and the publish are for the owner.

### Facts for the templates (C9.0, 2026-10-30)

1. The CLI copies one folder (`TEMPLATE_DIR`, `src/cli.ts:11`). Then it renames `gitignore`, writes `nodes.json`, and runs `npm run compose`, `npm run install:all`, and `npm run doctor` in the project.
2. Node 24 runs the template `.ts` files directly. The template `tsconfig.json` has `erasableSyntaxOnly`, so the removal of the types gives valid JavaScript.
3. About 2,000 of the 2,950 template code lines are in the network scripts, the node clients, and `server/bitcoind.ts`. These lines do not use the app layer.
4. `ts-blank-space` 0.9.0 and `prettier` give JavaScript that is near the source: the blank lines and the comments stay. Only a comment inside a removed type is lost (1 comment in `server/nodes/lnd.ts`). `tsc` output has no blank lines. `.tsx` files need the TSX parse mode.
5. `server/index.ts` makes the node clients and calls `serve()` at module load. It reads `.env` from a path relative to `import.meta.url`. A Next.js bundle moves the module, so this path is not correct there.
6. `scripts/doctor.ts` checks the API port (`API_PORT`, default 3001). The E2E config starts `npm run server` and `npm --prefix frontend run dev` (`e2e/playwright.config.ts:33-34`). The Next.js template has one dev server on port 3000.
7. On npm, `next` is `16.4.3` (Node 20.9 or later). Hono `4.13.14` has the `hono/vercel` adapter.

### M9: React JavaScript template (branch `m9-react-js`)

- [x] **C9.1 JavaScript generator.** Add `packages/create-ln-app/scripts/js-template.ts` and the script `npm run js-template -w create-ln-app`.
  - Do: copy `template/` to `template-react/` with the CLI copy filter, and add `template-react/` to `.gitignore`. Change each `.ts` file to `.js` and each `.tsx` file to `.jsx` (decision 11). Change the relative `.ts` imports to `.js`. Set the `prettier` options so that most lines stay the same as in the source.
  - Do: remove the `tsconfig*.json` files, the `typescript` dev dependency, and the `typecheck` scripts. Keep the `@types/*` dev dependencies for the editor, as `create-vite` does. Change the file names in the `package.json` scripts, `frontend/index.html`, and the Markdown files. Update the 2 lock files with `npm install --package-lock-only --ignore-scripts`.
  - Read: `packages/create-ln-app/package.json`, the 2 template `package.json` files, `frontend/index.html`.
  - Exit: `template-react/` has no `.ts` or `.tsx` file. `node --check` passes for each `.js` file. In `template-react/`, `npm run install:all`, `npm run lint`, and `npm run build` pass. After `npm run network`, `npm run test:integration` and the E2E test (`LAPP_DIR=packages/create-ln-app/template-react`) pass.
  - Done: `src/copy-filter.ts` has the copy filter for the CLI and the generator. Prettier uses `singleQuote` and `printWidth: 120`. 1,854 of 2,602 non-blank code lines stay the same. The other lines have types. The generator also removes the comment lines directly above a removed type, and points 6 comments and docs to `server/API.md`. 26 comments above types are not in the JavaScript files. `oxlint` skips the files that the repo `.gitignore` ignores, so lint a copy of `template-react/` outside the repo. In the copy, lint passes. Build, the integration test (16 of 16), and the E2E test pass.
- [x] **C9.2 CLI `--template`, CI, docs, and release `1.4.0`.** Add `--template react-ts|react` (default `react-ts`).
  - Do: the CLI copies the folder of the template. Add `template-react` to `files`. `prepack` runs the generator before the build. Add a CI E2E job `react` with `--template react`. Update the docs and `CHANGELOG.md`. Set version `1.4.0`.
  - Read: `packages/create-ln-app/src/cli.ts`, `.github/workflows/ci.yml`.
  - Exit: `--template react` makes a project with no TypeScript file, and the E2E test passes in it. `--template vue` fails and shows one fix. Owner: the E2E matrix passes on the PR. Merge, tag `v1.4.0`, and publish.
  - Done: the CI E2E jobs are `lnd`, `lnd-5-nodes`, `cln`, `eclair`, `react`, and `mix`. The `react` job makes sure that the project has no TypeScript file and no `tsconfig` file. Then it runs `npm run lint` and `npm run build` in the project.
  - Done: on Linux, a project from the packed CLI with `--template react` passes the lint, the build, and the E2E test. `--template vue` fails with "Fix: use react-ts or react.". The package has 43 `template/` files and 39 `template-react/` files. The version is `1.4.0`. The E2E matrix on the PR, the merge, the tag, and the publish are for the owner.

### M10: Next.js template (branch `m10-next`)

- [x] **C10.1 Split the server.** Move the Hono app from `server/index.ts` to `server/app.ts`.
  - Do: `server/app.ts` exports `app`. It makes the node clients from `process.env` at the first request, so a build with no `.env` does not fail. `server/index.ts` loads `.env`, makes the clients, and serves `app`. The API does not change.
  - Read: `server/index.ts`.
  - Exit: lint, typecheck, and build pass. `npm run test:integration` and the E2E test pass. With no `.env`, `npm run server` still stops with "Run: npm run network". The C9.1 generator makes `server/app.js`.
- [x] **C10.2 Next.js template and sync script.** Add `packages/create-ln-app/template-next-ts/` and `scripts/sync-templates.ts`.
  - Do: use Next.js 16 with the App Router in `src/app/`. `src/app/page.tsx` is a client component that shows the shared `Page`. `src/app/api/[[...route]]/route.ts` mounts `app` (decision 13). The template `package.json` has the scripts that the CLI runs: `compose`, `install:all`, and `doctor`. Add the run files of the template to `.gitignore`.
  - Do: the sync script copies these files from `template/` (decision 12): `network/`, `scripts/`, `server/` except `index.ts`, `.env.example`, `gitignore`, and `frontend/src/` to `src/` except `index.tsx` and `App.tsx`. With `--check`, it shows each different file and one fix. Add `npm run sync:templates` to the root `package.json`.
  - Do: make `doctor.ts` check the port of the app from one value that each template sets (fact 6). Do not fix the open `API_PORT` bug in this chunk.
  - Check first: Next.js resolves the `.ts` imports, Next.js bundles `undici`, and `next build` works with TypeScript 7. If `next build` cannot use TypeScript 7, run `tsc` in the `typecheck` script and set `typescript.ignoreBuildErrors`.
  - Read: `template/package.json`, `frontend/src/App.tsx`, `frontend/src/index.tsx`, `scripts/doctor.ts`.
  - Exit: in `template-next-ts/`, after `npm run network`, `npm run dev` serves the page and `/api/nodes` on port 3000. `npm run build`, lint, and typecheck pass. `npm run sync:templates -- --check` passes, and fails after a change to a copy.
  - Done: Next.js 16.4.3 resolves the `.ts` imports and bundles `undici`. `next build` works with TypeScript 7, so the template does not set `typescript.ignoreBuildErrors`. `tsconfig.json` has the options that `next build` adds, so the build does not change the file.
  - Done: the "config" field of each template `package.json` sets `port` and `portEnv`. `doctor.ts` checks that port: 3001 and `API_PORT` in `template/`, 3000 and `PORT` in `template-next-ts/`.
  - Done: `server/flow.test.ts` sends its requests to `app` directly. It does not start `server/index.ts`, so the same test runs in the 2 templates (decision 13).
  - Done: in Next.js, `id="nodeName"` made `window.nodeName` an element, and the page showed the error "nodeName.toLowerCase is not a function". The select ids are now `node-select` and `peer-select`.
  - Done: `next dev` writes `AGENTS.md` at each start. The repo `.gitignore` ignores it, as it ignores `.next/` and `next-env.d.ts`.
  - Done: in `template-next-ts/`, the integration test (16 of 16) and the E2E test (with the base URL `http://localhost:3000`) pass. In `template/`, they also pass.
- [x] **C10.3 CLI, E2E, and CI.** Add `next-ts` to `--template`.
  - Do: add `template-next-ts` to `files`. Keep `.next/`, `AGENTS.md`, `next-env.d.ts`, `.env`, and `network/data/*` out of `files` and out of the copy filter. Add `template-next-ts/README.md`.
  - Do: each template `package.json` sets `config.appUrl` and a `dev:app` script that starts the app without the network (fact 6). The E2E config starts `npm run dev:app` and waits for `<appUrl>/api/health`. The CLI shows `config.appUrl` of the project.
  - Do: add a CI step `npm run sync:templates -- --check` and an E2E job `next-ts` that also runs lint, typecheck, and build.
  - Read: `packages/create-ln-app/src/cli.ts`, `.github/workflows/ci.yml`, `e2e/playwright.config.ts`.
  - Exit: `--template next-ts` makes a project, and the E2E test passes in it. The E2E test passes in `template/` too.
  - Done: the network reference of the README is now `network/README.md`, so the sync script shares it. Each template README links to it.
- [x] **C10.4 Docs and release `1.5.0`.** Update the docs and `CHANGELOG.md`. Set version `1.5.0`.
  - Do: `docs/architecture.md` names the "Network reference" section of the project README. Change it to `network/README.md`.
  - Read: `README.md`, `packages/create-ln-app/README.md`, `CHANGELOG.md`, `index.html`.
  - Exit: owner: the E2E matrix passes on the PR. Merge, tag `v1.5.0`, and publish.
  - Done: the docs also change "Change the nodes" to `network/README.md`. `docs/architecture.md` has a section for the Next.js template. `docs/troubleshooting.md` has port 3000. `CONTRIBUTING.md` has the sync script, the `next-ts` E2E job, and the `template-next-ts/` file check. `CHANGELOG.md` has the missing `[1.4.0]` link.
  - Done: lint, typecheck, build, and `npm run sync:templates -- --check` pass. The package has 45 `template/` files, 41 `template-react/` files, and 38 `template-next-ts/` files. The version is `1.5.0`. The E2E matrix on the PR, the merge, the tag, and the publish are for the owner.

### Facts for the install options (C11.0, 2026-10-30)

1. The CLI has no prompts. It checks the Node version (`src/cli.ts:116`). It runs `npm run doctor` for Docker and the ports, and a failed check does not stop it (`src/cli.ts:175`).
2. The template npm scripts use only `node`, `docker compose`, `concurrently`, and `&&`. On `win32`, the CLI starts the npm commands with `shell: true` (`src/cli.ts:101`). Nobody tested the CLI on Windows or macOS.
3. All CI jobs use `ubuntu-latest`. GitHub-hosted Windows runners cannot run Linux containers, and the macOS runners have no Docker. Only the Linux jobs can start the network.
4. homebrew-core accepts only a notable project: 75 stars, 30 forks, and 30 watchers. On 2026-10-30, the repo has 0 of each. A formula cannot depend on a cask, so Brew cannot install Docker Desktop.
5. Homebrew `node` is 26.13.0. `node@24` (24.22.2) is keg-only. The CLI accepts Node 24 or later (`engines`).
6. GitHub Pages builds the site with Jekyll from the `master` root (`CNAME`, `index.html`). A root file `install.sh` is at `https://create-ln-app.dev/install.sh`.
7. This machine has no `brew`, `shellcheck`, or `actionlint`. Use their Docker images (`homebrew/brew`, `koalaman/shellcheck`, `rhysd/actionlint`).

### M11: More install options (branch `m11-install`)

- [x] **C11.1 Windows (WSL2) and a CLI job for 3 OSes.** Add the Windows docs and a CI job `cli`.
  - Do: the `cli` job has a matrix `ubuntu-latest`, `macos-latest`, and `windows-latest`. It packs the CLI and runs the packed CLI with `--skip-install` for each template. It checks that the CLI exits 0 with no Docker and that the project has `package.json`, `.gitignore`, and `network/docker-compose.yml`.
  - Do: add a "Windows" section to `README.md`, `packages/create-ln-app/README.md`, and `docs/troubleshooting.md` (decision 14). Add the WSL2 check to the release checks in `CONTRIBUTING.md`.
  - Read: `.github/workflows/ci.yml` (the E2E job steps), the "Prerequisites" section of `README.md`, `docs/troubleshooting.md`.
  - Exit: `actionlint` passes. On Linux, the job steps pass. Owner: the `cli` job passes on the 3 OSes on the PR. Owner: in WSL2, `npx create-ln-app my-lapp` and `npm run dev` work, and a payment in the page works.
  - Risk: the Windows job can find a CLI bug (paths, `shell: true`, line ends). If the fix is large, split this chunk.
  - Done: the `cli` job sets `DOCKER_HOST` to a closed port, so the doctor fails on each OS, and checks that the CLI shows the fixes. On Windows, the job keeps the LF line ends of the checkout, as in the npm package. `actionlint` passes, and the job steps pass on Linux. The `cli` job on the 3 OSes and the WSL2 test are for the owner.
  - Fixed after the first CI run: on the Ubuntu runner, `docker info --format '{{.ServerVersion}}'` exits 0 with no version if the daemon does not run, so the doctor showed a pass. Now an empty version is a failed check. On Windows, `scripts/js-template.ts` now starts `npm` through a shell. C11.4 must add the doctor fix to `CHANGELOG.md`.
- [x] **C11.2 Install script.** Add `install.sh` at the repo root (decision 15).
  - Do: use `set -euo pipefail` and Bash 3.2 syntax (the macOS Bash). Put the body in a `main` function that the last line calls, so a partial download does nothing. On Git Bash, MSYS, or Cygwin (`uname -s`), stop and link to the Windows section.
  - Do: run `npx` with stdin from `/dev/null`, so no child process reads the rest of the script. The variable `CREATE_LN_APP_PACKAGE` (default `create-ln-app@latest`) lets CI use the packed CLI.
  - Do: in the `cli` job, on Linux and macOS, run `shellcheck install.sh` and `cat install.sh | bash -s -- app --skip-install` with the packed CLI.
  - Read: `index.html` (the install command block).
  - Exit: `shellcheck` passes. `cat install.sh | bash -s -- app --skip-install` with the local tarball makes the project. With no `node` in `PATH`, and with Node 22, the script stops and shows one fix.
  - Done: `install.sh` stops with one fix if the project name, Node.js 24, or npm is missing. It also stops if Ubuntu in WSL2 uses the Windows Node.js (a path in `/mnt/`). `npx` gets `--package "$CREATE_LN_APP_PACKAGE"`, so the variable takes a version or a tarball path. Bash 3.2 stops on `"$@"` with `set -u` and no arguments, so the last line is `main ${1+"$@"}`. Only the Linux job runs `shellcheck`, because the result is the same on each OS. The pipe step uses `/bin/bash`, so the macOS job tests Bash 3.2.
- [x] **C11.3 Homebrew tap.** Write the tap repo in `../homebrew-tap` (decision 16).
  - Do: `Formula/create-ln-app.rb` uses `std_npm_args` and `depends_on "node"`. Its `caveats` show the Docker step. Its `test do` block runs `create-ln-app app --skip-install` and checks `app/package.json`. The version is `1.5.0`.
  - Do: add `README.md`, a test workflow (`brew test-bot` or `brew audit` and `brew test`), and the bump workflow (`workflow_dispatch`, `contents: write`).
  - Exit: in the `homebrew/brew` image, `brew install`, `brew test`, and `brew audit --strict --new` pass. Owner: create `bnonni/homebrew-tap` and push. The tap CI passes.
  - Done: the tap has `Formula/create-ln-app.rb`, `README.md`, the `tests` workflow, the `bump` workflow, and `.github/scripts/bump.sh`. In Homebrew 7.0.11, `brew style` of the formula, `brew audit --strict --online --new`, `brew install --build-from-source`, and `brew test` pass. `brew style bnonni/tap` also lints the workflows, but in the image its `shellcheck` bottle needs glibc 2.38 (the image has 2.35). `actionlint` and `shellcheck` pass on their own. The `bump` workflow installs and tests the formula before the push, because a push with `GITHUB_TOKEN` does not start the `tests` workflow. `bump.sh` stops if the version is not valid or if the formula is already at the version.
- [x] **C11.4 Docs and release `1.6.0`.** Show the 4 ways to install in the docs. Set version `1.6.0`.
  - Do: the quick start of `README.md`, `packages/create-ln-app/README.md`, and `index.html` shows `npx` (the default), `curl | bash`, Homebrew, and Windows (WSL2). Each way still needs Node 24 and Docker. `CONTRIBUTING.md` "Publish": after `npm publish`, run the tap bump workflow. Add `[1.6.0]` to `CHANGELOG.md`.
  - Read: `README.md`, `packages/create-ln-app/README.md`, `index.html`, `CHANGELOG.md`, the "Publish" section of `CONTRIBUTING.md`.
  - Exit: lint, typecheck, build, and `npm run sync:templates -- --check` pass. Owner: CI passes on the PR. Merge, tag `v1.6.0`, publish, and run the tap bump workflow.
  - Done: `README.md`, `packages/create-ln-app/README.md`, and `index.html` show `npx`, the shell script, Homebrew, and Windows (WSL2). `CONTRIBUTING.md` step 11 runs the tap `bump` workflow. `CHANGELOG.md` has `[1.6.0]` with the doctor fix. The version is `1.6.0`. Lint, typecheck, build, and `npm run sync:templates -- --check` pass. CI, the merge, the tag, the publish, and the tap bump are for the owner.

### Facts for signet and the examples (C12.0, 2026-10-31)

1. `scripts/bootstrap.ts` funds the nodes with `generatetoaddress` and opens no channel. The user opens the channel and mines 6 blocks in the page (steps 2 and 3). The server has no network setting. 14 template files contain `regtest`.
2. Default signet: a block every 10 min, 25 GB of blocks, and a first sync of 1-3 hours (unverified). Each faucet needs a captcha in the browser and gives 10,000 sats or less for each request. No faucet has an API that a script can call.
3. Mutinynet is a custom signet with a block every 30 s. Its faucet (https://faucet.mutinynet.com) has an API, for example `POST /api/onchain` and `POST /api/channel`. The API needs a GitHub token (device flow, valid 31 days). It gives up to 1,000,000 sats in 24 hours for each user and each IP address. The Esplora API is at https://mutinynet.com/api.
4. Stock Bitcoin Core cannot sync Mutinynet, because Core has no `signetblocktime`. The Mutinynet fork (https://github.com/benthecarman/bitcoin/releases) and Bitcoin Knots 29.x can sync it. The fork has no Docker image. The bitcoind settings: `signetchallenge=512102f7561d208dd9ae99bf497273e16f389bdbd6c4742ddb8e6b216e64fa2928ad8f51ae`, `addnode=45.79.52.207:38333`, `dnsseed=0`, and `signetblocktime=30`.
5. LND must use `bitcoin.signet` and the bitcoind back end with no `signetchallenge`. With a challenge, the bitcoind back end fails. LND neutrino on Mutinynet is not released. CLN uses `network=signet`. The current Eclair needs Bitcoin Core 31 or later, `txindex=1`, and `signet-check-tx=""` on a custom signet. The template pins Eclair `0.11.0`, and nobody tested it on Mutinynet.
6. Confirmations before a channel opens: LND 1 to 6 (scaled by the amount), CLN 1 on signet, and Eclair 8 (minimum 6 on each chain).
7. LUD-01 allows only https with a real certificate, or http on onion. LUD-16 resolves `<user>@<domain>` with `GET https://<domain>/.well-known/lnurlp/<user>`. In LUD-06, the payer must check the invoice amount, and the description hash is no longer required. The research found no maintained JavaScript LNURL server library.
8. WebLN (https://www.webln.guide) requires `enable`, `getInfo`, `makeInvoice`, and `sendPayment`. The types are in `@webbtc/webln-types`. A page can set its own `window.webln`.

### M12: Examples (branch `m12-examples`)

- [x] **C12.1 Invoice decode and memo hash.** Add the node changes of decision 19 for LND, CLN, and Eclair.
  - Do: add `decodeInvoice` to `LightningNode` in `server/nodes/types.ts`, and the option `hashMemo` to `createInvoice`. LND: `GET /v1/payreq/{pay_req}`, and `description_hash`. CLN: `decode`, and `invoice` with `deschashonly`. Eclair: `parseinvoice`, and `createinvoice` with `descriptionHash`.
  - Do: the integration test decodes an invoice and checks the amount and the description hash.
  - Read: `server/nodes/types.ts`, `server/nodes/lnd.ts`, `server/nodes/cln.ts`, `server/nodes/eclair.ts`, `server/flow.test.ts`.
  - Exit: lint, typecheck, and `npm run sync:templates -- --check` pass. The integration test passes on a mix network (LND, CLN, and Eclair).
  - Risk: LND and Eclair take the hash, but CLN takes the text with `deschashonly`. Thus the option takes the text, and each client makes the hash if its node needs it.
  - Done: with `hashMemo`, the memo of the invoice is empty on each node. Reason: Eclair does not keep the text, but LND and CLN do. LND sends HTTP 500 for a bad payment request. Thus its client gives `invalid_request`, the same as CLN and Eclair. The integration test also pays an invoice with a memo hash. It passes on the mix network for the 3 node pairs. The default invoice expiry is different on each node: LND 24 hours, CLN 7 days, and Eclair 1 hour.
- [ ] **C12.2 Lightning Address.** Add the LNURL-pay service and client (decisions 20 and 21).
  - Do: `server/lnurl.ts` serves `GET /.well-known/lnurlp/:name` (LUD-16) and the LUD-06 callback. The invoice has the hash of the metadata. The callback URL comes from the request origin.
  - Do: `POST /api/nodes/:name/address-payments {address, amountSats}` resolves the address, checks the invoice amount with `decodeInvoice`, and pays. Add the routes to `server/API.md`.
  - Do: the Vite proxy sends `/.well-known` to the API port. The Next.js template serves `/.well-known/lnurlp/:name` with the Hono app.
  - Read: `server/app.ts`, `server/index.ts`, `server/API.md`, `frontend/vite.config.ts`, and the route file and `next.config.*` of `template-next-ts/`.
  - Exit: lint, typecheck, and the sync check pass. In the integration test, alice pays `bob@127.0.0.1:<port>`, and the invoice of bob is settled.
  - Risk: the Hono app has `basePath('/api')`, so the `.well-known` route needs a mount outside `/api`. The integration test calls the app in process, but the LNURL client sends HTTP requests. Thus the test must start a server on a free port.
- [ ] **C12.3 LNURL-withdraw.** Add the LUD-03 service and client (decisions 20 and 21).
  - Do: `POST /api/nodes/:name/withdraw-links {amountSats}` returns an `lnurl` (bech32, LUD-01). `GET /api/lnurlw/:k1` returns the `withdrawRequest`. Its callback pays the invoice with the node. Each `k1` is random, works one time, and expires after 10 min. The server keeps it in memory.
  - Do: `POST /api/nodes/:name/withdrawals {lnurl}` decodes the link, makes an invoice on the node, and calls the callback. Add the routes to `server/API.md`.
  - Read: `server/lnurl.ts`, `server/app.ts`, `server/API.md`, `server/flow.test.ts`.
  - Exit: lint, typecheck, and the sync check pass. In the integration test, alice makes a link, and bob claims it. A second claim fails.
  - Risk: bech32 needs a small library (for example `@scure/base`) or about 40 lines of code. Select one in this chunk.
- [ ] **C12.4 WebLN provider and page steps.** Add `frontend/src/webln.ts` (decision 22) and 2 page steps.
  - Do: step 5 pays with `webln.sendPayment`. Step 6 pays the Lightning Address of the peer. Step 7 makes a withdraw link with the selected node, and the peer claims it. Add `eclair` to `NodeImpl` in `frontend/src/api.ts`.
  - Do: add the steps to `e2e/flow.spec.ts`. Add `@webbtc/webln-types` as a dev dependency.
  - Read: `frontend/src/components/Page.tsx`, `frontend/src/api.ts`, `e2e/flow.spec.ts`, `frontend/README.md`.
  - Exit: lint, typecheck, build, and the sync check pass. `npm run test:e2e` passes on LND and on a mix network.
  - Risk: the JavaScript template removes the types. Make sure that no import of `@webbtc/webln-types` stays in the JavaScript output.
- [ ] **C12.5 Docs and release `1.7.0`.** Show the 3 examples in the docs. Set version `1.7.0`.
  - Do: `README.md`, `packages/create-ln-app/README.md`, `index.html`, and `docs/architecture.md` show the examples. A docs section tells how to use a real wallet: a domain with https for the Lightning Address, and a WebLN extension. Add `[1.7.0]` to `CHANGELOG.md`.
  - Read: `README.md`, `packages/create-ln-app/README.md`, `index.html`, `docs/architecture.md`, `CHANGELOG.md`.
  - Exit: lint, typecheck, build, and the sync check pass. Owner: CI passes on the PR. Merge, tag `v1.7.0`, publish, and run the tap bump workflow.

### M13: Mutinynet (branch `m13-mutinynet`)

- [ ] **C13.1 Mutinynet test: bitcoind, sync, and faucet.** Test the parts before a template change. Add the results to "Facts for signet and the examples".
  - Do: in a scratch folder, make a bitcoind image for Mutinynet. Use a Dockerfile that downloads the fork release and checks a fixed sha256, or a Knots image. Measure the first sync time and the disk size.
  - Do: start one LND node (`bitcoin.signet`, bitcoind back end) and one CLN node (`network=signet`) on it. Get a faucet token with the device flow, and fund the LND node with `POST /api/onchain`.
  - Exit: the facts are in this file. If the sync takes more than 1 hour or more than 20 GB, stop and ask the owner.
  - Risk: the device flow needs the owner to enter a code on GitHub. The Docker Hub and GitHub downloads fail sometimes.
- [ ] **C13.2 Network option.** Add `--network` (decision 23).
  - Do: the CLI writes `config.network` to `package.json`. `scripts/compose.ts` makes the Mutinynet services: the bitcoind image of C13.1, and the signet flags for LND and CLN. It stops if a node is Eclair. `scripts/env.ts` uses the `signet` data paths and writes `BITCOIN_NETWORK` to `.env`.
  - Do: the `cli` job makes a project with `--network mutinynet --skip-install` and checks the compose file.
  - Read: `src/cli.ts`, `scripts/compose.ts`, `scripts/env.ts`, `scripts/nodes.ts`, and the `cli` job in `.github/workflows/ci.yml`.
  - Exit: lint, typecheck, build, and the sync check pass. The regtest compose file has no change. With `--network mutinynet`, `npm run network` starts, and the nodes sync.
- [ ] **C13.3 Faucet and bootstrap.** Fund the nodes on Mutinynet (decision 24).
  - Do: add `scripts/faucet-login.ts` and `npm run faucet:login`. On Mutinynet, `scripts/bootstrap.ts` does not mine. It waits up to 15 min for confirmed funds. `scripts/reset.ts` keeps the bitcoind data on Mutinynet.
  - Read: `scripts/bootstrap.ts`, `scripts/reset.ts`, `scripts/doctor.ts`.
  - Exit: lint, typecheck, and the sync check pass. On Mutinynet, `npm run bootstrap` funds 3 LND nodes. On regtest, the E2E test passes.
  - Risk: the faucet limit is 1,000,000 sats in 24 hours. With 200,000 sats for each node, 6 or more nodes need a second day.
- [ ] **C13.4 Server and page on Mutinynet.** Make the API and the page work with no mining (decision 25).
  - Do: add `GET /api/network`. On Mutinynet, `POST /api/mine` returns an error, and the server does not use the `bcrt1` burn address. Step 3 waits until the channel is active, and the channel is 100,000 sats.
  - Read: `server/app.ts`, `server/API.md`, `frontend/src/components/Page.tsx`, `frontend/src/api.ts`.
  - Exit: lint, typecheck, build, and the sync check pass. On regtest, the E2E test passes. On Mutinynet, the page flow works for LND and CLN.
  - Risk: steps 5 to 7 use the same channel. Make sure that the 100,000-sat channel has sufficient funds for them.
- [ ] **C13.5 Docs and release `1.8.0`.** Show Mutinynet in the docs. Set version `1.8.0`.
  - Do: `README.md`, `packages/create-ln-app/README.md`, `index.html`, `docs/troubleshooting.md`, and `network/README.md` show `--network mutinynet`, the faucet login, the first sync time, and the limits (no Eclair, the faucet limit). Add a Mutinynet check to the release checks in `CONTRIBUTING.md`. Add `[1.8.0]` to `CHANGELOG.md`.
  - Read: the files in "Do" and `CHANGELOG.md`.
  - Exit: lint, typecheck, build, and the sync check pass. Owner: CI passes on the PR. Owner: the Mutinynet check from a new project. Merge, tag `v1.8.0`, publish, and run the tap bump workflow.

### Later: plan before work

Each item below starts with one planning chunk. That chunk writes the other chunks in this file. Do not plan these items in detail now, because M6 to M8 change the template.

- [x] **C9.0 More templates: plan.** JavaScript and Next.js. Questions for the plan:
  1. Do the templates share one base (network, scripts) and add one app layer each?
  2. Does the pack step make the JavaScript template from the TypeScript source, or is it a second source?
  3. Does the Next.js template put the API in route handlers, or keep the Hono server?
  - Done: the answers are decisions 12, 11, and 13. The chunks are in M9 and M10. The facts are in "Facts for the templates". M10 uses the chunk numbers C10.x, so the install options plan is now C11.0 and the signet plan is now C12.0.
- [x] **C11.0 More install options: plan.** Homebrew, `curl | bash`, and Windows (WSL2). Fact: each option still needs Node 24 and Docker. Homebrew and `curl | bash` only start `npx create-ln-app`. Give the owner the value and the cost of each option before the plan.
  - Done: the owner selected Windows (WSL2), `curl | bash`, and Homebrew. The decisions are 14 to 17. The chunks are in M11. The facts are in "Facts for the install options".
- [x] **C12.0 Signet and examples: plan.** Fact: on signet, nobody mines a block when the app asks. Funds come from a faucet, so the bootstrap cannot fund the nodes. Plan the examples (LNURL, Lightning Address, WebLN) apart from signet.
  - Done: the owner selected Mutinynet in Docker (LND and CLN) and the 3 examples. The decisions are 18 to 25. The chunks are in M12 and M13. The facts are in "Facts for signet and the examples".
