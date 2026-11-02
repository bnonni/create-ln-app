# My Lapp

A Lightning app (Lapp) made with [create-ln-app](https://create-ln-app.dev). It has three parts:

1. A Bitcoin Lightning Network for development, in Docker on your computer: Bitcoin Core and Lightning nodes. Each node is LND, Core Lightning (CLN), or Eclair. `network/nodes.json` lists the nodes. The chain is regtest (a local chain) or Mutinynet (a public signet). `config.network` in `package.json` sets the chain.
2. An API server that connects to the nodes.
3. An example app that uses the API server.

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
3. Open <http://localhost:5173>.

The `dev` command starts 1 bitcoind node and the Lightning nodes in `network/nodes.json`, funds the Lightning nodes, and writes the node values to `.env`. Then it starts the API server at <http://localhost:3001/api> and the example app at <http://localhost:5173>. The first start pulls the Docker images, so it takes more time.

| Command | Result |
|---|---|
| `npm run dev` | Starts the network, the API server, and the example app. Ctrl+C stops the server and the app. |
| `npm run dev:app` | Starts the API server and the example app, but not the network. Use it if the network runs. |
| `npm run server` | Starts only the API server. It reads `.env` one time at start, so restart it after `npm run network`. Set `API_PORT` in `.env` to change the port (default 3001). |
| `npm run network` | Starts and funds the network, then writes `.env`. It does not start the app. |
| `npm run sync` | On Mutinynet, starts bitcoind and shows the sync progress until bitcoind has the full chain. `npm run network` runs it before the nodes start. On regtest, it does nothing. |
| `npm run faucet:login` | On Mutinynet, gets a faucet token with a GitHub login and writes it to `.env` as `MUTINYNET_FAUCET_TOKEN`. Then the bootstrap requests the funds from the faucet. The token is valid for 24 hours. |
| `npm run compose` | Writes `network/docker-compose.yml` from `network/nodes.json`. `npm run network` and `npm run doctor` run it first. |
| `npm run down` | Stops the network. The node data stays in `network/data/`. |
| `npm run doctor` | Checks Docker, Docker Compose, and the ports. Run it when the network is down. It shows a fix for each failed check. |
| `npm run reset` | Stops the network and deletes the node data. The next start makes new nodes. On Mutinynet, reset keeps the chain data in `network/data/bitcoind`. If a node has funds, reset deletes nothing and fails. `npm run reset -- --force` deletes the wallets with no check. |
| `npm run test:integration` | Opens a channel and pays an invoice through the API server. The network must run. It mines blocks, so it works only on regtest. |

## Mutinynet

If `config.network` in `package.json` is `mutinynet`, the chain is Mutinynet, a public signet with a block every 30 s.

1. Optional: run `npm run faucet:login`, then open the URL and enter the code. With the token, the bootstrap requests 200,000 sats from the faucet for each node with no funds.
2. Run `npm run dev`. The first start downloads the chain: about 11 GB of disk and 40 min or more. If `.env` has no valid token, send funds from <https://faucet.mutinynet.com> to the addresses that the bootstrap shows.
3. Open <http://localhost:5173>. Step 2 opens a 100,000-sat channel. In step 3, click "Wait for channel". The page waits until the channel is `active`.

The nodes can be only LND or CLN. The faucet gives up to 1,000,000 sats in 24 hours. For all the limits, see [Mutinynet](https://github.com/bnonni/create-ln-app#mutinynet).

## Folders

| Folder | Contents |
|---|---|
| `network/` | The node list (`nodes.json`) and the Docker Compose file that `npm run compose` makes from it. Node data goes to `network/data/`. `mutinynet/Dockerfile` makes the bitcoind image for Mutinynet. `README.md` is the network reference. |
| `scripts/` | The scripts for `npm run compose`, `npm run sync`, `npm run bootstrap`, `npm run faucet:login`, `npm run env`, `npm run doctor`, and `npm run reset`. |
| `server/` | The API server. `server/API.md` is the API reference. |
| `frontend/` | The example app: Vite, React, TypeScript, and plain CSS. |

## Make your own Lapp

The example app shows the steps of a Lightning payment: connect to a peer, open a channel, mine blocks (on Mutinynet, wait for the blocks), request an invoice, and pay it with WebLN. Then the selected node pays a Lightning Address and sends sats with a withdraw link (LNURL). The steps are in `frontend/src/components/Page.tsx`. Each step has a comment that starts with "Your feature". The comment gives an idea for a change. `frontend/README.md` tells how to use a WebLN wallet extension. To pay with a WebLN extension or a wallet app, see [Use a real wallet](https://github.com/bnonni/create-ln-app/blob/master/docs/real-wallet.md).

## Help

- [Troubleshooting](https://github.com/bnonni/create-ln-app/blob/master/docs/troubleshooting.md): fixes for Docker, the ports, and the errors in the app.
- [Architecture](https://github.com/bnonni/create-ln-app/blob/master/docs/architecture.md): how the app, the API server, and the nodes connect.

## Network reference

[`network/README.md`](network/README.md) has the host ports and the API keys of the nodes, the CLI commands for each impl, and the steps to change the nodes.

## Development

```sh
npm run lint        # oxlint, zero warnings allowed
npm run typecheck   # TypeScript, no emit
npm run build       # Vite production build of the example app
```
