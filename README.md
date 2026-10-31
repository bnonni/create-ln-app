# create-ln-app

`create-ln-app` makes a Lightning app (Lapp) project with one command. The project has three parts:

1. A local Bitcoin Lightning Network for development: Bitcoin Core and 2 to 10 Lightning nodes on regtest. Each node is LND, Core Lightning (CLN), or Eclair. The default is 3 LND nodes.
2. An API server that connects to the nodes.
3. An example app that uses the API server.

You change the example app into your own Lapp. You do not configure nodes, macaroons, or TLS by hand.

## What is a Lapp?

A Lapp is an application that runs on the Bitcoin Lightning Network: (L)ightning (app). The name is a contrast to "dApp". We think that the Lightning Network will scale Bitcoin, and that Lapps will replace dApps.

## Why?

A local Lightning setup takes time. You must start nodes, fund wallets, and find macaroons and TLS certs. This project does that setup for you, so you can start to build your app.

## Prerequisites

- [Node.js](https://nodejs.org/) 24 (LTS) and npm. If you install `create-ln-app` with Homebrew, Homebrew installs Node.js for you.
- [Docker](https://docs.docker.com/engine/install/) with Docker Compose v2 (the `docker compose` command).

On macOS, start Docker Desktop before you continue. On Windows, see [Windows](#windows).

### Windows

Use WSL2 (Windows Subsystem for Linux) with Ubuntu. Nobody tests the CLI and the network on native Windows.

1. In PowerShell, run `wsl --install`. This command installs WSL2 and Ubuntu. Then restart Windows.
2. Install Docker. Use one of these:
   - [Docker Desktop](https://docs.docker.com/desktop/features/wsl/) with the WSL2 back end. In Docker Desktop, open Settings > Resources > WSL integration, and turn on Ubuntu.
   - [Docker Engine](https://docs.docker.com/engine/install/ubuntu/) in Ubuntu.
3. Install Node.js 24 in Ubuntu, not only in Windows. Then `which node` in Ubuntu must show a path that does not start with `/mnt/c`.
4. Do the [Quick start](#quick-start) in the Ubuntu terminal. Make the project in your Linux home folder (`~/`), not in `/mnt/c`. WSL2 is slow with files in `/mnt/c`, and the dev server does not see the changes that Windows apps make to these files.

Open the app in a Windows browser. WSL2 sends the `localhost` connections from Windows to Ubuntu. If a step fails, see [Windows](docs/troubleshooting.md#windows) in Troubleshooting.

## Quick start

1. Make a project. Use one of these ways. Each way runs the same `create-ln-app` command, and each way needs Docker.
   - npm (the default):
     ```sh
     npx create-ln-app my-lapp
     ```
   - Shell script, for macOS, Linux, and WSL2. The script checks Node.js, npm, and Docker Compose. Then it runs `npx create-ln-app` with your arguments. It does not install Node.js or Docker, and it does not use `sudo`.
     ```sh
     curl -fsSL https://create-ln-app.dev/install.sh | bash -s -- my-lapp
     ```
   - Homebrew, for macOS and Linux. The formula installs Node.js, but not Docker.
     ```sh
     brew install bnonni/tap/create-ln-app
     create-ln-app my-lapp
     ```
   - Windows: do the steps in [Windows](#windows) first. Then use one of the ways above in the Ubuntu terminal.
2. Start the network, the API server, and the example app:
   ```sh
   cd my-lapp
   npm run dev
   ```
3. Open <http://localhost:5173>.
4. Make a payment. Do the steps on the page in this sequence:
   1. "Who are you?": select `alice`.
   2. "1. Connect to a peer": select `bob`, then click "Connect".
   3. "2. Open a channel": click "Open channel".
   4. "3. Mine 6 blocks": click "Mine blocks". Then click "Refresh" until the channel status is `active`.
   5. "4. Request an invoice": click "Request invoice".
   6. "5. Pay the invoice": click "Pay invoice". The page shows `Invoice status: settled`.

The `create-ln-app` command copies the project to `my-lapp`, runs `git init`, and installs the npm packages. Then it runs `npm run doctor`, which checks Docker, Docker Compose, and the ports.

To make a network with a different number of nodes, add `--nodes <n>` to the `create-ln-app` command. The value is from 2 to 10. Example: `npx create-ln-app my-lapp --nodes 5`. With the shell script, put the options after the project name: `bash -s -- my-lapp --nodes 5`.

To use Core Lightning (CLN) for all the nodes, add `--impl cln`. To use Eclair for all the nodes, add `--impl eclair`. The default is `lnd`. Example: `npx create-ln-app my-lapp --impl cln`. To use more than one impl in one network, edit `network/nodes.json` in the project. See "Change the nodes" in `network/README.md` of the project.

To use JavaScript, not TypeScript, add `--template react`. The default is `react-ts` (React and TypeScript). Example: `npx create-ln-app my-lapp --template react`. In the `react` template, each `.ts` file is a `.js` file and each `.tsx` file is a `.jsx` file.

To use Next.js, add `--template next-ts` (Next.js and TypeScript). Example: `npx create-ln-app my-lapp --template next-ts`. In the `next-ts` template, Next.js serves the example app and the API at <http://localhost:3000>. The app is in `src/`, not in `frontend/src/`.

The `dev` command starts 1 bitcoind node and the Lightning nodes, funds the Lightning nodes, and writes the node values to `.env`. Then it starts the API server at <http://localhost:3001/api> and the example app at <http://localhost:5173>. The first start downloads the Docker images (about 510 MB), so it takes more time.

If a step fails, see [Troubleshooting](docs/troubleshooting.md).

## Next steps

- Make your own Lapp: each step in `frontend/src/components/Page.tsx` has a comment that starts with "Your feature". The file is `frontend/src/components/Page.jsx` in the `react` template and `src/components/Page.tsx` in the `next-ts` template.
- Read the project README for all the commands: [template README](packages/create-ln-app/template/README.md).
- Read the network reference for the host ports and the CLI commands of the nodes: [`network/README.md`](packages/create-ln-app/template/network/README.md).
- Read how the parts connect: [Architecture](docs/architecture.md).
- Read the API reference: [`server/API.md`](packages/create-ln-app/template/server/API.md).

## Development

To change create-ln-app itself, see [CONTRIBUTING.md](CONTRIBUTING.md). It has the set-up steps, the checks, the tests, and the publish steps.

The changes in each release are in [CHANGELOG.md](CHANGELOG.md). The plan after 1.0 is in [ROADMAP.md](ROADMAP.md#after-10).

## License

MIT. See [LICENSE](LICENSE).
