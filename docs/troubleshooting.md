# Troubleshooting

Run all commands in the project folder.

First, stop the network with `npm run down`, then run the doctor:

```sh
npm run doctor
```

The doctor checks Docker, Docker Compose, the network ports, and the API server port. It shows a fix for each failed check. The doctor must run when the network is down, because the network uses the ports that it checks.

Contents:

- [Docker](#docker)
- [Ports](#ports)
- [Errors in the app](#errors-in-the-app)
- [Apple Silicon](#apple-silicon)
- [Start again with new nodes](#start-again-with-new-nodes)

## Docker

### Docker does not run

`npm run dev` stops with `Cannot connect to the Docker daemon`.

- macOS and Windows: start Docker Desktop.
- Linux: run `sudo systemctl start docker`.

### Docker does not have sufficient memory

A node container stops, and `docker compose -f network/docker-compose.yml ps -a` shows `Exited (137)`. Exit code 137 usually tells that Docker stopped the container because of low memory.

The 4 containers use about 250 MB of memory together after a start. The images use about 510 MB of disk. An Eclair node uses about 600 MB of memory, and the Eclair image uses about 590 MB of disk.

1. In Docker Desktop, open Settings > Resources > Advanced, and increase the memory limit.
2. Click "Apply & restart".
3. Run `npm run dev`.

On Linux, Docker uses the memory of the host. Stop other programs to make memory free.

### The image download fails

The first `npm run dev` stops with a pull error, for example `network is unreachable`. Docker cannot get the images from Docker Hub. Some IPv6 connections fail.

Run `npm run dev` again. If the error occurs again, examine your internet connection.

## Ports

| Port | Used by |
| --- | --- |
| 5173 | The example app (Vite dev server) |
| 3001 | The API server |
| 3000 | Next.js: the example app and the API (`next-ts` template only) |
| 8081, 8082, 8083, ... | LND REST, CLNRest, or the Eclair API (alice, bob, carol, ...) |
| 10001, 10002, 10003, ... | LND gRPC or CLN gRPC (alice, bob, carol, ...). An Eclair node has no gRPC port. |
| 9735, 9736, 9737, ... | Lightning P2P (alice, bob, carol, ...) |
| 18443, 19444, 28334, 29335 | bitcoind RPC, P2P, and ZMQ |

Node n in `network/nodes.json` uses the ports `8080+n`, `10000+n`, and `9734+n`. For example, a network with 10 nodes uses the ports 8081 to 8090, 10001 to 10010, and 9735 to 9744.

To find the program that uses a port on macOS or Linux, run (replace `3001` with the port):

```sh
lsof -nP -iTCP:3001 -sTCP:LISTEN
```

### A network port is in use

The doctor shows a failed "Network ports" check with a list of ports. Stop the program that uses each port.

All create-ln-app projects use the same host ports. Thus, only one project network can run at a time. Before you start the network in a project, run `npm run down` in the other project.

### Port 3001 is in use

The doctor shows a failed "API server port" check, or the API server stops with `EADDRINUSE`. Stop the program that uses port 3001, or use a different port:

1. Add this line to `.env`:
   ```sh
   API_PORT=3002
   ```
2. Run `npm run dev`.

The API server, the Vite proxy, and the doctor read the same value. `npm run network` replaces only the `LND_`, `CLN_`, `ECLAIR_`, and `BITCOIND_` lines in `.env`, so the value stays.

### Port 5173 is in use

Vite uses the next free port, for example 5174. Open the URL that the terminal shows on the `Local:` line.

### Port 3000 is in use (`next-ts` template)

The doctor shows a failed "API server port" check for port 3000. `next dev` uses the next free port, for example 3001. Open the URL that the terminal shows on the `Local:` line.

To use a fixed port, set `PORT` in the shell, for example `PORT=3005 npm run dev`. Next.js does not read `PORT` from `.env`.

## Errors in the app

### `Cannot reach alice at https://127.0.0.1:8081: connect ECONNREFUSED`

The network does not run. Run `npm run network`.

### `Cannot reach alice at https://127.0.0.1:8081: self-signed certificate`

The node data is new, for example after `npm run reset`. The API server still has the old TLS certs, macaroons, and runes, because it reads `.env` only when it starts.

1. Press Ctrl+C to stop the API server and the app.
2. Run `npm run dev`.

### `The API server sent HTTP 502. Make sure that it runs: npm run dev.`

The Vite dev server runs, but the API server does not run. For example, you started only the app with `npm --prefix frontend run dev`.

1. Stop the app.
2. Run `npm run dev`.
3. If the API server stops, read the `[server]` lines in the terminal. Each server error tells the fix.

### `alice: the payment failed: no_route`

The channel is not active yet. A new channel becomes active after 6 blocks.

1. Do step 3: "Mine 6 blocks to confirm the channel".
2. Click Refresh until the channel status is `active`. A node needs some seconds to see the new blocks.
3. Do step 5 again.

## Apple Silicon

Each image has an `arm64` build, so Docker runs the nodes natively on Apple Silicon. Start Docker Desktop before you run `npm run dev`.

If `DOCKER_DEFAULT_PLATFORM` is `linux/amd64`, Docker runs the `amd64` images in emulation. Then the nodes start slowly, and the health checks can fail. To get the `arm64` images:

1. Run `unset DOCKER_DEFAULT_PLATFORM`.
2. Run `docker compose -f network/docker-compose.yml pull`.
3. Run `npm run dev`.

## Start again with new nodes

Start again with new nodes if a node does not start, or if you want a new chain with no channels. First, read the logs of the node (replace `alice` with the node name):

```sh
docker compose -f network/docker-compose.yml logs --tail 50 alice
```

Then delete the node data and start again:

1. If the app runs, press Ctrl+C.
2. Run `npm run reset`. The command stops the network and deletes the node data in `network/data/`.
3. Run `npm run dev`. The network makes new nodes, funds them, and writes a new `.env`.

All channels, balances, and invoices go away with the node data.
