// Write network/docker-compose.yml from the node list in network/nodes.json.
// Node i (from 0) gets REST port 8081+i, gRPC port 10001+i, and P2P port 9735+i on the host.
// The compose project name comes from the name in package.json, so two apps have two networks.
// The script uses only Node built-in modules, so it can run before npm install.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const NODES_FILE = fileURLToPath(new URL('../network/nodes.json', import.meta.url));
const COMPOSE_FILE = fileURLToPath(new URL('../network/docker-compose.yml', import.meta.url));
const PACKAGE_FILE = fileURLToPath(new URL('../package.json', import.meta.url));
const REST_PORT = 8081;
const GRPC_PORT = 10001;
const P2P_PORT = 9735;

type Node = { name: string; impl: string };

// A compose project name has only lowercase letters, digits, dashes, and underscores.
// It starts with a letter or a digit. For example, "@me/My.App" gives "me-my-app".
function projectName(packageName: string): string {
  const name = packageName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '');
  return name || 'lapp';
}

function lndService(node: Node, i: number): string {
  const { name } = node;
  return `  ${name}:
    <<: *lnd
    hostname: ${name}
    command: >-
      lnd --noseedbackup --trickledelay=5000 --alias=${name} --externalip=${name}
      --tlsextradomain=${name} --tlsextraip=127.0.0.1
      --listen=0.0.0.0:9735 --rpclisten=0.0.0.0:10009 --restlisten=0.0.0.0:8080
      --bitcoin.regtest --bitcoin.node=bitcoind
      --bitcoind.rpchost=bitcoind --bitcoind.rpcuser=polaruser
      --bitcoind.rpcpass=polarpass
      --bitcoind.zmqpubrawblock=tcp://bitcoind:28334
      --bitcoind.zmqpubrawtx=tcp://bitcoind:28335
    volumes:
      - ./data/${name}:/home/lnd/.lnd
    ports:
      - '${REST_PORT + i}:8080'
      - '${GRPC_PORT + i}:10009'
      - '${P2P_PORT + i}:9735'
`;
}

function composeFile(project: string, nodes: Node[]): string {
  const names = nodes.map((node) => node.name).join(', ');
  return `# Generated from nodes.json. Do not edit. To change the nodes, edit network/nodes.json and run: npm run compose
# Local regtest network: 1 bitcoind and ${nodes.length} LND nodes (${names}).
# Node data goes to ./data/ (ignored in git).
name: ${project}

x-lnd: &lnd
  image: polarlightning/lnd:0.20.0-beta
  restart: unless-stopped
  environment:
    USERID: \${USERID:-1000}
    GROUPID: \${GROUPID:-1000}
  depends_on:
    bitcoind:
      condition: service_healthy
  healthcheck:
    # The health check runs as root, so it gives lncli the LND dir.
    # For manual calls, run \`docker compose exec -u lnd <node> lncli -n regtest ...\`.
    test: ['CMD', 'lncli', '--lnddir=/home/lnd/.lnd', '-n', 'regtest', 'getinfo']
    interval: 2s
    timeout: 5s
    retries: 60
  expose:
    - '8080'
    - '10009'
    - '9735'

services:
  bitcoind:
    image: polarlightning/bitcoind:30.0
    restart: unless-stopped
    environment:
      USERID: \${USERID:-1000}
      GROUPID: \${GROUPID:-1000}
    hostname: bitcoind
    command: >-
      bitcoind -server=1 -regtest=1
      -rpcauth=polaruser:5e5e98c21f5c814568f8b55d83b23c1c$$066b03f92df30b11de8e4b1b1cd5b1b4281aa25205bd57df9be82caf97a05526
      -zmqpubrawblock=tcp://0.0.0.0:28334 -zmqpubrawtx=tcp://0.0.0.0:28335
      -zmqpubhashblock=tcp://0.0.0.0:28336
      -txindex=1 -dnsseed=0 -rpcbind=0.0.0.0 -rpcallowip=0.0.0.0/0
      -rpcport=18443 -rest -listen=1 -listenonion=0 -fallbackfee=0.0002
    volumes:
      - ./data/bitcoind:/home/bitcoin/.bitcoin
    healthcheck:
      test: ['CMD', 'bitcoin-cli', '-regtest', '-rpcuser=polaruser', '-rpcpassword=polarpass', 'getblockchaininfo']
      interval: 2s
      timeout: 5s
      retries: 30
    expose:
      - '18443'
      - '18444'
      - '28334'
      - '28335'
    ports:
      - '18443:18443'
      - '19444:18444'
      - '28334:28334'
      - '29335:28335'
${nodes.map((node, i) => `\n${lndService(node, i)}`).join('')}`;
}

async function main(): Promise<void> {
  const nodes = JSON.parse(await readFile(NODES_FILE, 'utf8')) as Node[];
  const { name } = JSON.parse(await readFile(PACKAGE_FILE, 'utf8')) as { name?: string };
  const project = projectName(name ?? '');
  await writeFile(COMPOSE_FILE, composeFile(project, nodes));
  console.log(`Wrote ${COMPOSE_FILE}: project ${project}, ${nodes.length} nodes.`);
}

try {
  await main();
} catch (error) {
  console.error(`compose failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
