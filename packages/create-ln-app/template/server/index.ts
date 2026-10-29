// The API server. The browser talks only to this server, and this server talks to the nodes.
// The node credentials and the TLS certs stay on the server, so the browser never gets them.
// The server reads .env one time at start. After npm run network, restart the server.
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { fileURLToPath } from 'node:url';
import { BitcoindClient, BitcoindError, bitcoindConfigFromEnv } from './bitcoind.ts';
import { ClnClient, clnConfigFromEnv } from './nodes/cln.ts';
import { LndClient, lndConfigFromEnv } from './nodes/lnd.ts';
import { NodeError, type LightningNode, type NodeErrorCode } from './nodes/types.ts';

const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
const DEFAULT_PORT = 3001;
// POST /api/mine mines to this address. Its witness program is 32 zero bytes, so no one can spend the coins.
const BURN_ADDRESS = 'bcrt1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3xueyj';
const MAX_BLOCKS = 1000;
const MAX_SATS = 21_000_000 * 100_000_000;
const PAYMENT_TIMEOUT_SECONDS = 60;
const PAYMENT_FEE_LIMIT_SATS = 1000;
const PAYMENT_HASH = /^[0-9a-f]{64}$/;

// Each node has a REST URL key in .env, for example LND_ALICE_REST_URL. The key prefix selects the client.
const CLIENTS: Record<string, (env: NodeJS.ProcessEnv, envName: string) => LightningNode> = {
  LND: (env, envName) => new LndClient(lndConfigFromEnv(env, envName)),
  CLN: (env, envName) => new ClnClient(clnConfigFromEnv(env, envName)),
};
const REST_URL_KEY = /^(LND|CLN)_([A-Z0-9_]+)_REST_URL$/;

// The process.env keys are in alphabetical order, so CLN_ keys come before LND_ keys. Thus, sort the nodes by name.
function nodesFromEnv(env: NodeJS.ProcessEnv): LightningNode[] {
  const nodes: LightningNode[] = [];
  for (const [key, restUrl] of Object.entries(env)) {
    const match = REST_URL_KEY.exec(key);
    if (match && restUrl) nodes.push(CLIENTS[match[1]](env, match[2]));
  }
  if (nodes.length === 0) throw new Error('.env has no nodes. Run: npm run network');
  return nodes.sort((a, b) => a.name.localeCompare(b.name));
}

function loadClients(): { nodes: LightningNode[]; bitcoind: BitcoindClient } {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    throw new Error(`Cannot read ${ENV_FILE}. Run: npm run network`);
  }
  return {
    nodes: nodesFromEnv(process.env),
    bitcoind: new BitcoindClient(bitcoindConfigFromEnv(process.env)),
  };
}

let nodes: LightningNode[];
let bitcoind: BitcoindClient;
try {
  ({ nodes, bitcoind } = loadClients());
} catch (error) {
  console.error(`server failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const port = Number(process.env.API_PORT ?? DEFAULT_PORT);

async function nodeSummary(node: LightningNode) {
  const [info, balances, channels] = await Promise.all([node.getInfo(), node.getBalances(), node.listChannels()]);
  return {
    name: node.name,
    impl: node.impl,
    pubkey: info.pubkey,
    alias: info.alias,
    onchainBalanceSats: balances.onchainSats,
    channelBalanceSats: balances.channelSats,
    channels,
  };
}

function findNode(name: string): LightningNode {
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

function stringField(body: Record<string, unknown>, key: string, required: boolean): string {
  const value = body[key] ?? (required ? undefined : '');
  if (typeof value !== 'string' || (required && value === '')) {
    throw new HTTPException(400, { message: `${key} must be a ${required ? 'non-empty ' : ''}string` });
  }
  return value;
}

// The peer is the name of another node in .env.
function peerField(body: Record<string, unknown>, node: LightningNode): LightningNode {
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
    throw new NodeError(peer.name, 'node_error', `${peer.name} has no URI, so other nodes cannot connect to it`);
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
  const peerPubkey = (await peer.getInfo()).pubkey;
  const channelPoint = await node.openChannel(peerPubkey, amountSats);
  return c.json({ channelPoint, peer: peer.name, peerPubkey }, 201);
});

app.post('/nodes/:name/invoices', async (c) => {
  const node = findNode(c.req.param('name'));
  const body = await readBody(c);
  const amountSats = integerField(body, 'amountSats', MAX_SATS);
  const memo = stringField(body, 'memo', false);
  return c.json(await node.createInvoice(amountSats, memo), 201);
});

app.get('/nodes/:name/invoices/:hash', async (c) => {
  const node = findNode(c.req.param('name'));
  const paymentHash = c.req.param('hash').toLowerCase();
  if (!PAYMENT_HASH.test(paymentHash)) {
    throw new HTTPException(400, { message: 'The payment hash must be 64 hex characters' });
  }
  return c.json(await node.getInvoice(paymentHash));
});

// The reply comes after the payment succeeds or fails. A failed payment gives 502.
app.post('/nodes/:name/payments', async (c) => {
  const node = findNode(c.req.param('name'));
  const paymentRequest = stringField(await readBody(c), 'paymentRequest', true);
  const limits = { timeoutSeconds: PAYMENT_TIMEOUT_SECONDS, feeLimitSats: PAYMENT_FEE_LIMIT_SATS };
  return c.json(await node.payInvoice(paymentRequest, limits), 201);
});

app.post('/mine', async (c) => {
  const blocks = integerField(await readBody(c), 'blocks', MAX_BLOCKS);
  const blockHashes = await bitcoind.generateToAddress(blocks, BURN_ADDRESS);
  return c.json({ height: await bitcoind.getBlockCount(), blockHashes });
});

// Each error body has a code. server/API.md lists the codes.
type ErrorBody = { error: string; code: NodeErrorCode | 'internal_error'; node?: string };

app.notFound((c) => c.json({ error: 'Not found', code: 'not_found' } satisfies ErrorBody, 404));

// A node error with one of these codes keeps its HTTP status. Other node errors give 502.
const NODE_ERROR_STATUS: Partial<Record<NodeErrorCode, 400 | 404 | 409>> = {
  invalid_request: 400,
  not_found: 404,
  conflict: 409,
};

app.onError((error, c) => {
  // The server rejected the request: 404 for an unknown node, 400 for a bad body or path value.
  if (error instanceof HTTPException) {
    const code = error.status === 404 ? 'not_found' : 'invalid_request';
    return c.json({ error: error.message, code } satisfies ErrorBody, error.status);
  }
  // A node is down or rejected the request.
  if (error instanceof NodeError) {
    const body: ErrorBody = { error: error.message, code: error.code, node: error.node };
    return c.json(body, NODE_ERROR_STATUS[error.code] ?? 502);
  }
  if (error instanceof BitcoindError) {
    const code = error.status === 0 ? 'node_unreachable' : 'node_error';
    return c.json({ error: error.message, code, node: 'bitcoind' } satisfies ErrorBody, 502);
  }
  console.error(error);
  return c.json({ error: 'Internal server error', code: 'internal_error' } satisfies ErrorBody, 500);
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API server on http://localhost:${info.port}/api (nodes: ${nodes.map((node) => node.name).join(', ')})`);
});
