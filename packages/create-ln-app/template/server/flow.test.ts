// Integration test: the full payment flow against the live regtest network.
// Start the network before the test: `npm run network`.
// The test starts its own API server on a free port and talks to it as a client does.
// Each run opens a new alice-bob channel, so the test also passes if a channel already exists.

import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

const SERVER_START_TIMEOUT_MS = 10_000;
const CHANNEL_ACTIVE_TIMEOUT_MS = 30_000;
const CHANNEL_READY_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 250;
const CHANNEL_SATS = 1_000_000;
const INVOICE_SATS = 1_000;
const CONFIRMATION_BLOCKS = 6;

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

let server: ChildProcess;
let output = '';
let baseUrl: string;

async function freePort(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  probe.close();
  if (address === null || typeof address === 'string') throw new Error('cannot get a free port');
  return address.port;
}

async function api(method: string, path: string, body?: object): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

// Sends the request and makes sure that the server replies with the expected status.
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

describe('payment flow: alice pays bob over a new channel', () => {
  let alice: Node;
  let bob: Node;
  let channelPoint: string;
  let invoice: Invoice;

  before(async () => {
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}/api`;
    server = spawn(process.execPath, ['server/index.ts'], {
      env: { ...process.env, API_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout?.on('data', (chunk) => (output += chunk));
    server.stderr?.on('data', (chunk) => (output += chunk));
    server.on('exit', (code) => {
      if (code !== null) output += `\nserver exited with code ${code}`;
    });
    await waitFor('server start', SERVER_START_TIMEOUT_MS, async () => {
      if (server.exitCode !== null) throw new Error(`the server did not start:\n${output}`);
      const response = await api('GET', '/health').catch(() => undefined);
      return response?.status === 200 ? true : undefined;
    });
  });

  after(async () => {
    if (server.exitCode !== null) return;
    server.kill();
    await once(server, 'exit');
  });

  test('GET /nodes shows alice and bob', async () => {
    alice = await getNode('alice');
    bob = await getNode('bob');
    assert.equal(alice.impl, 'lnd');
    assert.equal(bob.impl, 'lnd');
    assert.match(alice.pubkey, /^[0-9a-f]{66}$/);
    assert.match(bob.pubkey, /^[0-9a-f]{66}$/);
  });

  test('alice connects to bob', async () => {
    const result = await expectStatus(200, 'POST', '/nodes/alice/peers', { peer: 'bob' });
    assert.deepEqual(result, { peer: 'bob', peerPubkey: bob.pubkey });
  });

  test('alice opens a channel to bob', async () => {
    const result = await expectStatus(201, 'POST', '/nodes/alice/channels', {
      peer: 'bob',
      amountSats: CHANNEL_SATS,
    });
    assert.match(result.channelPoint, /^[0-9a-f]{64}:\d+$/);
    assert.equal(result.peerPubkey, bob.pubkey);
    channelPoint = result.channelPoint;
  });

  test(`mining ${CONFIRMATION_BLOCKS} blocks makes the channel active on both nodes`, async () => {
    const result = await expectStatus(200, 'POST', '/mine', { blocks: CONFIRMATION_BLOCKS });
    assert.equal(result.blockHashes.length, CONFIRMATION_BLOCKS);

    // The payment can fail if one side of the channel is not ready. Wait for both sides.
    for (const [name, peer] of [['alice', bob], ['bob', alice]] as const) {
      const channel = await waitFor(`${name}: channel ${channelPoint} is active`, CHANNEL_ACTIVE_TIMEOUT_MS, async () => {
        const node = await getNode(name);
        return node.channels.find((c) => c.channelPoint === channelPoint && c.status === 'active');
      });
      assert.equal(channel.peerPubkey, peer.pubkey);
      assert.equal(channel.capacitySats, CHANNEL_SATS);
    }
  });

  test('bob makes an invoice', async () => {
    invoice = await expectStatus(201, 'POST', '/nodes/bob/invoices', {
      amountSats: INVOICE_SATS,
      memo: 'flow test',
    });
    assert.match(invoice.paymentHash, /^[0-9a-f]{64}$/);
    assert.match(invoice.paymentRequest, /^lnbcrt/);
    assert.equal(invoice.memo, 'flow test');
    assert.equal(invoice.amountSats, INVOICE_SATS);
    assert.equal(invoice.status, 'open');
    assert.equal(invoice.settledAt, null);
  });

  test('alice pays the invoice', async () => {
    // LND can need about 1 second after "active" before it can send over a new channel.
    // Before that, the payment fails with the code insufficient_balance. Then try again.
    const payment = await waitFor('alice pays the invoice', CHANNEL_READY_TIMEOUT_MS, async () => {
      const response = await api('POST', '/nodes/alice/payments', { paymentRequest: invoice.paymentRequest });
      if (response.status === 502 && response.body.code === 'insufficient_balance') return undefined;
      assert.equal(response.status, 201, `POST /nodes/alice/payments: ${JSON.stringify(response.body)}`);
      return response.body;
    });
    assert.equal(payment.paymentHash, invoice.paymentHash);
    assert.match(payment.preimage, /^[0-9a-f]{64}$/);
    assert.equal(payment.amountSats, INVOICE_SATS);
    assert.equal(payment.feeSats, 0);
  });

  test('the invoice is settled on bob', async () => {
    const settled: Invoice = await expectStatus(200, 'GET', `/nodes/bob/invoices/${invoice.paymentHash}`);
    assert.equal(settled.status, 'settled');
    assert.equal(settled.amountPaidSats, INVOICE_SATS);
    assert.ok(settled.settledAt !== null && !Number.isNaN(Date.parse(settled.settledAt)));
  });

  test('alice cannot pay the same invoice again', async () => {
    const result = await expectStatus(409, 'POST', '/nodes/alice/payments', {
      paymentRequest: invoice.paymentRequest,
    });
    assert.equal(typeof result.error, 'string');
    assert.equal(result.code, 'conflict');
  });
});
