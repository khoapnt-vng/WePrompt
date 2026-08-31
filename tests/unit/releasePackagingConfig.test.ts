import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { gte, major } from 'semver';

const projectRoot = resolve(__dirname, '../..');
const itWithBash = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0 ? it : it.skip;

type PresentationTemplateInventoryEntry = {
  id: string;
  format: 'html' | 'pptx' | 'docx';
  packagedReferenceFile: string | null;
};

type PresentationTemplateInventoryModule = {
  readPresentationTemplateInventory: (manifestPath: string) => PresentationTemplateInventoryEntry[];
  expectedPresentationTemplateFiles: (inventory: PresentationTemplateInventoryEntry[]) => string[];
  assertPresentationTemplateResources: (options: {
    inventory: PresentationTemplateInventoryEntry[];
    resourcesDirectory: string;
  }) => string[];
};

const REQUIRED_PRESENTATION_TEMPLATE_INVENTORY: PresentationTemplateInventoryEntry[] = [
  { id: 'editorial-field-report', format: 'html', packagedReferenceFile: null },
  { id: 'simple-light', format: 'html', packagedReferenceFile: null },
  { id: 'simple-dark', format: 'html', packagedReferenceFile: null },
  { id: 'market-trends-report', format: 'html', packagedReferenceFile: null },
  { id: 'business-review', format: 'pptx', packagedReferenceFile: 'business-review.pptx' },
  { id: 'project-kickoff', format: 'pptx', packagedReferenceFile: 'project-kickoff.pptx' },
  { id: 'monthly-steerco', format: 'pptx', packagedReferenceFile: 'monthly-steerco.pptx' },
  { id: 'connected-ops', format: 'pptx', packagedReferenceFile: 'connected-ops.pptx' },
  { id: 'business-report', format: 'docx', packagedReferenceFile: 'business-report.docx' },
  { id: 'decision-memo', format: 'docx', packagedReferenceFile: 'decision-memo.docx' },
  { id: 'operations-guide', format: 'docx', packagedReferenceFile: 'operations-guide.docx' },
  { id: 'proposal-sow', format: 'docx', packagedReferenceFile: 'proposal-sow.docx' },
];

const EXPECTED_PRESENTATION_TEMPLATE_FILES = REQUIRED_PRESENTATION_TEMPLATE_INVENTORY.flatMap((entry) =>
  entry.packagedReferenceFile ? [entry.packagedReferenceFile] : []
);

function loadPresentationTemplateInventoryModule(): PresentationTemplateInventoryModule {
  const projectRequire = createRequire(resolve(projectRoot, 'package.json'));
  return projectRequire(
    resolve(projectRoot, 'packages/shared-scripts/src/presentation-template-inventory.js')
  ) as PresentationTemplateInventoryModule;
}

