#!/usr/bin/env node
/**
 * Runs desktop unit tests with V8 coverage and prints:
 *   PR-surface line %  = product helpers (excludes *.spec.js)
 *   overall line %     = all emitted dist-test files
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: false });
  if (r.status !== 0) {
    process.stderr.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    process.exit(r.status || 1);
  }
  return r.stdout || '';
}

const tsc = path.join(root, 'node_modules', '.bin', 'tsc');
run(tsc, ['-p', 'tsconfig.json']);
run(tsc, ['-p', 'tsconfig.test.json']);

const nodeArgs = [
  '--experimental-test-coverage',
  '--test',
  'dist-test/capture-privacy.spec.js',
  'dist-test/recording-ui.spec.js',
];
const out = spawnSync(process.execPath, nodeArgs, {
  cwd: root,
  encoding: 'utf8',
  env: process.env,
});
process.stdout.write(out.stdout || '');
process.stderr.write(out.stderr || '');
if (out.status) process.exit(out.status);

const cov = out.stderr || '';
// Node prints coverage summary on stderr after TAP; also try JSON if present.
let summary = cov;
const requireFs = createRequire(import.meta.url);
// Parse '# start of coverage report' style lines from node --experimental-test-coverage
const lines = (out.stdout + '\n' + out.stderr).split('\n');

function pct(covered, total) {
  if (!total) return 100;
  return Math.round((10000 * covered) / total) / 100;
}

// Fallback: re-run with coverage reporter via NODE_V8_COVERAGE dir
import fs from 'node:fs';
import os from 'node:os';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-cov-'));
const env = { ...process.env, NODE_V8_COVERAGE: dir };
spawnSync(process.execPath, nodeArgs.filter((a) => a !== '--experimental-test-coverage'), {
  cwd: root,
  encoding: 'utf8',
  env,
});
// Prefer the experimental summary already printed; extract line counts from Coverage report block
const text = out.stdout + out.stderr;
const re = /\|\s*([^|]+)\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/g;
let m;
const files = [];
while ((m = re.exec(text))) {
  files.push({ file: m[1].trim(), pct: Number(m[2]), covered: Number(m[4]), total: Number(m[3]) });
}

// If table parse failed, print a clear gate line from process report
if (!files.length) {
  // Node 20+ prints: 'All files | ...'
  console.log('PR-surface line %: (see coverage table above)');
  console.log('overall line %: (see coverage table above)');
  process.exit(0);
}

const isSpec = (f) => /\.spec\.js$/.test(f.file);
const product = files.filter((f) => !isSpec(f.file) && /dist-test\//.test(f.file.replace(/\\/g, '/')));
const all = files.filter((f) => /dist-test\//.test(f.file.replace(/\\/g, '/')));

function aggregate(list) {
  const covered = list.reduce((s, x) => s + (x.covered || 0), 0);
  const total = list.reduce((s, x) => s + (x.total || 0), 0);
  // If only pct available:
  if (!total) {
    const avg = list.length ? list.reduce((s, x) => s + x.pct, 0) / list.length : 100;
    return Math.round(avg * 100) / 100;
  }
  return pct(covered, total);
}

console.log(`PR-surface line %: ${aggregate(product.length ? product : files.filter((f) => !isSpec(f.file)))}`);
console.log(`overall line %: ${aggregate(all.length ? all : files)}`);
