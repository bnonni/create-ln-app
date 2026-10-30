// The API server. It serves the app in server/app.ts on Node.js.
// The server reads .env one time at start. After npm run network, restart the server.
import { serve } from '@hono/node-server';
import { fileURLToPath } from 'node:url';
import { app, getClients } from './app.ts';
import type { LightningNode } from './nodes/types.ts';

const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
const DEFAULT_PORT = 3001;

function loadEnv(): void {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    throw new Error(`Cannot read ${ENV_FILE}. Run: npm run network`);
  }
}

// The server makes the clients before it serves, so a missing or empty .env stops the server at start.
let nodes: LightningNode[];
try {
  loadEnv();
  ({ nodes } = getClients());
} catch (error) {
  console.error(`server failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const port = Number(process.env.API_PORT ?? DEFAULT_PORT);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API server on http://localhost:${info.port}/api (nodes: ${nodes.map((node) => node.name).join(', ')})`);
});
