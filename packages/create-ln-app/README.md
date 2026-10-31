# create-ln-app

Make a Lightning app (Lapp) with a local regtest network. The new project has three parts:

1. A local Bitcoin Lightning Network for development: Bitcoin Core and 2 to 10 Lightning nodes on regtest. Each node is LND, Core Lightning (CLN), or Eclair. The default is 3 LND nodes.
2. An API server that connects to the nodes.
3. An example app that uses the API server.

You change the example app into your own Lapp. You do not configure nodes, macaroons, or TLS by hand.

## Prerequisites

- [Node.js](https://nodejs.org/) 24 (LTS) and npm. If you install `create-ln-app` with Homebrew, Homebrew installs Node.js for you.
- [Docker](https://docs.docker.com/engine/install/) with Docker Compose v2 (the `docker compose` command).

On macOS, start Docker Desktop before you continue.

### Windows

Use WSL2 (Windows Subsystem for Linux) with Ubuntu. Install Node.js 24 in Ubuntu. Install Docker in Ubuntu, or connect Docker Desktop to Ubuntu. Then run the commands below in the Ubuntu terminal, in your Linux home folder (`~/`), not in `/mnt/c`. Nobody tests the CLI and the network on native Windows. For the steps, see [Windows](https://github.com/bnonni/create-ln-app#windows).

## Usage

```sh
npx create-ln-app my-lapp
cd my-lapp
npm run dev
```

Then open <http://localhost:5173>. In a project from the `next-ts` template, open <http://localhost:3000>.

You can also start `create-ln-app` in one of these ways. Each way needs Docker.

- Shell script, for macOS, Linux, and WSL2. The script checks Node.js, npm, and Docker Compose. Then it runs `npx create-ln-app` with your arguments. It does not install Node.js or Docker, and it does not use `sudo`.
  ```sh
  curl -fsSL https://create-ln-app.dev/install.sh | bash -s -- my-lapp
  ```
- Homebrew, for macOS and Linux. The formula installs Node.js, but not Docker.
  ```sh
  brew install bnonni/tap/create-ln-app
  create-ln-app my-lapp
  ```

The command copies the template to `my-lapp`, runs `git init`, installs the npm packages, and runs `npm run doctor`. The doctor checks Docker, Docker Compose, and the ports. If a check fails, the doctor shows a fix.

Options:

| Option              | Effect                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `--template <name>` | Use this template: `react-ts` (React and TypeScript), `react` (React and JavaScript), or `next-ts` (Next.js and TypeScript). The default is `react-ts`. |
| `--nodes <n>`       | Make a network with n nodes, from 2 to 10. The default is 3.                                        |
| `--impl <impl>`     | Use this impl for all the nodes: `lnd`, `cln` (Core Lightning), or `eclair`. The default is `lnd`.  |
| `--skip-install`    | Do not install the npm packages.                                                                    |
| `-h`, `--help`      | Show the help.                                                                                      |

The README in the new project has all the commands. `network/README.md` in the new project has the network reference.

## Links

- Site: <https://create-ln-app.dev>
- Source: <https://github.com/bnonni/create-ln-app>
- [Troubleshooting](https://github.com/bnonni/create-ln-app/blob/master/docs/troubleshooting.md)
- [Architecture](https://github.com/bnonni/create-ln-app/blob/master/docs/architecture.md)
- [Changelog](https://github.com/bnonni/create-ln-app/blob/master/CHANGELOG.md)

## License

MIT. See [LICENSE](LICENSE).
