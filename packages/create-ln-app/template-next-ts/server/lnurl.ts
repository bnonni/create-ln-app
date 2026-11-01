// LNURL-pay (LUD-06), Lightning Addresses (LUD-16), and LNURL-withdraw (LUD-03).
// The app is the LNURL service and the LNURL client (decision 20 in ROADMAP.md).
// The service gives each node the address <node>@<host>. The host is the host of the request, for example 127.0.0.1:3001.
// The service URLs have the scheme and the host that the client used. See publicUrl.
// The service also makes withdraw links. The node of a link pays the invoice of the wallet that claims the link.
// The client gets an invoice from the service of an address, and it claims withdraw links. The API routes in server/app.ts use it.
// Specs: https://github.com/lnurl/luds
import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { bech32Decode, bech32Encode } from './bech32.ts';
import { NodeError, type Invoice, type LightningNode, type PaymentLimits } from './nodes/types.ts';

const MSAT_PER_SAT = 1000;
// The service accepts from 1 sat to 1,000,000 sats, also for a withdraw link.
// The page opens a channel of 1,000,000 sats, so a larger payment cannot pass.
export const MAX_LNURL_SATS = 1_000_000;
const MIN_SENDABLE_MSAT = 1 * MSAT_PER_SAT;
const MAX_SENDABLE_MSAT = MAX_LNURL_SATS * MSAT_PER_SAT;
const REQUEST_TIMEOUT_MS = 10_000;
// A withdraw link works one time, for 10 minutes.
const WITHDRAW_LINK_TTL_MS = 10 * 60_000;
// The client waits this long for the service to pay the invoice of a withdraw link.
const WITHDRAW_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;
const LNURL_PREFIX = 'lnurl';
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

type WithdrawLink = { node: LightningNode; amountSats: number; expiresAt: number };
// The open withdraw links by k1. The links are in memory, so a server restart deletes them.
const withdrawLinks = new Map<string, WithdrawLink>();

// The URL that the client used, with no path. A proxy that ends TLS sends the request to the server with http.
// LUD-01 allows only https, so the scheme comes from the X-Forwarded-Proto header of the proxy.
// The header can have a list, for example "https,http". The first value is the scheme of the client.
// The host comes from the Host header, because Next.js gives a route handler the URL of its own server.
export function publicUrl(request: Request): URL {
  const url = new URL(request.url);
  const scheme = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  const protocol = scheme === 'https' || scheme === 'http' ? `${scheme}:` : url.protocol;
  const origin = `${protocol}//${request.headers.get('host') ?? url.host}`;
  return new URL(URL.canParse(origin) ? origin : `${protocol}//${url.host}`);
}

// LUD-03: makes a withdraw link of the node for the amount. The origin is the origin of the API request.
// The lnurl is in uppercase, because LUD-01 recommends uppercase for QR codes.
export function createWithdrawLink(node: LightningNode, amountSats: number, origin: string) {
  const now = Date.now();
  for (const [k1, link] of withdrawLinks) if (link.expiresAt <= now) withdrawLinks.delete(k1);
  const k1 = randomBytes(32).toString('hex');
  const link = { node, amountSats, expiresAt: now + WITHDRAW_LINK_TTL_MS };
  withdrawLinks.set(k1, link);
  const url = `${origin}/api/lnurlw/${k1}`;
  const lnurl = bech32Encode(LNURL_PREFIX, url).toUpperCase();
  return { lnurl, url, amountSats, expiresAt: new Date(link.expiresAt).toISOString() };
}

// Throws an HTTPException with the status 404 if the link is unknown, used, or expired.
function openLink(k1: string): WithdrawLink {
  const link = withdrawLinks.get(k1);
  if (!link || link.expiresAt <= Date.now()) {
    throw new HTTPException(404, { message: 'The withdraw link is unknown, used, or expired' });
  }
  return link;
}

