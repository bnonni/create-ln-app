// Write network/docker-compose.yml from the node list in network/nodes.json and the network in package.json.
// Node i (from 0) gets REST port 8081+i, gRPC port 10001+i, and P2P port 9735+i on the host.
// The compose project name comes from the name in package.json, so two apps have two networks.
// The script uses only Node built-in modules, so it can run before npm install.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { type Network, NETWORK_SPECS, type NetworkSpec, readNetwork } from './network.ts';
import { type Impl, type Node, readNodes } from './nodes.ts';

const COMPOSE_FILE = fileURLToPath(new URL('../network/docker-compose.yml', import.meta.url));
const PACKAGE_FILE = fileURLToPath(new URL('../package.json', import.meta.url));
const REST_PORT = 8081;
const GRPC_PORT = 10001;
const P2P_PORT = 9735;
// The Eclair API password. The env script writes it to .env.
const ECLAIR_API_PASSWORD = 'eclairpw';
// network/mutinynet/Dockerfile makes this image. Change the tag when you change the Dockerfile.
const MUTINYNET_IMAGE = 'create-ln-app/mutinynet-bitcoind:2fda7bfc027e';
// The Mutinynet chain settings (ROADMAP.md fact 4). Stock Bitcoin Core does not know signetblocktime.
const MUTINYNET_FLAGS = `-signetchallenge=512102f7561d208dd9ae99bf497273e16f389bdbd6c4742ddb8e6b216e64fa2928ad8f51ae
      -signetblocktime=30 -addnode=45.79.52.207:38333`;

// A compose project name has only lowercase letters, digits, dashes, and underscores.
// It starts with a letter or a digit. For example, "@me/My.App" gives "me-my-app".
function projectName(packageName: string): string {
  const name = packageName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '');
  return name || 'lapp';
}

type Net = NetworkSpec & { network: Network };
// The container ports and the data dir of each impl. A node without a gRPC port gets no gRPC host port.
type ImplSpec = { anchor: (net: Net) => string; dataDir: string; rest: number; grpc?: number; command: (name: string, net: Net) => string };

// On Mutinynet, each block adds lines to the logs. A service that has this line keeps 30 MB of logs or less.
function logging(net: Net, indent: string): string {
  return net.network === 'mutinynet' ? `${indent}logging: *logging\n` : '';
}

