// A client for the CLNRest API of Core Lightning (CLN). It maps the CLN data and errors to the neutral types in types.ts.
// Each request is POST /v1/<method> with a JSON object of params. The Rune header authorizes the request.
// CLN sends amounts as msat numbers. The client rounds them down to sats. A param accepts a "<n>sat" string.
import { createHash, randomUUID } from 'node:crypto';
import type { Agent } from 'undici';
import { fetchNode, tlsAgent } from './http.ts';
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

export type ClnConfig = {
  name: string;
  restUrl: string;
  rune: string;
  tlsCertPath: string;
};

type GetInfoResponse = {
  id: string;
  alias: string;
  // The addresses that CLN announces. A websocket address has no address field.
  address: { type: string; address?: string; port: number }[];
};

type ListFundsResponse = {
  outputs: { amount_msat: number; status: 'unconfirmed' | 'confirmed' | 'spent' | 'immature' }[];
  channels: { our_amount_msat: number; state: string }[];
};

type ClnChannel = {
  peer_id: string;
  peer_connected: boolean;
  state: string;
  // A channel has no funding transaction before the peers agree on it.
  funding_txid?: string;
  funding_outnum?: number;
  total_msat: number;
  to_us_msat: number;
};

type ListPeerChannelsResponse = {
  channels: ClnChannel[];
};

type FundChannelResponse = {
  txid: string;
  outnum: number;
};

type ClnInvoice = {
  payment_hash: string;
  bolt11: string;
  // An invoice with no amount has no amount_msat.
  amount_msat?: number;
  amount_received_msat?: number;
  status: 'unpaid' | 'paid' | 'expired';
  paid_at?: number;
};

// The decode reply of a BOLT11 payment request. It has the description or the description hash.
// A payment request with an error has valid false. Then the client must not use the other fields.
type DecodeResponse = {
  type: string;
  valid: boolean;
  payment_hash: string;
  amount_msat?: number;
  description?: string;
  description_hash?: string;
  created_at: number;
  expiry: number;
};

type ListInvoicesResponse = {
  invoices: ClnInvoice[];
};

// The xpay reply has no payment hash. The hash is the SHA-256 hash of the preimage.
type XpayResponse = {
  payment_preimage: string;
  amount_msat: number;
  amount_sent_msat: number;
};

// CLN sends a JSON-RPC error with HTTP 500, for example { "code": -32602, "message": "...", "data": null }.
type ClnError = {
  code?: number;
  message?: string;
};

// A channel with a different state is not open yet, or it closes. The client does not show it.
// CLN changes a channel to CHANNELD_NORMAL after the 2 peers send channel_ready.
const OPEN_STATES = new Set(['CHANNELD_NORMAL', 'CHANNELD_AWAITING_SPLICE']);
const PENDING_STATES = new Set(['CHANNELD_AWAITING_LOCKIN', 'DUALOPEND_AWAITING_LOCKIN']);

const INVOICE_STATUS: Record<ClnInvoice['status'], InvoiceStatus> = {
  unpaid: 'open',
  paid: 'settled',
  expired: 'canceled',
};

// -32602: a bad param. 218: xpay already paid the invoice. Other codes give node_error.
const ERROR_CODES: Partial<Record<number, NodeErrorCode>> = {
  [-32602]: 'invalid_request',
  218: 'conflict',
};

// The xpay error codes. CLN gives 205 also if the channels do not have the balance for the payment.
// Other codes from 200 to 299 give payment_failed.
const PAYMENT_FAILURES: Partial<Record<number, PaymentFailureCode>> = {
  203: 'payment_rejected',
  205: 'no_route',
  207: 'payment_rejected',
  210: 'payment_timeout',
};

function toSats(msat: number): number {
  return Math.floor(msat / 1000);
}

function toIsoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

