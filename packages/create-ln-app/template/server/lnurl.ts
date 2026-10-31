// LNURL-pay (LUD-06) and Lightning Addresses (LUD-16).
// The app is the LNURL service and the LNURL client (decision 20 in ROADMAP.md).
// The service gives each node the address <node>@<host>. The host is the host of the request, for example 127.0.0.1:3001.
// The client resolves an address and gets an invoice from its service. The API route in server/app.ts pays the invoice.
// Specs: https://github.com/lnurl/luds
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { NodeError, type LightningNode } from './nodes/types.ts';

const MSAT_PER_SAT = 1000;
// The service accepts from 1 sat to 1,000,000 sats.
// The page opens a channel of 1,000,000 sats, so a larger payment cannot pass.
const MIN_SENDABLE_MSAT = 1 * MSAT_PER_SAT;
const MAX_SENDABLE_MSAT = 1_000_000 * MSAT_PER_SAT;
const REQUEST_TIMEOUT_MS = 10_000;
// Group 1 is the name: LUD-16 allows a-z, 0-9, and the characters - _ . +. Group 2 is the host and an optional port.
const ADDRESS = /^([a-z0-9\-_.+]+)@([a-z0-9.-]+(?::\d{1,5})?)$/;
// LUD-01 allows only https and onion URLs. A local demo has no certificate, so the client also accepts http for these hosts.
const HTTP_HOSTS = ['localhost', '127.0.0.1'];

// The LUD-06 metadata of a node. The invoice has the SHA-256 hash of this text, so the callback must make the same text.
function metadata(name: string, host: string): string {
  return JSON.stringify([
    ['text/plain', `Pay ${name}`],
    ['text/identifier', `${name}@${host}`],
  ]);
}

function amountField(value: string | undefined): number {
  const amountMsat = Number(value);
  if (!Number.isSafeInteger(amountMsat) || amountMsat < MIN_SENDABLE_MSAT || amountMsat > MAX_SENDABLE_MSAT) {
    throw new HTTPException(400, { message: `amount must be from ${MIN_SENDABLE_MSAT} to ${MAX_SENDABLE_MSAT} msat` });
  }
  // The nodes make invoices in whole sats. Thus the service cannot make an invoice for the exact amount.
  if (amountMsat % MSAT_PER_SAT !== 0) {
    throw new HTTPException(400, { message: `amount must be a multiple of ${MSAT_PER_SAT} msat` });
  }
  return amountMsat;
}

// The LNURL service. Its routes are outside /api, so server/app.ts mounts the service at the root.
// findNode throws an HTTPException with the status 404 for an unknown node.
export function lnurlService(findNode: (name: string) => LightningNode): Hono {
  const service = new Hono();
  // LUD-01: a browser wallet can call the service only if the reply has this CORS header.
  for (const path of ['/.well-known/lnurlp/*', '/api/lnurlp/*']) service.use(path, cors({ origin: '*' }));

  // LUD-16: the payRequest of the Lightning Address <name>@<host>. The callback has the origin of this request.
  service.get('/.well-known/lnurlp/:name', (c) => {
    const node = findNode(c.req.param('name'));
    const url = new URL(c.req.url);
    return c.json({
      tag: 'payRequest',
      callback: `${url.origin}/api/lnurlp/${node.name}/callback`,
      minSendable: MIN_SENDABLE_MSAT,
      maxSendable: MAX_SENDABLE_MSAT,
      metadata: metadata(node.name, url.host),
    });
  });

  // LUD-06 callback: an invoice for the amount in msat.
  service.get('/api/lnurlp/:name/callback', async (c) => {
    const node = findNode(c.req.param('name'));
    const amountMsat = amountField(c.req.query('amount'));
    const memo = metadata(node.name, new URL(c.req.url).host);
    const invoice = await node.createInvoice(amountMsat / MSAT_PER_SAT, memo, { hashMemo: true });
    return c.json({ pr: invoice.paymentRequest, routes: [] });
  });

  // A LUD-06 error body. The status codes are the same as in the API, but a client reads only the body (LUD-01).
  service.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ status: 'ERROR', reason: error.message }, error.status);
    if (error instanceof NodeError) return c.json({ status: 'ERROR', reason: error.message }, 502);
    console.error(error);
    return c.json({ status: 'ERROR', reason: 'Internal server error' }, 500);
  });
  return service;
}

