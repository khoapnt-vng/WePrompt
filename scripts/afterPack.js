const { Arch } = require('builder-util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const {
  normalizeArch,
  rebuildSingleModule,
  verifyModuleBinary,
  getModulesToRebuild,
} = require('./rebuildNativeModules');
const { verifyBundledAioncoreResources } = require('../packages/shared-scripts/src/verify-bundled-aioncore-resources');

/**
 * afterPack hook for electron-builder
 * Rebuilds native modules for cross-architecture builds
 */

function resolveResourcesDir(electronPlatformName, appOutDir, packager) {
  if (electronPlatformName !== 'darwin') return path.join(appOutDir, 'resources');

  const appName = packager?.appInfo?.productFilename || 'WePrompt';
  return path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
}

function assertBundledRuntimeIsolation(resourcesDir, electronPlatformName, targetArch) {
  const expectedRuntimeKey = `${electronPlatformName}-${targetArch}`;
  const bundledRoot = path.join(resourcesDir, 'bundled-aioncore');
  const entries = fs.existsSync(bundledRoot) ? fs.readdirSync(bundledRoot, { withFileTypes: true }) : [];
  const isExactTarget = entries.length === 1 && entries[0].isDirectory() && entries[0].name === expectedRuntimeKey;

  if (!isExactTarget) {
    const actualEntries =
      entries.map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`).join(', ') || '(none)';
    throw new Error(
      `Packaged app must contain exactly one bundled AionCore runtime (${expectedRuntimeKey}); found: ${actualEntries}`
    );
  }

  return expectedRuntimeKey;
}

function verifyBundledResources(resourcesDir, electronPlatformName, targetArch) {
  assertBundledRuntimeIsolation(resourcesDir, electronPlatformName, targetArch);
  const result = verifyBundledAioncoreResources({
    resourcesDir,
    electronPlatformName,
    targetArch,
  });

  if (result.missing.length > 0) {
    console.error(`   Missing bundled resources: ${result.missing.join(', ')}`);
    throw new Error(`Packaged app is missing required bundled resource(s): ${result.missing.join(', ')}`);
  }

  console.log(`   ✓ Bundled resources verified for ${result.runtimeKey} (${result.checked.length} checks)`);
}

/**
 * Sign the ad-hoc / linker-signed Mach-O binaries shipped inside bundled-aioncore
 * (extraResources) so the packaged app can pass Apple notarization.
 *
 * Why this is needed: electron-builder does NOT code-sign files under `extraResources`.
 * Most bundled binaries (node, codex, claude, officecli) already carry their publisher's
 * Developer ID signature, but a few — the `aioncore` binary and the `rg`/`zsh` tools
 * vendored inside codex — ship with only an ad-hoc linker signature (no Developer ID,
 * no secure timestamp, no hardened runtime), which makes notarytool reject the whole
 * archive. afterPack runs before electron-builder seals the .app, so signing them here
 * lands their fresh hashes in the app's CodeResources.
 */
function runTool(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return { status: result.status ?? 1, output: `${result.stdout || ''}${result.stderr || ''}` };
}

// The codex ACP agent is disabled in this product build. Remove its bundled tool
// (managed-resources/acp/codex-acp) from the packaged app BEFORE signing so its
// vendored, ad-hoc-signed helper binaries (rg, zsh) never ship — after this, aioncore
// is the only Mach-O that still needs a Developer ID signature for notarization.
// Safe at runtime: aioncore resolves ACP tools lazily (only when a codex conversation
// starts, which the UI hides), so a missing codex-acp does not affect startup or any
// other agent. Escape hatch: set WEPROMPT_KEEP_CODEX=1 to keep codex bundled.
function pruneExcludedAcpTools(resourcesDir, runtimeKey, env = process.env) {
  if (env.WEPROMPT_KEEP_CODEX === '1') return { removed: false };
  const codexRoot = path.join(resourcesDir, 'bundled-aioncore', runtimeKey, 'managed-resources', 'acp', 'codex-acp');
  if (!fs.existsSync(codexRoot)) return { removed: false };
  fs.rmSync(codexRoot, { recursive: true, force: true });
  console.log(
    `   ✂️  Removed bundled codex-acp (with its unsigned rg/zsh) from ${runtimeKey} — codex agent disabled in this build`
  );
  return { removed: true };
}

// Only sign for real Developer ID builds — never for internal-release / local ad-hoc
// builds, whose afterSign step intentionally applies (and enforces) an ad-hoc signature.
function shouldSignBundledAioncore(electronPlatformName, env) {
  if (electronPlatformName !== 'darwin') return false;
  if (env.WEPROMPT_INTERNAL_RELEASE === '1') return false;
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') return false;
  return true;
}

function resolveSigningIdentity(env, run) {
  if (typeof env.CSC_NAME === 'string' && env.CSC_NAME.trim() !== '') return env.CSC_NAME.trim();
  const found = run('security', ['find-identity', '-v', '-p', 'codesigning']);
  const match = found.output.match(/"(Developer ID Application:[^"]+)"/);
  return match ? match[1] : null;
}

function listFilesRecursive(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  };
  walk(root);
  return files;
}

function signBundledAioncoreBinaries(resourcesDir, options = {}) {
  const { env = process.env, run = runTool, projectRoot = path.resolve(__dirname, '..'), logger = console } = options;

  const bundledRoot = path.join(resourcesDir, 'bundled-aioncore');
  if (!fs.existsSync(bundledRoot)) return { signed: 0, skipped: 0 };

  const identity = resolveSigningIdentity(env, run);
  if (!identity) {
    logger.warn(
      '   ⚠️  No "Developer ID Application" identity found (set CSC_NAME or add one to the login keychain); skipping bundled-aioncore signing — notarization will fail.'
    );
    return { signed: 0, skipped: 0 };
  }

  const entitlements = path.join(projectRoot, 'entitlements.plist');
  if (!fs.existsSync(entitlements)) {
    throw new Error(`entitlements.plist not found at ${entitlements}`);
  }

  // Deepest path first so nested code is signed before any bundle that contains it.
  const machoFiles = listFilesRecursive(bundledRoot)
    .filter((file) => run('file', ['-b', file]).output.includes('Mach-O'))
    .sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);

  let signed = 0;
  let skipped = 0;
  for (const file of machoFiles) {
    const rel = path.relative(bundledRoot, file);
    if (run('codesign', ['-dvv', file]).output.includes('Authority=Developer ID Application')) {
      skipped++;
      continue;
    }
    const result = run('codesign', [
      '--force',
      '--timestamp',
      '--options',
      'runtime',
      '--entitlements',
      entitlements,
      '--sign',
      identity,
      file,
    ]);
    if (result.status !== 0) {
      throw new Error(`Failed to codesign bundled binary ${rel}: ${result.output.trim()}`);
    }
    const verify = run('codesign', ['-dvv', file]).output;
    if (!/flags=\S*runtime/.test(verify) || !verify.includes('Authority=Developer ID Application')) {
      throw new Error(`Bundled binary ${rel} did not receive a hardened-runtime Developer ID signature`);
    }
    logger.log(`     ✓ signed ${rel}`);
    signed++;
  }

  logger.log(
    `   ✓ bundled-aioncore signing complete (${signed} signed, ${skipped} already Developer ID) with "${identity}"`
  );
  return { signed, skipped };
}

async function afterPack(context) {
  const { arch, electronPlatformName, appOutDir, packager } = context;
  const targetArch = normalizeArch(typeof arch === 'string' ? arch : Arch[arch] || process.arch);
  const buildArch = normalizeArch(os.arch());

  console.log(`\n🔧 afterPack hook started`);
  console.log(`   Platform: ${electronPlatformName}, Build arch: ${buildArch}, Target arch: ${targetArch}`);

  const isCrossCompile = buildArch !== targetArch;
  const forceRebuild = process.env.FORCE_NATIVE_REBUILD === 'true';
  const needsSameArchRebuild = electronPlatformName === 'win32'; // 只有 Windows 需要同架构重建以匹配 Electron ABI | Only Windows needs same-arch rebuild to match Electron ABI
  // Linux 使用预编译二进制，避免 GLIBC 版本依赖 | Linux uses prebuilt binaries which are GLIBC-independent

  const resourcesDir = resolveResourcesDir(electronPlatformName, appOutDir, packager);
  console.log(`   Checking resources directory: ${resourcesDir}`);
  if (fs.existsSync(resourcesDir)) {
    const resourcesContents = fs.readdirSync(resourcesDir);
    console.log(`   Contents: ${resourcesContents.join(', ')}`);

    const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');
    if (fs.existsSync(unpackedDir)) {
      const unpackedContents = fs.readdirSync(unpackedDir);
      console.log(`   app.asar.unpacked contents: ${unpackedContents.join(', ')}`);

      const nodeModulesDir = path.join(unpackedDir, 'node_modules');
      if (fs.existsSync(nodeModulesDir)) {
        const modulesContents = fs.readdirSync(nodeModulesDir);
        console.log(`   node_modules contents: ${modulesContents.slice(0, 10).join(', ')}...`);
      } else {
        console.warn(`   ⚠️  node_modules not found in app.asar.unpacked`);
      }
    } else {
      console.warn(`   ⚠️  app.asar.unpacked not found`);
    }

    verifyBundledResources(resourcesDir, electronPlatformName, targetArch);

    // Drop the disabled codex agent's bundle BEFORE signing so its unsigned vendored
    // rg/zsh binaries never ship (notarization then only needs the aioncore binary).
    pruneExcludedAcpTools(resourcesDir, `${electronPlatformName}-${targetArch}`);

    // Notarization prerequisite: sign the ad-hoc bundled-aioncore binaries that
    // electron-builder leaves untouched (extraResources are never auto-signed).
    if (shouldSignBundledAioncore(electronPlatformName, process.env)) {
      console.log(`\n🔏 Signing bundled-aioncore Mach-O binaries for notarization...`);
      signBundledAioncoreBinaries(resourcesDir);
    }
  } else {
    throw new Error(`resources directory not found: ${resourcesDir}`);
  }

  if (!isCrossCompile && !needsSameArchRebuild && !forceRebuild) {
    console.log(`   ✓ Same architecture, rebuild skipped (set FORCE_NATIVE_REBUILD=true to override)\n`);
    return;
  }

  // Note: Previously there was an optimization to skip macOS cross-compilation,
  // but this caused incorrect architecture binaries (arm64) to be included in x64 builds.
  // Now we always rebuild native modules for cross-compilation to ensure correctness.
  // The rebuild process uses prebuild-install first (fast), falling back to source compilation only when needed.

  if (isCrossCompile) {
    console.log(`   ⚠️  Cross-compilation detected (${buildArch} → ${targetArch}), will rebuild native modules`);
    if (electronPlatformName === 'darwin') {
      console.log(`   💡 Using prebuild-install for faster cross-architecture build`);
    }
  } else if (needsSameArchRebuild || forceRebuild) {
    console.log(`   ℹ️  Rebuilding native modules for platform requirements (force=${forceRebuild})`);
  }

  console.log(`\n🔧 Checking native modules (${electronPlatformName}-${targetArch})...`);
  console.log(`   appOutDir: ${appOutDir}`);

  const electronVersion =
    packager?.info?.electronVersion ??
    packager?.config?.electronVersion ??
    require('../package.json').devDependencies?.electron?.replace(/^\D*/, '');

  const nodeModulesDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules');

  // Modules that need to be rebuilt for cross-compilation
  // Use platform-specific module list (Windows skips node-pty due to cross-compilation issues)
  const modulesToRebuild = getModulesToRebuild(electronPlatformName);
  console.log(`   Modules to rebuild: ${modulesToRebuild.join(', ')}`);

  // For cross-compilation, clean up build artifacts from the wrong architecture
  // This prevents node-gyp-build from loading incorrect binaries
  if (isCrossCompile) {
    console.log(`\n🧹 Cleaning up wrong-architecture build artifacts...`);
    for (const moduleName of modulesToRebuild) {
      const moduleRoot = path.join(nodeModulesDir, moduleName);
      if (!fs.existsSync(moduleRoot)) continue;

      // Remove build/ directory (contains wrong-arch compiled binaries)
      const buildDir = path.join(moduleRoot, 'build');
      if (fs.existsSync(buildDir)) {
        fs.rmSync(buildDir, { recursive: true, force: true });
        console.log(`   ✓ Removed ${moduleName}/build/`);
      }

      // Remove bin/ directory (might contain wrong-arch binaries)
      const binDir = path.join(moduleRoot, 'bin');
      if (fs.existsSync(binDir)) {
        fs.rmSync(binDir, { recursive: true, force: true });
        console.log(`   ✓ Removed ${moduleName}/bin/`);
      }
    }

    // Also clean up architecture-specific packages that shouldn't be included
    // Remove packages for the opposite architecture of the target
    const wrongArchSuffix = targetArch === 'arm64' ? 'x64' : 'arm64';
    console.log(`\n🧹 Removing ${wrongArchSuffix}-specific optional dependencies (target: ${targetArch})...`);

    if (fs.existsSync(nodeModulesDir)) {
      const allModules = fs.readdirSync(nodeModulesDir);
      for (const module of allModules) {
        const modulePath = path.join(nodeModulesDir, module);

        // Handle scoped packages (e.g., @lydell, @napi-rs)
        if (module.startsWith('@') && fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) {
          const scopedPackages = fs.readdirSync(modulePath);
          for (const pkg of scopedPackages) {
            if (pkg.includes(`-${wrongArchSuffix}`) || pkg.includes(`-${electronPlatformName}-${wrongArchSuffix}`)) {
              const pkgPath = path.join(modulePath, pkg);
              if (fs.existsSync(pkgPath) && fs.statSync(pkgPath).isDirectory()) {
                fs.rmSync(pkgPath, { recursive: true, force: true });
                console.log(`   ✓ Removed ${module}/${pkg}`);
              }
            }
          }
        }
        // Handle regular packages
        else if (
          module.includes(`-${wrongArchSuffix}`) ||
          module.includes(`-${electronPlatformName}-${wrongArchSuffix}`)
        ) {
          if (fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) {
            fs.rmSync(modulePath, { recursive: true, force: true });
            console.log(`   ✓ Removed ${module}`);
          }
        }
      }
    }
  }

  const failedModules = [];

  for (const moduleName of modulesToRebuild) {
    const moduleRoot = path.join(nodeModulesDir, moduleName);

    if (!fs.existsSync(moduleRoot)) {
      console.warn(`   ⚠️  ${moduleName} not found, skipping`);
      continue;
    }

    console.log(`   ✓ Found ${moduleName}, rebuilding for ${targetArch}...`);

    // For Windows, prefer prebuild-install first (faster and more reliable in CI)
    // electron-rebuild can hang on "Searching dependency tree" in some CI environments
    // prebuild-install will fall back to electron-rebuild internally if no prebuilt binary exists
    const forceRebuildFromSource = false; // Always try prebuild-install first

    const success = rebuildSingleModule({
      moduleName,
      moduleRoot,
      platform: electronPlatformName,
      arch: targetArch,
      electronVersion,
      projectRoot: path.resolve(__dirname, '..'),
      buildArch: buildArch, // Pass build architecture for cross-compile detection
      forceRebuild: forceRebuildFromSource, // Always try prebuild-install first, fallback to rebuild
    });

    if (success) {
      console.log(`     ✓ Rebuild completed`);
    } else {
      console.error(`     ✗ Rebuild failed`);
      failedModules.push(moduleName);
      continue;
    }

    const verified = verifyModuleBinary(moduleRoot, moduleName);
    if (verified) {
      console.log(`     ✓ Binary verification passed`);
    } else {
      console.error(`     ✗ Binary verification failed`);
      failedModules.push(moduleName);
    }

    console.log(''); // Empty line between modules
  }

  if (failedModules.length > 0) {
    throw new Error(`Failed to rebuild modules for ${electronPlatformName}-${targetArch}: ${failedModules.join(', ')}`);
  }

  console.log(`✅ All native modules rebuilt successfully for ${targetArch}\n`);
}

module.exports = afterPack;
module.exports.assertBundledRuntimeIsolation = assertBundledRuntimeIsolation;
module.exports.resolveResourcesDir = resolveResourcesDir;
module.exports.shouldSignBundledAioncore = shouldSignBundledAioncore;
module.exports.resolveSigningIdentity = resolveSigningIdentity;
module.exports.signBundledAioncoreBinaries = signBundledAioncoreBinaries;
module.exports.pruneExcludedAcpTools = pruneExcludedAcpTools;
