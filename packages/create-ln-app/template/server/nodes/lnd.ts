// A client for the LND REST API. It maps the LND data and errors to the neutral types in types.ts.
// LND REST sends int64 values as JSON strings. The response types show this.
import type { Agent, Response } from 'undici';
import { fetchNode, tlsAgent } from './http.ts';
import {
  NodeError,
  paymentFailed,
  type Balances,
  type Channel,
  type ChannelStatus,
  type Invoice,
  type InvoiceStatus,
  type LightningNode,
  type NodeErrorCode,
  type NodeInfo,
  type Payment,
  type PaymentFailureCode,
  type PaymentLimits,
} from './types.ts';

export type LndConfig = {
  name: string;
  restUrl: string;
  macaroonHex: string;
  tlsCertPath: string;
};

type GetInfoResponse = {
  identity_pubkey: string;
  alias: string;
  // LND adds a URI only if it has an --externalip.
  uris: string[];
};

type LndChannel = {
  active: boolean;
  remote_pubkey: string;
  channel_point: string;
  capacity: string;
  local_balance: string;
  remote_balance: string;
};

type ListChannelsResponse = {
  channels: LndChannel[];
};

type PendingChannel = {
  remote_node_pub: string;
  channel_point: string;
  capacity: string;
  local_balance: string;
  remote_balance: string;
};

// Only the channels that wait for the funding transaction to confirm.
type PendingChannelsResponse = {
  pending_open_channels: { channel: PendingChannel }[];
};

// LND REST sends bytes as base64. The txid bytes are in reverse order.
type ChannelPointResponse = {
  funding_txid_bytes: string;
  output_index: number;
};

type AddInvoiceResponse = {
  r_hash: string;
  payment_request: string;
};

type LndInvoice = {
  memo: string;
  r_hash: string;
  value: string;
  creation_date: string;
  settle_date: string;
  payment_request: string;
  amt_paid_sat: string;
  state: 'OPEN' | 'SETTLED' | 'CANCELED' | 'ACCEPTED';
};

// The payment hash and the preimage are hex strings, not base64.
type LndPayment = {
  payment_hash: string;
  payment_preimage: string;
  value_sat: string;
  fee_sat: string;
  status: 'UNKNOWN' | 'IN_FLIGHT' | 'SUCCEEDED' | 'FAILED' | 'INITIATED';
  failure_reason: string;
};

type WalletBalanceResponse = {
  confirmed_balance: string;
};

type ChannelBalanceResponse = {
  local_balance: { sat: string; msat: string };
};

const INVOICE_STATUS: Record<LndInvoice['state'], InvoiceStatus> = {
  OPEN: 'open',
  ACCEPTED: 'accepted',
  SETTLED: 'settled',
  CANCELED: 'canceled',
};

// Other failure reasons, for example FAILURE_REASON_ERROR, give payment_failed.
const PAYMENT_FAILURES: Partial<Record<string, PaymentFailureCode>> = {
  FAILURE_REASON_NO_ROUTE: 'no_route',
  FAILURE_REASON_INSUFFICIENT_BALANCE: 'insufficient_balance',
  FAILURE_REASON_TIMEOUT: 'payment_timeout',
  FAILURE_REASON_INCORRECT_PAYMENT_DETAILS: 'payment_rejected',
};

// LND sends 400, 404, or 409 if the request is bad, or if a thing is not found or exists.
// LND sends most other errors as HTTP 500.
function errorCode(status: number): NodeErrorCode {
  if (status === 400) return 'invalid_request';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  return 'node_error';
}

function toChannel(peerPubkey: string, channel: LndChannel | PendingChannel, status: ChannelStatus): Channel {
  return {
    channelPoint: channel.channel_point,
    peerPubkey,
    status,
    capacitySats: Number(channel.capacity),
    localBalanceSats: Number(channel.local_balance),
    remoteBalanceSats: Number(channel.remote_balance),
  };
}

function toIsoDate(unixSeconds: string): string {
  return new Date(Number(unixSeconds) * 1000).toISOString();
}

function toInvoice(invoice: LndInvoice): Invoice {
  return {
    paymentHash: Buffer.from(invoice.r_hash, 'base64').toString('hex'),
    paymentRequest: invoice.payment_request,
    memo: invoice.memo,
    amountSats: Number(invoice.value),
    amountPaidSats: Number(invoice.amt_paid_sat),
    status: INVOICE_STATUS[invoice.state],
    createdAt: toIsoDate(invoice.creation_date),
    // LND sends 0 if the invoice is not settled.
    settledAt: invoice.settle_date === '0' ? null : toIsoDate(invoice.settle_date),
  };
}

export class LndClient implements LightningNode {
  readonly name: string;
  readonly impl = 'lnd';
  readonly #restUrl: string;
  readonly #macaroonHex: string;
  readonly #dispatcher: Agent;

  constructor(config: LndConfig) {
    this.name = config.name;
    this.#restUrl = config.restUrl;
    this.#macaroonHex = config.macaroonHex;
    this.#dispatcher = tlsAgent(config.name, config.tlsCertPath);
  }

  async getInfo(): Promise<NodeInfo> {
    const info = await this.#request<GetInfoResponse>('GET', '/v1/getinfo');
    return { pubkey: info.identity_pubkey, alias: info.alias, uris: info.uris };
  }

  async getBalances(): Promise<Balances> {
    const [wallet, channels] = await Promise.all([
      this.#request<WalletBalanceResponse>('GET', '/v1/balance/blockchain'),
      this.#request<ChannelBalanceResponse>('GET', '/v1/balance/channels'),
    ]);
    return { onchainSats: Number(wallet.confirmed_balance), channelSats: Number(channels.local_balance.sat) };
  }

