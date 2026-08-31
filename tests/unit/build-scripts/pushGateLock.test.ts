/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '../../..');
const LOCK_MODULE = path.resolve(projectRoot, 'packages/shared-scripts/src/push-gate-lock.js');

type Holder = {
  pid: number;
  startedAt: number;
  workspace?: string;
  startFingerprint?: string | null;
};

type Inspection = {
  exists: boolean;
  raw?: string;
  holder: Holder | null;
  ageMs: number;
};

type StalenessOptions = {
  staleAfterMs?: number;
  unreadableGraceMs?: number;
  isAlive?: (pid: number) => boolean;
  startFingerprint?: (pid: number) => string | null;
};

type PushGateLockModule = {
  DEFAULT_LOCK_PATH: string;
  STALE_AFTER_MS: number;
  breakLock: (lockPath: string, expectedRaw: string) => void;
  formatDuration: (ms: number) => string;
  inspectLock: (lockPath: string, now?: number) => Inspection;
  stalenessOf: (inspection: Inspection, options?: StalenessOptions) => string | null;
};

const { DEFAULT_LOCK_PATH, STALE_AFTER_MS, breakLock, formatDuration, inspectLock, stalenessOf } = createRequire(
  path.resolve(projectRoot, 'package.json')
)(LOCK_MODULE) as PushGateLockModule;

/**
 * Blocks on a real child process the way the gate blocks on the test runner, so the interrupt and
 * failure paths below exercise the same shape production does rather than a bare sleep.
 */
const HOLDER_SCRIPT = `
const { appendFileSync, readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { withPushGateLock } = require(process.env.LOCK_MODULE);

const log = process.env.EVENT_LOG;
const label = process.env.LABEL;
const options = JSON.parse(process.env.LOCK_OPTIONS);

if (process.env.BREAK_STDERR === '1') {
  process.stderr.write = () => {
    throw new Error('stderr has gone away');
  };
}

const claimedAt = () => {
  try {
    return JSON.parse(readFileSync(options.lockPath, 'utf8')).startedAt;
  } catch {
    return 0;
  }
};

withPushGateLock(options, () => {
  appendFileSync(log, label + ' enter ' + claimedAt() + '\\n');
  execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, ' + process.env.HOLD_MS + ')'], { stdio: 'ignore' });
  if (process.env.FAIL_INSIDE === '1') throw new Error('the gate itself failed');
  appendFileSync(log, label + ' exit ' + Date.now() + '\\n');
});
`;

