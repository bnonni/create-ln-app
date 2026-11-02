// Get a Mutinynet faucet token with the GitHub device flow, and write it to .env as MUTINYNET_FAUCET_TOKEN.
// On Mutinynet, npm run bootstrap uses the token to request test funds for the nodes.
// You enter a code on GitHub. The faucet uses your GitHub account to apply its limit of 1,000,000 sats in 24 hours.
// The script shows no token. It keeps the other lines of .env.
// Usage: npm run faucet:login
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { ENV_FILE, errorText, faucetFetch, limits, TOKEN_KEY, tokenExpiry } from './faucet.ts';

const GITHUB_URL = 'https://github.com/login';
// The faucet asks GitHub for this scope.
const SCOPE = 'user:email';
const FORM_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
// The faucet gets the GitHub token only once, so the script tries again after a network error.
const EXCHANGE_TRIES = 3;
const RETRY_MS = 5_000;
const TIMEOUT_MS = 30_000;

type DeviceCode = { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number };
type AccessToken = { access_token?: string; error?: string; error_description?: string; interval?: number };

async function github<T>(path: string, body: Record<string, string>): Promise<T> {
  const response = await fetch(`${GITHUB_URL}${path}`, {
    method: 'POST',
    headers: FORM_HEADERS,
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub answered HTTP ${response.status}: ${(await response.text()).trim()}`);
  return (await response.json()) as T;
}

// GitHub answers "authorization_pending" until you enter the code, and "slow_down" if the script polls too fast.
async function githubToken(clientId: string, device: DeviceCode): Promise<string> {
  let interval = device.interval;
  const deadline = Date.now() + device.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    let answer: AccessToken;
    try {
      answer = await github<AccessToken>('/oauth/access_token', {
        client_id: clientId,
        device_code: device.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
    } catch (error) {
      // A network error stops only this poll. The code stays valid, so the next poll tries again.
      console.log(`A GitHub request failed: ${errorText(error)}. The script tries again.`);
      continue;
    }
    if (answer.access_token) return answer.access_token;
    if (answer.error === 'slow_down') interval = answer.interval ?? interval + 5;
    else if (answer.error !== 'authorization_pending') throw new Error(`GitHub: ${answer.error_description ?? answer.error}`);
  }
  throw new Error('The code expired. Fix: run npm run faucet:login again, and enter the code in 15 min.');
}

// Give the GitHub token to the faucet, and get the faucet token.
async function faucetToken(githubToken: string): Promise<string> {
  for (let tries = 1; ; tries++) {
    try {
      const { token } = await faucetFetch<{ token: string }>('/auth/github/device', { method: 'POST', body: JSON.stringify({ code: githubToken }) });
      return token;
    } catch (error) {
      if (tries === EXCHANGE_TRIES) throw error;
      console.log(`The faucet request failed: ${errorText(error)}. The script tries again.`);
      await sleep(RETRY_MS);
    }
  }
}

// Replace the old token line, and keep the other lines.
async function writeToken(token: string): Promise<void> {
  let text = '';
  try {
    text = await readFile(ENV_FILE, 'utf8');
  } catch {
    // No .env yet. npm run env keeps the token line when it writes the file.
  }
  const lines = text.split('\n').filter((line) => line.trim() !== '' && !line.startsWith(`${TOKEN_KEY}=`));
  await writeFile(ENV_FILE, `${[...lines, `${TOKEN_KEY}=${token}`].join('\n')}\n`, { mode: 0o600 });
}

async function main(): Promise<void> {
  const { client_id: clientId } = await faucetFetch<{ client_id: string }>('/auth/github/client_id');
  const device = await github<DeviceCode>('/device/code', { client_id: clientId, scope: SCOPE });
  console.log(`Open ${device.verification_uri} and enter the code ${device.user_code}`);
  console.log(`The code is valid for ${Math.round(device.expires_in / 60)} min. The script waits for you.`);

  const token = await faucetToken(await githubToken(clientId, device));
  await writeToken(token);
  console.log(`Wrote ${TOKEN_KEY} to ${ENV_FILE}`);

  // The limits call needs the token and sends no funds, so it checks the token.
  const { remaining_sats: remaining } = await limits(token);
  const expiry = tokenExpiry(token);
  console.log(`The faucet accepts the token. It can send ${remaining.toLocaleString('en')} more sats today.`);
  if (expiry) console.log(`The token expires on ${expiry.toISOString()}. Then run npm run faucet:login again.`);
}

try {
  await main();
} catch (error) {
  console.error(`faucet:login failed: ${errorText(error)}`);
  process.exitCode = 1;
}
