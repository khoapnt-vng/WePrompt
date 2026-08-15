import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const {
  classifyFailure,
  validateDiagnosticRequest,
  validateFullSuiteCommand,
  validateKnownFlakeRegister,
} = require('../../../scripts/release/run-vitest-gate');
const { validateLedger } = require('../../../scripts/release/validate-full-suite-ledger');
const register = require('../../../docs/release/sprint3-internal/known-flakes.json');

const SHA = 'a'.repeat(40);
const LOG_SHA = 'b'.repeat(64);

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    attempt: 1,
    kind: 'full-suite',
    command: ['bun', 'run', 'test'],
    commit: SHA,
    runner: { os: 'darwin', architecture: 'arm64', name: 'local-macos-arm64' },
    tools: { bun: '1.3.14', node: '24.15.0' },
    startedAt: '2026-08-15T10:00:00Z',
    endedAt: '2026-08-15T10:02:00Z',
    exitCode: 0,
    result: 'green',
    load: { oneMinute: 2.5, fiveMinute: 2.1, fifteenMinute: 2.0 },
    rawLog: { path: 'artifacts/sprint3-internal/vitest/a.log', sha256: LOG_SHA },
    cleanLog: { path: 'artifacts/sprint3-internal/vitest/a.clean.log', sha256: 'f'.repeat(64) },
    failures: [],
    ...overrides,
  };
}

function ledger(attempts: unknown[]) {
  return {
    schemaVersion: 1,
    registerSha256: 'c'.repeat(64),
    totalRunCount: attempts.length,
    attempts,
  };
}

function knownFailure(overrides: Record<string, unknown> = {}) {
  return {
    project: 'node',
    file: 'tests/unit/process/creative-studio/jobManager.test.ts',
    testName: 'persists the remote identity before polling and uses the exact capped backoff schedule',
    signatureId: 'BUG-027-CAPPED-BACKOFF',
    classification: 'known_pending_triage',
    outputDigest: 'd'.repeat(64),
    ...overrides,
  };
}

