# create-ln-app

> **Status: pre-1.0.** See [ROADMAP.md](ROADMAP.md) for the plan to 1.0.

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
   npm run dev
   ```

The `dev` command starts 1 bitcoind node and 3 LND nodes, funds the LND nodes, and writes the node values to `.env`. Then it starts the API server at <http://localhost:3001/api> and the example app at <http://localhost:5173>. The first start pulls the Docker images, so it takes more time.

The app is in [`packages/create-ln-app/template/`](packages/create-ln-app/template/). Its [README](packages/create-ln-app/template/README.md) has all the commands and the network reference. Run those commands in that folder.

## Development

```sh
npm run lint        # oxlint, zero warnings allowed
npm run typecheck   # TypeScript, no emit
npm run build       # Vite production build of the example app
```

CI runs the three commands on each push to `master` and on each pull request.

## Credits

The [ATL BitLab](https://github.com/ATLBitLab/create-ln-app) team (formerly Terminus Labs) started `create-ln-app` in 2022. This repo continues the project.

## License

MIT. See [LICENSE](LICENSE).
