// The API app. The browser talks only to this app, and this app talks to the nodes.
// The node credentials and the TLS certs stay on the server, so the browser never gets them.
// The app makes the node clients from process.env at the first request. Thus, a build with no .env does not fail.
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { BitcoindClient, BitcoindError, bitcoindConfigFromEnv } from './bitcoind.ts';
import { ClnClient, clnConfigFromEnv } from './nodes/cln.ts';
import { EclairClient, eclairConfigFromEnv } from './nodes/eclair.ts';
import { LndClient, lndConfigFromEnv } from './nodes/lnd.ts';
import { addressInvoice, LnurlError, lnurlService } from './lnurl.ts';
import { NodeError, type LightningNode, type NodeErrorCode } from './nodes/types.ts';

// POST /api/mine mines to this address. Its witness program is 32 zero bytes, so no one can spend the coins.
const BURN_ADDRESS = 'bcrt1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3xueyj';
const MAX_BLOCKS = 1000;
const MAX_SATS = 21_000_000 * 100_000_000;
const PAYMENT_LIMITS = { timeoutSeconds: 60, feeLimitSats: 1000 };
const PAYMENT_HASH = /^[0-9a-f]{64}$/;

// Each node has a URL key in .env, for example LND_ALICE_REST_URL or ECLAIR_CAROL_API_URL. The key prefix selects the client.
const CLIENTS: Record<string, (env: NodeJS.ProcessEnv, envName: string) => LightningNode> = {
  LND: (env, envName) => new LndClient(lndConfigFromEnv(env, envName)),
  CLN: (env, envName) => new ClnClient(clnConfigFromEnv(env, envName)),
  ECLAIR: (env, envName) => new EclairClient(eclairConfigFromEnv(env, envName)),
};
// Group 1 and group 2 match an LND or a CLN key. Group 3 and group 4 match an Eclair key.
const URL_KEY = /^(LND|CLN)_([A-Z0-9_]+)_REST_URL$|^(ECLAIR)_([A-Z0-9_]+)_API_URL$/;

// The process.env keys are in alphabetical order, so CLN_ keys come before LND_ keys. Thus, sort the nodes by name.
function nodesFromEnv(env: NodeJS.ProcessEnv): LightningNode[] {
  const nodes: LightningNode[] = [];
  for (const [key, url] of Object.entries(env)) {
    const match = URL_KEY.exec(key);
    if (match && url) nodes.push(CLIENTS[match[1] ?? match[3]](env, match[2] ?? match[4]));
  }
  if (nodes.length === 0) throw new Error('.env has no nodes. Run: npm run network');
  return nodes.sort((a, b) => a.name.localeCompare(b.name));
}

type Clients = { nodes: LightningNode[]; bitcoind: BitcoindClient };
let clients: Clients | undefined;

// The first call makes the clients from process.env. If the call fails, the next call tries again.
export function getClients(): Clients {
  clients ??= { nodes: nodesFromEnv(process.env), bitcoind: new BitcoindClient(bitcoindConfigFromEnv(process.env)) };
  return clients;
}

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
  const node = getClients().nodes.find((candidate) => candidate.name === name);
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
  const others = getClients().nodes.filter((candidate) => candidate !== node);
  const peer = others.find((candidate) => candidate.name === body.peer);
  if (!peer) {
    throw new HTTPException(400, { message: `peer must be one of: ${others.map((other) => other.name).join(', ')}` });
  }
  return peer;
}

// The app serves the API under /api, and the LNURL service of server/lnurl.ts.
export const app = new Hono();
const api = app.basePath('/api');

api.get('/health', (c) => c.json({ status: 'ok' }));

api.get('/nodes', async (c) => c.json(await Promise.all(getClients().nodes.map(nodeSummary))));

api.post('/nodes/:name/peers', async (c) => {
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

api.post('/nodes/:name/channels', async (c) => {
  const node = findNode(c.req.param('name'));
  const body = await readBody(c);
  const peer = peerField(body, node);
  const amountSats = integerField(body, 'amountSats', MAX_SATS);
  const peerPubkey = (await peer.getInfo()).pubkey;
  const channelPoint = await node.openChannel(peerPubkey, amountSats);
  return c.json({ channelPoint, peer: peer.name, peerPubkey }, 201);
});

api.post('/nodes/:name/invoices', async (c) => {
  const node = findNode(c.req.param('name'));
  const body = await readBody(c);
  const amountSats = integerField(body, 'amountSats', MAX_SATS);
  const memo = stringField(body, 'memo', false);
  return c.json(await node.createInvoice(amountSats, memo), 201);
});

api.get('/nodes/:name/invoices/:hash', async (c) => {
  const node = findNode(c.req.param('name'));
  const paymentHash = c.req.param('hash').toLowerCase();
  if (!PAYMENT_HASH.test(paymentHash)) {
    throw new HTTPException(400, { message: 'The payment hash must be 64 hex characters' });
  }
  return c.json(await node.getInvoice(paymentHash));
});

// The reply comes after the payment succeeds or fails. A failed payment gives 502.
api.post('/nodes/:name/payments', async (c) => {
  const node = findNode(c.req.param('name'));
  const paymentRequest = stringField(await readBody(c), 'paymentRequest', true);
  return c.json(await node.payInvoice(paymentRequest, PAYMENT_LIMITS), 201);
});

// Pays a Lightning Address. server/lnurl.ts gets the invoice from the service and checks the invoice amount.
api.post('/nodes/:name/address-payments', async (c) => {
  const node = findNode(c.req.param('name'));
  const body = await readBody(c);
  const address = stringField(body, 'address', true);
  const amountSats = integerField(body, 'amountSats', MAX_SATS);
  const paymentRequest = await addressInvoice(node, address, amountSats);
  return c.json({ ...(await node.payInvoice(paymentRequest, PAYMENT_LIMITS)), paymentRequest }, 201);
});

api.post('/mine', async (c) => {
  const blocks = integerField(await readBody(c), 'blocks', MAX_BLOCKS);
  const { bitcoind } = getClients();
  const blockHashes = await bitcoind.generateToAddress(blocks, BURN_ADDRESS);
  return c.json({ height: await bitcoind.getBlockCount(), blockHashes });
});

app.route('/', lnurlService(findNode));

// Each error body has a code. server/API.md lists the codes.
type ErrorBody = { error: string; code: NodeErrorCode | 'lnurl_error' | 'internal_error'; node?: string };

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
  // A Lightning Address service did not reply, or sent an error or a bad invoice.
  if (error instanceof LnurlError) {
    return c.json({ error: error.message, code: 'lnurl_error' } satisfies ErrorBody, 502);
  }
  if (error instanceof BitcoindError) {
    const code = error.status === 0 ? 'node_unreachable' : 'node_error';
    return c.json({ error: error.message, code, node: 'bitcoind' } satisfies ErrorBody, 502);
  }
  console.error(error);
  return c.json({ error: 'Internal server error', code: 'internal_error' } satisfies ErrorBody, 500);
});
