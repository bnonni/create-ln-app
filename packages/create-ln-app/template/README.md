# My Lapp

A Lightning app (Lapp) made with [create-ln-app](https://create-ln-app.dev). It has three parts:

1. A local Bitcoin Lightning Network for development: Bitcoin Core and 3 LND nodes on regtest.
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

The `dev` command starts 1 bitcoind node and 3 LND nodes, funds the LND nodes, and writes the node values to `.env`. Then it starts the API server at <http://localhost:3001/api> and the example app at <http://localhost:5173>. The first start pulls the Docker images, so it takes more time.

| Command | Result |
|---|---|
| `npm run dev` | Starts the network, the API server, and the example app. Ctrl+C stops the server and the app. |
| `npm run server` | Starts only the API server. It reads `.env` one time at start, so restart it after `npm run network`. Set `API_PORT` in `.env` to change the port (default 3001). |
| `npm run network` | Starts and funds the network, then writes `.env`. It does not start the app. |
| `npm run down` | Stops the network. The node data stays in `network/data/`. |
| `npm run doctor` | Checks Docker, Docker Compose, and the ports. Run it when the network is down. It shows a fix for each failed check. |
| `npm run reset` | Stops the network and deletes the node data. The next start makes new nodes. |
| `npm run test:integration` | Opens a channel and pays an invoice through the API server. The network must run. |

## Folders

| Folder | Contents |
|---|---|
| `network/` | The Docker Compose file for the network. Node data goes to `network/data/`. |
| `scripts/` | The scripts for `npm run bootstrap`, `npm run env`, and `npm run reset`. |
| `server/` | The API server. `server/API.md` is the API reference. |
| `frontend/` | The example app: Vite, React, TypeScript, and plain CSS. |

## Make your own Lapp

The example app shows the steps of a Lightning payment: connect to a peer, open a channel, mine blocks, request an invoice, and pay it. The steps are in `frontend/src/components/Page.tsx`. Each step has a comment that starts with "Your feature". The comment gives an idea for a change.

## Help

- [Troubleshooting](https://github.com/bnonni/create-ln-app/blob/master/docs/troubleshooting.md): fixes for Docker, the ports, and the errors in the app.
- [Architecture](https://github.com/bnonni/create-ln-app/blob/master/docs/architecture.md): how the app, the API server, and the nodes connect.

## Network reference

The network is in `network/docker-compose.yml`: 1 bitcoind node and 3 LND nodes. Node data goes to `network/data/`.

To start the network and wait until all nodes are healthy, run:

```sh
docker compose -f network/docker-compose.yml up -d --wait
```

To use `lncli` in a node, run the command as the `lnd` user (replace `alice` with the node name):

```sh
docker compose -f network/docker-compose.yml exec -u lnd alice lncli -n regtest getinfo
```

### LND

| Node | REST | gRPC | P2P |
|---|---|---|---|
| alice | `https://127.0.0.1:8081` | `127.0.0.1:10001` | `9735` |
| bob | `https://127.0.0.1:8082` | `127.0.0.1:10002` | `9736` |
| carol | `https://127.0.0.1:8083` | `127.0.0.1:10003` | `9737` |

Each node writes its admin macaroon and TLS cert here (replace `alice` with the node name):

```
network/data/alice/data/chain/bitcoin/regtest/admin.macaroon
network/data/alice/tls.cert
```

LND REST calls must send the macaroon in hex in the `Grpc-Metadata-macaroon` header. To get the hex value, run:

```sh
xxd -ps -u -c 1000 network/data/alice/data/chain/bitcoin/regtest/admin.macaroon
```

API reference: [LND REST API](https://lightning.engineering/api-docs/api/lnd/).

### bitcoind

- RPC: `http://127.0.0.1:18443`, user `polaruser`, password `polarpass`.
- REST: `http://127.0.0.1:18443/rest/`.

API reference: [Bitcoin Core REST interface](https://github.com/bitcoin/bitcoin/blob/master/doc/REST-interface.md).

## Development

```sh
npm run lint        # oxlint, zero warnings allowed
npm run typecheck   # TypeScript, no emit
npm run build       # Vite production build of the example app
```
