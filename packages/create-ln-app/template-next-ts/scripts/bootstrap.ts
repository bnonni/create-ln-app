// Fund the Lightning nodes and wait for chain sync.
// On regtest, the script mines blocks to the nodes. On Mutinynet, nothing mines blocks, so the funds come from the faucet.
// With a faucet token (npm run faucet:login), the script requests the funds. With no token, it shows the node addresses.
// Then it waits up to 15 min for the confirmed funds.
// Start the network first: docker compose -f network/docker-compose.yml up -d
// You can run this script again. It does not fund a node that has a balance.
import { setTimeout as sleep } from 'node:timers/promises';
import { errorText, FAUCET_URL, readToken, requestOnchain, tokenExpiry } from './faucet.ts';
import { type NetworkSpec, NETWORK_SPECS, readNetwork } from './network.ts';
import { type Node, readNodes } from './nodes.ts';
import { bitcoinCli, compose, type Wallet, wallets } from './wallets.ts';

// A wallet can spend a coinbase output only after 100 confirmations.
const MATURITY_BLOCKS = 100;
const TIMEOUT_MS = 120_000;
const POLL_MS = 1_000;
// The amount for each node on Mutinynet. It is sufficient for the 100,000-sat channel of the page and the fees.
// The faucet gives up to 1,000,000 sats in 24 hours.
const FAUCET_SATS = 200_000;
// A Mutinynet block comes every 30 s. The time also lets you use the faucet page.
const FUND_TIMEOUT_MS = 15 * 60_000;
const FUND_POLL_MS = 5_000;

type Chain = NetworkSpec['chain'];
type ContainerState = { Service: string; Health: string };
type WalletOf = (node: Node) => Wallet;

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

async function mine(blocks: number, address: string): Promise<void> {
  await bitcoinCli('regtest', 'generatetoaddress', String(blocks), address);
}

async function waitForSync(chain: Chain, nodes: Node[], wallet: WalletOf): Promise<void> {
  console.log('Wait for chain sync.');
  const height = Number(await bitcoinCli(chain, 'getblockcount'));
  for (const node of nodes) {
    await waitFor(`${node.name} syncs to block ${height}`, () => wallet(node).synced(node.name, height));
  }
}

async function mineFunds(nodes: Node[], wallet: WalletOf): Promise<void> {
  const unfunded: Node[] = [];
  for (const node of nodes) {
    if ((await wallet(node).balance(node.name)) === 0) unfunded.push(node);
  }

  if (unfunded.length > 0) {
    console.log(`Fund ${unfunded.map((node) => node.name).join(', ')}.`);
    let address = '';
    for (const node of unfunded) {
      address = await wallet(node).newAddress(node.name);
      await mine(1, address);
    }
    await mine(MATURITY_BLOCKS, address);
  } else {
    // bitcoind stays in initial block download while the tip is more than 24 hours old.
    // The nodes do not sync during initial block download, so 1 new block is necessary.
    const { initialblockdownload } = JSON.parse(await bitcoinCli('regtest', 'getblockchaininfo')) as { initialblockdownload: boolean };
    if (initialblockdownload) await mine(1, await wallet(nodes[0]).newAddress(nodes[0].name));
  }

  await waitForSync('regtest', nodes, wallet);
  for (const node of nodes) {
    await waitFor(`${node.name} has a confirmed balance`, async () => (await wallet(node).balance(node.name)) > 0);
    console.log(`${node.name}: ${await wallet(node).balance(node.name)} sats`);
  }
}

// The faucet token, or undefined if there is no token or if the token expired.
function usableToken(): string | undefined {
  const token = readToken();
  const expiry = token ? tokenExpiry(token) : undefined;
  if (expiry && expiry.getTime() <= Date.now()) {
    console.log(`The faucet token expired on ${expiry.toISOString()}. To get a new token, run npm run faucet:login.`);
    return undefined;
  }
  return token;
}

// Request the funds from the faucet. Return a line with the address of each node that the faucet did not fund.
async function requestFunds(unfunded: Node[], wallet: WalletOf): Promise<string[]> {
  let token = usableToken();
  const lines: string[] = [];
  for (const node of unfunded) {
    const address = await wallet(node).newAddress(node.name);
    if (token) {
      try {
        const { txid } = await requestOnchain(token, address, FAUCET_SATS);
        console.log(`The faucet sent ${FAUCET_SATS.toLocaleString('en')} sats to ${node.name} in transaction ${txid}.`);
        continue;
      } catch (error) {
        // A request after a failed request fails too, for example at the daily limit.
        console.log(`The faucet request for ${node.name} failed. ${errorText(error)}`);
        token = undefined;
      }
    }
    lines.push(`  ${node.name}: ${address}`);
  }
  return lines;
}

async function waitForFunds(unfunded: Node[], wallet: WalletOf): Promise<void> {
  console.log(`Wait up to ${FUND_TIMEOUT_MS / 60_000} min for confirmed funds. A block comes every 30 s.`);
  const deadline = Date.now() + FUND_TIMEOUT_MS;
  let waiting = unfunded;
  while (waiting.length > 0) {
    const funded = await Promise.all(waiting.map(async (node) => (await wallet(node).balance(node.name)) > 0));
    waiting = waiting.filter((_, i) => !funded[i]);
    if (waiting.length === 0) return;
    if (Date.now() > deadline) {
      throw new Error(`Timeout: ${waiting.map((node) => node.name).join(', ')} got no confirmed funds. Fix: send funds to the addresses above, then run npm run network again.`);
    }
    await sleep(FUND_POLL_MS);
  }
}

async function faucetFunds(nodes: Node[], wallet: WalletOf): Promise<void> {
  await waitForSync('signet', nodes, wallet);
  const unfunded: Node[] = [];
  for (const node of nodes) {
    if ((await wallet(node).funds(node.name)) === 0) unfunded.push(node);
  }

  if (unfunded.length > 0) {
    const lines = await requestFunds(unfunded, wallet);
    if (lines.length > 0) {
      console.log(`Send test funds to these addresses. ${FAUCET_SATS.toLocaleString('en')} sats for each node are sufficient.
${lines.join('\n')}
Use the faucet page ${FAUCET_URL} or a different Mutinynet wallet.`);
      if (!readToken()) console.log('To let the bootstrap request the funds, run npm run faucet:login.');
    }
    await waitForFunds(unfunded, wallet);
  }
  for (const node of nodes) {
    console.log(`${node.name}: ${await wallet(node).funds(node.name)} sats`);
  }
}

async function main(): Promise<void> {
  const network = await readNetwork();
  const nodeWallets = wallets(NETWORK_SPECS[network].chain);
  const wallet: WalletOf = (node) => nodeWallets[node.impl];
  const nodes = await readNodes();
  console.log('Wait for healthy containers.');
  await waitForHealthy(nodes.map((node) => node.name));
  await (network === 'mutinynet' ? faucetFunds(nodes, wallet) : mineFunds(nodes, wallet));
}

try {
  await main();
} catch (error) {
  console.error(`bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
