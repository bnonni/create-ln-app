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
   |-- LND REST, macaroon and TLS cert --> alice (8081), bob (8082), carol (8083), ...
   |-- CLNRest, rune and CA cert -------> the CLN nodes, with the same ports
   |-- Eclair API and password ---------> the Eclair nodes, with the same REST ports
   |
   '-- JSON-RPC, user and password -----> bitcoind (18443)

Docker Compose project "<name in package.json>" (regtest):
   alice, bob, carol, ... <-- RPC and ZMQ ----> bitcoind
   alice, bob, carol, ... <-- Lightning P2P --> alice, bob, carol, ...
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
- Each `LND_<NAME>_REST_URL` key, `CLN_<NAME>_REST_URL` key, and `ECLAIR_<NAME>_API_URL` key in `.env` adds one node to the server. The server sorts the nodes by name.
- `server/nodes/lnd.ts` is the LND client, `server/nodes/cln.ts` is the CLN client, and `server/nodes/eclair.ts` is the Eclair client. The 3 clients have the same interface, `server/nodes/types.ts`. Thus, the API is the same for the 3 impls.
- Each LND node and each CLN node makes its own self-signed TLS cert. The client for a node trusts only the cert of that node. The Eclair API uses plain HTTP and a password.
- `POST /api/mine` tells bitcoind to mine blocks. The coins go to an address that no one can spend from.
- If a node or bitcoind sends an error, the server sends HTTP 502 with `{ error, node }`.
- API reference: [`server/API.md`](../packages/create-ln-app/template/server/API.md).

The browser does not connect to the nodes directly, for three reasons:

1. An LND admin macaroon, a CLN rune with no restrictions, or an Eclair API password gives full control of a node. The server keeps these values, so the browser never gets them.
2. The browser does not trust the self-signed TLS certs of the nodes.
3. By default, LND REST, CLNRest, and the Eclair API do not accept CORS requests from a browser.

## The network

- Files: `network/nodes.json` lists the nodes: 2 to 10 nodes, and the default is 3. Each node has the impl `lnd` (LND), `cln` (Core Lightning), or `eclair` (Eclair). `npm run compose` (`scripts/compose.ts`) writes `network/docker-compose.yml` from the list.
- Node n in the list gets REST port `8080+n`, gRPC port `10000+n`, and P2P port `9734+n` on the host. An Eclair node uses the REST port for its API, and it has no gRPC port.
- The Docker Compose project name comes from the `name` in `package.json`. Thus, each project has its own containers.
- Images: `polarlightning/bitcoind:30.0`, `polarlightning/lnd:0.20.0-beta`, `polarlightning/clightning:25.12`, and `polarlightning/eclair:0.11.0`. Each image has an `amd64` build and an `arm64` build.
- The chain is regtest. A block comes only when you mine it. The coins have no value.
- The node data goes to `network/data/`. `npm run down` keeps the data. `npm run reset` deletes the data.
- An Eclair node has no wallet of its own. It uses a bitcoind wallet with the node name.
- The project README has the host ports and the `lncli`, `lightning-cli`, and `eclair-cli` commands. See its "Network reference" section.

## What `npm run dev` does

1. `npm run compose` (`scripts/compose.ts`) writes `network/docker-compose.yml` from `network/nodes.json`.
2. `docker compose ... up -d --wait` starts bitcoind and the Lightning nodes. The command waits until all health checks pass.
3. `npm run bootstrap` (`scripts/bootstrap.ts`) mines blocks to fund each Lightning node. Then it waits until each node is synced to the chain. It does not fund a node that has a balance.
4. `npm run env` (`scripts/env.ts`) writes `.env`. The file has the URL of each node, and the TLS cert path of each LND node and each CLN node. It also has the macaroon in hex of each LND node, the rune of each CLN node, and the API password of each Eclair node. It also has the bitcoind RPC values. Only your user can read the file.
5. `concurrently` starts the API server (`npm run server`) and the Vite dev server. Ctrl+C stops the two servers. The network continues to run. To stop it, run `npm run down`.

Steps 1 to 4 are the `npm run network` command.

## Where to make a change

| Change | Files |
| --- | --- |
| Change a step in the app | `frontend/src/components/Page.tsx` |
| Add an API endpoint | `server/index.ts`, `server/nodes/types.ts`, `server/nodes/lnd.ts`, `server/nodes/cln.ts`, and `server/nodes/eclair.ts`, or `server/bitcoind.ts`, `frontend/src/api.ts`, `server/API.md` |
| Add or remove a node, or change its impl | `network/nodes.json`. See "Change the nodes" in the project README. |

## Security

The network is for development only. Do not use these settings on mainnet.

- `.env` has the admin macaroons, the runes, and the Eclair API passwords. Git ignores `.env`.
- The bitcoind RPC password and the Eclair API password are in the compose file, so they are not secrets.
- Docker publishes the node ports on all host addresses. Thus, other computers on your local network can connect to the nodes. Use the network only on a network that you trust.
