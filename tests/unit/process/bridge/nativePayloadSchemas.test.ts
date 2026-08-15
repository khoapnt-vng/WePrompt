/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  NATIVE_BRIDGE_PROVIDER_KEYS,
  RENDERER_BRIDGE_QUERY_KEYS,
  type NativeBridgeProviderKey,
  type RendererBridgeQueryKey,
} from '@/common/adapter/native/constants';
import {
  INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE,
  INVALID_RENDERER_BRIDGE_QUERY_PAYLOAD_MESSAGE,
  nativeBridgePayloadSchemas,
  parseNativeBridgePayload,
  parseRendererBridgeQueryRequest,
  parseRendererBridgeQueryResponse,
  rendererBridgeQuerySchemas,
} from '@/common/adapter/native/payloadSchemas';

const VALID_PAYLOADS = {
  'restart-app': undefined,
  'open-dev-tools': undefined,
  'is-dev-tools-opened': undefined,
  'app.get-path': { name: 'downloads' },
  'update-system-info': { cacheDir: '/tmp/cache', workDir: '/tmp/work', logDir: '/tmp/log' },
  'app.get-zoom-factor': undefined,
  'app.set-zoom-factor': { factor: 0.95 },
  'app.get-cdp-status': undefined,
  'app.update-cdp-config': { enabled: true, port: 9230 },
  'app.get-start-on-boot-status': undefined,
  'app.set-start-on-boot': { enabled: true },
  'app.get-gpu-status': undefined,
  'app.set-gpu-override': { override: 'force-on' },
  'app.write-renderer-log': { level: 'info', tag: 'settings', message: 'saved', data: { count: 1 } },
  'update.check': { includePrerelease: false, repo: 'iOfficeAI/AionUi' },
  'update.installer-last-failure.consume': undefined,
  'update.download': {
    downloadId: 'download-1',
    url: 'https://updates.weprompt.test/releases/v1/app.dmg',
    fallbackUrl: 'https://cdn.example.com/app.dmg',
    file_name: 'app.dmg',
  },
  'update.download.cancel': { downloadId: 'download-1' },
  'auto-update.check': { includePrerelease: false },
  'auto-update.restore-downloaded': undefined,
  'auto-update.download': undefined,
  'auto-update.download.cancel': undefined,
  'auto-update.quit-and-install': undefined,
  'show-open': {
    defaultPath: '/tmp',
    properties: ['openDirectory', 'createDirectory'],
    filters: [{ name: 'Documents', extensions: ['pdf', 'docx'] }],
  },
  'app-operations.context-compact': {
    operation_id: 'operation-1',
    conversation_id: 'conversation-1',
    trigger: 'manual',
    previous_snapshot: {
      goal: 'Ship the security update.',
      current_state: ['IPC schemas are implemented.'],
      decisions: [],
      artifacts: [],
      user_preferences: [],
      open_questions: [],
      next_steps: ['Run verification.'],
      do_not_forget: [],
    },
    pinned_context: [
      {
        id: 'pin-1',
        title: 'Security scope',
        content: 'Keep the native IPC bridge fail closed.',
        source: 'manual',
        created_at: 1,
        updated_at: 1,
      },
    ],
    target_turn_id: 'turn-1',
  },
  'presentation-templates.list': undefined,
  'presentation-templates.import-spec': { file_path: '/tmp/theme.json' },
  'presentation-templates.describe-spec': {
    conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730',
    file_path: '/tmp/workspace/THEME.md',
  },
  'presentation-templates.import-spec-bound': {
    conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730',
    file_path: '/tmp/workspace/THEME.md',
    expected_sha256: 'a'.repeat(64),
  },
  'presentation-templates.remove': { id: 'template-1' },
  'presentation-templates.scratch.allocate': {
    conversation_id: 'conversation-1',
    template_id: 'business-review',
  },
  'presentation-templates.scratch.complete': { run_id: '5a68fccc-7b90-49b4-88f9-d78bb88255ed' },
  'presentation-templates.scratch.retain': {
    run_id: '5a68fccc-7b90-49b4-88f9-d78bb88255ed',
    reason: 'interrupted',
  },
  'presentation-templates.scratch.discard': { run_id: '5a68fccc-7b90-49b4-88f9-d78bb88255ed' },
  'presentation-sources.get-source-owner': {
    owner: { owner_type: 'conversation', conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730' },
  },
  'presentation-sources.create-draft': { client_request_id: 'c9426c09-4352-4c7c-88ca-039bfcaaf0d8' },
  'presentation-sources.bind-draft': {
    draft_id: 'd9b6195d-bab0-4662-b88c-1675772bb24d',
    conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730',
    expected_revision: 0,
  },
  'presentation-sources.pick-sources': {
    owner: { owner_type: 'draft', draft_id: 'd9b6195d-bab0-4662-b88c-1675772bb24d' },
    expected_owner_revision: 0,
  },
  'presentation-sources.grant-workspace-source': {
    conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730',
    relative_path: 'sources/source.pdf',
    expected_owner_revision: 1,
  },
  'presentation-sources.revoke': {
    owner: { owner_type: 'conversation', conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730' },
    grant_id: '229ca31e-1150-4ad1-ad62-1c3368330adc',
    expected_owner_revision: 2,
  },
  'presentation-sources.confirm-queued': {
    owner: { owner_type: 'conversation', conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730' },
    queue_item_id: '37f0a614-3e7f-41b5-87fd-49076fcf078d',
    sources: [
      {
        grantId: '229ca31e-1150-4ad1-ad62-1c3368330adc',
        expectedByteLength: 128,
        expectedSha256: 'a'.repeat(64),
      },
    ],
    expected_owner_revision: 2,
  },
  'presentation-runs.start': {
    conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730',
    client_request_id: 'c9426c09-4352-4c7c-88ca-039bfcaaf0d8',
    input: 'Create a concise board update',
    selected_template_id: 'business-review',
    sources: [
      {
        grantId: '229ca31e-1150-4ad1-ad62-1c3368330adc',
        expectedByteLength: 128,
        expectedSha256: 'a'.repeat(64),
      },
    ],
  },
  'presentation-runs.get': {
    conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730',
    run_id: '5a68fccc-7b90-49b4-88f9-d78bb88255ed',
  },
  'presentation-runs.list-recoverable': {
    conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730',
    limit: 20,
  },
  'presentation-runs.open-recovery': {
    conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730',
    run_id: '5a68fccc-7b90-49b4-88f9-d78bb88255ed',
    expected_sha256: 'a'.repeat(64),
  },
  'presentation-runs.discard': {
    conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730',
    run_id: '5a68fccc-7b90-49b4-88f9-d78bb88255ed',
    expected_revision: 2,
  },
  'presentation-runs.claim-initial-dispatch': {
    conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730',
    run_id: '5a68fccc-7b90-49b4-88f9-d78bb88255ed',
    holder_id: '9fa2d54d-95e5-4e06-84e4-a0aeeb434601',
    expected_revision: 2,
  },
  'presentation-runs.renew-initial-dispatch': {
    conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730',
    run_id: '5a68fccc-7b90-49b4-88f9-d78bb88255ed',
    lease_token: '18dc56da-f415-4b42-89f1-717fb24a6fe8',
    expected_revision: 3,
  },
  'presentation-runs.dispatch': {
    conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730',
    run_id: '5a68fccc-7b90-49b4-88f9-d78bb88255ed',
    lease_token: '18dc56da-f415-4b42-89f1-717fb24a6fe8',
    expected_revision: 3,
  },
  'project-knowledge.list-sources': { projectId: 'project-1' },
  'project-knowledge.add-sources': {
    projectId: 'project-1',
    filePaths: ['/tmp/work/notes.md', '/tmp/work/spec.docx'],
    workspace: '/tmp/work',
  },
  'project-knowledge.remove-source': {
    projectId: 'project-1',
    sourceId: 'a1b2c3d4e5f6',
    workspace: '/tmp/work',
  },
  'project-knowledge.get-source-text': { projectId: 'project-1', sourceId: 'a1b2c3d4e5f6' },
  'project-knowledge.retry-source': {
    projectId: 'project-1',
    sourceId: 'a1b2c3d4e5f6',
    workspace: '/tmp/work',
  },
  'project-knowledge.sync-folder': { projectId: 'project-1', workspace: '/tmp/work' },
  'project-knowledge.watch-folder': { projectId: 'project-1', workspace: '/tmp/work' },
  'project-knowledge.unwatch-folder': { projectId: 'project-1' },
  'project-knowledge.remove-store': { projectId: 'project-1' },
  'project-knowledge.get-session-mcp-server': { projectId: 'project-1' },
  'creative-studio.list-projects': undefined,
  'creative-studio.create-project': {
    name: 'Launch film',
    brief: 'A short launch story',
    aspectRatio: '16:9',
    targetDurationSeconds: 12,
    resolution: '1080p',
  },
  'creative-studio.get-project': { projectId: 'project_1' },
  'creative-studio.get-brief-session-server': { projectId: 'project_1' },
  'creative-studio.list-proposals': { projectId: 'project_1' },
  'creative-studio.list-pending-reference-requests': { projectId: 'project_1' },
  'creative-studio.dismiss-reference-requests': {
    projectId: 'project_1',
    requestIds: ['reference_request_1'],
  },
  'creative-studio.accept-proposal': { projectId: 'project_1', proposalId: 'proposal_1' },
  'creative-studio.reject-proposal': { projectId: 'project_1', proposalId: 'proposal_1' },
  'creative-studio.propose-storyboard': { projectId: 'project_1', expectedRevision: 1, replaceExisting: false },
  'creative-studio.update-model-selection': {
    projectId: 'project_1',
    expectedRevision: 2,
    role: 'video',
    selection: { choiceId: 'binding_1' },
  },
  'creative-studio.update-project': { projectId: 'project_1', expectedRevision: 1, name: 'Changed launch film' },
  'creative-studio.set-brief-rules': {
    projectId: 'project_1',
    expectedRevision: 1,
    rules: [
      {
        id: 'rule_1',
        text: 'Keep the kits generic.',
        predicate: { kind: 'forbidden_terms', terms: ['acme'] },
      },
    ],
  },
  'creative-studio.undo-brief-rules': { projectId: 'project_1' },
  'creative-studio.bind-brief-conversation': {
    projectId: 'project_1',
    expectedRevision: 1,
    conversationId: 'conversation_brief',
  },
  'creative-studio.update-cut': {
    projectId: 'project_1',
    expectedRevision: 1,
    cutId: 'cut_1',
    cut: {
      orderMode: 'storyboard',
      clipOrder: ['clip_1'],
      clips: {
        clip_1: {
          sourceInSeconds: 0.5,
          sourceOutSeconds: 4.5,
          crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
          filters: [{ id: 'contrast', amount: 0.25 }],
        },
      },
    },
  },
  'creative-studio.place-cut-scenes': {
    projectId: 'project_1',
    expectedRevision: 1,
    cutId: 'cut_1',
    sceneIds: ['scene_1'],
    beforeClipId: null,
  },
  'creative-studio.delete-project': { projectId: 'project_1', expectedRevision: 1 },
  'creative-studio.update-scene': {
    projectId: 'project_1',
    expectedRevision: 1,
    sceneId: 'scene_1',
    scene: {
      title: 'Opening',
      purpose: 'Introduce the product',
      visualPrompt: 'A cinematic product reveal',
      narration: 'Meet the future.',
      onScreenText: 'Meet the future',
      mediaKind: 'video',
      durationSeconds: 4,
      referenceAssetId: null,
    },
  },
  'creative-studio.reorder-scenes': { projectId: 'project_1', expectedRevision: 1, sceneOrder: ['scene_1'] },
  'creative-studio.select-asset': {
    projectId: 'project_1',
    expectedRevision: 1,
    sceneId: 'scene_1',
    assetId: 'asset_1',
  },
  'creative-studio.persist-captured-poster': {
    projectId: 'project_1',
    sceneId: 'scene_1',
    videoAssetId: 'asset_1',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    width: 1280,
    height: 720,
  },
  'creative-studio.choose-and-import-reference': {
    projectId: 'project_1',
    briefReferenceRole: 'cast',
    expectedRevision: 1,
  },
  'creative-studio.detach-brief-reference': {
    projectId: 'project_1',
    assetId: 'asset_1',
    expectedRevision: 1,
  },
  'creative-studio.choose-and-export-assets': { projectId: 'project_1', includeReferences: true },
  'creative-studio.get-latest-render': { projectId: 'project_1' },
  'creative-studio.render-cut': { projectId: 'project_1' },
  'creative-studio.cancel-render': { projectId: 'project_1' },
  'creative-studio.fit-storyboard': {
    projectId: 'project_1',
    expectedRevision: 1,
    catalogVersion: '0123456789abcdef',
  },
  'creative-studio.submit-scenes': {
    projectId: 'project_1',
    expectedRevision: 1,
    mode: 'single',
    sceneIds: ['scene_1'],
    catalogVersion: '0123456789abcdef',
    routes: [
      {
        sceneId: 'scene_1',
        choiceId: 'binding_1',
        kind: 'video',
      },
    ],
  },
  'creative-studio.cancel-job': { projectId: 'project_1', jobId: 'job_1', expectedRevision: 1 },
  'creative-studio.retry-job': {
    projectId: 'project_1',
    jobId: 'job_1',
    expectedRevision: 1,
    acknowledgePossibleDuplicateCharge: true,
  },
  'creative-studio.retry-download': { projectId: 'project_1', jobId: 'job_1', expectedRevision: 1 },
  'creative-studio.list-connection-candidates': undefined,
  'creative-studio.list-connections': undefined,
  'creative-studio.validate-connection': {
    providerId: 'provider_1',
    integrationId: 'integration_x5T8cW1h',
    model: 'open-sora',
  },
  'creative-studio.save-connection': {
    providerId: 'provider_1',
    integrationId: 'integration_x5T8cW1h',
    model: 'open-sora',
  },
  'creative-studio.remove-connection': { bindingId: 'binding_1' },
  'creative-studio.list-routes': { projectId: 'project_1' },
  'app-operations.cancel': { operation_id: 'operation-1' },
  'office-artifact.get-state': {
    conversationId: 'conversation-1',
    workspace: '/tmp/work',
    filePath: '/tmp/work/report.docx',
  },
  'office-artifact.prepare-preview': {
    conversationId: 'conversation-1',
    workspace: '/tmp/work',
    filePath: '/tmp/work/report.docx',
  },
  'office-artifact.start-preview': { leaseId: 'lease-1', url: 'http://127.0.0.1:3000/preview' },
  'office-artifact.release-preview': { leaseId: 'lease-1' },
  'office-artifact.inspect': {
    conversationId: 'conversation-1',
    workspace: '/tmp/work',
    filePath: '/tmp/work/report.docx',
    expectedVersion: 'version-1',
    selection: {
      kind: 'word',
      path: '/document/body/p[1]',
      paragraphText: 'Quarterly report',
      selectedText: 'Quarterly',
      start: 0,
      end: 9,
    },
  },
  'office-artifact.apply': {
    conversationId: 'conversation-1',
    workspace: '/tmp/work',
    filePath: '/tmp/work/report.xlsx',
    expectedVersion: 'version-1',
    selection: {
      kind: 'excel',
      paths: ['Sheet1!A1'],
      cells: [{ path: 'Sheet1!A1', displayText: '100' }],
    },
    edit: { kind: 'setCell', input: '200' },
  },
  'office-artifact.undo': {
    conversationId: 'conversation-1',
    workspace: '/tmp/work',
    filePath: '/tmp/work/report.docx',
    expectedVersion: 'version-1',
  },
  'window-controls:minimize': undefined,
  'window-controls:maximize': undefined,
  'window-controls:unmaximize': undefined,
  'window-controls:close': undefined,
  'window-controls:is-maximized': undefined,
  'theme:set-active': {
    id: 'forge-light',
    name: 'Forge Light',
    appearance: 'light',
    tokens: { '--color-bg-1': '#ffffff' },
    css: ':root { color-scheme: light; }',
    builtin: true,
    created_at: 1,
    updated_at: 1,
  },
  'theme:request-current': undefined,
  'system-settings:get-close-to-tray': undefined,
  'system-settings:set-close-to-tray': { enabled: true },
  'system-settings:get-pet-enabled': undefined,
  'system-settings:set-pet-enabled': { enabled: true },
  'system-settings:get-pet-size': undefined,
  'system-settings:set-pet-size': { size: 280 },
  'system-settings:get-pet-dnd': undefined,
  'system-settings:set-pet-dnd': { dnd: true },
  'system-settings:get-pet-confirm-enabled': undefined,
  'system-settings:set-pet-confirm-enabled': { enabled: true },
  'notification.show': {
    title: 'Task complete',
    body: 'The scheduled task finished.',
    conversation_id: 'conversation-1',
  },
  'webui.get-status': undefined,
  'webui.start': { port: 25808, allowRemote: false },
  'webui.stop': undefined,
} satisfies Record<NativeBridgeProviderKey, unknown>;

const VOID_PROVIDER_KEYS = [
  'restart-app',
  'open-dev-tools',
  'is-dev-tools-opened',
  'app.get-zoom-factor',
  'app.get-cdp-status',
  'app.get-start-on-boot-status',
  'app.get-gpu-status',
  'update.installer-last-failure.consume',
  'auto-update.restore-downloaded',
  'auto-update.download',
  'auto-update.download.cancel',
  'auto-update.quit-and-install',
  'presentation-templates.list',
  'window-controls:minimize',
  'window-controls:maximize',
  'window-controls:unmaximize',
  'window-controls:close',
  'window-controls:is-maximized',
  'theme:request-current',
  'system-settings:get-close-to-tray',
  'system-settings:get-pet-enabled',
  'system-settings:get-pet-size',
  'system-settings:get-pet-dnd',
  'system-settings:get-pet-confirm-enabled',
  'creative-studio.list-connection-candidates',
  'creative-studio.list-connections',
  'webui.get-status',
  'webui.stop',
] as const satisfies ReadonlyArray<NativeBridgeProviderKey>;

type InvalidPayloadCase = readonly [NativeBridgeProviderKey, string, unknown];

const IPC_BRIDGE_PATH = resolve(process.cwd(), 'packages/desktop/src/common/adapter/ipcBridge.ts');
const NATIVE_PAYLOAD_SCHEMAS_PATH = resolve(
  process.cwd(),
  'packages/desktop/src/common/adapter/native/payloadSchemas.ts'
);

function collectBridgeBuilderKeys(source: string, builderName: 'buildProvider' | 'buildRendererQuery'): string[] {
  const sourceFile = ts.createSourceFile(IPC_BRIDGE_PATH, source, ts.ScriptTarget.Latest, true);
  const providerKeys: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'bridge' &&
      node.expression.name.text === builderName
    ) {
      const [providerKey] = node.arguments;
      if (providerKey === undefined || !ts.isStringLiteral(providerKey)) {
        throw new Error(`bridge.${builderName} provider key must be a string literal`);
      }
      providerKeys.push(providerKey.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return providerKeys;
}

function collectBridgeBuildProviderKeys(source: string): string[] {
  return collectBridgeBuilderKeys(source, 'buildProvider');
}

function collectBridgeBuildRendererQueryKeys(source: string): string[] {
  return collectBridgeBuilderKeys(source, 'buildRendererQuery');
}

function collectNamedImportSources(source: string, importedName: string): string[] {
  const sourceFile = ts.createSourceFile(NATIVE_PAYLOAD_SCHEMAS_PATH, source, ts.ScriptTarget.Latest, true);
  return sourceFile.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return [];
    return bindings.elements.some((element) => (element.propertyName ?? element.name).text === importedName)
      ? [statement.moduleSpecifier.text]
      : [];
  });
}

const INVALID_PAYLOADS = [
  ['app.get-path', 'omitted required name', {}],
  ['app.get-path', 'non-string name', { name: 1 }],
  ['app.get-path', 'unsupported path name', { name: 'documents' }],
  ['update-system-info', 'omitted required cache directory', { workDir: '/tmp/work' }],
  ['update-system-info', 'omitted required work directory', { cacheDir: '/tmp/cache' }],
  ['update-system-info', 'non-string cache directory', { cacheDir: 1, workDir: '/tmp/work' }],
  ['update-system-info', 'non-string work directory', { cacheDir: '/tmp/cache', workDir: 1 }],
  ['update-system-info', 'empty cache directory', { cacheDir: '', workDir: '/tmp/work' }],
  ['update-system-info', 'overlong work directory', { cacheDir: '/tmp/cache', workDir: 'x'.repeat(4097) }],
  [
    'update-system-info',
    'invalid optional log directory substitute',
    { cacheDir: '/tmp/cache', workDir: '/tmp/work', logDir: 1 },
  ],
  ['app.set-zoom-factor', 'omitted required factor', {}],
  ['app.set-zoom-factor', 'non-numeric factor', { factor: '1' }],
  ['app.set-zoom-factor', 'non-finite factor', { factor: Number.NaN }],
  ['app.set-zoom-factor', 'factor below the allowed range', { factor: 0.79 }],
  ['app.set-zoom-factor', 'factor above the allowed range', { factor: 1.31 }],
  ['app.update-cdp-config', 'invalid optional enabled substitute', { enabled: 'true' }],
  ['app.update-cdp-config', 'invalid optional port substitute', { port: '9222' }],
  ['app.update-cdp-config', 'non-integer port', { port: 9222.5 }],
  ['app.update-cdp-config', 'port above the allowed range', { port: 65536 }],
  ['app.set-start-on-boot', 'omitted required enabled value', {}],
  ['app.set-start-on-boot', 'non-boolean enabled value', { enabled: 'true' }],
  ['app.set-gpu-override', 'omitted required override', {}],
  ['app.set-gpu-override', 'non-string override', { override: true }],
  ['app.set-gpu-override', 'unsupported override', { override: 'automatic' }],
  ['app.write-renderer-log', 'omitted required level', { tag: 'settings', message: 'saved' }],
  ['app.write-renderer-log', 'omitted required tag', { level: 'info', message: 'saved' }],
  ['app.write-renderer-log', 'omitted required message', { level: 'info', tag: 'settings' }],
  ['app.write-renderer-log', 'non-string level', { level: true, tag: 'settings', message: 'saved' }],
  ['app.write-renderer-log', 'unsupported level', { level: 'notice', tag: 'settings', message: 'saved' }],
  ['app.write-renderer-log', 'non-string tag', { level: 'info', tag: true, message: 'saved' }],
  ['app.write-renderer-log', 'empty tag', { level: 'info', tag: '', message: 'saved' }],
  ['app.write-renderer-log', 'overlong tag', { level: 'info', tag: 'x'.repeat(129), message: 'saved' }],
  ['app.write-renderer-log', 'non-string message', { level: 'info', tag: 'settings', message: true }],
  ['app.write-renderer-log', 'overlong message', { level: 'info', tag: 'settings', message: 'x'.repeat(65537) }],
  ['update.check', 'invalid optional prerelease substitute', { includePrerelease: 'false' }],
  ['update.check', 'invalid optional repository substitute', { repo: 1 }],
  ['update.check', 'malformed repository name', { repo: 'iOfficeAI' }],
  ['update.check', 'repository name with invalid characters', { repo: 'iOfficeAI/Aion Ui' }],
  ['update.check', 'overlong repository name', { repo: `owner/${'x'.repeat(196)}` }],
  ['update.download', 'omitted required URL', {}],
  ['update.download', 'non-string URL', { url: true }],
  ['update.download', 'malformed URL', { url: 'not-a-url' }],
  ['update.download', 'overlong URL', { url: `https://example.com/${'x'.repeat(2029)}` }],
  [
    'update.download',
    'empty optional download identifier',
    { url: VALID_PAYLOADS['update.download'].url, downloadId: '' },
  ],
  [
    'update.download',
    'invalid optional fallback URL',
    { url: VALID_PAYLOADS['update.download'].url, fallbackUrl: true },
  ],
  [
    'update.download',
    'malformed optional fallback URL',
    { url: VALID_PAYLOADS['update.download'].url, fallbackUrl: 'not-a-url' },
  ],
  ['update.download', 'invalid optional file name', { url: VALID_PAYLOADS['update.download'].url, file_name: false }],
  ['update.download', 'empty optional file name', { url: VALID_PAYLOADS['update.download'].url, file_name: '' }],
  [
    'update.download',
    'overlong optional file name',
    { url: VALID_PAYLOADS['update.download'].url, file_name: 'x'.repeat(256) },
  ],
  ['update.download.cancel', 'omitted required download identifier', {}],
  ['update.download.cancel', 'non-string download identifier', { downloadId: true }],
  ['update.download.cancel', 'empty download identifier', { downloadId: '' }],
  ['update.download.cancel', 'overlong download identifier', { downloadId: 'x'.repeat(257) }],
  ['auto-update.check', 'invalid optional prerelease substitute', { includePrerelease: 1 }],
  ['show-open', 'non-object supplied dialog payload', null],
  ['show-open', 'invalid optional default path substitute', { defaultPath: 1 }],
  ['show-open', 'empty optional default path', { defaultPath: '' }],
  ['show-open', 'invalid optional properties substitute', { properties: 'openDirectory' }],
  ['show-open', 'unsupported dialog property', { properties: ['openRecent'] }],
  ['show-open', 'too many dialog properties', { properties: Array.from({ length: 10 }, () => 'openFile') }],
  ['show-open', 'invalid optional filters substitute', { filters: {} }],
  ['show-open', 'filter without a required name', { filters: [{ extensions: ['pdf'] }] }],
  ['show-open', 'filter without required extensions', { filters: [{ name: 'Documents' }] }],
  ['show-open', 'non-string nested filter name', { filters: [{ name: true, extensions: ['pdf'] }] }],
  ['show-open', 'overlong nested filter name', { filters: [{ name: 'x'.repeat(257), extensions: ['pdf'] }] }],
  ['show-open', 'empty nested extension', { filters: [{ name: 'Documents', extensions: [''] }] }],
  ['show-open', 'overlong nested extension', { filters: [{ name: 'Documents', extensions: ['x'.repeat(33)] }] }],
  [
    'show-open',
    'too many nested extensions',
    { filters: [{ name: 'Documents', extensions: Array.from({ length: 65 }, () => 'pdf') }] },
  ],
  [
    'show-open',
    'too many dialog filters',
    { filters: Array.from({ length: 33 }, () => ({ name: 'Documents', extensions: ['pdf'] })) },
  ],
  ['show-open', 'unknown nested filter field', { filters: [{ name: 'Documents', extensions: ['pdf'], extra: true }] }],
  ['app-operations.context-compact', 'omitted operation identifier', { conversation_id: 'conversation-1' }],
  ['app-operations.context-compact', 'omitted conversation identifier', { operation_id: 'operation-1' }],
  ['presentation-templates.import-spec', 'omitted required file path', {}],
  ['presentation-templates.import-spec', 'non-string file path', { file_path: 1 }],
  ['presentation-templates.import-spec', 'empty file path', { file_path: '' }],
  ['presentation-templates.remove', 'omitted required identifier', {}],
  ['presentation-templates.remove', 'non-string identifier', { id: 1 }],
  ['presentation-templates.remove', 'empty identifier', { id: '' }],
  ['presentation-sources.get-source-owner', 'omitted owner', {}],
  [
    'presentation-sources.get-source-owner',
    'owner with both union identifiers',
    {
      owner: {
        owner_type: 'draft',
        draft_id: 'd9b6195d-bab0-4662-b88c-1675772bb24d',
        conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730',
      },
    },
  ],
  [
    'presentation-sources.get-source-owner',
    'malformed owner UUID',
    { owner: { owner_type: 'conversation', conversation_id: 'conversation-1' } },
  ],
  [
    'presentation-sources.get-source-owner',
    'unknown nested owner field',
    {
      owner: {
        owner_type: 'draft',
        draft_id: 'd9b6195d-bab0-4662-b88c-1675772bb24d',
        native_path: '/private/source.pdf',
      },
    },
  ],
  ['presentation-sources.create-draft', 'malformed client request UUID', { client_request_id: 'request-1' }],
  [
    'presentation-sources.bind-draft',
    'negative expected revision',
    { ...VALID_PAYLOADS['presentation-sources.bind-draft'], expected_revision: -1 },
  ],
  [
    'presentation-sources.bind-draft',
    'fractional expected revision',
    { ...VALID_PAYLOADS['presentation-sources.bind-draft'], expected_revision: 0.5 },
  ],
  [
    'presentation-sources.pick-sources',
    'unsafe expected owner revision',
    { ...VALID_PAYLOADS['presentation-sources.pick-sources'], expected_owner_revision: Number.MAX_SAFE_INTEGER + 1 },
  ],
  ...[
    '',
    '/absolute/source.pdf',
    'C:/absolute/source.pdf',
    '\\\\server\\share\\source.pdf',
    'sources\\source.pdf',
    'sources/source.pdf\0',
    '.',
    './source.pdf',
    'sources/../source.pdf',
    '../source.pdf',
    'sources//source.pdf',
    'sources/',
    'x'.repeat(4097),
  ].map(
    (relative_path) =>
      [
        'presentation-sources.grant-workspace-source',
        `unsafe relative path ${JSON.stringify(relative_path)}`,
        { ...VALID_PAYLOADS['presentation-sources.grant-workspace-source'], relative_path },
      ] as const
  ),
  [
    'presentation-sources.revoke',
    'malformed grant UUID',
    { ...VALID_PAYLOADS['presentation-sources.revoke'], grant_id: 'grant-1' },
  ],
  [
    'presentation-sources.confirm-queued',
    'path-shaped queue item identifier',
    { ...VALID_PAYLOADS['presentation-sources.confirm-queued'], queue_item_id: '/private/queue-item' },
  ],
  [
    'presentation-sources.confirm-queued',
    'empty source refs',
    { ...VALID_PAYLOADS['presentation-sources.confirm-queued'], sources: [] },
  ],
  [
    'presentation-sources.confirm-queued',
    'duplicate source refs',
    {
      ...VALID_PAYLOADS['presentation-sources.confirm-queued'],
      sources: [
        VALID_PAYLOADS['presentation-sources.confirm-queued'].sources[0],
        VALID_PAYLOADS['presentation-sources.confirm-queued'].sources[0],
      ],
    },
  ],
  [
    'presentation-sources.confirm-queued',
    'native path inside an opaque source ref',
    {
      ...VALID_PAYLOADS['presentation-sources.confirm-queued'],
      sources: [
        {
          ...VALID_PAYLOADS['presentation-sources.confirm-queued'].sources[0],
          native_path: '/private/source.pdf',
        },
      ],
    },
  ],
  [
    'presentation-sources.confirm-queued',
    'uppercase source hash',
    {
      ...VALID_PAYLOADS['presentation-sources.confirm-queued'],
      sources: [
        {
          ...VALID_PAYLOADS['presentation-sources.confirm-queued'].sources[0],
          expectedSha256: 'A'.repeat(64),
        },
      ],
    },
  ],
  [
    'presentation-runs.start',
    'path-shaped conversation UUID',
    { ...VALID_PAYLOADS['presentation-runs.start'], conversation_id: '../foreign' },
  ],
  [
    'presentation-runs.start',
    'path-shaped request UUID',
    { ...VALID_PAYLOADS['presentation-runs.start'], client_request_id: '/private/request' },
  ],
  [
    'presentation-runs.start',
    'path-shaped template identifier',
    { ...VALID_PAYLOADS['presentation-runs.start'], selected_template_id: '../business-review' },
  ],
  ['presentation-runs.start', 'empty input', { ...VALID_PAYLOADS['presentation-runs.start'], input: '' }],
  ['presentation-runs.start', 'whitespace-only input', { ...VALID_PAYLOADS['presentation-runs.start'], input: '   ' }],
  [
    'presentation-runs.start',
    'oversized input',
    { ...VALID_PAYLOADS['presentation-runs.start'], input: 'x'.repeat(200_001) },
  ],
  [
    'presentation-runs.start',
    'too many source refs',
    {
      ...VALID_PAYLOADS['presentation-runs.start'],
      sources: Array.from({ length: 17 }, (_, index) => ({
        grantId: `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`,
        expectedByteLength: 1,
        expectedSha256: 'a'.repeat(64),
      })),
    },
  ],
  [
    'presentation-runs.start',
    'duplicate source grant',
    {
      ...VALID_PAYLOADS['presentation-runs.start'],
      sources: [
        VALID_PAYLOADS['presentation-runs.start'].sources[0],
        VALID_PAYLOADS['presentation-runs.start'].sources[0],
      ],
    },
  ],
  [
    'presentation-runs.start',
    'aggregate source byte limit',
    {
      ...VALID_PAYLOADS['presentation-runs.start'],
      sources: Array.from({ length: 5 }, (_, index) => ({
        grantId: `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`,
        expectedByteLength: 64 * 1_024 * 1_024,
        expectedSha256: 'a'.repeat(64),
      })),
    },
  ],
  [
    'presentation-runs.start',
    'unknown nested source field',
    {
      ...VALID_PAYLOADS['presentation-runs.start'],
      sources: [{ ...VALID_PAYLOADS['presentation-runs.start'].sources[0], native_path: '/private/source.pdf' }],
    },
  ],
  [
    'presentation-runs.start',
    'path-shaped source grant id',
    {
      ...VALID_PAYLOADS['presentation-runs.start'],
      sources: [{ ...VALID_PAYLOADS['presentation-runs.start'].sources[0], grantId: '../grant' }],
    },
  ],
  [
    'presentation-runs.start',
    'oversized source byte claim',
    {
      ...VALID_PAYLOADS['presentation-runs.start'],
      sources: [
        { ...VALID_PAYLOADS['presentation-runs.start'].sources[0], expectedByteLength: 64 * 1_024 * 1_024 + 1 },
      ],
    },
  ],
  [
    'presentation-runs.start',
    'uppercase source hash',
    {
      ...VALID_PAYLOADS['presentation-runs.start'],
      sources: [{ ...VALID_PAYLOADS['presentation-runs.start'].sources[0], expectedSha256: 'A'.repeat(64) }],
    },
  ],
  [
    'presentation-runs.get',
    'omitted selector',
    { conversation_id: VALID_PAYLOADS['presentation-runs.get'].conversation_id },
  ],
  [
    'presentation-runs.get',
    'nonexclusive selectors',
    { ...VALID_PAYLOADS['presentation-runs.get'], client_request_id: 'c9426c09-4352-4c7c-88ca-039bfcaaf0d8' },
  ],
  [
    'presentation-runs.get',
    'path-shaped run UUID',
    { ...VALID_PAYLOADS['presentation-runs.get'], run_id: '/private/run' },
  ],
  [
    'presentation-runs.list-recoverable',
    'zero limit',
    { ...VALID_PAYLOADS['presentation-runs.list-recoverable'], limit: 0 },
  ],
  [
    'presentation-runs.list-recoverable',
    'oversized limit',
    { ...VALID_PAYLOADS['presentation-runs.list-recoverable'], limit: 21 },
  ],
  [
    'presentation-runs.list-recoverable',
    'path-shaped cursor',
    { ...VALID_PAYLOADS['presentation-runs.list-recoverable'], cursor: '/private/cursor' },
  ],
  [
    'presentation-runs.list-recoverable',
    'oversized cursor',
    { ...VALID_PAYLOADS['presentation-runs.list-recoverable'], cursor: `${'a'.repeat(2047)}.b` },
  ],
  [
    'presentation-runs.open-recovery',
    'path-shaped run UUID',
    { ...VALID_PAYLOADS['presentation-runs.open-recovery'], run_id: '../run' },
  ],
  [
    'presentation-runs.open-recovery',
    'invalid expected hash',
    { ...VALID_PAYLOADS['presentation-runs.open-recovery'], expected_sha256: '/private/hash' },
  ],
  [
    'presentation-runs.discard',
    'negative expected revision',
    { ...VALID_PAYLOADS['presentation-runs.discard'], expected_revision: -1 },
  ],
  [
    'presentation-runs.discard',
    'unsafe expected revision',
    { ...VALID_PAYLOADS['presentation-runs.discard'], expected_revision: Number.MAX_SAFE_INTEGER + 1 },
  ],
  [
    'presentation-runs.claim-initial-dispatch',
    'malformed holder UUID',
    { ...VALID_PAYLOADS['presentation-runs.claim-initial-dispatch'], holder_id: 'renderer-holder' },
  ],
  [
    'presentation-runs.claim-initial-dispatch',
    'path-shaped run UUID',
    { ...VALID_PAYLOADS['presentation-runs.claim-initial-dispatch'], run_id: '../run' },
  ],
  [
    'presentation-runs.renew-initial-dispatch',
    'malformed lease token',
    { ...VALID_PAYLOADS['presentation-runs.renew-initial-dispatch'], lease_token: 'lease-token' },
  ],
  [
    'presentation-runs.dispatch',
    'unsafe expected revision',
    { ...VALID_PAYLOADS['presentation-runs.dispatch'], expected_revision: Number.MAX_SAFE_INTEGER + 1 },
  ],
  [
    'app-operations.context-compact',
    'renderer-supplied model selection',
    {
      operation_id: 'operation-1',
      conversation_id: 'conversation-1',
      trigger: 'manual',
      provider_id: 'provider-1',
      model: 'model-1',
    },
  ],
  [
    'app-operations.context-compact',
    'too many pinned context items',
    {
      operation_id: 'operation-1',
      conversation_id: 'conversation-1',
      trigger: 'manual',
      pinned_context: Array.from({ length: 21 }, (_, index) => ({
        id: `pin-${index}`,
        title: 'Pin',
        content: 'Content',
        source: 'manual',
        created_at: 1,
        updated_at: 1,
      })),
    },
  ],
  ['project-knowledge.list-sources', 'omitted required project identifier', {}],
  ['project-knowledge.add-sources', 'omitted required file paths', { projectId: 'project-1' }],
  ['project-knowledge.add-sources', 'omitted workspace', { projectId: 'project-1', filePaths: ['/tmp/work/notes.md'] }],
  ['project-knowledge.add-sources', 'non-array file paths', { projectId: 'project-1', filePaths: 'not-an-array' }],
  [
    'project-knowledge.add-sources',
    'too many file paths',
    { projectId: 'project-1', filePaths: Array.from({ length: 101 }, (_, index) => `/tmp/work/file-${index}.md`) },
  ],
  ['project-knowledge.remove-source', 'omitted required source identifier', { projectId: 'project-1' }],
  ['project-knowledge.remove-source', 'omitted workspace', { projectId: 'project-1', sourceId: 'a1b2c3d4e5f6' }],
  ['project-knowledge.retry-source', 'non-string source identifier', { projectId: 'project-1', sourceId: 1 }],
  ['project-knowledge.retry-source', 'omitted workspace', { projectId: 'project-1', sourceId: 'a1b2c3d4e5f6' }],
  ['project-knowledge.remove-store', 'empty project identifier', { projectId: '' }],
  ['project-knowledge.get-session-mcp-server', 'omitted required project identifier', {}],
  [
    'creative-studio.create-project',
    'renderer supplied internal project id',
    { ...VALID_PAYLOADS['creative-studio.create-project'], id: 'project_1' },
  ],
  [
    'creative-studio.create-project',
    'overlong project name',
    { ...VALID_PAYLOADS['creative-studio.create-project'], name: 'x'.repeat(257) },
  ],
  [
    'creative-studio.create-project',
    'overlong brief',
    { ...VALID_PAYLOADS['creative-studio.create-project'], brief: 'x'.repeat(16 * 1024 + 1) },
  ],
  [
    'creative-studio.create-project',
    'fractional project target',
    { ...VALID_PAYLOADS['creative-studio.create-project'], targetDurationSeconds: 12.5 },
  ],
  [
    'creative-studio.create-project',
    'non-finite project target',
    { ...VALID_PAYLOADS['creative-studio.create-project'], targetDurationSeconds: Number.POSITIVE_INFINITY },
  ],
  ['creative-studio.get-project', 'project id traversal', { projectId: '../project_1' }],
  ['creative-studio.choose-and-import-reference', 'missing expected revision', { projectId: 'project_1' }],
  [
    'creative-studio.choose-and-import-reference',
    'invalid Brief reference role',
    { projectId: 'project_1', briefReferenceRole: 'subject', expectedRevision: 1 },
  ],
  [
    'creative-studio.choose-and-import-reference',
    'Brief role combined with a scene',
    { projectId: 'project_1', sceneId: 'scene_1', briefReferenceRole: 'look', expectedRevision: 1 },
  ],
  [
    'creative-studio.choose-and-import-reference',
    'attempted source path',
    { projectId: 'project_1', expectedRevision: 1, sourcePath: '/tmp/reference.png' },
  ],
  [
    'creative-studio.choose-and-import-reference',
    'scene traversal',
    { projectId: 'project_1', sceneId: '../scene_1', expectedRevision: 1 },
  ],
  [
    'creative-studio.detach-brief-reference',
    'missing expected revision',
    { projectId: 'project_1', assetId: 'asset_1' },
  ],
  [
    'creative-studio.detach-brief-reference',
    'asset traversal',
    { projectId: 'project_1', assetId: '../asset_1', expectedRevision: 1 },
  ],
  [
    'creative-studio.detach-brief-reference',
    'project traversal',
    { projectId: '../project_1', assetId: 'asset_1', expectedRevision: 1 },
  ],
  [
    'creative-studio.choose-and-export-assets',
    'wrong include references boolean',
    { projectId: 'project_1', includeReferences: 'yes' },
  ],
  [
    'creative-studio.validate-connection',
    'provider id traversal',
    { providerId: '../provider', integrationId: 'integration_g7Q2mB4p', model: 'image' },
  ],
  [
    'creative-studio.validate-connection',
    'renderer supplied adapter identity',
    {
      providerId: 'provider_1',
      integrationId: 'integration_g7Q2mB4p',
      adapterId: 'weprompt-image-v1',
      model: 'image',
    },
  ],
  [
    'creative-studio.validate-connection',
    'renderer supplied provider URL',
    {
      providerId: 'provider_1',
      integrationId: 'integration_g7Q2mB4p',
      model: 'image',
      baseUrl: 'https://secret.invalid',
    },
  ],
  [
    'creative-studio.save-connection',
    'renderer supplied credential',
    { providerId: 'provider_1', integrationId: 'integration_g7Q2mB4p', model: 'image', apiKey: 'secret' },
  ],
  ['creative-studio.remove-connection', 'connection traversal', { bindingId: '../binding_1' }],
  ['creative-studio.list-routes', 'project traversal', { projectId: '../project_1' }],
  [
    'creative-studio.propose-storyboard',
    'project id traversal',
    { projectId: '../project_1', expectedRevision: 1, replaceExisting: false },
  ],
  [
    'creative-studio.propose-storyboard',
    'zero expected revision',
    { projectId: 'project_1', expectedRevision: 0, replaceExisting: false },
  ],
  [
    'creative-studio.propose-storyboard',
    'fractional expected revision',
    { projectId: 'project_1', expectedRevision: 1.5, replaceExisting: false },
  ],
  [
    'creative-studio.propose-storyboard',
    'infinite expected revision',
    { projectId: 'project_1', expectedRevision: Number.POSITIVE_INFINITY, replaceExisting: false },
  ],
  ['creative-studio.propose-storyboard', 'missing replace option', { projectId: 'project_1', expectedRevision: 1 }],
  [
    'creative-studio.propose-storyboard',
    'renderer supplied provider choice',
    { projectId: 'project_1', expectedRevision: 1, replaceExisting: false, providerId: 'provider_1' },
  ],
  [
    'creative-studio.propose-storyboard',
    'renderer supplied model choice',
    { projectId: 'project_1', expectedRevision: 1, replaceExisting: false, model: 'model_1' },
  ],
  [
    'creative-studio.propose-storyboard',
    'renderer supplied prompt',
    { projectId: 'project_1', expectedRevision: 1, replaceExisting: false, prompt: 'override' },
  ],
  [
    'creative-studio.update-project',
    'missing expected revision',
    { projectId: 'project_1', name: 'Changed launch film' },
  ],
  ['creative-studio.set-brief-rules', 'missing expected revision', { projectId: 'project_1', rules: [] }],
  [
    'creative-studio.set-brief-rules',
    'unknown predicate kind',
    {
      projectId: 'project_1',
      expectedRevision: 1,
      rules: [{ id: 'rule_1', text: 'x', predicate: { kind: 'regex', terms: ['x'] } }],
    },
  ],
  [
    'creative-studio.set-brief-rules',
    'too many rules',
    {
      projectId: 'project_1',
      expectedRevision: 1,
      rules: Array.from({ length: 25 }, (_, index) => ({ id: `rule_${index}`, text: 'x', predicate: null })),
    },
  ],
  [
    'creative-studio.update-model-selection',
    'project id traversal',
    { ...VALID_PAYLOADS['creative-studio.update-model-selection'], projectId: '../project_1' },
  ],
  [
    'creative-studio.update-model-selection',
    'choice id traversal',
    {
      ...VALID_PAYLOADS['creative-studio.update-model-selection'],
      selection: { choiceId: '../binding_1' },
    },
  ],
  [
    'creative-studio.update-model-selection',
    'missing expected revision',
    { ...VALID_PAYLOADS['creative-studio.update-model-selection'], expectedRevision: undefined },
  ],
  [
    'creative-studio.update-model-selection',
    'zero expected revision',
    { ...VALID_PAYLOADS['creative-studio.update-model-selection'], expectedRevision: 0 },
  ],
  [
    'creative-studio.update-model-selection',
    'fractional expected revision',
    { ...VALID_PAYLOADS['creative-studio.update-model-selection'], expectedRevision: 1.5 },
  ],
  [
    'creative-studio.update-model-selection',
    'storyboard adapter',
    {
      projectId: 'project_1',
      expectedRevision: 2,
      role: 'storyboard',
      selection: {
        providerId: 'provider_1',
        adapterId: 'weprompt-media-gateway-v1',
        model: 'gpt-4o',
      },
    },
  ],
  [
    'creative-studio.update-model-selection',
    'media selection without opaque choice',
    {
      projectId: 'project_1',
      expectedRevision: 2,
      role: 'video',
      selection: {},
    },
  ],
  [
    'creative-studio.update-model-selection',
    'media selection with adapter identity',
    {
      projectId: 'project_1',
      expectedRevision: 2,
      role: 'image',
      selection: {
        choiceId: 'binding_1',
        adapterId: 'weprompt-media-gateway-v1',
      },
    },
  ],
  [
    'creative-studio.update-model-selection',
    'media selection with provider and model override',
    {
      projectId: 'project_1',
      expectedRevision: 2,
      role: 'video',
      selection: {
        choiceId: 'binding_1',
        providerId: 'provider_1',
        model: 'video-model',
      },
    },
  ],
  [
    'creative-studio.update-model-selection',
    'overlong model',
    {
      projectId: 'project_1',
      expectedRevision: 2,
      role: 'storyboard',
      selection: { providerId: 'provider_1', model: 'x'.repeat(257) },
    },
  ],
  [
    'creative-studio.update-model-selection',
    'control character in model',
    {
      projectId: 'project_1',
      expectedRevision: 2,
      role: 'storyboard',
      selection: { providerId: 'provider_1', model: 'open\u0000sora' },
    },
  ],
  [
    'creative-studio.update-project',
    'non-positive expected revision',
    { projectId: 'project_1', expectedRevision: 0, name: 'Changed launch film' },
  ],
  ['creative-studio.delete-project', 'missing expected revision', { projectId: 'project_1' }],
  ['creative-studio.delete-project', 'traversal project id', { projectId: '../../project_1', expectedRevision: 1 }],
  [
    'creative-studio.update-scene',
    'overlong scene title',
    {
      ...VALID_PAYLOADS['creative-studio.update-scene'],
      scene: { ...VALID_PAYLOADS['creative-studio.update-scene'].scene, title: 'x'.repeat(257) },
    },
  ],
  [
    'creative-studio.update-scene',
    'overlong visual prompt',
    {
      ...VALID_PAYLOADS['creative-studio.update-scene'],
      scene: { ...VALID_PAYLOADS['creative-studio.update-scene'].scene, visualPrompt: 'x'.repeat(8 * 1024 + 1) },
    },
  ],
  [
    'creative-studio.update-scene',
    'overlong narration',
    {
      ...VALID_PAYLOADS['creative-studio.update-scene'],
      scene: { ...VALID_PAYLOADS['creative-studio.update-scene'].scene, narration: 'x'.repeat(4 * 1024 + 1) },
    },
  ],
  [
    'creative-studio.update-scene',
    'overlong on-screen text',
    {
      ...VALID_PAYLOADS['creative-studio.update-scene'],
      scene: { ...VALID_PAYLOADS['creative-studio.update-scene'].scene, onScreenText: 'x'.repeat(1024 + 1) },
    },
  ],
  [
    'creative-studio.update-scene',
    'fractional scene duration',
    {
      ...VALID_PAYLOADS['creative-studio.update-scene'],
      scene: { ...VALID_PAYLOADS['creative-studio.update-scene'].scene, durationSeconds: 1.5 },
    },
  ],
  [
    'creative-studio.update-scene',
    'scene id traversal',
    { ...VALID_PAYLOADS['creative-studio.update-scene'], sceneId: '../scene_1' },
  ],
  ...(['id', 'selectedAssetId', 'assetIds', 'jobIds', 'reviewState'] as const).map(
    (field) =>
      [
        'creative-studio.update-scene',
        `renderer supplied operational scene field ${field}`,
        {
          ...VALID_PAYLOADS['creative-studio.update-scene'],
          scene: {
            ...VALID_PAYLOADS['creative-studio.update-scene'].scene,
            [field]:
              field === 'id'
                ? 'scene_1'
                : field === 'selectedAssetId'
                  ? null
                  : field === 'reviewState'
                    ? 'complete'
                    : [],
          },
        },
      ] as const
  ),
  [
    'creative-studio.reorder-scenes',
    'duplicate scene ids',
    { projectId: 'project_1', expectedRevision: 1, sceneOrder: ['scene_1', 'scene_1'] },
  ],
  [
    'creative-studio.reorder-scenes',
    'empty scene ids',
    { projectId: 'project_1', expectedRevision: 1, sceneOrder: [] },
  ],
  [
    'creative-studio.reorder-scenes',
    'too many scene ids',
    {
      projectId: 'project_1',
      expectedRevision: 1,
      sceneOrder: Array.from({ length: 25 }, (_, index) => `scene_${index}`),
    },
  ],
  [
    'creative-studio.select-asset',
    'missing expected revision',
    { projectId: 'project_1', sceneId: 'scene_1', assetId: 'asset_1' },
  ],
  [
    'creative-studio.select-asset',
    'asset id traversal',
    { projectId: 'project_1', expectedRevision: 1, sceneId: 'scene_1', assetId: '../../asset_1' },
  ],
  [
    'creative-studio.persist-captured-poster',
    'non-PNG data URL',
    { ...VALID_PAYLOADS['creative-studio.persist-captured-poster'], dataUrl: 'data:image/jpeg;base64,/9j/' },
  ],
  [
    'creative-studio.persist-captured-poster',
    'video asset traversal',
    { ...VALID_PAYLOADS['creative-studio.persist-captured-poster'], videoAssetId: '../../asset_1' },
  ],
  [
    'creative-studio.persist-captured-poster',
    'zero width',
    { ...VALID_PAYLOADS['creative-studio.persist-captured-poster'], width: 0 },
  ],
  [
    'creative-studio.fit-storyboard',
    'uppercase catalog version',
    { projectId: 'project_1', expectedRevision: 1, catalogVersion: 'ABCDEF0123456789' },
  ],
  [
    'creative-studio.fit-storyboard',
    'wrong-length catalog version',
    { projectId: 'project_1', expectedRevision: 1, catalogVersion: 'abcdef012345678' },
  ],
  [
    'creative-studio.fit-storyboard',
    'non-hex catalog version',
    { projectId: 'project_1', expectedRevision: 1, catalogVersion: 'gggggggggggggggg' },
  ],
  [
    'creative-studio.fit-storyboard',
    'non-positive expected revision',
    { projectId: 'project_1', expectedRevision: 0, catalogVersion: '0123456789abcdef' },
  ],
  [
    'creative-studio.submit-scenes',
    'missing catalog version',
    {
      ...VALID_PAYLOADS['creative-studio.submit-scenes'],
      catalogVersion: undefined,
    },
  ],
  [
    'creative-studio.submit-scenes',
    'missing required generation mode',
    { ...VALID_PAYLOADS['creative-studio.submit-scenes'], mode: undefined },
  ],
  [
    'creative-studio.submit-scenes',
    'unknown generation mode',
    { ...VALID_PAYLOADS['creative-studio.submit-scenes'], mode: 'all' },
  ],
  [
    'creative-studio.submit-scenes',
    'single mode with multiple scene and route selections',
    {
      ...VALID_PAYLOADS['creative-studio.submit-scenes'],
      sceneIds: ['scene_1', 'scene_2'],
      routes: [
        ...VALID_PAYLOADS['creative-studio.submit-scenes'].routes,
        { sceneId: 'scene_2', choiceId: 'binding_2', kind: 'video' },
      ],
    },
  ],
  [
    'creative-studio.submit-scenes',
    'duplicate scene ids',
    {
      ...VALID_PAYLOADS['creative-studio.submit-scenes'],
      sceneIds: ['scene_1', 'scene_1'],
    },
  ],
  [
    'creative-studio.submit-scenes',
    'route set does not match selected scenes',
    {
      ...VALID_PAYLOADS['creative-studio.submit-scenes'],
      routes: [
        {
          ...VALID_PAYLOADS['creative-studio.submit-scenes'].routes[0],
          sceneId: 'scene_2',
        },
      ],
    },
  ],
  [
    'creative-studio.submit-scenes',
    'renderer supplied adapter identity',
    {
      ...VALID_PAYLOADS['creative-studio.submit-scenes'],
      routes: [
        {
          ...VALID_PAYLOADS['creative-studio.submit-scenes'].routes[0],
          adapterId: 'weprompt-media-gateway-v1',
        },
      ],
    },
  ],
  [
    'creative-studio.submit-scenes',
    'renderer supplied provider URL',
    {
      ...VALID_PAYLOADS['creative-studio.submit-scenes'],
      routes: [
        {
          ...VALID_PAYLOADS['creative-studio.submit-scenes'].routes[0],
          baseUrl: 'https://signed.invalid/output',
        },
      ],
    },
  ],
  [
    'creative-studio.submit-scenes',
    'reference prompt without a reference output role',
    {
      ...VALID_PAYLOADS['creative-studio.submit-scenes'],
      referencePrompts: [{ sceneId: 'scene_1', prompt: 'A close-up of the product label' }],
    },
  ],
  [
    'creative-studio.submit-scenes',
    'reference output role with no prompt to paint',
    { ...VALID_PAYLOADS['creative-studio.submit-scenes'], outputRole: 'reference' },
  ],
  [
    'creative-studio.submit-scenes',
    'reference prompt naming a scene outside the submission',
    {
      ...VALID_PAYLOADS['creative-studio.submit-scenes'],
      outputRole: 'reference',
      referencePrompts: [{ sceneId: 'scene_2', prompt: 'A close-up of the product label' }],
    },
  ],
  [
    'creative-studio.submit-scenes',
    'unknown output role',
    { ...VALID_PAYLOADS['creative-studio.submit-scenes'], outputRole: 'poster' },
  ],
  ['creative-studio.cancel-job', 'missing expected revision', { projectId: 'project_1', jobId: 'job_1' }],
  [
    'creative-studio.retry-job',
    'non-boolean duplicate charge acknowledgement',
    {
      projectId: 'project_1',
      jobId: 'job_1',
      expectedRevision: 1,
      acknowledgePossibleDuplicateCharge: 'yes',
    },
  ],
  [
    'creative-studio.retry-download',
    'non-positive expected revision',
    { projectId: 'project_1', jobId: 'job_1', expectedRevision: 0 },
  ],
  ['app-operations.cancel', 'omitted operation identifier', {}],
  ['office-artifact.get-state', 'omitted workspace', { filePath: '/tmp/work/report.docx' }],
  ['office-artifact.prepare-preview', 'omitted file path', { workspace: '/tmp/work' }],
  ['office-artifact.start-preview', 'omitted lease identifier', {}],
  ['office-artifact.release-preview', 'non-string lease identifier', { leaseId: 1 }],
  [
    'office-artifact.inspect',
    'unsupported selection kind',
    {
      ...VALID_PAYLOADS['office-artifact.inspect'],
      selection: { kind: 'slides', path: '/slide/1' },
    },
  ],
  ['office-artifact.apply', 'omitted edit', { ...VALID_PAYLOADS['office-artifact.apply'], edit: undefined }],
  [
    'office-artifact.undo',
    'omitted expected version',
    { ...VALID_PAYLOADS['office-artifact.undo'], expectedVersion: undefined },
  ],
  ['theme:set-active', 'omitted required theme identifier', { ...VALID_PAYLOADS['theme:set-active'], id: undefined }],
  ['theme:set-active', 'omitted required theme name', { ...VALID_PAYLOADS['theme:set-active'], name: undefined }],
  ['theme:set-active', 'omitted required appearance', { ...VALID_PAYLOADS['theme:set-active'], appearance: undefined }],
  ['theme:set-active', 'omitted required builtin flag', { ...VALID_PAYLOADS['theme:set-active'], builtin: undefined }],
  [
    'theme:set-active',
    'omitted required creation timestamp',
    { ...VALID_PAYLOADS['theme:set-active'], created_at: undefined },
  ],
  [
    'theme:set-active',
    'omitted required update timestamp',
    { ...VALID_PAYLOADS['theme:set-active'], updated_at: undefined },
  ],
  ['theme:set-active', 'non-string theme identifier', { ...VALID_PAYLOADS['theme:set-active'], id: true }],
  ['theme:set-active', 'empty theme identifier', { ...VALID_PAYLOADS['theme:set-active'], id: '' }],
  ['theme:set-active', 'overlong theme identifier', { ...VALID_PAYLOADS['theme:set-active'], id: 'x'.repeat(257) }],
  ['theme:set-active', 'non-string theme name', { ...VALID_PAYLOADS['theme:set-active'], name: true }],
  ['theme:set-active', 'empty theme name', { ...VALID_PAYLOADS['theme:set-active'], name: '' }],
  ['theme:set-active', 'overlong theme name', { ...VALID_PAYLOADS['theme:set-active'], name: 'x'.repeat(257) }],
  ['theme:set-active', 'non-string appearance', { ...VALID_PAYLOADS['theme:set-active'], appearance: true }],
  ['theme:set-active', 'invalid appearance enum', { ...VALID_PAYLOADS['theme:set-active'], appearance: 'sepia' }],
  ['theme:set-active', 'non-boolean builtin flag', { ...VALID_PAYLOADS['theme:set-active'], builtin: 'true' }],
  ['theme:set-active', 'non-numeric creation timestamp', { ...VALID_PAYLOADS['theme:set-active'], created_at: '1' }],
  [
    'theme:set-active',
    'non-finite creation timestamp',
    { ...VALID_PAYLOADS['theme:set-active'], created_at: Number.POSITIVE_INFINITY },
  ],
  ['theme:set-active', 'fractional creation timestamp', { ...VALID_PAYLOADS['theme:set-active'], created_at: 1.5 }],
  ['theme:set-active', 'negative creation timestamp', { ...VALID_PAYLOADS['theme:set-active'], created_at: -1 }],
  ['theme:set-active', 'non-numeric update timestamp', { ...VALID_PAYLOADS['theme:set-active'], updated_at: '1' }],
  ['theme:set-active', 'invalid optional cover substitute', { ...VALID_PAYLOADS['theme:set-active'], cover: true }],
  ['theme:set-active', 'invalid optional tokens substitute', { ...VALID_PAYLOADS['theme:set-active'], tokens: true }],
  ['theme:set-active', 'empty theme token key', { ...VALID_PAYLOADS['theme:set-active'], tokens: { '': '#fff' } }],
  [
    'theme:set-active',
    'overlong theme token key',
    { ...VALID_PAYLOADS['theme:set-active'], tokens: { ['x'.repeat(129)]: '#fff' } },
  ],
  [
    'theme:set-active',
    'overlong theme token value',
    { ...VALID_PAYLOADS['theme:set-active'], tokens: { '--color': 'x'.repeat(4097) } },
  ],
  [
    'theme:set-active',
    'too many theme tokens',
    {
      ...VALID_PAYLOADS['theme:set-active'],
      tokens: Object.fromEntries(Array.from({ length: 1025 }, (_, index) => [`--token-${index}`, 'x'])),
    },
  ],
  ['theme:set-active', 'invalid optional CSS substitute', { ...VALID_PAYLOADS['theme:set-active'], css: true }],
  [
    'theme:set-active',
    'overlong optional CSS',
    { ...VALID_PAYLOADS['theme:set-active'], css: 'x'.repeat(15 * 1024 * 1024 + 1) },
  ],
  ['system-settings:set-close-to-tray', 'omitted required enabled value', {}],
  ['system-settings:set-close-to-tray', 'non-boolean enabled value', { enabled: 1 }],
  ['system-settings:set-pet-enabled', 'omitted required enabled value', {}],
  ['system-settings:set-pet-enabled', 'non-boolean enabled value', { enabled: 1 }],
  ['system-settings:set-pet-size', 'omitted required size', {}],
  ['system-settings:set-pet-size', 'non-numeric size', { size: '280' }],
  ['system-settings:set-pet-size', 'unsupported size', { size: 240 }],
  ['system-settings:set-pet-dnd', 'omitted required dnd value', {}],
  ['system-settings:set-pet-dnd', 'non-boolean dnd value', { dnd: 1 }],
  ['system-settings:set-pet-confirm-enabled', 'omitted required enabled value', {}],
  ['system-settings:set-pet-confirm-enabled', 'non-boolean enabled value', { enabled: 1 }],
  ['notification.show', 'omitted required title', { body: 'Done' }],
  ['notification.show', 'omitted required body', { title: 'Done' }],
  ['notification.show', 'non-string title', { title: true, body: 'Done' }],
  ['notification.show', 'empty title', { title: '', body: 'Done' }],
  ['notification.show', 'overlong title', { title: 'x'.repeat(257), body: 'Done' }],
  ['notification.show', 'non-string body', { title: 'Done', body: true }],
  ['notification.show', 'overlong body', { title: 'Done', body: 'x'.repeat(4097) }],
  ['notification.show', 'invalid optional icon substitute', { title: 'Done', body: 'Done', icon: true }],
  ['notification.show', 'empty optional icon path', { title: 'Done', body: 'Done', icon: '' }],
  [
    'notification.show',
    'invalid optional conversation identifier substitute',
    { title: 'Done', body: 'Done', conversation_id: true },
  ],
  ['notification.show', 'empty optional conversation identifier', { title: 'Done', body: 'Done', conversation_id: '' }],
  ['webui.start', 'invalid optional port substitute', { port: '25808' }],
  ['webui.start', 'non-finite optional port', { port: Number.POSITIVE_INFINITY }],
  ['webui.start', 'port below the allowed range', { port: 0 }],
  ['webui.start', 'invalid optional remote access substitute', { allowRemote: 'false' }],
] satisfies ReadonlyArray<InvalidPayloadCase>;

describe('native bridge payload schemas', () => {
  it.each(['creative-studio.render-cut', 'creative-studio.cancel-render'])(
    'defines a strict project request schema for %s',
    (providerKey) => {
      const schema = (
        nativeBridgePayloadSchemas as Record<string, { safeParse(value: unknown): { success: boolean } }>
      )[providerKey];

      expect(schema).toBeDefined();
      expect(schema?.safeParse({ projectId: 'project_1' }).success).toBe(true);
      expect(schema?.safeParse({ projectId: 'project_1', injected: true }).success).toBe(false);
    }
  );

  it.each([
    ['creative-studio.list-proposals', { projectId: 'project_1' }],
    ['creative-studio.accept-proposal', { projectId: 'project_1', proposalId: 'proposal_1' }],
    ['creative-studio.reject-proposal', { projectId: 'project_1', proposalId: 'proposal_1' }],
  ])('defines a strict native schema for %s', (providerKey, payload) => {
    const schema = (nativeBridgePayloadSchemas as Record<string, { safeParse(value: unknown): { success: boolean } }>)[
      providerKey
    ];

    expect(schema).toBeDefined();
    expect(schema?.safeParse(payload).success).toBe(true);
    expect(schema?.safeParse({ ...payload, injected: true }).success).toBe(false);
  });

  it('guards the dedicated Brief conversation binding command', () => {
    const schema = nativeBridgePayloadSchemas['creative-studio.bind-brief-conversation'];

    expect(
      schema.safeParse({
        projectId: 'studio_1',
        expectedRevision: 2,
        conversationId: 'conversation_brief',
      }).success
    ).toBe(true);
    expect(
      schema.safeParse({
        projectId: 'studio_1',
        expectedRevision: 0,
        conversationId: '../conversation',
      }).success
    ).toBe(false);
  });

  it('accepts only paired exact authority for checked reference-request consumption', () => {
    const checked = {
      projectId: 'project_1',
      requestIds: ['reference_request_1'],
      expectedRevision: 2,
      expectedRequests: [{ id: 'reference_request_1', sceneId: 'scene_1' }],
    };

    expect(parseNativeBridgePayload('creative-studio.dismiss-reference-requests', checked)).toEqual(checked);
    expect(() =>
      parseNativeBridgePayload('creative-studio.dismiss-reference-requests', {
        projectId: checked.projectId,
        requestIds: checked.requestIds,
        expectedRevision: checked.expectedRevision,
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
    expect(() =>
      parseNativeBridgePayload('creative-studio.dismiss-reference-requests', {
        ...checked,
        expectedRequests: [{ id: 'reference_request_other', sceneId: 'scene_1' }],
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it('accepts a single-mode reference output submission with a reference prompt', () => {
    const payload = {
      ...VALID_PAYLOADS['creative-studio.submit-scenes'],
      outputRole: 'reference',
      referencePrompts: [{ sceneId: 'scene_1', prompt: 'A close-up of the product label' }],
    };

    expect(parseNativeBridgePayload('creative-studio.submit-scenes', payload)).toEqual(payload);
  });

  it('accepts a batch reference submission across multiple scenes', () => {
    const payload = {
      ...VALID_PAYLOADS['creative-studio.submit-scenes'],
      mode: 'batch',
      sceneIds: ['scene_1', 'scene_2'],
      outputRole: 'reference',
      routes: [
        ...VALID_PAYLOADS['creative-studio.submit-scenes'].routes,
        { sceneId: 'scene_2', choiceId: 'binding_2', kind: 'video' },
      ],
      referencePrompts: [
        { sceneId: 'scene_1', prompt: 'A close-up of the product label' },
        { sceneId: 'scene_2', prompt: 'A wide shot of the empty workshop' },
      ],
    };

    expect(parseNativeBridgePayload('creative-studio.submit-scenes', payload)).toEqual(payload);
  });

  it('accepts an empty Studio scene title for display-only seeded placeholders', () => {
    const payload = VALID_PAYLOADS['creative-studio.update-scene'];

    expect(
      parseNativeBridgePayload('creative-studio.update-scene', {
        ...payload,
        scene: { ...payload.scene, title: '' },
      })
    ).toMatchObject({ scene: { title: '' } });
  });

  it('accepts the exact revisioned Studio video model-selection payload', () => {
    expect(
      parseNativeBridgePayload(
        'creative-studio.update-model-selection',
        VALID_PAYLOADS['creative-studio.update-model-selection']
      )
    ).toEqual(VALID_PAYLOADS['creative-studio.update-model-selection']);
  });

  it('accepts only renderer-owned edit decisions in a cut mutation payload', () => {
    const schema = nativeBridgePayloadSchemas['creative-studio.update-cut' as NativeBridgeProviderKey];
    const payload = VALID_PAYLOADS['creative-studio.update-cut'];

    expect(schema?.safeParse(payload).success).toBe(true);
    expect(
      schema?.safeParse({
        ...payload,
        cut: {
          ...payload.cut,
          clips: {
            clip_1: {
              ...payload.cut.clips.clip_1,
              assetId: 'renderer_must_not_supply_this',
            },
          },
        },
      }).success
    ).toBe(false);
  });

  it.each([
    [
      'unknown filter',
      {
        ...VALID_PAYLOADS['creative-studio.update-cut'],
        cut: {
          ...VALID_PAYLOADS['creative-studio.update-cut'].cut,
          clips: {
            clip_1: {
              ...VALID_PAYLOADS['creative-studio.update-cut'].cut.clips.clip_1,
              filters: [{ id: 'blur', amount: 0.25 }],
            },
          },
        },
      },
    ],
    [
      'duplicate filter',
      {
        ...VALID_PAYLOADS['creative-studio.update-cut'],
        cut: {
          ...VALID_PAYLOADS['creative-studio.update-cut'].cut,
          clips: {
            clip_1: {
              ...VALID_PAYLOADS['creative-studio.update-cut'].cut.clips.clip_1,
              filters: [
                { id: 'contrast', amount: 0.1 },
                { id: 'contrast', amount: 0.2 },
              ],
            },
          },
        },
      },
    ],
    [
      'out-of-frame crop',
      {
        ...VALID_PAYLOADS['creative-studio.update-cut'],
        cut: {
          ...VALID_PAYLOADS['creative-studio.update-cut'].cut,
          clips: {
            clip_1: {
              ...VALID_PAYLOADS['creative-studio.update-cut'].cut.clips.clip_1,
              crop: { x: 0.5, y: 0, width: 0.75, height: 1 },
            },
          },
        },
      },
    ],
    [
      'non-increasing trim',
      {
        ...VALID_PAYLOADS['creative-studio.update-cut'],
        cut: {
          ...VALID_PAYLOADS['creative-studio.update-cut'].cut,
          clips: {
            clip_1: {
              ...VALID_PAYLOADS['creative-studio.update-cut'].cut.clips.clip_1,
              sourceInSeconds: 4.5,
              sourceOutSeconds: 4.5,
            },
          },
        },
      },
    ],
  ] as const)('rejects a cut mutation with %s', (_case, payload) => {
    const schema = nativeBridgePayloadSchemas['creative-studio.update-cut' as NativeBridgeProviderKey];

    expect(schema?.safeParse(payload).success).toBe(false);
  });

  it('loads presentation limits through the side-effect-free common policy boundary', () => {
    const policyImports = collectNamedImportSources(
      readFileSync(NATIVE_PAYLOAD_SCHEMAS_PATH, 'utf8'),
      'PRESENTATION_RUN_LIMITS'
    );

    expect(policyImports).toEqual(['../../types/office/presentationRunPolicy']);
  });

  it('exposes only the eight approved renderer run operations', async () => {
    const adapter = await import('@/common/adapter/ipcBridge');

    expect(Object.keys(Reflect.get(adapter, 'presentationRuns') ?? {})).toEqual([
      'start',
      'get',
      'listRecoverable',
      'openRecovery',
      'discard',
      'claimInitialDispatch',
      'renewInitialDispatch',
      'dispatch',
    ]);
  });

  it('keeps the native manifest equal to adapter provider string literals', () => {
    const providerKeys = collectBridgeBuildProviderKeys(readFileSync(IPC_BRIDGE_PATH, 'utf8'));

    expect(providerKeys).toEqual(NATIVE_BRIDGE_PROVIDER_KEYS);
  });

  it('keeps renderer-owned query declarations equal to their separate manifest', () => {
    const queryKeys = collectBridgeBuildRendererQueryKeys(readFileSync(IPC_BRIDGE_PATH, 'utf8'));

    expect(queryKeys).toEqual(RENDERER_BRIDGE_QUERY_KEYS);
    expect(queryKeys.some((key) => NATIVE_BRIDGE_PROVIDER_KEYS.includes(key as NativeBridgeProviderKey))).toBe(false);
  });

  it('rejects non-literal native provider declarations in the inventory', () => {
    expect(() => collectBridgeBuildProviderKeys("const key = 'provider'; bridge.buildProvider(key);")).toThrow(
      /provider key must be a string literal/i
    );
  });

  it('rejects non-literal renderer query declarations in the inventory', () => {
    expect(() =>
      collectBridgeBuildRendererQueryKeys("const key = 'query'; bridge.buildRendererQuery(key, {});")
    ).toThrow(/provider key must be a string literal/i);
  });

  it('has exactly one schema for every manifested native provider', () => {
    expect(Object.keys(nativeBridgePayloadSchemas)).toEqual(NATIVE_BRIDGE_PROVIDER_KEYS);
  });

  it.each(['presentation-templates.describe-spec', 'presentation-templates.import-spec-bound'] as const)(
    'manifests and validates the hash-bound template provider %s',
    (providerKey) => {
      expect(NATIVE_BRIDGE_PROVIDER_KEYS).toContain(providerKey);
      expect(() =>
        parseNativeBridgePayload(providerKey as NativeBridgeProviderKey, VALID_PAYLOADS[providerKey])
      ).not.toThrow();
    }
  );

  it('has exactly one request and response schema for every renderer-owned query', () => {
    expect(Object.keys(rendererBridgeQuerySchemas)).toEqual(RENDERER_BRIDGE_QUERY_KEYS);
    expect(
      Object.values(rendererBridgeQuerySchemas).every(
        (schemas) => schemas.request !== undefined && schemas.response !== undefined
      )
    ).toBe(true);
  });

  it.each(RENDERER_BRIDGE_QUERY_KEYS)('accepts only a void request for renderer-owned query %s', (queryKey) => {
    expect(parseRendererBridgeQueryRequest(queryKey, undefined)).toBeUndefined();
    expect(() => parseRendererBridgeQueryRequest(queryKey, {})).toThrow(INVALID_RENDERER_BRIDGE_QUERY_PAYLOAD_MESSAGE);
  });

  it.each([
    ['creative-studio.has-unsaved-work', { dirtySceneCount: 0 }],
    ['creative-studio.has-unsaved-work', { dirtySceneCount: 24 }],
    ['creative-studio.flush-unsaved-work', { saved: true }],
    ['creative-studio.flush-unsaved-work', { saved: false }],
  ] as const satisfies ReadonlyArray<readonly [RendererBridgeQueryKey, unknown]>)(
    'accepts a strict response for renderer-owned query %s',
    (queryKey, response) => {
      expect(parseRendererBridgeQueryResponse(queryKey, response)).toEqual(response);
    }
  );

  it.each([
    ['creative-studio.has-unsaved-work', { dirtySceneCount: -1 }],
    ['creative-studio.has-unsaved-work', { dirtySceneCount: 25 }],
    ['creative-studio.has-unsaved-work', { dirtySceneCount: 1.5 }],
    ['creative-studio.has-unsaved-work', { dirtySceneCount: 1, unexpected: true }],
    ['creative-studio.flush-unsaved-work', { saved: 'yes' }],
    ['creative-studio.flush-unsaved-work', { saved: false, unexpected: true }],
  ] as const satisfies ReadonlyArray<readonly [RendererBridgeQueryKey, unknown]>)(
    'rejects an invalid response for renderer-owned query %s',
    (queryKey, response) => {
      expect(() => parseRendererBridgeQueryResponse(queryKey, response)).toThrow(
        INVALID_RENDERER_BRIDGE_QUERY_PAYLOAD_MESSAGE
      );
    }
  );

  it.each(NATIVE_BRIDGE_PROVIDER_KEYS)('accepts the current payload shape for %s', (providerKey) => {
    expect(() => parseNativeBridgePayload(providerKey, VALID_PAYLOADS[providerKey])).not.toThrow();
  });

  it.each(['cast', 'look'] as const)('accepts %s as a classified Brief-reference import role', (role) => {
    expect(
      parseNativeBridgePayload('creative-studio.choose-and-import-reference' as NativeBridgeProviderKey, {
        projectId: 'project_1',
        briefReferenceRole: role,
        expectedRevision: 1,
      })
    ).toEqual({ projectId: 'project_1', briefReferenceRole: role, expectedRevision: 1 });
  });

  it('preserves a valid scene reference import through strict payload parsing', () => {
    const payload = { projectId: 'project_1', sceneId: 'scene_1', expectedRevision: 7 };

    expect(
      parseNativeBridgePayload('creative-studio.choose-and-import-reference' as NativeBridgeProviderKey, payload)
    ).toEqual(payload);
  });

  it.each(VOID_PROVIDER_KEYS)('rejects a supplied payload for void provider %s', (providerKey) => {
    expect(() => parseNativeBridgePayload(providerKey, {})).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it.each(NATIVE_BRIDGE_PROVIDER_KEYS.filter((providerKey) => VALID_PAYLOADS[providerKey] !== undefined))(
    'rejects unknown top-level fields for %s',
    (providerKey) => {
      const payload = VALID_PAYLOADS[providerKey];
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(`Missing object fixture for ${providerKey}`);
      }
      expect(() => parseNativeBridgePayload(providerKey, { ...payload, unexpected: true })).toThrow(
        INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
      );
    }
  );

  it.each(INVALID_PAYLOADS)('rejects %s payload with %s', (providerKey, _reason, payload) => {
    expect(() => parseNativeBridgePayload(providerKey, payload)).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it('allows the optional dialog payload to be omitted', () => {
    expect(parseNativeBridgePayload('show-open', undefined)).toBeUndefined();
  });

  it('does not expose payload values in validation errors', () => {
    const secret = 'secret-notification-value';
    let thrown: unknown;
    try {
      parseNativeBridgePayload('notification.show', { title: 'Notice', body: 'Body', token: secret });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual(new Error(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE));
    expect(String(thrown)).not.toContain(secret);
  });
});
