// The API server. The browser talks only to this server, and this server talks to the nodes.
// The macaroons and the TLS certs stay on the server, so the browser never gets them.
// The server reads .env one time at start. After npm run network, restart the server.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { fileURLToPath } from 'node:url';
import { LndClient, LndError, lndConfigsFromEnv } from './lnd.ts';

const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
const DEFAULT_PORT = 3001;

function loadNodes(): LndClient[] {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    throw new Error(`Cannot read ${ENV_FILE}. Run: npm run network`);
  }
  return lndConfigsFromEnv(process.env).map((config) => new LndClient(config));
}

let nodes: LndClient[];
try {
  nodes = loadNodes();
} catch (error) {
  console.error(`server failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const port = Number(process.env.API_PORT ?? DEFAULT_PORT);

async function nodeSummary(node: LndClient) {
  const [info, wallet, channels] = await Promise.all([node.getInfo(), node.walletBalance(), node.channelBalance()]);
  return {
    name: node.name,
    pubkey: info.identity_pubkey,
    alias: info.alias,
    onchainBalanceSats: Number(wallet.confirmed_balance),
    channelBalanceSats: Number(channels.local_balance.sat),
    channelCount: info.num_active_channels + info.num_inactive_channels,
  };
}

const app = new Hono().basePath('/api');

app.get('/health', (c) => c.json({ status: 'ok' }));

app.get('/nodes', async (c) => c.json(await Promise.all(nodes.map(nodeSummary))));

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((error, c) => {
  // A node is down or LND rejected the request.
  if (error instanceof LndError) return c.json({ error: error.message, node: error.node }, 502);
  console.error(error);
  return c.json({ error: 'Internal server error' }, 500);
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API server on http://localhost:${info.port}/api (nodes: ${nodes.map((node) => node.name).join(', ')})`);
});
