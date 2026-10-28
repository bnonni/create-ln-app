// The API server. The browser talks only to this server, and this server talks to the nodes.
// The macaroons and the TLS certs stay on the server, so the browser never gets them.
// The server reads .env one time at start. After npm run network, restart the server.
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { fileURLToPath } from 'node:url';
import { BitcoindClient, BitcoindError, bitcoindConfigFromEnv } from './bitcoind.ts';
import { LndClient, LndError, lndConfigsFromEnv, type Channel, type PendingChannel } from './lnd.ts';

const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
const DEFAULT_PORT = 3001;
// POST /api/mine mines to this address. Its witness program is 32 zero bytes, so no one can spend the coins.
const BURN_ADDRESS = 'bcrt1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3xueyj';
const MAX_BLOCKS = 1000;
const MAX_SATS = 21_000_000 * 100_000_000;

function loadClients(): { nodes: LndClient[]; bitcoind: BitcoindClient } {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    throw new Error(`Cannot read ${ENV_FILE}. Run: npm run network`);
  }
  return {
    nodes: lndConfigsFromEnv(process.env).map((config) => new LndClient(config)),
    bitcoind: new BitcoindClient(bitcoindConfigFromEnv(process.env)),
  };
}

let nodes: LndClient[];
let bitcoind: BitcoindClient;
try {
  ({ nodes, bitcoind } = loadClients());
} catch (error) {
  console.error(`server failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const port = Number(process.env.API_PORT ?? DEFAULT_PORT);

function channelSummary(
  peerPubkey: string,
  channel: Channel | PendingChannel,
  status: 'pending' | 'active' | 'inactive',
) {
  return {
    channelPoint: channel.channel_point,
    peerPubkey,
    status,
    capacitySats: Number(channel.capacity),
    localBalanceSats: Number(channel.local_balance),
    remoteBalanceSats: Number(channel.remote_balance),
  };
}

async function nodeSummary(node: LndClient) {
  const [info, wallet, balance, open, pending] = await Promise.all([
    node.getInfo(),
    node.walletBalance(),
    node.channelBalance(),
    node.listChannels(),
    node.pendingChannels(),
  ]);
  return {
    name: node.name,
    pubkey: info.identity_pubkey,
    alias: info.alias,
    onchainBalanceSats: Number(wallet.confirmed_balance),
    channelBalanceSats: Number(balance.local_balance.sat),
    channels: [
      ...pending.pending_open_channels.map(({ channel }) => channelSummary(channel.remote_node_pub, channel, 'pending')),
      ...open.channels.map((channel) =>
        channelSummary(channel.remote_pubkey, channel, channel.active ? 'active' : 'inactive'),
      ),
    ],
  };
}

function findNode(name: string): LndClient {
  const node = nodes.find((candidate) => candidate.name === name);
  if (!node) throw new HTTPException(404, { message: `Unknown node: ${name}` });
  return node;
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = undefined;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HTTPException(400, { message: 'The body must be a JSON object' });
  }
  return body as Record<string, unknown>;
}

function integerField(body: Record<string, unknown>, key: string, max: number): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new HTTPException(400, { message: `${key} must be an integer from 1 to ${max}` });
  }
  return value;
}

// The peer is the name of another node in .env.
function peerField(body: Record<string, unknown>, node: LndClient): LndClient {
  const others = nodes.filter((candidate) => candidate !== node);
  const peer = others.find((candidate) => candidate.name === body.peer);
  if (!peer) {
    throw new HTTPException(400, { message: `peer must be one of: ${others.map((other) => other.name).join(', ')}` });
  }
  return peer;
}

const app = new Hono().basePath('/api');

app.get('/health', (c) => c.json({ status: 'ok' }));

app.get('/nodes', async (c) => c.json(await Promise.all(nodes.map(nodeSummary))));

app.post('/nodes/:name/peers', async (c) => {
  const node = findNode(c.req.param('name'));
  const peer = peerField(await readBody(c), node);
  const [uri] = (await peer.getInfo()).uris;
  if (!uri) {
    throw new HTTPException(502, { message: `${peer.name} has no URI. Start its LND with --externalip.` });
  }
  const [peerPubkey, host] = uri.split('@');
  await node.connectPeer(peerPubkey, host);
  return c.json({ peer: peer.name, peerPubkey });
});

app.post('/nodes/:name/channels', async (c) => {
  const node = findNode(c.req.param('name'));
  const body = await readBody(c);
  const peer = peerField(body, node);
  const amountSats = integerField(body, 'amountSats', MAX_SATS);
  const peerPubkey = (await peer.getInfo()).identity_pubkey;
  const point = await node.openChannel(peerPubkey, amountSats);
  const fundingTxid = Buffer.from(point.funding_txid_bytes, 'base64').reverse().toString('hex');
  return c.json({ channelPoint: `${fundingTxid}:${point.output_index}`, peer: peer.name, peerPubkey }, 201);
});

app.post('/mine', async (c) => {
  const blocks = integerField(await readBody(c), 'blocks', MAX_BLOCKS);
  const blockHashes = await bitcoind.generateToAddress(blocks, BURN_ADDRESS);
  return c.json({ height: await bitcoind.getBlockCount(), blockHashes });
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Keep the LND status if LND says that the request is bad, or that a thing is not found or exists.
// LND sends most errors as HTTP 500. Those errors, and no reply, give 502.
function lndErrorStatus(status: number): 400 | 404 | 409 | 502 {
  return status === 400 || status === 404 || status === 409 ? status : 502;
}

app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  // A node is down or rejected the request.
  if (error instanceof LndError) return c.json({ error: error.message, node: error.node }, lndErrorStatus(error.status));
  if (error instanceof BitcoindError) return c.json({ error: error.message, node: 'bitcoind' }, 502);
  console.error(error);
  return c.json({ error: 'Internal server error' }, 500);
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API server on http://localhost:${info.port}/api (nodes: ${nodes.map((node) => node.name).join(', ')})`);
});
