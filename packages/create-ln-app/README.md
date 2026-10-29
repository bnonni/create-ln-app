# create-ln-app

Make a Lightning app (Lapp) with a local regtest network. The new project has three parts:

1. A local Bitcoin Lightning Network for development: Bitcoin Core and 2 to 10 Lightning nodes on regtest. Each node is LND or Core Lightning (CLN). The default is 3 LND nodes.
2. An API server that connects to the nodes.
3. An example app that uses the API server.

You change the example app into your own Lapp. You do not configure nodes, macaroons, or TLS by hand.

## Prerequisites

- [Node.js](https://nodejs.org/) 24 (LTS) and npm.
- [Docker](https://docs.docker.com/engine/install/) with Docker Compose v2 (the `docker compose` command).

On macOS, start Docker Desktop before you continue.

## Usage

```sh
npx create-ln-app my-lapp
cd my-lapp
npm run dev
```

Then open <http://localhost:5173>.

The command copies the template to `my-lapp`, runs `git init`, installs the npm packages, and runs `npm run doctor`. The doctor checks Docker, Docker Compose, and the ports. If a check fails, the doctor shows a fix.

Options:

| Option           | Effect                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------- |
| `--nodes <n>`    | Make a network with n nodes, from 2 to 10. The default is 3.                            |
| `--impl <impl>`  | Use this impl for all the nodes: `lnd` or `cln` (Core Lightning). The default is `lnd`. |
| `--skip-install` | Do not install the npm packages.                                                        |
| `-h`, `--help`   | Show the help.                                                                          |

The README in the new project has all the commands and the network reference.

## Links

- Site: <https://create-ln-app.dev>
- Source: <https://github.com/bnonni/create-ln-app>
- [Troubleshooting](https://github.com/bnonni/create-ln-app/blob/master/docs/troubleshooting.md)
- [Architecture](https://github.com/bnonni/create-ln-app/blob/master/docs/architecture.md)
- [Changelog](https://github.com/bnonni/create-ln-app/blob/master/CHANGELOG.md)

## License

MIT. See [LICENSE](LICENSE).
