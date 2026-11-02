// Stop the local network and delete the node data in network/data/.
// The script keeps network/data/ and network/data/.gitkeep. If Docker creates a missing
// bind-mount directory, the owner is root on Linux, and then the host user cannot delete it.
// On Mutinynet, the script keeps the bitcoind chain data, because a new sync takes 40 min or more.
// The node wallets on Mutinynet hold faucet funds. If a node has funds, the script deletes nothing and fails.
// To delete the wallets and their funds: npm run reset -- --force
// Start a new network after a reset: npm run network
import { execFile } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { NETWORK_SPECS, readNetwork } from './network.ts';
import { readNodes } from './nodes.ts';
import { compose, wallets } from './wallets.ts';

const run = promisify(execFile);

const COMPOSE_FILE = fileURLToPath(new URL('../network/docker-compose.yml', import.meta.url));
const DATA_DIR = fileURLToPath(new URL('../network/data', import.meta.url));
const KEEP = '.gitkeep';
// The data folder of the bitcoind service.
const CHAIN_DIR = 'bitcoind';
// The script uses the image of this service to delete files that the host user cannot delete.
const CLEANUP_SERVICE = 'bitcoind';
const FORCE = '--force';

type ComposeConfig = { services: Record<string, { image?: string }> };

async function serviceImage(service: string): Promise<string> {
  const { stdout } = await run('docker', ['compose', '-f', COMPOSE_FILE, 'config', '--format', 'json']);
  const image = (JSON.parse(stdout) as ComposeConfig).services[service]?.image;
  if (!image) throw new Error(`No image for ${service} in ${COMPOSE_FILE}`);
  return image;
}

async function hasData(name: string): Promise<boolean> {
  try {
    return (await readdir(join(DATA_DIR, name))).length > 0;
  } catch {
    return false;
  }
}

// Return a problem line for each node that has funds, or whose funds the script cannot read.
async function fundProblems(): Promise<string[]> {
  const nodeWallets = wallets(NETWORK_SPECS.mutinynet.chain);
  const running = (await compose('ps', '--services', '--status', 'running')).split('\n');
  const problems: string[] = [];
  for (const node of await readNodes()) {
    if (!(await hasData(node.name))) continue;
    if (!running.includes(node.name)) {
      problems.push(`  ${node.name}: the node does not run, so the script cannot read its funds.`);
      continue;
    }
    try {
      const sats = await nodeWallets[node.impl].funds(node.name);
      if (sats > 0) problems.push(`  ${node.name}: ${sats.toLocaleString('en')} sats`);
    } catch (error) {
      problems.push(`  ${node.name}: the script cannot read the funds. ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return problems;
}

async function main(): Promise<void> {
  const network = await readNetwork();
  const kept = [KEEP];
  if (network === 'mutinynet') {
    kept.push(CHAIN_DIR);
    const problems = process.argv.includes(FORCE) ? [] : await fundProblems();
    if (problems.length > 0) {
      console.error(`WARNING: reset deletes the node wallets. These nodes can have Mutinynet funds:
${problems.join('\n')}
Fix: close the channels, and send the funds to a wallet that you keep. If a node does not run, start the network with npm run network.
Then run npm run reset again. To delete the wallets and their funds, run: npm run reset -- ${FORCE}`);
      process.exitCode = 1;
      return;
    }
  }

  await run('docker', ['compose', '-f', COMPOSE_FILE, 'down', '--remove-orphans']);
  console.log('Stopped the network.');

  const names = (await readdir(DATA_DIR)).filter((name) => !kept.includes(name));
  const failed: string[] = [];
  for (const name of names) {
    try {
      await rm(join(DATA_DIR, name), { recursive: true, force: true });
    } catch {
      failed.push(name);
    }
  }
  if (failed.length > 0) {
    // A container user has root access to the bind mount, so it can delete files of all owners.
    const image = await serviceImage(CLEANUP_SERVICE);
    const paths = failed.map((name) => `/data/${name}`);
    await run('docker', ['run', '--rm', '-v', `${DATA_DIR}:/data`, '--entrypoint', 'rm', image, '-rf', ...paths]);
  }
  const chain = network === 'mutinynet' ? ` The script kept the chain data in ${join(DATA_DIR, CHAIN_DIR)}.` : '';
  console.log(`Deleted the node data in ${DATA_DIR}.${chain} To start a new network, run: npm run network`);
}

try {
  await main();
} catch (error) {
  console.error(`reset failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
