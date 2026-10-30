// The HTTP parts that the node clients share.
// Each node uses a self-signed TLS cert, so each client trusts only the cert of its own node.
import { readFileSync } from 'node:fs';
import { Agent, fetch, type RequestInit, type Response } from 'undici';
import { NodeError } from './types.ts';

// Makes an HTTP agent that trusts only the TLS cert at the path.
export function tlsAgent(name: string, tlsCertPath: string): Agent {
  let ca: Buffer;
  try {
    ca = readFileSync(tlsCertPath);
  } catch {
    throw new Error(`Cannot read the TLS cert of ${name} at ${tlsCertPath}. Run: npm run network`);
  }
  return new Agent({ connect: { ca } });
}

// Sends a request to the node. Throws a NodeError with the code node_unreachable if the node does not reply.
// The caller examines the HTTP status.
export async function fetchNode(name: string, restUrl: string, path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${restUrl}${path}`, init);
  } catch (error) {
    // undici puts the network or TLS error in the cause.
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
    throw new NodeError(name, 'node_unreachable', `Cannot reach ${name} at ${restUrl}: ${cause}`);
  }
}
