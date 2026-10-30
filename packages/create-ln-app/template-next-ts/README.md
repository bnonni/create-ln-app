# My Lapp

A Lightning app (Lapp) made with [create-ln-app](https://create-ln-app.dev). It has three parts:

1. A local Bitcoin Lightning Network for development: Bitcoin Core and Lightning nodes on regtest. Each node is LND, Core Lightning (CLN), or Eclair. `network/nodes.json` lists the nodes.
2. An API that connects to the nodes.
3. An example app that uses the API. Next.js serves the app and the API.

You change the example app into your own Lapp. You do not configure nodes, macaroons, or TLS by hand.

## Prerequisites

- [Node.js](https://nodejs.org/) 24 (LTS) and npm.
- [Docker](https://docs.docker.com/engine/install/) with Docker Compose v2 (the `docker compose` command).

On macOS, start Docker Desktop before you continue.

## Quick start

1. Install the dependencies:
   ```sh
   npm run install:all
   ```
2. Start the network and the example app:
   ```sh
   npm run dev
   ```
3. Open <http://localhost:3000>.

The `dev` command starts 1 bitcoind node and the Lightning nodes in `network/nodes.json`, funds the Lightning nodes, and writes the node values to `.env`. Then it starts Next.js at <http://localhost:3000>, with the example app at `/` and the API at `/api`. The first start pulls the Docker images, so it takes more time.

| Command | Result |
|---|---|
| `npm run dev` | Starts the network and Next.js. Ctrl+C stops Next.js. |
| `npm run dev:app` | Starts only Next.js (`next dev`), not the network. Use it if the network runs. The API reads `.env` one time, so restart Next.js after `npm run network`. To change the port (default 3000), set `PORT`, for example `PORT=3005 npm run dev:app`. |
| `npm run start` | Serves the production build of `npm run build`. The network must run. |
| `npm run network` | Starts and funds the network, then writes `.env`. It does not start the app. |
| `npm run compose` | Writes `network/docker-compose.yml` from `network/nodes.json`. `npm run network` and `npm run doctor` run it first. |
| `npm run down` | Stops the network. The node data stays in `network/data/`. |
| `npm run doctor` | Checks Docker, Docker Compose, and the ports. Run it when the network is down. It shows a fix for each failed check. |
| `npm run reset` | Stops the network and deletes the node data. The next start makes new nodes. |
| `npm run test:integration` | Opens a channel and pays an invoice through the API. Next.js does not have to run. The network must run. |

## Folders

| Folder | Contents |
|---|---|
| `network/` | The node list (`nodes.json`) and the Docker Compose file that `npm run compose` makes from it. Node data goes to `network/data/`. `README.md` is the network reference. |
| `scripts/` | The scripts for `npm run compose`, `npm run bootstrap`, `npm run env`, `npm run doctor`, and `npm run reset`. |
| `server/` | The API: a Hono app in `server/app.ts`. `server/API.md` is the API reference. |
| `src/` | The example app: Next.js with the App Router, React, TypeScript, and plain CSS. `src/app/api/[[...route]]/route.ts` sends the `/api` requests to the Hono app. |
| `public/` | The static files that Next.js serves at `/`. |

## Make your own Lapp

The example app shows the steps of a Lightning payment: connect to a peer, open a channel, mine blocks, request an invoice, and pay it. The steps are in `src/components/Page.tsx`. Each step has a comment that starts with "Your feature". The comment gives an idea for a change.

## Help

- [Troubleshooting](https://github.com/bnonni/create-ln-app/blob/master/docs/troubleshooting.md): fixes for Docker, the ports, and the errors in the app.
- [Architecture](https://github.com/bnonni/create-ln-app/blob/master/docs/architecture.md): how the app, the API server, and the nodes connect.

## Network reference

[`network/README.md`](network/README.md) has the host ports and the API keys of the nodes, the CLI commands for each impl, and the steps to change the nodes.

## Development

```sh
npm run lint        # oxlint, zero warnings allowed
npm run typecheck   # TypeScript, no emit
npm run build       # Next.js production build
```
