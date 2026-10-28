# create-ln-app

> **Status: pre-1.0.** The example app does not work end to end yet. See [ROADMAP.md](ROADMAP.md) for the plan to 1.0.

`create-ln-app` gives you two things:

1. A local Bitcoin Lightning Network for development: Bitcoin Core and 3 LND nodes on regtest.
2. An example Lightning app (Lapp) that connects to that network.

You change the example app into your own Lapp. You do not configure nodes, macaroons, or TLS by hand.

## What is a Lapp?

A Lapp is an application that runs on the Bitcoin Lightning Network: (L)ightning (app). The name is a contrast to "dApp". We think that the Lightning Network will scale Bitcoin, and that Lapps will replace dApps.

## Why?

A local Lightning setup takes time. You must start nodes, fund wallets, and find macaroons and TLS certs. This project does that setup for you, so you can start to build your app.

## Prerequisites

- [Node.js](https://nodejs.org/) 24 (LTS) and npm.
- [Docker](https://docs.docker.com/engine/install/) with Docker Compose v2 (the `docker compose` command).

On macOS, start Docker Desktop before you continue.

## Quick start

1. Clone the repo:
   ```sh
   git clone https://github.com/bnonni/create-ln-app.git my-lapp && cd my-lapp
   ```
2. Install the dependencies:
   ```sh
   npm run install:all
   ```
3. Start the network and the example app:
   ```sh
   npm start
   ```

The example app opens at <http://localhost:3000>.

Known issue: in this pre-1.0 version, the app does not get the node credentials. The env script reads macaroon paths that are not correct on your machine. Milestones M1 to M3 in [ROADMAP.md](ROADMAP.md) fix this.

## Network reference

The network is in `backend/docker/compose/docker-compose.yml`. Node data goes to `backend/docker/compose/volumes/`.

### LND

| Node | REST | gRPC | P2P |
|---|---|---|---|
| alice | `https://127.0.0.1:8081` | `127.0.0.1:10001` | `9735` |
| bob | `https://127.0.0.1:8082` | `127.0.0.1:10002` | `9736` |
| carol | `https://127.0.0.1:8083` | `127.0.0.1:10003` | `9737` |

Each node writes its admin macaroon and TLS cert here (replace `alice` with the node name):

```
backend/docker/compose/volumes/lnd/alice/data/chain/bitcoin/regtest/admin.macaroon
backend/docker/compose/volumes/lnd/alice/tls.cert
```

LND REST calls must send the macaroon in hex in the `Grpc-Metadata-macaroon` header. To get the hex value, run:

```sh
xxd -ps -u -c 1000 backend/docker/compose/volumes/lnd/alice/data/chain/bitcoin/regtest/admin.macaroon
```

API reference: [LND REST API](https://lightning.engineering/api-docs/api/lnd/).

### bitcoind

- RPC: `http://127.0.0.1:18443`, user `polaruser`, password `polarpass`.
- REST: `http://127.0.0.1:18443/rest/`.

API reference: [Bitcoin Core REST interface](https://github.com/bitcoin/bitcoin/blob/master/doc/REST-interface.md).

## Development

```sh
npm run lint        # ESLint, zero warnings allowed
npm run typecheck   # TypeScript, no emit
```

CI runs both commands on each push to `master` and on each pull request.

## Credits

The [ATL BitLab](https://github.com/ATLBitLab/create-ln-app) team (formerly Terminus Labs) started `create-ln-app` in 2022. This repo continues the project.

## License

MIT. See [LICENSE](LICENSE).
