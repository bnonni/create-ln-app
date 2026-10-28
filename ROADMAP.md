# Roadmap to MVP 1.0

Status: accepted, 2026-10-27. Audit base: commit `d4ce9d7`.

This repo is the main `create-ln-app` project. It started as a fork of [ATLBitLab/create-ln-app](https://github.com/ATLBitLab/create-ln-app) (formerly `terminus-btc/create-ln-app`). The original repo is old and does not get updates.

## Goal

`create-ln-app` is "create-react-app" for the Bitcoin Lightning Network. One command must give a developer two things:

1. A local regtest network: Bitcoin Core and LND nodes, funded and ready.
2. An example Lightning app (Lapp) that connects to that network.

The developer then changes the example app into their own Lapp. They do not configure nodes, macaroons, or TLS by hand.

Sources: `README.md` ("What?" and "Why?") and the to-do list in `docs/index.html`.

## Definition of done for 1.0

Release 1.0 when these 5 checks pass in CI and on a clean macOS and Linux machine:

1. `npx create-ln-app my-lapp` makes a new project.
2. `npm run dev` in that project starts the network, funds the nodes, and starts the app. Polar is not necessary.
3. In the browser, a user can select a node, connect a peer, open a channel, mine blocks, make an invoice, and pay it.
4. No macaroon or other secret goes into git or into the browser bundle.
5. The README quickstart takes less than 5 minutes after Node and Docker are installed.

## Current state

The repo is a template that you fork. There is no CLI. The example app does not work end to end.

### Blockers

| # | Problem | Location |
|---|---|---|
| 1 | The env script writes `NODE_1_*`. The app reads `REACT_APP_NODE_1_*`. The app gets no credentials. | `scripts/setup.env.js:18`, `frontend/src/Env.tsx:1` |
| 2 | `export.json` contains absolute macaroon paths from one Mac (`/Users/hu5ky5n0w/.polar/...`). The env script fails on all other machines. | `backend/docker/compose/export.json`, `scripts/setup.env.js:15` |
| 3 | `npm start` starts the env script, Docker, and the app at the same time. The env script runs before LND writes the macaroons. | `package.json:6` |
| 4 | The browser calls LND REST directly. LND uses a self-signed TLS cert and has no `--restcors` flag. The browser blocks the calls. | `frontend/src/lightning/LightningStore.ts:39` |
| 5 | Only "list peers" calls LND, and it uses the wrong path (no `/peers`). Open channel, mine, invoice, and pay are stubs. Nothing funds the wallets. | `LightningStore.ts:39-65`, `frontend/src/components/Page.tsx` |

### Hygiene

1. Secrets in git: `frontend/.env` contains admin macaroons. They are regtest only, but this is a bad pattern for a template.
2. Docs drift: the README refers to `frontend/js`, `frontend/ts`, `npm run env:hex-macaroons`, and `create-ln-app-0/volumes`. None of these exist.
3. Unused files: 4 git submodules (bitcoin, lnd, cln, eclair source), `backend/docker/images/`, the Polar export zip, unused root dependencies, and broken scripts (`env:lnd:*`, `start:backend:export`).
4. Old stack: Create React App (deprecated in 2025), LND `0.15.2-beta` and Bitcoin Core `23.0` (2022), and the `docker-compose` v1 command.
5. No tests, no lint step, no CI.

## Decisions

Decisions 4 and 5 have owner confirmation (2026-10-27).

1. **Ship a CLI.** `npx create-ln-app <name>` replaces "fork this repo". Reason: the project name and the to-do list in `docs/index.html` ask for it. The npm name `create-ln-app` is free (checked 2026-10-27).
2. **Add a thin API server.** The browser talks only to this server. The server talks to LND and bitcoind. Reason: this fixes blockers 4 and 5. It also keeps macaroons out of the browser and gives access to bitcoind RPC to mine blocks.
3. **Use Vite, React, and TypeScript.** Replace Create React App. Ship one template (TypeScript) in 1.0.
4. **Own the network config. Use LND only in 1.0.** Write a new `docker-compose.yml` and remove the Polar export dependency. Pin current versions. Latest tags on 2026-10-27: `polarlightning/lnd:0.20.0-beta`, `polarlightning/bitcoind:30.0`, `lightninglabs/lnd:v0.21.5-beta`. The Polar images map the host `USERID` and `GROUPID`, so the host can read the macaroons. Select one image set in M1.
5. **This fork is the main project.** Detach it from the ATLBitLab fork network. Use `bnonni/create-ln-app` in all URLs. Publish to npm from the owner account. Keep the original MIT copyright line and credit the original authors in the README.

## Milestones

Estimates are for one developer who knows TypeScript and LND. Total: 15 to 22 work days (3 to 4.5 weeks).

| Milestone | Result | Estimate |
|---|---|---|
| M0 Clean base | Repo is clean. CI runs. | 1-2 days |
| M1 Regtest network | `npm run dev` gives 3 funded LND nodes. | 3-4 days |
| M2 API server | The full payment flow works with `curl`. | 3-4 days |
| M3 Example Lapp | The full payment flow works in the browser. | 3-5 days |
| M4 CLI | `npx create-ln-app` works. | 3-4 days |
| M5 Release 1.0 | E2E test in CI, docs, npm publish. | 2-3 days |

M3 can start in parallel with M2 after M2 defines the API contract.

### M0: Clean base (1-2 days)

Code:

- [ ] Remove `frontend/.env` from git. Add `.env` to `.gitignore`.
- [ ] Remove the unused files in "Hygiene" item 3. Replace the `docker-compose` v1 command with `docker compose`.
- [ ] Rewrite the README: pre-1.0 status, fork URLs, and credit to the original authors. Remove the instructions that do not match the code.
- [ ] Add `lint` and `typecheck` scripts. Lint must allow zero warnings.
- [ ] Add a GitHub Actions workflow that runs `npm ci`, `lint`, and `typecheck`.

GitHub (owner action):

- [ ] Detach the fork: **Settings > General > Danger Zone > Leave fork network**. The fork has 0 child forks, 0 issues, and 0 stars (checked 2026-10-27), so it loses no data. This change is permanent. Reference: [Detaching a fork](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/detaching-a-fork).
- [ ] Push the M0 branch and make sure that CI is green.

Exit: CI is green on a clean clone.

### M1: Regtest network (3-4 days)

- [ ] Write a new `docker-compose.yml`: 1 bitcoind and 3 LND nodes (alice, bob, carol). Use pinned versions, health checks, a data directory in the repo, and `docker compose` v2.
- [ ] Write `scripts/bootstrap.ts`. It waits for the nodes, mines blocks to fund each LND wallet, and waits for sync.
- [ ] Write `scripts/env.ts`. It reads each macaroon and TLS cert and writes a server-side `.env`. It replaces `setup.env.js` and `export.json`.
- [ ] Make `npm run dev` run in sequence: network up, bootstrap, env, then server and app in parallel.
- [ ] Add `npm run down` and `npm run reset`. The `reset` script deletes all chain data.

Exit: from a clean clone, `npm run dev` gives 3 funded, synced LND nodes on Linux and macOS (Intel and Apple Silicon).

### M2: API server (3-4 days)

- [ ] Add `server/`: a small TypeScript HTTP server. It reads `.env` and trusts the TLS cert of each node.
- [ ] Add a typed LND REST client and a bitcoind RPC client. App developers can use them again in their own code.
- [ ] Add the endpoints below.
- [ ] Add integration tests that run the full flow against the live regtest network.

```
GET  /api/nodes                    nodes, pubkeys, balances, channels
POST /api/nodes/:name/peers        connect to a peer
POST /api/nodes/:name/channels     open a channel
POST /api/mine                     mine N blocks
POST /api/nodes/:name/invoices     make an invoice
POST /api/nodes/:name/payments     pay an invoice
```

Exit: the integration test opens a channel, mines 6 blocks, and makes alice pay an invoice from bob.

### M3: Example Lapp (3-5 days)

- [ ] Move `frontend/` from Create React App to Vite. Use one style library (remove MUI or styled-components).
- [ ] Connect each step in `Page.tsx` to the API: select node, connect peer, open channel, mine 6 blocks, make invoice, pay invoice.
- [ ] Show live state: balances, channels, and invoice status. Show API errors in the UI.
- [ ] Delete `Env.tsx` and the macaroon code in `LightningStore.ts`. The browser must not hold a macaroon.

Exit: a new user completes the 6 steps in the browser in less than 5 minutes.

### M4: CLI (3-4 days)

- [ ] Change the repo to a workspace: `packages/create-ln-app` (the CLI) and `templates/ts` (the output of M1 to M3).
- [ ] Make `npx create-ln-app <name>` copy the template, set the project name, run `npm install` and `git init`, and show the next steps.
- [ ] Add a preflight check: Node version, Docker daemon, `docker compose` v2, and free ports. This replaces the "install.sh env check" to-do.
- [ ] Publish a `0.x` prerelease to npm. Use it to test `npx` on clean machines.

Exit: `npx create-ln-app my-lapp && cd my-lapp && npm run dev` works on a clean macOS and Linux machine.

### M5: Release 1.0 (2-3 days)

- [ ] Add an E2E test in CI. It makes a project with the CLI, starts the network, and runs the full flow with Playwright.
- [ ] Write the README quickstart, an architecture page, and a troubleshooting page (ports, Docker memory, Apple Silicon).
- [ ] Update the landing page at `create-ln-app.dev`. GitHub Pages serves the repo root now, so `README.md` is the landing page. Select one: move the Pages source to `/docs` and update `docs/index.html`, or remove `docs/`.
- [ ] Add `CHANGELOG.md`. Tag `v1.0.0`. Publish to npm.

Exit: all checks in "Definition of done for 1.0" pass.

## After 1.0

These items are not in the MVP. Do them after the release, in this order:

1. Core Lightning (CLN) and Eclair nodes, for example `--impl cln`.
2. A network size option, for example `--nodes 5`.
3. More templates: JavaScript, Next.js.
4. More install options: Homebrew formula, `curl | bash` installer, Windows (WSL2).
5. Signet support and more examples (LNURL, Lightning Address, WebLN).
