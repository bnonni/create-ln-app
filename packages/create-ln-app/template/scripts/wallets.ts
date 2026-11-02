// The wallet calls for each node impl. The scripts run the node CLIs in the containers with docker compose exec.
// The script uses only Node built-in modules, so it can run before npm install.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { NetworkSpec } from './network.ts';
import type { Impl } from './nodes.ts';

const run = promisify(execFile);

const COMPOSE_FILE = fileURLToPath(new URL('../network/docker-compose.yml', import.meta.url));
// The compose file sets this Eclair API password.
const ECLAIR_API_PASSWORD = 'eclairpw';
const SATS_PER_BTC = 100_000_000;

type Chain = NetworkSpec['chain'];
type LndInfo = { synced_to_chain: boolean; block_height: number };
type LndBalance = { confirmed_balance: string; total_balance: string };
type LndAmount = { sat: string };
type LndChannelBalance = { local_balance: LndAmount; unsettled_local_balance: LndAmount; pending_open_local_balance: LndAmount };
// The limbo balance is the funds of the node in channels that close.
type LndPendingChannels = { total_limbo_balance: string };
type LndAddress = { address: string };
// CLN shows a warning in getinfo while it or bitcoind syncs.
type ClnInfo = { blockheight: number; warning_bitcoind_sync?: string; warning_lightningd_sync?: string };
type ClnFunds = { outputs: { amount_msat: number; status: string }[]; channels: { our_amount_msat: number }[] };
// CLN 25.12 signs a coinbase output to its bech32 address with the wrong key, so a channel open fails. A p2tr output works.
type ClnAddress = { p2tr: string };
// Eclair shows the balance of its bitcoind wallet in sats, and the global balance in BTC.
type EclairBalance = { confirmed: number };
type EclairGlobalBalance = { total: number };
type EclairInfo = { blockHeight: number };

// A balance is in sats.
export type Wallet = {
  // The confirmed on-chain balance.
  balance: (node: string) => Promise<number>;
  // All funds of the node: the on-chain balance with unconfirmed outputs, and the funds in channels.
  funds: (node: string) => Promise<number>;
  newAddress: (node: string) => Promise<string>;
  synced: (node: string, height: number) => Promise<boolean>;
};

export async function compose(...args: string[]): Promise<string> {
  const { stdout } = await run('docker', ['compose', '-f', COMPOSE_FILE, ...args]);
  return stdout.trim();
}

export function bitcoinCli(chain: Chain, ...args: string[]): Promise<string> {
  return compose('exec', '-T', 'bitcoind', 'bitcoin-cli', `-${chain}`, '-rpcuser=polaruser', '-rpcpassword=polarpass', ...args);
}

async function lncli<T>(chain: Chain, node: string, ...args: string[]): Promise<T> {
  return JSON.parse(await compose('exec', '-T', '-u', 'lnd', node, 'lncli', '-n', chain, ...args)) as T;
}

async function lightningCli<T>(chain: Chain, node: string, ...args: string[]): Promise<T> {
  return JSON.parse(await compose('exec', '-T', '-u', 'clightning', node, 'lightning-cli', `--network=${chain}`, ...args)) as T;
}

// eclair-cli shows a string result with no quotes, so the function does not parse the output.
function eclairCli(node: string, ...args: string[]): Promise<string> {
  return compose('exec', '-T', node, 'eclair-cli', '-p', ECLAIR_API_PASSWORD, ...args);
}

function msatToSat(msat: number): number {
  return Math.floor(msat / 1000);
}

function lndWallet(chain: Chain): Wallet {
  return {
    balance: async (node) => Number((await lncli<LndBalance>(chain, node, 'walletbalance')).confirmed_balance),
    funds: async (node) => {
      const wallet = await lncli<LndBalance>(chain, node, 'walletbalance');
      const channels = await lncli<LndChannelBalance>(chain, node, 'channelbalance');
      const pending = await lncli<LndPendingChannels>(chain, node, 'pendingchannels');
      const amounts = [channels.local_balance, channels.unsettled_local_balance, channels.pending_open_local_balance];
      return Number(wallet.total_balance) + amounts.reduce((sum, amount) => sum + Number(amount.sat), 0) + Number(pending.total_limbo_balance);
    },
    newAddress: async (node) => (await lncli<LndAddress>(chain, node, 'newaddress', 'p2wkh')).address,
    synced: async (node, height) => {
      const info = await lncli<LndInfo>(chain, node, 'getinfo');
      return info.synced_to_chain && info.block_height >= height;
    },
  };
}

function clnWallet(chain: Chain): Wallet {
  return {
    balance: async (node) => {
      const { outputs } = await lightningCli<ClnFunds>(chain, node, 'listfunds');
      return msatToSat(outputs.filter((output) => output.status === 'confirmed').reduce((sum, output) => sum + output.amount_msat, 0));
    },
    // listfunds shows no spent outputs, and it shows the channels until CLN forgets them after the close.
    funds: async (node) => {
      const { outputs, channels } = await lightningCli<ClnFunds>(chain, node, 'listfunds');
      const msat = outputs.reduce((sum, output) => sum + output.amount_msat, 0) + channels.reduce((sum, channel) => sum + channel.our_amount_msat, 0);
      return msatToSat(msat);
    },
    newAddress: async (node) => (await lightningCli<ClnAddress>(chain, node, 'newaddr', 'p2tr')).p2tr,
    synced: async (node, height) => {
      const info = await lightningCli<ClnInfo>(chain, node, 'getinfo');
      return !info.warning_bitcoind_sync && !info.warning_lightningd_sync && info.blockheight >= height;
    },
  };
}

// Eclair runs only on regtest. Its CLI has no network option.
const ECLAIR_WALLET: Wallet = {
  balance: async (node) => (JSON.parse(await eclairCli(node, 'onchainbalance')) as EclairBalance).confirmed,
  funds: async (node) => Math.round((JSON.parse(await eclairCli(node, 'globalbalance')) as EclairGlobalBalance).total * SATS_PER_BTC),
  newAddress: (node) => eclairCli(node, 'getnewaddress'),
  synced: async (node, height) => (JSON.parse(await eclairCli(node, 'getinfo')) as EclairInfo).blockHeight >= height,
};

export function wallets(chain: Chain): Record<Impl, Wallet> {
  return { lnd: lndWallet(chain), cln: clnWallet(chain), eclair: ECLAIR_WALLET };
}
