// A typed client for the LND REST API. Each node uses a self-signed TLS cert,
// so each client trusts only the cert of its own node.
// LND REST sends int64 values as JSON strings. The response types show this.
import { readFileSync } from 'node:fs';
import { Agent, fetch, type Response } from 'undici';

export type LndConfig = {
  name: string;
  restUrl: string;
  macaroonHex: string;
  tlsCertPath: string;
};

export type GetInfoResponse = {
  identity_pubkey: string;
  alias: string;
  num_active_channels: number;
  num_inactive_channels: number;
  num_pending_channels: number;
  synced_to_chain: boolean;
  block_height: number;
  // Each URI is pubkey@host:port. LND adds a URI only if it has an --externalip.
  uris: string[];
};

export type Channel = {
  active: boolean;
  remote_pubkey: string;
  channel_point: string;
  capacity: string;
  local_balance: string;
  remote_balance: string;
};

export type ListChannelsResponse = {
  channels: Channel[];
};

export type PendingChannel = {
  remote_node_pub: string;
  channel_point: string;
  capacity: string;
  local_balance: string;
  remote_balance: string;
};

// Only the channels that wait for the funding transaction to confirm.
export type PendingChannelsResponse = {
  pending_open_channels: { channel: PendingChannel }[];
};

// LND REST sends bytes as base64. The txid bytes are in reverse order.
export type ChannelPointResponse = {
  funding_txid_bytes: string;
  output_index: number;
};

export type AddInvoiceResponse = {
  r_hash: string;
  payment_request: string;
};

