# My Lapp

A Lightning app (Lapp) made with [create-ln-app](https://create-ln-app.dev). It has three parts:

1. A local Bitcoin Lightning Network for development: Bitcoin Core and Lightning nodes on regtest. Each node is LND or Core Lightning (CLN). `network/nodes.json` lists the nodes.
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
| `npm run server` | Starts only the API server. It reads `.env` one time at start, so restart it after `npm run network`. Set `API_PORT` in `.env` to change the port (default 3001). |
| `npm run network` | Starts and funds the network, then writes `.env`. It does not start the app. |
| `npm run compose` | Writes `network/docker-compose.yml` from `network/nodes.json`. `npm run network` and `npm run doctor` run it first. |
| `npm run down` | Stops the network. The node data stays in `network/data/`. |
| `npm run doctor` | Checks Docker, Docker Compose, and the ports. Run it when the network is down. It shows a fix for each failed check. |
| `npm run reset` | Stops the network and deletes the node data. The next start makes new nodes. |
| `npm run test:integration` | Opens a channel and pays an invoice through the API server. The network must run. |

## Folders

| Folder | Contents |
|---|---|
| `network/` | The node list (`nodes.json`) and the Docker Compose file that `npm run compose` makes from it. Node data goes to `network/data/`. |
| `scripts/` | The scripts for `npm run compose`, `npm run bootstrap`, `npm run env`, `npm run doctor`, and `npm run reset`. |
| `server/` | The API server. `server/API.md` is the API reference. |
| `frontend/` | The example app: Vite, React, TypeScript, and plain CSS. |

## Make your own Lapp

The example app shows the steps of a Lightning payment: connect to a peer, open a channel, mine blocks, request an invoice, and pay it. The steps are in `frontend/src/components/Page.tsx`. Each step has a comment that starts with "Your feature". The comment gives an idea for a change.

## Help

- [Troubleshooting](https://github.com/bnonni/create-ln-app/blob/master/docs/troubleshooting.md): fixes for Docker, the ports, and the errors in the app.
- [Architecture](https://github.com/bnonni/create-ln-app/blob/master/docs/architecture.md): how the app, the API server, and the nodes connect.

## Network reference

The network has 1 bitcoind node and the Lightning nodes in `network/nodes.json`. `npm run compose` writes `network/docker-compose.yml` from the list. The Docker Compose project name comes from the `name` in `package.json`. Node data goes to `network/data/`.

To start the network and wait until all nodes are healthy, run:

```sh
docker compose -f network/docker-compose.yml up -d --wait
```

To use `lncli` in an LND node, run the command as the `lnd` user (replace `alice` with the node name):

```sh
docker compose -f network/docker-compose.yml exec -u lnd alice lncli -n regtest getinfo
```

To use `lightning-cli` in a CLN node, run the command as the `clightning` user:

```sh
docker compose -f network/docker-compose.yml exec -u clightning alice lightning-cli --network=regtest getinfo
```

### Change the nodes

`network/nodes.json` has 2 to 10 nodes. Each node has a name and an impl: `lnd` (LND) or `cln` (Core Lightning). A network can have the two impls. To make a project with only CLN nodes, add `--impl cln` to the `create-ln-app` command. This example has two LND nodes and one CLN node:

```json
[
  { "name": "alice", "impl": "lnd" },
  { "name": "bob", "impl": "cln" },
  { "name": "carol", "impl": "lnd" }
]
```

A name starts with a lowercase letter and has only lowercase letters and digits. Each name must be unique. The name `bitcoind` is not permitted.

To add or remove a node:

1. Run `npm run down`.
2. Edit `network/nodes.json`.
3. Run `npm run dev`. The network starts the new nodes, funds them, and writes them to `.env`.

Do not edit `network/docker-compose.yml`. The next `npm run compose` replaces it. If you remove a node, its data stays in `network/data/`. `npm run reset` deletes it.

### LND

The host ports of a node come from its position in `network/nodes.json`, not from its name. `.env` has the REST URL of each node.

| Node | REST | gRPC | P2P |
|---|---|---|---|
| 1 (alice) | `https://127.0.0.1:8081` | `127.0.0.1:10001` | `9735` |
| 2 (bob) | `https://127.0.0.1:8082` | `127.0.0.1:10002` | `9736` |
| 3 (carol) | `https://127.0.0.1:8083` | `127.0.0.1:10003` | `9737` |
| n | `https://127.0.0.1:<8080+n>` | `127.0.0.1:<10000+n>` | `<9734+n>` |

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

### Core Lightning (CLN)

A CLN node uses the same host ports as an LND node in the same position. The REST API is CLNRest. The CLNRest TLS cert names only `localhost`, so use `localhost` in the URL, not `127.0.0.1`.

| Node | REST | gRPC | P2P |
|---|---|---|---|
| 1 (alice) | `https://localhost:8081` | `localhost:10001` | `9735` |
| n | `https://localhost:<8080+n>` | `localhost:<10000+n>` | `<9734+n>` |

`npm run env` writes these keys to `.env` for each CLN node (replace `ALICE` with the node name in uppercase):

- `CLN_ALICE_REST_URL`: the CLNRest URL.
- `CLN_ALICE_RUNE`: a rune with no restrictions. It gives full control of the node, like an LND admin macaroon. `npm run env` uses the first rune of this type, or makes one.
- `CLN_ALICE_TLS_CERT_PATH`: the path of the CA cert that signs the CLNRest TLS cert. The node writes the cert to `network/data/alice/regtest/ca.pem`.

A CLNRest call is a `POST` to `/v1/<method>`, with the rune in the `Rune` header and the parameters in a JSON body. Example:

```sh
set -a; . ./.env; set +a
curl --cacert "$CLN_ALICE_TLS_CERT_PATH" -X POST -H "Rune: $CLN_ALICE_RUNE" \
  -H 'content-type: application/json' -d '{}' "$CLN_ALICE_REST_URL/v1/getinfo"
```

API reference: [CLNRest](https://docs.corelightning.org/docs/rest).

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
