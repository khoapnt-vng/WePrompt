#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

function requireString(value, message) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(message);
}

function validateDiagnostic(diagnostic, attemptNumber) {
  if (!diagnostic || typeof diagnostic !== 'object') {
    throw new Error(`attempt ${attemptNumber} known failure requires a focused diagnostic`);
  }
  requireString(diagnostic.question, `attempt ${attemptNumber} diagnostic requires a question`);
  if (
    !Array.isArray(diagnostic.command) ||
    diagnostic.command.length === 0 ||
    diagnostic.command.some((part) => !part)
  ) {
    throw new Error(`attempt ${attemptNumber} diagnostic requires its exact command`);
  }
  if (!Number.isInteger(diagnostic.exitCode)) throw new Error(`attempt ${attemptNumber} diagnostic requires exitCode`);
  if (!SHA256.test(diagnostic.rawLogSha256 ?? '')) {
    throw new Error(`attempt ${attemptNumber} diagnostic requires a raw log hash`);
  }
}

function validateReviewerDisposition(disposition, attemptNumber) {
  if (!disposition || typeof disposition !== 'object') {
    throw new Error(`attempt ${attemptNumber} known failure requires reviewer disposition`);
  }
  requireString(disposition.reviewer, `attempt ${attemptNumber} reviewer disposition requires reviewer`);
  if (!['accepted_known_flake', 'product_failure', 'infrastructure_failure'].includes(disposition.decision)) {
    throw new Error(`attempt ${attemptNumber} reviewer disposition has invalid decision`);
  }
  requireString(disposition.rationale, `attempt ${attemptNumber} reviewer disposition requires rationale`);
  requireString(disposition.at, `attempt ${attemptNumber} reviewer disposition requires timestamp`);
}

function validateAttempt(attempt, index) {
  const expectedAttempt = index + 1;
  if (!attempt || typeof attempt !== 'object' || attempt.attempt !== expectedAttempt) {
    throw new Error(`ordered attempt number must be ${expectedAttempt}`);
  }
  if (attempt.kind !== 'full-suite') throw new Error(`attempt ${expectedAttempt} must be kind full-suite`);
  if (!Array.isArray(attempt.command) || attempt.command.length === 0 || attempt.command.some((part) => !part)) {
    throw new Error(`attempt ${expectedAttempt} requires its command`);
  }
  if (!COMMIT.test(attempt.commit ?? '')) throw new Error(`attempt ${expectedAttempt} requires exact commit`);
  if (!attempt.runner || typeof attempt.runner !== 'object')
    throw new Error(`attempt ${expectedAttempt} lacks runner metadata`);
  for (const field of ['os', 'architecture', 'name']) {
    requireString(attempt.runner[field], `attempt ${expectedAttempt} lacks runner metadata`);
  }
  if (!attempt.tools || typeof attempt.tools !== 'object' || !attempt.tools.bun || !attempt.tools.node) {
    throw new Error(`attempt ${expectedAttempt} lacks tool metadata`);
  }
  requireString(attempt.startedAt, `attempt ${expectedAttempt} requires startedAt`);
  requireString(attempt.endedAt, `attempt ${expectedAttempt} requires endedAt`);
  if (!Number.isInteger(attempt.exitCode)) throw new Error(`attempt ${expectedAttempt} requires exitCode`);
  if (!['green', 'red'].includes(attempt.result)) throw new Error(`attempt ${expectedAttempt} has invalid result`);
  if (!attempt.rawLog || typeof attempt.rawLog !== 'object' || !attempt.rawLog.path) {
    throw new Error(`attempt ${expectedAttempt} requires raw log metadata`);
  }
  if (!SHA256.test(attempt.rawLog.sha256 ?? '')) throw new Error(`attempt ${expectedAttempt} has invalid raw log hash`);
  if (!attempt.cleanLog || typeof attempt.cleanLog !== 'object' || !attempt.cleanLog.path) {
    throw new Error(`attempt ${expectedAttempt} requires clean log metadata`);
  }
  if (!SHA256.test(attempt.cleanLog.sha256 ?? '')) {
    throw new Error(`attempt ${expectedAttempt} has invalid clean log hash`);
  }
  if (!Array.isArray(attempt.failures)) throw new Error(`attempt ${expectedAttempt} failures must be an array`);

  if (attempt.exitCode === 0) {
    if (attempt.result !== 'green' || attempt.failures.length !== 0) {
      throw new Error(`attempt ${expectedAttempt} green result conflicts with failures`);
    }
    return;
  }
  if (attempt.result !== 'red' || attempt.failures.length === 0) {
    throw new Error(`attempt ${expectedAttempt} red result requires recorded failures`);
  }
  for (const failure of attempt.failures) {
    if (!SHA256.test(failure.outputDigest ?? '')) {
      throw new Error(`attempt ${expectedAttempt} failure requires output digest`);
    }
    if (failure.classification === 'unknown' || !failure.signatureId) {
      throw new Error(`attempt ${expectedAttempt} contains unknown failure`);
    }
    if (failure.classification !== 'known_pending_triage') {
      throw new Error(`attempt ${expectedAttempt} failure has invalid classification`);
    }
    validateDiagnostic(failure.diagnostic, expectedAttempt);
    validateReviewerDisposition(failure.reviewerDisposition, expectedAttempt);
  }
}

function validateLedger(ledger) {
  if (!ledger || typeof ledger !== 'object' || ledger.schemaVersion !== 1) {
    throw new Error('ledger schemaVersion must be 1');
  }
  if (!SHA256.test(ledger.registerSha256 ?? '')) throw new Error('ledger requires registerSha256');
  if (!Array.isArray(ledger.attempts)) throw new Error('ledger attempts must be an array');
  if (ledger.totalRunCount !== ledger.attempts.length) {
    throw new Error('totalRunCount must equal ordered attempts length');
  }

  const seen = new Set();
  ledger.attempts.forEach((attempt, index) => {
    validateAttempt(attempt, index);
    const key = `${attempt.kind}:${attempt.commit}:${attempt.runner.os}:${attempt.runner.architecture}:${attempt.runner.name}`;
    if (seen.has(key))
      throw new Error(`duplicate full-suite invocation for ${attempt.commit} on ${attempt.runner.name}`);
    seen.add(key);
  });
  return ledger;
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) throw new Error('usage: validate-full-suite-ledger.js <ledger.json>');
  const ledgerPath = path.resolve(argv[0]);
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  validateLedger(ledger);
  process.stdout.write(`Valid full-suite ledger: ${ledger.attempts.length} ordered attempt(s)\n`);
}

module.exports = { validateLedger };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`full-suite ledger validation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
