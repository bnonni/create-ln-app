// Stop the local regtest network and delete the node data in network/data/.
// The script keeps network/data/ and network/data/.gitkeep. If Docker creates a missing
// bind-mount directory, the owner is root on Linux, and then the host user cannot delete it.
// Start a new network after a reset: npm run network
import { execFile } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const COMPOSE_FILE = fileURLToPath(new URL('../network/docker-compose.yml', import.meta.url));
const DATA_DIR = fileURLToPath(new URL('../network/data', import.meta.url));
const KEEP = '.gitkeep';
// The script uses the image of this service to delete files that the host user cannot delete.
const CLEANUP_SERVICE = 'bitcoind';

type ComposeConfig = { services: Record<string, { image?: string }> };

async function serviceImage(service: string): Promise<string> {
  const { stdout } = await run('docker', ['compose', '-f', COMPOSE_FILE, 'config', '--format', 'json']);
  const image = (JSON.parse(stdout) as ComposeConfig).services[service]?.image;
  if (!image) throw new Error(`No image for ${service} in ${COMPOSE_FILE}`);
  return image;
}

async function main(): Promise<void> {
  await run('docker', ['compose', '-f', COMPOSE_FILE, 'down', '--remove-orphans']);
  console.log('Stopped the network.');

  const names = (await readdir(DATA_DIR)).filter((name) => name !== KEEP);
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
  console.log(`Deleted the node data in ${DATA_DIR}. To start a new network, run: npm run network`);
}

try {
  await main();
} catch (error) {
  console.error(`reset failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
