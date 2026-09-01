const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const acceptedMigrationLineage = require('./aioncore-migration-lineage.json');

const REQUIRED_ACP_TOOL_SLUGS = ['codex-acp', 'claude-agent-acp'];
const REQUIRED_SCHEMA_2_CLI_NAMES = ['claude', 'codex'];
const SUPPORTED_SCHEMA_2_RUNTIME_KEYS = new Set([
  'win32-x64',
  'win32-arm64',
  'darwin-x64',
  'darwin-arm64',
  'linux-x64',
  'linux-arm64',
]);

function backendBinaryName(platform) {
  return platform === 'win32' ? 'aioncore.exe' : 'aioncore';
}

function normalize(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function bundledPath(runtimeKey, ...parts) {
  return normalize(path.join('bundled-aioncore', runtimeKey, ...parts));
}

function contractBundledPath(runtimeKey, ...parts) {
  return bundledPath(runtimeKey, 'managed-resources', ...parts);
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function realPath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

function isWithinRoot(root, candidate) {
  const relativePath = path.relative(root, candidate);
  return (
    relativePath === '' ||
    (relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath))
  );
}

function addFailure(failures, missing, failure, missingValue) {
  failures.push(failure);
  if (missingValue) {
    missing.push(missingValue);
    return;
  }
  if (failure.path) {
    missing.push(
      failure.reason === 'missing_file' || failure.reason === 'missing_directory'
        ? failure.path
        : `${failure.path}<${failure.reason}>`
    );
  }
}

function requireRelativePath(baseDir, runtimeKey, parts, checked, missing, failures) {
  const relativePath = bundledPath(runtimeKey, ...parts);
  checked.push(relativePath);

  if (!isFile(path.join(baseDir, ...parts))) {
    addFailure(failures, missing, { component: 'aioncore', reason: 'missing_file', path: relativePath });
  }
}

function requireRelativeDirectory(baseDir, runtimeKey, parts, checked, missing, failures) {
  const relativePath = bundledPath(runtimeKey, ...parts);
  checked.push(relativePath);

  if (!isDirectory(path.join(baseDir, ...parts))) {
    addFailure(failures, missing, {
      component: 'managed-resources',
      reason: 'missing_directory',
      path: relativePath,
    });
  }
}

function readManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

function verifyBundleManifest(
  baseDir,
  runtimeKey,
  electronPlatformName,
  targetArch,
  expectedMigrationLineage,
  checked,
  missing,
  failures
) {
  const relativePath = bundledPath(runtimeKey, 'manifest.json');
  const manifestPath = path.join(baseDir, 'manifest.json');
  checked.push(relativePath);

  if (!isFile(manifestPath)) {
    addFailure(failures, missing, { component: 'bundle-manifest', reason: 'missing_file', path: relativePath });
    return;
  }

  const manifest = readManifest(manifestPath);
  if (!manifest) {
    addFailure(
      failures,
      missing,
      { component: 'bundle-manifest', reason: 'invalid_json', path: relativePath },
      `${relativePath}<invalid-json>`
    );
    return;
  }

  if (manifest.platform !== electronPlatformName) {
    addFailure(
      failures,
      missing,
      { component: 'bundle-manifest', reason: 'runtime_key_mismatch', path: relativePath },
      `${relativePath}<platform:${electronPlatformName}>`
    );
  }

  if (manifest.arch !== targetArch) {
    addFailure(
      failures,
      missing,
      { component: 'bundle-manifest', reason: 'runtime_key_mismatch', path: relativePath },
      `${relativePath}<arch:${targetArch}>`
    );
  }

  const expectedLineage = getMigrationLineageManifest(expectedMigrationLineage);
  if (!isDeepStrictEqual(manifest.migrationLineage, expectedLineage)) {
    addFailure(failures, missing, {
      component: 'migration-lineage',
      reason: 'manifest_mismatch',
      path: relativePath,
    });
  }
}

function getAcceptedMigrationLineageManifest() {
  return getMigrationLineageManifest(acceptedMigrationLineage);
}

function getMigrationLineageManifest(migrationLineage) {
  return {
    ...migrationLineage,
    entries: migrationLineage.entries.map((entry) => ({ ...entry })),
    file: 'migration-lineage.json',
  };
}

function verifyMigrationLineage(baseDir, runtimeKey, expectedMigrationLineage, checked, missing, failures) {
  const relativePath = bundledPath(runtimeKey, 'migration-lineage.json');
  const lineagePath = path.join(baseDir, 'migration-lineage.json');
  checked.push(relativePath);

  if (!isFile(lineagePath)) {
    addFailure(failures, missing, { component: 'migration-lineage', reason: 'missing_file', path: relativePath });
    return;
  }

  const document = readManifest(lineagePath);
  if (!document) {
    addFailure(
      failures,
      missing,
      { component: 'migration-lineage', reason: 'invalid_json', path: relativePath },
      `${relativePath}<invalid-json>`
    );
    return;
  }

  if (!isDeepStrictEqual(document, expectedMigrationLineage)) {
    addFailure(failures, missing, {
      component: 'migration-lineage',
      reason: 'lineage_mismatch',
      path: relativePath,
    });
  }
}

function validateContractRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  return value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function joinContractPath(root, relativePath) {
  return path.join(root, ...relativePath.split('/'));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value) {
  return typeof value === 'string' && value.length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.every((entry) => stringField(entry));
}

function inspectManagedResourcesRoot(baseDir, runtimeKey, missing, failures) {
  const managedResourcesPath = path.join(baseDir, 'managed-resources');
  const relativePath = bundledPath(runtimeKey, 'managed-resources');
  const baseRealPath = realPath(baseDir);
  const managedResourcesRealPath = realPath(managedResourcesPath);

  if (!baseRealPath || !managedResourcesRealPath) return null;
  if (!isWithinRoot(baseRealPath, managedResourcesRealPath)) {
    addFailure(
      failures,
      missing,
      { component: 'managed-resources', reason: 'escaped_path', path: relativePath },
      `${relativePath}<escaped-path>`
    );
    return null;
  }

  return { path: managedResourcesPath, realPath: managedResourcesRealPath };
}

function requireManagedResource({
  managedRoot,
  managedRootRealPath,
  runtimeKey,
  relativePaths,
  kind,
  component,
  version,
  field,
  checked,
  missing,
  failures,
  schema2,
}) {
  const parts = relativePaths.flatMap((relativePath) => relativePath.split('/'));
  const relativePath = contractBundledPath(runtimeKey, ...parts);
  const fullPath = path.join(managedRoot, ...parts);
  checked.push(relativePath);

  const exists = kind === 'file' ? isFile(fullPath) : isDirectory(fullPath);
  if (!exists) {
    addFailure(failures, missing, {
      component,
      reason: kind === 'file' ? 'missing_file' : 'missing_directory',
      version,
      runtimeKey,
      path: relativePath,
    });
    return false;
  }

  const resourceRealPath = realPath(fullPath);
  if (!resourceRealPath || !isWithinRoot(managedRootRealPath, resourceRealPath)) {
    const manifestPath = contractBundledPath(runtimeKey, 'manifest.json');
    addFailure(
      failures,
      missing,
      {
        component,
        reason: 'escaped_path',
        version,
        runtimeKey,
        path: schema2 ? manifestPath : relativePath,
        detail: field,
      },
      schema2 ? `${manifestPath}<escaped-path:${field}>` : `${relativePath}<escaped-path>`
    );
    return false;
  }

  return true;
}

function addSchemaFailure(failures, missing, runtimeKey, component, reason, detail) {
  const manifestPath = contractBundledPath(runtimeKey, 'manifest.json');
  addFailure(failures, missing, {
    component,
    reason,
    path: manifestPath,
    ...(detail ? { detail } : {}),
  });
}

function validateSchema1Path(value, component, field, failures) {
  if (validateContractRelativePath(value)) return true;
  failures.push({ component, reason: 'invalid_contract_path', detail: field });
  return false;
}

function verifyManagedNodeV1(managedRoot, managedRootRealPath, runtimeKey, node, checked, missing, failures) {
  const manifestPath = contractBundledPath(runtimeKey, 'manifest.json');
  if (!isObject(node) || !stringField(node.version) || !stringField(node.root) || !stringField(node.executable)) {
    addFailure(failures, missing, { component: 'managed-node', reason: 'invalid_schema', path: manifestPath });
    return;
  }
  if (
    !validateSchema1Path(node.root, 'managed-node', 'node.root', failures) ||
    !validateSchema1Path(node.executable, 'managed-node', 'node.executable', failures)
  ) {
    return;
  }

  requireManagedResource({
    managedRoot,
    managedRootRealPath,
    runtimeKey,
    relativePaths: [node.root, node.executable],
    kind: 'file',
    component: 'managed-node',
    version: node.version,
    field: 'node.executable',
    checked,
    missing,
    failures,
    schema2: false,
  });
}

function verifyManagedAcpToolsV1(managedRoot, managedRootRealPath, runtimeKey, contract, checked, missing, failures) {
  const manifestPath = contractBundledPath(runtimeKey, 'manifest.json');
  if (!Array.isArray(contract.acpTools)) {
    addFailure(failures, missing, { component: 'managed-resources', reason: 'invalid_schema', path: manifestPath });
    return;
  }

  const seen = new Set();
  const validTools = [];
  for (const tool of contract.acpTools) {
    if (!isObject(tool) || !stringField(tool.slug)) {
      addFailure(failures, missing, { component: 'managed-resources', reason: 'invalid_schema', path: manifestPath });
      continue;
    }
    if (seen.has(tool.slug)) {
      failures.push({ component: tool.slug, reason: 'duplicate_tool_slug' });
      continue;
    }
    seen.add(tool.slug);
    validTools.push(tool);
  }

  for (const requiredSlug of REQUIRED_ACP_TOOL_SLUGS) {
    if (!seen.has(requiredSlug)) failures.push({ component: requiredSlug, reason: 'missing_required_tool' });
  }

  for (const tool of validTools) {
    verifyManagedAcpToolV1(managedRoot, managedRootRealPath, runtimeKey, tool, checked, missing, failures);
  }
}

function verifyManagedAcpToolV1(managedRoot, managedRootRealPath, runtimeKey, tool, checked, missing, failures) {
  const manifestPath = contractBundledPath(runtimeKey, 'manifest.json');
  const requiredStringFields = [
    'version',
    'packageName',
    'root',
    'platformDirectory',
    'manifest',
    'entrypoint',
    'platformExecutable',
  ];
  if (requiredStringFields.some((field) => !stringField(tool[field]))) {
    addFailure(failures, missing, { component: tool.slug, reason: 'invalid_schema', path: manifestPath });
    return;
  }
  if (!stringArray(tool.pathEntries) || !stringArray(tool.requiredFiles) || !stringArray(tool.requiredDirectories)) {
    addFailure(failures, missing, { component: tool.slug, reason: 'invalid_schema', path: manifestPath });
    return;
  }
  if (tool.platformDirectory !== runtimeKey) {
    addFailure(failures, missing, { component: tool.slug, reason: 'runtime_key_mismatch', path: manifestPath });
    return;
  }

  const pathFields = [
    ['root', tool.root],
    ['manifest', tool.manifest],
    ['entrypoint', tool.entrypoint],
    ['platformExecutable', tool.platformExecutable],
    ...tool.pathEntries.map((entry, index) => [`pathEntries[${index}]`, entry]),
    ...tool.requiredFiles.map((entry, index) => [`requiredFiles[${index}]`, entry]),
    ...tool.requiredDirectories.map((entry, index) => [`requiredDirectories[${index}]`, entry]),
  ];
  if (pathFields.some(([field, value]) => !validateSchema1Path(value, tool.slug, field, failures))) return;

  const localManifestRelative = contractBundledPath(runtimeKey, tool.root, tool.manifest);
  const localManifestExists = requireManagedResource({
    managedRoot,
    managedRootRealPath,
    runtimeKey,
    relativePaths: [tool.root, tool.manifest],
    kind: 'file',
    component: tool.slug,
    version: tool.version,
    field: `${tool.slug}.manifest`,
    checked,
    missing,
    failures,
    schema2: false,
  });
  if (!localManifestExists) return;

  const localManifestPath = joinContractPath(joinContractPath(managedRoot, tool.root), tool.manifest);
  const localManifest = readManifest(localManifestPath);
  if (!localManifest) {
    addFailure(
      failures,
      missing,
      {
        component: tool.slug,
        reason: 'invalid_json',
        version: tool.version,
        packageName: tool.packageName,
        runtimeKey,
        path: localManifestRelative,
      },
      `${localManifestRelative}<invalid-json>`
    );
    return;
  }
  if (localManifest.entrypoint !== tool.entrypoint) {
    addFailure(
      failures,
      missing,
      {
        component: tool.slug,
        reason: 'manifest_entrypoint_mismatch',
        version: tool.version,
        packageName: tool.packageName,
        runtimeKey,
        path: localManifestRelative,
      },
      `${localManifestRelative}<manifest_entrypoint_mismatch>`
    );
  }
  const localPathEntries = Array.isArray(localManifest.path_entries) ? localManifest.path_entries : [];
  if (JSON.stringify(localPathEntries) !== JSON.stringify(tool.pathEntries)) {
    addFailure(
      failures,
      missing,
      {
        component: tool.slug,
        reason: 'manifest_path_entries_mismatch',
        version: tool.version,
        packageName: tool.packageName,
        runtimeKey,
        path: localManifestRelative,
      },
      `${localManifestRelative}<manifest_path_entries_mismatch>`
    );
  }

  const requiredResources = [
    ['file', 'entrypoint', tool.entrypoint],
    ...tool.requiredFiles.map((entry, index) => ['file', `requiredFiles[${index}]`, entry]),
    ...tool.requiredDirectories.map((entry, index) => ['directory', `requiredDirectories[${index}]`, entry]),
    ['file', 'platformExecutable', tool.platformExecutable],
  ];
  for (const [kind, field, relativePath] of requiredResources) {
    requireManagedResource({
      managedRoot,
      managedRootRealPath,
      runtimeKey,
      relativePaths: [tool.root, relativePath],
      kind,
      component: tool.slug,
      version: tool.version,
      field: `${tool.slug}.${field}`,
      checked,
      missing,
      failures,
      schema2: false,
    });
  }
}

function verifyManagedResourcesV1(managedRoot, managedRootRealPath, runtimeKey, contract, checked, missing, failures) {
  const manifestPath = contractBundledPath(runtimeKey, 'manifest.json');
  if (contract.runtimeKey !== runtimeKey) {
    addFailure(failures, missing, {
      component: 'managed-resources',
      reason: 'runtime_key_mismatch',
      path: manifestPath,
    });
    return;
  }
  if (!isObject(contract.node)) {
    addFailure(failures, missing, { component: 'managed-resources', reason: 'invalid_schema', path: manifestPath });
    return;
  }

  verifyManagedNodeV1(managedRoot, managedRootRealPath, runtimeKey, contract.node, checked, missing, failures);
  verifyManagedAcpToolsV1(managedRoot, managedRootRealPath, runtimeKey, contract, checked, missing, failures);
}

function schema2ManifestProblem(runtimeKey, problem) {
  return `${contractBundledPath(runtimeKey, 'manifest.json')}<${problem}>`;
}

function addSchema2Problem(failures, missing, runtimeKey, component, reason, problem, detail) {
  addFailure(
    failures,
    missing,
    {
      component,
      reason,
      path: contractBundledPath(runtimeKey, 'manifest.json'),
      ...(detail ? { detail } : {}),
    },
    schema2ManifestProblem(runtimeKey, problem)
  );
}

function readSchema2Path(runtimeKey, value, component, field, missing, failures) {
  if (validateContractRelativePath(value)) return value;
  addSchema2Problem(failures, missing, runtimeKey, component, 'invalid_contract_path', `invalid-path:${field}`, field);
  return null;
}

function requireSchema2Resource({
  managedRoot,
  managedRootRealPath,
  runtimeKey,
  root,
  relativePath,
  kind,
  component,
  version,
  field,
  checked,
  missing,
  failures,
}) {
  return requireManagedResource({
    managedRoot,
    managedRootRealPath,
    runtimeKey,
    relativePaths: relativePath ? [root, relativePath] : [root],
    kind,
    component,
    version,
    field,
    checked,
    missing,
    failures,
    schema2: true,
  });
}

function verifySchema2Node(managedRoot, managedRootRealPath, runtimeKey, node, checked, missing, failures) {
  if (!isObject(node)) {
    addSchema2Problem(failures, missing, runtimeKey, 'managed-node', 'invalid_schema', 'node');
    return;
  }
  if (!stringField(node.version)) {
    addSchema2Problem(failures, missing, runtimeKey, 'managed-node', 'invalid_schema', 'node.version');
  }

  const root = readSchema2Path(runtimeKey, node.root, 'managed-node', 'node.root', missing, failures);
  const executable = readSchema2Path(runtimeKey, node.executable, 'managed-node', 'node.executable', missing, failures);
  if (!root) return;

  const rootIsValid = requireSchema2Resource({
    managedRoot,
    managedRootRealPath,
    runtimeKey,
    root,
    kind: 'directory',
    component: 'managed-node',
    version: node.version,
    field: 'node.root',
    checked,
    missing,
    failures,
  });
  if (rootIsValid && executable) {
    requireSchema2Resource({
      managedRoot,
      managedRootRealPath,
      runtimeKey,
      root,
      relativePath: executable,
      kind: 'file',
      component: 'managed-node',
      version: node.version,
      field: 'node.executable',
      checked,
      missing,
      failures,
    });
  }
}

function verifySchema2Cli(
  managedRoot,
  managedRootRealPath,
  runtimeKey,
  contractRuntimeKey,
  cli,
  index,
  checked,
  missing,
  failures
) {
  if (!isObject(cli) || !stringField(cli.name)) {
    addSchema2Problem(failures, missing, runtimeKey, 'managed-resources', 'invalid_schema', `clis[${index}].name`);
    return null;
  }

  const label = `clis[${cli.name}]`;
  if (!stringField(cli.version)) {
    addSchema2Problem(failures, missing, runtimeKey, cli.name, 'invalid_schema', `${label}.version`);
  }
  if (cli.platformDirectory !== contractRuntimeKey) {
    addSchema2Problem(
      failures,
      missing,
      runtimeKey,
      cli.name,
      'runtime_key_mismatch',
      `${label}.platformDirectory:${contractRuntimeKey}`
    );
  }

  const root = readSchema2Path(runtimeKey, cli.root, cli.name, `${label}.root`, missing, failures);
  const executable = readSchema2Path(runtimeKey, cli.executable, cli.name, `${label}.executable`, missing, failures);
  const rootIsValid =
    root &&
    requireSchema2Resource({
      managedRoot,
      managedRootRealPath,
      runtimeKey,
      root,
      kind: 'directory',
      component: cli.name,
      version: cli.version,
      field: `${label}.root`,
      checked,
      missing,
      failures,
    });
  if (rootIsValid && executable) {
    requireSchema2Resource({
      managedRoot,
      managedRootRealPath,
      runtimeKey,
      root,
      relativePath: executable,
      kind: 'file',
      component: cli.name,
      version: cli.version,
      field: `${label}.executable`,
      checked,
      missing,
      failures,
    });
  }

  verifySchema2CliResources(
    managedRoot,
    managedRootRealPath,
    runtimeKey,
    cli,
    label,
    rootIsValid ? root : null,
    checked,
    missing,
    failures
  );
  return cli.name;
}

function verifySchema2CliResources(
  managedRoot,
  managedRootRealPath,
  runtimeKey,
  cli,
  label,
  root,
  checked,
  missing,
  failures
) {
  for (const [field, kind] of [
    ['requiredFiles', 'file'],
    ['requiredDirectories', 'directory'],
  ]) {
    const values = cli[field];
    if (values === undefined) continue;
    if (!Array.isArray(values)) {
      addSchema2Problem(failures, missing, runtimeKey, cli.name, 'invalid_schema', `${label}.${field}`);
      continue;
    }

    for (const [index, value] of values.entries()) {
      const itemLabel = `${label}.${field}[${index}]`;
      const relativePath = readSchema2Path(runtimeKey, value, cli.name, itemLabel, missing, failures);
      if (!root || !relativePath) continue;
      requireSchema2Resource({
        managedRoot,
        managedRootRealPath,
        runtimeKey,
        root,
        relativePath,
        kind,
        component: cli.name,
        version: cli.version,
        field: itemLabel,
        checked,
        missing,
        failures,
      });
    }
  }
}

function verifyManagedResourcesV2(managedRoot, managedRootRealPath, runtimeKey, contract, checked, missing, failures) {
  if (!SUPPORTED_SCHEMA_2_RUNTIME_KEYS.has(contract.runtimeKey)) {
    addSchema2Problem(
      failures,
      missing,
      runtimeKey,
      'managed-resources',
      'unsupported_runtime_key',
      `unsupported-runtimeKey:${contract.runtimeKey}`
    );
  }
  if (contract.runtimeKey !== runtimeKey) {
    addSchema2Problem(
      failures,
      missing,
      runtimeKey,
      'managed-resources',
      'runtime_key_mismatch',
      `runtimeKey:${runtimeKey}`
    );
  }

  verifySchema2Node(managedRoot, managedRootRealPath, runtimeKey, contract.node, checked, missing, failures);

  if (!Array.isArray(contract.clis)) {
    addSchema2Problem(failures, missing, runtimeKey, 'managed-resources', 'invalid_schema', 'clis');
    return;
  }

  const cliNames = new Set();
  for (const [index, cli] of contract.clis.entries()) {
    const name = verifySchema2Cli(
      managedRoot,
      managedRootRealPath,
      runtimeKey,
      contract.runtimeKey,
      cli,
      index,
      checked,
      missing,
      failures
    );
    if (!name) continue;
    if (cliNames.has(name)) {
      addSchema2Problem(failures, missing, runtimeKey, name, 'duplicate_cli_name', `duplicate-clis[${name}]`);
    }
    cliNames.add(name);
  }

  for (const requiredName of REQUIRED_SCHEMA_2_CLI_NAMES) {
    if (!cliNames.has(requiredName)) {
      addSchema2Problem(failures, missing, runtimeKey, requiredName, 'missing_required_cli', `clis[${requiredName}]`);
    }
  }
}

function verifyManagedResourcesContract(managedRootInfo, runtimeKey, checked, missing, failures) {
  const relativePath = contractBundledPath(runtimeKey, 'manifest.json');
  const manifestPath = path.join(managedRootInfo.path, 'manifest.json');
  checked.push(relativePath);

  let stats;
  try {
    stats = fs.lstatSync(manifestPath);
  } catch (error) {
    addFailure(failures, missing, {
      component: 'managed-resources',
      reason: error?.code === 'ENOENT' ? 'missing_file' : 'invalid_file_type',
      path: relativePath,
    });
    return;
  }
  if (!stats.isFile()) {
    addFailure(failures, missing, { component: 'managed-resources', reason: 'invalid_file_type', path: relativePath });
    return;
  }

  const contract = readManifest(manifestPath);
  if (!contract) {
    addFailure(
      failures,
      missing,
      { component: 'managed-resources', reason: 'invalid_json', path: relativePath },
      `${relativePath}<invalid-json>`
    );
    return;
  }
  if (!isObject(contract) || !Number.isInteger(contract.schemaVersion)) {
    addSchemaFailure(failures, missing, runtimeKey, 'managed-resources', 'invalid_schema');
    return;
  }

  if (contract.schemaVersion === 1) {
    verifyManagedResourcesV1(
      managedRootInfo.path,
      managedRootInfo.realPath,
      runtimeKey,
      contract,
      checked,
      missing,
      failures
    );
    return;
  }
  if (contract.schemaVersion === 2) {
    verifyManagedResourcesV2(
      managedRootInfo.path,
      managedRootInfo.realPath,
      runtimeKey,
      contract,
      checked,
      missing,
      failures
    );
    return;
  }

  addSchemaFailure(failures, missing, runtimeKey, 'managed-resources', 'unsupported_schema_version');
}

function verifyBundledAioncoreResources({
  resourcesDir,
  electronPlatformName,
  targetArch,
  expectedMigrationLineage = acceptedMigrationLineage,
}) {
  const runtimeKey = `${electronPlatformName}-${targetArch}`;
  const baseDir = path.join(resourcesDir, 'bundled-aioncore', runtimeKey);
  const checked = [];
  const missing = [];
  const failures = [];

  requireRelativePath(baseDir, runtimeKey, [backendBinaryName(electronPlatformName)], checked, missing, failures);
  verifyBundleManifest(
    baseDir,
    runtimeKey,
    electronPlatformName,
    targetArch,
    expectedMigrationLineage,
    checked,
    missing,
    failures
  );
  verifyMigrationLineage(baseDir, runtimeKey, expectedMigrationLineage, checked, missing, failures);
  requireRelativeDirectory(baseDir, runtimeKey, ['managed-resources'], checked, missing, failures);
  const managedRootInfo = inspectManagedResourcesRoot(baseDir, runtimeKey, missing, failures);
  if (managedRootInfo) verifyManagedResourcesContract(managedRootInfo, runtimeKey, checked, missing, failures);
  if (failures.length > 0 && missing.length === 0) {
    missing.push(`${contractBundledPath(runtimeKey, 'manifest.json')}<contract_failure>`);
  }

  return { runtimeKey, checked, missing, failures };
}

module.exports = {
  acceptedMigrationLineage,
  getAcceptedMigrationLineageManifest,
  verifyBundledAioncoreResources,
};
