// Check that this computer can run the local regtest network and the API server.
// Run it when the network is down, because the network uses the ports that it checks.
// The script uses only Node built-in modules, so it runs before npm install too.
// Usage: npm run doctor
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const COMPOSE_FILE = fileURLToPath(new URL('../network/docker-compose.yml', import.meta.url));
const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
const DEFAULT_API_PORT = 3001;
// docker info can wait for a long time if the daemon does not answer.
const TIMEOUT_MS = 10_000;

type Result = { name: string; ok: boolean; detail: string; fix?: string };
type ComposeConfig = { services: Record<string, { ports?: { published?: string }[] }> };

function failText(error: unknown): string {
  const { stderr, message } = error as { stderr?: string; message?: string };
  return (stderr || message || String(error)).trim().toLowerCase();
}

async function checkDocker(): Promise<Result> {
  const name = 'Docker daemon';
  try {
    const { stdout } = await run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: TIMEOUT_MS });
    return { name, ok: true, detail: `Docker ${stdout.trim()} runs.` };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        name,
        ok: false,
        detail: 'The docker command is not installed.',
        fix: 'Install Docker: https://docs.docker.com/engine/install/',
      };
    }
    if (failText(error).includes('permission denied')) {
      return {
        name,
        ok: false,
        detail: 'Your user cannot connect to the Docker daemon.',
        fix: 'Run sudo usermod -aG docker $USER, then log out and log in again.',
      };
    }
    return {
      name,
      ok: false,
      detail: 'The Docker daemon does not run.',
      fix: 'Start Docker. On macOS and Windows, start Docker Desktop. On Linux, run sudo systemctl start docker.',
    };
  }
}

async function checkCompose(): Promise<Result> {
  const name = 'Docker Compose';
  try {
    const { stdout } = await run('docker', ['compose', 'version', '--short'], { timeout: TIMEOUT_MS });
    return { name, ok: true, detail: `Docker Compose ${stdout.trim()} is installed.` };
  } catch {
    return {
      name,
      ok: false,
      detail: 'The docker compose command does not work.',
      fix: 'Install Docker Compose v2: https://docs.docker.com/compose/install/',
    };
  }
}

// The compose file is the source of truth for the host ports. docker compose config does not use the daemon.
async function networkPorts(): Promise<number[]> {
  const { stdout } = await run('docker', ['compose', '-f', COMPOSE_FILE, 'config', '--format', 'json'], { timeout: TIMEOUT_MS });
  const { services } = JSON.parse(stdout) as ComposeConfig;
  const ports = Object.values(services).flatMap((service) => service.ports ?? []);
  return ports.map((port) => Number(port.published)).filter((port) => port > 0).sort((a, b) => a - b);
}

// Docker publishes the ports on all host addresses, so the check listens on all addresses too.
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

async function usedPorts(ports: number[]): Promise<number[]> {
  const free = await Promise.all(ports.map(portFree));
  return ports.filter((_, i) => !free[i]);
}

async function checkNetworkPorts(composeOk: boolean): Promise<Result> {
  const name = 'Network ports';
  if (!composeOk) {
    return {
      name,
      ok: false,
      detail: 'The script cannot read the ports, because docker compose does not work.',
      fix: 'Fix Docker Compose first.',
    };
  }
  const ports = await networkPorts();
  const used = await usedPorts(ports);
  if (used.length === 0) return { name, ok: true, detail: `Ports ${ports.join(', ')} are free.` };
  return {
    name,
    ok: false,
    detail: `Ports ${used.join(', ')} are in use.`,
    fix: 'Stop the programs that use these ports. If a create-ln-app network uses them, run npm run down in that project.',
  };
}

async function checkApiPort(): Promise<Result> {
  const name = 'API server port';
  // The API server reads API_PORT from .env, so the check reads the same value.
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  const port = Number(process.env.API_PORT ?? DEFAULT_API_PORT);
  if (await portFree(port)) return { name, ok: true, detail: `Port ${port} is free.` };
  return {
    name,
    ok: false,
    detail: `Port ${port} is in use.`,
    fix: `Stop the program that uses port ${port}, or set API_PORT in .env to a free port.`,
  };
}

async function main(): Promise<void> {
  const docker = await checkDocker();
  const compose = await checkCompose();
  const results = [docker, compose, await checkNetworkPorts(compose.ok), await checkApiPort()];

  for (const result of results) {
    console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.name}: ${result.detail}`);
    if (result.fix) console.log(`     Fix: ${result.fix}`);
  }
  const failed = results.filter((result) => !result.ok).length;
  if (failed > 0) {
    console.log(`\n${failed} of ${results.length} checks failed. Do the fixes, then run npm run doctor again.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll checks passed. To start the network and the app, run: npm run dev');
}

try {
  await main();
} catch (error) {
  console.error(`doctor failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
