/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Serialises the local pre-push test gate so two agents queue instead of overlapping.
 *
 * The gate runs the whole suite under coverage instrumentation, which saturates the machine on its
 * own. Two of them at once inflate individual test durations by one to two orders of magnitude and
 * manufacture failures that pass in isolation seconds later — measured on 2026-08-30 against an
 * unchanged commit, where two overlapping runs failed on *different* files and a third run, alone,
 * went green. Every one of those costs a full re-run of a six-minute gate.
 *
 * The lock therefore lives outside any worktree: the contention is for one machine's cores, and the
 * same gate is run from several checkouts against them.
 *
 * Three things this must never do, in descending order of how badly they would hurt:
 *
 *   1. **Wedge.** A gate killed with Ctrl+C, or a machine that rebooted mid-run, must not block
 *      every later push. The recorded process id is checked for liveness, but that check has lied
 *      here before — an orphan reparented to init keeps reporting as alive while doing nothing — so
 *      a claim older than a generous ceiling is broken regardless of what liveness says.
 *   2. **Fail.** A queued push waits and then runs. It never aborts because someone else got there
 *      first, and if the lock itself cannot be taken the gate runs unserialised rather than not at
 *      all — that is exactly the behaviour that preceded this file.
 *   3. **Go quiet.** Six silent minutes is indistinguishable from a hang, so the wait says who it
 *      is waiting for and keeps saying it.
 *
 * The critical section blocks on a child process, which blocks this process's event loop, so a held
 * lock cannot be refreshed while it is held. That is why the ceiling is a fixed multiple of the
 * gate's runtime rather than a heartbeat — keep it far above how long the gate can honestly take.
 */

const { spawnSync } = require('node:child_process');
const { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Machine-wide on purpose: several worktrees, one set of cores. */
const DEFAULT_LOCK_PATH =
  process.platform === 'win32' ? path.join(os.tmpdir(), 'weprompt-push-gate.lock') : '/tmp/weprompt-push-gate.lock';

/** Roughly five times the gate's measured runtime. Past this a claim is abandoned, whatever it says. */
const STALE_AFTER_MS = 30 * 60 * 1000;

/** How long a claim may stay unparseable before it counts as corrupt rather than mid-write. */
const UNREADABLE_GRACE_MS = 30 * 1000;

const POLL_MS = 2_000;
const REPORT_EVERY_MS = 15_000;
const TRAPPED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

const formatDuration = (ms) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

/*
 * Never throws. Between writing the claim and installing the release traps there is one call out of
 * this file, and it is this one -- a write to a closed stderr propagating from there would reach the
 * fail-open path with the lock already taken and nothing left to release it. Losing a progress line
 * is the cheapest possible outcome; wedging every later push is the most expensive one.
 */
const report = (message) => {
  try {
    process.stderr.write(`pre-push: ${message}\n`);
  } catch {
    // A gate that cannot narrate itself still has to release its lock.
  }
};

/** Synchronous by necessity: everything around it, the gate included, blocks. */
const sleepSync = (ms) => {
  if (!(ms > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const processIsAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Someone else's process: alive, just not ours to signal.
    return error.code === 'EPERM';
  }
};

/**
 * The process's own start time, which closes the hole liveness alone leaves: a claim whose owner
 * died and whose id has since been handed to something unrelated reads as perfectly alive. Absent
 * wherever `ps` is not (Windows), and the check is simply skipped there.
 */
const processStartFingerprint = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const probe = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0 || typeof probe.stdout !== 'string') return null;
  return probe.stdout.trim() || null;
};

const inspectLock = (lockPath, now = Date.now()) => {
  let raw;
  let stats;
  try {
    raw = readFileSync(lockPath, 'utf8');
    stats = statSync(lockPath);
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, holder: null, ageMs: 0 };
    throw error;
  }

  let holder = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Number.isInteger(parsed.pid)) holder = parsed;
  } catch {
    // Caught mid-write, or corrupt. Which one is a question of age, answered by `stalenessOf`.
  }

  const claimedAt = holder && Number.isFinite(holder.startedAt) ? holder.startedAt : stats.mtimeMs;
  return { exists: true, raw, holder, ageMs: Math.max(0, now - claimedAt) };
};

/** Returns why the lock may be taken from its holder, or null to keep waiting. */
const stalenessOf = (inspection, options = {}) => {
  const {
    staleAfterMs = STALE_AFTER_MS,
    unreadableGraceMs = UNREADABLE_GRACE_MS,
    isAlive = processIsAlive,
    startFingerprint = processStartFingerprint,
  } = options;

  if (!inspection.exists) return null;

  // Checked first and independently of liveness, because liveness is the check that lies.
  if (inspection.ageMs > staleAfterMs) {
    return `it has held the gate for ${formatDuration(inspection.ageMs)}, past the ${formatDuration(
      staleAfterMs
    )} ceiling`;
  }

  if (!inspection.holder) {
    return inspection.ageMs > unreadableGraceMs ? 'its claim has stayed unreadable' : null;
  }

  const { pid } = inspection.holder;
  if (!isAlive(pid)) return `process ${pid} is gone`;

  const recorded = inspection.holder.startFingerprint;
  const current = startFingerprint(pid);
  if (recorded && current && recorded !== current) return `process ${pid} has been reused by something else`;
  return null;
};

