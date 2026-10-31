// Integration test: the full payment flow against the live regtest network.
// Start the network before the test: `npm run network`.
// The test sends the requests of a client to the API app in server/app.ts, in the same process.
// The LNURL client sends HTTP requests. Thus the test also serves the app on a free port with node:http.
// The test does not use @hono/node-server, so it runs in each template.
// The flow runs in the 2 directions: alice pays bob, then bob pays alice. Thus each node is a payer and a payee.
// To use a different node pair, set FLOW_NODES, for example `FLOW_NODES=alice,carol npm run test:integration`.
// Each flow opens a new channel from the payer, so the test also passes if a channel already exists.
// The API has no route that decodes an invoice or makes an invoice with a memo hash. Thus those tests call the node clients.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { app, getClients } from './app.ts';
import type { LightningNode } from './nodes/types.ts';

const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
const CHANNEL_ACTIVE_TIMEOUT_MS = 30_000;
const CHANNEL_READY_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 250;
const CHANNEL_SATS = 1_000_000;
const INVOICE_SATS = 1_000;
const HASHED_MEMO = 'flow test with a memo hash';
const MSAT_PER_SAT = 1000;
const CONFIRMATION_BLOCKS = 6;
const IMPLS = ['lnd', 'cln', 'eclair'];
const [NODE_A, NODE_B, ...otherNodes] = (process.env.FLOW_NODES ?? 'alice,bob').split(',').map((name) => name.trim());
if (!NODE_A || !NODE_B || NODE_A === NODE_B || otherNodes.length > 0) {
  throw new Error(`FLOW_NODES must be 2 different node names, for example alice,bob. It is: ${process.env.FLOW_NODES}`);
}

type Channel = {
  channelPoint: string;
  peerPubkey: string;
  status: string;
  capacitySats: number;
  localBalanceSats: number;
  remoteBalanceSats: number;
};

type Node = { name: string; impl: string; pubkey: string; channels: Channel[] };

type Invoice = {
  paymentHash: string;
  paymentRequest: string;
  memo: string;
  amountSats: number;
  amountPaidSats: number;
  status: string;
  createdAt: string;
  settledAt: string | null;
};

type ApiResponse = { status: number; body: any };

