// A client for the HTTP API of Eclair. It maps the Eclair data and errors to the neutral types in types.ts.
// Each request is POST /<method> with form-encoded params. The request uses basic auth with no user name and the API password.
// The API uses plain HTTP, so the client needs no TLS cert. Eclair sends channel and payment amounts as msat numbers.
// The client rounds them down to sats.
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { fetchNode } from './http.ts';
import {
  NodeError,
  paymentFailed,
  type Balances,
  type Channel,
  type DecodedInvoice,
  type Invoice,
  type InvoiceOptions,
  type InvoiceStatus,
  type LightningNode,
  type NodeErrorCode,
  type NodeInfo,
  type Payment,
  type PaymentFailureCode,
  type PaymentLimits,
} from './types.ts';

export type EclairConfig = {
  name: string;
  apiUrl: string;
  apiPassword: string;
};

type GetInfoResponse = {
  nodeId: string;
  alias: string;
  // Each public address is host:port.
  publicAddresses: string[];
};

type OnchainBalanceResponse = {
  confirmed: number;
  unconfirmed: number;
};

type EclairChannel = {
  nodeId: string;
  // NORMAL, OFFLINE, CLOSED, and other states. The data type tells if the channel is pending or open.
  state: string;
  data: {
    type: string;
    // A channel has no commitments before the peers agree on the funding transaction.
    commitments?: {
      active: {
        fundingTx: { outPoint: string; amountSatoshis: number };
        localCommit: { spec: { toLocal: number; toRemote: number } };
      }[];
    };
  };
};

type ReceivedInfo = {
  invoice: { serialized: string; paymentHash: string; description?: string; amount: number | null };
  createdAt: { unix: number };
  status: { type: 'pending' | 'received' | 'expired'; amount?: number; receivedAt?: { unix: number } };
};

// The invoice has the description or the description hash.
type ParsedInvoice = {
  paymentHash: string;
  amount?: number | null;
  descriptionHash?: string;
  // The creation date in Unix seconds, and the number of seconds after it that a payer can pay the invoice.
  timestamp: number;
  expiry?: number;
};

// Eclair splits a payment into parts. getsentinfo gives each part, and each part has its own status.
type SentPart = {
  paymentHash: string;
  recipientAmount: number;
  status: {
    type: 'pending' | 'sent' | 'failed';
    paymentPreimage?: string;
    feesPaid?: number;
    failures?: { failureMessage: string }[];
  };
};

// The data types of a channel before the funding transaction confirms and the peers send channel_ready.
const PENDING_TYPES = new Set([
  'DATA_WAIT_FOR_FUNDING_CONFIRMED',
  'DATA_WAIT_FOR_CHANNEL_READY',
  'DATA_WAIT_FOR_DUAL_FUNDING_CONFIRMED',
  'DATA_WAIT_FOR_DUAL_FUNDING_READY',
]);
// An open channel. Its state is NORMAL if the peer is connected. A channel with a different data type closes.
const OPEN_TYPE = 'DATA_NORMAL';

const INVOICE_STATUS: Record<ReceivedInfo['status']['type'], InvoiceStatus> = {
  pending: 'open',
  received: 'settled',
  expired: 'canceled',
};

// Eclair sends 400 for a bad param and 404 if an invoice does not exist. Other statuses give node_error.
const ERROR_CODES: Partial<Record<number, NodeErrorCode>> = {
  400: 'invalid_request',
  404: 'not_found',
};

// The failure messages of a payment part. Other messages give payment_failed.
const PAYMENT_FAILURES: Partial<Record<string, PaymentFailureCode>> = {
  'route not found': 'no_route',
  'balance too low': 'insufficient_balance',
  'incorrect payment details or unknown payment hash': 'payment_rejected',
};

// Eclair does not open a channel if the funding transaction fee is more than this budget.
// The default budget of Eclair is too low for the regtest fee rate.
const FUNDING_FEE_BUDGET_SATS = 100_000;
// BOLT 11: an invoice with no expiry field expires after 1 hour.
const DEFAULT_INVOICE_EXPIRY_SECONDS = 3600;
const POLL_INTERVAL_MS = 250;
// The time to wait for the funding transaction of a new channel.
const FUNDING_TX_TIMEOUT_MS = 10_000;
// The connect and open methods send a text result also if they fail.
const CONNECTED = /^(already )?connected$/;
const CHANNEL_CREATED = /^created channel ([0-9a-f]{64}) /;

function toSats(msat: number): number {
  return Math.floor(msat / 1000);
}

function toIsoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

// The expiry date in Unix seconds.
function expiresAt(invoice: ParsedInvoice): number {
  return invoice.timestamp + (invoice.expiry ?? DEFAULT_INVOICE_EXPIRY_SECONDS);
}