function createInventoryManifest(contents: unknown): { root: string; manifestPath: string } {
  const root = mkdtempSync(resolve(tmpdir(), 'weprompt-template-inventory-'));
  const manifestPath = resolve(root, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(contents, null, 2)}\n`);
  return { root, manifestPath };
}

function createPresentationTemplateResources(): string {
  const root = mkdtempSync(resolve(tmpdir(), 'weprompt-template-resources-'));
  writeFileSync(resolve(root, 'manifest.json'), `${JSON.stringify(REQUIRED_PRESENTATION_TEMPLATE_INVENTORY)}\n`);
  for (const fileName of EXPECTED_PRESENTATION_TEMPLATE_FILES) {
    writeFileSync(resolve(root, fileName), fileName);
  }
  return root;
}

function readProjectFile(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

function readProjectJson<T>(path: string): T {
  return JSON.parse(readProjectFile(path)) as T;
}

function readSourceTree(directory: string): string {
  return readdirSync(resolve(projectRoot, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = join(directory, entry.name);
      if (entry.isDirectory()) return [readSourceTree(relativePath)];
      return /\.tsx?$/.test(entry.name) ? [readProjectFile(relativePath)] : [];
    })
    .join('\n');
}

function yamlBlock(content: string, key: string): string {
  const startMatch = content.match(new RegExp(`^${key}:\\s*$`, 'm'));
  if (!startMatch || startMatch.index === undefined) return '';

  const blockStart = startMatch.index + startMatch[0].length;
  const rest = content.slice(blockStart);
  const nextTopLevelKey = rest.search(/^[a-zA-Z][a-zA-Z0-9]*:\s*$/m);
  return nextTopLevelKey === -1 ? rest : rest.slice(0, nextTopLevelKey);
}

describe('release packaging configuration', () => {
  describe('built-in presentation template inventory', () => {
    it('defines all builtin ids with exact format and packaged reference pairs', () => {
      const { readPresentationTemplateInventory } = loadPresentationTemplateInventoryModule();
      const inventory = readPresentationTemplateInventory(
        resolve(projectRoot, 'packages/desktop/resources/presentation-templates/manifest.json')
      );

      expect(inventory).toEqual(REQUIRED_PRESENTATION_TEMPLATE_INVENTORY);
    });

    it('copies the desktop template resources to the packaged presentation-templates directory', () => {
      const config = readProjectFile('packages/desktop/electron-builder.yml');

      expect(config).toMatch(
        /^\s+- from: packages\/desktop\/resources\/presentation-templates\s*\n\s+to: presentation-templates$/m
      );
      expect(config).not.toMatch(/^\s+- from: resources\/presentation-templates$/m);
    });

    it('derives the exact eight binary references from the inventory', () => {
      const { expectedPresentationTemplateFiles } = loadPresentationTemplateInventoryModule();

      expect(expectedPresentationTemplateFiles(REQUIRED_PRESENTATION_TEMPLATE_INVENTORY)).toEqual(
        EXPECTED_PRESENTATION_TEMPLATE_FILES
      );
    });

    it('keeps the source resource directory identical to the declared binary inventory', () => {
      const { readPresentationTemplateInventory, assertPresentationTemplateResources } =
        loadPresentationTemplateInventoryModule();
      const resourcesDirectory = resolve(projectRoot, 'packages/desktop/resources/presentation-templates');
      const inventory = readPresentationTemplateInventory(resolve(resourcesDirectory, 'manifest.json'));

      expect(assertPresentationTemplateResources({ inventory, resourcesDirectory })).toEqual(
        EXPECTED_PRESENTATION_TEMPLATE_FILES
      );
    });

    it.each([
      {
        caseName: 'duplicate ids',
        inventory: [
          { id: 'duplicate', format: 'html', packagedReferenceFile: null },
          { id: 'duplicate', format: 'pptx', packagedReferenceFile: 'duplicate.pptx' },
        ],
        message: /duplicate template id/i,
      },
      {
        caseName: 'duplicate packaged files',
        inventory: [
          { id: 'first', format: 'pptx', packagedReferenceFile: 'shared.pptx' },
          { id: 'second', format: 'pptx', packagedReferenceFile: 'shared.pptx' },
        ],
        message: /duplicate packaged reference file/i,
      },
      {
        caseName: 'duplicate packaged files that differ only by case',
        inventory: [
          { id: 'first', format: 'pptx', packagedReferenceFile: 'shared.pptx' },
          { id: 'second', format: 'pptx', packagedReferenceFile: 'SHARED.pptx' },
        ],
        message: /duplicate packaged reference file/i,
      },
      {
        caseName: 'a PPTX entry with a DOCX extension',
        inventory: [{ id: 'wrong-extension', format: 'pptx', packagedReferenceFile: 'wrong-extension.docx' }],
        message: /must use the \.pptx extension/i,
      },
      {
        caseName: 'a DOCX entry with a PPTX extension',
        inventory: [{ id: 'wrong-extension', format: 'docx', packagedReferenceFile: 'wrong-extension.pptx' }],
        message: /must use the \.docx extension/i,
      },
      {
        caseName: 'an HTML entry with a packaged reference',
        inventory: [{ id: 'html-with-reference', format: 'html', packagedReferenceFile: 'unexpected.pptx' }],
        message: /html.*null/i,
      },
    ])('rejects $caseName', ({ inventory, message }) => {
      const { readPresentationTemplateInventory } = loadPresentationTemplateInventoryModule();
      const { root, manifestPath } = createInventoryManifest(inventory);

      try {
        expect(() => readPresentationTemplateInventory(manifestPath)).toThrow(message);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it.each(['../escape.pptx', 'nested/escape.pptx', 'nested\\escape.pptx', '/escape.pptx', 'C:\\escape.pptx'])(
      'rejects non-basename packaged reference %s',
      (packagedReferenceFile) => {
        const { readPresentationTemplateInventory } = loadPresentationTemplateInventoryModule();
        const { root, manifestPath } = createInventoryManifest([
          { id: 'unsafe-path', format: 'pptx', packagedReferenceFile },
        ]);

        try {
          expect(() => readPresentationTemplateInventory(manifestPath)).toThrow(/basename/i);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }
    );

    it.each(['Uppercase.pptx', 'under_score.pptx', 'r\u00e9sum\u00e9.pptx', 'colon:name.pptx'])(
      'rejects non-portable packaged reference %s',
      (packagedReferenceFile) => {
        const { readPresentationTemplateInventory } = loadPresentationTemplateInventoryModule();
        const { root, manifestPath } = createInventoryManifest([
          { id: 'non-portable-reference', format: 'pptx', packagedReferenceFile },
        ]);

        try {
          expect(() => readPresentationTemplateInventory(manifestPath)).toThrow();
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }
    );

    it.each([
      { format: 'pptx', packagedReferenceFile: 'con.pptx' },
      { format: 'docx', packagedReferenceFile: 'aux.docx' },
      { format: 'pptx', packagedReferenceFile: 'com1.pptx' },
      { format: 'docx', packagedReferenceFile: 'lpt9.docx' },
    ] as const)('rejects reserved packaged reference $packagedReferenceFile', ({ format, packagedReferenceFile }) => {
      const { readPresentationTemplateInventory } = loadPresentationTemplateInventoryModule();
      const { root, manifestPath } = createInventoryManifest([
        { id: 'reserved-reference', format, packagedReferenceFile },
      ]);

      try {
        expect(() => readPresentationTemplateInventory(manifestPath)).toThrow();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it.each([
      { caseName: 'a non-array root', manifest: { templates: [] }, message: /json array/i },
      {
        caseName: 'an unsupported format',
        manifest: [{ id: 'unsupported', format: 'pdf', packagedReferenceFile: null }],
        message: /unsupported format/i,
      },
      {
        caseName: 'an unexpected entry field',
        manifest: [{ id: 'extra-field', format: 'html', packagedReferenceFile: null, extra: true }],
        message: /exactly.*id.*format.*packagedReferenceFile/i,
      },
    ])('rejects strict-schema violation: $caseName', ({ manifest, message }) => {
      const { readPresentationTemplateInventory } = loadPresentationTemplateInventoryModule();
      const { root, manifestPath } = createInventoryManifest(manifest);

      try {
        expect(() => readPresentationTemplateInventory(manifestPath)).toThrow(message);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('rejects malformed inventory JSON', () => {
      const { readPresentationTemplateInventory } = loadPresentationTemplateInventoryModule();
      const root = mkdtempSync(resolve(tmpdir(), 'weprompt-template-inventory-'));
      const manifestPath = resolve(root, 'manifest.json');
      writeFileSync(manifestPath, '{');

      try {
        expect(() => readPresentationTemplateInventory(manifestPath)).toThrow(/invalid json/i);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('accepts only the exact binary files declared by the inventory', () => {
      const { assertPresentationTemplateResources } = loadPresentationTemplateInventoryModule();
      const resourcesDirectory = createPresentationTemplateResources();

      try {
        expect(
          assertPresentationTemplateResources({
            inventory: REQUIRED_PRESENTATION_TEMPLATE_INVENTORY,
            resourcesDirectory,
          })
        ).toEqual(EXPECTED_PRESENTATION_TEMPLATE_FILES);
      } finally {
        rmSync(resourcesDirectory, { recursive: true, force: true });
      }
    });

    it.each(EXPECTED_PRESENTATION_TEMPLATE_FILES)('rejects resources missing %s', (missingFile) => {
      const { assertPresentationTemplateResources } = loadPresentationTemplateInventoryModule();
      const resourcesDirectory = createPresentationTemplateResources();
      rmSync(resolve(resourcesDirectory, missingFile));

      try {
        expect(() =>
          assertPresentationTemplateResources({
            inventory: REQUIRED_PRESENTATION_TEMPLATE_INVENTORY,
            resourcesDirectory,
          })
        ).toThrow(new RegExp(`missing.*${missingFile.replace('.', '\\.')}`, 'i'));
      } finally {
        rmSync(resourcesDirectory, { recursive: true, force: true });
      }
    });

    it('rejects extra binary reference files', () => {
      const { assertPresentationTemplateResources } = loadPresentationTemplateInventoryModule();
      const resourcesDirectory = createPresentationTemplateResources();
      writeFileSync(resolve(resourcesDirectory, 'unexpected.pptx'), 'unexpected');

      try {
        expect(() =>
          assertPresentationTemplateResources({
            inventory: REQUIRED_PRESENTATION_TEMPLATE_INVENTORY,
            resourcesDirectory,
          })
        ).toThrow(/extra.*unexpected\.pptx/i);
      } finally {
        rmSync(resourcesDirectory, { recursive: true, force: true });
      }
    });

    it('rejects a nested undeclared binary without following the directory', () => {
      const { assertPresentationTemplateResources } = loadPresentationTemplateInventoryModule();
      const resourcesDirectory = createPresentationTemplateResources();
      const unexpectedDirectory = resolve(resourcesDirectory, 'nested-binaries');
      mkdirSync(unexpectedDirectory);
      writeFileSync(resolve(unexpectedDirectory, 'hidden.pptx'), 'unexpected');

      try {
        expect(() =>
          assertPresentationTemplateResources({
            inventory: REQUIRED_PRESENTATION_TEMPLATE_INVENTORY,
            resourcesDirectory,
          })
        ).toThrow(/unexpected director.*nested-binaries/i);
      } finally {
        rmSync(resourcesDirectory, { recursive: true, force: true });
      }
    });

    it('rejects an unexpected empty child directory', () => {
      const { assertPresentationTemplateResources } = loadPresentationTemplateInventoryModule();
      const resourcesDirectory = createPresentationTemplateResources();
      mkdirSync(resolve(resourcesDirectory, 'unexpected-directory'));

      try {
        expect(() =>
          assertPresentationTemplateResources({
            inventory: REQUIRED_PRESENTATION_TEMPLATE_INVENTORY,
            resourcesDirectory,
          })
        ).toThrow(/unexpected director.*unexpected-directory/i);
      } finally {
        rmSync(resourcesDirectory, { recursive: true, force: true });
      }
    });

    it('rejects a directory in place of an expected reference file', () => {
      const { assertPresentationTemplateResources } = loadPresentationTemplateInventoryModule();
      const resourcesDirectory = createPresentationTemplateResources();
      const expectedFile = resolve(resourcesDirectory, EXPECTED_PRESENTATION_TEMPLATE_FILES[0]);
      rmSync(expectedFile);
      mkdirSync(expectedFile);

      try {
        expect(() =>
          assertPresentationTemplateResources({
            inventory: REQUIRED_PRESENTATION_TEMPLATE_INVENTORY,
            resourcesDirectory,
          })
        ).toThrow(/regular file/i);
      } finally {
        rmSync(resourcesDirectory, { recursive: true, force: true });
      }
    });

    it('rejects a symlink in place of an expected reference file', () => {
      const { assertPresentationTemplateResources } = loadPresentationTemplateInventoryModule();
      const resourcesDirectory = createPresentationTemplateResources();
      const expectedFile = resolve(resourcesDirectory, EXPECTED_PRESENTATION_TEMPLATE_FILES[0]);
      const symlinkTarget = resolve(resourcesDirectory, 'reference-target');
      rmSync(expectedFile);
      writeFileSync(symlinkTarget, 'target');
      symlinkSync(symlinkTarget, expectedFile, 'file');

      try {
        expect(() =>
          assertPresentationTemplateResources({
            inventory: REQUIRED_PRESENTATION_TEMPLATE_INVENTORY,
            resourcesDirectory,
          })
        ).toThrow(/symlink/i);
      } finally {
        rmSync(resourcesDirectory, { recursive: true, force: true });
      }
    });
  });

  it('keeps packaging and updater code on the fixed compatible builder runtime', () => {
    const rootPackage = readProjectJson<{
      dependencies: Record<string, string>;
      resolutions: Record<string, string>;
    }>('package.json');
    const projectRequire = createRequire(resolve(projectRoot, 'package.json'));
    const electronBuilderPackagePath = projectRequire.resolve('electron-builder/package.json');
    const electronBuilderRequire = createRequire(electronBuilderPackagePath);
    const appBuilderPackagePath = electronBuilderRequire.resolve('app-builder-lib/package.json');
    const appBuilderRequire = createRequire(appBuilderPackagePath);
    const appBuilderRuntime = appBuilderRequire('builder-util-runtime') as {
      deepAssign?: unknown;
    };
    const appBuilderRuntimePackage = appBuilderRequire('builder-util-runtime/package.json') as { version: string };
    const electronUpdaterPackagePath = projectRequire.resolve('electron-updater/package.json');
    const electronUpdaterRequire = createRequire(electronUpdaterPackagePath);
    const electronUpdaterRuntime = electronUpdaterRequire('builder-util-runtime') as {
      CancellationToken?: unknown;
      deepAssign?: unknown;
    };
    const electronUpdaterRuntimePackage = electronUpdaterRequire('builder-util-runtime/package.json') as {
      version: string;
    };

    expect(rootPackage.dependencies['builder-util-runtime']).toBe('9.7.0');
    expect(rootPackage.resolutions['builder-util-runtime']).toBe('9.7.0');
    expect(appBuilderRuntimePackage.version).toBe('9.7.0');
    expect(appBuilderRuntime.deepAssign).toBeTypeOf('function');
    expect(electronUpdaterRuntimePackage.version).toBe('9.7.0');
    expect(electronUpdaterRuntime.CancellationToken).toBeTypeOf('function');
    expect(electronUpdaterRuntime.deepAssign).toBeTypeOf('function');
  });

  it('locks audited dependency families at or above their fixed release floors', () => {
    const lockfile = readProjectFile('bun.lock');
    const rootPackage = readProjectJson<{
      dependencies: Record<string, string>;
      resolutions: Record<string, string>;
    }>('package.json');
    const lockedVersions = (packageName: string): string[] =>
      [...lockfile.matchAll(new RegExp(`\\["${packageName}@([^"]+)"`, 'g'))].map((match) => match[1]);
    const expectFixed = (packageName: string, floors: Record<number, string>) => {
      const versions = lockedVersions(packageName);
      expect(versions.length, `${packageName} must remain represented in bun.lock`).toBeGreaterThan(0);
      for (const version of versions) {
        const floor = floors[major(version)];
        expect(floor, `${packageName}@${version} has no reviewed security floor`).toBeDefined();
        expect(gte(version, floor), `${packageName}@${version} is below ${floor}`).toBe(true);
      }
    };

    expect(rootPackage.dependencies.sharp).toBe('^0.35.3');
    expect(rootPackage.dependencies['react-router-dom']).toBe('^7.18.2');
    expect(rootPackage.resolutions).toMatchObject({
      'builder-util-runtime': '9.7.0',
      postcss: '^8.5.25',
      tar: '^7.5.22',
    });
    expectFixed('brace-expansion', { 1: '1.1.17', 2: '2.1.3', 5: '5.0.8' });
    expectFixed('builder-util-runtime', { 9: '9.7.0' });
    expectFixed('js-yaml', { 3: '3.15.0', 4: '4.3.0' });
    expectFixed('postcss', { 8: '8.5.18' });
    expectFixed('react-router', { 7: '7.18.2' });
    expectFixed('react-router-dom', { 7: '7.18.2' });
    expectFixed('sharp', { 0: '0.35.0' });
    expectFixed('tar', { 7: '7.5.21' });
  });

  it('uses declarative renderer routing without unstable React Server Component APIs', () => {
    const rootPackage = readProjectJson<{
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    }>('package.json');
    const router = readProjectFile('packages/desktop/src/renderer/components/layout/Router.tsx');
    const desktopSource = readSourceTree('packages/desktop/src');
    const packageNames = [...Object.keys(rootPackage.dependencies), ...Object.keys(rootPackage.devDependencies)];

    expect(router).toContain('<HashRouter>');
    expect(packageNames.some((name) => /^@react-router\/(dev|node|cloudflare|express|serve)$/.test(name))).toBe(false);
    for (const rscApi of [
      'unstable_RSCHydratedRouter',
      'unstable_RSCStaticRouter',
      'unstable_createCallServer',
      'unstable_getRSCStream',
      'unstable_matchRSCServerRequest',
      'unstable_routeRSCServerRequest',
    ]) {
      expect(desktopSource).not.toContain(rscApi);
    }
  }, 30_000);

  it('uses WePrompt as the visible application identity while preserving compatibility identifiers', () => {
    const rootPackage = readProjectJson<{
      author: { email?: string; name: string };
      name: string;
      productName: string;
    }>('package.json');
    const desktopPackage = readProjectJson<{ description: string }>('packages/desktop/package.json');
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const nsisBlock = yamlBlock(config, 'nsis');
    const linuxBlock = yamlBlock(config, 'linux');

    expect(rootPackage).toMatchObject({
      name: 'forge',
      productName: 'WePrompt',
      author: { name: 'VNG Corporation' },
    });
    expect(rootPackage.author.email).toBeUndefined();
    expect(desktopPackage.description).toContain('WePrompt');
    expect(config).toMatch(/^appId:\s+com\.aionui\.app$/m);
    expect(config).toMatch(/^productName:\s+WePrompt$/m);
    expect(config).toMatch(/^executableName:\s+WePrompt$/m);
    expect(config).toMatch(/^\s+- name:\s+WePrompt Protocol$/m);
    expect(config).toMatch(/^\s+- aionui$/m);
    expect(nsisBlock).toMatch(/^\s+shortcutName:\s+\$\{productName\}$/m);
    expect(nsisBlock).toMatch(/^\s+uninstallDisplayName:\s+\$\{productName\}$/m);
    expect(config).toMatch(/^\s+artifactName:\s+\$\{productName\}-\$\{version\}-\$\{os\}-\$\{arch\}\.\$\{ext\}$/m);
    expect(linuxBlock).toMatch(/^\s+Name:\s+WePrompt$/m);
    expect(linuxBlock).toMatch(/^\s+Icon:\s+WePrompt$/m);
  });

  it('keeps mac zip artifacts enabled', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const macBlock = yamlBlock(config, 'mac');

    expect(macBlock).toContain('    - dmg');
    expect(macBlock).toContain('    - zip');
  });

  it('authorizes mac retries from the artifact build lifecycle hook', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');

    expect(config).toContain('artifactBuildStarted: scripts/afterSign.js');
  });

  it('does not build Windows zip artifacts', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const winBlock = yamlBlock(config, 'win');

    expect(winBlock).toContain('    - nsis');
    expect(winBlock).not.toContain('    - zip');
  });

  it('does not embed public publisher metadata in the internal desktop package config', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');

    expect(config).not.toMatch(/^publish:\s*$/m);
    expect(config).not.toContain('publishAutoUpdate');
    expect(config).not.toContain('repo: AionUi');
  });

  it('uploads WePrompt mac zip artifacts and fails when release artifacts are missing', () => {
    const workflow = readProjectFile('.github/workflows/_build-reusable.yml');

    expect(workflow).toContain('out/WePrompt-*-win-*.exe');
    expect(workflow).toContain('out/WePrompt-*-mac-*.dmg');
    expect(workflow).toContain('out/WePrompt-*-linux-*.deb');
    expect(workflow).toContain('out/WePrompt-*-mac-*.zip');
    expect(workflow).not.toContain('out/AionUi-*-mac-*.zip');
    expect(workflow).not.toContain('out/AionUi-*-win32-*.zip');
    expect(workflow).toContain('if-no-files-found: error');
    expect(workflow).toMatch(
      /- name: Verify expected WePrompt artifacts[\s\S]*?WePrompt-\$\{VERSION\}-win-\$\{\{ matrix\.arch \}\}\.exe[\s\S]*?WePrompt-\$\{VERSION\}-mac-\$\{\{ matrix\.arch \}\}\.dmg[\s\S]*?WePrompt-\$\{VERSION\}-mac-\$\{\{ matrix\.arch \}\}\.zip[\s\S]*?WePrompt-\$\{VERSION\}-linux-\$\{\{ matrix\.arch \}\}\.deb/
    );
    expect(workflow).toContain('::error title=Missing build artifact');
  });

  it('keeps the reusable internal build path free of updater and Sentry configuration', () => {
    const workflow = readProjectFile('.github/workflows/_build-reusable.yml');
    const manualWorkflow = readProjectFile('.github/workflows/build-manual.yml');

    expect(workflow).toMatch(/internal_release:\s*\n[\s\S]*?type:\s*boolean/);
    expect(workflow).toContain("WEPROMPT_INTERNAL_RELEASE: ${{ inputs.internal_release && '1' || '0' }}");
    expect(manualWorkflow).toContain('internal_release: true');
    expect(workflow).toMatch(/- name: Resolve Sentry release name\s*\n\s+if: \$\{\{ !inputs\.internal_release \}\}/);
    expect(workflow).toMatch(
      /- name: Configure Sentry source map upload owner\s*\n\s+if: \$\{\{ !inputs\.internal_release \}\}/
    );
    expect(workflow).toMatch(
      /- name: Validate Sentry source map upload configuration\s*\n\s+if: \$\{\{ !inputs\.internal_release && matrix\.platform == 'linux-x64' \}\}/
    );
    expect(workflow).toMatch(
      /- name: Setup macOS code signing \(macOS only\)\s*\n\s+if: \$\{\{ startsWith\(matrix\.platform, 'macos'\) && !inputs\.internal_release \}\}/
    );

    const windowsBuildBlock = workflow.match(
      /- name: Build with electron-builder \(Windows\)([\s\S]*?)(?=\n\s*- name:|\n\s*# Clean up stale disk images)/
    )?.[1];
    const macBuildBlock = workflow.match(
      /- name: Build with electron-builder \(macOS\)([\s\S]*?)(?=\n\s*- name:|\n\s*# Linux)/
    )?.[1];

    expect(windowsBuildBlock).toBeTruthy();
    expect(macBuildBlock).toBeTruthy();
    for (const name of [
      'WEPROMPT_UPDATE_BASE_URL',
      'SENTRY_DSN',
      'SENTRY_AUTH_TOKEN',
      'SENTRY_UPLOAD_SOURCE_MAPS',
      'SENTRY_ORG',
      'SENTRY_PROJECT',
      'SENTRY_RELEASE',
      'CSC_LINK',
      'CSC_KEY_PASSWORD',
      'WIN_CSC_LINK',
      'WIN_CSC_KEY_PASSWORD',
      'BUILD_CERTIFICATE_BASE64',
      'P12_PASSWORD',
      'KEYCHAIN_PASSWORD',
      'APPLE_ID',
      'APPLE_ID_PASSWORD',
      'TEAM_ID',
      'IDENTITY',
      'appleId',
      'appleIdPassword',
      'teamId',
      'identity',
    ]) {
      expect(workflow).toMatch(new RegExp(`Validate internal release environment[\\s\\S]*?${name}`));
    }

    for (const name of ['appleId', 'appleIdPassword', 'teamId', 'identity', 'CSC_NAME']) {
      expect(windowsBuildBlock).not.toContain(`${name}:`);
      expect(macBuildBlock).toContain(`${name}: \${{ !inputs.internal_release && secrets.`);
    }
    expect(macBuildBlock).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'");

    expect(windowsBuildBlock).toContain('$BuildExitCode');
    expect(windowsBuildBlock).toContain('$LASTEXITCODE');
    expect(windowsBuildBlock).toContain('"result=failure"');
    expect(windowsBuildBlock).toContain('exit $BuildExitCode');
    expect(windowsBuildBlock).not.toContain('will not block the workflow');
    expect(macBuildBlock).toContain('out/WePrompt-${VERSION}-mac-${{ matrix.arch }}.dmg');
  });

  it('uses current WePrompt names in platform smoke checks while retaining the Forge install-directory fallback', () => {
    const workflow = readProjectFile('.github/workflows/pr-checks.yml');

    expect(workflow).toContain('WePrompt-*-win-*.exe');
    expect(workflow).toContain('Programs\\Forge\\WePrompt.exe');
    expect(workflow).toContain('Contents/MacOS/WePrompt');
    expect(workflow).not.toContain('Forge-*-win-*.exe');
    expect(workflow).not.toContain('Contents/MacOS/Forge');
  });

  it('blocks local pushes and sprint3 pull requests on reviewed Creative Studio coverage', () => {
    const justfile = readProjectFile('justfile');
    const workflow = readProjectFile('.github/workflows/sprint3-pr-gate.yml');
    const selector = readProjectFile('scripts/select-push-tests.js');
    const pushDependencies = justfile.match(/^push \*ARGS: (.+)$/m)?.[1].split(/\s+/) ?? [];

    /*
     * Run the real selector and read the leg it chooses. `.md` is NOT a safe proxy for
     * "documentation" in this repository: the twelve `presentation-templates/<pack>/THEME.md` files are
     * imported into source with `?raw` and asserted byte-for-byte, and documentation.test.ts reads
     * seven `docs/design/creative-studio-2-*` files and matches exact sentences out of them, and
     * the eleven `tests/eval/fixture/corpus*` documents are the KB retrieval regression corpus
     * whose baseline is computed over their bytes. All three classes must reach the gate; ordinary
     * prose must still skip it, or the optimisation is pointless.
     */
    const legFor = (...files: string[]) =>
      spawnSync('node', ['scripts/select-push-tests.js', '--classify', ...files], {
        cwd: projectRoot,
        encoding: 'utf8',
      }).stdout.trim();
    const decisions = {
      inertProse: legFor('docs/prds/creative-studio/creative-studio-3-bug-list.md'),
      nothingAtAll: legFor(),
      shippedTemplateContent: legFor(
        'packages/desktop/src/process/resources/presentation-templates/business-review/THEME.md'
      ),
      testReadDesignDoc: legFor('docs/design/creative-studio-2-programme-plan.md'),
      testReadGateRecord: legFor('docs/design/creative-studio-2-gates/phase-1.md'),
      testFixtureCorpus: legFor('tests/eval/fixture/corpus/quy-dinh-bao-mat-thong-tin.md'),
      sourceFile: legFor('packages/desktop/src/renderer/pages/studio/StudioPage/index.tsx'),
      prosePlusSource: legFor('docs/prds/x.md', 'packages/desktop/src/main.ts'),
    };

    /*
     * The local push reaches the coverage gate through a selector that skips tests for
     * documentation-only pushes, rather than depending on the recipe directly. What must stay true
     * is that any change able to move coverage still runs the reviewed script — so the selector is
     * held to having exactly one test command, and to deciding on documentation alone.
     *
     * An earlier draft of that selector also had a no-coverage middle leg for changes that touched
     * no coverage-enforced file. That was unsound: deleting a test, or editing a helper a Studio
     * file imports, moves a manifest file's coverage without touching any manifest file. This
     * assertion is what caught it.
     */
    expect({
      localPushReachesTestSelector: pushDependencies.includes('test-for-push'),
      localPushStillRunsRedundantSuite: pushDependencies.includes('test'),
      localGateRunsReviewedScript: /^test-for-push:\s*\n\s+node scripts\/select-push-tests\.js$/m.test(justfile),
      /*
       * Two gates on one machine inflate test durations by one to two orders of magnitude and
       * manufacture timeouts that pass in isolation seconds later, so the coverage leg is taken
       * under a machine-wide lock. Structural on purpose, unlike the decisions below: what must
       * not be lost here is the wiring. That the lock queues rather than fails, and recovers from
       * a gate killed mid-run, is proven behaviourally in tests/unit/build-scripts/pushGateLock.test.ts.
       * The documentation leg returns above this line and takes no lock, because it runs no tests
       * and so contends for nothing.
       */
      localGateSerialisesTheCoverageRun: /withPushGateLock\(\{\}, \(\) => execFileSync\(command\[0\]/.test(selector),
      // The manual recipe runs the same six-minute suite, so it queues behind a push gate rather
      // than running beside it and manufacturing the timeouts both are trying to avoid. CI is
      // deliberately not in this: the workflow calls the package script directly, and one runner
      // has nothing to contend with.
      manualCoverageRecipeSerialises:
        /^test-coverage-creative-studio:\s*\n\s+node packages\/shared-scripts\/src\/push-gate-lock\.js bun run test:coverage:creative-studio$/m.test(
          justfile
        ),
      selectorOnlyEverRunsTheReviewedScript:
        [...selector.matchAll(/bun[^\n]*run['"\s,]+([\w:-]+)/g)].map((match) => match[1]).join() ===
        'test:coverage:creative-studio',
      // The skip rule is pinned by BEHAVIOUR, below, not by matching this file's source text. An
      // earlier version asserted the predicate's exact source line, which a mutation walked
      // straight around: making `classify` return 'none' unconditionally left the predicate's text
      // untouched, so every push — source changes included — ran zero tests and this stayed green.
      selectorDecisions: decisions,
      pullRequestGateRunsReviewedScript: workflow.includes('if bun run test:coverage:creative-studio 2>&1'),
      quarantineCanHideCoverageFailure: !workflow.includes(
        '! grep -Eq \'Coverage for .* does not meet .*threshold\' "$clean"'
      ),
    }).toEqual({
      localPushReachesTestSelector: true,
      localPushStillRunsRedundantSuite: false,
      localGateRunsReviewedScript: true,
      localGateSerialisesTheCoverageRun: true,
      manualCoverageRecipeSerialises: true,
      selectorOnlyEverRunsTheReviewedScript: true,
      selectorDecisions: {
        inertProse: 'none',
        nothingAtAll: 'none',
        shippedTemplateContent: 'coverage',
        testReadDesignDoc: 'coverage',
        testReadGateRecord: 'coverage',
        testFixtureCorpus: 'coverage',
        sourceFile: 'coverage',
        prosePlusSource: 'coverage',
      },
      pullRequestGateRunsReviewedScript: true,
      quarantineCanHideCoverageFailure: false,
    });
  });

  it('re-runs reviewed coverage for an already-pushed HEAD without changing empty unpushed or docs-only decisions', () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), 'weprompt-push-selector-'));
    const remoteRoot = resolve(tempRoot, 'remote.git');
    const workRoot = resolve(tempRoot, 'work');
    const selectorPath = resolve(projectRoot, 'scripts/select-push-tests.js');
    mkdirSync(workRoot);

    const runGit = (cwd: string, ...args: string[]) => {
      const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    const runSelector = () => {
      const result = spawnSync('node', [selectorPath, '--dry-run'], {
        cwd: workRoot,
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };

    try {
      runGit(tempRoot, 'init', '--bare', remoteRoot);
      runGit(workRoot, 'init', '--initial-branch=main');
      runGit(workRoot, 'config', 'user.name', 'Push Selector Test');
      runGit(workRoot, 'config', 'user.email', 'push-selector@example.invalid');
      runGit(workRoot, 'config', 'commit.gpgsign', 'false');

      writeFileSync(resolve(workRoot, 'README.md'), 'baseline\n');
      runGit(workRoot, 'add', 'README.md');
      runGit(workRoot, 'commit', '-m', 'baseline');
      runGit(workRoot, 'remote', 'add', 'origin', remoteRoot);
      runGit(workRoot, 'push', '--set-upstream', 'origin', 'main');

      expect(runSelector()).toBe(
        'pre-push tests: coverage — HEAD already matches its upstream; re-running the reviewed gate'
      );

      writeFileSync(resolve(workRoot, 'temporary.txt'), 'temporary\n');
      runGit(workRoot, 'add', 'temporary.txt');
      runGit(workRoot, 'commit', '-m', 'add temporary file');
      rmSync(resolve(workRoot, 'temporary.txt'));
      runGit(workRoot, 'add', '--all');
      runGit(workRoot, 'commit', '-m', 'remove temporary file');

      expect(runSelector()).toBe('pre-push tests: none — nothing to push');

      mkdirSync(resolve(workRoot, 'docs'));
      writeFileSync(resolve(workRoot, 'docs/note.md'), 'inert prose\n');
      runGit(workRoot, 'add', 'docs/note.md');
      runGit(workRoot, 'commit', '-m', 'document the selector');

      expect(runSelector()).toBe('pre-push tests: none — 1 file(s) changed, all documentation');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it('runs lineage recovery acceptance on architecture-matched native package runners', () => {
    const manualWorkflow = readProjectFile('.github/workflows/build-manual.yml');
    const releaseWorkflow = readProjectFile('.github/workflows/build-and-release.yml');
    const reusableWorkflow = readProjectFile('.github/workflows/_build-reusable.yml');

    for (const workflow of [manualWorkflow, releaseWorkflow]) {
      expect(workflow).toContain('"platform":"macos-arm64","os":"macos-15"');
      expect(workflow).toContain('"platform":"macos-x64","os":"macos-15-intel"');
    }
    expect(reusableWorkflow).toContain('Verify native migration-lineage recovery');
    expect(reusableWorkflow).toContain('process.arch !== process.env.EXPECTED_ARCH');
    expect(reusableWorkflow).toContain('E2E_PACKAGED: 1');
    expect(reusableWorkflow).toContain('--grep "migration-lineage rejection"');
  });

  it('keeps desktop release assets on WePrompt names without renaming web-cli artifacts', () => {
    const prepareScript = readProjectFile('scripts/prepare-release-assets.sh');
    const verifyScript = readProjectFile('scripts/verify-release-assets.sh');
    const mockScript = readProjectFile('scripts/create-mock-release-artifacts.sh');
    const ubuntuInstaller = readProjectFile('scripts/install-ubuntu.sh');

    expect(prepareScript).toContain('WePrompt-${VERSION}-mac-${arch}.${ext}');
    expect(verifyScript).toContain('WePrompt-${VERSION}-win-x64.exe');
    expect(verifyScript).toContain('WePrompt-${VERSION}-mac-x64.zip');
    expect(verifyScript).toContain('WePrompt-${VERSION}-mac-arm64.zip');
    expect(mockScript).toContain('WePrompt-1.0.0-linux-x64.deb');
    expect(mockScript).toContain('WePrompt-1.0.0-linux-arm64.deb');
    expect(ubuntuInstaller).toContain('DEB_FILENAME="WePrompt-${VERSION}-linux-${DEB_ARCH}.deb"');

    for (const source of [prepareScript, verifyScript, mockScript]) {
      expect(source).not.toMatch(/AionUi-(?:1\.0\.0|\$\{VERSION\})/);
    }
    for (const source of [prepareScript, verifyScript, mockScript]) {
      expect(source).toContain('aionui-web-');
      expect(source).not.toContain('weprompt-web-');
    }
  });

  it('discovers only the current WePrompt executable while retaining legacy cleanup names', () => {
    const launchHarness = readProjectFile('scripts/packaged-launch.mjs');
    const e2eFixtures = readProjectFile('tests/e2e/fixtures.ts');

    for (const source of [launchHarness, e2eFixtures]) {
      expect(source).toContain("'WePrompt.exe'");
      expect(source).toContain("'Contents', 'MacOS', 'WePrompt'");
      expect(source).not.toMatch(/path\.join\([^\n]*'AionUi\.exe'/);
      expect(source).not.toMatch(/path\.join\([^\n]*'MacOS', 'AionUi'/);
    }

    expect(launchHarness).toContain("killProcessByName('Forge.exe')");
    expect(launchHarness).toContain("killProcessByName('AionUi.exe')");
  });

  it('retries mac prepackaged builds with both dmg and zip targets', () => {
    const script = readProjectFile('scripts/build-with-builder.js');

    expect(script).toMatch(/--mac\s+dmg\s+zip\s+--\$\{targetArch\}\s+--prepackaged/);
  });

  it('uses the nested local-date log path contract in both startup benchmarks', () => {
    const benchmarkScripts = ['scripts/benchmark-acp-startup.ts', 'scripts/benchmark-startup.ts'];

    for (const benchmarkScript of benchmarkScripts) {
      const source = readProjectFile(benchmarkScript);
      expect(source, `${benchmarkScript} should use the shared nested-date helper`).toContain(
        'buildBenchmarkLogRelativePath'
      );
      expect(source, `${benchmarkScript} should not derive dates in UTC`).not.toContain('toISOString().slice(0, 10)');
    }
  });

  for (const arch of ['x64', 'arm64']) {
    itWithBash(`fails release asset preparation when the ${arch} mac zip is missing`, () => {
      const tempDir = mkdtempSync(resolve(tmpdir(), 'weprompt-release-assets-'));
      const artifactsDir = resolve(tempDir, 'build-artifacts');
      const outputDir = resolve(tempDir, 'release-assets');

      try {
        const env = { ...process.env, MOCK_VERSION: '1.0.0' };
        const createResult = spawnSync('bash', ['scripts/create-mock-release-artifacts.sh', artifactsDir], {
          cwd: projectRoot,
          env,
          encoding: 'utf8',
        });
        expect(createResult.status).toBe(0);

        rmSync(resolve(artifactsDir, `macos-build-${arch}`, `WePrompt-1.0.0-mac-${arch}.zip`), { force: true });

        const prepareResult = spawnSync('bash', ['scripts/prepare-release-assets.sh', artifactsDir, outputDir], {
          cwd: projectRoot,
          env,
          encoding: 'utf8',
        });

        expect(prepareResult.status).not.toBe(0);
        expect(`${prepareResult.stdout}\n${prepareResult.stderr}`).toContain(
          `Missing macOS zip artifact: WePrompt-1.0.0-mac-${arch}.zip`
        );
      } finally {
        rmSync(tempDir, { force: true, recursive: true });
      }
    });
  }

  itWithBash('prepares and verifies the complete WePrompt release fixture', () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'weprompt-release-assets-'));
    const artifactsDir = resolve(tempDir, 'build-artifacts');
    const outputDir = resolve(tempDir, 'release-assets');

    try {
      const env = { ...process.env, MOCK_VERSION: '1.0.0' };
      const createResult = spawnSync('bash', ['scripts/create-mock-release-artifacts.sh', artifactsDir], {
        cwd: projectRoot,
        env,
        encoding: 'utf8',
      });
      const prepareResult = spawnSync('bash', ['scripts/prepare-release-assets.sh', artifactsDir, outputDir], {
        cwd: projectRoot,
        env,
        encoding: 'utf8',
      });
      const verifyResult = spawnSync('bash', ['scripts/verify-release-assets.sh', outputDir], {
        cwd: projectRoot,
        env,
        encoding: 'utf8',
      });

      expect(createResult.status).toBe(0);
      expect(prepareResult.status).toBe(0);
      expect(verifyResult.status).toBe(0);
      expect(verifyResult.stdout).toContain('ALL CHECKS PASSED');
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
