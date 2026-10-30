import { useEffect, useState } from 'react';
import {
  ApiError,
  connectPeer,
  createInvoice,
  getInvoice,
  getNodes,
  mineBlocks,
  openChannel,
  payInvoice,
  type ErrorCode,
  type Invoice,
  type LightningNode,
} from '../api';
import NodeInfo from './NodeInfo';
import './Page.css';

// The capacity of the channel that step 2 opens.
const CHANNEL_SATS = 1_000_000;
// The number of blocks that step 3 mines. LND needs 3 confirmations for a small channel.
const CONFIRM_BLOCKS = 6;
// LND can take some time to see new blocks. After a mine, the page loads the nodes again after this delay.
const LND_SYNC_MS = 2000;
// The amount and the memo of the invoice that step 4 requests.
const INVOICE_SATS = 1000;
const INVOICE_MEMO = 'create-ln-app example';
// Step 4 loads the invoice status again at this interval until the invoice is settled or canceled.
const INVOICE_POLL_MS = 1000;
// If the node is not ready, step 5 sends the payment again (see payWithRetry).
const PAY_ATTEMPTS = 5;
const PAY_RETRY_MS = 1000;

// An API error message starts with the node that sent the error (see server/API.md).
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// For about 1 s after a new channel becomes active, a node can reject a payment with one of these codes.
// If the node has other channels, the code is no_route.
const NOT_READY_CODES: (ErrorCode | undefined)[] = ['insufficient_balance', 'no_route'];

// After the node is ready, the same payment request works. Thus, send it again.
// If no channel can send the payment, the error shows after the last attempt.
const payWithRetry = async (name: string, paymentRequest: string) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await payInvoice(name, paymentRequest);
    } catch (err) {
      const notReady = err instanceof ApiError && NOT_READY_CODES.includes(err.code);
      if (!notReady || attempt === PAY_ATTEMPTS) throw err;
      await sleep(PAY_RETRY_MS);
    }
  }
};

// An invoice from step 4. `payee` is the node that made the invoice.
type PeerInvoice = Invoice & { payee: string };

type Step = {
  busy: boolean;
  error: string;
  result: string;
  run: (action: () => Promise<string>) => Promise<void>;
};

// Keeps the busy state, the API error, and the result text of one step.
// `run` does the action. The action returns the result text. If the action succeeds, `onDone` runs.
const useStep = (onDone: () => void): Step => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError('');
    setResult('');
    try {
      setResult(await action());
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, result, run };
};

const StepStatus = ({ step }: { step: Step }) => (
  <>
    {step.busy && <p className="busy">Wait for the API server.</p>}
    {step.error && <p className="error">{step.error}</p>}
    {step.result && <p className="result">{step.result}</p>}
  </>
);

