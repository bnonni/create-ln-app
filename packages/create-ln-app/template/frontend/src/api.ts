// A typed client for the API server. The contract is in server/API.md.
// Each request goes to /api on the origin of the page.

export type ChannelStatus = 'pending' | 'active' | 'inactive';

export type Channel = {
  channelPoint: string;
  peerPubkey: string;
  status: ChannelStatus;
  capacitySats: number;
  localBalanceSats: number;
  remoteBalanceSats: number;
};

// The node implementation.
export type NodeImpl = 'lnd' | 'cln';

export type LightningNode = {
  name: string;
  impl: NodeImpl;
  pubkey: string;
  alias: string;
  onchainBalanceSats: number;
  channelBalanceSats: number;
  channels: Channel[];
};

export type InvoiceStatus = 'open' | 'accepted' | 'settled' | 'canceled';

export type Invoice = {
  paymentHash: string;
  paymentRequest: string;
  memo: string;
  amountSats: number;
  amountPaidSats: number;
  status: InvoiceStatus;
  createdAt: string;
  settledAt: string | null;
};

export type ConnectedPeer = { peer: string; peerPubkey: string };
export type OpenedChannel = { channelPoint: string; peer: string; peerPubkey: string };
export type MinedBlocks = { height: number; blockHashes: string[] };
export type Payment = { paymentHash: string; preimage: string; amountSats: number; feeSats: number };

// The error codes in server/API.md. The codes are the same for each node implementation.
export type ErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'conflict'
  | 'no_route'
  | 'insufficient_balance'
  | 'payment_timeout'
  | 'payment_rejected'
  | 'payment_failed'
  | 'node_error'
  | 'node_unreachable'
  | 'internal_error';

// The API server sent an error. Show `message` to the user. Use `code` in the app logic.
// `code` is undefined if the reply has no JSON error, for example if the API server does not run.
// `node` is the node or `bitcoind` that sent the error. It is undefined for a server error.
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;
  readonly node: string | undefined;

  constructor(message: string, status: number, code?: ErrorCode, node?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.node = node;
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // If the API does not answer, the dev server sends an error with no JSON body.
    const message = data?.error ?? `The API server sent HTTP ${response.status}. Make sure that it runs: npm run dev.`;
    throw new ApiError(message, response.status, data?.code, data?.node);
  }
  return data as T;
}

const node = (name: string) => `/nodes/${encodeURIComponent(name)}`;

export const getHealth = () => request<{ status: 'ok' }>('GET', '/health');

export const getNodes = () => request<LightningNode[]>('GET', '/nodes');

export const connectPeer = (name: string, peer: string) =>
  request<ConnectedPeer>('POST', `${node(name)}/peers`, { peer });

export const openChannel = (name: string, peer: string, amountSats: number) =>
  request<OpenedChannel>('POST', `${node(name)}/channels`, { peer, amountSats });

export const mineBlocks = (blocks: number) => request<MinedBlocks>('POST', '/mine', { blocks });

export const createInvoice = (name: string, amountSats: number, memo?: string) =>
  request<Invoice>('POST', `${node(name)}/invoices`, { amountSats, memo });

export const getInvoice = (name: string, paymentHash: string) =>
  request<Invoice>('GET', `${node(name)}/invoices/${paymentHash}`);

export const payInvoice = (name: string, paymentRequest: string) =>
  request<Payment>('POST', `${node(name)}/payments`, { paymentRequest });