const describeClaim = ({ holder, ageMs }) => {
  if (!holder) return `an unreadable claim written ${formatDuration(ageMs)} ago`;
  const where = holder.workspace ? ` in ${holder.workspace}` : '';
  return `pid ${holder.pid}${where}, started ${formatDuration(ageMs)} ago`;
};

/**
 * Deletes a stale lock only while it still holds what was judged stale. Two waiters can decide to
 * break the same lock at the same moment; the exclusive create below is the real mutex, so the
 * loser of that race simply goes back to waiting.
 */
const breakLock = (lockPath, expectedRaw) => {
  try {
    if (readFileSync(lockPath, 'utf8') !== expectedRaw) return;
    unlinkSync(lockPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

const acquire = (settings) => {
  const { lockPath, pollMs, reportEveryMs, sleep } = settings;
  const workspace = path.basename(process.cwd());
  const fingerprint = processStartFingerprint(process.pid);
  const waitingSince = Date.now();
  let announced = false;
  let lastReportAt = 0;
  let madeParent = false;

  for (;;) {
    // Stamped per attempt, never once up front: a claim carrying the moment we started *waiting*
    // would read as minutes old the instant we took it, and could age past the ceiling on arrival.
    const startedAt = Date.now();
    const claim = {
      pid: process.pid,
      startedAt,
      startedAtIso: new Date(startedAt).toISOString(),
      workspace,
      startFingerprint: fingerprint,
    };

    try {
      const handle = openSync(lockPath, 'wx');
      try {
        writeFileSync(handle, `${JSON.stringify(claim)}\n`);
      } finally {
        closeSync(handle);
      }
      if (announced) report(`the gate is free after ${formatDuration(Date.now() - waitingSince)} — starting now`);
      return claim;
    } catch (error) {
      if (error.code === 'ENOENT' && !madeParent) {
        madeParent = true;
        mkdirSync(path.dirname(lockPath), { recursive: true });
        continue;
      }
      if (error.code !== 'EEXIST') throw error;
    }

    const inspection = inspectLock(lockPath);
    if (!inspection.exists) continue;

    const stale = stalenessOf(inspection, settings);
    if (stale) {
      report(`clearing a stale lock — ${stale} (${describeClaim(inspection)})`);
      breakLock(lockPath, inspection.raw);
      continue;
    }

    const now = Date.now();
    if (!announced) {
      report(`waiting for another push gate (${describeClaim(inspection)})`);
      announced = true;
      lastReportAt = now;
    } else if (now - lastReportAt >= reportEveryMs) {
      report(`still waiting after ${formatDuration(now - waitingSince)} (${describeClaim(inspection)})`);
      lastReportAt = now;
    }

    sleep(pollMs);
  }
};

/** Never deletes a claim that is no longer ours — that is how a running gate loses its lock. */
const releaseClaim = (lockPath, claim) => {
  try {
    const holder = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (holder.pid !== claim.pid || holder.startedAt !== claim.startedAt) return;
    unlinkSync(lockPath);
  } catch {
    // Already gone, corrupt, or somebody else's now. Guessing here is worse than leaving it: the
    // age ceiling clears anything genuinely abandoned.
  }
};

/**
 * A terminate that reaches this process while the gate is blocked would otherwise kill it outright
 * and orphan the claim. Holding a listener suppresses the default action until the release below
 * has run.
 */
const trapExits = (release) => {
  const onExit = () => release();
  const handlers = new Map();

  function detach() {
    process.off('exit', onExit);
    for (const [signal, handler] of handlers) process.off(signal, handler);
    handlers.clear();
  }

  process.on('exit', onExit);
  for (const signal of TRAPPED_SIGNALS) {
    const handler = () => {
      release();
      detach();
      process.kill(process.pid, signal);
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  return detach;
};

/** Runs `run` with the machine's push gate held. `run` must be synchronous, as the gate itself is. */
const withPushGateLock = (options, run) => {
  const settings = {
    lockPath: DEFAULT_LOCK_PATH,
    pollMs: POLL_MS,
    reportEveryMs: REPORT_EVERY_MS,
    sleep: sleepSync,
    ...options,
  };

  let claim;
  try {
    claim = acquire(settings);
  } catch (error) {
    // Refusing to verify a push because the lock misbehaved would be worse than the contention it
    // exists to prevent, which is simply how this ran before.
    report(`could not take the lock (${error.message}) — running without serialising`);
    return run();
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseClaim(settings.lockPath, claim);
  };
  const detach = trapExits(release);

  try {
    const result = run();
    if (result && typeof result.then === 'function') {
      throw new TypeError('withPushGateLock is synchronous; its callback must not return a promise');
    }
    return result;
  } finally {
    detach();
    release();
  }
};

module.exports = {
  DEFAULT_LOCK_PATH,
  STALE_AFTER_MS,
  UNREADABLE_GRACE_MS,
  breakLock,
  formatDuration,
  inspectLock,
  stalenessOf,
  withPushGateLock,
};
