// A typed client for the LND REST API. Each node uses a self-signed TLS cert,
// so each client trusts only the cert of its own node.
// LND REST sends int64 values as JSON strings. The response types show this.
import { readFileSync } from 'node:fs';
import { Agent, fetch } from 'undici';

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

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
    const text = await response.text();
    if (!response.ok) {
      throw new LndError(this.name, response.status, `${this.name}: ${errorMessage(text) ?? `HTTP ${response.status}`}`);
    }
    return JSON.parse(text) as T;
  }
}

// LND REST errors are JSON objects with a message, for example { "code": 2, "message": "..." }.
function errorMessage(text: string): string | undefined {
  try {
    const message = (JSON.parse(text) as { message?: unknown }).message;
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