const IMPL_SPECS: Record<Impl, ImplSpec> = {
  lnd: {
    anchor: (net) => `x-lnd: &lnd
  image: polarlightning/lnd:0.20.0-beta
  restart: unless-stopped
${logging(net, '  ')}  environment:
    USERID: \${USERID:-1000}
    GROUPID: \${GROUPID:-1000}
  depends_on:
    bitcoind:
      condition: service_healthy
  healthcheck:
    # The health check runs as root, so it gives lncli the LND dir.
    # For manual calls, run \`docker compose exec -u lnd <node> lncli -n ${net.chain} ...\`.
    test: ['CMD', 'lncli', '--lnddir=/home/lnd/.lnd', '-n', '${net.chain}', 'getinfo']
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
    // LND finds the RPC port of a regtest bitcoind, but on signet it needs the port.
    // On Mutinynet, --nobootstrap stops the search for peers in the DNS seeds of the default signet.
    command: (name, net) => `lnd --noseedbackup --trickledelay=5000 --alias=${name} --externalip=${name}${net.network === 'mutinynet' ? ' --nobootstrap' : ''}
      --tlsextradomain=${name} --tlsextraip=127.0.0.1
      --listen=0.0.0.0:9735 --rpclisten=0.0.0.0:10009 --restlisten=0.0.0.0:8080
      --bitcoin.${net.chain} --bitcoin.node=bitcoind
      --bitcoind.rpchost=bitcoind${net.network === 'mutinynet' ? `:${net.rpcPort}` : ''} --bitcoind.rpcuser=polaruser
      --bitcoind.rpcpass=polarpass
      --bitcoind.zmqpubrawblock=tcp://bitcoind:28334
      --bitcoind.zmqpubrawtx=tcp://bitcoind:28335`,
  },
  cln: {
    anchor: (net) => `x-cln: &cln
  image: polarlightning/clightning:25.12
  restart: unless-stopped
${logging(net, '  ')}  environment:
    USERID: \${USERID:-1000}
    GROUPID: \${GROUPID:-1000}
  depends_on:
    bitcoind:
      condition: service_healthy
  healthcheck:
    # The health check runs as root, so it gives lightning-cli the CLN dir.
    # For manual calls, run \`docker compose exec -u clightning <node> lightning-cli --network=${net.chain} ...\`.
    test: ['CMD', 'lightning-cli', '--lightning-dir=/home/clightning/.lightning', '--network=${net.chain}', 'getinfo']
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
    // CLN polls bitcoind for new blocks. On regtest, the dev options make the poll and the gossip fast.
    // The Mutinynet test (ROADMAP.md fact 11) used no dev options.
    command: (name, net) => `lightningd --network=${net.chain} --alias=${name}
      --bind-addr=0.0.0.0:9735 --announce-addr=${name}:9735
      --bitcoin-rpcconnect=bitcoind --bitcoin-rpcport=${net.rpcPort}
      --bitcoin-rpcuser=polaruser --bitcoin-rpcpassword=polarpass
      --clnrest-host=0.0.0.0 --clnrest-port=3010
      --grpc-host=0.0.0.0 --grpc-port=10009${net.network === 'regtest' ? '\n      --developer --dev-bitcoind-poll=1 --dev-fast-gossip' : ''}`,
  },
  eclair: {
    // Eclair is not tested on Mutinynet (ROADMAP.md fact 5), so main() stops before it uses this spec there.
    anchor: () => `x-eclair: &eclair
  # Do not use the 0.12.0 or the 0.13.1 image. They use Alpine Linux, but their secp256k1 library needs glibc.
  # Thus, Eclair crashes when it opens a channel.
  image: polarlightning/eclair:0.11.0
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

function nodeService(node: Node, i: number, net: Net): string {
  const { name, impl } = node;
  const spec = IMPL_SPECS[impl];
  const ports = [`${REST_PORT + i}:${spec.rest}`, ...(spec.grpc ? [`${GRPC_PORT + i}:${spec.grpc}`] : []), `${P2P_PORT + i}:9735`];
  return `  ${name}:
    <<: *${impl}
    hostname: ${name}
    command: >-
      ${spec.command(name, net)}
    volumes:
      - ./data/${name}:${spec.dataDir}
    ports:
${ports.map((port) => `      - '${port}'`).join('\n')}
`;
}

// On Mutinynet, bitcoind writes its log only to the Docker log, because the debug.log file grows by about 800 MB in the first sync.
// Mutinynet needs no published P2P port, because bitcoind connects to the peers.
// With the Mutinynet chain, bitcoind loads its block index for 15 s or more after a restart. The RPC calls fail until then.
const START_PERIOD = `
      start_period: 5m`;

function bitcoindService(net: Net): string {
  const mutinynet = net.network === 'mutinynet';
  const p2pPort = mutinynet ? 38333 : 18444;
  const ports = [`${net.rpcPort}:${net.rpcPort}`, ...(mutinynet ? [] : [`19444:${p2pPort}`]), '28334:28334', '29335:28335'];
  const image = mutinynet
    ? `    # network/mutinynet/Dockerfile puts the bitcoind of the Mutinynet fork in the polarlightning/bitcoind image.
    image: ${MUTINYNET_IMAGE}
    build: ./mutinynet
`
    : `    image: polarlightning/bitcoind:30.0
`;
  return `  bitcoind:
${image}    restart: unless-stopped
${logging(net, '    ')}    environment:
      USERID: \${USERID:-1000}
      GROUPID: \${GROUPID:-1000}
    hostname: bitcoind
    command: >-
      bitcoind -server=1 -${net.chain}=1${mutinynet ? `\n      ${MUTINYNET_FLAGS} -nodebuglogfile` : ''}
      -rpcauth=polaruser:5e5e98c21f5c814568f8b55d83b23c1c$$066b03f92df30b11de8e4b1b1cd5b1b4281aa25205bd57df9be82caf97a05526
      -zmqpubrawblock=tcp://0.0.0.0:28334 -zmqpubrawtx=tcp://0.0.0.0:28335
      -zmqpubhashblock=tcp://0.0.0.0:28336
      -txindex=1 -dnsseed=0 -rpcbind=0.0.0.0 -rpcallowip=0.0.0.0/0
      -rpcport=${net.rpcPort} -rest -listen=1 -listenonion=0 -fallbackfee=0.0002
    volumes:
      - ./data/bitcoind:/home/bitcoin/.bitcoin
    healthcheck:
      test: ['CMD', 'bitcoin-cli', '-${net.chain}', '-rpcuser=polaruser', '-rpcpassword=polarpass', 'getblockchaininfo']
      interval: 2s
      timeout: 5s
      retries: 30${mutinynet ? START_PERIOD : ''}
    expose:
${[net.rpcPort, p2pPort, 28334, 28335, 28336].map((port) => `      - '${port}'`).join('\n')}
    ports:
${ports.map((port) => `      - '${port}'`).join('\n')}
`;
}

const LOGGING_ANCHOR = `x-logging: &logging
  driver: json-file
  options:
    max-size: 10m
    max-file: '3'

`;

function composeFile(project: string, nodes: Node[], net: Net): string {
  const names = nodes.map((node) => `${node.name} ${node.impl}`).join(', ');
  const impls = [...new Set(nodes.map((node) => node.impl))];
  const title = net.network === 'mutinynet' ? 'Mutinynet network (config.network in package.json)' : 'Local regtest network';
  return `# Generated from nodes.json. Do not edit. To change the nodes, edit network/nodes.json and run: npm run compose
# ${title}: 1 bitcoind and ${nodes.length} Lightning nodes (${names}).
# Node data goes to ./data/ (ignored in git).
name: ${project}

${net.network === 'mutinynet' ? LOGGING_ANCHOR : ''}${impls.map((impl) => IMPL_SPECS[impl].anchor(net)).join('\n')}
services:
${bitcoindService(net)}${nodes.map((node, i) => `\n${nodeService(node, i, net)}`).join('')}`;
}

// Eclair needs Bitcoin Core 31 or later and other settings on a custom signet (ROADMAP.md fact 5).
function checkImpls(network: Network, nodes: Node[]): void {
  const eclair = nodes.filter((node) => node.impl === 'eclair').map((node) => node.name);
  if (network !== 'mutinynet' || eclair.length === 0) return;
  throw new Error(
    `On Mutinynet, the nodes can be only LND or CLN, but ${eclair.join(', ')} ${eclair.length === 1 ? 'is' : 'are'} Eclair. ` +
      'Fix: set "impl" to "lnd" or "cln" in network/nodes.json, or set "config.network" to "regtest" in package.json.',
  );
}

async function main(): Promise<void> {
  const nodes = await readNodes();
  const network = await readNetwork();
  checkImpls(network, nodes);
  const { name } = JSON.parse(await readFile(PACKAGE_FILE, 'utf8')) as { name?: string };
  const project = projectName(name ?? '');
  await writeFile(COMPOSE_FILE, composeFile(project, nodes, { network, ...NETWORK_SPECS[network] }));
  console.log(`Wrote ${COMPOSE_FILE}: project ${project}, ${nodes.length} nodes, ${network}.`);
}

try {
  await main();
} catch (error) {
  console.error(`compose failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