  async listChannels(): Promise<Channel[]> {
    const [pending, open] = await Promise.all([
      this.#request<PendingChannelsResponse>('GET', '/v1/channels/pending'),
      this.#request<ListChannelsResponse>('GET', '/v1/channels'),
    ]);
    return [
      ...pending.pending_open_channels.map(({ channel }) => toChannel(channel.remote_node_pub, channel, 'pending')),
      ...open.channels.map((channel) => toChannel(channel.remote_pubkey, channel, channel.active ? 'active' : 'inactive')),
    ];
  }

  // LND waits up to 10 seconds for the connection.
  // If the peer is already connected, LND sends an error. This method ignores that error.
  async connectPeer(pubkey: string, host: string): Promise<void> {
    try {
      await this.#request('POST', '/v1/peers', { addr: { pubkey, host }, perm: false, timeout: '10' });
    } catch (error) {
      if (!(error instanceof NodeError && error.message.includes('already connected to peer'))) throw error;
    }
  }

  async openChannel(pubkey: string, amountSats: number): Promise<string> {
    const point = await this.#request<ChannelPointResponse>('POST', '/v1/channels', {
      node_pubkey: Buffer.from(pubkey, 'hex').toString('base64'),
      local_funding_amount: String(amountSats),
    });
    const fundingTxid = Buffer.from(point.funding_txid_bytes, 'base64').reverse().toString('hex');
    return `${fundingTxid}:${point.output_index}`;
  }

  // The add reply has no invoice state or dates. Thus, get the invoice after the add.
  async createInvoice(amountSats: number, memo: string): Promise<Invoice> {
    const added = await this.#request<AddInvoiceResponse>('POST', '/v1/invoices', { value: String(amountSats), memo });
    return this.getInvoice(Buffer.from(added.r_hash, 'base64').toString('hex'));
  }

  async getInvoice(paymentHash: string): Promise<Invoice> {
    return toInvoice(await this.#request<LndInvoice>('GET', `/v1/invoice/${paymentHash}`));
  }

  // LND streams one JSON object on each line: { "result": LndPayment } or { "error": { "message": "..." } }.
  // This method reads the stream until the payment succeeds or fails.
  async payInvoice(paymentRequest: string, limits: PaymentLimits): Promise<Payment> {
    const response = await this.#send('POST', '/v2/router/send', {
      payment_request: paymentRequest,
      timeout_seconds: limits.timeoutSeconds,
      fee_limit_sat: String(limits.feeLimitSats),
      no_inflight_updates: true,
    });
    if (!response.body) throw new NodeError(this.name, 'node_error', `${this.name}: the payment reply has no body`);
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === '') continue;
        const update = JSON.parse(line) as { result?: LndPayment; error?: unknown };
        if (update.error !== undefined) {
          throw new NodeError(this.name, 'node_error', `${this.name}: ${errorMessage(line) ?? 'payment error'}`);
        }
        const payment = update.result;
        if (payment?.status === 'FAILED') {
          throw paymentFailed(this.name, PAYMENT_FAILURES[payment.failure_reason] ?? 'payment_failed');
        }
        // The return stops the loop, and the stop cancels the stream.
        if (payment?.status === 'SUCCEEDED') {
          return {
            paymentHash: payment.payment_hash,
            preimage: payment.payment_preimage,
            amountSats: Number(payment.value_sat),
            feeSats: Number(payment.fee_sat),
          };
        }
      }
    }
    throw new NodeError(this.name, 'node_error', `${this.name}: the payment stream ended before the payment succeeded or failed`);
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.#send(method, path, body);
    return JSON.parse(await response.text()) as T;
  }

  // Sends the request. Throws a NodeError if LND does not reply or replies with an error status.
  async #send(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { 'Grpc-Metadata-macaroon': this.#macaroonHex };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetchNode(this.name, this.#restUrl, path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      dispatcher: this.#dispatcher,
    });
    if (!response.ok) {
      const text = await response.text();
      const message = `${this.name}: ${errorMessage(text) ?? `HTTP ${response.status}`}`;
      throw new NodeError(this.name, errorCode(response.status), message);
    }
    return response;
  }
}

// LND REST errors are JSON objects with a message, for example { "code": 2, "message": "..." }.
// A stream error has the object in an error field, for example { "error": { "code": 6, "message": "..." } }.
function errorMessage(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: { message?: unknown } };
    const message = parsed.error?.message ?? parsed.message;
    return typeof message === 'string' && message !== '' ? message : undefined;
  } catch {
    return undefined;
  }
}

// The .env file has 3 keys for each LND node:
// LND_<NAME>_REST_URL, LND_<NAME>_MACAROON_HEX, and LND_<NAME>_TLS_CERT_PATH.
export function lndConfigFromEnv(env: NodeJS.ProcessEnv, envName: string): LndConfig {
  const prefix = `LND_${envName}`;
  const restUrl = env[`${prefix}_REST_URL`];
  const macaroonHex = env[`${prefix}_MACAROON_HEX`];
  const tlsCertPath = env[`${prefix}_TLS_CERT_PATH`];
  if (!restUrl || !macaroonHex || !tlsCertPath) {
    throw new Error(`.env must set ${prefix}_MACAROON_HEX and ${prefix}_TLS_CERT_PATH. Run: npm run env`);
  }
  return { name: envName.toLowerCase(), restUrl, macaroonHex, tlsCertPath };
}
