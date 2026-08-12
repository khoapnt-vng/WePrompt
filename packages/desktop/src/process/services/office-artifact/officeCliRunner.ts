/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable no-await-in-loop -- cleanup attempts must remain serialized until every child is confirmed stopped */

import { execFile as nodeExecFile, spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { PRESENTATION_RUN_LIMITS } from '@/common/config/constants';
import { OfficeArtifactError, parseOfficeCliEnvelope, parseOfficeCliMatchedEnvelope } from './officeCliJson';

type OfficeCliExecFileOptions = {
  shell: false;
  windowsHide: true;
  timeout: number;
  maxBuffer: number;
};

type OfficeCliExecFileError = Error & {
  code?: string | number | null;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
};

type OfficeCliSpawnOptions = {
  shell: false;
  windowsHide: true;
  stdio: ['ignore', 'pipe', 'pipe'];
  detached?: boolean;
};

type OfficeCliProcessTreeSpawnOptions = {
  stdio: 'ignore';
  windowsHide: true;
};

type OfficeCliWatchStream = {
  on: (event: 'data', listener: (chunk: Buffer | string) => void) => unknown;
};

export type OfficeCliWatchProcess = {
  pid?: number;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  stdout: OfficeCliWatchStream;
  stderr: OfficeCliWatchStream;
  once: {
    (event: 'error', listener: (error: OfficeCliExecFileError) => void): unknown;
    (event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
    (event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  };
  removeListener: {
    (event: 'error', listener: (error: OfficeCliExecFileError) => void): unknown;
    (event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
    (event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  };
  kill: (signal: NodeJS.Signals) => boolean;
};

export type OfficeCliSpawn = (file: string, args: string[], options: OfficeCliSpawnOptions) => OfficeCliWatchProcess;

export type OfficeCliProcessTreeSpawn = (
  file: string,
  args: string[],
  options: OfficeCliProcessTreeSpawnOptions
) => OfficeCliWatchProcess;

export type OfficeCliPreviewSession = {
  url: string;
  stop: () => Promise<void>;
};

export type OfficeCliTextFormat = 'docx' | 'pptx';

export type OfficeCliTextView = {
  totalItems: number;
  returnedItems: number;
  textItems: string[];
};

export type OfficeCliExecFile = (
  file: string,
  args: string[],
  options: OfficeCliExecFileOptions,
  callback: (error: OfficeCliExecFileError | null, stdout: string, stderr: string) => void
) => ChildProcess | void;

export type OfficeCliRunner = {
  get: (file: string, path: string) => Promise<unknown>;
  replaceText: (file: string, path: string, find: string, replace: string) => Promise<unknown>;
  formatRange: (
    file: string,
    path: string,
    start: number,
    end: number,
    property: 'bold' | 'italic' | 'underline',
    enabled: boolean
  ) => Promise<unknown>;
  setCell: (file: string, path: string, input: string) => Promise<unknown>;
  validate: (file: string) => Promise<unknown>;
  viewText: (file: string, format: OfficeCliTextFormat) => Promise<OfficeCliTextView>;
  close: (file: string) => Promise<unknown>;
  watch: (file: string) => Promise<OfficeCliPreviewSession>;
};

/** Narrow OfficeCLI capability used by exact-hash presentation inspection. */
export type OfficeCliRenderRunner = {
  renderSlide: (file: string, page: number, outputPath: string) => Promise<void>;
};

export type FullOfficeCliRunner = OfficeCliRunner & OfficeCliRenderRunner;

export type OfficeCliRunnerDependencies = {
  binaryPath?: string;
  execFile?: OfficeCliExecFile;
  spawn?: OfficeCliSpawn;
  allocatePort?: () => Promise<number>;
  environment?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  /** App resources dir (electron `process.resourcesPath`); used to find the bundled officecli. */
  resourcesPath?: string;
  /** Process arch, for the `<platform>-<arch>` bundled-aioncore runtime key. */
  arch?: string;
  processTreeSpawn?: OfficeCliProcessTreeSpawn;
};

const EXEC_OPTIONS: OfficeCliExecFileOptions = {
  shell: false,
  windowsHide: true,
  timeout: 30_000,
  maxBuffer: PRESENTATION_RUN_LIMITS.MAX_OFFICECLI_STDOUT_BYTES,
};

const WATCH_OPTIONS: OfficeCliSpawnOptions = {
  shell: false,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
};
const WATCH_READY_TIMEOUT_MS = 60_000;
const WATCH_STOP_TIMEOUT_MS = 5_000;
const RENDER_OUTPUT_POLL_INTERVAL_MS = 25;
const RENDER_TREE_STOP_TIMEOUT_MS = 5_000;
const RENDER_TREE_STOP_RETRY_MS = 250;
const WINDOWS_RENDER_TREE_REAPER_SCRIPT = String.raw`
function Get-ProcessCreationTicks {
  param([object]$Process)
  if ($null -eq $Process -or $null -eq $Process.CreationDate) { return $null }
  return ([datetime]$Process.CreationDate).ToUniversalTime().Ticks
}
function Add-KnownProcessIdentity {
  param([object]$Process)
  if ($null -eq $Process) { return $false }
  [uint32]$processId = [uint32]$Process.ProcessId
  $creationTicks = Get-ProcessCreationTicks $Process
  if (
    $null -eq $creationTicks -or
    $creationTicks -lt $treeCreationFloorTicks -or
    $knownCreationTicks.ContainsKey($processId)
  ) { return $false }
  $knownCreationTicks.Add($processId, [long]$creationTicks)
  return $true
}
function Test-KnownProcessIdentity {
  param([object]$Process)
  if ($null -eq $Process) { return $false }
  [uint32]$processId = [uint32]$Process.ProcessId
  $creationTicks = Get-ProcessCreationTicks $Process
  return (
    $null -ne $creationTicks -and
    $knownCreationTicks.ContainsKey($processId) -and
    $knownCreationTicks[$processId] -eq [long]$creationTicks
  )
}
$knownCreationTicks = [System.Collections.Generic.Dictionary[uint32,long]]::new()
$knownStopCutoffTicks = [System.Collections.Generic.Dictionary[uint32,long]]::new()
$treeSeeded = $false
$emptyPasses = 0
for ($pass = 0; $pass -lt 16; $pass++) {
  $processes = @(
    Get-CimInstance -ClassName Win32_Process |
      Select-Object ProcessId, ParentProcessId, CreationDate
  )
  $processById = @{}
  foreach ($process in $processes) {
    $processById[[uint32]$process.ProcessId] = $process
  }
  $scanAmbiguous = $false
  if (-not $treeSeeded) {
    $rootProcess = $processById[$targetProcessId]
    $rootCreationTicks = Get-ProcessCreationTicks $rootProcess
    if (-not $rootAlreadyEnded -and $null -ne $rootCreationTicks) {
      [void](Add-KnownProcessIdentity $rootProcess)
    } else {
      foreach ($process in $processes) {
        if ([uint32]$process.ParentProcessId -ne $targetProcessId) { continue }
        $processCreationTicks = Get-ProcessCreationTicks $process
        if (
          $null -ne $processCreationTicks -and
          ($null -eq $rootProcess -or
            ($null -ne $rootCreationTicks -and $processCreationTicks -lt $rootCreationTicks))
        ) {
          [void](Add-KnownProcessIdentity $process)
        }
      }
    }
    $treeSeeded = $true
  }
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $processes) {
      [uint32]$processId = [uint32]$process.ProcessId
      [uint32]$parentProcessId = [uint32]$process.ParentProcessId
      if ($knownCreationTicks.ContainsKey($processId)) { continue }
      $parentProcess = $processById[$parentProcessId]
      $processCreationTicks = Get-ProcessCreationTicks $process
      $childMatchesKnownParentGeneration = (
        $null -ne $processCreationTicks -and
        $processCreationTicks -ge $treeCreationFloorTicks -and
        $knownCreationTicks.ContainsKey($parentProcessId) -and
        $processCreationTicks -ge $knownCreationTicks[$parentProcessId]
      )
      if (-not $childMatchesKnownParentGeneration) { continue }
      $parentMatchesKnownIdentity = (
        $null -ne $parentProcess -and
        (Test-KnownProcessIdentity $parentProcess)
      )
      $parentExitUnconfirmed = (
        $null -eq $parentProcess -and
        $null -ne $processCreationTicks -and
        $processCreationTicks -ge $treeCreationFloorTicks -and
        $knownCreationTicks.ContainsKey($parentProcessId) -and
        -not $knownStopCutoffTicks.ContainsKey($parentProcessId)
      )
      if ($parentExitUnconfirmed) { $scanAmbiguous = $true }
      $parentStoppedAfterChildCreation = (
        $null -eq $parentProcess -and
        $null -ne $processCreationTicks -and
        $knownStopCutoffTicks.ContainsKey($parentProcessId) -and
        $processCreationTicks -le $knownStopCutoffTicks[$parentProcessId]
      )
      if (
        ($parentMatchesKnownIdentity -or $parentStoppedAfterChildCreation) -and
        (Add-KnownProcessIdentity $process)
      ) {
        $changed = $true
      }
    }
  }
  $liveProcesses = @($processes | Where-Object { Test-KnownProcessIdentity $_ })
  if ($liveProcesses.Count -eq 0) {
    if ($scanAmbiguous) {
      $emptyPasses = 0
    } else {
      $emptyPasses += 1
      if ($emptyPasses -ge 2) { exit 0 }
    }
  } else {
    $emptyPasses = 0
    foreach ($process in $liveProcesses) {
      [uint32]$processId = [uint32]$process.ProcessId
      $currentProcess = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $processId" | Select-Object ProcessId, ParentProcessId, CreationDate -First 1
      if ($null -ne $currentProcess -and (Test-KnownProcessIdentity $currentProcess)) {
        try {
          $stoppedProcess = Stop-Process -Id ([int]$processId) -Force -PassThru -ErrorAction Stop
          $stoppedProcess | Wait-Process -ErrorAction Stop
          $knownStopCutoffTicks[$processId] = $stoppedProcess.ExitTime.ToUniversalTime().Ticks
        } catch {
          # A failed stop must not authorize discovery through an absent parent.
        }
      }
    }
  }
  Start-Sleep -Milliseconds 25
}
exit 1
`;

function buildWindowsRenderTreeReaperCommand(
  targetProcessId: number,
  rootAlreadyEnded: boolean,
  treeCreationFloorUnixMilliseconds: number
): string {
  return String.raw`$ErrorActionPreference = 'Stop'
[uint32]$targetProcessId = ${targetProcessId}
[bool]$rootAlreadyEnded = ${rootAlreadyEnded ? '$true' : '$false'}
[long]$treeCreationFloorUnixMilliseconds = ${treeCreationFloorUnixMilliseconds}
[long]$treeCreationFloorTicks = 621355968000000000 + ($treeCreationFloorUnixMilliseconds * 10000)
${WINDOWS_RENDER_TREE_REAPER_SCRIPT}`;
}

const defaultExecFile: OfficeCliExecFile = (file, args, options, callback) => {
  return nodeExecFile(file, args, options, (error, stdout, stderr) => {
    callback(error, stdout.toString(), stderr.toString());
  });
};

const defaultSpawn: OfficeCliSpawn = (file, args, options) =>
  nodeSpawn(file, args, options) as unknown as OfficeCliWatchProcess;

const defaultProcessTreeSpawn: OfficeCliProcessTreeSpawn = (file, args, options) =>
  nodeSpawn(file, args, options) as unknown as OfficeCliWatchProcess;

function allocatePreviewPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new OfficeArtifactError('PREVIEW_FAILED'));
        return;
      }
      server.close((error) => {
        if (error) reject(new OfficeArtifactError('PREVIEW_FAILED'));
        else resolve(address.port);
      });
    });
  });
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

