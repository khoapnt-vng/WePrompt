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
import { describe, expect, it, vi } from 'vitest';
import {
  NATIVE_BRIDGE_PROVIDER_KEYS,
  RENDERER_BRIDGE_QUERY_KEYS,
  type NativeBridgeProviderKey,
  type RendererBridgeQueryKey,
} from '@/common/adapter/native/constants';
import {
  INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE,
  INVALID_RENDERER_BRIDGE_QUERY_PAYLOAD_MESSAGE,
  getNativeBridgePayloadDiagnostic,
  nativeBridgePayloadSchemas,
  parseNativeBridgePayload,
  parseRendererBridgeQueryRequest,
  parseRendererBridgeQueryResponse,
  rendererBridgeQuerySchemas,
} from '@/common/adapter/native/payloadSchemas';
import {
  STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST,
  STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST,
  STUDIO_MAX_PIECE_CONDITIONING_INPUTS_V3,
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  type StudioPreparePhotoRequestV3,
} from '@/common/types/project/creativeStudioTypes';

const VALID_PILOT_PREPARE_PHOTO_PAYLOAD = {
  mode: 'create',
  projectId: 'project_1',
  expectedAuthoringRevision: 1,
  words: 'A lantern beside a quiet window.',
  settings: { aspectRatio: '16:9', resolution: '1080p' },
  suggestedHandle: null,
  referencePieceIds: ['piece_reference_1'],
} satisfies StudioPreparePhotoRequestV3;

