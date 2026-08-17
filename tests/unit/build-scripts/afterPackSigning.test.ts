import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type RunResult = { status: number; output: string };
type RunFn = (command: string, args: string[]) => RunResult;

type AfterPackModule = {
  shouldSignBundledAioncore: (platform: string, env: NodeJS.ProcessEnv) => boolean;
  resolveSigningIdentity: (env: NodeJS.ProcessEnv, run: RunFn) => string | null;
  signBundledAioncoreBinaries: (
    resourcesDir: string,
    options?: { env?: NodeJS.ProcessEnv; run?: RunFn; projectRoot?: string; logger?: Pick<Console, 'log' | 'warn'> }
  ) => { signed: number; skipped: number };
  pruneExcludedAcpTools: (resourcesDir: string, runtimeKey: string, env?: NodeJS.ProcessEnv) => { removed: boolean };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const afterPack = require('../../../scripts/afterPack.js') as AfterPackModule;

const tempRoots: string[] = [];
const silentLogger = { log: () => {}, warn: () => {} };

const keychainRun: RunFn = () => ({
  status: 0,
  output: '  1) ABCDEF "Developer ID Application: AionUi Inc. (52JQX2HUSC)"\n     1 valid identities found',
});
const emptyKeychainRun: RunFn = () => ({ status: 1, output: '0 valid identities found' });

function makeTemp(): string {
  const root = mkdtempSync(join(tmpdir(), 'weprompt-afterpack-sign-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe('shouldSignBundledAioncore', () => {
  it('signs on darwin for a real Developer ID build', () => {
    expect(afterPack.shouldSignBundledAioncore('darwin', {})).toBe(true);
  });

  it('skips non-darwin platforms', () => {
    expect(afterPack.shouldSignBundledAioncore('win32', {})).toBe(false);
    expect(afterPack.shouldSignBundledAioncore('linux', {})).toBe(false);
  });

  it('skips internal-release builds so their ad-hoc signature is preserved', () => {
    expect(afterPack.shouldSignBundledAioncore('darwin', { WEPROMPT_INTERNAL_RELEASE: '1' })).toBe(false);
  });

  it('skips local ad-hoc builds with auto-discovery disabled', () => {
    expect(afterPack.shouldSignBundledAioncore('darwin', { CSC_IDENTITY_AUTO_DISCOVERY: 'false' })).toBe(false);
  });
});

describe('resolveSigningIdentity', () => {
  it('prefers CSC_NAME when it is set', () => {
    const run = vi.fn<RunFn>();
    expect(afterPack.resolveSigningIdentity({ CSC_NAME: 'Developer ID Application: Acme (TID)' }, run)).toBe(
      'Developer ID Application: Acme (TID)'
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('parses the keychain when CSC_NAME is absent', () => {
    expect(afterPack.resolveSigningIdentity({}, keychainRun)).toBe(
      'Developer ID Application: AionUi Inc. (52JQX2HUSC)'
    );
  });

  it('returns null when no identity exists', () => {
    expect(afterPack.resolveSigningIdentity({}, emptyKeychainRun)).toBeNull();
  });
});

describe('signBundledAioncoreBinaries', () => {
  it('signs ad-hoc binaries, skips publisher-signed ones, and ignores non-Mach-O files', () => {
    const resourcesDir = makeTemp();
    const bundled = join(resourcesDir, 'bundled-aioncore', 'darwin-arm64');
    mkdirSync(join(bundled, 'mr', 'deep'), { recursive: true });
    const aioncore = join(bundled, 'aioncore');
    const node = join(bundled, 'mr', 'node');
    const rg = join(bundled, 'mr', 'deep', 'rg');
    const readme = join(bundled, 'readme.txt');
    for (const f of [aioncore, node, rg, readme]) writeFileSync(f, 'x');

    const projectRoot = makeTemp();
    writeFileSync(join(projectRoot, 'entitlements.plist'), '<plist/>');

    const machO = new Set([aioncore, node, rg]);
    const preSigned = new Set([node]);
    const signedNow = new Set<string>();
    const run = vi.fn((command: string, args: string[]): RunResult => {
      const file = args[args.length - 1];
      if (command === 'security') return { status: 0, output: '"Developer ID Application: Test Co (TID123)"' };
      if (command === 'file')
        return { status: 0, output: machO.has(file) ? 'Mach-O 64-bit executable arm64' : 'ASCII text' };
      if (command === 'codesign' && args[0] === '-dvv') {
        const isSigned = preSigned.has(file) || signedNow.has(file);
        return {
          status: 0,
          output: isSigned
            ? 'flags=0x10000(runtime)\nAuthority=Developer ID Application: Test Co\n'
            : 'flags=0x20002(adhoc,linker-signed)\nSignature=adhoc\n',
        };
      }
      if (command === 'codesign' && args.includes('--sign')) {
        signedNow.add(file);
        return { status: 0, output: '' };
      }
      return { status: 0, output: '' };
    });

    const result = afterPack.signBundledAioncoreBinaries(resourcesDir, {
      env: {},
      run,
      projectRoot,
      logger: silentLogger,
    });

    expect(result).toEqual({ signed: 2, skipped: 1 });

    const signCalls = run.mock.calls.filter(([cmd, args]) => cmd === 'codesign' && args.includes('--sign'));
    const signedFiles = signCalls.map(([, args]) => args[args.length - 1]);
    expect(new Set(signedFiles)).toEqual(new Set([aioncore, rg]));
    expect(signedFiles).not.toContain(readme);
    expect(signedFiles).not.toContain(node);

    for (const [, args] of signCalls) {
      expect(args).toContain('--timestamp');
      expect(args).toContain('--options');
      expect(args).toContain('runtime');
      expect(args).toContain('--entitlements');
      expect(args).toContain('Developer ID Application: Test Co (TID123)');
    }
  });

  it('skips with a warning when no Developer ID identity is available', () => {
    const resourcesDir = makeTemp();
    mkdirSync(join(resourcesDir, 'bundled-aioncore'), { recursive: true });
    const warn = vi.fn();
    const run = vi.fn(() => ({ status: 1, output: '0 valid identities found' }));

    const result = afterPack.signBundledAioncoreBinaries(resourcesDir, {
      env: {},
      run,
      projectRoot: makeTemp(),
      logger: { log: () => {}, warn },
    });

    expect(result).toEqual({ signed: 0, skipped: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('throws when codesign fails on a bundled binary', () => {
    const resourcesDir = makeTemp();
    const bundled = join(resourcesDir, 'bundled-aioncore', 'darwin-arm64');
    mkdirSync(bundled, { recursive: true });
    const aioncore = join(bundled, 'aioncore');
    writeFileSync(aioncore, 'x');

    const projectRoot = makeTemp();
    writeFileSync(join(projectRoot, 'entitlements.plist'), '<plist/>');

    const run = vi.fn((command: string, args: string[]): RunResult => {
      if (command === 'security') return { status: 0, output: '"Developer ID Application: Test Co (TID)"' };
      if (command === 'file') return { status: 0, output: 'Mach-O 64-bit executable' };
      if (command === 'codesign' && args[0] === '-dvv') return { status: 0, output: 'flags=0x20002(adhoc)\n' };
      if (command === 'codesign' && args.includes('--sign'))
        return { status: 1, output: 'codesign: errSecInternalComponent' };
      return { status: 0, output: '' };
    });

    expect(() =>
      afterPack.signBundledAioncoreBinaries(resourcesDir, { env: {}, run, projectRoot, logger: silentLogger })
    ).toThrow(/Failed to codesign/);
  });
});

describe('pruneExcludedAcpTools', () => {
  function makeManagedResources(runtimeKey: string): string {
    const resourcesDir = makeTemp();
    const acpDir = join(resourcesDir, 'bundled-aioncore', runtimeKey, 'managed-resources', 'acp');
    mkdirSync(join(acpDir, 'codex-acp', '1.1.2'), { recursive: true });
    writeFileSync(join(acpDir, 'codex-acp', '1.1.2', 'rg'), 'binary');
    mkdirSync(join(acpDir, 'claude-agent-acp', '0.58.1'), { recursive: true });
    writeFileSync(join(acpDir, 'claude-agent-acp', '0.58.1', 'claude'), 'binary');
    return resourcesDir;
  }

  it('removes codex-acp (and its vendored binaries) but keeps claude-agent-acp', () => {
    const resourcesDir = makeManagedResources('darwin-arm64');
    const acpDir = join(resourcesDir, 'bundled-aioncore', 'darwin-arm64', 'managed-resources', 'acp');

    const result = afterPack.pruneExcludedAcpTools(resourcesDir, 'darwin-arm64', {});

    expect(result.removed).toBe(true);
    expect(existsSync(join(acpDir, 'codex-acp'))).toBe(false);
    expect(existsSync(join(acpDir, 'claude-agent-acp', '0.58.1', 'claude'))).toBe(true);
  });

  it('keeps codex bundled when WEPROMPT_KEEP_CODEX=1', () => {
    const resourcesDir = makeManagedResources('darwin-arm64');
    const acpDir = join(resourcesDir, 'bundled-aioncore', 'darwin-arm64', 'managed-resources', 'acp');

    const result = afterPack.pruneExcludedAcpTools(resourcesDir, 'darwin-arm64', { WEPROMPT_KEEP_CODEX: '1' });

    expect(result.removed).toBe(false);
    expect(existsSync(join(acpDir, 'codex-acp'))).toBe(true);
  });

  it('is a no-op when codex-acp is not present', () => {
    const resourcesDir = makeTemp();
    mkdirSync(join(resourcesDir, 'bundled-aioncore', 'win32-x64', 'managed-resources', 'acp'), { recursive: true });

    const result = afterPack.pruneExcludedAcpTools(resourcesDir, 'win32-x64', {});

    expect(result.removed).toBe(false);
  });
});
