// The neutral node interface (decision 9 in ROADMAP.md). The API server uses only the types in this file.
// Each node client maps the data, the errors, and the invoice states of its node to these types.
// Thus the API and the app do not show the details of one node implementation.

// The node implementations that the server supports.
export type NodeImpl = 'lnd' | 'cln' | 'eclair';

export type NodeInfo = {
  pubkey: string;
  alias: string;
  // Each URI is pubkey@host:port. Other nodes connect to this node at a URI.
  uris: string[];
};

export type Balances = {
  // The confirmed on-chain balance. An unconfirmed output is not in it.
  onchainSats: number;
  // The local balance of all open channels.
  channelSats: number;
};

// A pending channel waits for its funding transaction to confirm.
export type ChannelStatus = 'pending' | 'active' | 'inactive';

export type Channel = {
  // <txid>:<output index> of the funding transaction.
  channelPoint: string;
  peerPubkey: string;
  status: ChannelStatus;
  capacitySats: number;
  localBalanceSats: number;
  remoteBalanceSats: number;
};

// open: not paid. accepted: the node holds the payment, but did not settle it.
// settled: paid. canceled: no one can pay the invoice, for example because it expired.
export type InvoiceStatus = 'open' | 'accepted' | 'settled' | 'canceled';

export type Invoice = {
  paymentHash: string;
  paymentRequest: string;
  // The description in the payment request.
  memo: string;
  amountSats: number;
  amountPaidSats: number;
  status: InvoiceStatus;
  // ISO 8601 dates. settledAt is null if the invoice is not settled.
  createdAt: string;
  settledAt: string | null;
};

// A payment request that a node decoded. The invoice can be from a different node.
export type DecodedInvoice = {
  paymentHash: string;
  // 0 if the payment request has no amount.
  amountSats: number;
  // The hex SHA-256 hash of the description. It is null if the payment request has the description text.
  descriptionHash: string | null;
  // ISO 8601 date. After this date, no one can pay the invoice.
  expiresAt: string;
};

// hashMemo: the payment request has the SHA-256 hash of the memo, not the memo. Thus the memo of the invoice is empty.
// An LNURL service uses the hash (LUD-06), because the payer gets the text from the service.
export type InvoiceOptions = {
  hashMemo?: boolean;
};

export type Payment = {
  paymentHash: string;
  preimage: string;
  amountSats: number;
  feeSats: number;
};

export type PaymentLimits = {
  timeoutSeconds: number;
  feeLimitSats: number;
};

// Each method throws a NodeError if the node does not reply or sends an error.
export interface LightningNode {
  readonly name: string;
  readonly impl: NodeImpl;
  getInfo(): Promise<NodeInfo>;
  getBalances(): Promise<Balances>;
  // The pending, active, and inactive channels.
  listChannels(): Promise<Channel[]>;
  // The host is host:port. If the peer is already connected, the method does not throw.
  connectPeer(pubkey: string, host: string): Promise<void>;
  // Returns the channel point after the node publishes the funding transaction.
  openChannel(pubkey: string, amountSats: number): Promise<string>;
  createInvoice(amountSats: number, memo: string, options?: InvoiceOptions): Promise<Invoice>;
  getInvoice(paymentHash: string): Promise<Invoice>;
  // A payment request that the node cannot decode gives the code invalid_request.
  decodeInvoice(paymentRequest: string): Promise<DecodedInvoice>;
  // Returns after the payment succeeds. A failed payment throws a NodeError with a PaymentFailureCode.
  payInvoice(paymentRequest: string, limits: PaymentLimits): Promise<Payment>;
}

// The codes of a failed payment.
// payment_rejected: the payee rejected the payment, for example because the invoice expired.
export type PaymentFailureCode =
  | 'no_route'
  | 'insufficient_balance'
  | 'payment_timeout'
  | 'payment_rejected'
  | 'payment_failed';

// invalid_request: the node rejected a value in the request.
// not_found: the object, for example an invoice, does not exist.
// conflict: the request conflicts with the node state, for example the invoice is already paid.
// node_error: the node sent a different error. node_unreachable: the node did not reply.
export type NodeErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'conflict'
  | PaymentFailureCode
  | 'node_error'
  | 'node_unreachable';

// An error from a node, or a failed request to a node. The message starts with the node name.
export class NodeError extends Error {
  readonly node: string;
  readonly code: NodeErrorCode;

  constructor(node: string, code: NodeErrorCode, message: string) {
    super(message);
    this.name = 'NodeError';
    this.node = node;
    this.code = code;
  }
}

// Each client uses this error for a failed payment, so the message is the same for each implementation.
export function paymentFailed(node: string, code: PaymentFailureCode): NodeError {
  return new NodeError(node, code, `${node}: the payment failed: ${code}`);
}
