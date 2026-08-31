/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import type { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  studioChildProcessDetached,
  terminateStudioChildProcessTree,
} from '@process/services/creative-studio/childProcessTree';

const targetProcess = (pid: number | undefined = 42): ChildProcess => {
  const target = new EventEmitter() as ChildProcess;
  Object.assign(target, {
    pid,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => {
      queueMicrotask(() => target.emit('close', null, 'SIGKILL'));
      return true;
    }),
  });
  return target;
};

const helperProcess = (): ChildProcess =>
  Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => true),
  }) as unknown as ChildProcess;

describe('Creative Studio child process trees', () => {
  it('detaches native POSIX children but keeps Windows children attached', () => {
    expect(studioChildProcessDetached('darwin')).toBe(true);
    expect(studioChildProcessDetached('linux')).toBe(true);
    expect(studioChildProcessDetached('win32')).toBe(false);
  });

  it('signals the complete POSIX process group and falls back to the root when that group is gone', async () => {
    const grouped = targetProcess(42);
    const killGroup = vi.fn(() => true) as unknown as typeof process.kill;
    let completed = false;
    const groupedTermination = terminateStudioChildProcessTree(grouped, {
      nativeChild: true,
      platform: 'linux',
      killProcess: killGroup,
    }).then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(killGroup).toHaveBeenCalledWith(-42, 'SIGKILL');
    expect(grouped.kill).not.toHaveBeenCalled();
    expect(completed).toBe(false);
    grouped.emit('close', null, 'SIGKILL');
    await groupedTermination;
    expect(completed).toBe(true);

    const fallenBack = targetProcess(43);
    const missingGroup = vi.fn(() => {
      throw new Error('ESRCH');
    }) as unknown as typeof process.kill;
    await terminateStudioChildProcessTree(fallenBack, {
      nativeChild: true,
      platform: 'darwin',
      killProcess: missingGroup,
    });
    expect(fallenBack.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('awaits Windows taskkill with the exact recursive force arguments before returning', async () => {
    const target = targetProcess(77);
    const helper = helperProcess();
    const spawnTaskkill = vi.fn(() => helper) as unknown as typeof spawn;
    let completed = false;
    const termination = terminateStudioChildProcessTree(target, {
      nativeChild: true,
      platform: 'win32',
      spawnTaskkill,
    }).then(() => {
      completed = true;
    });

    await Promise.resolve();
    expect(completed).toBe(false);
    expect(spawnTaskkill).toHaveBeenCalledWith('taskkill', ['/PID', '77', '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    helper.emit('close', 0, null);
    await Promise.resolve();
    expect(completed).toBe(false);
    target.emit('close', null, 'SIGKILL');
    await termination;
    expect(completed).toBe(true);
    expect(target.kill).not.toHaveBeenCalled();
  });

  it('falls back to the Windows root after taskkill fails to start or exits unsuccessfully', async () => {
    const failed = targetProcess(78);
    const failedHelper = helperProcess();
    const failedSpawn = vi.fn(() => {
      queueMicrotask(() => failedHelper.emit('close', 1, null));
      return failedHelper;
    }) as unknown as typeof spawn;
    await terminateStudioChildProcessTree(failed, {
      nativeChild: true,
      platform: 'win32',
      spawnTaskkill: failedSpawn,
    });
    expect(failed.kill).toHaveBeenCalledWith('SIGKILL');

    const unavailable = targetProcess(79);
    const unavailableSpawn = vi.fn(() => {
      throw new Error('ENOENT');
    }) as unknown as typeof spawn;
    await terminateStudioChildProcessTree(unavailable, {
      nativeChild: true,
      platform: 'win32',
      spawnTaskkill: unavailableSpawn,
    });
    expect(unavailable.kill).toHaveBeenCalledWith('SIGKILL');

    const errored = targetProcess(81);
    const erroredHelper = helperProcess();
    const erroredSpawn = vi.fn(() => {
      queueMicrotask(() => erroredHelper.emit('error', new Error('taskkill failed')));
      return erroredHelper;
    }) as unknown as typeof spawn;
    await terminateStudioChildProcessTree(errored, {
      nativeChild: true,
      platform: 'win32',
      spawnTaskkill: erroredSpawn,
    });
    expect(errored.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('uses a bounded root fallback for injected children, unsafe pids, and concurrent exits', async () => {
    const injected = targetProcess(80);
    const killGroup = vi.fn(() => true) as unknown as typeof process.kill;
    await terminateStudioChildProcessTree(injected, {
      nativeChild: false,
      platform: 'linux',
      killProcess: killGroup,
    });
    expect(killGroup).not.toHaveBeenCalled();
    expect(injected.kill).toHaveBeenCalledWith('SIGKILL');

    const unsafe = targetProcess(1);
    await terminateStudioChildProcessTree(unsafe, { nativeChild: true, platform: 'linux', killProcess: killGroup });
    expect(unsafe.kill).toHaveBeenCalledWith('SIGKILL');

    const exited = targetProcess(0);
    exited.signalCode = 'SIGKILL';
    exited.kill = vi.fn(() => true);
    await expect(
      terminateStudioChildProcessTree(exited, { nativeChild: true, platform: 'linux', killProcess: killGroup })
    ).resolves.toBeUndefined();
    expect(exited.kill).not.toHaveBeenCalled();
  });

  it('bounds a hung Windows helper and a root that never reports close', async () => {
    vi.useFakeTimers();
    try {
      const target = targetProcess(82);
      const helper = helperProcess();
      const spawnTaskkill = vi.fn(() => helper) as unknown as typeof spawn;
      const recovered = terminateStudioChildProcessTree(target, {
        nativeChild: true,
        platform: 'win32',
        spawnTaskkill,
        timeoutMs: 10,
      });
      await vi.advanceTimersByTimeAsync(10);
      await recovered;
      expect(helper.kill).toHaveBeenCalledWith('SIGKILL');
      expect(target.kill).toHaveBeenCalledWith('SIGKILL');
      expect(() => helper.emit('error', new Error('late taskkill error'))).not.toThrow();
      helper.emit('close', null, 'SIGKILL');

      const stubborn = targetProcess(83);
      stubborn.kill = vi.fn(() => true);
      const rejected = expect(
        terminateStudioChildProcessTree(stubborn, {
          nativeChild: false,
          platform: 'win32',
          timeoutMs: 10,
        })
      ).rejects.toThrow('did not settle');
      await vi.advanceTimersByTimeAsync(10);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
