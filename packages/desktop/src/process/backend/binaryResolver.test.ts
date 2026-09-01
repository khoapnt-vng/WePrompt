import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveBinaryPath } from './binaryResolver';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
const originalBackendBinary = process.env.AIONUI_BACKEND_BINARY;
const originalBackendBin = process.env.AIONUI_BACKEND_BIN;

function setResourcesPath(resourcesPath: string | undefined): void {
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value: resourcesPath,
  });
}

function dirEntry(name: string, isDirectory = false): ReturnType<typeof readdirSync>[number] {
  return {
    name,
    isDirectory: () => isDirectory,
  } as unknown as ReturnType<typeof readdirSync>[number];
}

describe('resolveBinaryPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AIONUI_BACKEND_BINARY;
    delete process.env.AIONUI_BACKEND_BIN;
  });

  afterEach(() => {
    setResourcesPath(originalResourcesPath);
    if (originalBackendBinary === undefined) delete process.env.AIONUI_BACKEND_BINARY;
    else process.env.AIONUI_BACKEND_BINARY = originalBackendBinary;
    if (originalBackendBin === undefined) delete process.env.AIONUI_BACKEND_BIN;
    else process.env.AIONUI_BACKEND_BIN = originalBackendBin;
  });

  it('uses an explicit existing binary only when the caller permits development overrides', () => {
    process.env.AIONUI_BACKEND_BINARY = './tmp/aioncore-under-test';
    vi.mocked(existsSync).mockImplementation((candidate) => candidate === resolve('./tmp/aioncore-under-test'));

    expect(resolveBinaryPath({ allowEnvironmentOverride: true })).toBe(resolve('./tmp/aioncore-under-test'));
    expect(() => resolveBinaryPath()).toThrow('Cannot find "aioncore" binary');
  });

  it('fails closed when an explicitly configured development binary is missing', () => {
    process.env.AIONUI_BACKEND_BINARY = '/missing/aioncore';
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() => resolveBinaryPath({ allowEnvironmentOverride: true })).toThrow(
      'Configured AionCore binary does not exist: /missing/aioncore'
    );
  });

  it('attaches bundled path diagnostics when aioncore cannot be resolved', () => {
    const resourcesPath = '/app/resources';
    const runtimeKey = `${process.platform}-${process.arch}`;
    const binaryName = process.platform === 'win32' ? 'aioncore.exe' : 'aioncore';
    const bundledDir = join(resourcesPath, 'bundled-aioncore');
    const runtimeDir = join(bundledDir, runtimeKey);
    const checkedBundledPath = join(runtimeDir, binaryName);

    setResourcesPath(resourcesPath);
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockImplementation((path) => {
      if (path === resourcesPath) return [dirEntry('bundled-aioncore', true)];
      if (path === runtimeDir) return [dirEntry('manifest.json')];
      return [] as ReturnType<typeof readdirSync>;
    });
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found on PATH');
    });

    expect(() => resolveBinaryPath()).toThrow('Cannot find "aioncore" binary');

    try {
      resolveBinaryPath();
    } catch (error) {
      expect(error).toMatchObject({
        name: 'BackendBinaryResolveError',
        diagnostics: expect.objectContaining({
          resourcesPath,
          runtimeKey,
          binaryName,
          checkedBundledPath,
          bundledDirExists: false,
          runtimeDirExists: false,
          resourcesDirEntries: ['bundled-aioncore/'],
          runtimeDirEntries: ['manifest.json'],
          pathLookupCommand: process.platform === 'win32' ? 'where aioncore' : 'which aioncore',
          pathLookupError: expect.stringContaining('not found on PATH'),
        }),
      });
    }
  });
});