export type Invoice = {
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
export type Payment = {
  payment_hash: string;
  payment_preimage: string;
  value_sat: string;
  fee_sat: string;
  status: 'UNKNOWN' | 'IN_FLIGHT' | 'SUCCEEDED' | 'FAILED' | 'INITIATED';
  failure_reason: string;
};

export type WalletBalanceResponse = {
  total_balance: string;
  confirmed_balance: string;
  unconfirmed_balance: string;
};

export type ChannelBalanceResponse = {
  local_balance: { sat: string; msat: string };
  remote_balance: { sat: string; msat: string };
};

// An error from LND, or a failed request to LND. The status is 0 if LND did not reply.
export class LndError extends Error {
  readonly node: string;
  readonly status: number;

  constructor(node: string, status: number, message: string) {
    super(message);
    this.name = 'LndError';
    this.node = node;
    this.status = status;
  }
}

export class LndClient {
  readonly name: string;
  readonly #restUrl: string;
  readonly #macaroonHex: string;
  readonly #dispatcher: Agent;

  constructor(config: LndConfig) {
    this.name = config.name;
    this.#restUrl = config.restUrl;
    this.#macaroonHex = config.macaroonHex;
    let ca: Buffer;
    try {
      ca = readFileSync(config.tlsCertPath);
    } catch {
      throw new Error(`Cannot read the TLS cert of ${config.name} at ${config.tlsCertPath}. Run: npm run network`);
    }
    this.#dispatcher = new Agent({ connect: { ca } });
  }

  getInfo(): Promise<GetInfoResponse> {
    return this.#request('GET', '/v1/getinfo');
  }

  walletBalance(): Promise<WalletBalanceResponse> {
    return this.#request('GET', '/v1/balance/blockchain');
  }

  channelBalance(): Promise<ChannelBalanceResponse> {
    return this.#request('GET', '/v1/balance/channels');
  }

  listChannels(): Promise<ListChannelsResponse> {
    return this.#request('GET', '/v1/channels');
  }

  pendingChannels(): Promise<PendingChannelsResponse> {
    return this.#request('GET', '/v1/channels/pending');
  }

  // The host is host:port. LND waits up to 10 seconds for the connection.
  // If the peer is already connected, LND sends an error. This method ignores that error.
  async connectPeer(pubkey: string, host: string): Promise<void> {
    try {
      await this.#request('POST', '/v1/peers', { addr: { pubkey, host }, perm: false, timeout: '10' });
    } catch (error) {
      if (!(error instanceof LndError && error.message.includes('already connected to peer'))) throw error;
    }
  }

  // LND replies after it publishes the funding transaction.
  openChannel(pubkey: string, amountSats: number): Promise<ChannelPointResponse> {
    return this.#request('POST', '/v1/channels', {
      node_pubkey: Buffer.from(pubkey, 'hex').toString('base64'),
      local_funding_amount: String(amountSats),
    });
  }

  addInvoice(amountSats: number, memo: string): Promise<AddInvoiceResponse> {
    return this.#request('POST', '/v1/invoices', { value: String(amountSats), memo });
  }

  lookupInvoice(paymentHashHex: string): Promise<Invoice> {
    return this.#request('GET', `/v1/invoice/${paymentHashHex}`);
  }

  // LND streams one JSON object on each line: { "result": Payment } or { "error": { "message": "..." } }.
  // This method reads the stream until the payment succeeds or fails. A failed payment throws an LndError.
  async sendPayment(paymentRequest: string, timeoutSeconds: number, feeLimitSats: number): Promise<Payment> {
    const response = await this.#send('POST', '/v2/router/send', {
      payment_request: paymentRequest,
      timeout_seconds: timeoutSeconds,
      fee_limit_sat: String(feeLimitSats),
      no_inflight_updates: true,
    });
    if (!response.body) throw new LndError(this.name, 0, `${this.name}: the payment reply has no body`);
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === '') continue;
        const update = JSON.parse(line) as { result?: Payment; error?: unknown };
        if (update.error !== undefined) {
          throw new LndError(this.name, response.status, `${this.name}: ${errorMessage(line) ?? 'payment error'}`);
        }
        const payment = update.result;
        if (payment?.status === 'FAILED') {
          throw new LndError(this.name, response.status, `${this.name}: the payment failed: ${payment.failure_reason}`);
        }
        // The return stops the loop, and the stop cancels the stream.
        if (payment?.status === 'SUCCEEDED') return payment;
      }
    }
    throw new LndError(this.name, 0, `${this.name}: the payment stream ended before the payment succeeded or failed`);
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.#send(method, path, body);
    return JSON.parse(await response.text()) as T;
  }

  // Sends the request. Throws an LndError if LND does not reply or replies with an error status.
  async #send(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { 'Grpc-Metadata-macaroon': this.#macaroonHex };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response;
    try {
      response = await fetch(`${this.#restUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        dispatcher: this.#dispatcher,
      });
    } catch (error) {
      // undici puts the network or TLS error in the cause.
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
      throw new LndError(this.name, 0, `Cannot reach ${this.name} at ${this.#restUrl}: ${cause}`);
    }
    if (!response.ok) {
      const text = await response.text();
      throw new LndError(this.name, response.status, `${this.name}: ${errorMessage(text) ?? `HTTP ${response.status}`}`);
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

// The .env file has 3 keys for each node:
// LND_<NAME>_REST_URL, LND_<NAME>_MACAROON_HEX, and LND_<NAME>_TLS_CERT_PATH.
export function lndConfigsFromEnv(env: NodeJS.ProcessEnv): LndConfig[] {
  const configs: LndConfig[] = [];
  for (const [key, restUrl] of Object.entries(env)) {
    const match = /^LND_([A-Z0-9_]+)_REST_URL$/.exec(key);
    if (!match || !restUrl) continue;
    const prefix = `LND_${match[1]}`;
    const macaroonHex = env[`${prefix}_MACAROON_HEX`];
    const tlsCertPath = env[`${prefix}_TLS_CERT_PATH`];
    if (!macaroonHex || !tlsCertPath) {
      throw new Error(`.env must set ${prefix}_MACAROON_HEX and ${prefix}_TLS_CERT_PATH. Run: npm run env`);
    }
    configs.push({ name: match[1].toLowerCase(), restUrl, macaroonHex, tlsCertPath });
  }
  if (configs.length === 0) throw new Error('.env has no LND nodes. Run: npm run network');
  return configs;
}
