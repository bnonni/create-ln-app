// Start bitcoind and wait until it has the full chain. On regtest, the script does nothing.
// On Mutinynet, the first sync downloads about 10 GB and takes 40 min or more (ROADMAP.md fact 10).
// LND and CLN have problems if they start during the sync (fact 11), so npm run network starts them after this script.
// If you stop the script, bitcoind continues the sync. To continue, run npm run network again.
// The script uses only Node built-in modules, so it can run before npm install.
import { execFile, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { NETWORK_SPECS, readNetwork } from './network.ts';

const run = promisify(execFile);

const COMPOSE_FILE = fileURLToPath(new URL('../network/docker-compose.yml', import.meta.url));
const POLL_MS = 10_000;
// If the output is not a terminal, the script shows the progress on a new line each minute.
const LINE_MS = 60_000;

type ChainInfo = { blocks: number; headers: number; initialblockdownload: boolean };

async function bitcoinCli<T>(chain: string, ...args: string[]): Promise<T> {
  const cli = ['bitcoin-cli', `-${chain}`, '-rpcuser=polaruser', '-rpcpassword=polarpass', ...args];
  const { stdout } = await run('docker', ['compose', '-f', COMPOSE_FILE, 'exec', '-T', 'bitcoind', ...cli]);
  return JSON.parse(stdout) as T;
}

// For example "block 1,234,567 of 3,553,878 (34.7%), 8 peers". Until bitcoind has all the headers, the second number grows.
// On a custom signet, bitcoind has no transaction data for the chain, so verificationprogress is 1. The percent uses the block count.
function progress(info: ChainInfo, peers: number): string {
  const percent = ((info.headers > 0 ? info.blocks / info.headers : 0) * 100).toFixed(1);
  return `block ${info.blocks.toLocaleString('en')} of ${info.headers.toLocaleString('en')} (${percent}%), ${peers} ${peers === 1 ? 'peer' : 'peers'}`;
}

async function main(): Promise<void> {
  const network = await readNetwork();
  if (network === 'regtest') return;
  const { chain } = NETWORK_SPECS[network];

  // The first start builds the bitcoind image of network/mutinynet/Dockerfile.
  const up = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d', '--wait', 'bitcoind'], { stdio: 'inherit' });
  if (up.status !== 0) throw new Error('docker compose up bitcoind failed. Fix the error above, then run npm run network again.');

  let info = await bitcoinCli<ChainInfo>(chain, 'getblockchaininfo');
  if (!info.initialblockdownload) return;
  console.log(`bitcoind syncs the ${network} chain. The first sync downloads about 10 GB and takes 40 min or more.
The script starts the Lightning nodes after the sync. If you stop the script, bitcoind continues the sync in Docker.
To continue, run npm run network again.`);
  const tty = process.stdout.isTTY;
  let lineAt = 0;
  while (info.initialblockdownload) {
    const text = `Sync: ${progress(info, await bitcoinCli<number>(chain, 'getconnectioncount'))}`;
    if (tty) {
      process.stdout.write(`\r\x1b[K${text}`);
    } else if (Date.now() - lineAt >= LINE_MS) {
      console.log(text);
      lineAt = Date.now();
    }
    await sleep(POLL_MS);
    info = await bitcoinCli<ChainInfo>(chain, 'getblockchaininfo');
  }
  if (tty) process.stdout.write('\n');
  console.log(`bitcoind has the full ${network} chain: block ${info.blocks.toLocaleString('en')}.`);
}

try {
  await main();
} catch (error) {
  console.error(`sync failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
