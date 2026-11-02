// Call the Mutinynet faucet API. Source: https://github.com/MutinyWallet/mutinynet-faucet-rs
// The API needs a token. npm run faucet:login gets the token and writes it to .env as MUTINYNET_FAUCET_TOKEN.
// The faucet gives up to 1,000,000 sats in 24 hours for each GitHub user and each IP address.
// The script uses only Node built-in modules, so it can run before npm install.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const FAUCET_URL = 'https://faucet.mutinynet.com';
export const TOKEN_KEY = 'MUTINYNET_FAUCET_TOKEN';
export const ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));
const TIMEOUT_MS = 30_000;

export type Limits = { max_daily_sats: number; remaining_sats: number };
type Payment = { txid: string; address: string };

// The token is a JWT. Its payload has the expiry time "exp" in seconds.
export function tokenExpiry(token: string): Date | undefined {
  try {
    const { exp } = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { exp?: unknown };
    return typeof exp === 'number' ? new Date(exp * 1000) : undefined;
  } catch {
    return undefined;
  }
}

// The script reads the token from the environment first, then from .env.
export function readToken(): string | undefined {
  const fromFile = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8'))[TOKEN_KEY] : undefined;
  return process.env[TOKEN_KEY] || fromFile || undefined;
}

// fetch shows only "fetch failed" for a network error. The cause has the error code, for example ECONNRESET.
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as (Error & { code?: string }) | undefined;
  return cause instanceof Error ? `${error.message} (${cause.code ?? cause.message})` : error.message;
}

// On an error, the faucet answers with a text, for example "Error: max amount is 1,000,000".
export async function faucetFetch<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const response = await fetch(`${FAUCET_URL}${path}`, { ...rest, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status === 401) {
    throw new Error(`The faucet did not accept the token (HTTP 401). Fix: run npm run faucet:login.`);
  }
  if (!response.ok) throw new Error(`The faucet answered HTTP ${response.status}: ${(await response.text()).trim()}`);
  return (await response.json()) as T;
}

export function limits(token: string): Promise<Limits> {
  return faucetFetch<Limits>('/api/limits', { token });
}

export function requestOnchain(token: string, address: string, sats: number): Promise<Payment> {
  return faucetFetch<Payment>('/api/onchain', { method: 'POST', token, body: JSON.stringify({ address, sats }) });
}
