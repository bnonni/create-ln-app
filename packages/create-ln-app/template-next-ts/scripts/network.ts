// Read the Bitcoin network of the app from "config.network" in package.json: "regtest" (the default) or "mutinynet".
// Regtest is a local chain. Mutinynet is a public signet with a block every 30 s (https://mutinynet.com).
// The script uses only Node built-in modules, so it can run before npm install.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PACKAGE_FILE = fileURLToPath(new URL('../package.json', import.meta.url));
export const NETWORKS = ['regtest', 'mutinynet'] as const;

export type Network = (typeof NETWORKS)[number];
// LND, CLN, and bitcoind use the signet settings on Mutinynet. The chain name is also the name of the chain data folders.
// Inside the network, bitcoind uses the default RPC port of the chain.
export type NetworkSpec = { chain: 'regtest' | 'signet'; rpcPort: number };

export const NETWORK_SPECS: Record<Network, NetworkSpec> = {
  regtest: { chain: 'regtest', rpcPort: 18443 },
  mutinynet: { chain: 'signet', rpcPort: 38332 },
};

export async function readNetwork(): Promise<Network> {
  const { config } = JSON.parse(await readFile(PACKAGE_FILE, 'utf8')) as { config?: { network?: unknown } };
  const network = config?.network ?? 'regtest';
  if (typeof network !== 'string' || !(NETWORKS as readonly string[]).includes(network)) {
    throw new Error(`${PACKAGE_FILE} has the network ${JSON.stringify(network)}. Fix: set "config.network" to ${NETWORKS.map((n) => `"${n}"`).join(' or ')}.`);
  }
  return network as Network;
}