const Page = () => {
  const [nodes, setNodes] = useState<LightningNode[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [peerName, setPeerName] = useState('');
  // Each refresh increments the version. A new version loads the nodes again.
  const [version, setVersion] = useState(0);
  const [invoice, setInvoice] = useState<PeerInvoice | null>(null);
  const [invoiceError, setInvoiceError] = useState('');
  const node = nodes.find((n) => n.name === name);
  const peers = nodes.filter((n) => n.name !== name);
  // If the user selects the peer as their own node, no peer is selected.
  const peer = peers.some((n) => n.name === peerName) ? peerName : '';

  const refresh = () => {
    setLoading(true);
    setVersion((v) => v + 1);
  };

  const peerStep = useStep(refresh);
  const channelStep = useStep(refresh);
  const mineStep = useStep(refresh);
  const invoiceStep = useStep(refresh);
  const payStep = useStep(refresh);

  useEffect(() => {
    // If a newer refresh starts first, ignore this reply.
    let ignore = false;
    getNodes()
      .then((data) => {
        if (ignore) return;
        setNodes(data);
        setError('');
      })
      .catch((err: unknown) => {
        if (!ignore) setError(errorMessage(err));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [version]);

  // Load the invoice status again until the invoice is settled or canceled.
  const payee = invoice?.payee;
  const paymentHash = invoice?.paymentHash;
  const invoiceOpen = invoice?.status === 'open' || invoice?.status === 'accepted';
  useEffect(() => {
    if (!payee || !paymentHash || !invoiceOpen) return;
    let ignore = false;
    const timer = setInterval(() => {
      getInvoice(payee, paymentHash)
        .then((data) => {
          if (ignore) return;
          setInvoice({ ...data, payee });
          setInvoiceError('');
        })
        .catch((err: unknown) => {
          if (!ignore) setInvoiceError(errorMessage(err));
        });
    }, INVOICE_POLL_MS);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [payee, paymentHash, invoiceOpen]);

  return (
    <div className="page">
      <p className="page-title">Steps</p>
      <div className="step">
        {/* Your feature: show more node data in NodeInfo.tsx. Add each new field to server/ and to LightningNode in api.ts. */}
        <p>Who are you?</p>
        <div className="row">
          <select
            id="node-select"
            value={name}
            disabled={nodes.length === 0}
            onChange={(event) => setName(event.target.value)}
          >
            <option value="" disabled>Select a node</option>
            {nodes.map((n) => (
              <option key={n.name} value={n.name}>{n.name}</option>
            ))}
          </select>
          <button disabled={loading} onClick={refresh}>
            Refresh
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {node && <NodeInfo node={node} nodes={nodes} />}
      </div>

      <div className="step">
        {/* Your feature: connect to a node outside this network. Add an API route that takes a pubkey and a host. */}
        <p>1. Connect to a peer</p>
        <div className="row">
          <select
            id="peer-select"
            value={peer}
            disabled={!node}
            onChange={(event) => setPeerName(event.target.value)}
          >
            <option value="" disabled>Select a peer</option>
            {peers.map((n) => (
              <option key={n.name} value={n.name}>{n.name}</option>
            ))}
          </select>
          <button
            disabled={!node || !peer || peerStep.busy}
            onClick={() =>
              peerStep.run(async () => {
                await connectPeer(name, peer);
                return `${name} is connected to ${peer}.`;
              })
            }
          >
            Connect
          </button>
        </div>
        <StepStatus step={peerStep} />
      </div>

      <div className="step">
        {/* Your feature: let the user set the channel size. Replace CHANNEL_SATS with an input. */}
        <p>2. Open a channel to {peer || 'the peer'}</p>
        <button
          disabled={!node || !peer || channelStep.busy}
          onClick={() =>
            channelStep.run(async () => {
              const channel = await openChannel(name, peer, CHANNEL_SATS);
              return `${name} opened a ${CHANNEL_SATS.toLocaleString()} sat channel to ${channel.peer}. ` +
                `The channel is pending until you mine blocks. Channel point: ${channel.channelPoint}`;
            })
          }
        >
          Open channel
        </button>
        <StepStatus step={channelStep} />
      </div>

      <div className="step">
        {/* Your feature: mine blocks automatically when a channel is pending. Then remove this step. */}
        <p>3. Mine {CONFIRM_BLOCKS} blocks to confirm the channel</p>
        <button
          disabled={mineStep.busy}
          onClick={() =>
            mineStep.run(async () => {
              const mined = await mineBlocks(CONFIRM_BLOCKS);
              setTimeout(refresh, LND_SYNC_MS);
              return `bitcoind mined ${mined.blockHashes.length} blocks. The block height is ${mined.height}.`;
            })
          }
        >
          Mine blocks
        </button>
        <StepStatus step={mineStep} />
      </div>

      <div className="step">
        {/* Your feature: let the user set the amount and the memo. Replace INVOICE_SATS and INVOICE_MEMO with inputs. */}
        <p>4. Request an invoice from {peer || 'the peer'}</p>
        <button
          disabled={!node || !peer || invoiceStep.busy}
          onClick={() =>
            invoiceStep.run(async () => {
              const created = await createInvoice(peer, INVOICE_SATS, INVOICE_MEMO);
              setInvoice({ ...created, payee: peer });
              setInvoiceError('');
              return `${peer} made an invoice for ${created.amountSats.toLocaleString()} sats.`;
            })
          }
        >
          Request invoice
        </button>
        <StepStatus step={invoiceStep} />
        <input
          aria-label="Payment request"
          readOnly
          type="text"
          placeholder="lnbcrt..."
          value={invoice?.paymentRequest ?? ''}
        />
        {invoice && <p>Invoice status: {invoice.status}</p>}
        {invoiceError && <p className="error">{invoiceError}</p>}
      </div>

      <div className="step">
        {/* Your feature: when the invoice status is settled, show the content that the user paid for. */}
        <p>5. Pay the invoice</p>
        <button
          disabled={!node || !invoiceOpen || payStep.busy}
          onClick={() =>
            invoice &&
            payStep.run(async () => {
              const payment = await payWithRetry(name, invoice.paymentRequest);
              return `${name} paid ${payment.amountSats.toLocaleString()} sats to ${invoice.payee}. ` +
                `The fee is ${payment.feeSats} sats. Preimage: ${payment.preimage}`;
            })
          }
        >
          Pay invoice
        </button>
        <StepStatus step={payStep} />
      </div>
    </div>
  );
};
export default Page;
