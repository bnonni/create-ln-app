// Make the React JavaScript template (template-react/) from the React TypeScript template (template/).
// ts-blank-space removes the types, then prettier formats the result (decision 11 in ROADMAP.md).
// Usage: npm run js-template -w create-ln-app
// oxlint skips the files that the repo .gitignore ignores, so lint a copy of template-react/ outside the repo.
import { execFileSync } from 'node:child_process';
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import { blankSourceFile } from 'ts-blank-space';
import { copyFilter } from '../src/copy-filter.ts';

// The TypeScript 6 AST types, from the type file of ts-blank-space.
type SourceFile = Parameters<typeof blankSourceFile>[0];
type Node = Parameters<NonNullable<Parameters<typeof blankSourceFile>[1]>>[0];

const SOURCE_DIR = fileURLToPath(new URL('../template', import.meta.url));
const TARGET_DIR = fileURLToPath(new URL('../template-react', import.meta.url));
// ts-blank-space needs the JS API of TypeScript 6. The TypeScript 7 package of the repo has no JS API.
const ts = createRequire(import.meta.resolve('ts-blank-space'))('typescript');
// With these options, prettier keeps most lines of the template source as they are.
const PRETTIER = { singleQuote: true, printWidth: 120 };
const JS_EXT: Record<string, string> = { '.ts': '.js', '.tsx': '.jsx' };
// The generator changes the text in these files. It does not read the lock files or the files in public/.
const TEXT_EXT = new Set(['.js', '.jsx', '.json', '.html', '.md']);

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((path) => !path.split(sep).includes('public'))
    .map((path) => join(dir, path));
}

// ts-blank-space keeps the comment above a removed type. Remove the comment lines directly above each type.
function removeTypeComments(sourceFile: SourceFile, js: string): string {
  const lines = js.split('\n');
  const visit = (node: Node): void => {
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      for (let i = line - 1; i >= 0 && lines[i].trim().startsWith('//'); i--) lines[i] = '';
    } else {
      ts.forEachChild(node, visit);
    }
  };
  visit(sourceFile);
  return lines.join('\n');
}

async function toJs(file: string): Promise<void> {
  const ext = extname(file);
  const kind = ext === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const options = { languageVersion: ts.ScriptTarget.ESNext, impliedNodeFormat: ts.ModuleKind.ESNext };
  const source = readFileSync(file, 'utf8');
  const sourceFile: SourceFile = ts.createSourceFile(basename(file), source, options, false, kind);
  const js = blankSourceFile(sourceFile, (node) => {
    throw new Error(`${file}: ts-blank-space cannot remove this syntax: ${node.getText(sourceFile)}`);
  });
  const target = file.slice(0, -ext.length) + JS_EXT[ext];
  writeFileSync(target, await format(removeTypeComments(sourceFile, js), { ...PRETTIER, filepath: target }));
  rmSync(file);
}

// Change "name.ts" to "name.js" and "name.tsx" to "name.jsx" for each file that toJs changed.
function renameRefs(text: string, names: Set<string>): string {
  return text.replace(/\b([\w.-]+)\.(tsx?)\b/g, (ref, name: string, ext: string) =>
    names.has(ref) ? `${name}${JS_EXT[`.${ext}`]}` : ref,
  );
}

// Change one string in a file. Stop if the string is not in the file one time, because then the template changed.
function edit(file: string, from: string, to: string): void {
  const text = readFileSync(join(TARGET_DIR, file), 'utf8');
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${file}: found "${from}" ${count} times, expected 1. Update scripts/js-template.ts.`);
  writeFileSync(join(TARGET_DIR, file), text.replace(from, to));
}

// Remove the TypeScript package and the type check script. Keep the @types packages for the editor, as create-vite does.
function editPackage(file: string, change: (scripts: Record<string, string>) => void): void {
  const path = join(TARGET_DIR, file);
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  delete pkg.devDependencies.typescript;
  delete pkg.scripts.typecheck;
  change(pkg.scripts);
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function main(): Promise<void> {
  rmSync(TARGET_DIR, { recursive: true, force: true });
  cpSync(SOURCE_DIR, TARGET_DIR, { recursive: true, filter: copyFilter(SOURCE_DIR) });

  const all = files(TARGET_DIR);
  for (const file of all.filter((path) => basename(path).startsWith('tsconfig'))) rmSync(file);
  const code = all.filter((path) => extname(path) in JS_EXT);
  for (const file of code) await toJs(file);

  const names = new Set(code.map((path) => basename(path)));
  for (const file of files(TARGET_DIR).filter((path) => TEXT_EXT.has(extname(path)))) {
    if (basename(file) === 'package-lock.json') continue;
    const text = readFileSync(file, 'utf8');
    const renamed = renameRefs(text, names);
    if (renamed !== text) writeFileSync(file, renamed);
  }

  editPackage('package.json', () => {});
  editPackage('frontend/package.json', (scripts) => {
    scripts.build = scripts.build.replace('tsc -b && ', '');
  });
  // The JavaScript template has no types, so these comments and docs point to server/API.md.
  edit(
    'server/nodes/types.js',
    'The API server uses only the types in this file.\n// Each node client maps the data, the errors, and the invoice states of its node to these types.',
    'server/API.md shows its data and its errors.\n// Each node client maps the data, the errors, and the invoice states of its node to this interface.',
  );
  for (const node of ['cln', 'eclair', 'lnd']) {
    edit(`server/nodes/${node}.js`, 'the neutral types in types.js.', 'the neutral interface in server/API.md.');
  }
  edit('server/nodes/lnd.js', 'as JSON strings. The response types show this.', 'as JSON strings.');
  edit('server/API.md', '`server/nodes/types.js` has the set.', 'This file shows the set.');
  edit('frontend/.oxlintrc.json', '"react", "typescript", "oxc"', '"react", "oxc"');
  edit('README.md', 'Vite, React, TypeScript, and plain CSS', 'Vite, React, JavaScript, and plain CSS');
  edit('README.md', 'npm run typecheck   # TypeScript, no emit\n', '');
  edit('frontend/README.md', 'Vite, React, TypeScript, and plain CSS', 'Vite, React, JavaScript, and plain CSS');
  edit('frontend/README.md', '# type check, then write the production build', '# write the production build');
  edit('frontend/README.md', 'npm run typecheck   # TypeScript, no emit\n', '');

  // Remove the typescript package from the lock files. The other locked versions stay the same.
  for (const dir of [TARGET_DIR, join(TARGET_DIR, 'frontend')]) {
    // On Windows, npm is a .cmd file, and Node starts a .cmd file only through a shell.
    execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: dir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  }
  console.log(`Made ${TARGET_DIR} with ${code.length} JavaScript files.`);
}

await main();
