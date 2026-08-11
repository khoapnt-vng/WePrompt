/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmod, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { PRESENTATION_RUN_LIMITS } from '@/common/config/constants';
import { parseOfficeCliEnvelope } from '@/process/services/office-artifact/officeCliJson';
import {
  createOfficeCliRunner,
  resolveOfficeCliBinary,
  type OfficeCliExecFile,
  type OfficeCliProcessTreeSpawn,
  type OfficeCliSpawn,
  type OfficeCliWatchProcess,
} from '@/process/services/office-artifact/officeCliRunner';

import docxTextFixture from './fixtures/officecli-docx-text.json';
import pptxTextFixture from './fixtures/officecli-pptx-text.json';

function execFileWithStdout(stdout: string): OfficeCliExecFile {
  return (_file, _args, _options, callback) => callback(null, stdout, '');
}

function padToUtf8Bytes(output: string, byteLength: number): string {
  return `${output}${' '.repeat(byteLength - Buffer.byteLength(output, 'utf8'))}`;
}

type TestWatchProcess = OfficeCliWatchProcess & {
  emit: EventEmitter['emit'];
  stdout: PassThrough;
  stderr: PassThrough;
};

function createWatchProcess(): TestWatchProcess {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  return Object.assign(emitter, {
    stdout,
    stderr,
    kill: vi.fn(() => {
      queueMicrotask(() => emitter.emit('exit', 0, null));
      return true;
    }),
  });
}

function spawnWithResult(stdout: string, code: number | null, signal: NodeJS.Signals | null = null): OfficeCliSpawn {
  return () => {
    const child = createWatchProcess();
    queueMicrotask(() => {
      child.stdout.end(stdout);
      child.emit('close', code, signal);
    });
    return child;
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readProcessId(filePath: string, attempts = 500): Promise<number> {
  try {
    return Number(await readFile(filePath, 'utf8'));
  } catch {
    if (attempts <= 1) return 0;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return readProcessId(filePath, attempts - 1);
  }
}

async function captureCompletedWindowsReaperInvocation(pid = 99_999): Promise<Parameters<OfficeCliProcessTreeSpawn>> {
  const renderProcess = Object.assign(createWatchProcess(), { pid });
  let invocation: Parameters<OfficeCliProcessTreeSpawn> | undefined;
  const processTreeSpawn: OfficeCliProcessTreeSpawn = (file, args, options) => {
    invocation = [file, args, options];
    return Object.assign(createWatchProcess(), { exitCode: 0 });
  };
  const runner = createOfficeCliRunner({
    binaryPath: 'C:\\officecli.exe',
    platform: 'win32',
    processTreeSpawn,
    spawn: () => {
      queueMicrotask(() => {
        Object.assign(renderProcess, { exitCode: 0 });
        renderProcess.stdout.write(JSON.stringify({ success: true, data: {} }));
        renderProcess.emit('close', 0, null);
      });
      return renderProcess;
    },
  });

  await runner.renderSlide('C:\\inspection\\candidate.pptx', 1, 'C:\\render\\slide-1.png');
  if (!invocation) throw new Error('Expected the Windows render reaper to start');
  return invocation;
}

function runPowerShell(command: string): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout: Buffer.concat(stdoutChunks).toString('utf8') }));
  });
}

function readBoundPowerShellTargetPid(args: string[]): number {
  const commandIndex = args.indexOf('-Command');
  const command = commandIndex >= 0 ? args[commandIndex + 1] : undefined;
  const match = /^\[uint32\]\$targetProcessId = ([1-9]\d*)$/m.exec(command ?? '');
  if (!match) throw new Error('Expected an explicitly bound PowerShell target PID');
  return Number(match[1]);
}

