// Write the connection values for the local regtest network to the root .env file.
// Start and fund the network first: docker compose -f network/docker-compose.yml up -d --wait && npm run bootstrap
// The values stay valid until you delete the node data in network/data/.
// The script owns the LND_, CLN_, ECLAIR_, and BITCOIND_ keys. It keeps all other lines, for example API_PORT.
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { type Impl, type Node, readNodes } from './nodes.ts';

const run = promisify(execFile);

const COMPOSE_FILE = fileURLToPath(new URL('../network/docker-compose.yml', import.meta.url));
const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
const LND_DIR = '/home/lnd/.lnd';
const LND_REST_PORT = 8080;
const LND_TLS_CERT = 'tls.cert';
const ADMIN_MACAROON = 'data/chain/bitcoin/regtest/admin.macaroon';
const CLN_DIR = '/home/clightning/.lightning';
const CLN_REST_PORT = 3010;
// CLNRest signs its TLS cert with this CA cert. The TLS cert names only the hosts cln and localhost,
// so the REST URL uses localhost and not 127.0.0.1.
const CLN_TLS_CERT = 'regtest/ca.pem';
// The Eclair API uses plain HTTP and a password. The compose file sets this password.
const ECLAIR_API_PORT = 8080;
const ECLAIR_API_PASSWORD = 'eclairpw';
const HEADER = '# Written by `npm run env`. The next run replaces the LND_, CLN_, ECLAIR_, and BITCOIND_ values and keeps the other lines.';
const OWNED_LINE = /^(# Written by `npm run env`|LND_|CLN_|ECLAIR_|BITCOIND_)/;
const BITCOIND_RPC_PORT = 18443;
// The -rpcauth value in the compose file is the hash of this password.
const BITCOIND_RPC_USER = 'polaruser';
const BITCOIND_RPC_PASS = 'polarpass';

type Port = { target: number; published: string };
type Volume = { source: string; target: string };
type ComposeConfig = { services: Record<string, { ports?: Port[]; volumes?: Volume[] }> };
type Rune = { rune: string; restrictions: unknown[]; blacklisted?: boolean };

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

// The action is a text for the error message, for example "read tls.cert from alice".
async function exec(action: string, args: string[]): Promise<Buffer> {
  try {
    const { stdout } = await run('docker', ['compose', '-f', COMPOSE_FILE, 'exec', '-T', ...args], { encoding: 'buffer' });
    return stdout;
  } catch {
    throw new Error(`Cannot ${action}. Start the network first: docker compose -f network/docker-compose.yml up -d --wait`);
  }
}

function readFromContainer(node: string, file: string): Promise<Buffer> {
  return exec(`read ${file} from ${node}`, [node, 'cat', file]);
}

// The host user cannot read the node files if the node runs with a different uid.
// Then the script reads the file from the container, and writes a copy next to the node data.
async function hostFile(config: ComposeConfig, node: string, dataDir: string, file: string): Promise<string> {
  const path = join(hostDir(config, node, dataDir), file);
  if (await canRead(path)) return path;
  const copy = join(hostDir(config, node, dataDir), '..', `${node}.${file.split('/').at(-1)}`);
  await writeFile(copy, await readFromContainer(node, `${dataDir}/${file}`));
  return copy;
}

async function lndEnv(config: ComposeConfig, node: string): Promise<string[]> {
  const macaroonPath = join(hostDir(config, node, LND_DIR), ADMIN_MACAROON);
  const macaroon = (await canRead(macaroonPath))
    ? await readFile(macaroonPath)
    : await readFromContainer(node, `${LND_DIR}/${ADMIN_MACAROON}`);
  const prefix = `LND_${node.toUpperCase()}`;
  return [
    `${prefix}_REST_URL=https://127.0.0.1:${hostPort(config, node, LND_REST_PORT)}`,
    `${prefix}_MACAROON_HEX=${macaroon.toString('hex')}`,
    `${prefix}_TLS_CERT_PATH=${await hostFile(config, node, LND_DIR, LND_TLS_CERT)}`,
  ];
}

async function lightningCli<T>(node: string, ...args: string[]): Promise<T> {
  const stdout = await exec(`run lightning-cli ${args[0]} on ${node}`, ['-u', 'clightning', node, 'lightning-cli', '--network=regtest', ...args]);
  return JSON.parse(stdout.toString()) as T;
}

// A rune with no restrictions gives full control of the node, like the LND admin macaroon.
// The script uses the first rune of this type, so the value stays the same on each run.
async function adminRune(node: string): Promise<string> {
  const { runes } = await lightningCli<{ runes: Rune[] }>(node, 'showrunes');
  const rune = runes.find((r) => r.restrictions.length === 0 && !r.blacklisted);
  return rune?.rune ?? (await lightningCli<Rune>(node, 'createrune')).rune;
}

async function clnEnv(config: ComposeConfig, node: string): Promise<string[]> {
  const prefix = `CLN_${node.toUpperCase()}`;
  return [
    `${prefix}_REST_URL=https://localhost:${hostPort(config, node, CLN_REST_PORT)}`,
    `${prefix}_RUNE=${await adminRune(node)}`,
    `${prefix}_TLS_CERT_PATH=${await hostFile(config, node, CLN_DIR, CLN_TLS_CERT)}`,
  ];
}

function eclairEnv(config: ComposeConfig, node: string): Promise<string[]> {
  const prefix = `ECLAIR_${node.toUpperCase()}`;
  return Promise.resolve([
    `${prefix}_API_URL=http://127.0.0.1:${hostPort(config, node, ECLAIR_API_PORT)}`,
    `${prefix}_API_PASSWORD=${ECLAIR_API_PASSWORD}`,
  ]);
}

const NODE_ENVS: Record<Impl, (config: ComposeConfig, node: string) => Promise<string[]>> = { lnd: lndEnv, cln: clnEnv, eclair: eclairEnv };

function nodeEnv(config: ComposeConfig, node: Node): Promise<string[]> {
  return NODE_ENVS[node.impl](config, node.name);
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
  const nodes = await Promise.all((await readNodes()).map((node) => nodeEnv(config, node)));
  const lines = [
    HEADER,
    ...(await keptLines()),
    ...nodes.flat(),
    `BITCOIND_RPC_URL=http://127.0.0.1:${hostPort(config, 'bitcoind', BITCOIND_RPC_PORT)}`,
    `BITCOIND_RPC_USER=${BITCOIND_RPC_USER}`,
    `BITCOIND_RPC_PASS=${BITCOIND_RPC_PASS}`,
  ];
  // The admin macaroons, the runes, and the Eclair API passwords give full control of the nodes, so only the owner can read the file.
  await writeFile(ENV_FILE, `${lines.join('\n')}\n`, { mode: 0o600 });
  console.log(`Wrote ${ENV_FILE}`);
}

try {
  await main();
} catch (error) {
  console.error(`env failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
