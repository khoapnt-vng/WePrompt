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
 *   coverage — anything that carries behaviour changed; run the reviewed Creative Studio gate
 *   none     — only inert documentation changed
 *
 * Exactly two legs, on purpose. An earlier draft had a third "run the suite without coverage" leg
 * for changes touching no coverage-enforced file. That was unsound: deleting a test, or editing a
 * helper a Studio file imports, moves a manifest file's coverage without touching any manifest
 * file.
 *
 * **"Documentation" is not the same as ".md", and assuming it was left a real hole.** Two classes
 * of Markdown in this repository carry behaviour, and a push touching only them used to run zero
 * tests:
 *
 *   - `packages/<any>/*.md` — shipped product content, not prose. The twelve
 *     `presentation-templates/<pack>/THEME.md` files are imported into source with `?raw` and become
 *     the instruction text the presentation agent follows; `index.test.ts` asserts their bytes.
 *     Commit 26b9d4311 changed one of them and nothing else.
 *   - `tests/**` — fixtures. The eleven `tests/eval/fixture/corpus*` documents are the KB
 *     retrieval regression corpus, loaded by `tests/eval/harness/fixture.ts`, and the baseline is
 *     computed over their bytes.
 *   - `docs/design/creative-studio-2-*` — prose asserted verbatim by
 *     `tests/unit/process/creative-studio/types/documentation.test.ts`, which reads seven of these
 *     files and matches exact sentences and headings out of them.
 *
 * Both are listed below and treated as behaviour. The rule errs toward running tests: a path
 * wrongly called behaviour costs one gate run, a path wrongly called documentation pushes a red
 * suite.
 *
 * Fails safe: anything unexpected — no upstream, a git error — selects the coverage leg, which is
 * exactly the behaviour this replaces.
 *
 * The coverage leg is also serialised machine-wide, because two of them at once saturate the cores
 * and turn healthy tests into timeouts that pass in isolation seconds later. A second push queues
 * behind the first rather than overlapping it; see the lock module for how it recovers from a gate
 * that was killed. The documentation leg takes nothing, since it contends for nothing.
 */

const { execFileSync } = require('node:child_process');
const { withPushGateLock } = require('../packages/shared-scripts/src/push-gate-lock.js');

/**
 * Markdown that something reads. Skipping tests for these would push a change the suite would
 * have caught. `releasePackagingConfig.test.ts` pins the resulting decisions behaviourally, by
 * running this script, so widening the rule cannot pass unnoticed.
 */
const BEHAVIOUR_BEARING_MARKDOWN = [
  // Shipped with the product and asserted byte-for-byte.
  /^packages\//,
  // Read and matched sentence-by-sentence by documentation.test.ts.
  /^docs\/design\/creative-studio-2-/,
  // Test data, never prose. The eleven `tests/eval/fixture/corpus*` documents are the KB retrieval
  // regression corpus: `tests/eval/harness/fixture.ts` loads them and the baseline is computed over
  // their bytes, so editing one moves a gated assertion.
  /^tests\//,
];

const isDocumentation = (file) =>
  file.endsWith('.md') && !BEHAVIOUR_BEARING_MARKDOWN.some((pattern) => pattern.test(file));

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const changedFiles = () => {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch === 'HEAD') throw new Error('detached HEAD');
  const upstream = git('rev-parse', '--abbrev-ref', `${branch}@{upstream}`);
  const headRevision = git('rev-parse', 'HEAD');
  const upstreamRevision = git('rev-parse', upstream);
  const base = git('merge-base', upstream, 'HEAD');
  return {
    files: git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean),
    headEqualsUpstream: headRevision === upstreamRevision,
  };
};

/** The whole decision, as a pure function of the changed paths, so it can be tested directly. */
const classify = (files) => {
  if (files.length === 0) return { leg: 'none', why: 'nothing to push' };
  const behaviour = files.filter((file) => !isDocumentation(file));
  if (behaviour.length > 0) {
    const shown = behaviour.slice(0, 3).join(', ');
    return {
      leg: 'coverage',
      why: `${behaviour.length} file(s) carrying behaviour changed (${shown}${behaviour.length > 3 ? ', …' : ''})`,
    };
  }
  return { leg: 'none', why: `${files.length} file(s) changed, all documentation` };
};

/**
 * `classify([])` remains the right answer for unpushed commits whose combined tree is unchanged.
 * It is not sufficient for a branch whose HEAD has already reached its upstream, though: in that
 * state a repeated `just push` is the only available way to repair or re-run a gate after the
 * original push, and reporting `none` makes an untested push look green. Treat that exact relation
 * as an explicit request for the reviewed gate; keep all other path classification unchanged.
 */
const classifyPushState = ({ files, headEqualsUpstream }) =>
  headEqualsUpstream
    ? { leg: 'coverage', why: 'HEAD already matches its upstream; re-running the reviewed gate' }
    : classify(files);

const select = () => {
  let state;
  try {
    state = changedFiles();
  } catch (error) {
    return { leg: 'coverage', why: `cannot tell what is being pushed (${error.message}); running the gate` };
  }
  return classifyPushState(state);
};

/**
 * Exactly one test command, on purpose. A second entry here would be a way to push Studio code
 * having run something weaker than the reviewed gate, so `releasePackagingConfig.test.ts` asserts
 * this map names `test:coverage:creative-studio` and nothing else.
 */
const COMMANDS = {
  coverage: ['bun', ['run', 'test:coverage:creative-studio']],
  none: null,
};

module.exports = { BEHAVIOUR_BEARING_MARKDOWN, classify, classifyPushState, isDocumentation };

const main = () => {
  // `--classify <paths...>` prints the leg for a hypothetical change set and runs nothing. The
  // guard test uses it to assert real decisions rather than the source text of this file.
  const classifyAt = process.argv.indexOf('--classify');
  if (classifyAt !== -1) {
    console.log(classify(process.argv.slice(classifyAt + 1)).leg);
    return;
  }

  let selection;
  try {
    selection = select();
  } catch (error) {
    selection = { leg: 'coverage', why: `selection failed (${error.message}); running the gate` };
  }

  console.log(`pre-push tests: ${selection.leg} — ${selection.why}`);
  if (process.argv.includes('--dry-run')) return;

  const command = COMMANDS[selection.leg];
  if (command === null) return;
  withPushGateLock({}, () => execFileSync(command[0], command[1], { stdio: 'inherit' }));
};

if (require.main === module) main();
