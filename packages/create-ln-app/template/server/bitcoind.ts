// A small JSON-RPC client for bitcoind. It sends JSON-RPC 2.0 requests.
// bitcoind sends a JSON-RPC 2.0 error with HTTP 200 and an error object.
import { fetch } from 'undici';

export type BitcoindConfig = {
  url: string;
  user: string;
  pass: string;
};

// An error from bitcoind, or a failed request to bitcoind. The status is 0 if bitcoind did not reply.
export class BitcoindError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'BitcoindError';
    this.status = status;
  }
}

type RpcResponse<T> = { result?: T; error?: { code: number; message: string } | null };

export class BitcoindClient {
  readonly #url: string;
  readonly #authorization: string;

  constructor(config: BitcoindConfig) {
    this.#url = config.url;
    this.#authorization = `Basic ${Buffer.from(`${config.user}:${config.pass}`).toString('base64')}`;
  }

  getBlockCount(): Promise<number> {
    return this.#call('getblockcount', []);
  }

  // Returns the hashes of the new blocks.
  generateToAddress(blocks: number, address: string): Promise<string[]> {
    return this.#call('generatetoaddress', [blocks, address]);
  }

  async #call<T>(method: string, params: unknown[]): Promise<T> {
    let response;
    try {
      response = await fetch(this.#url, {
        method: 'POST',
        headers: { authorization: this.#authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
    } catch (error) {
      // undici puts the network error in the cause.
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
      throw new BitcoindError(0, `Cannot reach bitcoind at ${this.#url}: ${cause}`);
    }
    if (response.status === 401) {
      throw new BitcoindError(401, 'bitcoind: wrong RPC user or password. Run: npm run env');
    }
    const text = await response.text();
    let reply: RpcResponse<T>;
    try {
      reply = JSON.parse(text) as RpcResponse<T>;
    } catch {
      throw new BitcoindError(response.status, `bitcoind: HTTP ${response.status}`);
    }
    if (reply.error) throw new BitcoindError(response.status, `bitcoind: ${reply.error.message}`);
    return reply.result as T;
  }
}

export function bitcoindConfigFromEnv(env: NodeJS.ProcessEnv): BitcoindConfig {
  const { BITCOIND_RPC_URL: url, BITCOIND_RPC_USER: user, BITCOIND_RPC_PASS: pass } = env;
  if (!url || !user || !pass) {
    throw new Error('.env must set BITCOIND_RPC_URL, BITCOIND_RPC_USER, and BITCOIND_RPC_PASS. Run: npm run env');
  }
  return { url, user, pass };
}
