// Read the node list in network/nodes.json and check it.
// The file is a JSON array of 2 to 10 nodes. Each node is { "name": "alice", "impl": "lnd" }.
// A name is a host name and a part of the .env keys, so it has only lowercase letters and digits.
// The script uses only Node built-in modules, so it can run before npm install.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const NODES_FILE = fileURLToPath(new URL('../network/nodes.json', import.meta.url));
const MIN_NODES = 2;
const MAX_NODES = 10;
const NAME = /^[a-z][a-z0-9]*$/;
const IMPLS = ['lnd'];
// The compose file has a bitcoind service, so a node cannot have this name.
const RESERVED_NAMES = ['bitcoind'];
const EXAMPLE = '[{ "name": "alice", "impl": "lnd" }, { "name": "bob", "impl": "lnd" }]';

export type Node = { name: string; impl: string };

// Show a missing key as "no name", and other values as JSON.
function shown(key: string, value: unknown): string {
  return value === undefined ? `no ${key}` : `the ${key} ${JSON.stringify(value)}`;
}

function nodeProblems(value: unknown, i: number, names: string[]): string[] {
  const node = `Node ${i + 1}`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [`${node} is not a JSON object. Fix: write the node as { "name": "dave", "impl": "lnd" }.`];
  }
  const { name, impl } = value as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof name !== 'string' || !NAME.test(name)) {
    problems.push(`${node} has ${shown('name', name)}. Fix: use only lowercase letters and digits, and start with a letter.`);
  } else if (RESERVED_NAMES.includes(name)) {
    problems.push(`${node} has the name "${name}". The ${name} service uses this name. Fix: use a different name.`);
  } else if (names.includes(name)) {
    problems.push(`${node} has the name "${name}", the same as node ${names.indexOf(name) + 1}. Fix: give each node a different name.`);
  }
  if (typeof impl !== 'string' || !IMPLS.includes(impl)) {
    problems.push(`${node} has ${shown('impl', impl)}. This version supports only "lnd". Fix: set "impl" to "lnd".`);
  }
  return problems;
}

function listProblems(list: unknown): string[] {
  if (!Array.isArray(list)) return [`The file is not a JSON array. Fix: write the nodes in an array, for example ${EXAMPLE}.`];
  const problems: string[] = [];
  if (list.length < MIN_NODES || list.length > MAX_NODES) {
    problems.push(`The array has ${list.length} ${list.length === 1 ? 'node' : 'nodes'}. Fix: use ${MIN_NODES} to ${MAX_NODES} nodes.`);
  }
  const names: string[] = [];
  list.forEach((value, i) => {
    problems.push(...nodeProblems(value, i, names));
    names.push((value as Partial<Node> | null)?.name ?? '');
  });
  return problems;
}

async function readList(): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(NODES_FILE, 'utf8');
  } catch {
    throw new Error(`Cannot read ${NODES_FILE}. Fix: write the file, for example ${EXAMPLE}.`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${NODES_FILE} is not valid JSON: ${(error as Error).message}. Fix: correct the JSON syntax.`);
  }
}

// The error message shows all problems in the file. Each problem has one fix.
export async function readNodes(): Promise<Node[]> {
  const list = await readList();
  const problems = listProblems(list);
  if (problems.length > 0) {
    throw new Error(`${NODES_FILE} is not valid.\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
  }
  return list as Node[];
}
