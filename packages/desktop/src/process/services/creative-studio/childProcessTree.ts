/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';

type StudioChildProcessTarget = Pick<
  ChildProcess,
  'exitCode' | 'kill' | 'once' | 'pid' | 'removeListener' | 'signalCode'
>;

export type StudioChildProcessTreeTerminationOptions = {
  /** Only native children were actually created with the process-tree options supplied by this service. */
  nativeChild: boolean;
  /** Focused-test seam; production always uses the host platform. */
  platform?: NodeJS.Platform;
  /** Focused-test seam for POSIX process-group signalling. */
  killProcess?: typeof process.kill;
  /** Focused-test seam for the Windows tree-kill helper. */
  spawnTaskkill?: typeof spawn;
  /** Focused-test seam; production uses a short, finite operating-system settlement bound. */
  timeoutMs?: number;
};

const CHILD_TREE_TERMINATION_TIMEOUT_MS = 5_000;

export const studioChildProcessDetached = (platform: NodeJS.Platform = process.platform): boolean =>
  platform !== 'win32';

const validTreePid = (pid: number | undefined): pid is number =>
  Number.isSafeInteger(pid) && pid !== undefined && pid > 1;

const runWindowsTaskkill = (pid: number, spawnTaskkill: typeof spawn, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    let helper: ChildProcess;
    try {
      helper = spawnTaskkill('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (success: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      helper.removeListener('error', onError);
      helper.removeListener('close', onClose);
      resolve(success);
    };
    const onError = (): void => finish(false);
    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => finish(code === 0 && signal === null);
    helper.once('error', onError);
    helper.once('close', onClose);
    const timer = setTimeout(() => {
      const swallowLateError = (): void => undefined;
      helper.on('error', swallowLateError);
      helper.once('close', () => helper.removeListener('error', swallowLateError));
      try {
        helper.kill('SIGKILL');
      } catch {
        // The helper may have exited between the deadline and the kill attempt.
      }
      finish(false);
    }, timeoutMs);
    timer.unref?.();
  });

const waitForRootClose = (child: StudioChildProcessTarget, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    const onClose = (): void => {
      clearTimeout(timer);
      child.removeListener('close', onClose);
      resolve(true);
    };
    child.once('close', onClose);
    const timer = setTimeout(() => {
      child.removeListener('close', onClose);
      resolve(false);
    }, timeoutMs);
    timer.unref?.();
  });

/**
 * Stops the complete native child tree. Windows tree termination is asynchronous, so callers must
 * await this operation before releasing inherited descriptors or settling their public operation.
 */
export const terminateStudioChildProcessTree = async (
  child: StudioChildProcessTarget,
  options: StudioChildProcessTreeTerminationOptions
): Promise<void> => {
  const timeoutMs =
    Number.isSafeInteger(options.timeoutMs) && (options.timeoutMs as number) > 0
      ? (options.timeoutMs as number)
      : CHILD_TREE_TERMINATION_TIMEOUT_MS;
  if (child.exitCode !== null || child.signalCode !== null) return;
  // Install this listener before signalling: taskkill may reap the root before its own helper exits.
  const rootClosed = waitForRootClose(child, timeoutMs);
  const platform = options.platform ?? process.platform;
  const pid = child.pid;
  if (options.nativeChild && validTreePid(pid)) {
    if (platform === 'win32') {
      const stopped = await runWindowsTaskkill(pid, options.spawnTaskkill ?? spawn, timeoutMs);
      if (stopped && (await rootClosed)) return;
    } else {
      try {
        (options.killProcess ?? process.kill)(-pid, 'SIGKILL');
        if (await rootClosed) return;
      } catch {
        // Fall through to the root process when the detached group no longer exists.
      }
    }
  }

  try {
    child.kill('SIGKILL');
  } catch {
    // A concurrently exited root needs no further fallback.
  }
  if (!(await waitForRootClose(child, timeoutMs))) {
    throw new Error('Creative Studio child process did not settle after forced termination');
  }
};
