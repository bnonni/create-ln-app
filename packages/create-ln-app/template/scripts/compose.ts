// Write network/docker-compose.yml from the node list in network/nodes.json.
// Node i (from 0) gets REST port 8081+i, gRPC port 10001+i, and P2P port 9735+i on the host.
// The compose project name comes from the name in package.json, so two apps have two networks.
// The script uses only Node built-in modules, so it can run before npm install.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { type Impl, type Node, readNodes } from './nodes.ts';

const COMPOSE_FILE = fileURLToPath(new URL('../network/docker-compose.yml', import.meta.url));
const PACKAGE_FILE = fileURLToPath(new URL('../package.json', import.meta.url));
const REST_PORT = 8081;
const GRPC_PORT = 10001;
const P2P_PORT = 9735;
// The Eclair API password. The env script writes it to .env.
const ECLAIR_API_PASSWORD = 'eclairpw';

// A compose project name has only lowercase letters, digits, dashes, and underscores.
// It starts with a letter or a digit. For example, "@me/My.App" gives "me-my-app".
function projectName(packageName: string): string {
  const name = packageName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '');
  return name || 'lapp';
}

// The container ports and the data dir of each impl. A node without a gRPC port gets no gRPC host port.
type ImplSpec = { anchor: string; dataDir: string; rest: number; grpc?: number; command: (name: string) => string };

const IMPL_SPECS: Record<Impl, ImplSpec> = {
  lnd: {
    anchor: `x-lnd: &lnd
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
`,
    dataDir: '/home/lnd/.lnd',
    rest: 8080,
    grpc: 10009,
    command: (name) => `lnd --noseedbackup --trickledelay=5000 --alias=${name} --externalip=${name}
      --tlsextradomain=${name} --tlsextraip=127.0.0.1
      --listen=0.0.0.0:9735 --rpclisten=0.0.0.0:10009 --restlisten=0.0.0.0:8080
      --bitcoin.regtest --bitcoin.node=bitcoind
      --bitcoind.rpchost=bitcoind --bitcoind.rpcuser=polaruser
      --bitcoind.rpcpass=polarpass
      --bitcoind.zmqpubrawblock=tcp://bitcoind:28334
      --bitcoind.zmqpubrawtx=tcp://bitcoind:28335`,
  },
  cln: {
    anchor: `x-cln: &cln
  image: polarlightning/clightning:25.12
  restart: unless-stopped
  environment:
    USERID: \${USERID:-1000}
    GROUPID: \${GROUPID:-1000}
  depends_on:
    bitcoind:
      condition: service_healthy
  healthcheck:
    # The health check runs as root, so it gives lightning-cli the CLN dir.
    # For manual calls, run \`docker compose exec -u clightning <node> lightning-cli --network=regtest ...\`.
    test: ['CMD', 'lightning-cli', '--lightning-dir=/home/clightning/.lightning', '--network=regtest', 'getinfo']
    interval: 2s
    timeout: 5s
    retries: 60
  expose:
    - '3010'
    - '10009'
    - '9735'
`,
    dataDir: '/home/clightning/.lightning',
    rest: 3010,
    grpc: 10009,
    // CLN polls bitcoind for new blocks. The dev options make the poll and the gossip fast.
    command: (name) => `lightningd --network=regtest --alias=${name}
      --bind-addr=0.0.0.0:9735 --announce-addr=${name}:9735
      --bitcoin-rpcconnect=bitcoind --bitcoin-rpcport=18443
      --bitcoin-rpcuser=polaruser --bitcoin-rpcpassword=polarpass
      --clnrest-host=0.0.0.0 --clnrest-port=3010
      --grpc-host=0.0.0.0 --grpc-port=10009
      --developer --dev-bitcoind-poll=1 --dev-fast-gossip`,
  },
  eclair: {
    anchor: `x-eclair: &eclair
  image: polarlightning/eclair:0.13.1
  restart: unless-stopped
  # Eclair has no wallet of its own. It uses the bitcoind wallet with the node name (the host name).
  # Before Eclair starts, the entrypoint makes the wallet, or loads the wallet if it exists.
  # With load_on_startup, bitcoind loads the wallet again after a restart.
  entrypoint:
    - bash
    - -c
    - |
      wallet=$$(hostname)
      curl -s -o /dev/null -u polaruser:polarpass http://bitcoind:18443/ -d '{"method":"createwallet","params":{"wallet_name":"'$$wallet'","load_on_startup":true}}'
      curl -s -o /dev/null -u polaruser:polarpass http://bitcoind:18443/ -d '{"method":"loadwallet","params":{"filename":"'$$wallet'","load_on_startup":true}}'
      exec /entrypoint.sh "$$@"
    - eclair
  environment:
    USERID: \${USERID:-1000}
    GROUPID: \${GROUPID:-1000}
  depends_on:
    bitcoind:
      condition: service_healthy
  healthcheck:
    # For manual calls, run \`docker compose exec <node> eclair-cli -p ${ECLAIR_API_PASSWORD} ...\`.
    test: ['CMD', 'eclair-cli', '-p', '${ECLAIR_API_PASSWORD}', 'getinfo']
    interval: 2s
    timeout: 5s
    retries: 60
  expose:
    - '8080'
    - '9735'
`,
    dataDir: '/home/eclair/.eclair',
    rest: 8080,
    // Eclair gets the block hashes and the raw transactions from the bitcoind ZMQ streams.
    // The entrypoint changes each --key=value to -Declair.key=value, and puts the container IP in public-ips.
    // The regtest fee rates of the other impls are not real, so the feerate-tolerance options accept all fee rates.
    command: (name) => `polar-eclair --chain=regtest --node-alias=${name}
      --server.port=9735 --server.public-ips.0=${name}
      --api.enabled=true --api.binding-ip=0.0.0.0 --api.port=8080 --api.password=${ECLAIR_API_PASSWORD}
      --bitcoind.host=bitcoind --bitcoind.rpcport=18443
      --bitcoind.rpcuser=polaruser --bitcoind.rpcpassword=polarpass --bitcoind.wallet=${name}
      --bitcoind.zmqblock=tcp://bitcoind:28336 --bitcoind.zmqtx=tcp://bitcoind:28335
      --on-chain-fees.feerate-tolerance.ratio-low=0.00001 --on-chain-fees.feerate-tolerance.ratio-high=10000.0
      --datadir=/home/eclair/.eclair --printToConsole=true`,
  },
};