describe('push gate lock', () => {
  const liveHolder = (overrides: Partial<Holder> = {}): Holder => ({
    pid: 4242,
    startedAt: 0,
    workspace: 'cs2-table-board-ui-design',
    startFingerprint: 'Sat Aug 30 09:00:00 2026',
    ...overrides,
  });

  const inspection = (ageMs: number, holder: Holder | null): Inspection => ({
    exists: true,
    raw: 'whatever this file happens to hold',
    holder,
    ageMs,
  });

  const stillRunning: StalenessOptions = {
    isAlive: () => true,
    startFingerprint: () => 'Sat Aug 30 09:00:00 2026',
  };

  describe('deciding whether a lock may be broken', () => {
    it('leaves a young lock alone while the process that took it is still running', () => {
      expect(stalenessOf(inspection(90_000, liveHolder()), stillRunning)).toBeNull();
    });

    it('breaks a lock whose owning process no longer exists', () => {
      const reason = stalenessOf(inspection(90_000, liveHolder()), { ...stillRunning, isAlive: () => false });

      expect(reason).toMatch(/4242/);
      expect(reason).toMatch(/gone/);
    });

    /*
     * The liveness check on its own has lied here before: a gate orphaned by a killed terminal gets
     * reparented and keeps reporting as alive while doing nothing at all, which would wedge every
     * later push forever. The age ceiling is the second, independent way out.
     */
    it('breaks a lock past the age ceiling even though its owner still reports as alive', () => {
      const reason = stalenessOf(inspection(STALE_AFTER_MS + 1, liveHolder()), stillRunning);

      expect(reason).toMatch(/ceiling/);
    });

    it('breaks a lock whose recorded process id now belongs to an unrelated process', () => {
      const reason = stalenessOf(inspection(90_000, liveHolder()), {
        ...stillRunning,
        startFingerprint: () => 'Sat Aug 30 11:30:00 2026',
      });

      expect(reason).toMatch(/reused/);
    });

    it('keeps a live lock when the owner start time cannot be read at all', () => {
      const reason = stalenessOf(inspection(90_000, liveHolder()), { ...stillRunning, startFingerprint: () => null });

      expect(reason).toBeNull();
    });

    it('waits out a claim that is still mid-write rather than stealing it', () => {
      expect(stalenessOf(inspection(500, null), stillRunning)).toBeNull();
    });

    it('breaks a claim that is still unreadable long after any write could have finished', () => {
      expect(stalenessOf(inspection(120_000, null), stillRunning)).toMatch(/unreadable/);
    });
  });

  describe('reading a lock file', () => {
    let workspace: string;
    let lockPath: string;

    beforeEach(() => {
      workspace = mkdtempSync(path.join(tmpdir(), 'push-gate-lock-'));
      lockPath = path.join(workspace, 'gate.lock');
    });

    afterEach(() => {
      rmSync(workspace, { recursive: true, force: true });
    });

    it('reports no holder when nothing has taken the lock', () => {
      expect(inspectLock(lockPath).exists).toBe(false);
    });

    it('ages a corrupt claim from the file itself so it can still be broken', () => {
      writeFileSync(lockPath, '{ this is not json');

      const found = inspectLock(lockPath, Date.now() + 3_600_000);

      expect(found.holder).toBeNull();
      expect(found.ageMs).toBeGreaterThan(3_500_000);
    });

    /*
     * Two waiters can judge the same lock stale at the same moment. Whichever gets there second
     * must not delete whatever took its place in between, or the winner loses a lock it is holding.
     */
    it('refuses to clear a lock that changed hands since it was judged stale', () => {
      writeFileSync(lockPath, 'the claim that is there now');

      breakLock(lockPath, 'the claim that was judged stale');

      expect(existsSync(lockPath)).toBe(true);
    });
  });

  describe('serialising concurrent gate runs', () => {
    let workspace: string;
    let lockPath: string;
    let eventLog: string;
    let holderScript: string;

    beforeEach(() => {
      workspace = mkdtempSync(path.join(tmpdir(), 'push-gate-lock-'));
      lockPath = path.join(workspace, 'gate.lock');
      eventLog = path.join(workspace, 'events.log');
      holderScript = path.join(workspace, 'holder.js');
      writeFileSync(holderScript, HOLDER_SCRIPT);
      writeFileSync(eventLog, '');
    });

    afterEach(() => {
      rmSync(workspace, { recursive: true, force: true });
    });

    type Run = { child: ChildProcess; done: Promise<{ code: number | null; stderr: string }> };

    const startHolder = (label: string, holdMs: number, extra: NodeJS.ProcessEnv = {}): Run => {
      const child = spawn(process.execPath, [holderScript], {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          ...process.env,
          LOCK_MODULE,
          EVENT_LOG: eventLog,
          LABEL: label,
          HOLD_MS: String(holdMs),
          LOCK_OPTIONS: JSON.stringify({ lockPath, pollMs: 25, reportEveryMs: 120 }),
          ...extra,
        },
      });

      let stderr = '';
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });

      return {
        child,
        done: new Promise((resolve) => child.on('close', (code) => resolve({ code, stderr }))),
      };
    };

    /** Polls rather than sleeping a fixed span, so a loaded machine slows the test instead of failing it. */
    const waitFor = async (condition: () => boolean, timeoutMs = 30_000): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (condition()) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    };

    const events = (): string[] => readFileSync(eventLog, 'utf8').split('\n').filter(Boolean);

    /** The file exists between the exclusive create and the write, so wait for the claim itself. */
    const lockHolderPid = (): number | null => {
      try {
        return JSON.parse(readFileSync(lockPath, 'utf8')).pid;
      } catch {
        return null;
      }
    };

    it('runs two competing gates one after the other instead of side by side', async () => {
      const [first, second] = await Promise.all([startHolder('first', 300).done, startHolder('second', 300).done]);

      expect([first.code, second.code]).toEqual([0, 0]);
      expect(events().map((line) => line.split(' ')[1])).toEqual(['enter', 'exit', 'enter', 'exit']);
    });

    it('queues the second gate rather than failing it, and says what it is waiting for', async () => {
      const holder = startHolder('holder', 1_500);
      expect(await waitFor(() => lockHolderPid() === holder.child.pid)).toBe(true);

      const waiter = startHolder('waiter', 10);
      const [, waited] = await Promise.all([holder.done, waiter.done]);

      expect(waited.code).toBe(0);
      expect(waited.stderr).toMatch(new RegExp(`waiting for another push gate[^\\n]*${holder.child.pid}`));
    });

    it('keeps reporting while it waits so a long queue does not look hung', async () => {
      const holder = startHolder('holder', 1_500);
      expect(await waitFor(() => lockHolderPid() === holder.child.pid)).toBe(true);

      const waiter = startHolder('waiter', 10);
      const [, waited] = await Promise.all([holder.done, waiter.done]);

      expect(waited.stderr.match(/still waiting/g)?.length ?? 0).toBeGreaterThan(1);
    });

    it('releases the lock when the gate command itself fails', async () => {
      const failed = await startHolder('failing', 10, { FAIL_INSIDE: '1' }).done;

      expect(failed.code).not.toBe(0);
      expect(existsSync(lockPath)).toBe(false);
    });

    /*
     * Without a signal trap the terminate would kill the holder outright and orphan the lock file,
     * which is exactly the wedge that must never happen. The handler suppresses the default action
     * long enough for the release to run.
     */
    it('releases the lock when the gate is terminated part way through', async () => {
      const holder = startHolder('interrupted', 1_500);
      expect(await waitFor(() => lockHolderPid() === holder.child.pid)).toBe(true);

      holder.child.kill('SIGTERM');
      await holder.done;

      expect(existsSync(lockPath)).toBe(false);
    });

    /*
     * A gate whose claim was broken while it was still running must not delete the lock its
     * successor is holding on the way out, or breaking one stale lock lets two gates run at once.
     */
    it('leaves the lock alone when another gate has taken it over', async () => {
      const holder = startHolder('holder', 1_500);
      expect(await waitFor(() => lockHolderPid() === holder.child.pid)).toBe(true);

      const successor = `${JSON.stringify({ pid: process.pid, startedAt: Date.now(), workspace: 'somebody else' })}\n`;
      writeFileSync(lockPath, successor);
      await holder.done;

      expect(readFileSync(lockPath, 'utf8')).toBe(successor);
    });

    /*
     * A claim stamped when queueing began rather than when the lock was taken reads as minutes old
     * the instant it is written, and a long enough queue would hand out a lock that is already past
     * the ceiling — two gates again, by the very mechanism meant to prevent them.
     */
    it('dates its claim from taking the lock, not from joining the queue', async () => {
      const [first, second] = await Promise.all([startHolder('first', 700).done, startHolder('second', 10).done]);
      expect([first.code, second.code]).toEqual([0, 0]);

      const timeline = events().map((line) => ({ event: line.split(' ')[1], at: Number(line.split(' ')[2]) }));

      expect(timeline.map((entry) => entry.event)).toEqual(['enter', 'exit', 'enter', 'exit']);
      expect(timeline[2].at).toBeGreaterThanOrEqual(timeline[1].at);
    });

    /*
     * Never the reason a push cannot be verified: running unserialised is how this ran before the
     * lock existed, whereas refusing to run is a regression.
     */
    it('runs the gate anyway when the lock cannot be taken at all', async () => {
      const notADirectory = path.join(workspace, 'occupied');
      writeFileSync(notADirectory, 'a file, so no lock can be created beneath it');

      const ran = await startHolder('unserialised', 10, {
        LOCK_OPTIONS: JSON.stringify({ lockPath: path.join(notADirectory, 'gate.lock') }),
      }).done;

      expect(ran.code).toBe(0);
      expect(ran.stderr).toMatch(/without serialising/);
    });

    /*
     * Reporting happens after the claim is written but before the release traps are installed, so a
     * report that could throw would reach the fail-open path holding a lock nothing would give back
     * -- every later push blocked until the ceiling expired.
     */
    it('breaks a stale lock and gives it back even when it cannot report a word', async () => {
      writeFileSync(lockPath, `${JSON.stringify({ pid: 0x7ffffffe, startedAt: Date.now() })}\n`);

      const ran = await startHolder('mute', 10, { BREAK_STDERR: '1' }).done;

      expect(ran.code).toBe(0);
      expect(existsSync(lockPath)).toBe(false);
    });

    it('takes a lock left behind by a process that no longer exists', async () => {
      writeFileSync(
        lockPath,
        `${JSON.stringify({ pid: 0x7ffffffe, startedAt: Date.now(), workspace: 'a machine that rebooted' })}\n`
      );

      const recovered = await startHolder('recovering', 10).done;

      expect(recovered.code).toBe(0);
      expect(recovered.stderr).toMatch(/stale/);
    });

    it('takes a lock older than the ceiling even though a live process claims it', async () => {
      writeFileSync(
        lockPath,
        `${JSON.stringify({ pid: process.pid, startedAt: Date.now() - STALE_AFTER_MS - 1_000 })}\n`
      );

      const recovered = await startHolder('recovering', 10).done;

      expect(recovered.code).toBe(0);
      expect(events().map((line) => line.split(' ').slice(0, 2).join(' '))).toEqual([
        'recovering enter',
        'recovering exit',
      ]);
    });
  });

  /*
   * `just test-coverage-creative-studio` runs the same six-minute suite the push gate runs, so it
   * contends for the same cores and has to queue behind a gate rather than run beside it. It reaches
   * the lock through this entry point rather than through the selector, which only ever decides what
   * the *push* needs.
   */
  describe('running a command under the lock from the command line', () => {
    let workspace: string;
    let lockPath: string;
    let marker: string;

    beforeEach(() => {
      workspace = mkdtempSync(path.join(tmpdir(), 'push-gate-lock-'));
      lockPath = path.join(workspace, 'gate.lock');
      marker = path.join(workspace, 'the-command-ran');
    });

    afterEach(() => {
      rmSync(workspace, { recursive: true, force: true });
    });

    /** Always via --lock: a test that took the real machine lock would block the gate running it. */
    const runCli = (...args: string[]) => {
      const done = spawnSync(process.execPath, [LOCK_MODULE, '--lock', lockPath, ...args], { encoding: 'utf8' });
      return { code: done.status, stderr: done.stderr ?? '' };
    };

    const touchMarker = [process.execPath, '-e', ''];

    it('runs the command it is given', () => {
      const ran = runCli(process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ok')`);

      expect(ran.code).toBe(0);
      expect(existsSync(marker)).toBe(true);
    });

    it('gives the lock back once the command is done', () => {
      runCli(...touchMarker);

      expect(existsSync(lockPath)).toBe(false);
    });

    it("fails with the command's own status rather than its own", () => {
      const ran = runCli(process.execPath, '-e', 'process.exit(3)');

      expect(ran.code).toBe(3);
    });

    it('releases the lock when the command fails', () => {
      runCli(process.execPath, '-e', 'process.exit(3)');

      expect(existsSync(lockPath)).toBe(false);
    });

    it('refuses to run with no command at all', () => {
      const done = spawnSync(process.execPath, [LOCK_MODULE], { encoding: 'utf8' });

      expect(done.status).not.toBe(0);
      expect(done.stderr).toMatch(/usage/);
    });

    it('says so when it is pointed at a lock other than the machine default', () => {
      const ran = runCli(...touchMarker);

      expect(ran.stderr).toMatch(new RegExp(`${lockPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    });

    it('queues behind a gate that is already running instead of joining it', async () => {
      const holder = spawn(
        process.execPath,
        [LOCK_MODULE, '--lock', lockPath, process.execPath, '-e', 'setTimeout(() => {}, 1500)'],
        { stdio: ['ignore', 'ignore', 'ignore'] }
      );
      const holds = async () => {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          try {
            if (JSON.parse(readFileSync(lockPath, 'utf8')).pid === holder.pid) return true;
          } catch {
            // not written yet
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return false;
      };
      expect(await holds()).toBe(true);

      const queued = runCli(...touchMarker);

      expect(queued.code).toBe(0);
      expect(queued.stderr).toMatch(new RegExp(`waiting for another push gate[^\n]*${holder.pid}`));
    });
  });

  describe('where the lock lives and how it reads', () => {
    it('keeps the lock outside any worktree so the whole machine shares one gate', () => {
      expect(DEFAULT_LOCK_PATH).toBe(
        process.platform === 'win32' ? path.join(tmpdir(), 'weprompt-push-gate.lock') : '/tmp/weprompt-push-gate.lock'
      );
    });

    it('describes waits in units a person reads at a glance', () => {
      expect([0, 45_000, 90_000, 3_600_000].map(formatDuration)).toEqual(['0s', '45s', '1m 30s', '1h 0m']);
    });
  });
});