async function api(method: string, path: string, body?: object): Promise<ApiResponse> {
  const response = await app.request(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

// Sends the request and makes sure that the app replies with the expected status.
async function expectStatus(status: number, method: string, path: string, body?: object): Promise<any> {
  const response = await api(method, path, body);
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(response.body)}`);
  return response.body;
}

async function waitFor<T>(what: string, timeoutMs: number, check: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) throw new Error(`timeout after ${timeoutMs} ms: ${what}`);
    await sleep(POLL_INTERVAL_MS);
  }
}

async function getNode(name: string): Promise<Node> {
  const nodes: Node[] = await expectStatus(200, 'GET', '/nodes');
  const node = nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `node ${name} is not in GET /nodes. Run \`npm run network\`.`);
  return node;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// The LNURL requests are GET requests with no body, so this server sends only the method and the URL to the app.
async function serveApp(): Promise<Server> {
  const server = createServer(async (request, response) => {
    const url = `http://${request.headers.host}${request.url}`;
    const reply = await app.fetch(new Request(url, { method: request.method }));
    response.writeHead(reply.status, Object.fromEntries(reply.headers));
    response.end(Buffer.from(await reply.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function nodeClient(name: string): LightningNode {
  const client = getClients().nodes.find((candidate) => candidate.name === name);
  assert.ok(client, `node ${name} is not in .env. Run: npm run env`);
  return client;
}

describe('payment flow', () => {
  let server: Server;
  let host: string;

  // The app reads the node values from process.env, as the API server does. A missing or empty .env stops the test here.
  before(async () => {
    try {
      process.loadEnvFile(ENV_FILE);
    } catch {
      throw new Error(`Cannot read ${ENV_FILE}. Run: npm run network`);
    }
    getClients();
    server = await serveApp();
    host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => server?.close());

  for (const [payerName, payeeName] of [[NODE_A, NODE_B], [NODE_B, NODE_A]]) {
    describe(`${payerName} pays ${payeeName} over a new channel`, () => {
      let payer: Node;
      let payee: Node;
      let channelPoint: string;
      let invoice: Invoice;
      let hashedInvoice: Invoice;

      test(`GET /nodes shows ${payerName} and ${payeeName}`, async () => {
        payer = await getNode(payerName);
        payee = await getNode(payeeName);
        for (const node of [payer, payee]) {
          assert.ok(IMPLS.includes(node.impl), `${node.name}: unknown impl ${node.impl}`);
          assert.match(node.pubkey, /^[0-9a-f]{66}$/);
        }
      });

      test(`${payerName} connects to ${payeeName}`, async () => {
        const result = await expectStatus(200, 'POST', `/nodes/${payerName}/peers`, { peer: payeeName });
        assert.deepEqual(result, { peer: payeeName, peerPubkey: payee.pubkey });
      });

      test(`${payerName} opens a channel to ${payeeName}`, async () => {
        const result = await expectStatus(201, 'POST', `/nodes/${payerName}/channels`, {
          peer: payeeName,
          amountSats: CHANNEL_SATS,
        });
        assert.match(result.channelPoint, /^[0-9a-f]{64}:\d+$/);
        assert.equal(result.peerPubkey, payee.pubkey);
        channelPoint = result.channelPoint;
      });

      test(`mining ${CONFIRMATION_BLOCKS} blocks makes the channel active on both nodes`, async () => {
        const result = await expectStatus(200, 'POST', '/mine', { blocks: CONFIRMATION_BLOCKS });
        assert.equal(result.blockHashes.length, CONFIRMATION_BLOCKS);

        // The payment can fail if one side of the channel is not ready. Wait for both sides.
        for (const [name, peer] of [[payerName, payee], [payeeName, payer]] as const) {
          const channel = await waitFor(`${name}: channel ${channelPoint} is active`, CHANNEL_ACTIVE_TIMEOUT_MS, async () => {
            const node = await getNode(name);
            return node.channels.find((c) => c.channelPoint === channelPoint && c.status === 'active');
          });
          assert.equal(channel.peerPubkey, peer.pubkey);
          assert.equal(channel.capacitySats, CHANNEL_SATS);
        }
      });

      test(`${payeeName} makes an invoice`, async () => {
        invoice = await expectStatus(201, 'POST', `/nodes/${payeeName}/invoices`, {
          amountSats: INVOICE_SATS,
          memo: 'flow test',
        });
        assert.match(invoice.paymentHash, /^[0-9a-f]{64}$/);
        assert.match(invoice.paymentRequest, /^lnbcrt/);
        assert.equal(invoice.memo, 'flow test');
        assert.equal(invoice.amountSats, INVOICE_SATS);
        assert.equal(invoice.status, 'open');
        assert.ok(!Number.isNaN(Date.parse(invoice.createdAt)));
        assert.equal(invoice.settledAt, null);
      });

      test(`${payerName} decodes the invoice`, async () => {
        const decoded = await nodeClient(payerName).decodeInvoice(invoice.paymentRequest);
        assert.equal(decoded.paymentHash, invoice.paymentHash);
        assert.equal(decoded.amountSats, INVOICE_SATS);
        assert.equal(decoded.descriptionHash, null);
        assert.ok(Date.parse(decoded.expiresAt) > Date.parse(invoice.createdAt));
        await assert.rejects(nodeClient(payerName).decodeInvoice('lnbcrt1xyz'), { code: 'invalid_request' });
      });

      test(`${payerName} pays the invoice`, async () => {
        // LND can need about 1 second after "active" before it can send over a new channel.
        // Before that, the payment fails with the code insufficient_balance. Then try again.
        const payment = await waitFor(`${payerName} pays the invoice`, CHANNEL_READY_TIMEOUT_MS, async () => {
          const response = await api('POST', `/nodes/${payerName}/payments`, { paymentRequest: invoice.paymentRequest });
          if (response.status === 502 && response.body.code === 'insufficient_balance') return undefined;
          assert.equal(response.status, 201, `POST /nodes/${payerName}/payments: ${JSON.stringify(response.body)}`);
          return response.body;
        });
        assert.equal(payment.paymentHash, invoice.paymentHash);
        assert.match(payment.preimage, /^[0-9a-f]{64}$/);
        assert.equal(payment.amountSats, INVOICE_SATS);
        assert.equal(payment.feeSats, 0);
      });

      test(`the invoice is settled on ${payeeName}`, async () => {
        const settled: Invoice = await expectStatus(200, 'GET', `/nodes/${payeeName}/invoices/${invoice.paymentHash}`);
        assert.equal(settled.status, 'settled');
        assert.equal(settled.amountPaidSats, INVOICE_SATS);
        assert.ok(settled.settledAt !== null && !Number.isNaN(Date.parse(settled.settledAt)));
      });

      test(`${payerName} cannot pay the same invoice again`, async () => {
        const result = await expectStatus(409, 'POST', `/nodes/${payerName}/payments`, {
          paymentRequest: invoice.paymentRequest,
        });
        assert.equal(typeof result.error, 'string');
        assert.equal(result.code, 'conflict');
      });

      test(`${payeeName} makes an invoice with a memo hash, and ${payerName} decodes it`, async () => {
        hashedInvoice = await nodeClient(payeeName).createInvoice(INVOICE_SATS, HASHED_MEMO, { hashMemo: true });
        assert.equal(hashedInvoice.memo, '');
        const decoded = await nodeClient(payerName).decodeInvoice(hashedInvoice.paymentRequest);
        assert.equal(decoded.paymentHash, hashedInvoice.paymentHash);
        assert.equal(decoded.amountSats, INVOICE_SATS);
        assert.equal(decoded.descriptionHash, sha256(HASHED_MEMO));
      });

      // An LNURL payer pays an invoice that has the hash of the LNURL metadata (LUD-06).
      test(`${payerName} pays the invoice with the memo hash`, async () => {
        const payment = await expectStatus(201, 'POST', `/nodes/${payerName}/payments`, {
          paymentRequest: hashedInvoice.paymentRequest,
        });
        assert.equal(payment.paymentHash, hashedInvoice.paymentHash);
        const settled: Invoice = await expectStatus(200, 'GET', `/nodes/${payeeName}/invoices/${hashedInvoice.paymentHash}`);
        assert.equal(settled.status, 'settled');
      });

      test(`the LNURL service gives the payRequest and an invoice of ${payeeName}`, async () => {
        const response = await fetch(`http://${host}/.well-known/lnurlp/${payeeName}`);
        assert.equal(response.headers.get('access-control-allow-origin'), '*');
        const payRequest = await response.json();
        assert.equal(payRequest.tag, 'payRequest');
        assert.equal(payRequest.callback, `http://${host}/api/lnurlp/${payeeName}/callback`);
        assert.deepEqual(JSON.parse(payRequest.metadata), [
          ['text/plain', `Pay ${payeeName}`],
          ['text/identifier', `${payeeName}@${host}`],
        ]);

        const callback = await (await fetch(`${payRequest.callback}?amount=${INVOICE_SATS * MSAT_PER_SAT}`)).json();
        const decoded = await nodeClient(payerName).decodeInvoice(callback.pr);
        assert.equal(decoded.amountSats, INVOICE_SATS);
        assert.equal(decoded.descriptionHash, sha256(payRequest.metadata));

        const partialSat = await (await fetch(`${payRequest.callback}?amount=1500`)).json();
        assert.equal(partialSat.status, 'ERROR');
        const unknown = await (await fetch(`http://${host}/.well-known/lnurlp/nobody`)).json();
        assert.deepEqual(unknown, { status: 'ERROR', reason: 'Unknown node: nobody' });
      });

      test(`${payerName} pays the Lightning Address of ${payeeName}`, async () => {
        const address = `${payeeName}@${host}`;
        const payment = await expectStatus(201, 'POST', `/nodes/${payerName}/address-payments`, {
          address,
          amountSats: INVOICE_SATS,
        });
        assert.match(payment.paymentRequest, /^lnbcrt/);
        assert.equal(payment.amountSats, INVOICE_SATS);
        const settled: Invoice = await expectStatus(200, 'GET', `/nodes/${payeeName}/invoices/${payment.paymentHash}`);
        assert.equal(settled.status, 'settled');
        assert.equal(settled.amountPaidSats, INVOICE_SATS);
      });

      test(`${payerName} cannot pay a bad Lightning Address`, async () => {
        const path = `/nodes/${payerName}/address-payments`;
        const badAddress = await expectStatus(400, 'POST', path, { address: payeeName, amountSats: INVOICE_SATS });
        assert.equal(badAddress.code, 'invalid_request');
        const address = `${payeeName}@${host}`;
        const tooLarge = await expectStatus(400, 'POST', path, { address, amountSats: CHANNEL_SATS + 1 });
        assert.equal(tooLarge.code, 'invalid_request');
        const unknown = await expectStatus(502, 'POST', path, { address: `nobody@${host}`, amountSats: INVOICE_SATS });
        assert.equal(unknown.code, 'lnurl_error');
      });
    });
  }
});
