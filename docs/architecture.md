# Architecture

A create-ln-app project has three parts: the example app, the API server, and the network. All three parts run on your computer. The paths on this page start at the project folder. In this repo, the project folder is [`packages/create-ln-app/template/`](../packages/create-ln-app/template/).

```text
Browser: http://localhost:5173
   |
   |  fetch /api/...
   v
Vite dev server (port 5173)
   |
   |  proxy /api/... to the same path
   v
API server: Hono on Node.js (port 3001)
   |
   |-- LND REST, macaroon and TLS cert --> alice (8081), bob (8082), carol (8083)
   |
   '-- JSON-RPC, user and password -----> bitcoind (18443)

Docker Compose project "create-ln-app" (regtest):
   alice, bob, carol <-- RPC and ZMQ ----> bitcoind
   alice, bob, carol <-- Lightning P2P --> alice, bob, carol
```

## The example app

- Folder: `frontend/`. The app uses Vite, React, TypeScript, and plain CSS.
- The app sends all requests to `/api` on its own origin. The Vite dev server sends these requests to the API server. Thus, the browser does not need CORS.
- The proxy is a part of the Vite dev server only. `npm run build` makes static files, and these files do not have a proxy.
- `frontend/src/api.ts` is the typed client for the API server. If the API server sends an error, the client throws an `ApiError`. The error has the message, the HTTP status, and the node name.
- `frontend/src/components/Page.tsx` has the 5 steps of a payment. Each step has a comment that starts with "Your feature".

## The API server

- File: `server/index.ts`. The server uses Hono on Node.js 24. Node.js runs the TypeScript files directly, without a build step.
- The server reads `.env` one time, when it starts. Restart the server after the node data changes, for example after `npm run reset`.
- Each `LND_<NAME>_REST_URL` key in `.env` adds one node to the server.
- Each LND node makes its own self-signed TLS cert. The client for a node trusts only the cert of that node.
- `POST /api/mine` tells bitcoind to mine blocks. The coins go to an address that no one can spend from.
- If a node or bitcoind sends an error, the server sends HTTP 502 with `{ error, node }`.
- API reference: [`server/API.md`](../packages/create-ln-app/template/server/API.md).

The browser does not connect to the nodes directly, for three reasons:

1. An admin macaroon gives full control of a node. The server keeps the macaroons, so the browser never gets them.
2. The browser does not trust the self-signed TLS certs of the nodes.
3. By default, LND REST does not accept CORS requests from a browser.

## The network

- File: `network/docker-compose.yml`. The Docker Compose project name is `create-ln-app`.
- Images: `polarlightning/bitcoind:30.0` and `polarlightning/lnd:0.20.0-beta`. Each image has an `amd64` build and an `arm64` build.
- The chain is regtest. A block comes only when you mine it. The coins have no value.
- The node data goes to `network/data/`. `npm run down` keeps the data. `npm run reset` deletes the data.
- The project README has the host ports and the `lncli` commands. See its "Network reference" section.

## What `npm run dev` does

1. `docker compose ... up -d --wait` starts bitcoind and the 3 LND nodes. The command waits until all health checks pass.
2. `npm run bootstrap` (`scripts/bootstrap.ts`) mines blocks to fund each LND node. Then it waits until each node is synced to the chain. It does not fund a node that has a balance.
3. `npm run env` (`scripts/env.ts`) writes `.env`. The file has the REST URL, the macaroon in hex, and the TLS cert path of each node. It also has the bitcoind RPC values. Only your user can read the file.
4. `concurrently` starts the API server (`npm run server`) and the Vite dev server. Ctrl+C stops the two servers. The network continues to run. To stop it, run `npm run down`.

Steps 1 to 3 are the `npm run network` command.

## Where to make a change

| Change | Files |
| --- | --- |
| Change a step in the app | `frontend/src/components/Page.tsx` |
| Add an API endpoint | `server/index.ts`, `server/lnd.ts` or `server/bitcoind.ts`, `frontend/src/api.ts`, `server/API.md` |
| Add an LND node | `network/docker-compose.yml`, and `NODES` in `scripts/bootstrap.ts` and `scripts/env.ts` |

## Security

The network is for development only. Do not use these settings on mainnet.

- `.env` has the admin macaroons. Git ignores `.env`.
- The bitcoind RPC password is in the compose file, so it is not a secret.
- Docker publishes the node ports on all host addresses. Thus, other computers on your local network can connect to the nodes. Use the network only on a network that you trust.