function toChannel(channel: ClnChannel, channelPoint: string): Channel {
  return {
    channelPoint,
    peerPubkey: channel.peer_id,
    status: PENDING_STATES.has(channel.state) ? 'pending' : channel.peer_connected ? 'active' : 'inactive',
    capacitySats: toSats(channel.total_msat),
    localBalanceSats: toSats(channel.to_us_msat),
    remoteBalanceSats: toSats(channel.total_msat - channel.to_us_msat),
  };
}

export class ClnClient implements LightningNode {
  readonly name: string;
  readonly impl = 'cln';
  readonly #restUrl: string;
  readonly #rune: string;
  readonly #dispatcher: Agent;

  constructor(config: ClnConfig) {
    this.name = config.name;
    this.#restUrl = config.restUrl;
    this.#rune = config.rune;
    this.#dispatcher = tlsAgent(config.name, config.tlsCertPath);
  }

  async getInfo(): Promise<NodeInfo> {
    const info = await this.#call<GetInfoResponse>('getinfo');
    const uris = info.address.flatMap(({ type, address, port }) => {
      if (address === undefined) return [];
      return [`${info.id}@${type === 'ipv6' ? `[${address}]` : address}:${port}`];
    });
    return { pubkey: info.id, alias: info.alias, uris };
  }

  async getBalances(): Promise<Balances> {
    const funds = await this.#call<ListFundsResponse>('listfunds');
    const confirmed = funds.outputs.filter((output) => output.status === 'confirmed');
    const open = funds.channels.filter((channel) => OPEN_STATES.has(channel.state));
    return {
      onchainSats: toSats(confirmed.reduce((sum, output) => sum + output.amount_msat, 0)),
      channelSats: toSats(open.reduce((sum, channel) => sum + channel.our_amount_msat, 0)),
    };
  }

  async listChannels(): Promise<Channel[]> {
    const { channels } = await this.#call<ListPeerChannelsResponse>('listpeerchannels');
    return channels.flatMap((channel) => {
      const { state, funding_txid: txid, funding_outnum: outnum } = channel;
      if (!(OPEN_STATES.has(state) || PENDING_STATES.has(state)) || txid === undefined || outnum === undefined) return [];
      return [toChannel(channel, `${txid}:${outnum}`)];
    });
  }

  // If the peer is already connected, CLN does not send an error.
  async connectPeer(pubkey: string, host: string): Promise<void> {
    await this.#call('connect', { id: `${pubkey}@${host}` });
  }

  async openChannel(pubkey: string, amountSats: number): Promise<string> {
    const funded = await this.#call<FundChannelResponse>('fundchannel', { id: pubkey, amount: amountSats });
    return `${funded.txid}:${funded.outnum}`;
  }