function toChannel(channel: EclairChannel): Channel[] {
  const { type, commitments } = channel.data;
  const commitment = commitments?.active[0];
  if (commitment === undefined || !(type === OPEN_TYPE || PENDING_TYPES.has(type))) return [];
  const { toLocal, toRemote } = commitment.localCommit.spec;
  return [
    {
      channelPoint: commitment.fundingTx.outPoint,
      peerPubkey: channel.nodeId,
      status: type === OPEN_TYPE ? (channel.state === 'NORMAL' ? 'active' : 'inactive') : 'pending',
      capacitySats: commitment.fundingTx.amountSatoshis,
      localBalanceSats: toSats(toLocal),
      remoteBalanceSats: toSats(toRemote),
    },
  ];
}

export class EclairClient implements LightningNode {
  readonly name: string;
  readonly impl = 'eclair';
  readonly #apiUrl: string;
  readonly #authorization: string;

  constructor(config: EclairConfig) {
    this.name = config.name;
    this.#apiUrl = config.apiUrl;
    this.#authorization = `Basic ${Buffer.from(`:${config.apiPassword}`).toString('base64')}`;
  }

  async getInfo(): Promise<NodeInfo> {
    const info = await this.#call<GetInfoResponse>('getinfo');
    return { pubkey: info.nodeId, alias: info.alias, uris: info.publicAddresses.map((address) => `${info.nodeId}@${address}`) };
  }

  async getBalances(): Promise<Balances> {
    const [onchain, channels] = await Promise.all([
      this.#call<OnchainBalanceResponse>('onchainbalance'),
      this.#call<EclairChannel[]>('channels'),
    ]);
    const open = channels.filter((channel) => channel.data.type === OPEN_TYPE);
    const channelMsat = open.reduce((sum, channel) => sum + (channel.data.commitments?.active[0]?.localCommit.spec.toLocal ?? 0), 0);
    return { onchainSats: onchain.confirmed, channelSats: toSats(channelMsat) };
  }

  async listChannels(): Promise<Channel[]> {
    const channels = await this.#call<EclairChannel[]>('channels');
    return channels.flatMap(toChannel);
  }

  async connectPeer(pubkey: string, host: string): Promise<void> {
    const result = await this.#call<string>('connect', { uri: `${pubkey}@${host}` });
    if (!CONNECTED.test(result)) throw new NodeError(this.name, 'node_error', `${this.name}: ${result}`);
  }

