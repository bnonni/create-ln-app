#!/usr/bin/env node
// Make a new Lightning app project from the template in ../template.
// Usage: npx create-ln-app <project-dir> [--skip-install]
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const MIN_NODE_MAJOR = 24;
const TEMPLATE_DIR = fileURLToPath(new URL('../template', import.meta.url));
const DATA_DIR = join('network', 'data');
const KEEP = '.gitkeep';
const APP_URL = 'http://localhost:5173';
const USAGE = `Usage: npx create-ln-app <project-dir> [--skip-install]

Options:
  --skip-install  Do not install the npm packages.
  -h, --help      Show this help.`;

// A local run of the template makes these paths, so the CLI does not copy them.
// The "files" field in package.json also keeps them out of the npm package.
function copyFilter(source: string): boolean {
  const path = relative(TEMPLATE_DIR, source);
  if (basename(path) === 'node_modules') return false;
  if (path === '.env' || path === join('frontend', 'dist')) return false;
  return dirname(path) !== DATA_DIR || basename(path) === KEEP;
}

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

  const target = resolve(positionals[0]);
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(`${target} is not empty. Use a new or empty folder.`);
  }
  const name = packageName(target);

  cpSync(TEMPLATE_DIR, target, { recursive: true, filter: copyFilter });
  // npm does not put a .gitignore file in a package, so the template file has no dot.
  renameSync(join(target, 'gitignore'), join(target, '.gitignore'));
  setName(join(target, 'package.json'), name);
  setName(join(target, 'package-lock.json'), name);
  console.log(`Made ${name} in ${target}.`);

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