  // CLN needs a unique label for each invoice. The neutral invoice does not show the label.
  // CLN takes the memo text also with deschashonly, and it makes the hash.
  async createInvoice(amountSats: number, memo: string, options: InvoiceOptions = {}): Promise<Invoice> {
    const added = await this.#call<{ payment_hash: string }>('invoice', {
      amount_msat: `${amountSats}sat`,
      label: randomUUID(),
      description: memo,
      deschashonly: options.hashMemo ?? false,
    });
    return this.getInvoice(added.payment_hash);
  }

  // The CLN invoice has no creation date. Thus, get the date from the decoded payment request.
  // CLN keeps the memo also if the payment request has the hash. Thus, the memo also comes from the payment request.
  async getInvoice(paymentHash: string): Promise<Invoice> {
    const { invoices } = await this.#call<ListInvoicesResponse>('listinvoices', { payment_hash: paymentHash });
    const [invoice] = invoices;
    if (!invoice) throw new NodeError(this.name, 'not_found', `${this.name}: no invoice has the payment hash ${paymentHash}`);
    const decoded = await this.#call<DecodeResponse>('decode', { string: invoice.bolt11 });
    return {
      paymentHash: invoice.payment_hash,
      paymentRequest: invoice.bolt11,
      memo: decoded.description ?? '',
      amountSats: toSats(invoice.amount_msat ?? 0),
      amountPaidSats: toSats(invoice.amount_received_msat ?? 0),
      status: INVOICE_STATUS[invoice.status],
      createdAt: toIsoDate(decoded.created_at),
      settledAt: invoice.paid_at === undefined ? null : toIsoDate(invoice.paid_at),
    };
  }

  async decodeInvoice(paymentRequest: string): Promise<DecodedInvoice> {
    const decoded = await this.#call<DecodeResponse>('decode', { string: paymentRequest });
    if (decoded.type !== 'bolt11 invoice' || !decoded.valid) {
      throw new NodeError(this.name, 'invalid_request', `${this.name}: the string is not a valid BOLT11 payment request`);
    }
    return {
      paymentHash: decoded.payment_hash,
      amountSats: toSats(decoded.amount_msat ?? 0),
      descriptionHash: decoded.description_hash ?? null,
      expiresAt: toIsoDate(decoded.created_at + decoded.expiry),
    };
  }

  // xpay is the payment command of CLN since version 24.11. The older pay command sends the error code 0 if it finds no route.
  async payInvoice(paymentRequest: string, limits: PaymentLimits): Promise<Payment> {
    const payment = await this.#call<XpayResponse>(
      'xpay',
      { invstring: paymentRequest, retry_for: limits.timeoutSeconds, maxfee: `${limits.feeLimitSats}sat` },
      PAYMENT_FAILURES,
    );
    return {
      paymentHash: createHash('sha256').update(Buffer.from(payment.payment_preimage, 'hex')).digest('hex'),
      preimage: payment.payment_preimage,
      amountSats: toSats(payment.amount_msat),
      feeSats: toSats(payment.amount_sent_msat - payment.amount_msat),
    };
  }

  // Calls a CLN method. Throws a NodeError if CLN does not reply or sends an error.
  // If failures is set, an error code from 200 to 299 that is not in ERROR_CODES is a failed payment.
  async #call<T>(method: string, params: object = {}, failures?: typeof PAYMENT_FAILURES): Promise<T> {
    const response = await fetchNode(this.name, this.#restUrl, `/v1/${method}`, {
      method: 'POST',
      headers: { Rune: this.#rune, 'content-type': 'application/json' },
      body: JSON.stringify(params),
      dispatcher: this.#dispatcher,
    });
    const text = await response.text();
    if (response.ok) return JSON.parse(text) as T;
    const { code, message } = parseError(text);
    const errorCode = code === undefined ? undefined : ERROR_CODES[code];
    if (failures && errorCode === undefined && code !== undefined && code >= 200 && code < 300) {
      throw paymentFailed(this.name, failures[code] ?? 'payment_failed');
    }
    throw new NodeError(this.name, errorCode ?? 'node_error', `${this.name}: ${message || `HTTP ${response.status}`}`);
  }
}

function parseError(text: string): ClnError {
  try {
    const parsed = JSON.parse(text) as ClnError;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

// The .env file has 3 keys for each CLN node:
// CLN_<NAME>_REST_URL, CLN_<NAME>_RUNE, and CLN_<NAME>_TLS_CERT_PATH.
export function clnConfigFromEnv(env: NodeJS.ProcessEnv, envName: string): ClnConfig {
  const prefix = `CLN_${envName}`;
  const restUrl = env[`${prefix}_REST_URL`];
  const rune = env[`${prefix}_RUNE`];
  const tlsCertPath = env[`${prefix}_TLS_CERT_PATH`];
  if (!restUrl || !rune || !tlsCertPath) {
    throw new Error(`.env must set ${prefix}_RUNE and ${prefix}_TLS_CERT_PATH. Run: npm run env`);
  }
  return { name: envName.toLowerCase(), restUrl, rune, tlsCertPath };
}
