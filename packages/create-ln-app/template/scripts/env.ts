// Write the connection values for the local regtest network to the root .env file.
// Start and fund the network first: docker compose -f network/docker-compose.yml up -d --wait && npm run bootstrap
// The values stay valid until you delete the node data in network/data/.
// The script owns the LND_ and BITCOIND_ keys. It keeps all other lines, for example API_PORT.
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readNodes } from './nodes.ts';

const run = promisify(execFile);

const COMPOSE_FILE = fileURLToPath(new URL('../network/docker-compose.yml', import.meta.url));
const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
const LND_DIR = '/home/lnd/.lnd';
const LND_REST_PORT = 8080;
const TLS_CERT = 'tls.cert';
const ADMIN_MACAROON = 'data/chain/bitcoin/regtest/admin.macaroon';
const HEADER = '# Written by `npm run env`. The next run replaces the LND_ and BITCOIND_ values and keeps the other lines.';
const OWNED_LINE = /^(# Written by `npm run env`|LND_|BITCOIND_)/;
const BITCOIND_RPC_PORT = 18443;
// The -rpcauth value in the compose file is the hash of this password.
const BITCOIND_RPC_USER = 'polaruser';
const BITCOIND_RPC_PASS = 'polarpass';

type Port = { target: number; published: string };
type Volume = { source: string; target: string };
type ComposeConfig = { services: Record<string, { ports?: Port[]; volumes?: Volume[] }> };

async function composeConfig(): Promise<ComposeConfig> {
  const { stdout } = await run('docker', ['compose', '-f', COMPOSE_FILE, 'config', '--format', 'json']);
  return JSON.parse(stdout) as ComposeConfig;
}

function hostPort(config: ComposeConfig, service: string, target: number): string {
  const port = config.services[service]?.ports?.find((p) => p.target === target);
  if (!port) throw new Error(`No published port for ${service}:${target} in ${COMPOSE_FILE}`);
  return port.published;
}

function hostDir(config: ComposeConfig, service: string, target: string): string {
  const volume = config.services[service]?.volumes?.find((v) => v.target === target);
  if (!volume) throw new Error(`No volume for ${service}:${target} in ${COMPOSE_FILE}`);
  return volume.source;
}

async function canRead(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readFromContainer(node: string, file: string): Promise<Buffer> {
  try {
    const args = ['compose', '-f', COMPOSE_FILE, 'exec', '-T', node, 'cat', `${LND_DIR}/${file}`];
    const { stdout } = await run('docker', args, { encoding: 'buffer' });
    return stdout;
  } catch {
    throw new Error(`Cannot read ${file} from ${node}. Start the network first: docker compose -f network/docker-compose.yml up -d --wait`);
  }
}

// The host user cannot read the node files if LND runs with a different uid.
// Then the script reads them from the container, and writes a copy of the TLS cert next to the node data.
async function nodeEnv(config: ComposeConfig, node: string): Promise<string[]> {
  const dir = hostDir(config, node, LND_DIR);
  const macaroonPath = join(dir, ADMIN_MACAROON);
  const macaroon = (await canRead(macaroonPath)) ? await readFile(macaroonPath) : await readFromContainer(node, ADMIN_MACAROON);
  let certPath = join(dir, TLS_CERT);
  if (!(await canRead(certPath))) {
    certPath = join(dir, '..', `${node}.${TLS_CERT}`);
    await writeFile(certPath, await readFromContainer(node, TLS_CERT));
  }
  const prefix = `LND_${node.toUpperCase()}`;
  return [
    `${prefix}_REST_URL=https://127.0.0.1:${hostPort(config, node, LND_REST_PORT)}`,
    `${prefix}_MACAROON_HEX=${macaroon.toString('hex')}`,
    `${prefix}_TLS_CERT_PATH=${certPath}`,
  ];
}

// The lines of the old .env file that this script does not write.
async function keptLines(): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(ENV_FILE, 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').filter((line) => line.trim() !== '' && !OWNED_LINE.test(line));
}

async function main(): Promise<void> {
  const config = await composeConfig();
  const nodes = await Promise.all((await readNodes()).map((node) => nodeEnv(config, node.name)));
  const lines = [
    HEADER,
    ...(await keptLines()),
    ...nodes.flat(),
    `BITCOIND_RPC_URL=http://127.0.0.1:${hostPort(config, 'bitcoind', BITCOIND_RPC_PORT)}`,
    `BITCOIND_RPC_USER=${BITCOIND_RPC_USER}`,
    `BITCOIND_RPC_PASS=${BITCOIND_RPC_PASS}`,
  ];
  // The admin macaroons give full control of the nodes, so only the owner can read the file.
  await writeFile(ENV_FILE, `${lines.join('\n')}\n`, { mode: 0o600 });
  console.log(`Wrote ${ENV_FILE}`);
}

try {
  await main();
} catch (error) {
  console.error(`env failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
