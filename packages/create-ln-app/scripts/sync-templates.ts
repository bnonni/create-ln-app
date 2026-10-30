// Copy the shared files from the React TypeScript template (template/) to the other template folders (decision 12 in ROADMAP.md).
// template/ is the source of the shared files. Change a shared file there, then run this script.
// Usage: npm run sync:templates. With --check, the script only compares the files, and it fails if a file is different.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFilter } from '../src/copy-filter.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = 'template';

// A shared folder or file. The script does not compare the "skip" paths, because only one template has them,
// or because each template has its own version of them.
type Share = { from: string; to: string; skip?: string[] };

const TARGETS: Record<string, Share[]> = {
  'template-next-ts': [
    { from: 'network', to: 'network' },
    { from: 'scripts', to: 'scripts' },
    { from: 'server', to: 'server', skip: ['index.ts'] },
    { from: '.env.example', to: '.env.example' },
    { from: 'gitignore', to: 'gitignore' },
    { from: 'frontend/src', to: 'src', skip: ['index.tsx', 'App.tsx', 'app'] },
  ],
};

// The filter stops the walk before network/data, because Docker can make files there that the user cannot read.
function walk(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (!keep(path)) return [];
    return entry.isDirectory() ? walk(path, keep) : [path];
  });
}

// The files of a shared path, relative to the path. A shared file gives one empty name.
function shareFiles(templateDir: string, path: string, skip: string[]): Set<string> {
  const full = join(templateDir, path);
  if (!existsSync(full)) return new Set();
  if (!statSync(full).isDirectory()) return new Set(['']);
  const keep = copyFilter(templateDir);
  const files = walk(full, (file) => keep(file) && !skip.includes(relative(full, file)));
  return new Set(files.map((file) => relative(full, file)));
}

function main(): void {
  const check = process.argv.includes('--check');
  const changes: string[] = [];
  for (const [target, shares] of Object.entries(TARGETS)) {
    for (const { from, to, skip = [] } of shares) {
      const sourceFiles = shareFiles(join(ROOT, SOURCE), from, skip);
      const targetFiles = shareFiles(join(ROOT, target), to, skip);
      for (const name of sourceFiles) {
        const source = join(ROOT, SOURCE, from, name);
        const copy = join(ROOT, target, to, name);
        if (targetFiles.has(name) && readFileSync(source).equals(readFileSync(copy))) continue;
        changes.push(`${relative(ROOT, copy)}: ${targetFiles.has(name) ? 'different' : 'missing'}`);
        if (check) continue;
        mkdirSync(dirname(copy), { recursive: true });
        copyFileSync(source, copy);
      }
      for (const name of targetFiles) {
        if (sourceFiles.has(name)) continue;
        const copy = join(ROOT, target, to, name);
        changes.push(`${relative(ROOT, copy)}: not in ${SOURCE}/`);
        if (!check) rmSync(copy);
      }
    }
  }

  if (changes.length === 0) {
    console.log('The shared files are the same in each template.');
  } else if (check) {
    for (const change of changes) console.error(change);
    console.error(`\nFiles that are not the same as in ${SOURCE}/: ${changes.length}. Fix: npm run sync:templates`);
    process.exitCode = 1;
  } else {
    for (const change of changes) console.log(`synced ${change}`);
    console.log(`\nFiles synced from ${SOURCE}/: ${changes.length}.`);
  }
}

main();