const VALID_PAYLOADS = {
  'restart-app': undefined,
  'quit-app': undefined,
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
    conversation_id: 'd0921953',
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
  'creative-studio.get-director-session-authority': { projectId: 'project_1' },
  'creative-studio.bind-director-conversation': {
    projectId: 'project_1',
    expectedRevision: 1,
    conversationId: 'conversation_1',
  },
  'creative-studio-pilot.list-projects': undefined,
  'creative-studio-pilot.create-project': { name: 'Pilot project', brief: 'A still photograph.' },
  'creative-studio-pilot.load-project': { projectId: 'project_1' },
  'creative-studio-pilot.get-director-session-server': { projectId: 'project_1' },
  'creative-studio-pilot.get-director-session-authority': { projectId: 'project_1' },
  'creative-studio-pilot.bind-director-conversation': {
    projectId: 'project_1',
    expectedAuthoringRevision: 1,
    conversationId: 'conversation_1',
  },
  'creative-studio-pilot.prepare-photo': VALID_PILOT_PREPARE_PHOTO_PAYLOAD,
  'creative-studio-pilot.confirm-prepared-photo': {
    reservationId: 'reservation_1',
    quoteId: 'quote_1',
    quoteRevision: 1,
    explicitHumanConfirmation: true,
    duplicateChargeAcknowledged: false,
  },
  'creative-studio-pilot.discard-prepared-photo': {
    reservationId: 'reservation_1',
    quoteId: 'quote_1',
    quoteRevision: 1,
  },
  'creative-studio-pilot.import-photo': { projectId: 'project_1', expectedAuthoringRevision: 1 },
  'creative-studio-pilot.apply-mutation-batch': {
    schemaVersion: 6,
    projectId: 'project_1',
    expectedAuthoringRevision: 1,
    operations: [{ kind: 'set_brief', brief: 'A revised brief.' }],
  },
  'creative-studio-pilot.cancel-job': { projectId: 'project_1', pieceId: 'piece_1', jobId: 'job_1' },
  'creative-studio-pilot.resume-job': {
    projectId: 'project_1',
    pieceId: 'piece_1',
    jobId: 'job_1',
    expectedRevision: 2,
  },
  'creative-studio-pilot.retry-download': {
    projectId: 'project_1',
    pieceId: 'piece_1',
    jobId: 'job_1',
    expectedRevision: 2,
  },
  'creative-studio-pilot.list-piece-exports': { projectId: 'project_1' },
  'creative-studio-pilot.export-piece': { projectId: 'project_1', pieceId: 'piece_1', expectedRevision: 2 },
  'creative-studio-pilot.reveal-piece-export': {
    projectId: 'project_1',
    expectedCatalogRevision: 1,
    artifactId: 'export_1',
  },
  'creative-studio-pilot.delete-project': { mode: 'healthy', projectId: 'project_1', expectedRevision: 2 },
  'creative-studio.list-proposals': { projectId: 'project_1' },
  'creative-studio.accept-proposal': { projectId: 'project_1', proposalId: 'proposal_1' },
  'creative-studio.reject-proposal': { projectId: 'project_1', proposalId: 'proposal_1' },
  'creative-studio.prepare-paid-recovery-proposal': {
    projectId: 'project_1',
    proposalId: 'proposal_paid_recovery_1',
  },
  'creative-studio.confirm-paid-recovery-proposal': {
    projectId: 'project_1',
    proposalId: 'proposal_paid_recovery_1',
    quoteId: 'quote_paid_recovery_1',
    expectedRevision: 1,
  },
  'creative-studio.list-reference-requests': { projectId: 'project_1' },
  'creative-studio.decide-reference-request': {
    projectId: 'project_1',
    requestId: 'reference_request_1',
    expectedRevision: 1,
    outcome: { kind: 'generation_gate' },
  },
  'creative-studio.list-reference-generation-handoffs': { projectId: 'project_1' },
  'creative-studio.get-generation-capability': {
    projectId: 'project_1',
    expectedRevision: 1,
    items: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'video_take' }],
  },
  'creative-studio.prepare-project-references': {
    projectId: 'project_1',
    expectedRevision: 1,
    referenceIds: ['reference_character'],
  },
  'creative-studio.prepare-submission': {
    projectId: 'project_1',
    expectedRevision: 1,
    originReferenceHandoffId: null,
    baseChoices: [
      {
        target: { kind: 'shot', shotId: 'shot_1' },
        purpose: 'video_take',
      },
    ],
    cascadeChoices: [],
  },
  'creative-studio.confirm-submission': {
    projectId: 'project_1',
    quoteId: 'quote_1',
    expectedRevision: 1,
  },
  'creative-studio.cancel-job': {
    projectId: 'project_1',
    jobId: 'job_1',
    expectedRevision: 1,
  },
  'creative-studio.retry-job': {
    projectId: 'project_1',
    jobId: 'job_1',
    expectedRevision: 1,
    acknowledgePossibleDuplicateCharge: false,
  },
  'creative-studio.retry-job-download': {
    projectId: 'project_1',
    jobId: 'job_1',
    expectedRevision: 1,
  },
  'creative-studio.dismiss-reference-generation-handoff': {
    projectId: 'project_1',
    expectedRevision: 1,
    handoffId: 'handoff_1',
  },
  'creative-studio.apply-authoring-batch': {
    projectId: 'project_1',
    expectedRevision: 1,
    operations: [{ kind: 'set_brief', brief: 'A more precise launch story' }],
  },
  'creative-studio.undo-last': { projectId: 'project_1', expectedRevision: 1, entryId: 'undo_1' },
  'creative-studio.get-project-workspace': { projectId: 'project_1' },
  'creative-studio.get-project-status': { projectId: 'project_1', detail: true },
  'creative-studio.analyze-shot-audio': {
    projectId: 'project_1',
    expectedRevision: 1,
    shots: [{ shotId: 'shot_1', assetId: 'take_1' }],
  },
  'creative-studio.retry-conditioning-frame': {
    projectId: 'project_1',
    expectedRevision: 1,
    dependentShotId: 'shot_2',
  },
  'creative-studio.cancel-waiting-cascade': {
    projectId: 'project_1',
    expectedRevision: 1,
    dependentShotId: 'shot_2',
  },
  'creative-studio.edit-project': {
    projectId: 'project_1',
    expectedRevision: 1,
    changes: { name: 'Changed launch film', targetDurationSeconds: 18 },
  },
  'creative-studio.set-rules': {
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
  'creative-studio.park-beat': { projectId: 'project_1', expectedRevision: 1, beatId: 'beat_1' },
  'creative-studio.restore-beat': {
    projectId: 'project_1',
    expectedRevision: 1,
    beatId: 'beat_1',
    beforeBeatId: null,
  },
  'creative-studio.park-shot': { projectId: 'project_1', expectedRevision: 1, shotId: 'shot_1' },
  'creative-studio.restore-shot': {
    projectId: 'project_1',
    expectedRevision: 1,
    shotId: 'shot_1',
    beforeShotId: null,
  },
  'creative-studio.reorder-bin': { projectId: 'project_1', expectedRevision: 1, bin: [] },
  'creative-studio.delete-project': { projectId: 'project_1', expectedRevision: 1 },
  'creative-studio.persist-captured-poster': {
    projectId: 'project_1',
    shotId: 'shot_1',
    videoAssetId: 'asset_1',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    width: 1280,
    height: 720,
  },
  'creative-studio.import-seed-still': { projectId: 'project_1', expectedRevision: 1, shotId: 'shot_1' },
  'creative-studio.import-reference-image': {
    projectId: 'project_1',
    expectedRevision: 1,
    referenceId: 'reference_1',
  },
  'creative-studio.import-bed-audio': { projectId: 'project_1', expectedRevision: 1 },
  'creative-studio.detach-bed-audio': { projectId: 'project_1', expectedRevision: 1, assetId: 'asset_1' },
  'creative-studio.set-bed': { projectId: 'project_1', expectedRevision: 1, assetId: 'asset_1' },
  'creative-studio.create-export': {
    projectId: 'project_1',
    expectedRevision: 1,
    expectedCatalogRevision: 1,
    shape: 'editor_folder',
  },
  'creative-studio.get-film-export-capability': { projectId: 'project_1' },
  'creative-studio.get-film-export-status': { projectId: 'project_1' },
  'creative-studio.cancel-film-export': { projectId: 'project_1', renderId: 'film_1' },
  'creative-studio.acknowledge-film-export': { projectId: 'project_1', renderId: 'film_1' },
  'creative-studio.list-exports': { projectId: 'project_1' },
  'creative-studio.copy-export': {
    projectId: 'project_1',
    expectedCatalogRevision: 1,
    artifactId: 'export_1',
  },
  'creative-studio.reveal-export': {
    projectId: 'project_1',
    expectedCatalogRevision: 1,
    artifactId: 'export_1',
  },
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
  'quit-app',
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

type InvalidPayloadCase = readonly [string, string, unknown];

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
    'blank project name',
    { ...VALID_PAYLOADS['creative-studio.create-project'], name: '   ' },
  ],
  [
    'creative-studio.create-project',
    'overlong project name',
    { ...VALID_PAYLOADS['creative-studio.create-project'], name: 'x'.repeat(257) },
  ],
  [
    'creative-studio.create-project',
    'fractional project target',
    { ...VALID_PAYLOADS['creative-studio.create-project'], targetDurationSeconds: 12.5 },
  ],
  ['creative-studio.get-project', 'project id traversal', { projectId: '../project_1' }],
  [
    'creative-studio.bind-director-conversation',
    'null Director conversation id',
    { projectId: 'project_1', expectedRevision: 1, conversationId: null },
  ],
  [
    'creative-studio.bind-director-conversation',
    'legacy Director binding field',
    { projectId: 'project_1', expectedRevision: 1, briefConversationId: 'conversation_1' },
  ],
  [
    'creative-studio.prepare-paid-recovery-proposal',
    'renderer supplied quote authority during paid recovery preparation',
    {
      ...VALID_PAYLOADS['creative-studio.prepare-paid-recovery-proposal'],
      quoteId: 'quote_paid_recovery_1',
    },
  ],
  [
    'creative-studio.confirm-paid-recovery-proposal',
    'renderer supplied authorization authority during paid recovery confirmation',
    {
      ...VALID_PAYLOADS['creative-studio.confirm-paid-recovery-proposal'],
      authorizationId: 'authorization_private',
    },
  ],
  [
    'creative-studio.confirm-paid-recovery-proposal',
    'missing paid recovery proposal correlation',
    {
      projectId: 'project_1',
      quoteId: 'quote_paid_recovery_1',
      expectedRevision: 1,
    },
  ],
  [
    'creative-studio.prepare-project-references',
    'empty project-reference scope',
    { ...VALID_PAYLOADS['creative-studio.prepare-project-references'], referenceIds: [] },
  ],
  [
    'creative-studio.prepare-project-references',
    'duplicate project-reference scope',
    {
      ...VALID_PAYLOADS['creative-studio.prepare-project-references'],
      referenceIds: ['reference_character', 'reference_character'],
    },
  ],
  [
    'creative-studio.prepare-project-references',
    'renderer supplied handoff correlation',
    {
      ...VALID_PAYLOADS['creative-studio.prepare-project-references'],
      originReferenceHandoffId: 'handoff_private',
    },
  ],
  [
    'creative-studio.prepare-submission',
    'empty base choices',
    { ...VALID_PAYLOADS['creative-studio.prepare-submission'], baseChoices: [] },
  ],
  [
    'creative-studio.prepare-submission',
    'renderer supplied request authority',
    {
      ...VALID_PAYLOADS['creative-studio.prepare-submission'],
      baseChoices: [
        {
          ...VALID_PAYLOADS['creative-studio.prepare-submission'].baseChoices[0],
          requestPlan: { kind: 'resolved', snapshot: { prompt: 'private' } },
        },
      ],
    },
  ],
  [
    'creative-studio.confirm-submission',
    'renderer supplied authorization authority',
    { ...VALID_PAYLOADS['creative-studio.confirm-submission'], authorizationId: 'authorization_1' },
  ],
  [
    'creative-studio.dismiss-reference-generation-handoff',
    'renderer supplied durable receipt',
    { ...VALID_PAYLOADS['creative-studio.dismiss-reference-generation-handoff'], receipt: { kind: 'dismissed' } },
  ],
  [
    'creative-studio.apply-authoring-batch',
    'empty operation batch',
    { projectId: 'project_1', expectedRevision: 1, operations: [] },
  ],
  [
    'creative-studio.apply-authoring-batch',
    'renderer supplied reducer envelope',
    {
      schemaVersion: 3,
      projectId: 'project_1',
      expectedRevision: 1,
      operations: [{ kind: 'set_brief', brief: 'x' }],
    },
  ],
  [
    'creative-studio.apply-authoring-batch',
    'renderer supplied reducer context',
    {
      projectId: 'project_1',
      expectedRevision: 1,
      operations: [{ kind: 'set_brief', brief: 'x' }],
      mutationId: 'renderer_owned',
      capturedAt: '2026-08-19T00:00:00.000Z',
    },
  ],
  [
    'creative-studio.edit-project',
    'empty project changes',
    { projectId: 'project_1', expectedRevision: 1, changes: {} },
  ],
  [
    'creative-studio.set-rules',
    'renderer supplied canonical rule fields',
    {
      projectId: 'project_1',
      expectedRevision: 1,
      rules: [{ id: 'rule_1', text: 'x', predicate: null, scope: 'project', createdAt: 'now' }],
    },
  ],
  [
    'creative-studio.set-rules',
    'duplicate rule ids',
    {
      projectId: 'project_1',
      expectedRevision: 1,
      rules: [
        { id: 'rule_1', text: 'x', predicate: null },
        { id: 'rule_1', text: 'y', predicate: null },
      ],
    },
  ],
  [
    'creative-studio.decide-reference-request',
    'renderer supplied authorization id',
    {
      projectId: 'project_1',
      requestId: 'request_1',
      expectedRevision: 1,
      outcome: { kind: 'generation_gate', authorizationId: 'secret' },
    },
  ],
  [
    'creative-studio.import-seed-still',
    'renderer supplied source path',
    { projectId: 'project_1', shotId: 'shot_1', expectedRevision: 1, sourcePath: '/tmp/reference.png' },
  ],
  [
    'creative-studio.import-seed-still',
    'renderer supplied asset id',
    { projectId: 'project_1', shotId: 'shot_1', expectedRevision: 1, assetId: 'asset_1' },
  ],
  [
    'creative-studio.import-reference-image',
    'renderer supplied source path',
    {
      projectId: 'project_1',
      referenceId: 'reference_1',
      expectedRevision: 1,
      sourcePath: '/tmp/reference.png',
    },
  ],
  [
    'creative-studio.import-reference-image',
    'renderer supplied asset id',
    { projectId: 'project_1', referenceId: 'reference_1', expectedRevision: 1, assetId: 'asset_1' },
  ],
  [
    'creative-studio.import-reference-image',
    'missing semantic reference id',
    { projectId: 'project_1', expectedRevision: 1 },
  ],
  [
    'creative-studio.import-reference-image',
    'unsafe semantic reference id',
    { projectId: 'project_1', referenceId: '../reference', expectedRevision: 1 },
  ],
  [
    'creative-studio.import-bed-audio',
    'renderer supplied source path',
    { projectId: 'project_1', expectedRevision: 1, sourcePath: '/tmp/bed.wav' },
  ],
  [
    'creative-studio.import-bed-audio',
    'renderer supplied media facts',
    { projectId: 'project_1', expectedRevision: 1, durationSeconds: 12, mimeType: 'audio/wav' },
  ],
  ['creative-studio.detach-bed-audio', 'missing asset id', { projectId: 'project_1', expectedRevision: 1 }],
  [
    'creative-studio.detach-bed-audio',
    'unsafe asset id',
    { projectId: 'project_1', expectedRevision: 1, assetId: '../bed' },
  ],
  ['creative-studio.set-bed', 'missing asset identity', { projectId: 'project_1', expectedRevision: 1 }],
  [
    'creative-studio.create-export',
    'missing catalog revision',
    { projectId: 'project_1', expectedRevision: 1, shape: 'editor_folder' },
  ],
  [
    'creative-studio.create-export',
    'still without an active shot identity',
    { projectId: 'project_1', expectedRevision: 1, expectedCatalogRevision: 1, shape: 'still' },
  ],
  [
    'creative-studio.create-export',
    'stitched export shape',
    { projectId: 'project_1', expectedRevision: 1, expectedCatalogRevision: 1, shape: 'stitched' },
  ],
  [
    'creative-studio.create-export',
    'film without renderer-owned render identity and exact options',
    { projectId: 'project_1', expectedRevision: 1, expectedCatalogRevision: 1, shape: 'film' },
  ],
  [
    'creative-studio.copy-export',
    'renderer supplied destination path',
    {
      projectId: 'project_1',
      expectedCatalogRevision: 1,
      artifactId: 'export_1',
      destinationPath: '/tmp/export',
    },
  ],
  [
    'creative-studio.reveal-export',
    'renderer supplied managed name',
    {
      projectId: 'project_1',
      expectedCatalogRevision: 1,
      artifactId: 'export_1',
      fileName: 'managed-export',
    },
  ],
  [
    'creative-studio.persist-captured-poster',
    'legacy scene identity',
    { ...VALID_PAYLOADS['creative-studio.persist-captured-poster'], shotId: undefined, sceneId: 'scene_1' },
  ],
  [
    'creative-studio.persist-captured-poster',
    'non-PNG data URL',
    { ...VALID_PAYLOADS['creative-studio.persist-captured-poster'], dataUrl: 'data:image/jpeg;base64,/9j/' },
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
  const authoringOperations = [
    { kind: 'set_brief', brief: 'A launch story' },
    {
      kind: 'set_reference_plan',
      references: [
        { kind: 'character', label: 'Ming', prompt: 'Ming in a navy jacket.' },
        { kind: 'background', label: 'Dai pai dong', prompt: 'A neon food stall.' },
      ],
    },
    {
      kind: 'amend_reference_plan',
      additions: [{ kind: 'background', label: 'Night market', prompt: 'A recurring neon night market.' }],
    },
    { kind: 'set_reference_prompt', referenceId: 'ming', prompt: 'Ming in a navy jacket, neutral turnaround.' },
    { kind: 'select_reference_image', referenceId: 'ming', assetId: 'asset_ming_previous' },
    { kind: 'remove_reference_image', referenceId: 'ming', assetId: 'asset_ming_current' },
    {
      kind: 'set_shot_reference_binding',
      shotId: 'shot_1',
      characterReferenceIds: ['ming'],
      backgroundReferenceId: 'dai_pai_dong',
    },
    {
      kind: 'add_beat',
      beatId: 'beat_1',
      beat: { title: 'Opening', story: 'Ming sees Mei across the dai-pai-dong.', targetSeconds: 6 },
      beforeBeatId: null,
    },
    { kind: 'edit_beat', beatId: 'beat_1', changes: { title: 'New opening' } },
    { kind: 'reorder_beats', beatOrder: ['beat_1'] },
    {
      kind: 'add_binned_beat',
      beatId: 'beat_2',
      beat: { title: 'Alternate', story: '', targetSeconds: null },
    },
    {
      kind: 'add_shot',
      beatId: 'beat_1',
      shotId: 'shot_1',
      shot: { shootingScript: 'Wide reveal of Ming at the food stall.', durationSeconds: 4 },
      beforeShotId: null,
    },
    { kind: 'edit_shot', shotId: 'shot_1', changes: { shootingScript: 'Updated reveal' } },
    { kind: 'delete_shot', shotId: 'shot_1' },
    { kind: 'reorder_shots', beatId: 'beat_1', shotOrder: ['shot_1'] },
    { kind: 'set_hard_cut', shotId: 'shot_1', hardCut: true },
    { kind: 'set_seed_still', shotId: 'shot_1', assetId: null },
    { kind: 'promote_board_panel', shotId: 'shot_1', boardAssetId: 'board_1' },
    { kind: 'trim_shot', shotId: 'shot_1', trimInSeconds: null, trimOutSeconds: null },
    { kind: 'set_routes', imageRouteId: null, videoRouteId: null },
    { kind: 'set_spend_policy', policy: null },
  ] as const;

  const forbiddenAuthoringOperations = [
    { kind: 'edit_project', changes: { name: 'x' } },
    { kind: 'set_rules', rules: [] },
    { kind: 'park_beat', beatId: 'beat_1' },
    { kind: 'restore_beat', beatId: 'beat_1', beforeBeatId: null },
    { kind: 'park_shot', shotId: 'shot_1' },
    { kind: 'restore_shot', shotId: 'shot_1', beforeShotId: null },
    { kind: 'apply_coverage', beatId: 'beat_1', shots: [], fixedShots: [] },
    { kind: 'set_shot_background_reference', shotId: 'shot_1', referenceId: 'reference_background' },
    { kind: 'redetach_line', shotId: 'shot_1', line: 'x' },
    { kind: 'restore_line', shotId: 'shot_1', historyEntryId: 'history_1' },
    { kind: 'rederive_line', shotId: 'shot_1', line: 'x' },
    { kind: 'park_take', shotId: 'shot_1', assetId: 'asset_1' },
    { kind: 'add_alternate_take', shotId: 'shot_1', assetId: 'asset_1' },
    { kind: 'restore_take', shotId: 'shot_1', assetId: 'asset_1' },
    { kind: 'select_video_take', shotId: 'shot_1', assetId: 'asset_1' },
    { kind: 'remove_video_take', shotId: 'shot_1', assetId: 'asset_1' },
    { kind: 'reorder_bin', bin: [] },
    { kind: 'select_take', shotId: 'shot_1', assetId: 'asset_1' },
    { kind: 'set_match_to', shotId: null },
    { kind: 'set_bed', assetId: null },
    { kind: 'undo_last', entryId: 'undo_1' },
  ] as const;

  it.each(authoringOperations)('accepts renderer authoring operation $kind', (operation) => {
    const payload = { projectId: 'project_1', expectedRevision: 1, operations: [operation] };
    expect(parseNativeBridgePayload('creative-studio.apply-authoring-batch', payload)).toEqual(payload);
  });

  it.each([
    { kind: 'remove_reference_image', referenceId: '', assetId: 'asset_ming_current' },
    { kind: 'remove_reference_image', referenceId: 'ming', assetId: '' },
    { kind: 'remove_reference_image', referenceId: 'ming', assetId: 'asset_ming_current', deleteFile: true },
  ])('rejects an unsafe reference-image removal envelope %#', (operation) => {
    expect(() =>
      parseNativeBridgePayload('creative-studio.apply-authoring-batch', {
        projectId: 'project_1',
        expectedRevision: 1,
        operations: [operation],
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it('rejects a Director-supplied semantic reference id', () => {
    expect(() =>
      parseNativeBridgePayload('creative-studio.apply-authoring-batch', {
        projectId: 'project_1',
        expectedRevision: 1,
        operations: [
          {
            kind: 'set_reference_plan',
            references: [
              { id: 'director_owned_id', kind: 'character', label: 'Ming', prompt: 'Ming in a navy jacket.' },
            ],
          },
        ],
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it.each([
    { kind: 'amend_reference_plan', additions: [] },
    {
      kind: 'amend_reference_plan',
      additions: [{ kind: 'character', label: 'Mei', prompt: 'Mei character sheet.' }],
    },
    {
      kind: 'amend_reference_plan',
      additions: [{ id: 'caller_owned', kind: 'background', label: 'Market', prompt: 'A market.' }],
    },
    {
      kind: 'amend_reference_plan',
      additions: [
        { kind: 'background', label: 'Market', prompt: 'A market.' },
        { kind: 'background', label: 'Market', prompt: 'A duplicate market.' },
      ],
    },
  ])('rejects invalid reference-plan amendment %#', (operation) => {
    expect(() =>
      parseNativeBridgePayload('creative-studio.apply-authoring-batch', {
        projectId: 'project_1',
        expectedRevision: 1,
        operations: [operation],
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it('preserves the reviewed order of mixed Beat and Shot Bin entries', () => {
    const payload = {
      projectId: 'project_1',
      expectedRevision: 3,
      bin: [
        { kind: 'beat' as const, beatId: 'beat_1', reason: 'alternate' as const },
        { kind: 'shot' as const, beatId: 'beat_1', shotId: 'shot_1', reason: 'lifted' as const },
      ],
    };

    expect(parseNativeBridgePayload('creative-studio.reorder-bin', payload)).toEqual(payload);
  });

  it('rejects duplicate bin identities even when their disposition differs', () => {
    const payload = {
      projectId: 'project_1',
      expectedRevision: 3,
      bin: [
        { kind: 'beat' as const, beatId: 'beat_1', reason: 'lifted' as const },
        { kind: 'beat' as const, beatId: 'beat_1', reason: 'alternate' as const },
      ],
    };

    expect(() => parseNativeBridgePayload('creative-studio.reorder-bin', payload)).toThrow(
      INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
    );
  });

  it('distinguishes an ordinary zero trim from negative zero at the IPC boundary', () => {
    const zeroTrimPayload = {
      projectId: 'project_1',
      expectedRevision: 3,
      operations: [{ kind: 'trim_shot' as const, shotId: 'shot_1', trimInSeconds: 0, trimOutSeconds: null }],
    };

    expect(parseNativeBridgePayload('creative-studio.apply-authoring-batch', zeroTrimPayload)).toEqual(zeroTrimPayload);
    expect(() =>
      parseNativeBridgePayload('creative-studio.apply-authoring-batch', {
        ...zeroTrimPayload,
        operations: [{ ...zeroTrimPayload.operations[0], trimInSeconds: -0 }],
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it.each(forbiddenAuthoringOperations)('rejects catalog-only authoring operation $kind', (operation) => {
    expect(() =>
      parseNativeBridgePayload('creative-studio.apply-authoring-batch', {
        projectId: 'project_1',
        expectedRevision: 1,
        operations: [operation],
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it('enforces 1/N/N+1 authoring counts and rejects sparse arrays', () => {
    const operation = { kind: 'set_brief' as const, brief: 'x' };
    for (const count of [1, 32]) {
      expect(() =>
        parseNativeBridgePayload('creative-studio.apply-authoring-batch', {
          projectId: 'project_1',
          expectedRevision: 1,
          operations: Array.from({ length: count }, () => operation),
        })
      ).not.toThrow();
    }
    expect(() =>
      parseNativeBridgePayload('creative-studio.apply-authoring-batch', {
        projectId: 'project_1',
        expectedRevision: 1,
        operations: Array.from({ length: 33 }, () => operation),
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);

    const sparse: unknown[] = [];
    sparse.length = 1;
    expect(() =>
      parseNativeBridgePayload('creative-studio.apply-authoring-batch', {
        projectId: 'project_1',
        expectedRevision: 1,
        operations: sparse,
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it.each([
    ['creative-studio.get-project-workspace', { projectId: 'project_1' }],
    ['creative-studio.get-project-status', { projectId: 'project_1', detail: true }],
    [
      'creative-studio.analyze-shot-audio',
      { projectId: 'project_1', expectedRevision: 1, shots: [{ shotId: 'shot_1', assetId: 'take_1' }] },
    ],
    [
      'creative-studio.retry-conditioning-frame',
      { projectId: 'project_1', expectedRevision: 1, dependentShotId: 'shot_2' },
    ],
    [
      'creative-studio.cancel-waiting-cascade',
      { projectId: 'project_1', expectedRevision: 1, dependentShotId: 'shot_2' },
    ],
  ] as const)('defines exact keys for %s', (providerKey, payload) => {
    const schema = (nativeBridgePayloadSchemas as Record<string, { safeParse(value: unknown): { success: boolean } }>)[
      providerKey
    ];
    expect(schema?.safeParse(payload).success).toBe(true);
    expect(schema?.safeParse({ ...payload, jobId: 'internal_job' }).success).toBe(false);
  });

  it('requires a non-empty, unique, exact Shot audio analysis batch', () => {
    const base = {
      projectId: 'project_1',
      expectedRevision: 1,
      shots: [{ shotId: 'shot_1', assetId: 'take_1' }],
    };
    expect(parseNativeBridgePayload('creative-studio.analyze-shot-audio', base)).toEqual(base);

    for (const payload of [
      { ...base, shots: [] },
      { ...base, shots: [...base.shots, { shotId: 'shot_1', assetId: 'take_2' }] },
      { ...base, shots: [{ ...base.shots[0], internal: true }] },
      { ...base, shots: [{ shotId: '', assetId: 'take_1' }] },
    ]) {
      expect(() => parseNativeBridgePayload('creative-studio.analyze-shot-audio', payload)).toThrow(
        INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
      );
    }
  });

  it('rejects an inherited Creative Studio project-status detail option', () => {
    const payload = Object.assign(Object.create({ detail: true }) as object, { projectId: 'project_1' });
    expect(() => parseNativeBridgePayload('creative-studio.get-project-status', payload)).toThrow(
      INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
    );
  });

  it('rejects an inherited Creative Studio project-status project id', () => {
    const payload = Object.assign(Object.create({ projectId: 'project_1' }) as object, { detail: true });
    expect(() => parseNativeBridgePayload('creative-studio.get-project-status', payload)).toThrow(
      INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
    );
  });

  it('accepts only the bounded Creative Studio project-status detail variants', () => {
    expect(parseNativeBridgePayload('creative-studio.get-project-status', { projectId: 'project_1' })).toEqual({
      projectId: 'project_1',
    });
    expect(
      parseNativeBridgePayload('creative-studio.get-project-status', { projectId: 'project_1', detail: false })
    ).toEqual({ projectId: 'project_1', detail: false });
    expect(
      parseNativeBridgePayload('creative-studio.get-project-status', { projectId: 'project_1', detail: true })
    ).toEqual({ projectId: 'project_1', detail: true });
    for (const payload of [
      { projectId: 'project_1', detail: 'true' },
      { projectId: '../project_1' },
      { projectId: '' },
    ]) {
      expect(() => parseNativeBridgePayload('creative-studio.get-project-status', payload)).toThrow(
        INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
      );
    }
  });

  it.each([
    ['empty project id', { projectId: '', expectedRevision: 1, conversationId: 'conversation_1' }],
    ['traversing project id', { projectId: '../project_1', expectedRevision: 1, conversationId: 'conversation_1' }],
    ['overlong project id', { projectId: 'p'.repeat(257), expectedRevision: 1, conversationId: 'conversation_1' }],
    ['empty conversation id', { projectId: 'project_1', expectedRevision: 1, conversationId: '' }],
    [
      'traversing conversation id',
      { projectId: 'project_1', expectedRevision: 1, conversationId: '../conversation_1' },
    ],
    ['overlong conversation id', { projectId: 'project_1', expectedRevision: 1, conversationId: 'c'.repeat(257) }],
    ['zero revision', { projectId: 'project_1', expectedRevision: 0, conversationId: 'conversation_1' }],
    ['negative revision', { projectId: 'project_1', expectedRevision: -1, conversationId: 'conversation_1' }],
    ['fractional revision', { projectId: 'project_1', expectedRevision: 1.5, conversationId: 'conversation_1' }],
    [
      'unsafe integer revision',
      { projectId: 'project_1', expectedRevision: Number.MAX_SAFE_INTEGER + 1, conversationId: 'conversation_1' },
    ],
    ['infinite revision', { projectId: 'project_1', expectedRevision: Infinity, conversationId: 'conversation_1' }],
    ['string revision', { projectId: 'project_1', expectedRevision: '1', conversationId: 'conversation_1' }],
  ])('rejects a Director conversation bind with %s', (_label, payload) => {
    expect(() => parseNativeBridgePayload('creative-studio.bind-director-conversation', payload)).toThrow(
      INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
    );
  });

  it('does not let symbol or magic-key baggage cross the Director conversation payload boundary', () => {
    const symbolKeyed = {
      ...VALID_PAYLOADS['creative-studio.bind-director-conversation'],
      [Symbol('private-authority')]: 'secret',
    };
    const parsed = parseNativeBridgePayload('creative-studio.bind-director-conversation', symbolKeyed);

    expect(parsed).toEqual(VALID_PAYLOADS['creative-studio.bind-director-conversation']);
    expect(Reflect.ownKeys(parsed as object)).toEqual(['projectId', 'expectedRevision', 'conversationId']);

    const magicKeyed = JSON.parse(
      '{"projectId":"project_1","expectedRevision":1,"conversationId":"conversation_1","__proto__":{"paidAuthority":true}}'
    ) as unknown;
    expect(() => parseNativeBridgePayload('creative-studio.bind-director-conversation', magicKeyed)).toThrow(
      INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
    );
    expect(({} as { paidAuthority?: boolean }).paidAuthority).toBeUndefined();
  });

  it('accepts only the exact continuity review envelope with empty caller-authored choices', () => {
    const continuity = {
      projectId: 'project_1',
      expectedRevision: 1,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      continuityChange: { shotId: 'shot_2', hardCut: true, requiresSeedGeneration: true },
    };

    expect(parseNativeBridgePayload('creative-studio.prepare-submission', continuity)).toEqual(continuity);
    for (const hostile of [
      { ...continuity, baseChoices: [VALID_PAYLOADS['creative-studio.prepare-submission'].baseChoices[0]!] },
      { ...continuity, cascadeChoices: [VALID_PAYLOADS['creative-studio.prepare-submission'].baseChoices[0]!] },
      { ...continuity, originReferenceHandoffId: 'handoff_1' },
      { ...continuity, continuityChange: { ...continuity.continuityChange, requiresSeedGeneration: 'yes' } },
      { ...continuity, continuityChange: { ...continuity.continuityChange, provider: 'private' } },
    ]) {
      expect(() => parseNativeBridgePayload('creative-studio.prepare-submission', hostile)).toThrow(
        INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
      );
    }
  });

  it('accepts only the exact Board-promotion review envelope with empty caller-authored choices', () => {
    const promotion = {
      projectId: 'project_1',
      expectedRevision: 1,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      boardPromotion: { shotId: 'shot_1', boardAssetId: 'board_1' },
    };

    expect(parseNativeBridgePayload('creative-studio.prepare-submission', promotion)).toEqual(promotion);
    for (const hostile of [
      { ...promotion, baseChoices: [VALID_PAYLOADS['creative-studio.prepare-submission'].baseChoices[0]!] },
      { ...promotion, cascadeChoices: [VALID_PAYLOADS['creative-studio.prepare-submission'].baseChoices[0]!] },
      { ...promotion, originReferenceHandoffId: 'handoff_1' },
      { ...promotion, boardPromotion: { ...promotion.boardPromotion, boardAssetId: '../board_1' } },
      { ...promotion, boardPromotion: { ...promotion.boardPromotion, provider: 'private' } },
      { ...promotion, continuityChange: { shotId: 'shot_1', hardCut: true, requiresSeedGeneration: false } },
    ]) {
      expect(() => parseNativeBridgePayload('creative-studio.prepare-submission', hostile)).toThrow(
        INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
      );
    }
  });

  it('accepts only bounded dense prepare choices with exact renderer-owned keys', () => {
    const makeChoice = (index: number, purpose: 'seed_still' | 'video_take') => ({
      target: { kind: 'shot' as const, shotId: `shot_${index}` },
      purpose,
    });
    const maximum = {
      projectId: 'project_1',
      expectedRevision: 1,
      originReferenceHandoffId: null,
      baseChoices: Array.from({ length: STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST }, (_, index) =>
        makeChoice(index, 'seed_still')
      ),
      cascadeChoices: Array.from({ length: STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST }, (_, index) =>
        makeChoice(index, 'video_take')
      ),
    };

    expect(maximum.baseChoices.length + maximum.cascadeChoices.length).toBe(STUDIO_MAX_GENERATION_ITEMS_PER_REQUEST);
    expect(parseNativeBridgePayload('creative-studio.prepare-submission', maximum)).toEqual(maximum);

    const tooManyShots = {
      ...maximum,
      baseChoices: Array.from({ length: STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST + 1 }, (_, index) =>
        makeChoice(index, 'seed_still')
      ),
      cascadeChoices: [],
    };
    expect(() => parseNativeBridgePayload('creative-studio.prepare-submission', tooManyShots)).toThrow(
      INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
    );

    const sparseChoices: unknown[] = [];
    sparseChoices.length = 1;
    expect(() =>
      parseNativeBridgePayload('creative-studio.prepare-submission', { ...maximum, baseChoices: sparseChoices })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it('admits only an isolated bounded Board batch with no renderer reference authority', () => {
    const boardChoice = (index: number) => ({
      target: { kind: 'shot' as const, shotId: `shot_${index}` },
      purpose: 'board_still' as const,
    });
    const boardBatch = {
      projectId: 'project_1',
      expectedRevision: 1,
      originReferenceHandoffId: null,
      baseChoices: Array.from({ length: STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST }, (_, index) => boardChoice(index)),
      cascadeChoices: [],
    };

    expect(parseNativeBridgePayload('creative-studio.prepare-submission', boardBatch)).toEqual(boardBatch);
    for (const hostile of [
      { ...boardBatch, baseChoices: [...boardBatch.baseChoices, boardChoice(boardBatch.baseChoices.length)] },
      {
        ...boardBatch,
        baseChoices: [
          boardChoice(0),
          { target: { kind: 'shot' as const, shotId: 'shot_1' }, purpose: 'seed_still' as const },
        ],
      },
      { ...boardBatch, baseChoices: [boardChoice(0)], cascadeChoices: [boardChoice(1)] },
      { ...boardBatch, originReferenceHandoffId: 'handoff_1' },
      { ...boardBatch, baseChoices: [{ ...boardChoice(0), referenceAssetId: 'reference_1' }] },
    ]) {
      expect(() => parseNativeBridgePayload('creative-studio.prepare-submission', hostile)).toThrow(
        INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
      );
    }
  });

  it('accepts only the persisted Board style catalog through project edits', () => {
    for (const boardStyle of ['grey_tone', 'line_art', 'colour_key', null] as const) {
      const payload = {
        projectId: 'project_1',
        expectedRevision: 1,
        changes: { boardStyle },
      };
      expect(parseNativeBridgePayload('creative-studio.edit-project', payload)).toEqual(payload);
    }
    expect(() =>
      parseNativeBridgePayload('creative-studio.edit-project', {
        projectId: 'project_1',
        expectedRevision: 1,
        changes: { boardStyle: 'photoreal' },
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it('rejects legacy prepare counts, duplicates, and nested authority', () => {
    const valid = VALID_PAYLOADS['creative-studio.prepare-submission'];
    const choice = valid.baseChoices[0];
    expect(() =>
      parseNativeBridgePayload('creative-studio.prepare-submission', {
        ...valid,
        baseChoices: [{ ...choice, generationCount: 1 }],
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
    expect(() =>
      parseNativeBridgePayload('creative-studio.prepare-submission', {
        ...valid,
        cascadeChoices: [{ ...choice }],
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
    expect(() =>
      parseNativeBridgePayload('creative-studio.prepare-submission', {
        ...valid,
        baseChoices: [{ ...choice, routeId: 'route_1' }],
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
    expect(() =>
      parseNativeBridgePayload('creative-studio.prepare-submission', {
        ...valid,
        baseChoices: [{ ...choice, purpose: 'video_take', referenceAssetId: 'asset_1' }],
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it.each([
    ['creative-studio.prepare-project-references', VALID_PAYLOADS['creative-studio.prepare-project-references']],
    ['creative-studio.confirm-submission', VALID_PAYLOADS['creative-studio.confirm-submission']],
    ['creative-studio.retry-job-download', VALID_PAYLOADS['creative-studio.retry-job-download']],
    [
      'creative-studio.dismiss-reference-generation-handoff',
      VALID_PAYLOADS['creative-studio.dismiss-reference-generation-handoff'],
    ],
  ] as const)('keeps %s exact and free of paid authority', (providerKey, payload) => {
    expect(parseNativeBridgePayload(providerKey, payload)).toEqual(payload);
    for (const forbiddenKey of ['authorizationId', 'itemId', 'provider', 'requestPlan', 'receipt']) {
      expect(() => parseNativeBridgePayload(providerKey, { ...payload, [forbiddenKey]: 'private' })).toThrow(
        INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
      );
    }
  });

  it.each([
    ['creative-studio.prepare-project-references', VALID_PAYLOADS['creative-studio.prepare-project-references']],
    ['creative-studio.prepare-submission', VALID_PAYLOADS['creative-studio.prepare-submission']],
    ['creative-studio.confirm-submission', VALID_PAYLOADS['creative-studio.confirm-submission']],
    ['creative-studio.retry-job-download', VALID_PAYLOADS['creative-studio.retry-job-download']],
    [
      'creative-studio.dismiss-reference-generation-handoff',
      VALID_PAYLOADS['creative-studio.dismiss-reference-generation-handoff'],
    ],
  ] as const)('rejects unsafe expected revisions for %s', (providerKey, payload) => {
    for (const expectedRevision of [Number.MAX_SAFE_INTEGER + 1, 1e100]) {
      expect(() => parseNativeBridgePayload(providerKey, { ...payload, expectedRevision })).toThrow(
        INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
      );
    }
  });

  it('accepts the exact bounded generation-capability item union, including every Shot purpose and a reference image', () => {
    const payload = {
      projectId: 'project_1',
      expectedRevision: 7,
      items: [
        { target: { kind: 'shot' as const, shotId: 'shot_1' }, purpose: 'seed_still' as const },
        { target: { kind: 'shot' as const, shotId: 'shot_1' }, purpose: 'board_still' as const },
        { target: { kind: 'shot' as const, shotId: 'shot_1' }, purpose: 'video_take' as const },
        {
          target: { kind: 'reference' as const, referenceId: 'reference_1' },
          purpose: 'reference_image' as const,
        },
      ],
    };

    expect(parseNativeBridgePayload('creative-studio.get-generation-capability', payload)).toEqual(payload);
    expect(
      parseNativeBridgePayload('creative-studio.get-generation-capability', {
        projectId: 'project_1',
        expectedRevision: 7,
        items: [],
      })
    ).toEqual({ projectId: 'project_1', expectedRevision: 7, items: [] });
  });

  it('enforces the generation-capability maximum at three purposes per possible Shot plus every project reference', () => {
    const purposes = ['seed_still', 'board_still', 'video_take'] as const;
    const maximum = {
      projectId: 'project_1',
      expectedRevision: 7,
      items: [
        ...Array.from({ length: STUDIO_MAX_SHOTS_PER_PROJECT }, (_, shotIndex) =>
          purposes.map((purpose) => ({
            target: { kind: 'shot' as const, shotId: `shot_${shotIndex}` },
            purpose,
          }))
        ).flat(),
        ...Array.from({ length: STUDIO_MAX_PROJECT_REFERENCES }, (_, referenceIndex) => ({
          target: { kind: 'reference' as const, referenceId: `reference_${referenceIndex}` },
          purpose: 'reference_image' as const,
        })),
      ],
    };

    expect(maximum.items).toHaveLength(STUDIO_MAX_SHOTS_PER_PROJECT * 3 + STUDIO_MAX_PROJECT_REFERENCES);
    expect(parseNativeBridgePayload('creative-studio.get-generation-capability', maximum)).toEqual(maximum);
    expect(() =>
      parseNativeBridgePayload('creative-studio.get-generation-capability', {
        ...maximum,
        items: [...maximum.items, { target: { kind: 'shot', shotId: 'shot_over_limit' }, purpose: 'seed_still' }],
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it.each([
    ['missing items', { projectId: 'project_1', expectedRevision: 7 }],
    ['non-array items', { projectId: 'project_1', expectedRevision: 7, items: 'shot_1' }],
    [
      'duplicate Shot-purpose pair',
      {
        projectId: 'project_1',
        expectedRevision: 7,
        items: [
          { target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'seed_still' },
          { target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'seed_still' },
        ],
      },
    ],
    [
      'unsafe Shot id',
      {
        projectId: 'project_1',
        expectedRevision: 7,
        items: [{ target: { kind: 'shot', shotId: '../shot_1' }, purpose: 'seed_still' }],
      },
    ],
    [
      'unknown purpose',
      {
        projectId: 'project_1',
        expectedRevision: 7,
        items: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'reference_still' }],
      },
    ],
    [
      'reference target paired with a Shot purpose',
      {
        projectId: 'project_1',
        expectedRevision: 7,
        items: [{ target: { kind: 'reference', referenceId: 'reference_1' }, purpose: 'seed_still' }],
      },
    ],
    [
      'Shot target paired with the reference purpose',
      {
        projectId: 'project_1',
        expectedRevision: 7,
        items: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'reference_image' }],
      },
    ],
    [
      'unknown item authority',
      {
        projectId: 'project_1',
        expectedRevision: 7,
        items: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'seed_still', routeId: 'route_private' }],
      },
    ],
    [
      'missing Shot id',
      {
        projectId: 'project_1',
        expectedRevision: 7,
        items: [{ target: { kind: 'shot' }, purpose: 'seed_still' }],
      },
    ],
    [
      'missing purpose',
      { projectId: 'project_1', expectedRevision: 7, items: [{ target: { kind: 'shot', shotId: 'shot_1' } }] },
    ],
  ] as const)('rejects a generation-capability request with %s', (_label, payload) => {
    expect(() => parseNativeBridgePayload('creative-studio.get-generation-capability', payload)).toThrow(
      INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
    );
  });

  it('rejects a sparse generation-capability item array', () => {
    const items = [{ target: { kind: 'shot' as const, shotId: 'shot_1' }, purpose: 'seed_still' as const }];
    items.length = 2;

    expect(() =>
      parseNativeBridgePayload('creative-studio.get-generation-capability', {
        projectId: 'project_1',
        expectedRevision: 7,
        items,
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it('accepts every reviewed reference-decision intent and no receipt authority', () => {
    for (const outcome of [{ kind: 'rejected' as const }, { kind: 'generation_gate' as const }]) {
      const payload = { projectId: 'project_1', requestId: 'request_1', expectedRevision: 2, outcome };
      expect(parseNativeBridgePayload('creative-studio.decide-reference-request', payload)).toEqual(payload);
    }
    expect(() =>
      parseNativeBridgePayload('creative-studio.decide-reference-request', {
        projectId: 'project_1',
        requestId: 'request_1',
        expectedRevision: 2,
        outcome: { kind: 'imported_reference', assetId: 'asset_1' },
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it('bounds project-reference preparation at the shared project limit', () => {
    const maximum = {
      ...VALID_PAYLOADS['creative-studio.prepare-project-references'],
      referenceIds: Array.from({ length: STUDIO_MAX_PROJECT_REFERENCES }, (_, index) => `reference_${index}`),
    };
    expect(parseNativeBridgePayload('creative-studio.prepare-project-references', maximum)).toEqual(maximum);
    expect(() =>
      parseNativeBridgePayload('creative-studio.prepare-project-references', {
        ...maximum,
        referenceIds: [...maximum.referenceIds, 'reference_overflow'],
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
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

  it('registers the exact Task 13 native boundary while keeping legacy providers absent', () => {
    const required = [
      'creative-studio.get-director-session-authority',
      'creative-studio.bind-director-conversation',
      'creative-studio.apply-authoring-batch',
      'creative-studio.undo-last',
      'creative-studio.get-project-workspace',
      'creative-studio.get-project-status',
      'creative-studio.analyze-shot-audio',
      'creative-studio.retry-conditioning-frame',
      'creative-studio.cancel-waiting-cascade',
      'creative-studio.edit-project',
      'creative-studio.set-rules',
      'creative-studio.park-beat',
      'creative-studio.restore-beat',
      'creative-studio.park-shot',
      'creative-studio.restore-shot',
      'creative-studio.reorder-bin',
      'creative-studio.import-seed-still',
      'creative-studio.import-reference-image',
      'creative-studio.import-bed-audio',
      'creative-studio.detach-bed-audio',
      'creative-studio.set-bed',
      'creative-studio.create-export',
      'creative-studio.get-film-export-capability',
      'creative-studio.get-film-export-status',
      'creative-studio.cancel-film-export',
      'creative-studio.acknowledge-film-export',
      'creative-studio.list-exports',
      'creative-studio.copy-export',
      'creative-studio.reveal-export',
      'creative-studio.list-reference-requests',
      'creative-studio.decide-reference-request',
      'creative-studio.list-reference-generation-handoffs',
      'creative-studio.get-generation-capability',
      'creative-studio.get-project-status',
      'creative-studio.prepare-project-references',
      'creative-studio.prepare-submission',
      'creative-studio.confirm-submission',
      'creative-studio.prepare-paid-recovery-proposal',
      'creative-studio.confirm-paid-recovery-proposal',
      'creative-studio.cancel-job',
      'creative-studio.retry-job',
      'creative-studio.retry-job-download',
      'creative-studio.dismiss-reference-generation-handoff',
    ] as const;
    const absent = [
      'creative-studio.propose-storyboard',
      'creative-studio.update-model-selection',
      'creative-studio.update-project',
      'creative-studio.set-brief-rules',
      'creative-studio.undo-brief-rules',
      'creative-studio.bind-brief-conversation',
      'creative-studio.update-cut',
      'creative-studio.place-cut-scenes',
      'creative-studio.update-scene',
      'creative-studio.reorder-scenes',
      'creative-studio.select-asset',
      'creative-studio.choose-and-export-assets',
      'creative-studio.get-latest-render',
      'creative-studio.render-cut',
      'creative-studio.cancel-render',
      'creative-studio.fit-storyboard',
      'creative-studio.submit-scenes',
      'creative-studio.retry-download',
      'creative-studio.park-take',
      'creative-studio.add-alternate-take',
      'creative-studio.restore-take',
      'creative-studio.select-take',
      'creative-studio.set-match-to',
    ] as const;
    const providerKeys = collectBridgeBuildProviderKeys(readFileSync(IPC_BRIDGE_PATH, 'utf8'));
    const schemaKeys = Object.keys(nativeBridgePayloadSchemas);
    const exactOnceProviderKeys = [
      'creative-studio.get-director-session-authority',
      'creative-studio.bind-director-conversation',
      'creative-studio.get-project-status',
      'creative-studio.analyze-shot-audio',
      'creative-studio.get-generation-capability',
      'creative-studio.prepare-project-references',
      'creative-studio.prepare-submission',
      'creative-studio.confirm-submission',
      'creative-studio.prepare-paid-recovery-proposal',
      'creative-studio.confirm-paid-recovery-proposal',
      'creative-studio.cancel-job',
      'creative-studio.retry-job',
      'creative-studio.retry-job-download',
      'creative-studio.dismiss-reference-generation-handoff',
      'creative-studio.import-reference-image',
      'creative-studio.import-bed-audio',
      'creative-studio.detach-bed-audio',
      'creative-studio.set-bed',
      'creative-studio.create-export',
      'creative-studio.get-film-export-capability',
      'creative-studio.get-film-export-status',
      'creative-studio.cancel-film-export',
      'creative-studio.list-exports',
      'creative-studio.copy-export',
      'creative-studio.reveal-export',
    ] as const;

    for (const providerKey of required) {
      expect(NATIVE_BRIDGE_PROVIDER_KEYS).toContain(providerKey);
      expect(providerKeys).toContain(providerKey);
      expect(schemaKeys).toContain(providerKey);
    }
    for (const providerKey of absent) {
      expect(NATIVE_BRIDGE_PROVIDER_KEYS).not.toContain(providerKey);
      expect(providerKeys).not.toContain(providerKey);
      expect(schemaKeys).not.toContain(providerKey);
    }
    expect(NATIVE_BRIDGE_PROVIDER_KEYS.filter((key) => key.startsWith('creative-studio.'))).toHaveLength(57);
    expect(providerKeys.filter((key) => key.startsWith('creative-studio.'))).toHaveLength(57);
    expect(schemaKeys.filter((key) => key.startsWith('creative-studio.'))).toHaveLength(57);
    for (const providerKey of exactOnceProviderKeys) {
      expect(NATIVE_BRIDGE_PROVIDER_KEYS.filter((key) => key === providerKey)).toHaveLength(1);
      expect(providerKeys.filter((key) => key === providerKey)).toHaveLength(1);
      expect(schemaKeys.filter((key) => key === providerKey)).toHaveLength(1);
    }
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

  it.each([
    'presentation-templates.describe-spec',
    'presentation-templates.import-spec-bound',
    'presentation-templates.scratch.allocate',
    'presentation-sources.bind-draft',
    'presentation-sources.grant-workspace-source',
    'presentation-runs.start',
    'presentation-runs.get',
    'presentation-runs.list-recoverable',
    'presentation-runs.open-recovery',
    'presentation-runs.discard',
    'presentation-runs.claim-initial-dispatch',
    'presentation-runs.renew-initial-dispatch',
    'presentation-runs.dispatch',
  ] as const)('accepts and canonicalizes a backend conversation id for %s', (providerKey) => {
    const payload = { ...VALID_PAYLOADS[providerKey], conversation_id: 'D0921953' };

    expect(parseNativeBridgePayload(providerKey, payload)).toEqual({ ...payload, conversation_id: 'd0921953' });
  });

  it.each([
    'presentation-sources.get-source-owner',
    'presentation-sources.pick-sources',
    'presentation-sources.revoke',
    'presentation-sources.confirm-queued',
  ] as const)('accepts and canonicalizes a backend conversation owner for %s', (providerKey) => {
    const payload = {
      ...VALID_PAYLOADS[providerKey],
      owner: { owner_type: 'conversation' as const, conversation_id: 'D0921953' },
    };

    expect(parseNativeBridgePayload(providerKey, payload)).toEqual({
      ...payload,
      owner: { owner_type: 'conversation', conversation_id: 'd0921953' },
    });
  });

  it('keeps legacy conversation UUIDs compatible while canonicalizing their case', () => {
    const payload = {
      ...VALID_PAYLOADS['presentation-runs.list-recoverable'],
      conversation_id: '2BE7B8FC-6AF5-42B8-AED5-03644735C730',
    };

    expect(parseNativeBridgePayload('presentation-runs.list-recoverable', payload)).toEqual({
      ...payload,
      conversation_id: '2be7b8fc-6af5-42b8-aed5-03644735c730',
    });
  });

  it.each([
    'presentation-templates.describe-spec',
    'presentation-templates.import-spec-bound',
    'presentation-templates.scratch.allocate',
    'presentation-sources.bind-draft',
    'presentation-sources.grant-workspace-source',
    'presentation-runs.start',
    'presentation-runs.get',
    'presentation-runs.list-recoverable',
    'presentation-runs.open-recovery',
    'presentation-runs.discard',
    'presentation-runs.claim-initial-dispatch',
    'presentation-runs.renew-initial-dispatch',
    'presentation-runs.dispatch',
  ] as const)('rejects an unsafe presentation conversation id for %s', (providerKey) => {
    expect(() =>
      parseNativeBridgePayload(providerKey, {
        ...VALID_PAYLOADS[providerKey],
        conversation_id: '../private',
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it.each([
    'presentation-sources.get-source-owner',
    'presentation-sources.pick-sources',
    'presentation-sources.revoke',
    'presentation-sources.confirm-queued',
  ] as const)('rejects an unsafe presentation conversation owner for %s', (providerKey) => {
    expect(() =>
      parseNativeBridgePayload(providerKey, {
        ...VALID_PAYLOADS[providerKey],
        owner: { owner_type: 'conversation', conversation_id: '../private' },
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it.each([
    [
      'presentation-templates.scratch.complete',
      { ...VALID_PAYLOADS['presentation-templates.scratch.complete'], run_id: 'd0921953' },
    ],
    [
      'presentation-sources.create-draft',
      { ...VALID_PAYLOADS['presentation-sources.create-draft'], client_request_id: 'd0921953' },
    ],
    ['presentation-sources.bind-draft', { ...VALID_PAYLOADS['presentation-sources.bind-draft'], draft_id: 'd0921953' }],
    ['presentation-sources.revoke', { ...VALID_PAYLOADS['presentation-sources.revoke'], grant_id: 'd0921953' }],
    [
      'presentation-sources.confirm-queued',
      { ...VALID_PAYLOADS['presentation-sources.confirm-queued'], queue_item_id: 'd0921953' },
    ],
    ['presentation-runs.get', { ...VALID_PAYLOADS['presentation-runs.get'], run_id: 'd0921953' }],
    [
      'presentation-runs.claim-initial-dispatch',
      { ...VALID_PAYLOADS['presentation-runs.claim-initial-dispatch'], holder_id: 'd0921953' },
    ],
  ] as const satisfies ReadonlyArray<readonly [NativeBridgeProviderKey, unknown]>)(
    'does not widen a non-conversation presentation id for %s',
    (providerKey, payload) => {
      expect(() => parseNativeBridgePayload(providerKey, payload)).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
    }
  );

  it.each(
    (
      [
        'presentation-templates.scratch.complete',
        'presentation-templates.scratch.retain',
        'presentation-templates.scratch.discard',
      ] as const
    ).flatMap((providerKey) =>
      [
        ['nil', '00000000-0000-0000-0000-000000000000'],
        ['v6', '5a68fccc-7b90-69b4-88f9-d78bb88255ed'],
        ['bad variant', '5a68fccc-7b90-49b4-78f9-d78bb88255ed'],
      ].map(([kind, runId]) => [providerKey, kind, runId] as const)
    )
  )('rejects a %s scratch run id classified as %s', (providerKey, _kind, runId) => {
    expect(() =>
      parseNativeBridgePayload(providerKey, {
        ...VALID_PAYLOADS[providerKey],
        run_id: runId,
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

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
    ['creative-studio.has-unsaved-work', { dirtyDraftCount: 0 }],
    ['creative-studio.has-unsaved-work', { dirtyDraftCount: 24 }],
    ['creative-studio.flush-unsaved-work', { saved: true }],
    ['creative-studio.flush-unsaved-work', { saved: false }],
  ] as const satisfies ReadonlyArray<readonly [RendererBridgeQueryKey, unknown]>)(
    'accepts a strict response for renderer-owned query %s',
    (queryKey, response) => {
      expect(parseRendererBridgeQueryResponse(queryKey, response)).toEqual(response);
    }
  );

  it.each([
    ['creative-studio.has-unsaved-work', { dirtyDraftCount: -1 }],
    ['creative-studio.has-unsaved-work', { dirtyDraftCount: 25 }],
    ['creative-studio.has-unsaved-work', { dirtyDraftCount: 1.5 }],
    ['creative-studio.has-unsaved-work', { dirtyDraftCount: 1, unexpected: true }],
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

  it('accepts the renderer-owned Pilot photo request and enforces its conditioning bound', () => {
    const withoutReferences: StudioPreparePhotoRequestV3 = {
      ...VALID_PILOT_PREPARE_PHOTO_PAYLOAD,
      referencePieceIds: [],
    };
    const maximum: StudioPreparePhotoRequestV3 = {
      ...VALID_PILOT_PREPARE_PHOTO_PAYLOAD,
      referencePieceIds: Array.from(
        { length: STUDIO_MAX_PIECE_CONDITIONING_INPUTS_V3 },
        (_, index) => `piece_reference_${index}`
      ),
    };

    expect(parseNativeBridgePayload('creative-studio-pilot.prepare-photo', withoutReferences)).toEqual(
      withoutReferences
    );
    expect(parseNativeBridgePayload('creative-studio-pilot.prepare-photo', maximum)).toEqual(maximum);
    expect(() =>
      parseNativeBridgePayload('creative-studio-pilot.prepare-photo', {
        ...maximum,
        referencePieceIds: [...maximum.referencePieceIds, 'piece_reference_overflow'],
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
    expect(() =>
      parseNativeBridgePayload('creative-studio-pilot.prepare-photo', {
        mode: 'create',
        projectId: 'project_1',
        expectedAuthoringRevision: 1,
        words: 'Legacy transport without the required reference selection.',
        settings: { aspectRatio: '16:9', resolution: '1080p' },
        suggestedHandle: null,
      })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it('keeps the Pilot retry transport independent from create-photo references', () => {
    const retry = {
      mode: 'retry',
      projectId: 'project_1',
      expectedAuthoringRevision: 2,
      pieceId: 'piece_1',
      sourceJobId: 'job_1',
    } as const;

    expect(parseNativeBridgePayload('creative-studio-pilot.prepare-photo', retry)).toEqual(retry);
    expect(() =>
      parseNativeBridgePayload('creative-studio-pilot.prepare-photo', { ...retry, referencePieceIds: [] })
    ).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it('reads authoring and dirty bounds from shared authorities', async () => {
    vi.resetModules();
    vi.doMock('@/common/types/project/creativeStudioTypes', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      STUDIO_MAX_MUTATION_OPERATIONS: 2,
      STUDIO_MAX_DIRTY_DRAFTS_REPORTED: 2,
    }));
    try {
      const schemas = await import('@/common/adapter/native/payloadSchemas');
      expect(() =>
        schemas.parseNativeBridgePayload('creative-studio.apply-authoring-batch', {
          projectId: 'project_1',
          expectedRevision: 1,
          operations: Array.from({ length: 3 }, () => ({ kind: 'set_brief', brief: 'x' })),
        })
      ).toThrow(schemas.INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
      expect(() =>
        schemas.parseRendererBridgeQueryResponse('creative-studio.has-unsaved-work', { dirtyDraftCount: 3 })
      ).toThrow(schemas.INVALID_RENDERER_BRIDGE_QUERY_PAYLOAD_MESSAGE);
    } finally {
      vi.doUnmock('@/common/types/project/creativeStudioTypes');
      vi.resetModules();
    }
  });

  it('accepts only the four exact export shapes and keeps main-owned names absent', () => {
    const common = { projectId: 'project_1', expectedRevision: 7, expectedCatalogRevision: 2 };
    expect(parseNativeBridgePayload('creative-studio.create-export', { ...common, shape: 'editor_folder' })).toEqual({
      ...common,
      shape: 'editor_folder',
    });
    expect(parseNativeBridgePayload('creative-studio.create-export', { ...common, shape: 'script' })).toEqual({
      ...common,
      shape: 'script',
    });
    expect(
      parseNativeBridgePayload('creative-studio.create-export', { ...common, shape: 'still', shotId: 'shot_1' })
    ).toEqual({ ...common, shape: 'still', shotId: 'shot_1' });
    const film = {
      ...common,
      shape: 'film' as const,
      renderId: 'film_1',
      transition: { kind: 'dissolve' as const, seconds: 0.35 },
      trimTails: true,
    };
    expect(parseNativeBridgePayload('creative-studio.create-export', film)).toEqual(film);
    for (const payload of [
      { ...film, transition: { kind: 'dissolve', seconds: 0 } },
      { ...film, transition: { kind: 'cut', seconds: 0.35 } },
      { ...film, trimTails: 'yes' },
      { ...film, outputPath: '/private/film.mp4' },
    ]) {
      expect(() => parseNativeBridgePayload('creative-studio.create-export', payload)).toThrow(
        INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
      );
    }
    for (const shape of ['stitched', 'video', 'project'] as const) {
      expect(() => parseNativeBridgePayload('creative-studio.create-export', { ...common, shape })).toThrow(
        INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
      );
    }
  });

  it('accepts an explicit clear intent for bed without accepting a missing field', () => {
    expect(
      parseNativeBridgePayload('creative-studio.set-bed', {
        projectId: 'project_1',
        expectedRevision: 7,
        assetId: null,
      })
    ).toEqual({ projectId: 'project_1', expectedRevision: 7, assetId: null });
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

  it.each(
    INVALID_PAYLOADS.filter(([providerKey]) =>
      NATIVE_BRIDGE_PROVIDER_KEYS.includes(providerKey as NativeBridgeProviderKey)
    )
  )('rejects %s payload with %s', (providerKey, _reason, payload) => {
    expect(() => parseNativeBridgePayload(providerKey as NativeBridgeProviderKey, payload)).toThrow(
      INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
    );
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

  it('does not retain payload-controlled record keys in native rejection diagnostics', () => {
    const secretKey = 'customer-secret-token-name';
    let thrown: unknown;
    try {
      parseNativeBridgePayload('theme:set-active', {
        ...VALID_PAYLOADS['theme:set-active'],
        tokens: { [secretKey]: 42 },
      });
    } catch (error) {
      thrown = error;
    }

    expect(getNativeBridgePayloadDiagnostic(thrown)).toEqual({
      providerKey: 'theme:set-active',
      issues: [{ code: 'invalid_type', path: ['tokens'] }],
    });
    expect(JSON.stringify(getNativeBridgePayloadDiagnostic(thrown))).not.toContain(secretKey);
  });

  it('returns no native rejection diagnostic for unrelated errors or non-errors', () => {
    expect([
      getNativeBridgePayloadDiagnostic(new Error('unrelated')),
      getNativeBridgePayloadDiagnostic(undefined),
    ]).toEqual([null, null]);
  });

  it('bounds native rejection diagnostics without retaining Zod messages or received data', () => {
    const secret = 'secret-diagnostic-value';
    const oversizedPath = Array.from({ length: 12 }, (_, index) => `${'field'.repeat(40)}-${index}`);
    const safeParse = vi.spyOn(nativeBridgePayloadSchemas['webui.start'], 'safeParse').mockReturnValue({
      success: false,
      error: {
        issues: Array.from({ length: 12 }, () => ({
          code: 'custom',
          path: oversizedPath,
          message: secret,
          received: secret,
        })),
      },
    } as never);

    let thrown: unknown;
    try {
      parseNativeBridgePayload('webui.start', { port: secret });
    } catch (error) {
      thrown = error;
    } finally {
      safeParse.mockRestore();
    }

    const diagnostic = getNativeBridgePayloadDiagnostic(thrown);
    expect({
      issueCount: diagnostic?.issues.length,
      issueShapeIsSafe: diagnostic?.issues.every(
        (issue) =>
          Object.keys(issue).toSorted().join(',') === 'code,path' &&
          issue.path.length <= 8 &&
          JSON.stringify(issue.path).length <= 256
      ),
      topLevelShapeIsSafe: diagnostic && Object.keys(diagnostic).toSorted().join(',') === 'issues,providerKey',
    }).toEqual({ issueCount: 8, issueShapeIsSafe: true, topLevelShapeIsSafe: true });
    expect(JSON.stringify(diagnostic)).not.toContain(secret);
  });
});