  // The open result has the channel id but not the output index. Thus, get the channel point from the channel.
  async openChannel(pubkey: string, amountSats: number): Promise<string> {
    const result = await this.#call<string>('open', {
      nodeId: pubkey,
      fundingSatoshis: amountSats,
      fundingFeeBudgetSatoshis: FUNDING_FEE_BUDGET_SATS,
    });
    const created = CHANNEL_CREATED.exec(result);
    if (!created) throw new NodeError(this.name, 'node_error', `${this.name}: ${result}`);
    // If the peer uses dual funding (for example an Eclair peer), open returns before the peers sign the funding transaction.
    // Until then, the channel has no commitments. Thus, get the channel again until it has the funding transaction.
    const deadline = Date.now() + FUNDING_TX_TIMEOUT_MS;
    for (;;) {
      const [channel] = toChannel(await this.#call<EclairChannel>('channel', { channelId: created[1] }));
      if (channel) return channel.channelPoint;
      if (Date.now() > deadline) {
        throw new NodeError(this.name, 'node_error', `${this.name}: channel ${created[1]} has no funding transaction`);
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  // Eclair takes the description or the description hash, but not the two.
  async createInvoice(amountSats: number, memo: string, options: InvoiceOptions = {}): Promise<Invoice> {
    const description: Record<string, string> = options.hashMemo
      ? { descriptionHash: createHash('sha256').update(memo).digest('hex') }
      : { description: memo };
    const created = await this.#call<{ paymentHash: string }>('createinvoice', { amountMsat: amountSats * 1000, ...description });
    return this.getInvoice(created.paymentHash);
  }

  async getInvoice(paymentHash: string): Promise<Invoice> {
    const { invoice, createdAt, status } = await this.#call<ReceivedInfo>('getreceivedinfo', { paymentHash });
    return {
      paymentHash: invoice.paymentHash,
      paymentRequest: invoice.serialized,
      memo: invoice.description ?? '',
      amountSats: toSats(invoice.amount ?? 0),
      amountPaidSats: toSats(status.amount ?? 0),
      status: INVOICE_STATUS[status.type],
      createdAt: toIsoDate(createdAt.unix),
      settledAt: status.receivedAt === undefined ? null : toIsoDate(status.receivedAt.unix),
    };
  }

  async decodeInvoice(paymentRequest: string): Promise<DecodedInvoice> {
    const invoice = await this.#call<ParsedInvoice>('parseinvoice', { invoice: paymentRequest });
    return {
      paymentHash: invoice.paymentHash,
      amountSats: toSats(invoice.amount ?? 0),
      descriptionHash: invoice.descriptionHash ?? null,
      expiresAt: toIsoDate(expiresAt(invoice)),
    };
  }

  // payinvoice returns a payment id immediately. Then the client asks getsentinfo until the payment succeeds or fails.
  // Eclair sends a payment again if the invoice is already paid. Thus, the client first looks for an earlier payment.
  async payInvoice(paymentRequest: string, limits: PaymentLimits): Promise<Payment> {
    const invoice = await this.#call<ParsedInvoice>('parseinvoice', { invoice: paymentRequest });
    const earlier = await this.#call<SentPart[]>('getsentinfo', { paymentHash: invoice.paymentHash });
    if (earlier.some((part) => part.status.type === 'sent')) {
      throw new NodeError(this.name, 'conflict', `${this.name}: the invoice is already paid`);
    }
    if (earlier.some((part) => part.status.type === 'pending')) {
      throw new NodeError(this.name, 'conflict', `${this.name}: a payment of the invoice is in progress`);
    }
    // Eclair rejects an expired invoice with HTTP 400. The other clients give payment_rejected, so this client checks the expiry first.
    if (expiresAt(invoice) * 1000 <= Date.now()) {
      throw paymentFailed(this.name, 'payment_rejected');
    }
    // The fee limit is the larger of maxFeeFlatSat and maxFeePct of the amount. Thus, maxFeePct is 0.
    const id = await this.#call<string>('payinvoice', {
      invoice: paymentRequest,
      maxFeeFlatSat: limits.feeLimitSats,
      maxFeePct: 0,
    });
    const deadline = Date.now() + limits.timeoutSeconds * 1000;
    for (;;) {
      const parts = await this.#call<SentPart[]>('getsentinfo', { id });
      const sent = parts.filter((part) => part.status.type === 'sent');
      // Eclair saves the parts after payinvoice returns. Thus, no parts means that the payment is pending.
      const pending = parts.length === 0 || parts.some((part) => part.status.type === 'pending');
      if (!pending && sent.length > 0) {
        return {
          paymentHash: sent[0].paymentHash,
          preimage: sent[0].status.paymentPreimage ?? '',
          amountSats: toSats(sent[0].recipientAmount),
          feeSats: toSats(sent.reduce((sum, part) => sum + (part.status.feesPaid ?? 0), 0)),
        };
      }
      if (!pending) {
        const failure = parts.flatMap((part) => part.status.failures ?? []).at(-1);
        throw paymentFailed(this.name, (failure && PAYMENT_FAILURES[failure.failureMessage]) ?? 'payment_failed');
      }
      if (Date.now() > deadline) throw paymentFailed(this.name, 'payment_timeout');
      await sleep(POLL_INTERVAL_MS);
    }
  }

  // Calls an Eclair method. Throws a NodeError if Eclair does not reply or sends an error.
  async #call<T>(method: string, params: Record<string, string | number> = {}): Promise<T> {
    const response = await fetchNode(this.name, this.#apiUrl, `/${method}`, {
      method: 'POST',
      headers: { authorization: this.#authorization },
      body: new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])),
    });
    const text = await response.text();
    if (response.ok) return JSON.parse(text) as T;
    const message = parseError(text);
    throw new NodeError(this.name, ERROR_CODES[response.status] ?? 'node_error', `${this.name}: ${message || `HTTP ${response.status}`}`);
  }
}

// Eclair sends an error as { "error": "..." }.
function parseError(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    return typeof parsed?.error === 'string' ? parsed.error : '';
  } catch {
    return '';
  }
}

// The .env file has 2 keys for each Eclair node: ECLAIR_<NAME>_API_URL and ECLAIR_<NAME>_API_PASSWORD.
export function eclairConfigFromEnv(env: NodeJS.ProcessEnv, envName: string): EclairConfig {
  const prefix = `ECLAIR_${envName}`;
  const apiUrl = env[`${prefix}_API_URL`];
  const apiPassword = env[`${prefix}_API_PASSWORD`];
  if (!apiUrl || !apiPassword) throw new Error(`.env must set ${prefix}_API_PASSWORD. Run: npm run env`);
  return { name: envName.toLowerCase(), apiUrl, apiPassword };
}
