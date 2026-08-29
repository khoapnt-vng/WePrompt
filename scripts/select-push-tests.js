#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Chooses which test leg the pre-push gate needs for the commits actually being pushed.
 *
 * The gate ran the whole suite under coverage instrumentation for every push, including the
 * documentation-only ones — measured at ~325s to prove that a Markdown edit had not broken 10,666
 * tests. This picks the cheapest leg that still proves what changed:
 *
 *   coverage — a file whose coverage the Studio gate enforces changed, so thresholds must be re-run
 *   full     — other source or test files changed; run the suite, skip the instrumentation
 *   none     — only documentation changed, and no test in this repo reads documentation
 *
 * **The Studio set is read from the coverage manifest, not from a directory.** That manifest
 * deliberately includes files far outside `creative-studio/` — `ipcBridge.ts`, `AionrsChat.tsx`,
 * `payloadSchemas.ts` — whose coverage the gate still enforces. Matching on a path prefix would
 * silently stop enforcing them.
 *
 * Fails safe: anything unexpected — no upstream, an unreadable manifest, a git error — selects the
 * full coverage leg, which is exactly the behaviour this replaces.
 */

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const COVERAGE_CONFIG = 'vitest.creative-studio-coverage.config.ts';

/** Documentation carries no behaviour, and no test in this repo reads any of it. */
const isDocumentation = (file) => file.endsWith('.md');

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const coverageManifest = () => {
  const source = readFileSync(resolve(process.cwd(), COVERAGE_CONFIG), 'utf8');
  const start = source.indexOf('creativeStudioRuntimeManifest = [');
  if (start < 0) throw new Error(`No manifest array in ${COVERAGE_CONFIG}`);
  // The array closes `] as const;`, not `];` — matching the wrong terminator swept in the coverage
  // reporter strings below it and inflated the manifest by five phantom entries.
  const end = source.indexOf('\n]', start);
  if (end < 0) throw new Error(`Unterminated manifest array in ${COVERAGE_CONFIG}`);
  const entries = [...source.slice(start, end).matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const stray = entries.filter((entry) => !entry.startsWith('packages/'));
  if (stray.length > 0) throw new Error(`Manifest parse captured non-paths: ${stray.join(', ')}`);
  // A manifest that suddenly parses as tiny would quietly stop selecting the coverage leg.
  if (entries.length < 50) throw new Error(`Manifest parsed as only ${entries.length} entries`);
  return new Set(entries);
};

const changedFiles = () => {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch === 'HEAD') throw new Error('detached HEAD');
  const upstream = git('rev-parse', '--abbrev-ref', `${branch}@{upstream}`);
  const base = git('merge-base', upstream, 'HEAD');
  return git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
};

const select = () => {
  let files;
  try {
    files = changedFiles();
  } catch (error) {
    return { leg: 'coverage', why: `cannot tell what is being pushed (${error.message}); running everything` };
  }
  if (files.length === 0) return { leg: 'none', why: 'nothing to push' };

  const manifest = coverageManifest();
  const enforced = files.filter((file) => manifest.has(file));
  if (enforced.length > 0) {
    const shown = enforced.slice(0, 3).join(', ');
    return {
      leg: 'coverage',
      why: `${enforced.length} coverage-enforced file(s) changed (${shown}${enforced.length > 3 ? ', …' : ''})`,
    };
  }

  const behaviour = files.filter((file) => !isDocumentation(file));
  if (behaviour.length > 0) {
    return { leg: 'full', why: `${behaviour.length} non-documentation file(s) changed, none coverage-enforced` };
  }
  return { leg: 'none', why: `${files.length} file(s) changed, all documentation` };
};

let selection;
try {
  selection = select();
} catch (error) {
  selection = { leg: 'coverage', why: `selection failed (${error.message}); running everything` };
}

const COMMANDS = {
  coverage: ['bun', ['run', 'test:coverage:creative-studio']],
  full: ['bun', ['run', 'test']],
  none: null,
};

console.log(`pre-push tests: ${selection.leg} — ${selection.why}`);
if (process.argv.includes('--dry-run')) process.exit(0);

const command = COMMANDS[selection.leg];
if (command === null) process.exit(0);
execFileSync(command[0], command[1], { stdio: 'inherit' });
