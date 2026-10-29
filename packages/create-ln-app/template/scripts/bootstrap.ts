// Fund the Lightning nodes on the local regtest network and wait for chain sync.
// Start the network first: docker compose -f network/docker-compose.yml up -d
// You can run this script again. It does not fund a node that has a balance.
import { execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { type Impl, type Node, readNodes } from './nodes.ts';

const run = promisify(execFile);

const COMPOSE_FILE = fileURLToPath(new URL('../network/docker-compose.yml', import.meta.url));
const BITCOIN_CLI = ['bitcoin-cli', '-regtest', '-rpcuser=polaruser', '-rpcpassword=polarpass'];
// A wallet can spend a coinbase output only after 100 confirmations.
const MATURITY_BLOCKS = 100;
const TIMEOUT_MS = 120_000;
const POLL_MS = 1_000;

type ContainerState = { Service: string; Health: string };
type LndInfo = { synced_to_chain: boolean; block_height: number };
type LndBalance = { confirmed_balance: string };
type LndAddress = { address: string };
// CLN shows a warning in getinfo while it or bitcoind syncs.
type ClnInfo = { blockheight: number; warning_bitcoind_sync?: string; warning_lightningd_sync?: string };
type ClnFunds = { outputs: { amount_msat: number; status: string }[] };
// CLN 25.12 signs a coinbase output to its bech32 address with the wrong key, so a channel open fails. A p2tr output works.
type ClnAddress = { p2tr: string };

// The wallet calls for one impl. A balance is in sats.
type Wallet = {
  balance: (node: string) => Promise<number>;
  newAddress: (node: string) => Promise<string>;
  synced: (node: string, height: number) => Promise<boolean>;
};

async function compose(...args: string[]): Promise<string> {
  const { stdout } = await run('docker', ['compose', '-f', COMPOSE_FILE, ...args]);
  return stdout.trim();
}

function bitcoinCli(...args: string[]): Promise<string> {
  return compose('exec', '-T', 'bitcoind', ...BITCOIN_CLI, ...args);
}

async function lncli<T>(node: string, ...args: string[]): Promise<T> {
  return JSON.parse(await compose('exec', '-T', '-u', 'lnd', node, 'lncli', '-n', 'regtest', ...args)) as T;
}

async function lightningCli<T>(node: string, ...args: string[]): Promise<T> {
  return JSON.parse(await compose('exec', '-T', '-u', 'clightning', node, 'lightning-cli', '--network=regtest', ...args)) as T;
}

const WALLETS: Record<Impl, Wallet> = {
  lnd: {
    balance: async (node) => Number((await lncli<LndBalance>(node, 'walletbalance')).confirmed_balance),
    newAddress: async (node) => (await lncli<LndAddress>(node, 'newaddress', 'p2wkh')).address,
    synced: async (node, height) => {
      const info = await lncli<LndInfo>(node, 'getinfo');
      return info.synced_to_chain && info.block_height >= height;
    },
  },
  cln: {
    balance: async (node) => {
      const { outputs } = await lightningCli<ClnFunds>(node, 'listfunds');
      const msat = outputs.filter((output) => output.status === 'confirmed').reduce((sum, output) => sum + output.amount_msat, 0);
      return Math.floor(msat / 1000);
    },
    newAddress: async (node) => (await lightningCli<ClnAddress>(node, 'newaddr', 'p2tr')).p2tr,
    synced: async (node, height) => {
      const info = await lightningCli<ClnInfo>(node, 'getinfo');
      return !info.warning_bitcoind_sync && !info.warning_lightningd_sync && info.blockheight >= height;
    },
  },
};

async function waitFor(goal: string, check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timeout: ${goal}`);
    await sleep(POLL_MS);
  }
}

async function containerStates(): Promise<ContainerState[]> {
  const out = await compose('ps', '--format', 'json');
  // Compose 2.21 and later prints one JSON object on each line. Older versions print a JSON array.
  if (out.startsWith('[')) return JSON.parse(out) as ContainerState[];
  return out.split('\n').filter(Boolean).map((line) => JSON.parse(line) as ContainerState);
}

async function waitForHealthy(nodes: string[]): Promise<void> {
  await waitFor('all containers are healthy', async () => {
    const states = await containerStates();
    const stopped = ['bitcoind', ...nodes].filter((service) => !states.some((state) => state.Service === service));
    if (stopped.length > 0) {
      throw new Error(`Not running: ${stopped.join(', ')}. Start the network first: npm run network`);
    }
    return states.every((state) => state.Health === 'healthy');
  });
}

function balance(node: Node): Promise<number> {
  return WALLETS[node.impl].balance(node.name);
}

function newAddress(node: Node): Promise<string> {
  return WALLETS[node.impl].newAddress(node.name);
}

async function mine(blocks: number, address: string): Promise<void> {
  await bitcoinCli('generatetoaddress', String(blocks), address);
}

async function main(): Promise<void> {
  const nodes = await readNodes();
  console.log('Wait for healthy containers.');
  await waitForHealthy(nodes.map((node) => node.name));

  const unfunded: Node[] = [];
  for (const node of nodes) {
    if ((await balance(node)) === 0) unfunded.push(node);
  }

  if (unfunded.length > 0) {
    console.log(`Fund ${unfunded.map((node) => node.name).join(', ')}.`);
    let address = '';
    for (const node of unfunded) {
      address = await newAddress(node);
      await mine(1, address);
    }
    await mine(MATURITY_BLOCKS, address);
  } else {
    // bitcoind stays in initial block download while the tip is more than 24 hours old.
    // The nodes do not sync during initial block download, so 1 new block is necessary.
    const { initialblockdownload } = JSON.parse(await bitcoinCli('getblockchaininfo')) as { initialblockdownload: boolean };
    if (initialblockdownload) await mine(1, await newAddress(nodes[0]));
  }

  console.log('Wait for chain sync.');
  const height = Number(await bitcoinCli('getblockcount'));
  for (const node of nodes) {
    await waitFor(`${node.name} syncs to block ${height}`, () => WALLETS[node.impl].synced(node.name, height));
    await waitFor(`${node.name} has a confirmed balance`, async () => (await balance(node)) > 0);
    console.log(`${node.name}: ${await balance(node)} sats`);
  }
}

try {
  await main();
} catch (error) {
  console.error(`bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