describe('createOfficeCliRunner', () => {
  it('invokes an allowlisted command without a shell', async () => {
    const execFile = vi.fn<OfficeCliExecFile>((_file, _args, options, callback) => {
      expect(options).toMatchObject({ shell: false, windowsHide: true });
      callback(null, JSON.stringify({ success: true, data: { matches: 0, results: [] } }), '');
    });
    const runner = createOfficeCliRunner({ binaryPath: '/opt/officecli', execFile });

    await runner.get('/workspace/a.docx', '/body/p[1]');

    expect(execFile).toHaveBeenCalledWith(
      '/opt/officecli',
      ['get', '/workspace/a.docx', '/body/p[1]', '--json'],
      expect.objectContaining({ shell: false }),
      expect.any(Function)
    );
  });

  it('builds fixed argument shapes for each supported mutation', async () => {
    const execFile = vi.fn<OfficeCliExecFile>((_file, _args, _options, callback) => {
      callback(null, JSON.stringify({ success: true, data: {}, matched: 1 }), '');
    });
    const runner = createOfficeCliRunner({ binaryPath: '/opt/officecli', execFile });

    await expect(runner.replaceText('/workspace/a.docx', '/body/p[1]', 'old', 'new')).resolves.toEqual({ matched: 1 });
    await runner.formatRange('/workspace/a.docx', '/body/p[1]', 2, 4, 'underline', false);
    await runner.setCell('/workspace/a.xlsx', '/sheets/1/cells/A1', '=SUM(B1:B2)');
    await runner.validate('/workspace/a.docx');
    await runner.close('/workspace/a.docx');

    expect(execFile.mock.calls.map(([, args]) => args)).toEqual([
      ['set', '/workspace/a.docx', '/body/p[1]', '--find', 'old', '--replace', 'new', '--json'],
      ['set', '/workspace/a.docx', '/body/p[1]', '--prop', 'range=2:4', '--prop', 'underline=none', '--json'],
      ['set', '/workspace/a.xlsx', '/sheets/1/cells/A1', '--prop', 'formula=SUM(B1:B2)', '--json'],
      ['validate', '/workspace/a.docx', '--json'],
      ['close', '/workspace/a.docx', '--json'],
    ]);
  });

  it('invokes bounded text inspection without a shell', async () => {
    const execFile = vi.fn<OfficeCliExecFile>(execFileWithStdout(JSON.stringify(pptxTextFixture)));
    const runner = createOfficeCliRunner({ binaryPath: '/opt/officecli', execFile });

    await runner.viewText('/workspace/business-review.pptx', 'pptx');

    expect(execFile).toHaveBeenCalledWith(
      '/opt/officecli',
      ['view', '/workspace/business-review.pptx', 'text', '--json'],
      {
        shell: false,
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: PRESENTATION_RUN_LIMITS.MAX_OFFICECLI_STDOUT_BYTES,
      },
      expect.any(Function)
    );
  });

  it('renders one slide to an app-owned output with a bounded shell-free command', async () => {
    const spawn = vi.fn<OfficeCliSpawn>(
      spawnWithResult(JSON.stringify({ success: true, data: { output: '/private/render/slide-4.png' } }), 0)
    );
    const runner = createOfficeCliRunner({ binaryPath: '/opt/officecli', spawn });

    await expect(
      runner.renderSlide('/private/inspection/candidate.pptx', 4, '/private/render/slide-4.png')
    ).resolves.toBeUndefined();

    expect(spawn).toHaveBeenCalledWith(
      '/opt/officecli',
      [
        'view',
        '/private/inspection/candidate.pptx',
        'screenshot',
        '--page',
        '4',
        '-o',
        '/private/render/slide-4.png',
        '--json',
      ],
      {
        detached: process.platform !== 'win32',
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
  });

  it('preserves a redacted render-timeout signal for readiness policy', async () => {
    const runner = createOfficeCliRunner({
      binaryPath: '/opt/officecli',
      spawn: spawnWithResult('', null, 'SIGTERM'),
    });

    await expect(
      runner.renderSlide('/private/inspection/candidate.pptx', 1, '/private/render/slide-1.png')
    ).rejects.toMatchObject({ code: 'ETIMEDOUT', message: 'ETIMEDOUT' });
  });

  it('binds the completed Windows render PID and state inside one PowerShell command', async () => {
    const invocation = await captureCompletedWindowsReaperInvocation();

    expect(invocation).toEqual([
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        expect.stringContaining('[uint32]$targetProcessId = 99999\n[bool]$rootAlreadyEnded = $true'),
      ],
      { stdio: 'ignore', windowsHide: true },
    ]);
    expect(invocation[1][4]).not.toContain('$args');
  });

  it('keys completed Windows render cleanup by creation identity before seeding or stopping a PID', async () => {
    const [, args] = await captureCompletedWindowsReaperInvocation();
    const command = args[4] ?? '';

    expect(command).toContain('Select-Object ProcessId, ParentProcessId, CreationDate');
    expect(command).toContain(
      'return (\n    $null -ne $creationTicks -and\n    $knownCreationTicks.ContainsKey($processId) -and\n    $knownCreationTicks[$processId] -eq [long]$creationTicks\n  )'
    );
    expect(command).toContain(
      '$null -eq $rootProcess -or\n            ($null -ne $rootCreationTicks -and $processCreationTicks -lt $rootCreationTicks)'
    );
    expect(command).toContain(
      'Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $processId" | Select-Object ProcessId, ParentProcessId, CreationDate -First 1\n      if ($null -ne $currentProcess -and (Test-KnownProcessIdentity $currentProcess)) {\n        try {\n          $stoppedProcess = Stop-Process'
    );
  });

  it('rejects completed-root seed candidates created before the current render began', async () => {
    const renderStartedAt = Date.parse('2026-08-06T00:00:05.000Z');
    const now = vi.spyOn(Date, 'now').mockReturnValue(renderStartedAt);
    try {
      const [, args] = await captureCompletedWindowsReaperInvocation();
      const command = args[4] ?? '';

      expect(command).toContain(`[long]$treeCreationFloorUnixMilliseconds = ${renderStartedAt}`);
      expect(command).toContain('$creationTicks -lt $treeCreationFloorTicks');
    } finally {
      now.mockRestore();
    }
  });

  it('retains a stopped parent exit cutoff for descendants first observed after the parent disappears', async () => {
    const [, args] = await captureCompletedWindowsReaperInvocation();
    const command = args[4] ?? '';

    expect(command).toContain(
      '$null -eq $parentProcess -and\n        $null -ne $processCreationTicks -and\n        $knownStopCutoffTicks.ContainsKey($parentProcessId) -and\n        $processCreationTicks -le $knownStopCutoffTicks[$parentProcessId]'
    );
    expect(command).toContain(
      '$stoppedProcess = Stop-Process -Id ([int]$processId) -Force -PassThru -ErrorAction Stop\n          $stoppedProcess | Wait-Process -ErrorAction Stop\n          $knownStopCutoffTicks[$processId] = $stoppedProcess.ExitTime.ToUniversalTime().Ticks'
    );
  });

  it('keeps empty-pass success disabled for a descendant whose absent parent has no stop cutoff', async () => {
    const [, args] = await captureCompletedWindowsReaperInvocation();
    const command = args[4] ?? '';

    expect(command).toContain(
      '$parentExitUnconfirmed = (\n        $null -eq $parentProcess -and\n        $null -ne $processCreationTicks -and\n        $processCreationTicks -ge $treeCreationFloorTicks -and\n        $knownCreationTicks.ContainsKey($parentProcessId) -and\n        -not $knownStopCutoffTicks.ContainsKey($parentProcessId)\n      )\n      if ($parentExitUnconfirmed) { $scanAmbiguous = $true }'
    );
    expect(command).toContain(
      'if ($liveProcesses.Count -eq 0) {\n    if ($scanAmbiguous) {\n      $emptyPasses = 0\n    } else {\n      $emptyPasses += 1'
    );
  });

  it('requires a discovered child to be at least as new as its exact known parent generation', async () => {
    const [, args] = await captureCompletedWindowsReaperInvocation();
    const command = args[4] ?? '';

    expect(command).toContain(
      '$childMatchesKnownParentGeneration = (\n        $null -ne $processCreationTicks -and\n        $processCreationTicks -ge $treeCreationFloorTicks -and\n        $knownCreationTicks.ContainsKey($parentProcessId) -and\n        $processCreationTicks -ge $knownCreationTicks[$parentProcessId]\n      )\n      if (-not $childMatchesKnownParentGeneration) { continue }\n      $parentMatchesKnownIdentity = ('
    );
  });

  it.runIf(process.platform === 'win32')(
    'does not stop a reused descendant PID or the unrelated tree of a reused completed root PID',
    async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-06T00:00:05.000Z'));
      const [, args] = await captureCompletedWindowsReaperInvocation().finally(() => now.mockRestore());
      const command = args[4] ?? '';
      const harness = String.raw`
$script:fullScan = 0
$script:stopped = [System.Collections.Generic.HashSet[uint32]]::new()
function Get-CimInstance {
  param([string]$ClassName, [string]$Filter)
  if ($Filter) {
    if ($Filter -eq 'ProcessId = 400') {
      return [pscustomobject]@{
        ProcessId = 400
        ParentProcessId = 99999
        CreationDate = [datetime]'2026-08-06T00:00:01Z'
      }
    }
    if ($Filter -eq 'ProcessId = 500') {
      if ($script:stopped.Contains(500)) { return $null }
      return [pscustomobject]@{
        ProcessId = 500
        ParentProcessId = 99999
        CreationDate = [datetime]'2026-08-06T00:00:12Z'
      }
    }
    return [pscustomobject]@{
      ProcessId = 300
      ParentProcessId = 99999
      CreationDate = [datetime]'2026-08-06T00:00:40Z'
    }
  }
  $script:fullScan += 1
  return @(
    [pscustomobject]@{
      ProcessId = 99999
      ParentProcessId = 1
      CreationDate = [datetime]'2026-08-06T00:00:20Z'
    },
    [pscustomobject]@{
      ProcessId = 200
      ParentProcessId = 99999
      CreationDate = [datetime]'2026-08-06T00:00:30Z'
    },
    [pscustomobject]@{
      ProcessId = 300
      ParentProcessId = 99999
      CreationDate = $(if ($script:fullScan -eq 1) {
        [datetime]'2026-08-06T00:00:10Z'
      } else {
        [datetime]'2026-08-06T00:00:40Z'
      })
    },
    [pscustomobject]@{
      ProcessId = 400
      ParentProcessId = 99999
      CreationDate = [datetime]'2026-08-06T00:00:01Z'
    },
    [pscustomobject]@{
      ProcessId = 500
      ParentProcessId = 99999
      CreationDate = [datetime]'2026-08-06T00:00:12Z'
    }
  ) | Where-Object { -not $script:stopped.Contains([uint32]$_.ProcessId) }
}
function Stop-Process {
  param([int]$Id, [switch]$Force, [switch]$PassThru, [object]$ErrorAction)
  [Console]::Out.Write([string]$Id)
  [void]$script:stopped.Add([uint32]$Id)
  return [pscustomobject]@{
    Id = $Id
    ExitTime = [datetime]'2026-08-06T00:00:15Z'
  }
}
function Wait-Process {
  param([Parameter(ValueFromPipeline = $true)]$InputObject, [object]$ErrorAction)
  process {}
}
function Start-Sleep { param([int]$Milliseconds) }
$args = @('99999', '1')
${command}
`;

      await expect(runPowerShell(harness)).resolves.toEqual({ code: 0, stdout: '500' });
    }
  );

  it.runIf(process.platform === 'win32')(
    'does not stop a child older than its exact known parent generation',
    async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-06T00:00:05.000Z'));
      const [, args] = await captureCompletedWindowsReaperInvocation().finally(() => now.mockRestore());
      const command = args[4] ?? '';
      const harness = String.raw`
$script:stopped = [System.Collections.Generic.HashSet[uint32]]::new()
function Get-CimInstance {
  param([string]$ClassName, [string]$Filter)
  if ($Filter) {
    [uint32]$processId = [uint32]($Filter -replace '[^0-9]', '')
    if ($script:stopped.Contains($processId)) { return $null }
    return [pscustomobject]@{
      ProcessId = $processId
      ParentProcessId = $(if ($processId -eq 600) { 99999 } else { 600 })
      CreationDate = $(switch ($processId) {
        600 { [datetime]'2026-08-06T00:00:20Z' }
        700 { [datetime]'2026-08-06T00:00:10Z' }
        800 { [datetime]'2026-08-06T00:00:30Z' }
      })
    }
  }
  return @(
    [pscustomobject]@{
      ProcessId = 600
      ParentProcessId = 99999
      CreationDate = [datetime]'2026-08-06T00:00:20Z'
    },
    [pscustomobject]@{
      ProcessId = 700
      ParentProcessId = 600
      CreationDate = [datetime]'2026-08-06T00:00:10Z'
    },
    [pscustomobject]@{
      ProcessId = 800
      ParentProcessId = 600
      CreationDate = [datetime]'2026-08-06T00:00:30Z'
    }
  ) | Where-Object { -not $script:stopped.Contains([uint32]$_.ProcessId) }
}
function Stop-Process {
  param([int]$Id, [switch]$Force, [switch]$PassThru, [object]$ErrorAction)
  [Console]::Out.Write([string]$Id)
  [void]$script:stopped.Add([uint32]$Id)
  return [pscustomobject]@{
    Id = $Id
    ExitTime = [datetime]'2026-08-06T00:00:40Z'
  }
}
function Wait-Process {
  param([Parameter(ValueFromPipeline = $true)]$InputObject, [object]$ErrorAction)
  process {}
}
function Start-Sleep { param([int]$Milliseconds) }
${command}
`;

      await expect(runPowerShell(harness)).resolves.toEqual({ code: 0, stdout: '600800' });
    }
  );

  it.runIf(process.platform === 'win32')(
    'stops a child first observed after its parent exits but rejects a child newer than that exit',
    async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-06T00:00:05.000Z'));
      const [, args] = await captureCompletedWindowsReaperInvocation().finally(() => now.mockRestore());
      const command = args[4] ?? '';
      const harness = String.raw`
$script:fullScan = 0
$script:stopped = [System.Collections.Generic.HashSet[uint32]]::new()
function Get-CimInstance {
  param([string]$ClassName, [string]$Filter)
  if ($Filter) {
    [uint32]$processId = [uint32]($Filter -replace '[^0-9]', '')
    if ($script:stopped.Contains($processId)) { return $null }
    return [pscustomobject]@{
      ProcessId = $processId
      ParentProcessId = $(if ($processId -eq 600) { 99999 } else { 600 })
      CreationDate = $(switch ($processId) {
        600 { [datetime]'2026-08-06T00:00:10Z' }
        700 { [datetime]'2026-08-06T00:00:20Z' }
        800 { [datetime]'2026-08-06T00:00:40Z' }
      })
    }
  }
  $script:fullScan += 1
  if ($script:fullScan -eq 1) {
    return [pscustomobject]@{
      ProcessId = 600
      ParentProcessId = 99999
      CreationDate = [datetime]'2026-08-06T00:00:10Z'
    }
  }
  return @(
    [pscustomobject]@{
      ProcessId = 700
      ParentProcessId = 600
      CreationDate = [datetime]'2026-08-06T00:00:20Z'
    },
    [pscustomobject]@{
      ProcessId = 800
      ParentProcessId = 600
      CreationDate = [datetime]'2026-08-06T00:00:40Z'
    }
  ) | Where-Object { -not $script:stopped.Contains([uint32]$_.ProcessId) }
}
function Stop-Process {
  param([int]$Id, [switch]$Force, [switch]$PassThru, [object]$ErrorAction)
  [Console]::Out.Write([string]$Id)
  [void]$script:stopped.Add([uint32]$Id)
  return [pscustomobject]@{
    Id = $Id
    ExitTime = $(if ($Id -eq 600) {
      [datetime]'2026-08-06T00:00:30Z'
    } else {
      [datetime]'2026-08-06T00:00:50Z'
    })
  }
}
function Wait-Process {
  param([Parameter(ValueFromPipeline = $true)]$InputObject, [object]$ErrorAction)
  process {}
}
function Start-Sleep { param([int]$Milliseconds) }
${command}
`;

      await expect(runPowerShell(harness)).resolves.toEqual({ code: 0, stdout: '600700' });
    }
  );

  it.runIf(process.platform === 'win32')(
    'fails closed when a child appears after its known parent exits without a confirmed stop cutoff',
    async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-06T00:00:05.000Z'));
      const [, args] = await captureCompletedWindowsReaperInvocation().finally(() => now.mockRestore());
      const command = args[4] ?? '';
      const harness = String.raw`
$script:fullScan = 0
$script:stopped = [System.Collections.Generic.HashSet[uint32]]::new()
function Get-CimInstance {
  param([string]$ClassName, [string]$Filter)
  if ($Filter) {
    [uint32]$processId = [uint32]($Filter -replace '[^0-9]', '')
    if ($script:stopped.Contains($processId)) { return $null }
    return [pscustomobject]@{
      ProcessId = $processId
      ParentProcessId = 99999
      CreationDate = [datetime]'2026-08-06T00:00:10Z'
    }
  }
  $script:fullScan += 1
  if ($script:fullScan -eq 1) {
    return [pscustomobject]@{
      ProcessId = 600
      ParentProcessId = 99999
      CreationDate = [datetime]'2026-08-06T00:00:10Z'
    }
  }
  return [pscustomobject]@{
    ProcessId = 700
    ParentProcessId = 600
    CreationDate = [datetime]'2026-08-06T00:00:20Z'
  }
}
function Stop-Process {
  param([int]$Id, [switch]$Force, [switch]$PassThru, [object]$ErrorAction)
  [void]$script:stopped.Add([uint32]$Id)
  throw 'Process exited before its stop cutoff was captured'
}
function Wait-Process {
  param([Parameter(ValueFromPipeline = $true)]$InputObject, [object]$ErrorAction)
  process {}
}
function Start-Sleep { param([int]$Milliseconds) }
${command}
`;

      await expect(runPowerShell(harness)).resolves.toEqual({ code: 1, stdout: '' });
    }
  );

  it('fails closed when Windows tree termination exits unsuccessfully', async () => {
    const renderProcess = Object.assign(createWatchProcess(), { pid: 99_999 });
    const failedTaskkillProcess = Object.assign(createWatchProcess(), { exitCode: 1 });
    const successfulTaskkillProcess = Object.assign(createWatchProcess(), { exitCode: 0 });
    const processTreeSpawn = vi
      .fn<OfficeCliProcessTreeSpawn>()
      .mockReturnValueOnce(failedTaskkillProcess)
      .mockImplementationOnce(() => {
        Object.assign(renderProcess, { signalCode: 'SIGKILL' });
        queueMicrotask(() => renderProcess.emit('exit', null, 'SIGKILL'));
        return successfulTaskkillProcess;
      });
    const spawn = vi.fn<OfficeCliSpawn>(() => {
      queueMicrotask(() => {
        renderProcess.stdout.write(Buffer.alloc(PRESENTATION_RUN_LIMITS.MAX_OFFICECLI_STDOUT_BYTES + 1));
      });
      return renderProcess;
    });
    const runner = createOfficeCliRunner({
      binaryPath: 'C:\\officecli.exe',
      platform: 'win32',
      processTreeSpawn,
      spawn,
    });

    await expect(
      runner.renderSlide('C:\\inspection\\candidate.pptx', 1, 'C:\\render\\slide-1.png')
    ).rejects.toMatchObject({ code: 'OFFICECLI_FAILED' });
    expect(processTreeSpawn).toHaveBeenCalledTimes(2);
    expect(processTreeSpawn).toHaveBeenCalledWith('taskkill', ['/F', '/PID', '99999', '/T'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  });

  it('stops a timed-out Windows cleanup helper before retrying tree termination', async () => {
    vi.useFakeTimers();
    try {
      const renderProcess = Object.assign(createWatchProcess(), { pid: 99_999 });
      const stalledTaskkillProcess = Object.assign(createWatchProcess(), { pid: 88_888 });
      const successfulTaskkillProcess = Object.assign(createWatchProcess(), { exitCode: 0 });
      const processTreeSpawn = vi
        .fn<OfficeCliProcessTreeSpawn>()
        .mockReturnValueOnce(stalledTaskkillProcess)
        .mockImplementationOnce(() => {
          Object.assign(renderProcess, { signalCode: 'SIGKILL' });
          queueMicrotask(() => renderProcess.emit('exit', null, 'SIGKILL'));
          return successfulTaskkillProcess;
        });
      const runner = createOfficeCliRunner({
        binaryPath: 'C:\\officecli.exe',
        platform: 'win32',
        processTreeSpawn,
        spawn: () => {
          queueMicrotask(() => {
            renderProcess.stdout.write(Buffer.alloc(PRESENTATION_RUN_LIMITS.MAX_OFFICECLI_STDOUT_BYTES + 1));
          });
          return renderProcess;
        },
      });

      const pending = runner.renderSlide('C:\\inspection\\candidate.pptx', 1, 'C:\\render\\slide-1.png');
      const rejection = expect(pending).rejects.toMatchObject({ code: 'OFFICECLI_FAILED' });
      await vi.advanceTimersByTimeAsync(5_250);

      await rejection;
      expect(stalledTaskkillProcess.kill).toHaveBeenCalledWith('SIGKILL');
      expect(processTreeSpawn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.runIf(process.platform !== 'win32')(
    'terminates Windows render descendants before resolving after their parent exits successfully',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'officecli-windows-completed-tree-'));
      const executable = path.join(root, 'fake-officecli');
      const outputPath = path.join(root, 'slide-1.png');
      const pidPath = `${outputPath}.pid`;
      const heartbeatPath = `${outputPath}.heartbeat`;
      const heartbeatProgram = `
        const { appendFileSync } = require('node:fs');
        const heartbeatPath = ${JSON.stringify(heartbeatPath)};
        appendFileSync(heartbeatPath, 'x');
        setInterval(() => appendFileSync(heartbeatPath, 'x'), 10);
      `;
      await writeFile(
        executable,
        `#!/usr/bin/env node
          const { spawn } = require('node:child_process');
          const { writeFileSync } = require('node:fs');
          writeFileSync(${JSON.stringify(heartbeatPath)}, '');
          const child = spawn(process.execPath, ['-e', ${JSON.stringify(heartbeatProgram)}], { stdio: 'ignore' });
          child.unref();
          writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));
          process.stdout.write(JSON.stringify({ success: true, data: {} }));
        `,
        { mode: 0o700 }
      );

      let descendantPid = 0;
      let renderProcess: ChildProcess | undefined;
      const spawn: OfficeCliSpawn = (file, args, options) => {
        renderProcess = nodeSpawn(file, args, { ...options, detached: true });
        return renderProcess as unknown as OfficeCliWatchProcess;
      };
      const processTreeSpawn = vi.fn<OfficeCliProcessTreeSpawn>((_file, args) => {
        const taskkill = createWatchProcess();
        const targetPid = readBoundPowerShellTargetPid(args);
        queueMicrotask(() => {
          process.kill(-targetPid, 'SIGKILL');
          Object.assign(taskkill, { exitCode: 0 });
          taskkill.emit('close', 0, null);
        });
        return taskkill;
      });
      const runner = createOfficeCliRunner({
        binaryPath: executable,
        platform: 'win32',
        processTreeSpawn,
        spawn,
      });

      try {
        const pending = runner.renderSlide('/inspection/candidate.pptx', 1, outputPath);
        descendantPid = await readProcessId(pidPath);
        expect(descendantPid).toBeGreaterThan(1);
        await expect(pending).resolves.toBeUndefined();
        expect(processTreeSpawn).toHaveBeenCalledTimes(1);
        expect(processTreeSpawn.mock.calls[0]?.[0]).toBe('powershell.exe');
        expect(processTreeSpawn.mock.calls[0]?.[1]).toEqual([
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          expect.stringContaining(
            `[uint32]$targetProcessId = ${String(renderProcess?.pid)}\n[bool]$rootAlreadyEnded = $true`
          ),
        ]);
        expect(processTreeSpawn.mock.calls[0]?.[2]).toEqual({ stdio: 'ignore', windowsHide: true });
        const heartbeatAtResolution = await readFile(heartbeatPath);
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(await readFile(heartbeatPath)).toEqual(heartbeatAtResolution);
        expect(isProcessAlive(descendantPid)).toBe(false);
      } finally {
        if (descendantPid > 1 && isProcessAlive(descendantPid)) process.kill(descendantPid, 'SIGKILL');
        if (renderProcess?.pid && isProcessAlive(renderProcess.pid)) renderProcess.kill('SIGKILL');
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it.runIf(process.platform !== 'win32')(
    'retries a failed Windows tree termination before rejecting and releasing the render workspace',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'officecli-windows-render-tree-'));
      const executable = path.join(root, 'fake-officecli');
      const outputPath = path.join(root, 'slide-1.png');
      const pidPath = `${outputPath}.pid`;
      const heartbeatPath = `${outputPath}.heartbeat`;
      const heartbeatProgram = `
        const { appendFileSync } = require('node:fs');
        const heartbeatPath = ${JSON.stringify(heartbeatPath)};
        appendFileSync(heartbeatPath, 'x');
        setInterval(() => appendFileSync(heartbeatPath, 'x'), 10);
      `;
      await writeFile(
        executable,
        `#!/usr/bin/env node
          const { spawn } = require('node:child_process');
          const { writeFileSync } = require('node:fs');
          writeFileSync(${JSON.stringify(heartbeatPath)}, '');
          const child = spawn(process.execPath, ['-e', ${JSON.stringify(heartbeatProgram)}], { stdio: 'ignore' });
          writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));
          setInterval(() => undefined, 1_000);
        `,
        { mode: 0o700 }
      );

      let descendantPid = 0;
      let renderProcess: ChildProcess | undefined;
      let taskkillAttempt = 0;
      const spawn: OfficeCliSpawn = (file, args, options) => {
        renderProcess = nodeSpawn(file, args, { ...options, detached: true });
        return renderProcess as unknown as OfficeCliWatchProcess;
      };
      const processTreeSpawn = vi.fn<OfficeCliProcessTreeSpawn>((file, args) => {
        const taskkill = createWatchProcess();
        taskkillAttempt += 1;
        const attempt = taskkillAttempt;
        const targetPid = file === 'taskkill' ? Number(args[2]) : readBoundPowerShellTargetPid(args);
        queueMicrotask(() => {
          if (attempt === 1) {
            Object.assign(taskkill, { exitCode: 1 });
            taskkill.emit('close', 1, null);
            return;
          }
          process.kill(-targetPid, 'SIGKILL');
          Object.assign(taskkill, { exitCode: 0 });
          taskkill.emit('close', 0, null);
        });
        return taskkill;
      });
      const runner = createOfficeCliRunner({
        binaryPath: executable,
        platform: 'win32',
        processTreeSpawn,
        spawn,
      });

      try {
        const pending = runner.renderSlide('/inspection/candidate.pptx', 1, outputPath);
        descendantPid = await readProcessId(pidPath);
        expect(descendantPid).toBeGreaterThan(1);
        await writeFile(outputPath, '');
        await truncate(outputPath, PRESENTATION_RUN_LIMITS.MAX_RENDER_BYTES_PER_SLIDE + 1);

        await expect(pending).rejects.toMatchObject({ code: 'EFBIG' });
        expect(processTreeSpawn).toHaveBeenCalledTimes(2);
        expect(processTreeSpawn.mock.calls[0]?.[0]).toBe('taskkill');
        expect(processTreeSpawn.mock.calls[1]?.[0]).toBe('powershell.exe');
        expect(processTreeSpawn.mock.calls[1]?.[1]).toEqual([
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          expect.stringContaining(
            `[uint32]$targetProcessId = ${String(renderProcess?.pid)}\n[bool]$rootAlreadyEnded = $false`
          ),
        ]);
        const heartbeatAtRejection = await readFile(heartbeatPath);
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(await readFile(heartbeatPath)).toEqual(heartbeatAtRejection);
      } finally {
        if (descendantPid > 1 && isProcessAlive(descendantPid)) process.kill(descendantPid, 'SIGKILL');
        if (renderProcess?.pid && isProcessAlive(renderProcess.pid)) renderProcess.kill('SIGKILL');
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it.runIf(process.platform !== 'win32')('kills a descendant writer before a timed-out render rejects', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'officecli-render-tree-'));
    const executable = path.join(root, 'fake-officecli');
    const outputPath = path.join(root, 'slide-1.png');
    const pidPath = `${outputPath}.pid`;
    const heartbeatPath = `${outputPath}.heartbeat`;
    const heartbeatProgram = `
      const { appendFileSync } = require('node:fs');
      const heartbeatPath = ${JSON.stringify(heartbeatPath)};
      appendFileSync(heartbeatPath, 'x');
      setInterval(() => appendFileSync(heartbeatPath, 'x'), 10);
    `;
    await writeFile(
      executable,
      `#!/usr/bin/env node
        const { spawn } = require('node:child_process');
        const { writeFileSync } = require('node:fs');
        const pidPath = ${JSON.stringify(pidPath)};
        writeFileSync(${JSON.stringify(heartbeatPath)}, '');
        const child = spawn(process.execPath, ['-e', ${JSON.stringify(heartbeatProgram)}], { stdio: 'ignore' });
        writeFileSync(pidPath, String(child.pid));
        setInterval(() => undefined, 1_000);
      `,
      { mode: 0o700 }
    );
    await chmod(executable, 0o700);
    let renderProcess: ChildProcess | undefined;
    const spawn: OfficeCliSpawn = (file, args, options) => {
      renderProcess = nodeSpawn(file, args, options);
      return renderProcess as unknown as OfficeCliWatchProcess;
    };
    const runner = createOfficeCliRunner({ binaryPath: executable, spawn });
    let descendantPid = 0;

    try {
      const pending = runner.renderSlide('/private/inspection/candidate.pptx', 1, outputPath);
      descendantPid = await readProcessId(pidPath);
      expect(Number.isSafeInteger(descendantPid) && descendantPid > 1).toBe(true);
      renderProcess?.kill('SIGTERM');
      await expect(pending).rejects.toMatchObject({
        code: 'ETIMEDOUT',
      });
      const heartbeatAtRejection = await readFile(heartbeatPath);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(await readFile(heartbeatPath)).toEqual(heartbeatAtRejection);
    } finally {
      if (descendantPid > 1 && isProcessAlive(descendantPid)) process.kill(descendantPid, 'SIGKILL');
      if (renderProcess?.pid && isProcessAlive(renderProcess.pid)) renderProcess.kill('SIGKILL');
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects while an in-flight render output grows beyond the byte ceiling', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'officecli-render-limit-'));
    const outputPath = path.join(root, 'slide-1.png');
    const spawn = vi.fn<OfficeCliSpawn>(() => createWatchProcess());
    const runner = createOfficeCliRunner({ binaryPath: '/opt/officecli', spawn });

    try {
      const pending = runner.renderSlide('/private/inspection/candidate.pptx', 1, outputPath);
      await writeFile(outputPath, '');
      await truncate(outputPath, PRESENTATION_RUN_LIMITS.MAX_RENDER_BYTES_PER_SLIDE + 1);
      const outcome = await Promise.race([
        pending.then(
          () => ({ status: 'resolved' as const, error: null }),
          (error: unknown) => ({ status: 'rejected' as const, error })
        ),
        new Promise<{ status: 'pending'; error: null }>((resolve) =>
          setTimeout(() => resolve({ status: 'pending', error: null }), 250)
        ),
      ]);

      expect(outcome).toMatchObject({ status: 'rejected', error: { code: 'EFBIG' } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('maps a nonzero render exit to a redacted typed failure', async () => {
    const runner = createOfficeCliRunner({ binaryPath: '/opt/officecli', spawn: spawnWithResult('', 2) });

    await expect(
      runner.renderSlide('/private/inspection/candidate.pptx', 1, '/private/render/slide-1.png')
    ).rejects.toMatchObject({ code: 'OFFICECLI_FAILED', message: 'OFFICECLI_FAILED' });
  });

  it('rejects an unsuccessful render envelope even when the process exits cleanly', async () => {
    const runner = createOfficeCliRunner({
      spawn: spawnWithResult(
        JSON.stringify({
          success: false,
          error: { code: 'no_screenshot_backend', error: '/private/inspection/candidate.pptx' },
        }),
        0
      ),
    });

    await expect(
      runner.renderSlide('/private/inspection/candidate.pptx', 1, '/private/render/slide-1.png')
    ).rejects.toMatchObject({ code: 'OFFICECLI_FAILED', message: 'OFFICECLI_FAILED' });
  });

  it('normalizes the observed PPTX text object without losing slide order', async () => {
    const runner = createOfficeCliRunner({
      execFile: execFileWithStdout(JSON.stringify(pptxTextFixture)),
    });

    const result = await runner.viewText('/workspace/business-review.pptx', 'pptx');

    expect(result).toMatchObject({ totalItems: 8, returnedItems: 8 });
    expect(result.textItems).toHaveLength(64);
    expect([result.textItems[0], result.textItems.at(-1)]).toEqual([
      'Q3',
      'Prepared by Finance — data as of 30 September',
    ]);
  });

  it('normalizes the observed DOCX object with tables and blank paragraphs intact', async () => {
    const runner = createOfficeCliRunner({
      execFile: execFileWithStdout(JSON.stringify(docxTextFixture)),
    });

    const result = await runner.viewText('/workspace/business-report.docx', 'docx');

    expect(result).toMatchObject({ totalItems: 39, returnedItems: 38 });
    expect(result.textItems.slice(5, 8)).toEqual(['Author: Strategy and Planning', '', 'Contents']);
    expect(result.textItems).toContain('[Table: 5 rows]');
  });

  it('accepts a structurally valid empty Office text object for caller-level empty handling', async () => {
    const runner = createOfficeCliRunner({
      execFile: execFileWithStdout(JSON.stringify({ success: true, data: { totalElements: 0, elements: [] } })),
    });

    await expect(runner.viewText('/workspace/empty.docx', 'docx')).resolves.toEqual({
      totalItems: 0,
      returnedItems: 0,
      textItems: [],
    });
  });

  it.each([
    ['plain text', 'Heading\nBody'],
    ['an unenveloped object', JSON.stringify(pptxTextFixture.data)],
    ['string envelope data', JSON.stringify({ success: true, data: 'Heading\nBody' })],
    ['the other format schema', JSON.stringify(docxTextFixture)],
  ])('rejects %s instead of guessing a PPTX text schema', async (_label, stdout) => {
    const runner = createOfficeCliRunner({ execFile: execFileWithStdout(stdout) });

    await expect(runner.viewText('/workspace/business-review.pptx', 'pptx')).rejects.toMatchObject({
      code: 'OFFICECLI_FAILED',
    });
  });

  it.each([
    ['a non-integer count', { totalSlides: 1.5, slides: [] }],
    ['more slides than reported', { totalSlides: 0, slides: [{ index: 1, path: '/slide[1]', texts: [] }] }],
    ['a missing trailing slide', { totalSlides: 2, slides: [{ index: 1, path: '/slide[1]', texts: ['Title'] }] }],
    ['an invalid slide index', { totalSlides: 1, slides: [{ index: 0, path: '/slide[1]', texts: [] }] }],
    [
      'duplicate slide indexes',
      {
        totalSlides: 2,
        slides: [
          { index: 1, path: '/slide[1]', texts: [] },
          { index: 1, path: '/slide[1]', texts: [] },
        ],
      },
    ],
    [
      'reordered slide indexes',
      {
        totalSlides: 2,
        slides: [
          { index: 2, path: '/slide[2]', texts: [] },
          { index: 1, path: '/slide[1]', texts: [] },
        ],
      },
    ],
    [
      'a gap in slide indexes',
      {
        totalSlides: 3,
        slides: [
          { index: 1, path: '/slide[1]', texts: [] },
          { index: 3, path: '/slide[3]', texts: [] },
        ],
      },
    ],
    ['a non-string slide path', { totalSlides: 1, slides: [{ index: 1, path: null, texts: [] }] }],
    ['a non-string text item', { totalSlides: 1, slides: [{ index: 1, path: '/slide[1]', texts: [1] }] }],
  ])('rejects a PPTX object with %s', async (_label, data) => {
    const runner = createOfficeCliRunner({
      execFile: execFileWithStdout(JSON.stringify({ success: true, data })),
    });

    await expect(runner.viewText('/workspace/business-review.pptx', 'pptx')).rejects.toMatchObject({
      code: 'OFFICECLI_FAILED',
    });
  });

  it.each([
    ['a negative count', { totalElements: -1, elements: [] }],
    ['a non-array collection', { totalElements: 1, elements: {} }],
    ['a non-string element path', { totalElements: 1, elements: [{ path: null, type: 'paragraph', text: '' }] }],
    ['a non-string element type', { totalElements: 1, elements: [{ path: '/body/p[1]', type: 1, text: '' }] }],
    [
      'a non-string element text',
      { totalElements: 1, elements: [{ path: '/body/p[1]', type: 'paragraph', text: null }] },
    ],
  ])('rejects a DOCX object with %s', async (_label, data) => {
    const runner = createOfficeCliRunner({
      execFile: execFileWithStdout(JSON.stringify({ success: true, data })),
    });

    await expect(runner.viewText('/workspace/business-report.docx', 'docx')).rejects.toMatchObject({
      code: 'OFFICECLI_FAILED',
    });
  });

  it('accepts OfficeCLI stdout at the exact byte ceiling', async () => {
    const output = JSON.stringify({ success: true, data: { totalElements: 0, elements: [] } });
    const runner = createOfficeCliRunner({
      execFile: execFileWithStdout(padToUtf8Bytes(output, PRESENTATION_RUN_LIMITS.MAX_OFFICECLI_STDOUT_BYTES)),
    });

    await expect(runner.viewText('/workspace/empty.docx', 'docx')).resolves.toMatchObject({
      totalItems: 0,
    });
  });

  it('rejects OfficeCLI stdout one byte above the ceiling', async () => {
    const output = JSON.stringify({ success: true, data: { totalElements: 0, elements: [] } });
    const runner = createOfficeCliRunner({
      execFile: execFileWithStdout(padToUtf8Bytes(output, PRESENTATION_RUN_LIMITS.MAX_OFFICECLI_STDOUT_BYTES + 1)),
    });

    await expect(runner.viewText('/workspace/empty.docx', 'docx')).rejects.toMatchObject({
      code: 'OFFICECLI_FAILED',
    });
  });

  it('measures the stdout ceiling in UTF-8 bytes rather than JavaScript characters', async () => {
    const output = JSON.stringify({
      success: true,
      data: {
        totalElements: 1,
        elements: [
          {
            path: '/body/p[1]',
            type: 'paragraph',
            text: 'é'.repeat(PRESENTATION_RUN_LIMITS.MAX_OFFICECLI_STDOUT_BYTES / 2),
          },
        ],
      },
    });
    const runner = createOfficeCliRunner({ execFile: execFileWithStdout(output) });

    expect(output.length).toBeLessThan(PRESENTATION_RUN_LIMITS.MAX_OFFICECLI_STDOUT_BYTES);
    await expect(runner.viewText('/workspace/large.docx', 'docx')).rejects.toMatchObject({
      code: 'OFFICECLI_FAILED',
    });
  });

  it.each([
    ['a timeout', Object.assign(new Error('/private/source.docx'), { code: 'ETIMEDOUT' })],
    ['a nonzero exit', Object.assign(new Error('/private/source.docx'), { code: 2 })],
  ])('maps %s to a redacted typed text-view failure', async (_label, error) => {
    const execFile = vi.fn<OfficeCliExecFile>((_file, _args, _options, callback) => {
      callback(error, JSON.stringify(docxTextFixture), '/private/source.docx');
    });
    const runner = createOfficeCliRunner({ execFile });

    await expect(runner.viewText('/private/source.docx', 'docx')).rejects.toMatchObject({
      code: 'OFFICECLI_FAILED',
      message: 'OFFICECLI_FAILED',
    });
  });

  it('rejects malformed or unsuccessful OfficeCLI JSON', () => {
    expect(() => parseOfficeCliEnvelope('not-json')).toThrowError(
      expect.objectContaining({ code: 'OFFICECLI_FAILED' })
    );
    expect(() => parseOfficeCliEnvelope('{"success":false,"message":"bad"}')).toThrowError(
      expect.objectContaining({ code: 'OFFICECLI_FAILED' })
    );
  });

  it('maps a missing OfficeCLI binary to a typed error', async () => {
    const error = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const execFile = vi.fn<OfficeCliExecFile>((_file, _args, _options, callback) => {
      callback(error, '', '');
    });
    const runner = createOfficeCliRunner({ binaryPath: '/opt/officecli', execFile });

    await expect(runner.validate('/workspace/a.docx')).rejects.toMatchObject({ code: 'OFFICECLI_NOT_FOUND' });
  });

  it('maps a synchronous missing OfficeCLI binary error to a typed error', async () => {
    const error = Object.assign(new Error('/private/workspace/a.docx'), { code: 'ENOENT' });
    const execFile = vi.fn<OfficeCliExecFile>(() => {
      throw error;
    });
    const runner = createOfficeCliRunner({ binaryPath: '/opt/officecli', execFile });

    await expect(runner.validate('/workspace/a.docx')).rejects.toMatchObject({ code: 'OFFICECLI_NOT_FOUND' });
  });

  it('maps a synchronous OfficeCLI throw to a typed error', async () => {
    const execFile = vi.fn<OfficeCliExecFile>(() => {
      throw new Error('/private/workspace/a.docx');
    });
    const runner = createOfficeCliRunner({ binaryPath: '/opt/officecli', execFile });

    await expect(runner.get('/workspace/a.docx', '/body/p[1]')).rejects.toMatchObject({ code: 'OFFICECLI_FAILED' });
  });

  it('waits for a local watch server beyond the backend timeout and stops its child process', async () => {
    vi.useFakeTimers();
    const child = createWatchProcess();
    const spawn = vi.fn<OfficeCliSpawn>(() => child);
    const runner = createOfficeCliRunner({
      binaryPath: '/opt/officecli',
      spawn,
      allocatePort: async () => 26318,
    });

    const pending = runner.watch('/private/preview/model.xlsx');
    child.stdout.write('Watch: http://local');
    child.stdout.write('host:26318\n');
    const session = await pending;

    expect(spawn).toHaveBeenCalledWith(
      '/opt/officecli',
      ['watch', '/private/preview/model.xlsx', '--port', '26318'],
      expect.objectContaining({ shell: false, windowsHide: true })
    );
    expect(session.url).toBe('http://127.0.0.1:26318/');

    await session.stop();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });

  it('terminates a watch process that does not become ready within sixty seconds', async () => {
    vi.useFakeTimers();
    const child = createWatchProcess();
    const runner = createOfficeCliRunner({
      binaryPath: '/opt/officecli',
      spawn: () => child,
      allocatePort: async () => 26318,
    });

    const pending = runner.watch('/private/preview/model.xlsx');
    const assertion = expect(pending).rejects.toMatchObject({ code: 'PREVIEW_FAILED' });
    await vi.advanceTimersByTimeAsync(60_000);

    await assertion;
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });
});

describe('resolveOfficeCliBinary', () => {
  const bundled = (resources: string, platform: NodeJS.Platform, arch: string) =>
    path.join(
      resources,
      'bundled-aioncore',
      `${platform}-${arch}`,
      'managed-resources',
      'office',
      platform === 'win32' ? 'officecli.exe' : 'officecli'
    );

  it('returns an explicit binaryPath first', () => {
    expect(resolveOfficeCliBinary({ binaryPath: '/opt/officecli', exists: () => true })).toBe('/opt/officecli');
  });

  it('returns an absolute OFFICECLI_PATH over discovered locations', () => {
    expect(resolveOfficeCliBinary({ environment: { OFFICECLI_PATH: '/abs/officecli' }, exists: () => true })).toBe(
      '/abs/officecli'
    );
  });

  it('finds the officecli bundled with the app (WP #24097)', () => {
    const resources = '/app/Resources';
    const expected = bundled(resources, 'darwin', 'arm64');
    const resolved = resolveOfficeCliBinary({
      resourcesPath: resources,
      platform: 'darwin',
      arch: 'arm64',
      environment: {},
      exists: (p) => p === expected,
      homeDirectory: '/home/u',
    });
    expect(resolved).toBe(expected);
  });

  it('finds the bundled officecli.exe on Windows', () => {
    const resources = 'C:\\app\\resources';
    const expected = bundled(resources, 'win32', 'x64');
    const resolved = resolveOfficeCliBinary({
      resourcesPath: resources,
      platform: 'win32',
      arch: 'x64',
      environment: {},
      exists: (p) => p === expected,
    });
    expect(resolved).toBe(expected);
  });

  it('falls back to the Windows installer location when nothing is bundled', () => {
    const installed = path.join('C:\\Users\\u\\AppData\\Local', 'OfficeCli', 'officecli.exe');
    const resolved = resolveOfficeCliBinary({
      resourcesPath: 'C:\\app\\resources',
      platform: 'win32',
      arch: 'x64',
      environment: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' },
      exists: (p) => p === installed,
    });
    expect(resolved).toBe(installed);
  });

  it('finds ~/.local/bin/officecli on unix when not bundled', () => {
    const local = path.join('/home/u', '.local', 'bin', 'officecli');
    const resolved = resolveOfficeCliBinary({
      resourcesPath: '/app/Resources',
      platform: 'linux',
      arch: 'x64',
      environment: {},
      homeDirectory: '/home/u',
      exists: (p) => p === local,
    });
    expect(resolved).toBe(local);
  });

  it('falls back to bare officecli when nothing is found', () => {
    expect(
      resolveOfficeCliBinary({
        resourcesPath: '/app/Resources',
        platform: 'linux',
        arch: 'x64',
        environment: {},
        homeDirectory: '/home/u',
        exists: () => false,
      })
    ).toBe('officecli');
  });
});
