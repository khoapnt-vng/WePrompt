import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const {
  acceptedMigrationLineage,
  getAcceptedMigrationLineageManifest,
  verifyBundledAioncoreResources,
} = require('../../../packages/shared-scripts/src/verify-bundled-aioncore-resources');

const CODEX_ENTRYPOINT = 'node_modules/@agentclientprotocol/codex-acp/dist/index.js';
const CLAUDE_ENTRYPOINT = 'node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js';
const CODEX_WIN32_X64_EXECUTABLE = 'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe';
const CLAUDE_WIN32_X64_EXECUTABLE = 'node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe';

function writeFile(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, '', { flush: true });
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flush: true });
}

function linkDirectory(target: string, linkPath: string) {
  symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function createManagedAcpToolFixture({
  managedResourcesDir,
  toolId,
  version,
  runtimeKey,
  entrypoint,
  platformExecutable,
}: {
  managedResourcesDir: string;
  toolId: string;
  version: string;
  runtimeKey: string;
  entrypoint: string;
  platformExecutable: string;
}) {
  const platformRoot = join(managedResourcesDir, 'acp', toolId, version, runtimeKey);

  writeJson(join(platformRoot, 'manifest.json'), { entrypoint, path_entries: ['node_modules/.bin'] });
  writeFile(join(platformRoot, entrypoint));
  writeJson(join(platformRoot, 'package.json'), {});
  writeJson(join(platformRoot, 'package-lock.json'), {});
  mkdirSync(join(platformRoot, 'node_modules'), { recursive: true });
  mkdirSync(join(platformRoot, 'node_modules', '.bin'), { recursive: true });
  writeFile(join(platformRoot, platformExecutable));

  return platformRoot;
}

function contractTool({
  slug,
  version,
  packageName,
  runtimeKey,
  entrypoint,
  platformExecutable,
}: {
  slug: string;
  version: string;
  packageName: string;
  runtimeKey: string;
  entrypoint: string;
  platformExecutable: string;
}) {
  return {
    slug,
    version,
    packageName,
    root: `acp/${slug}/${version}/${runtimeKey}`,
    platformDirectory: runtimeKey,
    manifest: 'manifest.json',
    entrypoint,
    pathEntries: ['node_modules/.bin'],
    requiredFiles: ['package.json', 'package-lock.json'],
    requiredDirectories: ['node_modules'],
    platformExecutable,
  };
}

function writeManagedResourcesContract(managedResourcesDir: string, runtimeKey = 'win32-x64') {
  writeJson(join(managedResourcesDir, 'manifest.json'), {
    schemaVersion: 1,
    runtimeKey,
    node: {
      version: '24.11.0',
      root: 'node/node-v24.11.0-win-x64',
      executable: 'node.exe',
    },
    acpTools: [
      contractTool({
        slug: 'codex-acp',
        version: '1.1.2',
        packageName: '@agentclientprotocol/codex-acp',
        runtimeKey,
        entrypoint: CODEX_ENTRYPOINT,
        platformExecutable: CODEX_WIN32_X64_EXECUTABLE,
      }),
      contractTool({
        slug: 'claude-agent-acp',
        version: '0.58.1',
        packageName: '@agentclientprotocol/claude-agent-acp',
        runtimeKey,
        entrypoint: CLAUDE_ENTRYPOINT,
        platformExecutable: CLAUDE_WIN32_X64_EXECUTABLE,
      }),
    ],
  });
}

function createSchema2ManagedResourcesFixture(managedResourcesDir: string) {
  rmSync(managedResourcesDir, { recursive: true, force: true });

  const manifestPath = join(managedResourcesDir, 'manifest.json');
  const nodeRoot = join(managedResourcesDir, 'node', 'node-v24.11.0-win-x64');
  const claudeRoot = join(managedResourcesDir, 'cli', 'claude', '2.1.215', 'win32-x64');
  const codexRoot = join(managedResourcesDir, 'cli', 'codex', '0.144.6', 'win32-x64');
  const codexPlatformRoot = join(codexRoot, 'vendor', 'x86_64-pc-windows-msvc');
  const codexRequiredFile = join(codexPlatformRoot, 'codex-path', 'rg.exe');
  const codexRequiredDirectory = join(codexPlatformRoot, 'codex-resources');
  const manifest = {
    schemaVersion: 2,
    runtimeKey: 'win32-x64',
    node: {
      version: '24.11.0',
      root: 'node/node-v24.11.0-win-x64',
      executable: 'node.exe',
    },
    clis: [
      {
        name: 'claude',
        version: '2.1.215',
        root: 'cli/claude/2.1.215/win32-x64',
        platformDirectory: 'win32-x64',
        executable: 'claude.exe',
        requiredFiles: [],
        requiredDirectories: [],
      },
      {
        name: 'codex',
        version: '0.144.6',
        root: 'cli/codex/0.144.6/win32-x64',
        platformDirectory: 'win32-x64',
        executable: 'vendor/x86_64-pc-windows-msvc/bin/codex.exe',
        requiredFiles: ['vendor/x86_64-pc-windows-msvc/codex-path/rg.exe'],
        requiredDirectories: ['vendor/x86_64-pc-windows-msvc/codex-resources'],
      },
    ],
  };

  writeFile(join(nodeRoot, 'node.exe'));
  writeFile(join(claudeRoot, 'claude.exe'));
  writeFile(join(codexPlatformRoot, 'bin', 'codex.exe'));
  writeFile(codexRequiredFile);
  mkdirSync(codexRequiredDirectory, { recursive: true });
  writeJson(manifestPath, manifest);

  return {
    manifest,
    manifestPath,
    nodeExecutable: join(nodeRoot, 'node.exe'),
    claudeRoot,
    claudeExecutable: join(claudeRoot, 'claude.exe'),
    codexRequiredFile,
    codexRequiredDirectory,
  };
}

describe('verifyBundledAioncoreResources', () => {
  let tmp: string;
  let resourcesDir: string;
  let managedResourcesDir: string;
  let codexRoot: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'aionui-bundled-resources-'));
    resourcesDir = join(tmp, 'resources');
    managedResourcesDir = join(resourcesDir, 'bundled-aioncore', 'win32-x64', 'managed-resources');

    mkdirSync(join(resourcesDir, 'bundled-aioncore', 'win32-x64'), { recursive: true });
    writeFile(join(resourcesDir, 'bundled-aioncore', 'win32-x64', 'aioncore.exe'));
    writeJson(join(resourcesDir, 'bundled-aioncore', 'win32-x64', 'manifest.json'), {
      platform: 'win32',
      arch: 'x64',
      migrationLineage: getAcceptedMigrationLineageManifest(),
    });
    writeJson(join(resourcesDir, 'bundled-aioncore', 'win32-x64', 'migration-lineage.json'), acceptedMigrationLineage);

    writeFile(join(managedResourcesDir, 'node', 'node-v24.11.0-win-x64', 'node.exe'));
    codexRoot = createManagedAcpToolFixture({
      managedResourcesDir,
      toolId: 'codex-acp',
      version: '1.1.2',
      runtimeKey: 'win32-x64',
      entrypoint: CODEX_ENTRYPOINT,
      platformExecutable: CODEX_WIN32_X64_EXECUTABLE,
    });
    createManagedAcpToolFixture({
      managedResourcesDir,
      toolId: 'claude-agent-acp',
      version: '0.58.1',
      runtimeKey: 'win32-x64',
      entrypoint: CLAUDE_ENTRYPOINT,
      platformExecutable: CLAUDE_WIN32_X64_EXECUTABLE,
    });
    writeManagedResourcesContract(managedResourcesDir);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('passes when the managed resources contract points to existing resources', () => {
    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.runtimeKey).toBe('win32-x64');
    expect(result.missing).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('uses the caller-provided migration lineage instead of the module singleton', () => {
    const expectedMigrationLineage = { ...acceptedMigrationLineage, fingerprint: '0'.repeat(64) };
    writeJson(join(resourcesDir, 'bundled-aioncore', 'win32-x64', 'migration-lineage.json'), expectedMigrationLineage);
    writeJson(join(resourcesDir, 'bundled-aioncore', 'win32-x64', 'manifest.json'), {
      platform: 'win32',
      arch: 'x64',
      migrationLineage: {
        ...expectedMigrationLineage,
        entries: expectedMigrationLineage.entries.map((entry: Record<string, unknown>) => ({ ...entry })),
        file: 'migration-lineage.json',
      },
    });

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
      expectedMigrationLineage,
    });

    expect(result.missing).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('fails closed when the bundled runtime has no migration lineage contract', () => {
    rmSync(join(resourcesDir, 'bundled-aioncore', 'win32-x64', 'migration-lineage.json'));
    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: 'migration-lineage',
        reason: 'missing_file',
      })
    );
  });

  it.each([
    [
      'gapped',
      (entries: Array<{ version: number; description: string; checksum: string }>) =>
        entries.filter((entry) => entry.version !== 20),
    ],
    [
      'changed',
      (entries: Array<{ version: number; description: string; checksum: string }>) =>
        entries.map((entry) => (entry.version === 20 ? { ...entry, checksum: '0'.repeat(96) } : entry)),
    ],
  ])('fails closed when migration lineage is %s', (_reason, changeEntries) => {
    writeJson(join(resourcesDir, 'bundled-aioncore', 'win32-x64', 'migration-lineage.json'), {
      ...acceptedMigrationLineage,
      entries: changeEntries(acceptedMigrationLineage.entries),
    });

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({ component: 'migration-lineage', reason: 'lineage_mismatch' })
    );
  });

  it('fails when managed resources contract is missing', () => {
    rmSync(join(managedResourcesDir, 'manifest.json'));

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain('bundled-aioncore/win32-x64/managed-resources/manifest.json');
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: 'managed-resources',
        reason: 'missing_file',
      })
    );
  });

  it('fails closed when the managed resources contract is not a regular file', () => {
    const manifestPath = join(managedResourcesDir, 'manifest.json');
    rmSync(manifestPath);
    mkdirSync(manifestPath);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain('bundled-aioncore/win32-x64/managed-resources/manifest.json<invalid_file_type>');
    expect(result.failures).toContainEqual(expect.objectContaining({ reason: 'invalid_file_type' }));
  });

  it('fails when only an old Codex ACP version exists even if it is structurally complete', () => {
    rmSync(join(managedResourcesDir, 'acp', 'codex-acp', '1.1.2'), { recursive: true, force: true });
    createManagedAcpToolFixture({
      managedResourcesDir,
      toolId: 'codex-acp',
      version: '0.16.0',
      runtimeKey: 'win32-x64',
      entrypoint: CODEX_ENTRYPOINT,
      platformExecutable: CODEX_WIN32_X64_EXECUTABLE,
    });

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain(
      'bundled-aioncore/win32-x64/managed-resources/acp/codex-acp/1.1.2/win32-x64/manifest.json'
    );
  });

  it('fails when contract node root points to the required version but only a wrong node directory exists', () => {
    rmSync(join(managedResourcesDir, 'node', 'node-v24.11.0-win-x64'), { recursive: true, force: true });
    writeFile(join(managedResourcesDir, 'node', 'node-v20.0.0-win-x64', 'node.exe'));

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain(
      'bundled-aioncore/win32-x64/managed-resources/node/node-v24.11.0-win-x64/node.exe'
    );
  });

  it('ignores unknown contract fields but rejects duplicate tool slugs', () => {
    const manifestPath = join(managedResourcesDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.extraDiagnostic = { ignored: true };
    manifest.acpTools.push({ ...manifest.acpTools[0] });
    writeJson(manifestPath, manifest);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: 'codex-acp',
        reason: 'duplicate_tool_slug',
      })
    );
    expect(result.missing).toContain('bundled-aioncore/win32-x64/managed-resources/manifest.json<contract_failure>');
  });

  it('fails when the contract is invalid JSON', () => {
    writeFileSync(join(managedResourcesDir, 'manifest.json'), '{');

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(expect.objectContaining({ reason: 'invalid_json' }));
  });

  it('fails when the contract schema version is unsupported', () => {
    const manifestPath = join(managedResourcesDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.schemaVersion = 3;
    writeJson(manifestPath, manifest);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(expect.objectContaining({ reason: 'unsupported_schema_version' }));
  });

  it('fails when required contract fields have invalid types', () => {
    const manifestPath = join(managedResourcesDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.node.root = 42;
    writeJson(manifestPath, manifest);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(expect.objectContaining({ reason: 'invalid_schema' }));
  });

  it('fails when a tool platform directory does not match the runtime key', () => {
    const manifestPath = join(managedResourcesDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.acpTools[0].platformDirectory = 'linux-x64';
    writeJson(manifestPath, manifest);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(expect.objectContaining({ reason: 'runtime_key_mismatch' }));
  });

  it('fails when a local tool manifest entrypoint disagrees with the contract', () => {
    writeJson(join(codexRoot, 'manifest.json'), {
      entrypoint: 'node_modules/@agentclientprotocol/codex-acp/dist/other.js',
      path_entries: ['node_modules/.bin'],
    });

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: 'codex-acp',
        reason: 'manifest_entrypoint_mismatch',
      })
    );
  });

  it('rejects a schema-1 tool root symlink that resolves outside managed resources', () => {
    const outsideCodexRoot = createManagedAcpToolFixture({
      managedResourcesDir: join(tmp, 'outside-managed-resources'),
      toolId: 'codex-acp',
      version: '1.1.2',
      runtimeKey: 'win32-x64',
      entrypoint: CODEX_ENTRYPOINT,
      platformExecutable: CODEX_WIN32_X64_EXECUTABLE,
    });
    rmSync(codexRoot, { recursive: true });
    linkDirectory(outsideCodexRoot, codexRoot);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(expect.objectContaining({ component: 'codex-acp', reason: 'escaped_path' }));
  });

  it('passes when a schema-2 manifest declares the bundled node and CLIs', () => {
    createSchema2ManagedResourcesFixture(managedResourcesDir);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.checked).toContain('bundled-aioncore/win32-x64/managed-resources/manifest.json');
    expect(result.checked).toContain(
      'bundled-aioncore/win32-x64/managed-resources/cli/codex/0.144.6/win32-x64/vendor/x86_64-pc-windows-msvc/codex-path/rg.exe'
    );
  });

  it('passes a darwin-arm64 schema-2 bundle with non-Windows executable paths', () => {
    const darwinResourcesDir = join(tmp, 'darwin-schema-2-resources');
    const runtimeRoot = join(darwinResourcesDir, 'bundled-aioncore', 'darwin-arm64');
    const managedRoot = join(runtimeRoot, 'managed-resources');
    writeFile(join(runtimeRoot, 'aioncore'));
    writeJson(join(runtimeRoot, 'manifest.json'), {
      platform: 'darwin',
      arch: 'arm64',
      migrationLineage: getAcceptedMigrationLineageManifest(),
    });
    writeJson(join(runtimeRoot, 'migration-lineage.json'), acceptedMigrationLineage);
    writeFile(join(managedRoot, 'node', 'node-v24.11.0-darwin-arm64', 'bin', 'node'));
    writeFile(join(managedRoot, 'cli', 'claude', '2.1.215', 'darwin-arm64', 'claude'));
    writeFile(
      join(managedRoot, 'cli', 'codex', '0.144.6', 'darwin-arm64', 'vendor', 'aarch64-apple-darwin', 'bin', 'codex')
    );
    mkdirSync(
      join(managedRoot, 'cli', 'codex', '0.144.6', 'darwin-arm64', 'vendor', 'aarch64-apple-darwin', 'codex-resources'),
      { recursive: true }
    );
    writeJson(join(managedRoot, 'manifest.json'), {
      schemaVersion: 2,
      runtimeKey: 'darwin-arm64',
      node: {
        version: '24.11.0',
        root: 'node/node-v24.11.0-darwin-arm64',
        executable: 'bin/node',
      },
      clis: [
        {
          name: 'claude',
          version: '2.1.215',
          root: 'cli/claude/2.1.215/darwin-arm64',
          platformDirectory: 'darwin-arm64',
          executable: 'claude',
          requiredFiles: [],
          requiredDirectories: [],
        },
        {
          name: 'codex',
          version: '0.144.6',
          root: 'cli/codex/0.144.6/darwin-arm64',
          platformDirectory: 'darwin-arm64',
          executable: 'vendor/aarch64-apple-darwin/bin/codex',
          requiredFiles: [],
          requiredDirectories: ['vendor/aarch64-apple-darwin/codex-resources'],
        },
      ],
    });

    const result = verifyBundledAioncoreResources({
      resourcesDir: darwinResourcesDir,
      electronPlatformName: 'darwin',
      targetArch: 'arm64',
    });

    expect(result.missing).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('reports a missing node executable declared by a schema-2 manifest', () => {
    const fixture = createSchema2ManagedResourcesFixture(managedResourcesDir);
    rmSync(fixture.nodeExecutable);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain(
      'bundled-aioncore/win32-x64/managed-resources/node/node-v24.11.0-win-x64/node.exe'
    );
  });

  it('reports a missing CLI executable declared by a schema-2 manifest', () => {
    const fixture = createSchema2ManagedResourcesFixture(managedResourcesDir);
    rmSync(fixture.claudeExecutable);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain(
      'bundled-aioncore/win32-x64/managed-resources/cli/claude/2.1.215/win32-x64/claude.exe'
    );
  });

  it('reports a missing required CLI file declared by a schema-2 manifest', () => {
    const fixture = createSchema2ManagedResourcesFixture(managedResourcesDir);
    rmSync(fixture.codexRequiredFile);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain(
      'bundled-aioncore/win32-x64/managed-resources/cli/codex/0.144.6/win32-x64/vendor/x86_64-pc-windows-msvc/codex-path/rg.exe'
    );
  });

  it('reports a missing required CLI directory declared by a schema-2 manifest', () => {
    const fixture = createSchema2ManagedResourcesFixture(managedResourcesDir);
    rmSync(fixture.codexRequiredDirectory, { recursive: true });

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain(
      'bundled-aioncore/win32-x64/managed-resources/cli/codex/0.144.6/win32-x64/vendor/x86_64-pc-windows-msvc/codex-resources'
    );
  });

  it('reports schema-2 runtime and CLI platform mismatches', () => {
    const fixture = createSchema2ManagedResourcesFixture(managedResourcesDir);
    fixture.manifest.runtimeKey = 'linux-x64';
    writeJson(fixture.manifestPath, fixture.manifest);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain(
      'bundled-aioncore/win32-x64/managed-resources/manifest.json<runtimeKey:win32-x64>'
    );
    expect(result.missing).toContain(
      'bundled-aioncore/win32-x64/managed-resources/manifest.json<clis[claude].platformDirectory:linux-x64>'
    );
  });

  it('reports a required CLI omitted from a schema-2 manifest', () => {
    const fixture = createSchema2ManagedResourcesFixture(managedResourcesDir);
    fixture.manifest.clis = fixture.manifest.clis.filter((cli) => cli.name !== 'claude');
    writeJson(fixture.manifestPath, fixture.manifest);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain('bundled-aioncore/win32-x64/managed-resources/manifest.json<clis[claude]>');
  });

  it('reports an empty node version in a schema-2 manifest', () => {
    const fixture = createSchema2ManagedResourcesFixture(managedResourcesDir);
    fixture.manifest.node.version = '';
    writeJson(fixture.manifestPath, fixture.manifest);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain('bundled-aioncore/win32-x64/managed-resources/manifest.json<node.version>');
  });

  it('reports an empty CLI version in a schema-2 manifest', () => {
    const fixture = createSchema2ManagedResourcesFixture(managedResourcesDir);
    fixture.manifest.clis[0].version = '';
    writeJson(fixture.manifestPath, fixture.manifest);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain(
      'bundled-aioncore/win32-x64/managed-resources/manifest.json<clis[claude].version>'
    );
  });

  it('reports duplicate CLI names in a schema-2 manifest', () => {
    const fixture = createSchema2ManagedResourcesFixture(managedResourcesDir);
    fixture.manifest.clis[1].name = 'claude';
    writeJson(fixture.manifestPath, fixture.manifest);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain(
      'bundled-aioncore/win32-x64/managed-resources/manifest.json<duplicate-clis[claude]>'
    );
  });

  it('reports a schema-2 runtime key outside the supported contract', () => {
    const unsupportedResourcesDir = join(tmp, 'unsupported-resources');
    const unsupportedRoot = join(unsupportedResourcesDir, 'bundled-aioncore', 'darwin-ia32');
    const unsupportedManagedResourcesDir = join(unsupportedRoot, 'managed-resources');
    writeFile(join(unsupportedRoot, 'aioncore'));
    writeJson(join(unsupportedRoot, 'manifest.json'), { platform: 'darwin', arch: 'ia32' });
    const fixture = createSchema2ManagedResourcesFixture(unsupportedManagedResourcesDir);
    fixture.manifest.runtimeKey = 'darwin-ia32';
    for (const cli of fixture.manifest.clis) cli.platformDirectory = 'darwin-ia32';
    writeJson(fixture.manifestPath, fixture.manifest);

    const result = verifyBundledAioncoreResources({
      resourcesDir: unsupportedResourcesDir,
      electronPlatformName: 'darwin',
      targetArch: 'ia32',
    });

    expect(result.missing).toContain(
      'bundled-aioncore/darwin-ia32/managed-resources/manifest.json<unsupported-runtimeKey:darwin-ia32>'
    );
  });

  it('rejects a declared CLI root symlink that resolves outside managed resources', () => {
    const fixture = createSchema2ManagedResourcesFixture(managedResourcesDir);
    const outsideClaudeRoot = join(tmp, 'outside-claude');
    writeFile(join(outsideClaudeRoot, 'claude.exe'));
    rmSync(fixture.claudeRoot, { recursive: true });
    linkDirectory(outsideClaudeRoot, fixture.claudeRoot);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain(
      'bundled-aioncore/win32-x64/managed-resources/manifest.json<escaped-path:clis[claude].root>'
    );
    expect(result.failures).toContainEqual(expect.objectContaining({ component: 'claude', reason: 'escaped_path' }));
  });

  it('rejects a managed-resources symlink that resolves outside the runtime bundle', () => {
    const outsideManagedResources = join(tmp, 'outside-managed-resources');
    createSchema2ManagedResourcesFixture(outsideManagedResources);
    rmSync(managedResourcesDir, { recursive: true });
    linkDirectory(outsideManagedResources, managedResourcesDir);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain('bundled-aioncore/win32-x64/managed-resources<escaped-path>');
  });

  it('allows a declared resource symlink that resolves inside managed resources', () => {
    const fixture = createSchema2ManagedResourcesFixture(managedResourcesDir);
    const internalTarget = join(managedResourcesDir, 'shared', 'codex-resources');
    mkdirSync(internalTarget, { recursive: true });
    rmSync(fixture.codexRequiredDirectory, { recursive: true });
    linkDirectory(internalTarget, fixture.codexRequiredDirectory);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toEqual([]);
  });

  it.each(['../escape', '/absolute/path', 'C:/absolute/path'])(
    'rejects unsafe schema-2 paths without checking outside the bundle: %s',
    (unsafeRoot) => {
      const fixture = createSchema2ManagedResourcesFixture(managedResourcesDir);
      fixture.manifest.clis[0].root = unsafeRoot;
      writeJson(fixture.manifestPath, fixture.manifest);

      const result = verifyBundledAioncoreResources({
        resourcesDir,
        electronPlatformName: 'win32',
        targetArch: 'x64',
      });

      expect(result.missing).toContain(
        'bundled-aioncore/win32-x64/managed-resources/manifest.json<invalid-path:clis[claude].root>'
      );
    }
  );
});
