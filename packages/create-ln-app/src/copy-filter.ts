// The copy filter for a template folder. The CLI and scripts/js-template.ts use it.
import { basename, dirname, join, relative } from 'node:path';

const DATA_DIR = join('network', 'data');
const KEEP = '.gitkeep';
// The Next.js template makes .next, AGENTS.md, and next-env.d.ts when next dev or next build runs.
const RUN_PATHS = ['.env', join('frontend', 'dist'), '.next', 'AGENTS.md', 'next-env.d.ts'];

// A local run of the template makes these paths, so the copy does not include them.
// The "files" field in package.json also keeps them out of the npm package.
export function copyFilter(templateDir: string): (source: string) => boolean {
  return (source) => {
    const path = relative(templateDir, source);
    if (basename(path) === 'node_modules') return false;
    if (RUN_PATHS.includes(path)) return false;
    return dirname(path) !== DATA_DIR || basename(path) === KEEP;
  };
}
