import type { LightningNode } from '../api';

const sats = (amount: number) => `${amount.toLocaleString()} sats`;

type Props = {
  node: LightningNode;
  // All nodes, to show the name of each channel peer.
  nodes: LightningNode[];
};

const NodeInfo = ({ node, nodes }: Props) => {
  const peerName = (pubkey: string) =>
    nodes.find((n) => n.pubkey === pubkey)?.name ?? `${pubkey.slice(0, 12)}...`;

  return (
    <div className="node-info">
      <p>Pubkey: <code>{node.pubkey}</code></p>
      <p>On-chain balance: {sats(node.onchainBalanceSats)}</p>
      <p>Channel balance: {sats(node.channelBalanceSats)}</p>
      {node.channels.length === 0 ? (
        <p>No channels.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Peer</th>
              <th>Status</th>
              <th>Capacity</th>
              <th>Local</th>
              <th>Remote</th>
            </tr>
          </thead>
          <tbody>
            {node.channels.map((channel) => (
              <tr key={channel.channelPoint}>
                <td>{peerName(channel.peerPubkey)}</td>
                <td>{channel.status}</td>
                <td>{sats(channel.capacitySats)}</td>
                <td>{sats(channel.localBalanceSats)}</td>
                <td>{sats(channel.remoteBalanceSats)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
export default NodeInfo;