describe('Vitest full-suite evidence ledger', () => {
  it('accepts the frozen register but leaves the incomplete grant-store sighting non-matchable', () => {
    expect(() => validateKnownFlakeRegister(register)).not.toThrow();
    const sighting = register.signatures.find(
      (entry: { id: string }) => entry.id === 'BUG-046-GRANT-STORE-INCOMPLETE-SIGHTING'
    );
    expect(sighting).toMatchObject({ matchable: false, testName: null });
  });

  it('retains and blocks on a first red attempt even after a later green', () => {
    const red = attempt({
      exitCode: 1,
      result: 'red',
      failures: [
        {
          project: 'node',
          file: 'tests/unit/newFailure.test.ts',
          testName: 'new failure',
          signatureId: null,
          classification: 'unknown',
          outputDigest: 'd'.repeat(64),
        },
      ],
    });
    const green = attempt({ attempt: 2, startedAt: '2026-08-15T10:03:00Z', endedAt: '2026-08-15T10:05:00Z' });

    expect(() => validateLedger(ledger([red, green]))).toThrow(/attempt 1.*unknown/i);
  });

  it('requires a focused diagnostic and reviewer disposition for an exact known signature', () => {
    const red = attempt({ exitCode: 1, result: 'red', failures: [knownFailure()] });
    expect(() => validateLedger(ledger([red]))).toThrow(/diagnostic/i);

    const withDiagnostic = attempt({
      exitCode: 1,
      result: 'red',
      failures: [
        knownFailure({
          diagnostic: {
            question: 'Does the exact test pass in isolation without changing its timeout?',
            command: ['bunx', 'vitest', 'run', 'exact.test.ts', '-t', 'exact name'],
            exitCode: 0,
            rawLogSha256: 'e'.repeat(64),
          },
        }),
      ],
    });
    expect(() => validateLedger(ledger([withDiagnostic]))).toThrow(/reviewer disposition/i);

    const complete = attempt({
      exitCode: 1,
      result: 'red',
      failures: [
        knownFailure({
          diagnostic: {
            question: 'Does the exact test pass in isolation without changing its timeout?',
            command: ['bunx', 'vitest', 'run', 'exact.test.ts', '-t', 'exact name'],
            exitCode: 0,
            rawLogSha256: 'e'.repeat(64),
          },
          reviewerDisposition: {
            reviewer: 'release-owner',
            decision: 'accepted_known_flake',
            rationale: 'Exact registered signature; isolated diagnostic passed unchanged.',
            at: '2026-08-15T11:00:00Z',
          },
        }),
      ],
    });
    expect(() => validateLedger(ledger([complete]))).not.toThrow();
  });

  it('classifies a new test name or altered assertion output as unknown', () => {
    const exact = {
      project: 'node',
      file: 'tests/unit/process/creative-studio/jobManager.test.ts',
      testName: 'persists the remote identity before polling and uses the exact capped backoff schedule',
    };

    expect(classifyFailure(exact, 'AssertionError: exact schedule changed', register)?.id).toBe(
      'BUG-027-CAPPED-BACKOFF'
    );
    expect(classifyFailure({ ...exact, testName: 'a newly added test' }, 'AssertionError', register)).toBeNull();
    expect(classifyFailure(exact, 'Error: provider returned a real failure', register)).toBeNull();
  });

  it('allows only the registered exact diagnostic command with a stated question', () => {
    const signature = register.signatures.find(
      (entry: { id: string }) => entry.id === 'BUG-043-READINESS-HARDLINK-DRIFT'
    );
    const failure = { signatureId: signature.id, classification: 'known_pending_triage' };

    expect(() =>
      validateDiagnosticRequest(
        failure,
        signature,
        signature.diagnosticCommand,
        'Does identity drift reproduce unchanged?'
      )
    ).not.toThrow();
    expect(() => validateDiagnosticRequest(failure, signature, ['bunx', 'vitest', 'run'], 'Same question')).toThrow(
      /exact registered command/i
    );
    expect(() => validateDiagnosticRequest(failure, signature, signature.diagnosticCommand, '  ')).toThrow(/question/i);
  });

  it('allows only the frozen full-suite command for a full-suite ledger attempt', () => {
    expect(() => validateFullSuiteCommand(['bun', 'run', 'test'])).not.toThrow();
    expect(() => validateFullSuiteCommand(['bunx', 'vitest', 'run'])).toThrow(/exact bun run test/i);
    expect(() => validateFullSuiteCommand(['bun', 'run', 'test', '--reporter=dot'])).toThrow(/exact bun run test/i);
  });

  it('requires ordered attempt counts and complete metadata with raw-log hashes', () => {
    expect(() => validateLedger({ ...ledger([attempt()]), totalRunCount: 2 })).toThrow(/totalRunCount/);
    expect(() => validateLedger(ledger([attempt({ attempt: 2 })]))).toThrow(/ordered attempt/i);
    expect(() => validateLedger(ledger([attempt({ rawLog: { path: 'a.log', sha256: 'short' } })]))).toThrow(
      /raw log hash/i
    );
    expect(() => validateLedger(ledger([attempt({ cleanLog: { path: 'a.clean.log', sha256: 'short' } })]))).toThrow(
      /clean log hash/i
    );
    expect(() => validateLedger(ledger([attempt({ tools: { bun: '', node: '' } })]))).toThrow(/tool metadata/i);
  });

  it('rejects hidden duplicate full-suite invocations for the same commit and runner', () => {
    const second = attempt({ attempt: 2, startedAt: '2026-08-15T10:03:00Z', endedAt: '2026-08-15T10:05:00Z' });
    expect(() => validateLedger(ledger([attempt(), second]))).toThrow(/duplicate full-suite invocation/i);
  });

  it('does not hide BUG-027 failures behind Vitest internal retries', () => {
    const source = readFileSync(
      resolve(__dirname, '../../../tests/unit/process/creative-studio/jobManager.test.ts'),
      'utf8'
    );

    expect(source).not.toContain('BUG_027_CI_RETRY');
    expect(source).not.toMatch(/retry:\s*process\.env\.CI/);
  });
});