type ChildProcessEndOutcome =
  | { readonly ended: true; readonly code: number | null; readonly signal: NodeJS.Signals | null }
  | { readonly ended: false };

function waitForChildProcessEnd(child: OfficeCliWatchProcess): Promise<ChildProcessEndOutcome> {
  if (child.exitCode !== undefined && child.exitCode !== null) {
    return Promise.resolve({ ended: true, code: child.exitCode, signal: child.signalCode ?? null });
  }
  if (child.signalCode !== undefined && child.signalCode !== null) {
    return Promise.resolve({ ended: true, code: child.exitCode ?? null, signal: child.signalCode });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: ChildProcessEndOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener('error', onError);
      child.removeListener('exit', onEnd);
      child.removeListener('close', onEnd);
      resolve(outcome);
    };
    const onError = (): void => finish({ ended: false });
    const onEnd = (code: number | null, signal: NodeJS.Signals | null): void => finish({ ended: true, code, signal });
    const timeout = setTimeout(() => finish({ ended: false }), RENDER_TREE_STOP_TIMEOUT_MS);
    child.once('error', onError);
    child.once('exit', onEnd);
    child.once('close', onEnd);
  });
}

async function terminateRenderProcessTree(
  child: OfficeCliWatchProcess | undefined,
  platform: NodeJS.Platform,
  processTreeSpawn: OfficeCliProcessTreeSpawn,
  treeCreationFloorUnixMilliseconds: number
): Promise<void> {
  if (!child) return;
  const pid = child.pid;
  if (!Number.isSafeInteger(pid) || !pid || pid <= 1) return;

  if (platform === 'win32') {
    const runTreeCommand = async (file: string, args: string[]): Promise<boolean> => {
      let helper: OfficeCliWatchProcess;
      try {
        helper = processTreeSpawn(file, args, {
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {
        return false;
      }

      let helperOutcome = await waitForChildProcessEnd(helper);
      const completedSuccessfully = helperOutcome.ended && helperOutcome.code === 0;
      if (!helperOutcome.ended) {
        const helperPid = helper.pid;
        if (Number.isSafeInteger(helperPid) && helperPid && helperPid > 1) {
          do {
            try {
              helper.kill('SIGKILL');
            } catch {
              // Keep ownership until the cleanup helper is confirmed stopped.
            }
            helperOutcome = await waitForChildProcessEnd(helper);
          } while (!helperOutcome.ended);
        }
      }
      return completedSuccessfully;
    };

    for (;;) {
      const rootAlreadyEnded =
        (child.exitCode !== undefined && child.exitCode !== null) ||
        (child.signalCode !== undefined && child.signalCode !== null);
      const taskkillCompletedSuccessfully =
        !rootAlreadyEnded && (await runTreeCommand('taskkill', ['/F', '/PID', String(pid), '/T']));
      const rootEndedBeforeReaper =
        (child.exitCode !== undefined && child.exitCode !== null) ||
        (child.signalCode !== undefined && child.signalCode !== null);
      const treeStopped =
        taskkillCompletedSuccessfully ||
        (await runTreeCommand('powershell.exe', [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          buildWindowsRenderTreeReaperCommand(pid, rootEndedBeforeReaper, treeCreationFloorUnixMilliseconds),
        ]));

      if (treeStopped) {
        const renderOutcome = await waitForChildProcessEnd(child);
        if (renderOutcome.ended) {
          return;
        }
      }
      await wait(RENDER_TREE_STOP_RETRY_MS);
    }
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The render process group already exited.
    }
  }
  const renderOutcome = await waitForChildProcessEnd(child);
  if (!renderOutcome.ended) throw new OfficeArtifactError('OFFICECLI_FAILED');
}

function renderLimitError(): Error & { code: 'EFBIG' } {
  return Object.assign(new Error('EFBIG'), { name: 'OfficeCliRenderLimitError', code: 'EFBIG' as const });
}

function renderTimeoutError(): Error & { code: 'ETIMEDOUT' } {
  return Object.assign(new Error('ETIMEDOUT'), { name: 'OfficeCliRenderTimeoutError', code: 'ETIMEDOUT' as const });
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function assertRenderOutputWithinLimit(outputPath: string): Promise<void> {
  try {
    const output = await lstat(outputPath);
    if (!output.isFile() || output.isSymbolicLink()) throw new OfficeArtifactError('OFFICECLI_FAILED');
    if (output.size > PRESENTATION_RUN_LIMITS.MAX_RENDER_BYTES_PER_SLIDE) throw renderLimitError();
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

export function resolveOfficeCliBinary(dependencies: OfficeCliRunnerDependencies): string {
  if (dependencies.binaryPath) return dependencies.binaryPath;

  const environment = dependencies.environment ?? process.env;
  const exists = dependencies.exists ?? existsSync;
  const platform = dependencies.platform ?? process.platform;
  const binaryName = platform === 'win32' ? 'officecli.exe' : 'officecli';

  const environmentBinary = environment.OFFICECLI_PATH;
  if (environmentBinary && isAbsolute(environmentBinary)) return environmentBinary;

  // Bundled with the app: <resources>/bundled-aioncore/<platform>-<arch>/managed-resources/office/officecli[.exe].
  // The preview/extractor runs in the desktop main process (not aioncore) and
  // must find the same shipped officecli, or Office previews fail as
  // "corrupted or invalid" on machines where officecli is not on PATH (WP #24097).
  const resourcesPath =
    dependencies.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const arch = dependencies.arch ?? process.arch;
    const bundled = join(
      resourcesPath,
      'bundled-aioncore',
      `${platform}-${arch}`,
      'managed-resources',
      'office',
      binaryName
    );
    if (exists(bundled)) return bundled;
  }

  const localBinary = join(dependencies.homeDirectory ?? homedir(), '.local', 'bin', binaryName);
  if (exists(localBinary)) return localBinary;

  // Windows installer location (aioncore's runtime auto-install target), which
  // lives outside PATH and the unix ~/.local/bin checked above.
  if (platform === 'win32') {
    const localAppData = environment.LOCALAPPDATA;
    if (localAppData) {
      const installed = join(localAppData, 'OfficeCli', 'officecli.exe');
      if (exists(installed)) return installed;
    }
  }

  return 'officecli';
}

function toOfficeArtifactError(error: unknown): OfficeArtifactError {
  const isMissingBinary = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
  return new OfficeArtifactError(isMissingBinary ? 'OFFICECLI_NOT_FOUND' : 'OFFICECLI_FAILED');
}

function toOfficeCliRenderError(error: unknown): Error {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EFBIG') {
    return renderLimitError();
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    (('code' in error && error.code === 'ETIMEDOUT') || ('killed' in error && error.killed === true))
  ) {
    return renderTimeoutError();
  }
  return toOfficeArtifactError(error);
}

function textViewFailure(): never {
  throw new OfficeArtifactError('OFFICECLI_FAILED');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function normalizePptxTextView(data: unknown): OfficeCliTextView {
  if (!isRecord(data) || !isNonNegativeSafeInteger(data.totalSlides) || !Array.isArray(data.slides)) {
    return textViewFailure();
  }
  if (data.slides.length !== data.totalSlides) return textViewFailure();

  const textItems: string[] = [];
  for (const [position, slide] of data.slides.entries()) {
    if (
      !isRecord(slide) ||
      typeof slide.index !== 'number' ||
      !Number.isSafeInteger(slide.index) ||
      slide.index < 1 ||
      slide.index > data.totalSlides ||
      slide.index !== position + 1 ||
      typeof slide.path !== 'string' ||
      !Array.isArray(slide.texts) ||
      !slide.texts.every((text) => typeof text === 'string')
    ) {
      return textViewFailure();
    }
    textItems.push(...slide.texts);
  }

  return { totalItems: data.totalSlides, returnedItems: data.slides.length, textItems };
}

function normalizeDocxTextView(data: unknown): OfficeCliTextView {
  if (!isRecord(data) || !isNonNegativeSafeInteger(data.totalElements) || !Array.isArray(data.elements)) {
    return textViewFailure();
  }
  if (data.elements.length > data.totalElements) return textViewFailure();

  const textItems: string[] = [];
  for (const element of data.elements) {
    if (
      !isRecord(element) ||
      typeof element.path !== 'string' ||
      typeof element.type !== 'string' ||
      typeof element.text !== 'string'
    ) {
      return textViewFailure();
    }
    textItems.push(element.text);
  }

  return { totalItems: data.totalElements, returnedItems: data.elements.length, textItems };
}

function parseOfficeCliTextView(output: string, format: OfficeCliTextFormat): OfficeCliTextView {
  const data = parseOfficeCliEnvelope<unknown>(output);
  return format === 'pptx' ? normalizePptxTextView(data) : normalizeDocxTextView(data);
}

export function createOfficeCliRunner(dependencies: OfficeCliRunnerDependencies = {}): FullOfficeCliRunner {
  const binaryPath = resolveOfficeCliBinary(dependencies);
  const execFile = dependencies.execFile ?? defaultExecFile;
  const spawn = dependencies.spawn ?? defaultSpawn;
  const processTreeSpawn = dependencies.processTreeSpawn ?? defaultProcessTreeSpawn;
  const allocatePort = dependencies.allocatePort ?? allocatePreviewPort;
  const platform = dependencies.platform ?? process.platform;
  const renderSpawnOptions: OfficeCliSpawnOptions = {
    ...WATCH_OPTIONS,
    detached: platform !== 'win32',
  };

  const invoke = <T = unknown>(
    args: string[],
    parseOutput: (output: string) => T = parseOfficeCliEnvelope<T>,
    options: OfficeCliExecFileOptions = EXEC_OPTIONS,
    mapError: (error: unknown) => Error = toOfficeArtifactError
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      try {
        execFile(binaryPath, args, options, (error, stdout) => {
          if (error) {
            reject(mapError(error));
            return;
          }

          if (Buffer.byteLength(stdout, 'utf8') > options.maxBuffer) {
            reject(new OfficeArtifactError('OFFICECLI_FAILED'));
            return;
          }

          try {
            resolve(parseOutput(stdout));
          } catch (parseError) {
            reject(parseError);
          }
        });
      } catch (error) {
        reject(toOfficeArtifactError(error));
      }
    });

  const watch = async (file: string): Promise<OfficeCliPreviewSession> => {
    const port = await allocatePort();
    let child: OfficeCliWatchProcess;
    try {
      child = spawn(binaryPath, ['watch', file, '--port', String(port)], WATCH_OPTIONS);
    } catch (error) {
      throw toOfficeArtifactError(error);
    }

    let exited = false;
    let stopPromise: Promise<void> | undefined;
    let resolveExit: (() => void) | undefined;
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    child.once('exit', () => {
      exited = true;
      resolveExit?.();
    });

    const stop = (): Promise<void> => {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        if (exited) return;
        child.kill('SIGTERM');
        await Promise.race([exitPromise, wait(WATCH_STOP_TIMEOUT_MS)]);
        if (!exited) {
          child.kill('SIGKILL');
          await exitPromise;
        }
      })();
      return stopPromise;
    };

    return new Promise<OfficeCliPreviewSession>((resolve, reject) => {
      let settled = false;
      let stdoutBuffer = '';
      const rejectStart = (error: OfficeArtifactError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        void stop().finally(() => reject(error));
      };
      const timeout = setTimeout(() => rejectStart(new OfficeArtifactError('PREVIEW_FAILED')), WATCH_READY_TIMEOUT_MS);

      child.once('error', (error) => rejectStart(toOfficeArtifactError(error)));
      child.once('exit', () => rejectStart(new OfficeArtifactError('PREVIEW_FAILED')));
      child.stderr.on('data', () => undefined);
      child.stdout.on('data', (chunk) => {
        if (settled) return;
        stdoutBuffer = `${stdoutBuffer}${chunk.toString()}`.slice(-4096);
        if (!stdoutBuffer.includes(`Watch: http://localhost:${port}`)) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ url: `http://127.0.0.1:${port}/`, stop });
      });
    });
  };

  const renderSlide = (file: string, page: number, outputPath: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      let child: OfficeCliWatchProcess | undefined;
      let monitorTimer: NodeJS.Timeout | undefined;
      let timeoutTimer: NodeJS.Timeout | undefined;
      let settling = false;
      let cleanupFinished = false;
      let stdoutByteLength = 0;
      const stdoutChunks: Buffer[] = [];
      const renderStartedAt = Date.now();

      const clearTimers = (): void => {
        if (monitorTimer) clearTimeout(monitorTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
      };

      const settle = (error: unknown, stdout = ''): void => {
        if (settling) return;
        settling = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        void (async () => {
          try {
            await terminateRenderProcessTree(child, platform, processTreeSpawn, renderStartedAt);
            if (error) throw toOfficeCliRenderError(error);
            await assertRenderOutputWithinLimit(outputPath);
            if (Buffer.byteLength(stdout, 'utf8') > PRESENTATION_RUN_LIMITS.MAX_OFFICECLI_STDOUT_BYTES) {
              throw new OfficeArtifactError('OFFICECLI_FAILED');
            }
            parseOfficeCliEnvelope(stdout);
          } finally {
            cleanupFinished = true;
            clearTimers();
          }
        })().then(
          () => resolve(),
          (settleError: unknown) => reject(settleError)
        );
      };

      const monitorOutput = async (): Promise<void> => {
        if (cleanupFinished) return;
        try {
          await assertRenderOutputWithinLimit(outputPath);
        } catch (error) {
          if (!settling) settle(error);
        }
        if (!cleanupFinished) {
          monitorTimer = setTimeout(() => void monitorOutput(), RENDER_OUTPUT_POLL_INTERVAL_MS);
        }
      };

      try {
        child = spawn(
          binaryPath,
          ['view', file, 'screenshot', '--page', String(page), '-o', outputPath, '--json'],
          renderSpawnOptions
        );
        child.stderr.on('data', () => undefined);
        child.stdout.on('data', (chunk) => {
          if (settling) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          stdoutByteLength += bytes.byteLength;
          if (stdoutByteLength > PRESENTATION_RUN_LIMITS.MAX_OFFICECLI_STDOUT_BYTES) {
            settle(new OfficeArtifactError('OFFICECLI_FAILED'));
            return;
          }
          stdoutChunks.push(bytes);
        });
        child.once('error', (error) => settle(error));
        child.once('close', (code, signal) => {
          if (code === 0) {
            settle(null, Buffer.concat(stdoutChunks, stdoutByteLength).toString('utf8'));
            return;
          }
          settle(Object.assign(new Error('OFFICECLI_FAILED'), { code, killed: signal !== null, signal }));
        });
        timeoutTimer = setTimeout(() => settle(renderTimeoutError()), PRESENTATION_RUN_LIMITS.RENDER_TIMEOUT_MS);
        monitorTimer = setTimeout(() => void monitorOutput(), RENDER_OUTPUT_POLL_INTERVAL_MS);
      } catch (error) {
        settle(error);
      }
    });

  return {
    get: (file, path) => invoke(['get', file, path, '--json']),
    replaceText: (file, path, find, replace) =>
      invoke(['set', file, path, '--find', find, '--replace', replace, '--json'], parseOfficeCliMatchedEnvelope),
    formatRange: (file, path, start, end, property, enabled) =>
      invoke([
        'set',
        file,
        path,
        '--prop',
        `range=${start}:${end}`,
        '--prop',
        `${property}=${property === 'underline' ? (enabled ? 'single' : 'none') : String(enabled)}`,
        '--json',
      ]),
    setCell: (file, path, input) =>
      invoke([
        'set',
        file,
        path,
        '--prop',
        input.startsWith('=') ? `formula=${input.slice(1)}` : `value=${input}`,
        '--json',
      ]),
    validate: (file) => invoke(['validate', file, '--json']),
    viewText: (file, format) =>
      invoke(['view', file, 'text', '--json'], (output) => parseOfficeCliTextView(output, format)),
    renderSlide,
    close: (file) => invoke(['close', file, '--json']),
    watch,
  };
}
