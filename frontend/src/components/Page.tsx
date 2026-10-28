import { useEffect, useState } from 'react';
import { connectPeer, getNodes, mineBlocks, openChannel, type LightningNode } from '../api';
import NodeInfo from './NodeInfo';
import './Page.css';

// The capacity of the channel that step 2 opens.
const CHANNEL_SATS = 1_000_000;
// The number of blocks that step 3 mines. LND needs 3 confirmations for a small channel.
const CONFIRM_BLOCKS = 6;
// LND can take some time to see new blocks. After a mine, the page loads the nodes again after this delay.
const LND_SYNC_MS = 2000;

// An API error message starts with the node that sent the error (see server/API.md).
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

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
  const [invoice] = useState('');
  const [nodes, setNodes] = useState<LightningNode[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [peerName, setPeerName] = useState('');
  // Each refresh increments the version. A new version loads the nodes again.
  const [version, setVersion] = useState(0);
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

  return (
    <div className="page">
      <p className="page-title">Steps</p>
      <div className="step">
        <p>Who are you?</p>
        <div className="row">
          <select
            id="nodeName"
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
        <p>1. Connect to a peer</p>
        <div className="row">
          <select
            id="peerName"
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
        <p>4. Mine request an invoice from Bob.</p>
        <button>Request Invoice</button>
        <label>
          <input
            name="invoice"
            disabled
            type="text"
            value={invoice || 'lnbc124324112341...'}
          />
        </label>
      </div>

      <div className="step">
        <p>5. Pay the requested invoice.</p>
        <button>Pay Invoice</button>
        <input
          disabled
          type="text"
          value={invoice || 'lnbc124324112341...'}
        />
      </div>
    </div>
  );
};
export default Page;