// The LNURL service did not reply, sent an error, or sent a bad reply. The API sends the code lnurl_error.
export class LnurlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LnurlError';
  }
}

// Throws an LnurlError if the URL does not use https, or http with a host in HTTP_HOSTS.
function checkProtocol(url: URL, address: string): void {
  if (url.protocol === 'https:' || (url.protocol === 'http:' && HTTP_HOSTS.includes(url.hostname))) return;
  throw new LnurlError(`${address}: the service URL must use https: ${url.href}`);
}

// LUD-01: the client does not use the HTTP status. It reads only the JSON body.
async function getJson(url: URL, address: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new LnurlError(`${address}: the service at ${url.origin} did not reply`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new LnurlError(`${address}: the reply from ${url.origin} is not JSON (HTTP ${response.status})`);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new LnurlError(`${address}: the reply from ${url.origin} is not a JSON object`);
  }
  const reply = body as Record<string, unknown>;
  if (reply.status === 'ERROR') {
    throw new LnurlError(`${address}: the service sent an error: ${String(reply.reason ?? 'no reason')}`);
  }
  return reply;
}

// Resolves a Lightning Address (LUD-16) and gets an invoice for the amount from its service (LUD-06).
// The node decodes the invoice and makes sure that the invoice amount is the requested amount.
// The decoded amount is in whole sats. Thus the check cannot find a difference of less than 1 sat.
export async function addressInvoice(node: LightningNode, address: string, amountSats: number): Promise<string> {
  const match = ADDRESS.exec(address);
  if (!match) {
    throw new HTTPException(400, { message: 'address must be a Lightning Address, for example bob@127.0.0.1:3001' });
  }
  const [, name, host] = match;
  const hostname = new URL(`http://${host}`).hostname;
  const protocol = HTTP_HOSTS.includes(hostname) ? 'http' : 'https';
  const payRequest = await getJson(new URL(`${protocol}://${host}/.well-known/lnurlp/${name}`), address);

  const { tag, callback, minSendable, maxSendable } = payRequest;
  if (
    tag !== 'payRequest' ||
    typeof callback !== 'string' ||
    typeof minSendable !== 'number' ||
    typeof maxSendable !== 'number'
  ) {
    throw new LnurlError(`${address}: the reply is not a LUD-06 payRequest`);
  }
  const amountMsat = amountSats * MSAT_PER_SAT;
  if (amountMsat < minSendable || amountMsat > maxSendable) {
    const [min, max] = [Math.ceil(minSendable / MSAT_PER_SAT), Math.floor(maxSendable / MSAT_PER_SAT)];
    throw new HTTPException(400, { message: `${address} accepts from ${min} to ${max} sats` });
  }

  let callbackUrl: URL;
  try {
    callbackUrl = new URL(callback);
  } catch {
    throw new LnurlError(`${address}: the callback is not a URL: ${callback}`);
  }
  checkProtocol(callbackUrl, address);
  callbackUrl.searchParams.set('amount', String(amountMsat));
  const { pr } = await getJson(callbackUrl, address);
  if (typeof pr !== 'string') throw new LnurlError(`${address}: the reply has no invoice`);

  let decodedSats: number;
  try {
    decodedSats = (await node.decodeInvoice(pr)).amountSats;
  } catch (error) {
    if (error instanceof NodeError && error.code === 'invalid_request') {
      throw new LnurlError(`${address}: ${node.name} cannot decode the invoice from the service`);
    }
    throw error;
  }
  if (decodedSats !== amountSats) {
    throw new LnurlError(`${address}: the invoice is for ${decodedSats} sats, not ${amountSats} sats`);
  }
  return pr;
}