function nodeService(node: Node, i: number): string {
  const { name, impl } = node;
  const spec = IMPL_SPECS[impl];
  const ports = [`${REST_PORT + i}:${spec.rest}`, ...(spec.grpc ? [`${GRPC_PORT + i}:${spec.grpc}`] : []), `${P2P_PORT + i}:9735`];
  return `  ${name}:
    <<: *${impl}
    hostname: ${name}
    command: >-
      ${spec.command(name)}
    volumes:
      - ./data/${name}:${spec.dataDir}
    ports:
${ports.map((port) => `      - '${port}'`).join('\n')}
`;
}

function composeFile(project: string, nodes: Node[]): string {
  const names = nodes.map((node) => `${node.name} ${node.impl}`).join(', ');
  const impls = [...new Set(nodes.map((node) => node.impl))];
  return `# Generated from nodes.json. Do not edit. To change the nodes, edit network/nodes.json and run: npm run compose
# Local regtest network: 1 bitcoind and ${nodes.length} Lightning nodes (${names}).
# Node data goes to ./data/ (ignored in git).
name: ${project}

${impls.map((impl) => IMPL_SPECS[impl].anchor).join('\n')}
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
      - '28336'
    ports:
      - '18443:18443'
      - '19444:18444'
      - '28334:28334'
      - '29335:28335'
${nodes.map((node, i) => `\n${nodeService(node, i)}`).join('')}`;
}

async function main(): Promise<void> {
  const nodes = await readNodes();
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