// The LNURL service. The Lightning Address routes are outside /api, so server/app.ts mounts the service at the root.
// findNode throws an HTTPException with the status 404 for an unknown node. The withdraw links pay with the limits.
export function lnurlService(findNode: (name: string) => LightningNode, limits: PaymentLimits): Hono {
  const service = new Hono();
  // LUD-01: a browser wallet can call the service only if the reply has this CORS header.
  for (const path of ['/.well-known/lnurlp/*', '/api/lnurlp/*', '/api/lnurlw/*']) {
    service.use(path, cors({ origin: '*' }));
  }

  // LUD-16: the payRequest of the Lightning Address <name>@<host>. The callback has the origin of this request.
  service.get('/.well-known/lnurlp/:name', (c) => {
    const node = findNode(c.req.param('name'));
    const url = publicUrl(c.req.raw);
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
    const memo = metadata(node.name, publicUrl(c.req.raw).host);
    const invoice = await node.createInvoice(amountMsat / MSAT_PER_SAT, memo, { hashMemo: true });
    return c.json({ pr: invoice.paymentRequest, routes: [] });
  });

  // LUD-03: the withdrawRequest of a link. The amount is fixed, so minWithdrawable and maxWithdrawable are the same.
  service.get('/api/lnurlw/:k1{[0-9a-f]{64}}', (c) => {
    const k1 = c.req.param('k1');
    const link = openLink(k1);
    return c.json({
      tag: 'withdrawRequest',
      callback: `${publicUrl(c.req.raw).origin}/api/lnurlw/callback`,
      k1,
      defaultDescription: `Withdraw from ${link.node.name}`,
      minWithdrawable: link.amountSats * MSAT_PER_SAT,
      maxWithdrawable: link.amountSats * MSAT_PER_SAT,
    });
  });

  // LUD-03 callback: the node of the link pays the invoice pr. The service replies before the payment ends.
  // The callback deletes the link before the first await. Thus a second claim fails, also while the first payment runs.
  // The decoded amount is in whole sats. Thus the node can pay up to 999 msat more than the link amount.
  service.get('/api/lnurlw/callback', async (c) => {
    const k1 = c.req.query('k1') ?? '';
    const link = openLink(k1);
    const pr = c.req.query('pr');
    if (!pr) throw new HTTPException(400, { message: 'pr must be an invoice' });
    withdrawLinks.delete(k1);
    try {
      const { amountSats } = await link.node.decodeInvoice(pr);
      if (amountSats !== link.amountSats) {
        throw new HTTPException(400, { message: `The invoice must be for ${link.amountSats} sats, not ${amountSats} sats` });
      }
    } catch (error) {
      // The node did not pay, so the link works again.
      withdrawLinks.set(k1, link);
      throw error;
    }
    link.node.payInvoice(pr, limits).catch((error: unknown) => {
      console.error(`The withdraw link of ${link.node.name} did not pay:`, error instanceof Error ? error.message : error);
    });
    return c.json({ status: 'OK' });
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

// The label is the address or the link in the error messages.
// Throws an LnurlError if the URL does not use https, or http with a host in HTTP_HOSTS.
function checkProtocol(url: URL, label: string): void {
  if (url.protocol === 'https:' || (url.protocol === 'http:' && HTTP_HOSTS.includes(url.hostname))) return;
  throw new LnurlError(`${label}: the service URL must use https: ${url.href}`);
}

function parseUrl(value: string, label: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new LnurlError(`${label}: the callback is not a URL: ${value}`);
  }
}

// LUD-01: the client does not use the HTTP status. It reads only the JSON body.
async function getJson(url: URL, label: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new LnurlError(`${label}: the service at ${url.origin} did not reply`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new LnurlError(`${label}: the reply from ${url.origin} is not JSON (HTTP ${response.status})`);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new LnurlError(`${label}: the reply from ${url.origin} is not a JSON object`);
  }
  const reply = body as Record<string, unknown>;
  if (reply.status === 'ERROR') {
    throw new LnurlError(`${label}: the service sent an error: ${String(reply.reason ?? 'no reason')}`);
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

  const callbackUrl = parseUrl(callback, address);
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

// Decodes an LNURL (LUD-01). The text can start with lightning:, as in a QR code.
function decodeLnurl(lnurl: string): URL {
  let decoded: { prefix: string; text: string };
  try {
    decoded = bech32Decode(lnurl.replace(/^lightning:/i, ''));
  } catch {
    throw new HTTPException(400, { message: 'lnurl must be a bech32 LNURL, for example LNURL1DP68...' });
  }
  let url: URL | undefined;
  try {
    url = new URL(decoded.text);
  } catch {
    url = undefined;
  }
  if (decoded.prefix !== LNURL_PREFIX || !url) {
    throw new HTTPException(400, { message: 'lnurl must be the bech32 encoding of a URL, with the prefix lnurl' });
  }
  return url;
}

// Claims a withdraw link (LUD-03): the node makes an invoice for the maximum amount, and the service pays it.
// The service can reply before it pays (LUD-03). Thus the client polls the invoice until it is settled.
// Returns the settled invoice.
export async function claimWithdrawLink(node: LightningNode, lnurl: string): Promise<Invoice> {
  const url = decodeLnurl(lnurl);
  const label = `withdraw link ${url.host}`;
  checkProtocol(url, label);
  const withdrawRequest = await getJson(url, label);

  const { tag, callback, k1, defaultDescription, minWithdrawable, maxWithdrawable } = withdrawRequest;
  if (
    tag !== 'withdrawRequest' ||
    typeof callback !== 'string' ||
    typeof k1 !== 'string' ||
    typeof minWithdrawable !== 'number' ||
    typeof maxWithdrawable !== 'number'
  ) {
    throw new LnurlError(`${label}: the reply is not a LUD-03 withdrawRequest`);
  }
  // The nodes make invoices in whole sats, so the amount is the maximum in whole sats.
  const amountSats = Math.floor(maxWithdrawable / MSAT_PER_SAT);
  if (amountSats < 1 || amountSats * MSAT_PER_SAT < minWithdrawable) {
    throw new LnurlError(`${label}: the link allows no amount in whole sats from ${minWithdrawable} to ${maxWithdrawable} msat`);
  }

  const callbackUrl = parseUrl(callback, label);
  checkProtocol(callbackUrl, label);
  const memo = typeof defaultDescription === 'string' ? defaultDescription : '';
  const invoice = await node.createInvoice(amountSats, memo);
  callbackUrl.searchParams.set('k1', k1);
  callbackUrl.searchParams.set('pr', invoice.paymentRequest);
  const { status } = await getJson(callbackUrl, label);
  if (status !== 'OK') throw new LnurlError(`${label}: the reply of the callback is not {"status":"OK"}`);

  const deadline = Date.now() + WITHDRAW_TIMEOUT_MS;
  for (;;) {
    const current = await node.getInvoice(invoice.paymentHash);
    if (current.status === 'settled') return current;
    if (current.status === 'canceled') throw new LnurlError(`${label}: the invoice of ${node.name} was canceled`);
    if (Date.now() > deadline) {
      throw new LnurlError(`${label}: the service did not pay the invoice in ${WITHDRAW_TIMEOUT_MS / 1000} seconds`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
