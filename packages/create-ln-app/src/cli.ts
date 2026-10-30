#!/usr/bin/env node
// Make a new Lightning app project from the template in ../template.
// Usage: npx create-ln-app <project-dir> [--nodes <n>] [--impl <impl>] [--skip-install]
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { copyFilter } from './copy-filter.js';

const MIN_NODE_MAJOR = 24;
const TEMPLATE_DIR = fileURLToPath(new URL('../template', import.meta.url));
const APP_URL = 'http://localhost:5173';
// The template script scripts/nodes.ts accepts 2 to 10 nodes. Node i gets name i of this list.
const NODE_NAMES = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi', 'ivan', 'judy'];
const MIN_NODES = 2;
const DEFAULT_NODES = '3';
// The impls of scripts/nodes.ts in the template, with the names that the CLI shows.
const IMPLS = { lnd: 'LND', cln: 'CLN', eclair: 'Eclair' } as const;
type Impl = keyof typeof IMPLS;
const DEFAULT_IMPL: Impl = 'lnd';
// For example "lnd, cln, or eclair".
const IMPL_LIST = new Intl.ListFormat('en', { type: 'disjunction' }).format(Object.keys(IMPLS));
const USAGE = `Usage: npx create-ln-app <project-dir> [--nodes <n>] [--impl <impl>] [--skip-install]

Options:
  --nodes <n>     Make a network with n nodes, from ${MIN_NODES} to ${NODE_NAMES.length}. The default is ${DEFAULT_NODES}.
  --impl <impl>   Use this impl for all the nodes: ${IMPL_LIST}. cln is Core Lightning. The default is ${DEFAULT_IMPL}.
  --skip-install  Do not install the npm packages.
  -h, --help      Show this help.`;

// Make a valid npm package name from the folder name, for example "My App" > "my-app".
function packageName(dir: string): string {
  const name = basename(dir)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]+/, '')
    .replace(/[^a-z0-9._~-]+/g, '-');
  return name || 'my-lapp';
}

function setName(file: string, name: string): void {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.name = name;
  // In package-lock.json, packages[""] is the root package.
  if (json.packages?.['']) json.packages[''].name = name;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

function nodeCount(value: string): number {
  const count = Number(value);
  if (!/^\d+$/.test(value) || count < MIN_NODES || count > NODE_NAMES.length) {
    throw new Error(`--nodes ${value} is not valid. Fix: use a number from ${MIN_NODES} to ${NODE_NAMES.length}.`);
  }
  return count;
}

function implName(value: string): Impl {
  if (!Object.hasOwn(IMPLS, value)) {
    throw new Error(`--impl ${value} is not valid. Fix: use ${IMPL_LIST}.`);
  }
  return value as Impl;
}

// Write the same format as the template file: one node on each line.
function writeNodes(file: string, count: number, impl: Impl): void {
  const lines = NODE_NAMES.slice(0, count).map((name) => `  { "name": "${name}", "impl": "${impl}" }`);
  writeFileSync(file, `[\n${lines.join(',\n')}\n]\n`);
}

function run(command: string, args: string[], cwd: string): boolean {
  // On Windows, npm is a .cmd file, and Node starts a .cmd file only through a shell.
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status === 0;
}

function initGit(dir: string): void {
  const inRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, stdio: 'ignore' });
  if (inRepo.status === 0) {
    console.log('The project is in a git repository, so the CLI did not run git init.');
    return;
  }
  const init = spawnSync('git', ['init', '--quiet'], { cwd: dir, stdio: 'ignore' });
  if (init.status !== 0) console.warn('git init failed. To use git, run git init in the project.');
}

function main(): void {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    throw new Error(`Node ${MIN_NODE_MAJOR} or later is necessary. You have Node ${process.versions.node}.`);
  }

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      nodes: { type: 'string', default: DEFAULT_NODES },
      impl: { type: 'string', default: DEFAULT_IMPL },
      'skip-install': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (positionals.length !== 1) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const count = nodeCount(values.nodes);
  const impl = implName(values.impl);
  const target = resolve(positionals[0]);
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(`${target} is not empty. Use a new or empty folder.`);
  }
  const name = packageName(target);

  cpSync(TEMPLATE_DIR, target, { recursive: true, filter: copyFilter(TEMPLATE_DIR) });
  // npm does not put a .gitignore file in a package, so the template file has no dot.
  renameSync(join(target, 'gitignore'), join(target, '.gitignore'));
  setName(join(target, 'package.json'), name);
  setName(join(target, 'package-lock.json'), name);
  writeNodes(join(target, 'network', 'nodes.json'), count, impl);
  // The compose file gets the node list and a project name from the new package name.
  // The compose script uses only Node built-in modules, so it runs with --skip-install too.
  if (!run('npm', ['run', '--silent', 'compose'], target)) {
    throw new Error(`npm run compose failed. Fix the error, then run npm run compose in ${target}.`);
  }
  console.log(`Made ${name} in ${target} with ${count} ${IMPLS[impl]} nodes.`);

  initGit(target);

  const skipInstall = values['skip-install'] === true;
  if (!skipInstall) {
    console.log('Installing the npm packages.');
    if (!run('npm', ['run', 'install:all'], target)) {
      throw new Error(`npm install failed. Fix the error, then run npm run install:all in ${target}.`);
    }
  }

  // The doctor script uses only Node built-in modules, so it runs with --skip-install too.
  // A failed check does not stop the CLI, because the project is complete.
  console.log('Checks for Docker and the ports:');
  const ready = run('npm', ['run', '--silent', 'doctor'], target);

  const cdPath = relative(process.cwd(), target) || '.';
  const cdArg = /^[\w./-]+$/.test(cdPath) ? cdPath : `"${cdPath}"`;
  const steps = [
    `cd ${cdArg}`,
    ...(skipInstall ? ['npm run install:all'] : []),
    ...(ready ? [] : ['npm run doctor']),
    'npm run dev',
  ];
  console.log(`
Next steps${ready ? '' : ' (do the fixes above first)'}:
${steps.map((step) => `  ${step}`).join('\n')}

Then open ${APP_URL}. See README.md for all commands.`);
}

try {
  main();
} catch (error) {
  console.error(`create-ln-app failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
