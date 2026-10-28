import { useEffect, useState } from 'react';
import { getNodes, type LightningNode } from '../api';
import NodeInfo from './NodeInfo';
import './Page.css';

const Page = () => {
  const [invoice] = useState('');
  const [nodes, setNodes] = useState<LightningNode[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Each refresh increments the version. A new version loads the nodes again.
  const [version, setVersion] = useState(0);
  const node = nodes.find((n) => n.name === name);

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
        if (!ignore) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [version]);

  const refresh = () => {
    setLoading(true);
    setVersion((v) => v + 1);
  };

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
        <p>List peers</p>
        <button disabled>List</button>
      </div>

      <div className="step">
        <p>2. Open a channel to Bob</p>
        <button disabled>Open channel</button>
      </div>

      <div className="step">
        <p>3. Mine a block 6 times to confirm the channel</p>
        <button>Mine Block</button>
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
