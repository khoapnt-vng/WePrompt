/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateStudioProjectInput,
  StudioAsset,
  StudioCut,
  StudioEditableCut,
  StudioEditableScene,
  StudioJob,
  StudioProject,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
  StudioScene,
  StudioTextModelOption,
  StudioUpdateModelSelectionRequest,
} from '@/common/types/project/creativeStudioTypes';
import { STUDIO_ENV } from '@/common/types/project/creativeStudioMcpEnv';
import type { IProvider } from '@/common/config/storage';
import type { GenerationProviderAdapter } from '@process/services/creative-studio/adapters';
import { STUDIO_E2E_BOUNDARY_SENTINELS } from '@process/services/creative-studio/adapters/e2eFakeAdapter';
import type { CreativeStudioStore, CreativeStudioStoreError } from '@process/services/creative-studio/store';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';
import {
  createCreativeStudioService,
  type CreativeStudioService,
} from '@process/services/creative-studio/creativeStudioService';
import { createStudioMediaChoiceId } from '@process/services/creative-studio/providerResolver';
import { canCancelJob } from '@process/services/creative-studio/jobManager';
import {
  StudioStoryboardPlannerError,
  type StudioStoryboardPlanner,
} from '@process/services/creative-studio/planning/storyboardPlanner';
import {
  createListRoutesHandler,
  createProposeStoryboardHandler,
  createReadStoryboardHandler,
  createRequestReferenceImagesHandler,
  parseStudioServerEnv,
  registerStudioTools,
} from '@process/resources/builtinMcp/studioServer';
import { BUILTIN_STUDIO_NAME } from '@process/resources/builtinMcp/constants';
import * as referenceRequestWriter from '@process/resources/builtinMcp/studioReferenceRequestWriter';

const makeInput = (overrides: Partial<CreateStudioProjectInput> = {}): CreateStudioProjectInput => ({
  name: 'Launch film',
  brief: 'A short launch story',
  aspectRatio: '16:9',
  targetDurationSeconds: 12,
  resolution: '1080p',
  ...overrides,
});

const makeScene = (id: string, durationSeconds = 4): StudioEditableScene => ({
  title: `Scene ${id}`,
  purpose: 'Introduce the product',
  visualPrompt: 'A cinematic studio product reveal',
  narration: '',
  onScreenText: '',
  mediaKind: 'video',
  durationSeconds,
  referenceAssetId: null,
});

const addTake = (
  project: StudioProject,
  sceneId: string,
  assetId: string,
  durationSeconds: number | undefined,
  selected = true,
  collection: StudioAsset['managedAsset']['collection'] = 'assets'
): void => {
  const scene = project.scenes[sceneId]!;
  project.assets[assetId] = {
    id: assetId,
    projectId: project.id,
    sceneId,
    mediaKind: scene.mediaKind,
    mimeType: scene.mediaKind === 'video' ? 'video/mp4' : 'image/png',
    managedAsset: { collection, fileName: `${assetId}.${scene.mediaKind === 'video' ? 'mp4' : 'png'}` },
    byteSize: 1,
    sha256: 'a'.repeat(64),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    createdAt: project.createdAt,
  };
  scene.assetIds.push(assetId);
  if (selected) scene.selectedAssetId = assetId;
};

const addReferencePlate = (project: StudioProject, sourceVisualPrompt?: string): void => {
  project.sceneOrder = ['s1'];
  project.scenes.s1 = {
    id: 's1',
    ...makeScene('s1'),
    referenceAssetId: 'reference_1',
    selectedAssetId: null,
    assetIds: ['reference_1'],
    jobIds: [],
    reviewState: 'ready',
  };
  project.assets.reference_1 = {
    id: 'reference_1',
    projectId: project.id,
    sceneId: 's1',
    mediaKind: 'image',
    mimeType: 'image/png',
    managedAsset: { collection: 'references', fileName: 'reference_1.png' },
    byteSize: 1,
    sha256: 'a'.repeat(64),
    createdAt: project.createdAt,
    ...(sourceVisualPrompt === undefined ? {} : { sourceVisualPrompt }),
  };
};

const editableCut = (cut: StudioCut): StudioEditableCut => ({
  orderMode: cut.orderMode,
  clipOrder: [...cut.clipOrder],
  clips: Object.fromEntries(
    Object.entries(cut.clips).map(([clipId, clip]) => [
      clipId,
      {
        sourceInSeconds: clip.sourceInSeconds,
        sourceOutSeconds: clip.sourceOutSeconds,
        crop: clip.crop === null ? null : { ...clip.crop },
        filters: clip.filters.map((filter) => ({ ...filter })),
      },
    ])
  ),
});

const storyboardProposal = {
  projectSummary: 'A concise product launch story.',
  scenes: [
    {
      title: 'Opening',
      purpose: 'Set the need.',
      visualPrompt: 'A cinematic morning commute.',
      narration: 'Every day starts with a choice.',
      onScreenText: '',
      mediaKind: 'video' as const,
      durationSeconds: 4,
    },
    {
      title: 'Product',
      purpose: 'Show the product.',
      visualPrompt: 'A premium reusable bottle in a studio.',
      narration: '',
      onScreenText: 'Built to last.',
      mediaKind: 'image' as const,
      durationSeconds: 4,
    },
    {
      title: 'Payoff',
      purpose: 'Close the story.',
      visualPrompt: 'Friends share a hilltop sunset.',
      narration: 'Carry better habits forward.',
      onScreenText: 'Refill your future.',
      mediaKind: 'video' as const,
      durationSeconds: 4,
    },
  ],
};

const studioServerProjectFixture = {
  schemaVersion: 1,
  id: 'project_1',
  revision: 7,
  name: 'Coffee teaser',
  brief: 'A 10-second teaser for a mountain coffee brand',
  aspectRatio: '16:9',
  targetDurationSeconds: 10,
  sceneOrder: ['scene_1'],
  scenes: {
    scene_1: {
      id: 'scene_1',
      title: 'Sunrise',
      purpose: '',
      visualPrompt: '',
      narration: '',
      onScreenText: '',
      mediaKind: 'image',
      durationSeconds: 5,
      referenceAssetId: null,
      selectedAssetId: null,
      assetIds: [],
      jobIds: [],
      reviewState: 'draft',
    },
  },
  assets: {},
  jobs: {},
};

const storyboardOptions: StudioTextModelOption[] = [
  {
    providerId: 'provider_1',
    providerName: 'Provider One',
    model: 'gpt-4o',
    health: 'available',
  },
];

const routeOption = (
  kind: 'image' | 'video',
  overrides: Partial<
    StudioRouteCatalogEntry & {
      adapterId: 'weprompt-image-v1' | 'weprompt-media-gateway-v1' | 'openrouter-video-v1';
      cancellationPolicy: 'none' | 'queued_only' | 'queued_and_running';
    }
  > = {}
): StudioRouteCatalogEntry & {
  adapterId: 'weprompt-image-v1' | 'weprompt-media-gateway-v1' | 'openrouter-video-v1';
  cancellationPolicy: 'none' | 'queued_only' | 'queued_and_running';
} => {
  const route = {
    providerId: 'provider_1',
    providerName: 'Provider One',
    adapterId: kind === 'image' ? ('weprompt-image-v1' as const) : ('weprompt-media-gateway-v1' as const),
    model: `${kind}-model`,
    health: 'available' as const,
    kind,
    cancellationPolicy: 'none' as const,
    constraints: {
      aspectRatios: ['16:9'],
      resolutions: ['1080p'],
      minDurationSeconds: 1,
      maxDurationSeconds: 12,
      supportsFirstFrame: true,
      silentOutput: true,
    },
    ...overrides,
  };
  return {
    ...route,
    choiceId:
      overrides.choiceId ??
      createStudioMediaChoiceId({
        providerId: route.providerId,
        adapterId: route.adapterId,
        model: route.model,
        kind: route.kind,
      }),
  };
};

const KNOWN_ADAPTER_SENTINEL = 'weprompt-media-gateway-v1';
const GATEWAY_INTEGRATION_ID = 'integration_x5T8cW1h';

type RendererBoundaryLeak = {
  path: string;
  reason: 'adapter_key' | 'adapter_value';
};

const collectRendererBoundaryLeaks = (
  value: unknown,
  valuePath = '$',
  found: RendererBoundaryLeak[] = []
): RendererBoundaryLeak[] => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectRendererBoundaryLeaks(item, `${valuePath}[${index}]`, found));
    return found;
  }
  if (typeof value !== 'object' || value === null) {
    if (value === KNOWN_ADAPTER_SENTINEL) found.push({ path: valuePath, reason: 'adapter_value' });
    return found;
  }
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${valuePath}.${key}`;
    if (key === 'adapterId') found.push({ path: nestedPath, reason: 'adapter_key' });
    collectRendererBoundaryLeaks(nested, nestedPath, found);
  }
  return found;
};

const expectRendererBoundaryToHideAdapters = (value: unknown): void => {
  expect(collectRendererBoundaryLeaks(value)).toEqual([]);
};

type SelectionService = CreativeStudioService & {
  updateModelSelection(input: StudioUpdateModelSelectionRequest): Promise<StudioRendererProject>;
};

const makePlanner = (overrides: Partial<StudioStoryboardPlanner> = {}): StudioStoryboardPlanner => ({
  listModels: async () => storyboardOptions,
  draft: async () => storyboardProposal,
  dispose: async () => {},
  ...overrides,
});

const selectStoryboard = (store: ReturnType<typeof createCreativeStudioStore>, project: StudioRendererProject) =>
  store.updateProject(project.id, (current) => ({
    ...current,
    routing: {
      ...current.routing,
      storyboard: { providerId: 'provider_1', model: 'gpt-4o' },
    },
  }));

type StoryboardService = CreativeStudioService & {
  proposeStoryboard(input: {
    projectId: string;
    expectedRevision: number;
    replaceExisting: boolean;
  }): Promise<StudioRendererProject>;
};

describe('CreativeStudioService', () => {
  let rootDir = '';
  let store: CreativeStudioStore;
  let service: CreativeStudioService;
  let onProjectUpdated: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), 'creative-studio-service-'));
    onProjectUpdated = vi.fn();
    store = createCreativeStudioStore({
      rootDir,
      now: () => '2026-07-30T00:00:00.000Z',
      createId: () => 'project_1',
    });
    service = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(rootDir, { recursive: true, force: true });
  });

  it('rejects an update for a missing project instead of creating an orphan manifest', async () => {
    await expect(
      service.updateProject({ projectId: 'missing_project', expectedRevision: 1, name: 'Changed' })
    ).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<CreativeStudioStoreError>);
  });

  it('replaces the rule list, stamps project scope, and preserves createdAt for a rule that stays', async () => {
    const ruled = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      createRuleId: () => 'rule_minted',
    });
    const project = await ruled.createProject(makeInput());

    const first = await ruled.setBriefRules({
      projectId: project.id,
      expectedRevision: project.revision,
      rules: [{ id: 'rule_1', text: '  Keep the kits generic.  ', predicate: null }],
    });
    const createdAt = first.rules[0].createdAt;

    const second = await ruled.setBriefRules({
      projectId: project.id,
      expectedRevision: first.revision,
      rules: [
        { id: 'rule_1', text: 'Keep the kits generic.', predicate: null },
        { id: 'rule_2', text: 'No competitor logos.', predicate: { kind: 'forbidden_terms', terms: ['acme'] } },
      ],
    });

    expect(second.rules).toEqual([
      { id: 'rule_1', scope: 'project', text: 'Keep the kits generic.', predicate: null, createdAt },
      {
        id: 'rule_2',
        scope: 'project',
        text: 'No competitor logos.',
        predicate: { kind: 'forbidden_terms', terms: ['acme'] },
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
    ]);
  });

  it('refuses a stale revision rather than clobbering a concurrent edit', async () => {
    const project = await service.createProject(makeInput());

    await expect(
      service.setBriefRules({ projectId: project.id, expectedRevision: project.revision + 5, rules: [] })
    ).rejects.toMatchObject({ code: 'stale_project' });
  });

  it('rejects an enforced rule term that token matching can never detect', async () => {
    const project = await service.createProject(makeInput());

    await expect(
      service.setBriefRules({
        projectId: project.id,
        expectedRevision: project.revision,
        rules: [
          {
            id: 'rule_1',
            text: 'No symbol-only mark.',
            predicate: { kind: 'forbidden_terms', terms: ['+++'] },
          },
        ],
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('deduplicates forbidden terms under case folding while preserving the first spelling', async () => {
    const project = await service.createProject(makeInput());

    const updated = await service.setBriefRules({
      projectId: project.id,
      expectedRevision: project.revision,
      rules: [
        {
          id: 'rule_1',
          text: 'No competitor marks.',
          predicate: { kind: 'forbidden_terms', terms: [' Nike ', 'nike', 'NIKE', 'Adidas'] },
        },
      ],
    });

    expect(updated.rules[0].predicate?.terms).toEqual(['Nike', 'Adidas']);
  });

  it('persists the Brief conversation binding and returns it through the renderer projection', async () => {
    const project = await service.createProject(makeInput());

    const bound = await service.bindBriefConversation({
      projectId: project.id,
      expectedRevision: project.revision,
      conversationId: 'conversation_brief',
    });

    expect(bound.briefConversationId).toBe('conversation_brief');
    await expect(service.getProject(project.id)).resolves.toMatchObject({
      briefConversationId: 'conversation_brief',
    });
  });

  it('projects a reference asset with its managed collection', async () => {
    const project = await service.createProject(makeInput());
    await store.updateProject(project.id, (current) => {
      const next = structuredClone(current);
      addReferencePlate(next);
      return next;
    });

    const rendererProject = await service.getProject(project.id);

    expect(rendererProject?.assets.reference_1.managedAsset.collection).toBe('references');
  });

  it('projects the visual prompt an asset was generated from', async () => {
    const project = await service.createProject(makeInput());
    await store.updateProject(project.id, (current) => {
      const next = structuredClone(current);
      addReferencePlate(next, 'Aerial, drifting. Smoke columns.');
      return next;
    });

    const rendererProject = await service.getProject(project.id);
    const asset = Object.values(rendererProject?.assets ?? {}).find((candidate) => candidate.sceneId === 's1');

    expect(asset?.sourceVisualPrompt).toBe('Aerial, drifting. Smoke columns.');
  });

  it('leaves provenance undefined for an asset that never recorded one', async () => {
    const project = await service.createProject(makeInput());
    await store.updateProject(project.id, (current) => {
      const next = structuredClone(current);
      addReferencePlate(next);
      return next;
    });

    const rendererProject = await service.getProject(project.id);
    const asset = Object.values(rendererProject?.assets ?? {}).find((candidate) => candidate.sceneId === 's1');

    expect(asset?.sourceVisualPrompt).toBeUndefined();
    expect(asset).not.toHaveProperty('sourceVisualPrompt');
  });

  it('builds a project-scoped Brief session-server descriptor', async () => {
    const project = await service.createProject(makeInput());
    const scriptPath = '/tmp/builtin-mcp-studio.js';
    const descriptorService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      providerResolver: {
        listConnectionCandidates: async () => [],
        listGenerationRoutes: async () => ({
          routes: [routeOption('image', { model: 'image-model' }), routeOption('video', { model: 'video-model' })],
          generationCatalogVersion: 'generation-v1',
        }),
        isGenerationRouteAvailable: async () => true,
      },
      getStudioServerScriptPath: () => scriptPath,
    } as unknown as Parameters<typeof createCreativeStudioService>[0]);
    const paths = await store.resolveProposalPaths(project.id);
    const routeCatalog = await descriptorService.listRoutes({ projectId: project.id });

    await expect(descriptorService.getBriefSessionServer({ projectId: project.id })).resolves.toEqual({
      id: `studio-brief-${project.id}`,
      name: BUILTIN_STUDIO_NAME,
      transport: {
        type: 'stdio',
        command: 'node',
        args: [scriptPath],
        env: {
          [STUDIO_ENV.projectId]: project.id,
          [STUDIO_ENV.projectDir]: paths.projectDir,
          [STUDIO_ENV.pendingDir]: paths.pendingDir,
          [STUDIO_ENV.referencePendingDir]: paths.referencePendingDir,
          [STUDIO_ENV.routeCatalog]: JSON.stringify(routeCatalog),
        },
      },
    });
  });

  it('reports the newest verified cut file and its render time without exposing a storage path', async () => {
    const renderedCut: StudioAsset = {
      id: 'render_1',
      projectId: 'project_1',
      sceneId: null,
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'render_1.mp4' },
      byteSize: 512,
      sha256: 'a'.repeat(64),
      createdAt: '2026-08-07T04:05:06.000Z',
    };
    const getLatestProjectOutput = vi.fn(async () => renderedCut);
    const renderService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      mediaStore: {
        importReferenceFromPath: vi.fn(),
        exportAssetsToDirectory: vi.fn(),
        getLatestProjectOutput,
      },
    });

    await expect(renderService.getLatestRender({ projectId: 'project_1' })).resolves.toEqual({
      fileName: 'cut.mp4',
      renderedAt: renderedCut.createdAt,
    });
    expect(getLatestProjectOutput).toHaveBeenCalledExactlyOnceWith('project_1');
  });

  it('rejects a stale Brief binding revision without replacing the persisted conversation id', async () => {
    const project = await service.createProject(makeInput());
    await service.bindBriefConversation({
      projectId: project.id,
      expectedRevision: project.revision,
      conversationId: 'conversation_first',
    });

    await expect(
      service.bindBriefConversation({
        projectId: project.id,
        expectedRevision: project.revision,
        conversationId: 'conversation_stale',
      })
    ).rejects.toMatchObject({ code: 'stale_project' } satisfies Partial<CreativeStudioStoreError>);
    await expect(service.getProject(project.id)).resolves.toMatchObject({
      briefConversationId: 'conversation_first',
    });
  });

  it('does not accept the Brief binding through the scalar project update whitelist', async () => {
    const project = await service.createProject(makeInput());

    const updated = await service.updateProject({
      projectId: project.id,
      expectedRevision: project.revision,
      name: 'Renamed launch film',
      briefConversationId: 'conversation_injected',
    } as never);

    expect(updated.briefConversationId).toBeNull();
  });

  describe('proposal acceptance', () => {
    const payload = {
      kind: 'replace_storyboard' as const,
      sceneOrder: ['scene_proposed'],
      scenes: { scene_proposed: makeScene('scene_proposed') },
    };

    it('accepts a current proposal through its stored base revision exactly once', async () => {
      const project = await service.createProject(makeInput());
      await store.recordProposal({
        projectId: project.id,
        proposalId: 'proposal_1',
        baseRevision: project.revision,
        payload,
      });
      onProjectUpdated.mockClear();

      const first = await service.acceptProposal({ projectId: project.id, proposalId: 'proposal_1' });
      const second = await service.acceptProposal({ projectId: project.id, proposalId: 'proposal_1' });

      expect(first.project).toMatchObject({
        revision: project.revision + 1,
        sceneOrder: ['scene_proposed'],
        scenes: { scene_proposed: expect.objectContaining({ title: 'Scene scene_proposed' }) },
      });
      expect(second).toEqual(first);
      await expect(service.getProject(project.id)).resolves.toEqual(first.project);
      expect(onProjectUpdated).toHaveBeenCalledExactlyOnceWith(project.id);
    });

    it('fails closed on a stale proposal and leaves the project manifest byte-for-byte unchanged', async () => {
      const project = await service.createProject(makeInput());
      await store.recordProposal({
        projectId: project.id,
        proposalId: 'proposal_stale',
        baseRevision: project.revision,
        payload,
      });
      await service.updateProject({
        projectId: project.id,
        expectedRevision: project.revision,
        name: 'User edit while proposal was drafting',
      });
      const projectPath = path.join(rootDir, project.id, 'project.json');
      const before = await readFile(projectPath);

      await expect(
        service.acceptProposal({ projectId: project.id, proposalId: 'proposal_stale' })
      ).rejects.toMatchObject({ code: 'stale_project' });

      expect(await readFile(projectPath)).toEqual(before);
      await expect(service.listProposals({ projectId: project.id })).resolves.toMatchObject([
        { id: 'proposal_stale', status: 'pending' },
      ]);
    });

    it('rejects without changing the project and keeps the proposal as durable rejected history', async () => {
      const project = await service.createProject(makeInput());
      await store.recordProposal({
        projectId: project.id,
        proposalId: 'proposal_rejected',
        baseRevision: project.revision,
        payload,
      });

      const rejected = await service.rejectProposal({ projectId: project.id, proposalId: 'proposal_rejected' });

      expect(rejected.status).toBe('rejected');
      await expect(service.getProject(project.id)).resolves.toEqual(project);
      // The listing is main's first observation of this record, so it freezes the diff the user declined.
      await expect(service.listProposals({ projectId: project.id })).resolves.toEqual([
        { ...rejected, diff: { added: 1, removed: 0, changed: [] } },
      ]);
    });
  });

  describe('proposal diff', () => {
    const storyboard = (narration: string) => ({
      kind: 'replace_storyboard' as const,
      sceneOrder: ['drafted_1', 'drafted_2'],
      scenes: {
        drafted_1: makeScene('drafted_1'),
        drafted_2: { ...makeScene('drafted_2'), narration },
      },
    });

    const seedStoryboard = async (projectId: string, revision: number): Promise<StudioRendererProject> => {
      await store.recordProposal({
        projectId,
        proposalId: 'proposal_seed',
        baseRevision: revision,
        payload: storyboard('First cut of the closing line.'),
      });
      const accepted = await service.acceptProposal({ projectId, proposalId: 'proposal_seed' });
      return accepted.project;
    };

    it('reports a one-field re-draft as one changed shot even though every proposed scene id is new', async () => {
      const created = await service.createProject(makeInput());
      const project = await seedStoryboard(created.id, created.revision);
      await store.recordProposal({
        projectId: project.id,
        proposalId: 'proposal_redraft',
        baseRevision: project.revision,
        payload: {
          kind: 'replace_storyboard',
          sceneOrder: ['redrafted_1', 'redrafted_2'],
          scenes: {
            redrafted_1: makeScene('drafted_1'),
            redrafted_2: { ...makeScene('drafted_2'), narration: 'Second cut of the closing line.' },
          },
        },
      });

      const [proposal] = await service.listProposals({ projectId: project.id });

      expect(proposal.diff).toEqual({
        added: 0,
        removed: 0,
        changed: [{ position: 2, fields: ['narration'] }],
      });
    });

    it('keeps the frozen diff after acceptance instead of recomputing it against the applied script', async () => {
      const created = await service.createProject(makeInput());
      const project = await seedStoryboard(created.id, created.revision);
      await store.recordProposal({
        projectId: project.id,
        proposalId: 'proposal_applied',
        baseRevision: project.revision,
        payload: storyboard('Rewritten closing line.'),
      });
      const [pending] = await service.listProposals({ projectId: project.id });

      const accepted = await service.acceptProposal({ projectId: project.id, proposalId: 'proposal_applied' });
      const [afterAcceptance] = await service.listProposals({ projectId: project.id });

      expect(pending.diff).toEqual({ added: 0, removed: 0, changed: [{ position: 2, fields: ['narration'] }] });
      expect(accepted.proposal.diff).toEqual(pending.diff);
      expect(afterAcceptance.status).toBe('accepted');
      expect(afterAcceptance.diff).toEqual(pending.diff);
    });

    it('leaves the diff absent when the script already moved past the revision the proposal was drafted from', async () => {
      const created = await service.createProject(makeInput());
      const project = await seedStoryboard(created.id, created.revision);
      await store.recordProposal({
        projectId: project.id,
        proposalId: 'proposal_overtaken',
        baseRevision: project.revision,
        payload: storyboard('Rewritten closing line.'),
      });
      await service.updateProject({
        projectId: project.id,
        expectedRevision: project.revision,
        name: 'User edit while the proposal waited',
      });

      const [proposal] = await service.listProposals({ projectId: project.id });

      expect(proposal.status).toBe('pending');
      expect(proposal.diff).toBeUndefined();
    });
  });

  it('decodes a renderer PNG and notifies only after captured-poster persistence succeeds', async () => {
    const capturedPoster: StudioAsset = {
      id: 'poster_1',
      projectId: 'project_1',
      sceneId: 'scene_1',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'thumbnails', fileName: 'poster_1.png' },
      byteSize: 8,
      sha256: '1'.repeat(64),
      width: 1280,
      height: 720,
      createdAt: '2026-08-05T00:00:00.000Z',
    };
    let capturedBytes = Buffer.alloc(0);
    const persistCapturedPoster = vi.fn(async (input: { body: AsyncIterable<Uint8Array> }) => {
      for await (const chunk of input.body) capturedBytes = Buffer.concat([capturedBytes, chunk]);
      return capturedPoster;
    });
    const posterService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir, createId: () => 'project_1' }),
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      mediaStore: {
        importReferenceFromPath: vi.fn(),
        exportAssetsToDirectory: vi.fn(),
        getLatestProjectOutput: vi.fn(async () => null),
        persistCapturedPoster,
      },
    });

    await expect(
      posterService.persistCapturedPoster({
        projectId: 'project_1',
        sceneId: 'scene_1',
        videoAssetId: 'video_1',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        width: 1280,
        height: 720,
      })
    ).resolves.toBe(capturedPoster);
    expect(capturedBytes.toString('hex')).toBe('89504e470d0a1a0a');
    expect(onProjectUpdated).toHaveBeenCalledExactlyOnceWith('project_1');
  });

  it('applies only schema-whitelisted fields from updateProject', async () => {
    const project = await service.createProject(makeInput());

    const updated = await service.updateProject({
      projectId: project.id,
      expectedRevision: project.revision,
      name: 'Renamed launch film',
      routing: {
        storyboard: null,
        image: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'image-model' },
        video: null,
      },
    } as never);

    expect(updated.name).toBe('Renamed launch film');
    expect(updated.routing).toEqual(project.routing);
  });

  it('never persists unknown top-level keys from updateProject', async () => {
    const project = await service.createProject(makeInput());

    await service.updateProject({
      projectId: project.id,
      expectedRevision: project.revision,
      name: 'Renamed launch film',
      providerMetadata: { junk: true },
    } as never);

    const raw = JSON.parse(await readFile(path.join(rootDir, project.id, 'project.json'), 'utf8')) as unknown;
    expect(raw).not.toHaveProperty('providerMetadata');
  });

  describe('cut derivation and guarded persistence', () => {
    const createCutHarness = async () => {
      const store = createCreativeStudioStore({
        rootDir,
        now: () => '2026-08-05T00:00:00.000Z',
        createId: () => 'project_1',
      });
      const cutService = createCreativeStudioService({
        store,
        onProjectUpdated,
        storyboardPlanner: makePlanner(),
      });
      const project = await cutService.createProject(makeInput());
      const firstScene = await cutService.updateScene({
        projectId: project.id,
        expectedRevision: project.revision,
        sceneId: 'scene_1',
        scene: makeScene('scene_1'),
      });
      const secondScene = await cutService.updateScene({
        projectId: project.id,
        expectedRevision: firstScene.revision,
        sceneId: 'scene_2',
        scene: makeScene('scene_2'),
      });
      return { store, service: cutService, project: secondScene };
    };

    it('opens an implicit one-to-one cut without persisting it or changing revision', async () => {
      const harness = await createCutHarness();
      const seeded = await harness.store.updateProject(harness.project.id, (current) => {
        const next = structuredClone(current);
        addTake(next, 'scene_1', 'take_1', 5.085);
        addTake(next, 'scene_2', 'take_2', 4.25);
        return next;
      });

      const opened = await harness.service.getProject(seeded.id);
      const activeCut = opened?.activeCutId === null ? undefined : opened?.cuts?.[opened?.activeCutId ?? ''];

      expect(opened?.revision).toBe(seeded.revision);
      expect(activeCut?.orderMode).toBe('storyboard');
      expect(activeCut?.clipOrder.map((clipId) => activeCut.clips[clipId])).toMatchObject([
        { sceneId: 'scene_1', assetId: 'take_1', sourceInSeconds: null, sourceOutSeconds: null },
        { sceneId: 'scene_2', assetId: 'take_2', sourceInSeconds: null, sourceOutSeconds: null },
      ]);
      expect(await harness.store.getProject(seeded.id)).toEqual(seeded);
      expect(seeded).not.toHaveProperty('cuts');
      expect(seeded).not.toHaveProperty('activeCutId');
    });

    it('omits scenes without a canonical selected take from the implicit cut', async () => {
      const harness = await createCutHarness();
      const seeded = await harness.store.updateProject(harness.project.id, (current) => {
        const next = structuredClone(current);
        addTake(next, 'scene_1', 'take_1', 5.085);
        addTake(next, 'scene_2', 'reference_2', undefined, true, 'imports');
        return next;
      });

      const opened = await harness.service.getProject(seeded.id);
      const activeCut = opened?.activeCutId === null ? undefined : opened?.cuts?.[opened?.activeCutId ?? ''];

      expect(activeCut?.clipOrder.map((clipId) => activeCut.clips[clipId]?.sceneId)).toEqual(['scene_1']);
      expect(await harness.store.getProject(seeded.id)).toEqual(seeded);
    });

    it('materialises the implicit cut only on the first real cut mutation', async () => {
      const harness = await createCutHarness();
      const seeded = await harness.store.updateProject(harness.project.id, (current) => {
        const next = structuredClone(current);
        addTake(next, 'scene_1', 'take_1', 5.085);
        return next;
      });
      const opened = (await harness.service.getProject(seeded.id))!;
      const cutId = opened.activeCutId!;
      const cut = opened.cuts![cutId]!;
      const edit = editableCut(cut);
      const clipId = edit.clipOrder[0]!;
      edit.clips[clipId] = {
        ...edit.clips[clipId]!,
        sourceInSeconds: 0.5,
        sourceOutSeconds: 4.5,
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        filters: [{ id: 'contrast', amount: 0.25 }],
      };

      const updated = await harness.service.updateCut({
        projectId: seeded.id,
        expectedRevision: seeded.revision,
        cutId,
        cut: edit,
      });
      const stored = await harness.store.getProject(seeded.id);

      expect(updated.revision).toBe(seeded.revision + 1);
      expect(stored?.cuts?.[cutId]?.clips[clipId]).toMatchObject(edit.clips[clipId]!);
      expect(stored?.activeCutId).toBe(cutId);
    });

    it('stores identity colour edits without zero-value filters', async () => {
      const harness = await createCutHarness();
      const seeded = await harness.store.updateProject(harness.project.id, (current) => {
        const next = structuredClone(current);
        addTake(next, 'scene_1', 'take_1', 5);
        return next;
      });
      const opened = (await harness.service.getProject(seeded.id))!;
      const cutId = opened.activeCutId!;
      const edit = editableCut(opened.cuts![cutId]!);
      const clipId = edit.clipOrder[0]!;
      edit.clips[clipId] = {
        ...edit.clips[clipId]!,
        filters: [
          { id: 'exposure', amount: 0 },
          { id: 'contrast', amount: 0 },
          { id: 'saturation', amount: 0 },
          { id: 'temperature', amount: 0 },
        ],
      };

      await harness.service.updateCut({
        projectId: seeded.id,
        expectedRevision: seeded.revision,
        cutId,
        cut: edit,
      });

      expect((await harness.store.getProject(seeded.id))?.cuts?.[cutId]?.clips[clipId]?.filters).toEqual([]);
    });

    it('keeps a new canonical take outside a manual cut until a guarded placement adds it', async () => {
      const harness = await createCutHarness();
      const withThirdScene = await harness.service.updateScene({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneId: 'scene_3',
        scene: makeScene('scene_3'),
      });
      const seeded = await harness.store.updateProject(withThirdScene.id, (current) => {
        const next = structuredClone(current);
        addTake(next, 'scene_1', 'take_1', 5);
        addTake(next, 'scene_2', 'take_2', 5);
        addTake(next, 'scene_3', 'take_3', 5, false);
        return next;
      });
      const opened = (await harness.service.getProject(seeded.id))!;
      const cutId = opened.activeCutId!;
      const manualEdit = editableCut(opened.cuts![cutId]!);
      manualEdit.orderMode = 'manual';
      manualEdit.clipOrder.reverse();
      const manual = await harness.service.updateCut({
        projectId: seeded.id,
        expectedRevision: seeded.revision,
        cutId,
        cut: manualEdit,
      });

      const withNewTake = await harness.service.selectAsset({
        projectId: seeded.id,
        expectedRevision: manual.revision,
        sceneId: 'scene_3',
        assetId: 'take_3',
      });
      const manualCut = withNewTake.cuts![cutId]!;
      expect(manualCut.clipOrder.map((clipId) => manualCut.clips[clipId]?.sceneId)).toEqual(['scene_2', 'scene_1']);

      type PlacementService = typeof harness.service & {
        placeCutScenes(input: {
          projectId: string;
          expectedRevision: number;
          cutId: string;
          sceneIds: string[];
          beforeClipId: string | null;
        }): Promise<StudioRendererProject>;
      };
      if (!('placeCutScenes' in harness.service)) {
        expect.fail('expected a guarded cut placement command');
      }
      const placed = await (harness.service as PlacementService).placeCutScenes({
        projectId: seeded.id,
        expectedRevision: withNewTake.revision,
        cutId,
        sceneIds: ['scene_3'],
        beforeClipId: manualCut.clipOrder[0]!,
      });
      const placedCut = placed.cuts![cutId]!;

      expect(placedCut.orderMode).toBe('manual');
      expect(placedCut.clipOrder.map((clipId) => placedCut.clips[clipId]?.sceneId)).toEqual([
        'scene_3',
        'scene_2',
        'scene_1',
      ]);
      expect(placedCut.clips[placedCut.clipOrder[0]!]).toMatchObject({
        assetId: 'take_3',
        sourceInSeconds: null,
        sourceOutSeconds: null,
        crop: null,
        filters: [],
      });
    });

    it('projects persisted cuts with deep-cloned orders, crops, and filters', async () => {
      const harness = await createCutHarness();
      const seeded = await harness.store.updateProject(harness.project.id, (current) => {
        const next = structuredClone(current);
        addTake(next, 'scene_1', 'take_1', 5.085);
        return next;
      });
      const opened = (await harness.service.getProject(seeded.id))!;
      const cutId = opened.activeCutId!;
      const edit = editableCut(opened.cuts![cutId]!);
      const clipId = edit.clipOrder[0]!;
      edit.clips[clipId] = {
        ...edit.clips[clipId]!,
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        filters: [{ id: 'exposure', amount: 0.5 }],
      };
      await harness.service.updateCut({
        projectId: seeded.id,
        expectedRevision: seeded.revision,
        cutId,
        cut: edit,
      });
      const stored = (await harness.store.getProject(seeded.id))!;
      vi.spyOn(harness.store, 'getProject').mockResolvedValue(stored);

      const projected = (await harness.service.getProject(seeded.id))!;
      projected.cuts![cutId]!.clipOrder.push('renderer_only');
      projected.cuts![cutId]!.clips[clipId]!.crop!.x = 0.2;
      projected.cuts![cutId]!.clips[clipId]!.filters[0]!.amount = -0.5;

      expect(stored.cuts?.[cutId]?.clipOrder).toEqual([clipId]);
      expect(stored.cuts?.[cutId]?.clips[clipId]?.crop?.x).toBe(0.1);
      expect(stored.cuts?.[cutId]?.clips[clipId]?.filters[0]?.amount).toBe(0.5);
    });

    it('preserves crop and filters while clamping trim for a shorter selected take', async () => {
      const harness = await createCutHarness();
      const seeded = await harness.store.updateProject(harness.project.id, (current) => {
        const next = structuredClone(current);
        addTake(next, 'scene_1', 'take_long', 8);
        addTake(next, 'scene_1', 'take_short', 3, false);
        return next;
      });
      const opened = (await harness.service.getProject(seeded.id))!;
      const cutId = opened.activeCutId!;
      const cut = opened.cuts![cutId]!;
      const edit = editableCut(cut);
      const clipId = edit.clipOrder[0]!;
      edit.clips[clipId] = {
        sourceInSeconds: 1,
        sourceOutSeconds: 6,
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        filters: [{ id: 'saturation', amount: 0.4 }],
      };
      const edited = await harness.service.updateCut({
        projectId: seeded.id,
        expectedRevision: seeded.revision,
        cutId,
        cut: edit,
      });

      await harness.service.selectAsset({
        projectId: seeded.id,
        expectedRevision: edited.revision,
        sceneId: 'scene_1',
        assetId: 'take_short',
      });
      const storedClip = (await harness.store.getProject(seeded.id))?.cuts?.[cutId]?.clips[clipId];

      expect(storedClip).toMatchObject({
        assetId: 'take_short',
        sourceInSeconds: 1,
        sourceOutSeconds: 3,
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        filters: [{ id: 'saturation', amount: 0.4 }],
      });
    });

    it('resets trim when source in would make a shorter selected take empty', async () => {
      const harness = await createCutHarness();
      const seeded = await harness.store.updateProject(harness.project.id, (current) => {
        const next = structuredClone(current);
        addTake(next, 'scene_1', 'take_long', 8);
        addTake(next, 'scene_1', 'take_short', 3, false);
        return next;
      });
      const opened = (await harness.service.getProject(seeded.id))!;
      const cutId = opened.activeCutId!;
      const edit = editableCut(opened.cuts![cutId]!);
      const clipId = edit.clipOrder[0]!;
      edit.clips[clipId] = { ...edit.clips[clipId]!, sourceInSeconds: 4, sourceOutSeconds: 6 };
      const edited = await harness.service.updateCut({
        projectId: seeded.id,
        expectedRevision: seeded.revision,
        cutId,
        cut: edit,
      });

      await harness.service.selectAsset({
        projectId: seeded.id,
        expectedRevision: edited.revision,
        sceneId: 'scene_1',
        assetId: 'take_short',
      });

      expect((await harness.store.getProject(seeded.id))?.cuts?.[cutId]?.clips[clipId]).toMatchObject({
        sourceInSeconds: null,
        sourceOutSeconds: null,
      });
    });

    it('propagates storyboard order until a direct cut reorder marks the cut manual and the user restores it', async () => {
      const harness = await createCutHarness();
      const seeded = await harness.store.updateProject(harness.project.id, (current) => {
        const next = structuredClone(current);
        addTake(next, 'scene_1', 'take_1', 5);
        addTake(next, 'scene_2', 'take_2', 5);
        return next;
      });
      const opened = (await harness.service.getProject(seeded.id))!;
      const cutId = opened.activeCutId!;
      const initialCut = opened.cuts![cutId]!;
      const persisted = await harness.service.updateCut({
        projectId: seeded.id,
        expectedRevision: seeded.revision,
        cutId,
        cut: editableCut(initialCut),
      });
      const reorderedStoryboard = await harness.service.reorderScenes({
        projectId: seeded.id,
        expectedRevision: persisted.revision,
        sceneOrder: ['scene_2', 'scene_1'],
      });
      const storyboardCut = reorderedStoryboard.cuts![cutId]!;

      expect(storyboardCut.clipOrder.map((clipId) => storyboardCut.clips[clipId]?.sceneId)).toEqual([
        'scene_2',
        'scene_1',
      ]);
      const manualEdit = editableCut(storyboardCut);
      manualEdit.clipOrder.reverse();
      const manual = await harness.service.updateCut({
        projectId: seeded.id,
        expectedRevision: reorderedStoryboard.revision,
        cutId,
        cut: manualEdit,
      });
      expect(manual.cuts?.[cutId]?.orderMode).toBe('manual');

      const reorderedAgain = await harness.service.reorderScenes({
        projectId: seeded.id,
        expectedRevision: manual.revision,
        sceneOrder: ['scene_1', 'scene_2'],
      });
      const restoredStoryboard = await harness.service.reorderScenes({
        projectId: seeded.id,
        expectedRevision: reorderedAgain.revision,
        sceneOrder: ['scene_2', 'scene_1'],
      });

      expect(restoredStoryboard.cuts?.[cutId]?.orderMode).toBe('manual');
      expect(
        restoredStoryboard.cuts?.[cutId]?.clipOrder.map((id) => restoredStoryboard.cuts![cutId]!.clips[id]?.sceneId)
      ).toEqual(['scene_1', 'scene_2']);

      const restoreEdit = editableCut(restoredStoryboard.cuts![cutId]!);
      restoreEdit.orderMode = 'storyboard';
      const restored = await harness.service.updateCut({
        projectId: seeded.id,
        expectedRevision: restoredStoryboard.revision,
        cutId,
        cut: restoreEdit,
      });

      expect(restored.cuts?.[cutId]?.orderMode).toBe('storyboard');
      expect(restored.cuts?.[cutId]?.clipOrder.map((id) => restored.cuts![cutId]!.clips[id]?.sceneId)).toEqual([
        'scene_2',
        'scene_1',
      ]);
    });

    it('does not mark an untouched storyboard cut manual without a direct reorder', async () => {
      const harness = await createCutHarness();
      const seeded = await harness.store.updateProject(harness.project.id, (current) => {
        const next = structuredClone(current);
        addTake(next, 'scene_1', 'take_1', 5);
        return next;
      });
      const opened = (await harness.service.getProject(seeded.id))!;
      const cutId = opened.activeCutId!;
      const edit = editableCut(opened.cuts![cutId]!);
      edit.orderMode = 'manual';

      const updated = await harness.service.updateCut({
        projectId: seeded.id,
        expectedRevision: seeded.revision,
        cutId,
        cut: edit,
      });

      expect(updated.cuts?.[cutId]?.orderMode).toBe('storyboard');
    });

    it('marks a storyboard cut manual when a clip edit diverges from it', async () => {
      const harness = await createCutHarness();
      const seeded = await harness.store.updateProject(harness.project.id, (current) => {
        const next = structuredClone(current);
        addTake(next, 'scene_1', 'take_1', 5);
        return next;
      });
      const opened = (await harness.service.getProject(seeded.id))!;
      const cutId = opened.activeCutId!;
      const edit = editableCut(opened.cuts![cutId]!);
      const clipId = edit.clipOrder[0]!;
      edit.clips[clipId] = {
        ...edit.clips[clipId]!,
        sourceInSeconds: 0.5,
        sourceOutSeconds: 4.5,
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        filters: [{ id: 'temperature', amount: -0.25 }],
      };

      const updated = await harness.service.updateCut({
        projectId: seeded.id,
        expectedRevision: seeded.revision,
        cutId,
        cut: edit,
      });

      expect(updated.cuts?.[cutId]?.orderMode).toBe('manual');
    });

    it('passes the caller revision through the guarded cut path and rejects stale writes closed', async () => {
      const harness = await createCutHarness();
      const seeded = await harness.store.updateProject(harness.project.id, (current) => {
        const next = structuredClone(current);
        addTake(next, 'scene_1', 'take_1', 5);
        return next;
      });
      const opened = (await harness.service.getProject(seeded.id))!;
      const cutId = opened.activeCutId!;
      const edit = editableCut(opened.cuts![cutId]!);
      await harness.service.updateProject({
        projectId: seeded.id,
        expectedRevision: seeded.revision,
        brief: 'Concurrent edit',
      });

      await expect(
        harness.service.updateCut({ projectId: seeded.id, expectedRevision: seeded.revision, cutId, cut: edit })
      ).rejects.toMatchObject({ code: 'stale_project' });
      const stored = await harness.store.getProject(seeded.id);
      expect(stored?.brief).toBe('Concurrent edit');
      expect(stored).not.toHaveProperty('cuts');
    });

    it('does not let the scalar updateProject path persist cut data', async () => {
      const harness = await createCutHarness();
      const opened = (await harness.service.getProject(harness.project.id))!;

      await harness.service.updateProject({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        name: 'Renamed launch film',
        cuts: opened.cuts,
        activeCutId: opened.activeCutId,
      } as never);

      const stored = await harness.store.getProject(harness.project.id);
      expect(stored?.name).toBe('Renamed launch film');
      expect(stored).not.toHaveProperty('cuts');
      expect(stored).not.toHaveProperty('activeCutId');
    });
  });

  it('lists field-by-field project cards with a canonical poster or no poster', async () => {
    const projectIds = ['rendered_project', 'script_project'];
    const listingStore = createCreativeStudioStore({
      rootDir,
      now: () => '2026-07-30T00:00:00.000Z',
      createId: () => projectIds.shift()!,
    });
    const listingService = createCreativeStudioService({
      store: listingStore,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
    });
    const rendered = await listingService.createProject(makeInput({ name: 'Rendered film' }));
    const withScene = await listingService.updateScene({
      projectId: rendered.id,
      expectedRevision: rendered.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1', 6),
    });
    await listingStore.updateProject(withScene.id, (current) => ({
      ...current,
      scenes: {
        ...current.scenes,
        scene_1: {
          ...current.scenes.scene_1!,
          selectedAssetId: 'take_2',
          assetIds: ['take_1', 'take_2', 'poster_2'],
          jobIds: ['job_2'],
          reviewState: 'complete',
        },
      },
      assets: {
        take_1: {
          id: 'take_1',
          projectId: current.id,
          sceneId: 'scene_1',
          mediaKind: 'video',
          mimeType: 'video/mp4',
          managedAsset: { collection: 'assets', fileName: 'take_1.mp4' },
          byteSize: 10,
          sha256: 'a'.repeat(64),
          createdAt: current.createdAt,
        },
        take_2: {
          id: 'take_2',
          projectId: current.id,
          sceneId: 'scene_1',
          mediaKind: 'video',
          mimeType: 'video/mp4',
          managedAsset: { collection: 'assets', fileName: 'take_2.mp4' },
          byteSize: 10,
          sha256: 'b'.repeat(64),
          createdAt: current.createdAt,
        },
        poster_2: {
          id: 'poster_2',
          projectId: current.id,
          sceneId: 'scene_1',
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'thumbnails', fileName: 'poster_2.png' },
          byteSize: 10,
          sha256: 'c'.repeat(64),
          createdAt: current.createdAt,
        },
      },
      jobs: {
        job_2: {
          id: 'job_2',
          projectId: current.id,
          sceneId: 'scene_1',
          status: 'succeeded',
          provider: { providerId: 'provider_1', adapterId: 'weprompt-media-gateway-v1', model: 'video-model' },
          idempotencyKey: 'idempotency_2',
          providerJobId: 'provider_job_2',
          remoteStartedAt: current.createdAt,
          cancellationPolicy: 'none',
          outputAssetIds: ['take_2', 'poster_2'],
          error: null,
          retryOfJobId: null,
          retryReason: null,
          duplicateChargeAcknowledged: false,
          duplicateChargeAcknowledgedAt: null,
          createdAt: current.createdAt,
          updatedAt: current.updatedAt,
        },
      },
    }));
    await listingService.createProject(makeInput({ name: 'Script film' }));

    await expect(listingService.listProjects()).resolves.toEqual([
      {
        id: 'rendered_project',
        name: 'Rendered film',
        forgeProjectId: undefined,
        aspectRatio: '16:9',
        targetDurationSeconds: 12,
        resolution: '1080p',
        sceneCount: 1,
        selectedAssetCount: 1,
        poster: { assetId: 'poster_2', sceneNumber: 1, takeNumber: 2 },
        createdAt: '2026-07-30T00:00:00.000Z',
        updatedAt: '2026-07-30T00:00:00.000Z',
      },
      {
        id: 'script_project',
        name: 'Script film',
        forgeProjectId: undefined,
        aspectRatio: '16:9',
        targetDurationSeconds: 12,
        resolution: '1080p',
        sceneCount: 0,
        selectedAssetCount: 0,
        poster: null,
        createdAt: '2026-07-30T00:00:00.000Z',
        updatedAt: '2026-07-30T00:00:00.000Z',
      },
    ]);
  });

  it('validates and delegates every durable generation mutation to the runtime-owned job manager', async () => {
    const job: StudioJob = {
      id: 'job_1',
      projectId: 'project_1',
      sceneId: 'scene_1',
      status: 'failed',
      provider: { providerId: 'provider_1', adapterId: 'weprompt-media-gateway-v1', model: 'open-sora' },
      idempotencyKey: 'key_1',
      providerJobId: null,
      cancellationPolicy: 'none',
      outputAssetIds: [],
      error: {
        code: 'provider_unavailable',
        messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
      },
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
    };
    const submitScenes = vi.fn(async () => []);
    const cancelJob = vi.fn(async () => job);
    const retryJob = vi.fn(async () => job);
    const retryDownload = vi.fn(async () => job);
    const generationStore = createCreativeStudioStore({ rootDir });
    const generationService = createCreativeStudioService({
      store: generationStore,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      providerResolver: {
        listConnectionCandidates: async () => [],
        listGenerationRoutes: async () => ({
          routes: [routeOption('video', { model: 'open-sora' })],
          generationCatalogVersion: 'generation-v1',
        }),
        isGenerationRouteAvailable: async () => true,
      },
      jobManager: {
        submitScenes,
        cancelJob,
        retryJob,
        retryDownload,
        resumePendingJobs: vi.fn(),
        dispose: vi.fn(),
      },
    } as unknown as Parameters<typeof createCreativeStudioService>[0]);
    const createdProject = await generationService.createProject(makeInput());
    const project = await generationService.updateScene({
      projectId: createdProject.id,
      expectedRevision: createdProject.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });
    const catalog = await generationService.listRoutes({ projectId: project.id });
    const reviewedRoute = catalog.video.options[0]!;
    const submitInput = {
      projectId: project.id,
      expectedRevision: project.revision,
      mode: 'single' as const,
      sceneIds: ['scene_1'],
      catalogVersion: catalog.catalogVersion,
      routes: [
        {
          sceneId: 'scene_1',
          choiceId: reviewedRoute.choiceId,
          kind: 'video' as const,
        },
      ],
    };
    const jobInput = { projectId: 'project_1', jobId: 'job_1', expectedRevision: 2 };
    const retryInput = { ...jobInput, acknowledgePossibleDuplicateCharge: true };

    await generationService.submitScenes(submitInput);
    await generationService.cancelJob(jobInput);
    await generationService.retryJob(retryInput);
    await generationService.retryDownload(jobInput);

    expect(submitScenes).toHaveBeenCalledWith({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneIds: ['scene_1'],
      catalogVersion: 'generation-v1',
      routes: [
        {
          sceneId: 'scene_1',
          providerId: 'provider_1',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'open-sora',
          kind: 'video',
        },
      ],
    });
    expect(cancelJob).toHaveBeenCalledWith(jobInput);
    expect(retryJob).toHaveBeenCalledWith(retryInput);
    expect(retryDownload).toHaveBeenCalledWith(jobInput);
  });

  it.each([
    { status: 'queued_local', policy: 'none', expected: true },
    { status: 'submitting', policy: 'queued_and_running', expected: true },
    { status: 'queued_remote', policy: 'none', expected: false },
    { status: 'queued_remote', policy: 'queued_only', expected: true },
    { status: 'queued_remote', policy: 'queued_and_running', expected: true },
    { status: 'running', policy: 'none', expected: false },
    { status: 'running', policy: 'queued_only', expected: false },
    { status: 'running', policy: 'queued_and_running', expected: true },
    { status: 'needs_attention', policy: 'none', expected: false },
    { status: 'needs_attention', policy: 'queued_only', expected: false },
    { status: 'needs_attention', policy: 'queued_and_running', expected: true },
    { status: 'succeeded', policy: 'queued_and_running', expected: false },
    { status: 'failed', policy: 'queued_and_running', expected: false },
    { status: 'cancelled', policy: 'queued_and_running', expected: false },
  ] as const)(
    'projects $status with $policy through the manager cancellation predicate',
    async ({ status, policy, expected }) => {
      const job: StudioJob = {
        id: 'job_1',
        projectId: 'project_1',
        sceneId: 'scene_1',
        status,
        provider: { providerId: 'provider_1', adapterId: 'weprompt-media-gateway-v1', model: 'open-sora' },
        idempotencyKey: 'key_1',
        providerJobId: status === 'queued_local' || status === 'submitting' ? null : 'remote_1',
        cancellationPolicy: policy,
        outputAssetIds: [],
        error: null,
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        createdAt: '2026-07-30T00:00:00.000Z',
        updatedAt: '2026-07-30T00:00:00.000Z',
      };
      const generationService = createCreativeStudioService({
        store: createCreativeStudioStore({ rootDir }),
        onProjectUpdated,
        storyboardPlanner: makePlanner(),
        jobManager: {
          submitScenes: vi.fn(),
          cancelJob: async () => job,
          retryJob: vi.fn(),
          retryDownload: vi.fn(),
          resumePendingJobs: vi.fn(),
          dispose: vi.fn(),
        },
      } as unknown as Parameters<typeof createCreativeStudioService>[0]);

      const rendered = await generationService.cancelJob({
        projectId: job.projectId,
        jobId: job.id,
        expectedRevision: 1,
      });

      expect(canCancelJob(job)).toBe(expected);
      expect(rendered.canCancel).toBe(expected);
    }
  );

  it('rejects invalid job identities and revisions before invoking the job manager', async () => {
    const cancelJob = vi.fn();
    const generationService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      jobManager: {
        submitScenes: vi.fn(),
        cancelJob,
        retryJob: vi.fn(),
        retryDownload: vi.fn(),
        resumePendingJobs: vi.fn(),
        dispose: vi.fn(),
      },
    } as unknown as Parameters<typeof createCreativeStudioService>[0]);

    await expect(
      generationService.cancelJob({ projectId: '../project', jobId: 'job_1', expectedRevision: 1 })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(
      generationService.cancelJob({ projectId: 'project_1', jobId: 'job_1', expectedRevision: 0 })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(cancelJob).not.toHaveBeenCalled();
  });

  it('saves a validation-derived connection without treating it as a successful project route', async () => {
    const connectionService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      createConnectionId: () => 'binding_1',
      validateConnection: async (input) => ({
        schemaVersion: 1,
        id: 'discarded_by_service',
        providerId: input.providerId,
        adapterId: input.adapterId,
        model: input.model,
        capabilities: { mediaKinds: ['video'], audioModes: ['none'] },
        validatedAt: '2026-07-30T00:00:00.000Z',
      }),
    });
    const project = await connectionService.createProject(makeInput());

    const binding = await connectionService.saveConnection({
      providerId: 'provider_1',
      integrationId: GATEWAY_INTEGRATION_ID,
      model: 'open-sora',
    });

    expect(binding.bindingId).toBe('binding_1');
    expect((await connectionService.getProject(project.id))?.routing.video).toBeNull();
  });

  it('lists and removes a saved binding after the service is recreated over the same store', async () => {
    const originalStore = createCreativeStudioStore({ rootDir });
    await originalStore.saveConnection({
      schemaVersion: 1,
      id: 'binding_stale',
      providerId: 'provider_deleted',
      adapterId: 'weprompt-media-gateway-v1',
      model: 'open-sora',
      capabilities: { mediaKinds: ['video'], audioModes: ['none'] },
      validatedAt: '2026-07-30T00:00:00.000Z',
    });
    const reloaded = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
    });

    await expect(reloaded.listConnections()).resolves.toMatchObject({
      connections: [{ bindingId: 'binding_stale' }],
    });
    await expect(reloaded.removeConnection({ bindingId: 'binding_stale' })).resolves.toBe(true);
    await expect(reloaded.listConnections()).resolves.toMatchObject({ connections: [] });
  });

  it('uses opaque Settings binding and integration identities for inventory and every mutation result', async () => {
    const connectionStore = createCreativeStudioStore({ rootDir });
    await connectionStore.saveConnection({
      schemaVersion: 1,
      id: 'binding_existing',
      providerId: 'provider_1',
      adapterId: KNOWN_ADAPTER_SENTINEL,
      model: 'open-sora',
      capabilities: { mediaKinds: ['video'], audioModes: ['none'] },
      validatedAt: '2026-07-30T00:00:00.000Z',
    });
    const validateInternalConnection = vi.fn(
      async (input: { providerId: string; adapterId: typeof KNOWN_ADAPTER_SENTINEL; model: string }) => ({
        schemaVersion: 1 as const,
        id: 'validation_only',
        providerId: input.providerId,
        adapterId: input.adapterId,
        model: input.model,
        capabilities: { mediaKinds: ['video' as const], audioModes: ['none'] },
        validatedAt: '2026-07-30T00:00:00.000Z',
      })
    );
    const connectionService = createCreativeStudioService({
      store: connectionStore,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      createConnectionId: () => 'binding_saved',
      validateConnection: validateInternalConnection,
    });

    const inventory = await connectionService.listConnections();
    const validated = await connectionService.validateConnection({
      providerId: 'provider_1',
      integrationId: GATEWAY_INTEGRATION_ID,
      model: 'open-sora',
    });
    const saved = await connectionService.saveConnection({
      providerId: 'provider_1',
      integrationId: GATEWAY_INTEGRATION_ID,
      model: 'open-sora',
    });
    const removed = await connectionService.removeConnection({ bindingId: saved.bindingId });

    expect(inventory).toMatchObject({
      integrations: expect.arrayContaining([
        {
          integrationId: GATEWAY_INTEGRATION_ID,
          kind: 'video',
          labelKey: 'selfHostedVideoGateway',
        },
        {
          integrationId: 'integration_o4R7vD2m',
          kind: 'video',
          labelKey: 'openRouterVideo',
        },
      ]),
      connections: [
        expect.objectContaining({
          bindingId: 'binding_existing',
          integrationId: GATEWAY_INTEGRATION_ID,
          providerId: 'provider_1',
          model: 'open-sora',
        }),
      ],
    });
    expect(validated).toMatchObject({
      integrationId: GATEWAY_INTEGRATION_ID,
      providerId: 'provider_1',
      model: 'open-sora',
    });
    expect(saved).toMatchObject({
      bindingId: 'binding_saved',
      integrationId: GATEWAY_INTEGRATION_ID,
      providerId: 'provider_1',
      model: 'open-sora',
    });
    expect(validateInternalConnection).toHaveBeenCalledWith({
      providerId: 'provider_1',
      adapterId: KNOWN_ADAPTER_SENTINEL,
      model: 'open-sora',
    });
    expect(removed).toBe(true);
    for (const rendererDto of [inventory, validated, saved]) {
      expectRendererBoundaryToHideAdapters(rendererDto);
    }
  });

  it('validates, normalizes, sanitizes, and saves a manual gateway model absent from chat discovery', async () => {
    const validateConnection = vi.fn(async () => ({
      ok: true as const,
      capabilities: {
        mediaKinds: ['video'],
        audioModes: ['none'],
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p'],
        minDurationSeconds: 2,
        maxDurationSeconds: 20,
        supportsFirstFrame: true,
        cancellationPolicy: 'queued_and_running',
        rawProviderField: STUDIO_E2E_BOUNDARY_SENTINELS,
      },
    }));
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-media-gateway-v1',
      validateConnection,
      validateRequest: () => ({
        ok: true,
        normalized: { aspectRatio: '16:9', resolution: '720p', durationSeconds: 5 },
      }),
      submit: async () => ({ kind: 'remote', providerJobId: 'job_1' }),
    };
    const manualProvider: IProvider = {
      id: 'provider_1',
      platform: 'custom',
      name: 'Gateway',
      base_url: STUDIO_E2E_BOUNDARY_SENTINELS.providerUrl,
      api_key: STUDIO_E2E_BOUNDARY_SENTINELS.credential,
      models: [],
    };
    Object.assign(manualProvider, STUDIO_E2E_BOUNDARY_SENTINELS);
    const connectionService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      createConnectionId: () => 'binding_manual',
      listProviders: async () => [manualProvider],
      adapterRegistry: new Map([['weprompt-media-gateway-v1', adapter]]),
    });
    const saved = await connectionService.saveConnection({
      providerId: 'provider_1',
      integrationId: GATEWAY_INTEGRATION_ID,
      model: '  open-sora-manual  ',
    });

    expect(validateConnection).toHaveBeenCalledWith(
      { model: 'open-sora-manual' },
      manualProvider,
      expect.any(AbortSignal)
    );
    expect(saved).toMatchObject({
      bindingId: 'binding_manual',
      model: 'open-sora-manual',
      capabilities: {
        mediaKinds: ['video'],
        audioModes: ['none'],
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p'],
        minDurationSeconds: 2,
        maxDurationSeconds: 20,
        supportsFirstFrame: true,
      },
    });
    expect(saved.capabilities).not.toHaveProperty('cancellation');
    expect(saved.capabilities).not.toHaveProperty('cancellationPolicy');
    expect(saved.capabilities).not.toHaveProperty('rawProviderField');
    const exposedConnections = await connectionService.listConnections();
    const storedConnections = await readFile(path.join(rootDir, 'connections.json'), 'utf8');
    for (const sentinel of Object.values(STUDIO_E2E_BOUNDARY_SENTINELS)) {
      expect(JSON.stringify(saved)).not.toContain(sentinel);
      expect(JSON.stringify(exposedConnections)).not.toContain(sentinel);
      expect(storedConnections).not.toContain(sentinel);
    }
  });

  it('does not validate a manual model after its provider is disabled', async () => {
    const validateConnection = vi.fn();
    const connectionService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      listProviders: async () => [
        {
          id: 'provider_1',
          platform: 'custom',
          name: 'Gateway',
          base_url: 'https://gateway.example',
          api_key: 'secret',
          models: [],
          enabled: false,
        },
      ],
      adapterRegistry: new Map([
        [
          'weprompt-media-gateway-v1',
          {
            id: 'weprompt-media-gateway-v1',
            validateConnection,
            validateRequest: () => ({ ok: false, issues: [{ code: 'provider_unavailable' }] }),
            submit: async () => ({ kind: 'remote' as const, providerJobId: 'never' }),
          },
        ],
      ]),
    });

    await expect(
      connectionService.validateConnection({
        providerId: 'provider_1',
        integrationId: GATEWAY_INTEGRATION_ID,
        model: 'open-sora-manual',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
    expect(validateConnection).not.toHaveBeenCalled();
  });

  it.each([
    ['api_key', { api_key: undefined as never }],
    ['base_url', { base_url: undefined as never }],
  ] as const)('treats a provider with a skewed %s as unavailable', async (_field, overrides) => {
    const validateConnection = vi.fn(async () => ({ ok: true as const }));
    const connectionService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      listProviders: async () => [
        {
          id: 'provider_1',
          platform: 'custom',
          name: 'Gateway',
          base_url: 'https://gateway.example',
          api_key: 'secret',
          models: [],
          ...overrides,
        },
      ],
      adapterRegistry: new Map([
        [
          'weprompt-media-gateway-v1',
          {
            id: 'weprompt-media-gateway-v1',
            validateConnection,
            validateRequest: () => ({ ok: false, issues: [{ code: 'provider_unavailable' }] }),
            submit: async () => ({ kind: 'remote' as const, providerJobId: 'never' }),
          },
        ],
      ]),
    });

    await expect(
      connectionService.validateConnection({
        providerId: 'provider_1',
        integrationId: GATEWAY_INTEGRATION_ID,
        model: 'open-sora-manual',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
    expect(validateConnection).not.toHaveBeenCalled();
  });

  it('aborts connection validation and reports a provider error after the deadline', async () => {
    vi.useFakeTimers();
    let validationSignal: AbortSignal | undefined;
    const connectionService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      listProviders: async () => [
        {
          id: 'provider_1',
          platform: 'custom',
          name: 'Gateway',
          base_url: 'https://gateway.example',
          api_key: 'secret',
          models: [],
        },
      ],
      adapterRegistry: new Map([
        [
          'weprompt-media-gateway-v1',
          {
            id: 'weprompt-media-gateway-v1',
            validateConnection: async (_input, _provider, signal) => {
              validationSignal = signal;
              return await new Promise<never>(() => undefined);
            },
            validateRequest: () => ({ ok: false, issues: [{ code: 'provider_unavailable' }] }),
            submit: async () => ({ kind: 'remote' as const, providerJobId: 'never' }),
          },
        ],
      ]),
    });

    const validation = connectionService.validateConnection({
      providerId: 'provider_1',
      integrationId: GATEWAY_INTEGRATION_ID,
      model: 'open-sora-manual',
    });
    const rejection = expect(validation).rejects.toMatchObject({ code: 'provider_error' });
    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(validationSignal?.aborted).toBe(true);
  });

  it('maps resolver dependency failures to a provider error', async () => {
    const connectionService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      providerResolver: {
        listConnectionCandidates: async () => {
          throw new Error('provider backend unavailable');
        },
        listGenerationRoutes: async () => {
          throw new Error('settings backend unavailable');
        },
        isGenerationRouteAvailable: async () => false,
      },
    });

    await expect(connectionService.listConnectionCandidates()).rejects.toMatchObject({ code: 'provider_error' });
    await expect(connectionService.listRoutes()).rejects.toMatchObject({ code: 'provider_error' });
  });

  it('composes the fresh planner and generation catalogs for a project', async () => {
    const listModels = vi.fn(async () => storyboardOptions);
    const listGenerationRoutes = vi.fn(async () => ({
      routes: [routeOption('image')],
      generationCatalogVersion: 'generation-v1',
    }));
    const routed = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      storyboardPlanner: makePlanner({ listModels }),
      providerResolver: {
        listConnectionCandidates: async () => [],
        listGenerationRoutes,
        isGenerationRouteAvailable: async () => false,
      },
    });
    const project = await routed.createProject(makeInput());

    const catalog = await routed.listRoutes({ projectId: project.id });

    expect(catalog.storyboard.options).toEqual(storyboardOptions);
    expect(catalog.image.options).toHaveLength(1);
    expect(listModels).toHaveBeenCalledOnce();
    expect(listGenerationRoutes).toHaveBeenCalledOnce();
  });

  it('rejects metadata outside renderer bounds instead of persisting oversized text', async () => {
    const project = await service.createProject(makeInput());

    await expect(
      service.updateProject({
        projectId: project.id,
        expectedRevision: project.revision,
        brief: 'x'.repeat(16 * 1024 + 1),
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<CreativeStudioStoreError>);
  });

  const projectWithAspectSafetyState = async (mutate: (project: StudioProject) => void) => {
    const store = createCreativeStudioStore({
      rootDir,
      now: () => '2026-07-30T00:00:00.000Z',
      createId: () => 'aspect_safety_project',
    });
    const guardedService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
    });
    const created = await guardedService.createProject(makeInput());
    const canonical = await store.getProject(created.id);
    if (canonical === null) throw new Error('Aspect-ratio safety fixture was not created');
    mutate(canonical);
    vi.spyOn(store, 'getProject').mockResolvedValue(canonical);
    return { created, guardedService };
  };

  it('keeps aspect ratio editable when the project contains imported references only', async () => {
    const { created, guardedService } = await projectWithAspectSafetyState((project) => {
      project.assets.reference_1 = {
        id: 'reference_1',
        projectId: project.id,
        sceneId: null,
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'imports', fileName: 'reference_1.png' },
        byteSize: 1,
        sha256: '1'.repeat(64),
        createdAt: project.createdAt,
      };
    });

    await expect(
      guardedService.updateProject({
        projectId: created.id,
        expectedRevision: created.revision,
        aspectRatio: '9:16',
      })
    ).resolves.toMatchObject({ aspectRatio: '9:16' });
  });

  it('rejects an aspect-ratio change after a managed generated output exists', async () => {
    const { created, guardedService } = await projectWithAspectSafetyState((project) => {
      project.assets.asset_1 = {
        id: 'asset_1',
        projectId: project.id,
        sceneId: null,
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'assets', fileName: 'asset_1.png' },
        byteSize: 1,
        sha256: '2'.repeat(64),
        createdAt: project.createdAt,
      };
    });

    await expect(
      guardedService.updateProject({
        projectId: created.id,
        expectedRevision: created.revision,
        aspectRatio: '9:16',
      })
    ).rejects.toMatchObject({ code: 'busy' });
  });

  it.each(['queued_local', 'submitting', 'queued_remote', 'running', 'needs_attention'] as const)(
    'rejects an aspect-ratio change while a generation job is %s',
    async (status) => {
      const { created, guardedService } = await projectWithAspectSafetyState((project) => {
        project.jobs.job_1 = {
          id: 'job_1',
          projectId: project.id,
          sceneId: 'scene_1',
          status,
          provider: { providerId: 'provider_1', adapterId: 'weprompt-media-gateway-v1', model: 'video-model' },
          idempotencyKey: 'aspect-lock-job',
          providerJobId: status === 'queued_local' || status === 'submitting' ? null : 'remote_1',
          cancellationPolicy: 'queued_and_running',
          outputAssetIds: [],
          error:
            status === 'needs_attention'
              ? {
                  code: 'submission_unknown',
                  messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
                }
              : null,
          retryOfJobId: null,
          retryReason: null,
          duplicateChargeAcknowledged: false,
          duplicateChargeAcknowledgedAt: null,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        };
      });

      await expect(
        guardedService.updateProject({
          projectId: created.id,
          expectedRevision: created.revision,
          aspectRatio: '9:16',
        })
      ).rejects.toMatchObject({ code: 'busy' });
    }
  );

  it('allows unchanged aspect ratio and ordinary metadata updates after aspect ratio is locked', async () => {
    const { created, guardedService } = await projectWithAspectSafetyState((project) => {
      project.assets.asset_1 = {
        id: 'asset_1',
        projectId: project.id,
        sceneId: null,
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'assets', fileName: 'asset_1.png' },
        byteSize: 1,
        sha256: '3'.repeat(64),
        createdAt: project.createdAt,
      };
    });

    const unchanged = await guardedService.updateProject({
      projectId: created.id,
      expectedRevision: created.revision,
      aspectRatio: '16:9',
    });
    await expect(
      guardedService.updateProject({
        projectId: unchanged.id,
        expectedRevision: unchanged.revision,
        name: 'Renamed after render',
        brief: 'Metadata remains editable.',
        targetDurationSeconds: 20,
      })
    ).resolves.toMatchObject({
      name: 'Renamed after render',
      brief: 'Metadata remains editable.',
      targetDurationSeconds: 20,
      aspectRatio: '16:9',
    });
  });

  it('rejects stale revisions instead of overwriting a newer project edit', async () => {
    const project = await service.createProject(makeInput());
    await service.updateProject({
      projectId: project.id,
      expectedRevision: project.revision,
      name: 'Newer launch film',
    });

    await expect(
      service.updateProject({ projectId: project.id, expectedRevision: project.revision, name: 'Late launch film' })
    ).rejects.toMatchObject({ code: 'stale_project' } satisfies Partial<CreativeStudioStoreError>);
  });

  it('rejects a stale delete instead of deleting a project changed by another editor', async () => {
    const project = await service.createProject(makeInput());
    await service.updateProject({
      projectId: project.id,
      expectedRevision: project.revision,
      name: 'Newer launch film',
    });

    await expect(
      service.deleteProject({ projectId: project.id, expectedRevision: project.revision })
    ).rejects.toMatchObject({
      code: 'stale_project',
    } satisfies Partial<CreativeStudioStoreError>);
    await expect(service.getProject(project.id)).resolves.toMatchObject({ name: 'Newer launch film' });
  });

  it("upserts one bounded scene while retaining the project's canonical scene order", async () => {
    const project = await service.createProject(makeInput());

    const updated = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });

    expect(updated.sceneOrder).toEqual(['scene_1']);
    expect(updated.scenes.scene_1?.visualPrompt).toBe('A cinematic studio product reveal');
    expect(updated.scenes.scene_1).toMatchObject({
      id: 'scene_1',
      selectedAssetId: null,
      assetIds: [],
      jobIds: [],
      reviewState: 'ready',
    });
  });

  it('keeps a newly created scene draft when it has no usable visual prompt', async () => {
    const project = await service.createProject(makeInput());

    const updated = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: { ...makeScene('scene_1'), visualPrompt: '   ' },
    });

    expect(updated.scenes.scene_1.reviewState).toBe('draft');
  });

  it('persists a seeded empty title as a draft even when its visual prompt is ready', async () => {
    const project = await service.createProject(makeInput());

    const updated = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: { ...makeScene('scene_1'), title: '' },
    });

    expect(updated.scenes.scene_1).toMatchObject({ title: '', reviewState: 'draft' });
  });

  it('rejects removing a scene whose only media is an imported reference', async () => {
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });
    const withImportedReference = await createCreativeStudioStore({ rootDir }).updateProject(
      withScene.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.asset_reference = {
          id: 'asset_reference',
          projectId: next.id,
          sceneId: 'scene_1',
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'imports', fileName: 'asset_reference.png' },
          byteSize: 1,
          sha256: '3'.repeat(64),
          createdAt: next.createdAt,
        };
        next.scenes.scene_1.referenceAssetId = 'asset_reference';
        next.scenes.scene_1.assetIds = ['asset_reference'];
        return next;
      },
      withScene.revision
    );

    await expect(
      service.updateScene({
        projectId: withImportedReference.id,
        expectedRevision: withImportedReference.revision,
        sceneId: 'scene_1',
        scene: null,
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<CreativeStudioStoreError>);
    await expect(service.getProject(withImportedReference.id)).resolves.toMatchObject({
      sceneOrder: ['scene_1'],
      scenes: { scene_1: { referenceAssetId: 'asset_reference', assetIds: ['asset_reference'] } },
    });
  });

  it('preserves main-owned scene history while applying renderer-editable fields', async () => {
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });
    const canonicalStore = createCreativeStudioStore({ rootDir });
    const withHistory = await canonicalStore.updateProject(
      withScene.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.asset_1 = {
          id: 'asset_1',
          projectId: next.id,
          sceneId: 'scene_1',
          mediaKind: 'video',
          mimeType: 'video/mp4',
          managedAsset: { collection: 'assets', fileName: 'asset_1.mp4' },
          byteSize: 1,
          sha256: '1'.repeat(64),
          durationSeconds: 4,
          createdAt: next.createdAt,
        };
        next.jobs.job_1 = {
          id: 'job_1',
          projectId: next.id,
          sceneId: 'scene_1',
          status: 'succeeded',
          provider: { providerId: 'provider_1', adapterId: 'weprompt-media-gateway-v1', model: 'model_1' },
          idempotencyKey: 'key_1',
          providerJobId: 'remote_1',
          cancellationPolicy: 'queued_only',
          outputAssetIds: ['asset_1'],
          error: null,
          retryOfJobId: null,
          retryReason: null,
          duplicateChargeAcknowledged: false,
          duplicateChargeAcknowledgedAt: null,
          createdAt: next.createdAt,
          updatedAt: next.updatedAt,
        };
        next.scenes.scene_1.assetIds = ['asset_1'];
        next.scenes.scene_1.jobIds = ['job_1'];
        next.scenes.scene_1.selectedAssetId = 'asset_1';
        next.scenes.scene_1.reviewState = 'complete';
        return next;
      },
      withScene.revision
    );

    const updated = await service.updateScene({
      projectId: withHistory.id,
      expectedRevision: withHistory.revision,
      sceneId: 'scene_1',
      scene: { ...makeScene('scene_1'), title: 'Edited title' },
    });

    expect(updated.scenes.scene_1).toMatchObject({
      id: 'scene_1',
      title: 'Edited title',
      assetIds: ['asset_1'],
      jobIds: ['job_1'],
      selectedAssetId: 'asset_1',
      reviewState: 'complete',
    });
  });

  it('blocks media-kind changes while a scene has any nonterminal job', async () => {
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });
    const canonicalStore = createCreativeStudioStore({ rootDir });
    const withPendingJob = await canonicalStore.updateProject(
      withScene.id,
      (current) => {
        const next = structuredClone(current);
        next.jobs.job_1 = {
          id: 'job_1',
          projectId: next.id,
          sceneId: 'scene_1',
          status: 'needs_attention',
          provider: { providerId: 'provider_1', adapterId: 'weprompt-media-gateway-v1', model: 'model_1' },
          idempotencyKey: 'key_1',
          providerJobId: null,
          cancellationPolicy: 'queued_only',
          outputAssetIds: [],
          error: {
            code: 'submission_unknown',
            messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
          },
          retryOfJobId: null,
          retryReason: null,
          duplicateChargeAcknowledged: false,
          duplicateChargeAcknowledgedAt: null,
          createdAt: next.createdAt,
          updatedAt: next.updatedAt,
        };
        next.scenes.scene_1.jobIds = ['job_1'];
        next.scenes.scene_1.reviewState = 'blocked';
        return next;
      },
      withScene.revision
    );

    await expect(
      service.updateScene({
        projectId: withPendingJob.id,
        expectedRevision: withPendingJob.revision,
        sceneId: 'scene_1',
        scene: { ...makeScene('scene_1'), mediaKind: 'image' },
      })
    ).rejects.toMatchObject({ code: 'busy' });
  });

  it('validates reference ownership and clears only an incompatible selection on an allowed kind change', async () => {
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });
    const canonicalStore = createCreativeStudioStore({ rootDir });
    const withAssets = await canonicalStore.updateProject(
      withScene.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.asset_video = {
          id: 'asset_video',
          projectId: next.id,
          sceneId: 'scene_1',
          mediaKind: 'video',
          mimeType: 'video/mp4',
          managedAsset: { collection: 'assets', fileName: 'asset_video.mp4' },
          byteSize: 1,
          sha256: '2'.repeat(64),
          durationSeconds: 4,
          createdAt: next.createdAt,
        };
        next.assets.asset_reference = {
          id: 'asset_reference',
          projectId: next.id,
          sceneId: 'scene_1',
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'imports', fileName: 'asset_reference.png' },
          byteSize: 1,
          sha256: '3'.repeat(64),
          createdAt: next.createdAt,
        };
        next.scenes.scene_1.assetIds = ['asset_video', 'asset_reference'];
        next.scenes.scene_1.selectedAssetId = 'asset_video';
        next.scenes.scene_1.reviewState = 'complete';
        return next;
      },
      withScene.revision
    );

    const changed = await service.updateScene({
      projectId: withAssets.id,
      expectedRevision: withAssets.revision,
      sceneId: 'scene_1',
      scene: {
        ...makeScene('scene_1'),
        mediaKind: 'image',
        referenceAssetId: 'asset_reference',
      },
    });
    expect(changed.scenes.scene_1).toMatchObject({
      selectedAssetId: null,
      referenceAssetId: 'asset_reference',
      reviewState: 'ready',
      assetIds: ['asset_video', 'asset_reference'],
    });

    await expect(
      service.updateScene({
        projectId: changed.id,
        expectedRevision: changed.revision,
        sceneId: 'scene_1',
        scene: { ...makeScene('scene_1'), mediaKind: 'image', referenceAssetId: 'missing_asset' },
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('recursively removes adapter identity and provider internals from project, job, and catalog DTOs', async () => {
    const internalJob: StudioJob = {
      id: 'job_1',
      projectId: 'project_1',
      sceneId: 'scene_1',
      status: 'queued_remote',
      provider: { providerId: 'provider_1', adapterId: 'weprompt-media-gateway-v1', model: 'model_1' },
      idempotencyKey: 'secret_idempotency_key',
      providerJobId: STUDIO_E2E_BOUNDARY_SENTINELS.providerJobId,
      remoteStartedAt: '2026-07-30T00:00:00.000Z',
      cancellationPolicy: 'queued_and_running',
      outputAssetIds: [],
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
    };
    const nonRetryableDownloadJob: StudioJob = {
      ...internalJob,
      id: 'job_without_remote_identity',
      status: 'failed',
      providerJobId: null,
      remoteStartedAt: null,
      error: {
        code: 'download_failed',
        messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
      },
    };
    const retryableDownloadJob: StudioJob = {
      ...nonRetryableDownloadJob,
      id: 'job_with_remote_identity',
      providerJobId: 'secret_download_remote_id',
      remoteStartedAt: '2026-07-30T00:00:00.000Z',
    };
    const projectStore = createCreativeStudioStore({ rootDir, createId: () => 'project_1' });
    const created = await projectStore.createProject(makeInput());
    await projectStore.updateProject(created.id, (current) => {
      const next = structuredClone(current);
      next.scenes.scene_1 = {
        id: 'scene_1',
        ...makeScene('scene_1'),
        selectedAssetId: null,
        assetIds: [],
        jobIds: ['job_1'],
        reviewState: 'generating',
      };
      next.sceneOrder = ['scene_1'];
      next.jobs.job_1 = internalJob;
      return next;
    });
    Object.assign(internalJob, STUDIO_E2E_BOUNDARY_SENTINELS);
    const submitScenes = vi.fn(async () => [internalJob]);
    const cancelJob = vi.fn(async () => internalJob);
    const retryJob = vi.fn(async () => nonRetryableDownloadJob);
    const retryDownload = vi.fn(async () => retryableDownloadJob);
    const rendererService = createCreativeStudioService({
      store: projectStore,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      providerResolver: {
        listConnectionCandidates: async () => [],
        listGenerationRoutes: async () => ({
          routes: [routeOption('video', { model: 'model_1' })],
          generationCatalogVersion: 'generation-v1',
        }),
        isGenerationRouteAvailable: async () => true,
      },
      jobManager: {
        submitScenes,
        cancelJob,
        retryJob,
        retryDownload,
        resumePendingJobs: vi.fn(),
        dispose: vi.fn(),
      },
    } as unknown as Parameters<typeof createCreativeStudioService>[0]);

    const forgedProject = (await projectStore.getProject('project_1'))!;
    Object.assign(forgedProject.jobs.job_1, STUDIO_E2E_BOUNDARY_SENTINELS);
    (forgedProject.scenes.scene_1 as StudioScene & { providerJobId?: string }).providerJobId = 'scene-provider-secret';
    forgedProject.assets.asset_1 = {
      id: 'asset_1',
      projectId: 'project_1',
      sceneId: 'scene_1',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'assets', fileName: 'asset_1.png' },
      byteSize: 1,
      sha256: '1'.repeat(64),
      createdAt: forgedProject.createdAt,
      idempotencyKey: 'asset-provider-secret',
      sourcePath: STUDIO_E2E_BOUNDARY_SENTINELS.rawOutputPath,
    } as StudioAsset & { idempotencyKey: string; sourcePath: string };
    forgedProject.assets.asset_poster = {
      id: 'asset_poster',
      projectId: 'project_1',
      sceneId: 'scene_1',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'thumbnails', fileName: 'asset_poster.png' },
      byteSize: 1,
      sha256: '2'.repeat(64),
      createdAt: forgedProject.createdAt,
      sourceUrl: STUDIO_E2E_BOUNDARY_SENTINELS.providerUrl,
    } as StudioAsset & { sourceUrl: string };
    forgedProject.jobs.job_1.outputAssetIds = ['asset_1', 'asset_poster'];
    forgedProject.scenes.scene_1.assetIds = ['asset_1', 'asset_poster'];
    forgedProject.scenes.scene_1.selectedAssetId = 'asset_1';
    vi.spyOn(projectStore, 'getProject').mockResolvedValueOnce(forgedProject);

    const projectResult = await rendererService.getProject('project_1');
    const updatedProjectResult = await rendererService.updateProject({
      projectId: 'project_1',
      expectedRevision: 2,
      name: 'Renderer-safe project',
    });
    const catalog = await rendererService.listRoutes({ projectId: 'project_1' });
    expect(catalog.video.options[0]).not.toHaveProperty('cancellationPolicy');
    const jobResults = [
      await rendererService.submitScenes({
        projectId: 'project_1',
        expectedRevision: 3,
        mode: 'single',
        sceneIds: ['scene_1'],
        catalogVersion: catalog.catalogVersion,
        routes: [
          {
            sceneId: 'scene_1',
            choiceId: routeOption('video', { model: 'model_1' }).choiceId,
            kind: 'video',
          },
        ],
      }),
      await rendererService.cancelJob({ projectId: 'project_1', jobId: 'job_1', expectedRevision: 2 }),
      await rendererService.retryJob({ projectId: 'project_1', jobId: 'job_1', expectedRevision: 2 }),
      await rendererService.retryDownload({ projectId: 'project_1', jobId: 'job_1', expectedRevision: 2 }),
    ];

    expect(projectResult?.jobs.job_1).not.toHaveProperty('providerJobId');
    expect(projectResult?.jobs.job_1).not.toHaveProperty('remoteStartedAt');
    expect(projectResult?.jobs.job_1).not.toHaveProperty('idempotencyKey');
    expect(projectResult?.jobs.job_1).not.toHaveProperty('cancellationPolicy');
    expect(projectResult?.jobs.job_1.canCancel).toBe(true);
    expect(projectResult?.jobs.job_1.canRetryDownload).toBe(false);
    expect(projectResult?.scenes.scene_1).not.toHaveProperty('providerJobId');
    expect(projectResult?.assets.asset_1).not.toHaveProperty('idempotencyKey');
    expect(projectResult?.jobs.job_1.outputAssetIds).toEqual(['asset_1', 'asset_poster']);
    expect(projectResult?.assets.asset_poster.managedAsset.collection).toBe('thumbnails');
    expect(projectResult?.assets.asset_1).not.toHaveProperty('sourcePath');
    expect(projectResult?.assets.asset_poster).not.toHaveProperty('sourceUrl');
    expect(updatedProjectResult.jobs.job_1).not.toHaveProperty('providerJobId');
    expect(updatedProjectResult.jobs.job_1).not.toHaveProperty('remoteStartedAt');
    expect(updatedProjectResult.jobs.job_1).not.toHaveProperty('idempotencyKey');
    const sanitizedJobResults = jobResults.flat();
    expect(sanitizedJobResults.map((result) => result.canRetryDownload)).toEqual([false, false, false, true]);
    for (const result of sanitizedJobResults) {
      expect(result).not.toHaveProperty('providerJobId');
      expect(result).not.toHaveProperty('remoteStartedAt');
      expect(result).not.toHaveProperty('idempotencyKey');
      expect(result).not.toHaveProperty('cancellationPolicy');
    }
    for (const rendererDto of [projectResult, updatedProjectResult, sanitizedJobResults, catalog]) {
      expectRendererBoundaryToHideAdapters(rendererDto);
    }
    const rendererPayloads = JSON.stringify([projectResult, updatedProjectResult, sanitizedJobResults, catalog]);
    for (const sentinel of Object.values(STUDIO_E2E_BOUNDARY_SENTINELS)) {
      expect(rendererPayloads).not.toContain(sentinel);
    }
  });

  it('rejects a reordered list that is not an exact project scene permutation', async () => {
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });

    await expect(
      service.reorderScenes({
        projectId: withScene.id,
        expectedRevision: withScene.revision,
        sceneOrder: ['scene_1', 'scene_1'],
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<CreativeStudioStoreError>);
  });

  it('rejects selecting an asset from another scene instead of crossing scene ownership', async () => {
    const project = await service.createProject(makeInput());
    const withFirstScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });
    const withBothScenes = await service.updateScene({
      projectId: withFirstScene.id,
      expectedRevision: withFirstScene.revision,
      sceneId: 'scene_2',
      scene: makeScene('scene_2'),
    });
    const withAsset = await service.updateProject({
      projectId: withBothScenes.id,
      expectedRevision: withBothScenes.revision,
      name: withBothScenes.name,
    });
    const assetProject = await createCreativeStudioStore({ rootDir }).updateProject(
      withAsset.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.asset_2 = {
          id: 'asset_2',
          projectId: next.id,
          sceneId: 'scene_2',
          mediaKind: 'video',
          mimeType: 'video/mp4',
          managedAsset: { collection: 'assets', fileName: 'asset_2.mp4' },
          byteSize: 1,
          sha256: '1'.repeat(64),
          durationSeconds: 4,
          createdAt: next.createdAt,
        };
        next.scenes.scene_2.assetIds = ['asset_2'];
        return next;
      },
      withAsset.revision
    );

    await expect(
      service.selectAsset({
        projectId: assetProject.id,
        expectedRevision: assetProject.revision,
        sceneId: 'scene_1',
        assetId: 'asset_2',
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<CreativeStudioStoreError>);
  });

  it('rejects selecting a historical asset whose media kind differs from the scene', async () => {
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });
    const canonicalStore = createCreativeStudioStore({ rootDir });
    const withImage = await canonicalStore.updateProject(
      withScene.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.asset_image = {
          id: 'asset_image',
          projectId: next.id,
          sceneId: 'scene_1',
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'assets', fileName: 'asset_image.png' },
          byteSize: 1,
          sha256: '4'.repeat(64),
          createdAt: next.createdAt,
        };
        next.scenes.scene_1.assetIds = ['asset_image'];
        return next;
      },
      withScene.revision
    );

    await expect(
      service.selectAsset({
        projectId: withImage.id,
        expectedRevision: withImage.revision,
        sceneId: 'scene_1',
        assetId: 'asset_image',
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('rejects selecting a scene-owned imported reference as the active take', async () => {
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });
    const canonicalStore = createCreativeStudioStore({ rootDir });
    const withImport = await canonicalStore.updateProject(
      withScene.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.reference_1 = {
          id: 'reference_1',
          projectId: next.id,
          sceneId: 'scene_1',
          mediaKind: 'video',
          mimeType: 'video/mp4',
          managedAsset: { collection: 'imports', fileName: 'reference_1.mp4' },
          byteSize: 1,
          sha256: '5'.repeat(64),
          durationSeconds: 4,
          createdAt: next.createdAt,
        };
        next.scenes.scene_1.assetIds = ['reference_1'];
        return next;
      },
      withScene.revision
    );

    await expect(
      service.selectAsset({
        projectId: withImport.id,
        expectedRevision: withImport.revision,
        sceneId: 'scene_1',
        assetId: 'reference_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<CreativeStudioStoreError>);
  });

  it('rejects selecting a scene thumbnail as the active take', async () => {
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });
    const canonicalStore = createCreativeStudioStore({ rootDir });
    const withThumbnail = await canonicalStore.updateProject(
      withScene.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.poster_1 = {
          id: 'poster_1',
          projectId: next.id,
          sceneId: 'scene_1',
          mediaKind: 'video',
          mimeType: 'video/mp4',
          managedAsset: { collection: 'thumbnails', fileName: 'poster_1.mp4' },
          byteSize: 1,
          sha256: '6'.repeat(64),
          durationSeconds: 4,
          createdAt: next.createdAt,
        };
        next.scenes.scene_1.assetIds = ['poster_1'];
        return next;
      },
      withScene.revision
    );

    await expect(
      service.selectAsset({
        projectId: withThumbnail.id,
        expectedRevision: withThumbnail.revision,
        sceneId: 'scene_1',
        assetId: 'poster_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<CreativeStudioStoreError>);
  });

  it('selects a reverse-linked generated take for its owning scene', async () => {
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });
    const canonicalStore = createCreativeStudioStore({ rootDir });
    const withGeneratedTake = await canonicalStore.updateProject(
      withScene.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.take_1 = {
          id: 'take_1',
          projectId: next.id,
          sceneId: 'scene_1',
          mediaKind: 'video',
          mimeType: 'video/mp4',
          managedAsset: { collection: 'assets', fileName: 'take_1.mp4' },
          byteSize: 1,
          sha256: '7'.repeat(64),
          durationSeconds: 4,
          createdAt: next.createdAt,
        };
        next.scenes.scene_1.assetIds = ['take_1'];
        return next;
      },
      withScene.revision
    );

    await expect(
      service.selectAsset({
        projectId: withGeneratedTake.id,
        expectedRevision: withGeneratedTake.revision,
        sceneId: 'scene_1',
        assetId: 'take_1',
      })
    ).resolves.toMatchObject({ scenes: { scene_1: { selectedAssetId: 'take_1' } } });
  });

  it('serializes concurrent expected-revision edits instead of applying a stale scene change', async () => {
    const project = await service.createProject(makeInput());

    const results = await Promise.allSettled([
      service.updateProject({ projectId: project.id, expectedRevision: project.revision, name: 'Edited launch film' }),
      service.updateScene({
        projectId: project.id,
        expectedRevision: project.revision,
        sceneId: 'scene_1',
        scene: makeScene('scene_1'),
      }),
    ]);

    const persisted = await service.getProject(project.id);
    expect(persisted?.name).toBe('Edited launch film');
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('emits only the project id after successful mutation and does not emit for reads or rejected mutations', async () => {
    const project = await service.createProject(makeInput());

    expect(onProjectUpdated).toHaveBeenLastCalledWith(project.id);
    onProjectUpdated.mockClear();
    await service.getProject(project.id);
    expect(onProjectUpdated).not.toHaveBeenCalled();
    await service.updateProject({ projectId: project.id, expectedRevision: project.revision, name: 'Saved update' });
    expect(onProjectUpdated).toHaveBeenCalledWith(project.id);
    onProjectUpdated.mockClear();

    await expect(
      service.updateProject({ projectId: project.id, expectedRevision: 99, name: 'Rejected update' })
    ).rejects.toMatchObject({ code: 'stale_project' } satisfies Partial<CreativeStudioStoreError>);

    expect(onProjectUpdated).not.toHaveBeenCalled();
  });

  it('maps a freshly unavailable stored model without calling the provider', async () => {
    const draft = vi.fn();
    const project = await service.createProject(makeInput());
    const store = createCreativeStudioStore({ rootDir });
    const selected = await selectStoryboard(store, project);
    const storyboardService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner({ listModels: async () => [], draft }),
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;

    await expect(
      storyboardService.proposeStoryboard({
        projectId: project.id,
        expectedRevision: selected.revision,
        replaceExisting: false,
      })
    ).rejects.toMatchObject({ code: 'planning_unavailable' });
    expect(draft).not.toHaveBeenCalled();
  });

  it.each([
    ['model_unavailable', 'planning_unavailable'],
    ['busy', 'busy'],
    ['provider_auth_failed', 'provider_error'],
    ['provider_rate_limited', 'provider_error'],
    ['provider_timeout', 'provider_error'],
    ['provider_request_failed', 'provider_error'],
    ['canceled', 'provider_error'],
    ['invalid_output', 'provider_error'],
  ] as const)('maps planner %s outcomes to the redacted Studio %s result', async (plannerCode, studioCode) => {
    const project = await service.createProject(makeInput());
    const store = createCreativeStudioStore({ rootDir });
    const selected = await selectStoryboard(store, project);
    const storyboardService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner({
        draft: async () => {
          throw new StudioStoryboardPlannerError(plannerCode);
        },
      }),
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;

    await expect(
      storyboardService.proposeStoryboard({
        projectId: project.id,
        expectedRevision: selected.revision,
        replaceExisting: false,
      })
    ).rejects.toMatchObject({ code: studioCode });
  });

  it('refuses to replace an existing storyboard before invoking the planner', async () => {
    const runner = vi.fn();
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_existing',
      scene: makeScene('scene_existing'),
    });
    const storyboardService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      storyboardPlanner: makePlanner({ draft: runner }),
      createSceneId: () => 'scene_1',
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;

    await expect(
      storyboardService.proposeStoryboard({
        projectId: withScene.id,
        expectedRevision: withScene.revision,
        replaceExisting: false,
      })
    ).rejects.toMatchObject({ code: 'storyboard_exists' });
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects duplicate scene identities without committing a partial storyboard', async () => {
    const project = await service.createProject(makeInput());
    const store = createCreativeStudioStore({ rootDir });
    const selected = await selectStoryboard(store, project);
    const storyboardService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      createSceneId: () => 'scene_duplicate',
    });

    await expect(
      storyboardService.proposeStoryboard({
        projectId: selected.id,
        expectedRevision: selected.revision,
        replaceExisting: false,
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    await expect(storyboardService.getProject(selected.id)).resolves.toMatchObject({
      revision: selected.revision,
      scenes: {},
    });
  });

  it('replaces an existing storyboard only after a complete replacement proposal validates', async () => {
    const runner = vi.fn(async () => storyboardProposal);
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_existing',
      scene: makeScene('scene_existing'),
    });
    const store = createCreativeStudioStore({ rootDir });
    const selected = await selectStoryboard(store, withScene);
    let sceneIndex = 0;
    const storyboardService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner({ draft: runner }),
      createSceneId: () => `scene_${++sceneIndex}`,
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;

    const drafted = await storyboardService.proposeStoryboard({
      projectId: withScene.id,
      expectedRevision: selected.revision,
      replaceExisting: true,
    });

    expect(drafted.sceneOrder).toEqual(['scene_1', 'scene_2', 'scene_3']);
    expect(drafted.scenes).not.toHaveProperty('scene_existing');
  });

  it('hydrates canonical draft scenes and emits exactly one update after a successful proposal', async () => {
    const runner = vi.fn(async () => storyboardProposal);
    const project = await service.createProject(makeInput());
    const store = createCreativeStudioStore({ rootDir });
    const selected = await selectStoryboard(store, project);
    onProjectUpdated.mockClear();
    let sceneIndex = 0;
    const storyboardService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner({ draft: runner }),
      createSceneId: () => `scene_${++sceneIndex}`,
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;

    const drafted = await storyboardService.proposeStoryboard({
      projectId: project.id,
      expectedRevision: selected.revision,
      replaceExisting: false,
    });

    expect(drafted.sceneOrder).toEqual(['scene_1', 'scene_2', 'scene_3']);
    expect(drafted.scenes.scene_1).toMatchObject({
      assetIds: [],
      jobIds: [],
      referenceAssetId: null,
      selectedAssetId: null,
    });
    expect(onProjectUpdated).toHaveBeenCalledOnce();
  });

  it('discards a late proposal when a concurrent project mutation changes the captured revision', async () => {
    let release!: (result: typeof storyboardProposal) => void;
    const runner = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const project = await service.createProject(makeInput());
    const store = createCreativeStudioStore({ rootDir });
    const selected = await selectStoryboard(store, project);
    let sceneIndex = 0;
    const storyboardService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner({ draft: runner }),
      createSceneId: () => `scene_${++sceneIndex}`,
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;
    const proposed = storyboardService.proposeStoryboard({
      projectId: project.id,
      expectedRevision: selected.revision,
      replaceExisting: false,
    });

    await vi.waitFor(() => expect(runner).toHaveBeenCalledOnce());
    const edited = await service.updateProject({
      projectId: project.id,
      expectedRevision: selected.revision,
      name: 'Edited while planning',
    });
    release(storyboardProposal);

    await expect(proposed).rejects.toMatchObject({ code: 'stale_project' });
    await expect(service.getProject(project.id)).resolves.toMatchObject({ name: edited.name, scenes: {} });
  });

  describe('unified model catalog', () => {
    const createCatalogHarness = async (
      options: {
        models?: StudioTextModelOption[];
        routes?: StudioRouteCatalogEntry[];
        projectInput?: Partial<CreateStudioProjectInput>;
      } = {}
    ) => {
      const store = createCreativeStudioStore({ rootDir });
      const listModels = vi.fn(async () => options.models ?? storyboardOptions);
      const draft = vi.fn(async () => storyboardProposal);
      const planner: StudioStoryboardPlanner = {
        listModels,
        draft,
        dispose: vi.fn(async () => {}),
      };
      const listGenerationRoutes = vi.fn(async () => ({
        routes: options.routes ?? [routeOption('image'), routeOption('video')],
        generationCatalogVersion: 'generation-v1',
      }));
      const submitScenes = vi.fn(async () => []);
      const catalogService = createCreativeStudioService({
        store,
        onProjectUpdated,
        storyboardPlanner: planner,
        providerResolver: {
          listConnectionCandidates: async () => [],
          listGenerationRoutes,
          isGenerationRouteAvailable: async () => true,
        },
        jobManager: {
          submitScenes,
          cancelJob: vi.fn(),
          retryJob: vi.fn(),
          retryDownload: vi.fn(),
          resumePendingJobs: vi.fn(),
          dispose: vi.fn(),
        },
        createSceneId: (() => {
          let index = 0;
          return () => `draft_scene_${++index}`;
        })(),
      } as unknown as Parameters<typeof createCreativeStudioService>[0]) as SelectionService;
      const project = await catalogService.createProject(makeInput(options.projectInput));
      return {
        store,
        service: catalogService,
        project,
        planner,
        listModels,
        draft,
        listGenerationRoutes,
        submitScenes,
      };
    };

    const makeCanonicalJob = (project: StudioProject, status: StudioJob['status'], id = 'job_1'): StudioJob => ({
      id,
      projectId: project.id,
      sceneId: 'scene_1',
      status,
      provider: { providerId: 'provider_1', adapterId: 'weprompt-media-gateway-v1', model: 'video-model' },
      idempotencyKey: `key_${id}`,
      providerJobId: null,
      cancellationPolicy: 'none',
      outputAssetIds: [],
      error:
        status === 'failed' || status === 'needs_attention'
          ? {
              code: 'provider_unavailable',
              messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
            }
          : null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });

    const makeGeneratedAsset = (project: StudioProject): StudioAsset => ({
      id: 'asset_1',
      projectId: project.id,
      sceneId: 'scene_1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'asset_1.mp4' },
      byteSize: 1,
      sha256: '1'.repeat(64),
      durationSeconds: 12,
      createdAt: project.createdAt,
    });

    const createVideoSubmissionHarness = async (mutate?: (project: StudioProject) => void) => {
      const harness = await createCatalogHarness();
      const rendered = await harness.service.updateScene({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneId: 'scene_1',
        scene: makeScene('scene_1', 12),
      });
      if (mutate) {
        await harness.store.updateProject(
          rendered.id,
          (current) => {
            const next = structuredClone(current);
            mutate(next);
            return next;
          },
          rendered.revision
        );
      }
      const project = (await harness.store.getProject(rendered.id))!;
      const catalog = await harness.service.listRoutes({ projectId: project.id });
      const route = catalog.video.options[0]!;
      harness.listModels.mockClear();
      harness.listGenerationRoutes.mockClear();
      harness.submitScenes.mockClear();
      const submit = (mode: 'single' | 'batch') =>
        harness.service.submitScenes({
          projectId: project.id,
          expectedRevision: project.revision,
          mode,
          sceneIds: ['scene_1'],
          routes: [{ sceneId: 'scene_1', choiceId: route.choiceId, kind: 'video' }],
          catalogVersion: catalog.catalogVersion,
        });
      return { ...harness, project, submit };
    };

    const createFitHarness = async (options: {
      targetDurationSeconds?: number;
      scenes: Array<{ id: string; durationSeconds: number; mediaKind?: 'image' | 'video' }>;
      routes?: Array<ReturnType<typeof routeOption>>;
      selectImage?: boolean;
      selectVideo?: boolean;
      mutate?: (project: StudioProject) => void;
    }) => {
      const routes = options.routes ?? [routeOption('image'), routeOption('video')];
      const harness = await createCatalogHarness({
        routes,
        projectInput: { targetDurationSeconds: options.targetDurationSeconds ?? 15 },
      });
      const canonical = await harness.store.updateProject(harness.project.id, (current) => {
        const scenes = Object.fromEntries(
          options.scenes.map(({ id, durationSeconds, mediaKind = 'video' }) => [
            id,
            {
              ...makeScene(id, durationSeconds),
              id,
              mediaKind,
              selectedAssetId: null,
              assetIds: [],
              jobIds: [],
              reviewState: 'draft' as const,
            },
          ])
        );
        const imageRoute = routes.find((route) => route.kind === 'image');
        const videoRoute = routes.find((route) => route.kind === 'video');
        const next: StudioProject = {
          ...current,
          sceneOrder: options.scenes.map(({ id }) => id),
          scenes,
          routing: {
            ...current.routing,
            image:
              options.selectImage === false || imageRoute === undefined
                ? null
                : {
                    providerId: imageRoute.providerId,
                    adapterId: imageRoute.adapterId,
                    model: imageRoute.model,
                  },
            video:
              options.selectVideo === false || videoRoute === undefined
                ? null
                : {
                    providerId: videoRoute.providerId,
                    adapterId: videoRoute.adapterId,
                    model: videoRoute.model,
                  },
          },
        };
        options.mutate?.(next);
        return next;
      });
      const catalog = await harness.service.listRoutes({ projectId: canonical.id });
      harness.listModels.mockClear();
      harness.listGenerationRoutes.mockClear();
      onProjectUpdated.mockClear();
      return {
        ...harness,
        canonical,
        catalog,
        fit: (overrides: Partial<{ expectedRevision: number; catalogVersion: string }> = {}) =>
          harness.service.fitStoryboard({
            projectId: canonical.id,
            expectedRevision: overrides.expectedRevision ?? canonical.revision,
            catalogVersion: overrides.catalogVersion ?? catalog.catalogVersion,
          }),
      };
    };

    describe('atomic route-aware duration fitting', () => {
      it('uses fresh independent image and video route bounds and writes once', async () => {
        const videoRoute = routeOption('video', {
          constraints: {
            ...routeOption('video').constraints,
            minDurationSeconds: 4,
            maxDurationSeconds: 12,
          },
        });
        const imageRoute = routeOption('image', {
          constraints: {
            ...routeOption('image').constraints,
            minDurationSeconds: 1,
            maxDurationSeconds: 8,
          },
        });
        const harness = await createFitHarness({
          scenes: [
            { id: 'video_scene', durationSeconds: 10 },
            { id: 'image_scene', durationSeconds: 8, mediaKind: 'image' },
          ],
          routes: [imageRoute, videoRoute],
        });
        const updateProject = vi.spyOn(harness.store, 'updateProject');

        const outcome = await harness.fit();

        expect(outcome).toMatchObject({
          status: 'applied',
          changedSceneIds: ['image_scene'],
          lockedSceneIds: [],
          project: {
            revision: harness.canonical.revision + 1,
            scenes: {
              video_scene: { durationSeconds: 10 },
              image_scene: { durationSeconds: 5 },
            },
          },
        });
        expect(updateProject).toHaveBeenCalledOnce();
        expect(onProjectUpdated).toHaveBeenCalledExactlyOnceWith(harness.canonical.id);
      });

      it('returns route_unavailable in storyboard order without writing', async () => {
        const harness = await createFitHarness({
          scenes: [
            { id: 'video_scene', durationSeconds: 9 },
            { id: 'image_scene', durationSeconds: 9, mediaKind: 'image' },
          ],
          selectImage: false,
          selectVideo: false,
        });
        const updateProject = vi.spyOn(harness.store, 'updateProject');

        await expect(harness.fit()).resolves.toMatchObject({
          status: 'unreachable',
          reason: 'route_unavailable',
          unavailableSceneIds: ['video_scene', 'image_scene'],
        });
        expect(updateProject).not.toHaveBeenCalled();
        expect(onProjectUpdated).not.toHaveBeenCalled();
      });

      it('does not require a route for a locked scene but still reports an adjustable missing route', async () => {
        const harness = await createFitHarness({
          scenes: [
            { id: 'locked_scene', durationSeconds: 10 },
            { id: 'adjustable_scene', durationSeconds: 8 },
          ],
          selectVideo: false,
          mutate: (project) => {
            const asset = { ...makeGeneratedAsset(project), id: 'locked_asset', sceneId: 'locked_scene' };
            project.assets[asset.id] = asset;
            project.scenes.locked_scene!.assetIds = [asset.id];
          },
        });

        await expect(harness.fit()).resolves.toMatchObject({
          status: 'unreachable',
          reason: 'route_unavailable',
          lockedSceneIds: ['locked_scene'],
          unavailableSceneIds: ['adjustable_scene'],
        });
      });

      it('includes locked duration in the full-project bounds', async () => {
        const bounded = routeOption('video', {
          constraints: {
            ...routeOption('video').constraints,
            minDurationSeconds: 4,
            maxDurationSeconds: 8,
          },
        });
        const harness = await createFitHarness({
          targetDurationSeconds: 20,
          scenes: [
            { id: 'locked_scene', durationSeconds: 10 },
            { id: 'adjustable_scene', durationSeconds: 8 },
          ],
          routes: [bounded],
          mutate: (project) => {
            const asset = { ...makeGeneratedAsset(project), id: 'locked_asset', sceneId: 'locked_scene' };
            project.assets[asset.id] = asset;
            project.scenes.locked_scene!.assetIds = [asset.id];
          },
        });

        await expect(harness.fit()).resolves.toMatchObject({
          status: 'unreachable',
          reason: 'target_out_of_bounds',
          lockedSceneIds: ['locked_scene'],
          minimumTotalSeconds: 14,
          maximumTotalSeconds: 18,
        });
      });

      it('returns full-project bounds without writing when locked duration exceeds the target', async () => {
        const bounded = routeOption('video', {
          constraints: {
            ...routeOption('video').constraints,
            minDurationSeconds: 4,
            maxDurationSeconds: 8,
          },
        });
        const harness = await createFitHarness({
          targetDurationSeconds: 15,
          scenes: [
            { id: 'locked_scene', durationSeconds: 20 },
            { id: 'adjustable_scene', durationSeconds: 8 },
          ],
          routes: [bounded],
          mutate: (project) => {
            const asset = { ...makeGeneratedAsset(project), id: 'locked_asset', sceneId: 'locked_scene' };
            project.assets[asset.id] = asset;
            project.scenes.locked_scene!.assetIds = [asset.id];
          },
        });
        const before = structuredClone((await harness.store.getProject(harness.canonical.id))!);
        const updateProject = vi.spyOn(harness.store, 'updateProject');

        await expect(harness.fit()).resolves.toMatchObject({
          status: 'unreachable',
          reason: 'target_out_of_bounds',
          lockedSceneIds: ['locked_scene'],
          minimumTotalSeconds: 24,
          maximumTotalSeconds: 28,
          project: {
            revision: before.revision,
            updatedAt: before.updatedAt,
            scenes: {
              locked_scene: { durationSeconds: 20 },
              adjustable_scene: { durationSeconds: 8 },
            },
          },
        });
        expect(updateProject).not.toHaveBeenCalled();
        expect(onProjectUpdated).not.toHaveBeenCalled();
        await expect(harness.store.getProject(before.id)).resolves.toEqual(before);
      });

      it('returns full-project bounds when locked duration equals the target but adjustable minimum is positive', async () => {
        const harness = await createFitHarness({
          targetDurationSeconds: 15,
          scenes: [
            { id: 'locked_scene', durationSeconds: 15 },
            { id: 'adjustable_scene', durationSeconds: 8 },
          ],
          mutate: (project) => {
            const asset = { ...makeGeneratedAsset(project), id: 'locked_asset', sceneId: 'locked_scene' };
            project.assets[asset.id] = asset;
            project.scenes.locked_scene!.assetIds = [asset.id];
          },
        });
        const before = structuredClone((await harness.store.getProject(harness.canonical.id))!);
        const updateProject = vi.spyOn(harness.store, 'updateProject');

        await expect(harness.fit()).resolves.toMatchObject({
          status: 'unreachable',
          reason: 'target_out_of_bounds',
          lockedSceneIds: ['locked_scene'],
          minimumTotalSeconds: 16,
          maximumTotalSeconds: 27,
          project: { revision: before.revision, updatedAt: before.updatedAt },
        });
        expect(updateProject).not.toHaveBeenCalled();
        expect(onProjectUpdated).not.toHaveBeenCalled();
        await expect(harness.store.getProject(before.id)).resolves.toEqual(before);
      });

      it.each(['queued_local', 'submitting', 'queued_remote', 'running', 'needs_attention'] as const)(
        'locks exactly the active %s job status',
        async (status) => {
          const harness = await createFitHarness({
            scenes: [
              { id: 'scene_1', durationSeconds: 10 },
              { id: 'scene_2', durationSeconds: 8 },
            ],
            mutate: (project) => {
              const job = makeCanonicalJob(project, status);
              project.jobs[job.id] = job;
              project.scenes.scene_1!.jobIds = [job.id];
            },
          });

          await expect(harness.fit()).resolves.toMatchObject({
            status: 'applied',
            lockedSceneIds: ['scene_1'],
            changedSceneIds: ['scene_2'],
            project: { scenes: { scene_1: { durationSeconds: 10 }, scene_2: { durationSeconds: 5 } } },
          });
        }
      );

      it.each(['succeeded', 'failed', 'cancelled'] as const)('does not lock terminal %s jobs', async (status) => {
        const harness = await createFitHarness({
          scenes: [
            { id: 'scene_1', durationSeconds: 10 },
            { id: 'scene_2', durationSeconds: 8 },
          ],
          mutate: (project) => {
            const job = makeCanonicalJob(project, status);
            project.jobs[job.id] = job;
            project.scenes.scene_1!.jobIds = [job.id];
          },
        });

        const outcome = await harness.fit();

        expect(outcome).toMatchObject({ status: 'applied', lockedSceneIds: [] });
        if (outcome.status === 'applied') expect(outcome.changedSceneIds).toContain('scene_1');
      });

      it.each([
        ['assets', false, true],
        ['assets', true, true],
        ['imports', true, false],
        ['thumbnails', true, false],
      ] as const)('treats %s ownership with selected=%s as locked=%s', async (collection, selected, locked) => {
        const harness = await createFitHarness({
          scenes: [
            { id: 'scene_1', durationSeconds: 10 },
            { id: 'scene_2', durationSeconds: 8 },
          ],
          mutate: (project) => {
            const asset = {
              ...makeGeneratedAsset(project),
              id: 'owned_asset',
              sceneId: 'scene_1',
              managedAsset: { collection, fileName: 'owned.bin' },
            };
            project.assets[asset.id] = asset;
            project.scenes.scene_1!.assetIds = [asset.id];
            project.scenes.scene_1!.selectedAssetId = selected ? asset.id : null;
          },
        });

        const outcome = await harness.fit();

        expect(outcome.lockedSceneIds.includes('scene_1')).toBe(locked);
      });

      it('returns already_matches for a fully locked matching cut without any write or notification', async () => {
        const harness = await createFitHarness({
          targetDurationSeconds: 15,
          scenes: [{ id: 'locked_scene', durationSeconds: 15 }],
          selectVideo: false,
          mutate: (project) => {
            const asset = { ...makeGeneratedAsset(project), id: 'locked_asset', sceneId: 'locked_scene' };
            project.assets[asset.id] = asset;
            project.scenes.locked_scene!.assetIds = [asset.id];
          },
        });
        const before = structuredClone((await harness.store.getProject(harness.canonical.id))!);
        const updateProject = vi.spyOn(harness.store, 'updateProject');

        await expect(harness.fit()).resolves.toMatchObject({
          status: 'already_matches',
          changedSceneIds: [],
          lockedSceneIds: ['locked_scene'],
          project: { revision: before.revision, updatedAt: before.updatedAt },
        });
        expect(updateProject).not.toHaveBeenCalled();
        expect(onProjectUpdated).not.toHaveBeenCalled();
        await expect(harness.store.getProject(before.id)).resolves.toEqual(before);
      });

      it('returns no_adjustable_scenes when a fully locked cut mismatches', async () => {
        const harness = await createFitHarness({
          targetDurationSeconds: 15,
          scenes: [{ id: 'locked_scene', durationSeconds: 14 }],
          mutate: (project) => {
            const asset = { ...makeGeneratedAsset(project), id: 'locked_asset', sceneId: 'locked_scene' };
            project.assets[asset.id] = asset;
            project.scenes.locked_scene!.assetIds = [asset.id];
          },
        });

        await expect(harness.fit()).resolves.toMatchObject({
          status: 'unreachable',
          reason: 'no_adjustable_scenes',
          fixedTotalSeconds: 14,
          lockedSceneIds: ['locked_scene'],
        });
      });

      it('normalizes an already-on-target scene that violates its selected route bounds', async () => {
        const bounded = routeOption('video', {
          constraints: {
            ...routeOption('video').constraints,
            minDurationSeconds: 3,
            maxDurationSeconds: 10,
          },
        });
        const harness = await createFitHarness({
          targetDurationSeconds: 8,
          scenes: [
            { id: 'invalid_scene', durationSeconds: 1 },
            { id: 'valid_scene', durationSeconds: 7 },
          ],
          routes: [bounded],
        });

        await expect(harness.fit()).resolves.toMatchObject({
          status: 'applied',
          project: { scenes: { invalid_scene: { durationSeconds: 3 }, valid_scene: { durationSeconds: 5 } } },
        });
      });

      it('rejects stale revisions and a compare-and-swap race without a partial duration write', async () => {
        const staleHarness = await createFitHarness({
          scenes: [
            { id: 'scene_1', durationSeconds: 10 },
            { id: 'scene_2', durationSeconds: 8 },
          ],
        });
        await expect(staleHarness.fit({ expectedRevision: staleHarness.canonical.revision - 1 })).rejects.toMatchObject(
          {
            code: 'stale_project',
          }
        );

        const originalUpdate = staleHarness.store.updateProject.bind(staleHarness.store);
        vi.spyOn(staleHarness.store, 'updateProject').mockImplementationOnce(async (projectId, update, revision) => {
          await originalUpdate(projectId, (current) => ({ ...current, brief: 'Concurrent edit' }), revision);
          return originalUpdate(projectId, update, revision);
        });
        await expect(staleHarness.fit()).rejects.toMatchObject({ code: 'stale_project' });
        const persisted = (await staleHarness.store.getProject(staleHarness.canonical.id))!;
        expect(persisted.brief).toBe('Concurrent edit');
        expect(persisted.sceneOrder.map((sceneId) => persisted.scenes[sceneId]!.durationSeconds)).toEqual([10, 8]);
      });

      it('rejects stale route catalogs and malformed versions before writing', async () => {
        const harness = await createFitHarness({
          scenes: [
            { id: 'scene_1', durationSeconds: 10 },
            { id: 'scene_2', durationSeconds: 8 },
          ],
        });
        const updateProject = vi.spyOn(harness.store, 'updateProject');

        await expect(harness.fit({ catalogVersion: '0000000000000000' })).rejects.toMatchObject({
          code: 'invalid_route',
        });
        for (const catalogVersion of ['ABCDEF0123456789', 'abcdef012345678', 'gggggggggggggggg']) {
          await expect(harness.fit({ catalogVersion })).rejects.toMatchObject({ code: 'invalid_payload' });
        }
        expect(updateProject).not.toHaveBeenCalled();
      });
    });

    const expectBatchRejectedBeforeCatalog = async (
      harness: Awaited<ReturnType<typeof createVideoSubmissionHarness>>
    ): Promise<void> => {
      await expect(harness.submit('batch')).rejects.toMatchObject({ code: 'invalid_payload' });
      expect([
        harness.listModels.mock.calls.length,
        harness.listGenerationRoutes.mock.calls.length,
        harness.submitScenes.mock.calls.length,
      ]).toEqual([0, 0, 0]);
    };

    it('persists only a freshly available storyboard selection', async () => {
      const harness = await createCatalogHarness();
      const requested = {
        providerId: 'provider_1',
        model: 'gpt-4o',
        authorization: 'must-not-persist',
      };

      const updated = await harness.service.updateModelSelection({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        role: 'storyboard',
        selection: requested,
      });

      expect(updated.routing.storyboard).toEqual({ providerId: 'provider_1', model: 'gpt-4o' });
    });

    it('keeps a removed persisted model visible as unavailable without falling back', async () => {
      const harness = await createCatalogHarness();
      await harness.store.updateProject(harness.project.id, (current) => ({
        ...current,
        routing: {
          ...current.routing,
          storyboard: { providerId: 'removed', model: 'old-model' },
        },
      }));

      const catalog = await harness.service.listRoutes({ projectId: harness.project.id });

      expect(catalog.storyboard).toMatchObject({
        status: 'unavailable',
        selected: { providerId: 'removed', model: 'old-model' },
      });
    });

    it('reloads an unavailable media selection as an explicit opaque choice while preserving its internal adapter', async () => {
      const harness = await createCatalogHarness();
      const persisted = await harness.store.updateProject(harness.project.id, (current) => ({
        ...current,
        routing: {
          ...current.routing,
          video: {
            providerId: 'provider_removed',
            adapterId: KNOWN_ADAPTER_SENTINEL,
            model: 'retired-video-model',
          },
        },
      }));
      const reloadedStore = createCreativeStudioStore({ rootDir });
      const reloaded = createCreativeStudioService({
        store: reloadedStore,
        onProjectUpdated,
        storyboardPlanner: makePlanner(),
        providerResolver: {
          listConnectionCandidates: async () => [],
          listGenerationRoutes: async () => ({ routes: [], generationCatalogVersion: 'generation-v2' }),
          isGenerationRouteAvailable: async () => false,
        },
      } as unknown as Parameters<typeof createCreativeStudioService>[0]);

      const rendererProject = await reloaded.getProject(persisted.id);
      const catalog = await reloaded.listRoutes({ projectId: persisted.id });
      const internalProject = await reloadedStore.getProject(persisted.id);

      expect(rendererProject?.routing.video).toMatchObject({
        choiceId: expect.stringMatching(/^choice_[A-Za-z0-9_-]+$/),
        providerId: 'provider_removed',
        model: 'retired-video-model',
      });
      expect(catalog.video).toMatchObject({
        status: 'unavailable',
        selected: rendererProject?.routing.video,
        options: [],
      });
      expect(internalProject?.routing.video).toEqual({
        providerId: 'provider_removed',
        adapterId: KNOWN_ADAPTER_SENTINEL,
        model: 'retired-video-model',
      });
      expectRendererBoundaryToHideAdapters(rendererProject);
      expectRendererBoundaryToHideAdapters(catalog);
    });

    it.each([3, 13])(
      'keeps a selected video route with 4-12 second bounds visible when a scene duration is %i',
      async (durationSeconds) => {
        const selectedRoute = routeOption('video', {
          constraints: { ...routeOption('video').constraints, minDurationSeconds: 4, maxDurationSeconds: 12 },
        });
        const harness = await createCatalogHarness({ routes: [selectedRoute] });
        const selected = await harness.service.updateModelSelection({
          projectId: harness.project.id,
          expectedRevision: harness.project.revision,
          role: 'video',
          selection: { choiceId: selectedRoute.choiceId },
        });
        const withOutOfRangeScene = await harness.service.updateScene({
          projectId: selected.id,
          expectedRevision: selected.revision,
          sceneId: 'scene_duration',
          scene: makeScene('scene_duration', durationSeconds),
        });

        const catalog = await harness.service.listRoutes({ projectId: withOutOfRangeScene.id });

        expect(catalog.video).toMatchObject({
          status: 'ready',
          selected: { choiceId: selectedRoute.choiceId },
          selectedRoute: {
            choiceId: selectedRoute.choiceId,
            constraints: { minDurationSeconds: 4, maxDurationSeconds: 12 },
          },
        });
      }
    );

    it('projects storyboard options to safe public fields before returning the catalog', async () => {
      const harness = await createCatalogHarness();
      harness.listModels.mockResolvedValue([
        {
          providerId: 'provider_1',
          providerName: 'Provider\u0000 One',
          model: 'gpt-4o',
          health: 'available',
          authorization: 'must-not-cross-main',
        },
        {
          providerId: '../unsafe',
          providerName: 'Unsafe',
          model: 'unsafe-model',
          health: 'available',
        },
        {
          providerId: 'provider_2',
          providerName: 'Unsafe model',
          model: 'bad\nmodel',
          health: 'available',
        },
      ]);

      const catalog = await harness.service.listRoutes({ projectId: harness.project.id });

      expect(catalog.storyboard.options).toEqual([
        {
          providerId: 'provider_1',
          providerName: 'Provider One',
          model: 'gpt-4o',
          health: 'available',
        },
      ]);
      expect(JSON.stringify(catalog)).not.toMatch(/authorization|must-not-cross-main|\.\.\/unsafe|bad\\nmodel/i);
    });

    it('rejects a media selection whose kind or exact adapter identity does not match the role', async () => {
      const harness = await createCatalogHarness();
      const catalog = await harness.service.listRoutes({ projectId: harness.project.id });

      await expect(
        harness.service.updateModelSelection({
          projectId: harness.project.id,
          expectedRevision: harness.project.revision,
          role: 'image',
          selection: {
            choiceId: catalog.video.options[0]!.choiceId,
          },
        })
      ).rejects.toMatchObject({ code: 'invalid_route' });
    });

    it('keeps project-compatible routes selectable so a scene can be repaired', async () => {
      const harness = await createCatalogHarness();
      const withScene = await harness.service.updateScene({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneId: 'scene_long',
        scene: makeScene('scene_long', 20),
      });

      const catalog = await harness.service.listRoutes({ projectId: withScene.id });
      expect(catalog.video).toMatchObject({
        status: 'selection_required',
        options: [{ choiceId: routeOption('video').choiceId }],
      });
      await expect(
        harness.service.updateModelSelection({
          projectId: withScene.id,
          expectedRevision: withScene.revision,
          role: 'video',
          selection: { choiceId: routeOption('video').choiceId },
        })
      ).resolves.toMatchObject({ routing: { video: { model: 'video-model' } } });
    });

    it('filters routes by project format, health, and silent output while leaving scene reference checks for generation', async () => {
      const harness = await createCatalogHarness({
        routes: [
          routeOption('video', {
            model: 'aspect-model',
            constraints: { ...routeOption('video').constraints, aspectRatios: ['1:1'] },
          }),
          routeOption('video', {
            model: 'resolution-model',
            constraints: { ...routeOption('video').constraints, resolutions: ['720p'] },
          }),
          routeOption('video', { model: 'unavailable-model', health: 'unavailable' }),
          routeOption('video', {
            model: 'audio-model',
            constraints: { ...routeOption('video').constraints, silentOutput: false },
          }),
          routeOption('video', {
            model: 'no-reference-model',
            constraints: { ...routeOption('video').constraints, supportsFirstFrame: false },
          }),
        ],
      });
      const referenced = await harness.store.updateProject(harness.project.id, (current) => ({
        ...current,
        sceneOrder: ['scene_reference'],
        scenes: {
          scene_reference: {
            id: 'scene_reference',
            ...makeScene('scene_reference'),
            referenceAssetId: 'asset_reference',
            selectedAssetId: null,
            assetIds: ['asset_reference'],
            jobIds: [],
            reviewState: 'ready',
          },
        },
        assets: {
          asset_reference: {
            id: 'asset_reference',
            projectId: current.id,
            sceneId: 'scene_reference',
            mediaKind: 'image',
            mimeType: 'image/png',
            managedAsset: { collection: 'imports', fileName: 'asset_reference.png' },
            byteSize: 1,
            sha256: 'a'.repeat(64),
            createdAt: current.createdAt,
          },
        },
      }));

      const catalog = await harness.service.listRoutes({ projectId: referenced.id });

      expect(catalog.video.options).toMatchObject([{ model: 'no-reference-model' }]);
    });

    it('keeps trusted OpenRouter audio routes while rejecting non-silent routes from every other adapter', async () => {
      const openRouterAudio = routeOption('video', {
        adapterId: 'openrouter-video-v1',
        model: 'bytedance/seedance-2.0-fast',
        constraints: { ...routeOption('video').constraints, silentOutput: false },
      });
      const otherAdapterAudio = routeOption('video', {
        adapterId: 'weprompt-media-gateway-v1',
        model: 'gateway-audio-model',
        constraints: { ...routeOption('video').constraints, silentOutput: false },
      });
      const harness = await createCatalogHarness({ routes: [openRouterAudio, otherAdapterAudio] });

      const catalog = await harness.service.listRoutes({ projectId: harness.project.id });

      expect(catalog.video.options).toEqual([
        expect.objectContaining({
          model: 'bytedance/seedance-2.0-fast',
          constraints: expect.objectContaining({ silentOutput: false }),
        }),
      ]);
    });

    it('clears a selection while preserving optimistic revision checks', async () => {
      const harness = await createCatalogHarness();
      const beforeSelection = await harness.service.listRoutes({ projectId: harness.project.id });
      const selected = await harness.service.updateModelSelection({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        role: 'storyboard',
        selection: { providerId: 'provider_1', model: 'gpt-4o' },
      });
      const afterSelection = await harness.service.listRoutes({ projectId: selected.id });

      const cleared = await harness.service.updateModelSelection({
        projectId: selected.id,
        expectedRevision: selected.revision,
        role: 'storyboard',
        selection: null,
      });

      expect(cleared.routing.storyboard).toBeNull();
      expect(afterSelection.catalogVersion).toBe(beforeSelection.catalogVersion);
      await expect(
        harness.service.updateModelSelection({
          projectId: selected.id,
          expectedRevision: selected.revision,
          role: 'storyboard',
          selection: null,
        })
      ).rejects.toMatchObject({ code: 'stale_project' });
    });

    it('rejects a selection mutation for a missing project', async () => {
      const harness = await createCatalogHarness();

      await expect(
        harness.service.updateModelSelection({
          projectId: 'missing_project',
          expectedRevision: 1,
          role: 'storyboard',
          selection: null,
        })
      ).rejects.toMatchObject({ code: 'not_found' });
    });

    it('maps planner or generation catalog failures to provider_error', async () => {
      const harness = await createCatalogHarness();
      harness.listModels.mockRejectedValueOnce(new Error('planner unavailable'));
      await expect(harness.service.listRoutes({ projectId: harness.project.id })).rejects.toMatchObject({
        code: 'provider_error',
      });

      harness.listGenerationRoutes.mockRejectedValueOnce(new Error('generation unavailable'));
      await expect(harness.service.listRoutes({ projectId: harness.project.id })).rejects.toMatchObject({
        code: 'provider_error',
      });
    });

    it('rejects paid submission when the reviewed unified catalog changed', async () => {
      const harness = await createCatalogHarness();
      const catalog = await harness.service.listRoutes({ projectId: harness.project.id });
      harness.listModels.mockResolvedValue([
        ...storyboardOptions,
        {
          providerId: 'provider_2',
          providerName: 'Provider Two',
          model: 'new-model',
          health: 'available',
        },
      ]);

      await expect(
        harness.service.submitScenes({
          projectId: harness.project.id,
          expectedRevision: harness.project.revision,
          mode: 'single',
          sceneIds: ['scene_1'],
          routes: [
            {
              sceneId: 'scene_1',
              choiceId: routeOption('image').choiceId,
              kind: 'image',
            },
          ],
          catalogVersion: catalog.catalogVersion,
        })
      ).rejects.toMatchObject({ code: 'invalid_route' });
      expect(harness.submitScenes).not.toHaveBeenCalled();
    });

    it('submits a batch whose full canonical storyboard is 18 seconds against a 15-second target', async () => {
      const harness = await createCatalogHarness();
      const targeted = await harness.service.updateProject({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        targetDurationSeconds: 15,
      });
      const opening = await harness.service.updateScene({
        projectId: targeted.id,
        expectedRevision: targeted.revision,
        sceneId: 'scene_1',
        scene: makeScene('scene_1', 10),
      });
      const middle = await harness.service.updateScene({
        projectId: opening.id,
        expectedRevision: opening.revision,
        sceneId: 'scene_2',
        scene: makeScene('scene_2', 5),
      });
      const fullCut = await harness.service.updateScene({
        projectId: middle.id,
        expectedRevision: middle.revision,
        sceneId: 'scene_3',
        scene: makeScene('scene_3', 3),
      });
      const catalog = await harness.service.listRoutes({ projectId: fullCut.id });
      const route = catalog.video.options[0]!;

      await harness.service.submitScenes({
        projectId: fullCut.id,
        expectedRevision: fullCut.revision,
        mode: 'batch',
        sceneIds: ['scene_1', 'scene_2'],
        routes: [
          { sceneId: 'scene_1', choiceId: route.choiceId, kind: 'video' },
          { sceneId: 'scene_2', choiceId: route.choiceId, kind: 'video' },
        ],
        catalogVersion: catalog.catalogVersion,
      });

      expect(harness.submitScenes).toHaveBeenCalledOnce();
    });

    it('rejects a batch scene with no visual prompt before catalog or manager work even when review state says ready', async () => {
      const harness = await createVideoSubmissionHarness((project) => {
        project.scenes.scene_1.visualPrompt = '   ';
        project.scenes.scene_1.reviewState = 'ready';
      });

      await expectBatchRejectedBeforeCatalog(harness);
    });

    it('rejects a batch scene with no title before catalog or manager work even when review state says ready', async () => {
      const harness = await createVideoSubmissionHarness((project) => {
        project.scenes.scene_1.title = '';
        project.scenes.scene_1.reviewState = 'ready';
      });

      await expectBatchRejectedBeforeCatalog(harness);
    });

    it.each(['queued_local', 'submitting', 'queued_remote', 'running'] as const)(
      'rejects a batch scene with a canonical %s job before catalog or manager work',
      async (status) => {
        const harness = await createVideoSubmissionHarness((project) => {
          project.jobs.job_1 = makeCanonicalJob(project, status);
          project.scenes.scene_1.jobIds = ['job_1'];
          project.scenes.scene_1.reviewState = 'ready';
        });

        await expectBatchRejectedBeforeCatalog(harness);
      }
    );

    it.each(['failed', 'needs_attention'] as const)(
      'rejects a batch scene whose latest canonical job is %s before catalog or manager work',
      async (status) => {
        const harness = await createVideoSubmissionHarness((project) => {
          project.jobs.job_1 = makeCanonicalJob(project, status);
          project.scenes.scene_1.jobIds = ['job_1'];
          project.scenes.scene_1.reviewState = 'ready';
        });

        await expectBatchRejectedBeforeCatalog(harness);
      }
    );

    it.each([
      { selectedAssetId: null, label: 'unselected' },
      { selectedAssetId: 'asset_1', label: 'selected' },
    ] as const)(
      'rejects a batch scene with a canonical generated $label asset before catalog or manager work',
      async ({ selectedAssetId }) => {
        const harness = await createVideoSubmissionHarness((project) => {
          project.assets.asset_1 = makeGeneratedAsset(project);
          project.scenes.scene_1.assetIds = ['asset_1'];
          project.scenes.scene_1.selectedAssetId = selectedAssetId;
          project.scenes.scene_1.reviewState = 'ready';
        });

        await expectBatchRejectedBeforeCatalog(harness);
      }
    );

    it('rejects a batch scene whose stored identity does not match its canonical scene key', async () => {
      const harness = await createVideoSubmissionHarness();
      const forged = structuredClone(harness.project);
      forged.scenes.scene_1.id = 'scene_alias';
      vi.spyOn(harness.store, 'getProject').mockResolvedValueOnce(forged);

      await expectBatchRejectedBeforeCatalog(harness);
    });

    it('permits a ready batch when an older failure is followed by a canonical cancelled job', async () => {
      const harness = await createVideoSubmissionHarness((project) => {
        project.jobs.job_failed = makeCanonicalJob(project, 'failed', 'job_failed');
        project.jobs.job_cancelled = makeCanonicalJob(project, 'cancelled', 'job_cancelled');
        project.scenes.scene_1.jobIds = ['job_failed', 'job_cancelled'];
        project.scenes.scene_1.reviewState = 'blocked';
      });

      await harness.submit('batch');

      expect(harness.submitScenes).toHaveBeenCalledOnce();
    });

    it('permits single-scene regeneration for a selected generated scene and strips mode at the manager boundary', async () => {
      const harness = await createVideoSubmissionHarness((project) => {
        project.assets.asset_1 = makeGeneratedAsset(project);
        project.scenes.scene_1.assetIds = ['asset_1'];
        project.scenes.scene_1.selectedAssetId = 'asset_1';
        project.scenes.scene_1.reviewState = 'complete';
      });

      await harness.submit('single');

      expect(harness.submitScenes).toHaveBeenCalledOnce();
      expect(harness.submitScenes.mock.calls[0]?.[0]).not.toHaveProperty('mode');
    });

    it('permits a ready batch subset when the canonical full storyboard exactly matches its target', async () => {
      const harness = await createCatalogHarness();
      const targeted = await harness.service.updateProject({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        targetDurationSeconds: 15,
      });
      const opening = await harness.service.updateScene({
        projectId: targeted.id,
        expectedRevision: targeted.revision,
        sceneId: 'scene_1',
        scene: makeScene('scene_1', 10),
      });
      const fullCut = await harness.service.updateScene({
        projectId: opening.id,
        expectedRevision: opening.revision,
        sceneId: 'scene_2',
        scene: makeScene('scene_2', 5),
      });
      const catalog = await harness.service.listRoutes({ projectId: fullCut.id });
      const route = catalog.video.options[0]!;

      await harness.service.submitScenes({
        projectId: fullCut.id,
        expectedRevision: fullCut.revision,
        mode: 'batch',
        sceneIds: ['scene_1'],
        routes: [{ sceneId: 'scene_1', choiceId: route.choiceId, kind: 'video' }],
        catalogVersion: catalog.catalogVersion,
      });

      expect(harness.submitScenes).toHaveBeenCalledOnce();
    });

    it('permits a mismatched single-scene regeneration and omits mode from the resolved provider request', async () => {
      const harness = await createCatalogHarness();
      const edited = await harness.service.updateScene({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneId: 'scene_1',
        scene: makeScene('scene_1', 4),
      });
      const catalog = await harness.service.listRoutes({ projectId: edited.id });
      const route = catalog.video.options[0]!;

      await harness.service.submitScenes({
        projectId: edited.id,
        expectedRevision: edited.revision,
        mode: 'single',
        sceneIds: ['scene_1'],
        routes: [{ sceneId: 'scene_1', choiceId: route.choiceId, kind: 'video' }],
        catalogVersion: catalog.catalogVersion,
      });

      expect(harness.submitScenes).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: edited.id,
          sceneIds: ['scene_1'],
        })
      );
      expect(harness.submitScenes.mock.calls[0]?.[0]).not.toHaveProperty('mode');
    });

    it('forwards the reference output role and prompt to the job manager', async () => {
      const harness = await createVideoSubmissionHarness();
      const catalog = await harness.service.listRoutes({ projectId: harness.project.id });
      const imageChoice = catalog.image.options[0]!;

      await harness.service.submitScenes({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        mode: 'single',
        sceneIds: ['scene_1'],
        routes: [{ sceneId: 'scene_1', choiceId: imageChoice.choiceId, kind: 'image' }],
        catalogVersion: catalog.catalogVersion,
        outputRole: 'reference',
        referencePrompts: [{ sceneId: 'scene_1', prompt: 'A calm establishing plate' }],
      });

      expect(harness.submitScenes).toHaveBeenCalledOnce();
      expect(harness.submitScenes.mock.calls[0]?.[0]).toMatchObject({
        outputRole: 'reference',
        referencePrompts: [{ sceneId: 'scene_1', prompt: 'A calm establishing plate' }],
        routes: [
          {
            sceneId: 'scene_1',
            providerId: 'provider_1',
            adapterId: 'weprompt-image-v1',
            model: 'image-model',
            kind: 'image',
          },
        ],
      });
    });

    it('omits both reference fields from an ordinary take submission', async () => {
      const harness = await createVideoSubmissionHarness();

      await harness.submit('single');

      expect(harness.submitScenes).toHaveBeenCalledOnce();
      expect(harness.submitScenes.mock.calls[0]?.[0]).not.toHaveProperty('outputRole');
      expect(harness.submitScenes.mock.calls[0]?.[0]).not.toHaveProperty('referencePrompts');
    });

    it('rejects a take whose route kind differs from the scene before reaching the job manager', async () => {
      const harness = await createVideoSubmissionHarness();
      const catalog = await harness.service.listRoutes({ projectId: harness.project.id });
      const imageChoice = catalog.image.options[0]!;

      await expect(
        harness.service.submitScenes({
          projectId: harness.project.id,
          expectedRevision: harness.project.revision,
          mode: 'single',
          sceneIds: ['scene_1'],
          routes: [{ sceneId: 'scene_1', choiceId: imageChoice.choiceId, kind: 'image' }],
          catalogVersion: catalog.catalogVersion,
        })
      ).rejects.toMatchObject({ code: 'invalid_route' });
      expect(harness.submitScenes).not.toHaveBeenCalled();
    });

    it('rejects a single-mode request that includes multiple scenes before resolving provider routes', async () => {
      const harness = await createCatalogHarness();
      const opening = await harness.service.updateScene({
        projectId: harness.project.id,
        expectedRevision: harness.project.revision,
        sceneId: 'scene_1',
        scene: makeScene('scene_1', 4),
      });
      const project = await harness.service.updateScene({
        projectId: opening.id,
        expectedRevision: opening.revision,
        sceneId: 'scene_2',
        scene: makeScene('scene_2', 4),
      });
      const catalog = await harness.service.listRoutes({ projectId: project.id });
      const route = catalog.video.options[0]!;

      await expect(
        harness.service.submitScenes({
          projectId: project.id,
          expectedRevision: project.revision,
          mode: 'single',
          sceneIds: ['scene_1', 'scene_2'],
          routes: [
            { sceneId: 'scene_1', choiceId: route.choiceId, kind: 'video' },
            { sceneId: 'scene_2', choiceId: route.choiceId, kind: 'video' },
          ],
          catalogVersion: catalog.catalogVersion,
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
      expect(harness.submitScenes).not.toHaveBeenCalled();
    });

    it('drafts with the canonical stored storyboard model only', async () => {
      const harness = await createCatalogHarness();
      const selectedProject = await harness.store.updateProject(harness.project.id, (current) => ({
        ...current,
        routing: {
          ...current.routing,
          storyboard: { providerId: 'provider_1', model: 'gpt-4o' },
        },
      }));

      await harness.service.proposeStoryboard({
        projectId: harness.project.id,
        expectedRevision: selectedProject.revision,
        replaceExisting: false,
      });

      expect(harness.draft).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: harness.project.id,
          projectRevision: selectedProject.revision,
        }),
        { providerId: 'provider_1', model: 'gpt-4o' }
      );
    });

    it('does not call a provider when the stored storyboard selection is absent', async () => {
      const harness = await createCatalogHarness();

      await expect(
        harness.service.proposeStoryboard({
          projectId: harness.project.id,
          expectedRevision: harness.project.revision,
          replaceExisting: false,
        })
      ).rejects.toMatchObject({ code: 'planning_unavailable' });
      expect(harness.draft).not.toHaveBeenCalled();
    });
  });
});

describe('Studio MCP server', () => {
  it('registers the reference request tool with the approval-before-spend instruction', () => {
    const tool = vi.fn();

    registerStudioTools({ tool: tool as never }, null);

    const registration = tool.mock.calls.find(([name]) => name === 'studio_request_reference_images');
    expect(tool).toHaveBeenCalledTimes(4);
    expect(registration?.[1]).toBe(
      'Request a supporting reference image for one or more scenes. This does NOT generate anything — it queues a request the user approves before any money is spent. One image per scene; do not request a scene that already has one unless the user asked you to replace it.'
    );
  });

  it('exposes the route catalog with constraints and never mutates the project', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    const projectFile = path.join(dir, 'project.json');
    await writeFile(projectFile, JSON.stringify(studioServerProjectFixture));
    const catalog: StudioRouteCatalog = {
      storyboard: { status: 'ready', selected: null, options: [] },
      image: {
        status: 'ready',
        selected: null,
        selectedRoute: null,
        options: [routeOption('image', { model: 'image-model' })],
      },
      video: {
        status: 'ready',
        selected: null,
        selectedRoute: null,
        options: [routeOption('video', { model: 'video-model' })],
      },
      catalogVersion: 'catalog-v1',
    };
    const before = await readFile(projectFile);

    const result = await createListRoutesHandler({
      projectId: 'project_1',
      projectDir: dir,
      pendingDir: '',
      referencePendingDir: '',
      routeCatalog: catalog,
    })({});
    const parsed = JSON.parse(result.content[0].text) as StudioRouteCatalog;

    expect(parsed.image.options[0]).toMatchObject({ model: expect.any(String), health: expect.any(String) });
    expect(parsed.video.options[0]?.constraints).toMatchObject({
      minDurationSeconds: expect.any(Number),
      maxDurationSeconds: expect.any(Number),
      supportsFirstFrame: expect.any(Boolean),
    });
    expect(await readFile(projectFile)).toEqual(before);
  });

  it.each([
    { omitted: STUDIO_ENV.projectId, expected: null },
    { omitted: STUDIO_ENV.projectDir, expected: null },
    { omitted: STUDIO_ENV.pendingDir, expected: null },
    {
      omitted: STUDIO_ENV.referencePendingDir,
      expected: path.join('/tmp/p', 'reference-requests', 'pending'),
    },
  ])('degrades safely when $omitted is absent from a frozen descriptor', ({ omitted, expected }) => {
    const routeCatalog: StudioRouteCatalog = {
      storyboard: { status: 'setup_required', selected: null, options: [] },
      image: { status: 'setup_required', selected: null, selectedRoute: null, options: [] },
      video: { status: 'setup_required', selected: null, selectedRoute: null, options: [] },
      catalogVersion: 'catalog-v1',
    };
    const env = Object.fromEntries(
      Object.entries({
        [STUDIO_ENV.projectId]: 'project_1',
        [STUDIO_ENV.projectDir]: '/tmp/p',
        [STUDIO_ENV.pendingDir]: '/tmp/p/proposals/pending',
        [STUDIO_ENV.referencePendingDir]: '/tmp/p/reference-requests/pending',
        [STUDIO_ENV.routeCatalog]: JSON.stringify(routeCatalog),
      }).filter(([key]) => key !== omitted)
    );

    const parsed = parseStudioServerEnv(env);
    if (expected === null) expect(parsed).toBeNull();
    else expect(parsed).toMatchObject({ referencePendingDir: expected });
  });

  it('queues a reference request without spending', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    const store = createCreativeStudioStore({ rootDir, createId: () => 'project_1' });
    const created = await store.createProject(makeInput());
    await store.updateProject(created.id, (project) => ({
      ...project,
      sceneOrder: ['scene_1', 'scene_2'],
      scenes: Object.fromEntries(
        ['scene_1', 'scene_2'].map((sceneId) => [
          sceneId,
          {
            id: sceneId,
            ...makeScene(sceneId),
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'draft' as const,
          },
        ])
      ),
    }));
    const paths = await store.resolveProposalPaths(created.id);

    const result = await createRequestReferenceImagesHandler({
      projectId: created.id,
      projectDir: paths.projectDir,
      pendingDir: paths.pendingDir,
      referencePendingDir: paths.referencePendingDir,
    })({ sceneIds: ['scene_1', 'scene_2'] });

    expect(result.content[0].text).toContain('2 of 2');
    expect(await store.listPendingReferenceRequests(created.id)).toHaveLength(2);
    const project = JSON.parse(await readFile(path.join(paths.projectDir, 'project.json'), 'utf8')) as StudioProject;
    expect(project.jobs).toEqual({});
    expect(project.assets).toEqual({});
  });

  it('reports the successful and failed scenes when a reference-request batch is partially written', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    const store = createCreativeStudioStore({ rootDir, createId: () => 'project_1' });
    const created = await store.createProject(makeInput());
    await store.updateProject(created.id, (project) => ({
      ...project,
      sceneOrder: ['scene_1', 'scene_2', 'scene_3'],
      scenes: Object.fromEntries(
        ['scene_1', 'scene_2', 'scene_3'].map((sceneId) => [
          sceneId,
          {
            id: sceneId,
            ...makeScene(sceneId),
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'draft' as const,
          },
        ])
      ),
    }));
    const paths = await store.resolveProposalPaths(created.id);
    const writeReferenceRequestRecord = referenceRequestWriter.writeReferenceRequestRecord;
    vi.spyOn(referenceRequestWriter, 'writeReferenceRequestRecord').mockImplementation(async (input) => {
      if (input.sceneId === 'scene_2') throw new Error('disk full');
      return writeReferenceRequestRecord(input);
    });

    const result = await createRequestReferenceImagesHandler({
      projectId: created.id,
      projectDir: paths.projectDir,
      pendingDir: paths.pendingDir,
      referencePendingDir: paths.referencePendingDir,
    })({ sceneIds: ['scene_1', 'scene_2', 'scene_3'] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Queued 2 of 3');
    expect(result.content[0].text).toContain('scene_2 failed: disk full');
    expect((await store.listPendingReferenceRequests(created.id)).map((request) => request.sceneId).toSorted()).toEqual(
      ['scene_1', 'scene_3']
    );
  });

  it('reports a scene as already queued instead of writing it twice across calls', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    const store = createCreativeStudioStore({ rootDir, createId: () => 'project_1' });
    const created = await store.createProject(makeInput());
    await store.updateProject(created.id, (project) => ({
      ...project,
      sceneOrder: ['scene_1'],
      scenes: {
        scene_1: {
          id: 'scene_1',
          ...makeScene('scene_1'),
          selectedAssetId: null,
          assetIds: [],
          jobIds: [],
          reviewState: 'draft' as const,
        },
      },
    }));
    const paths = await store.resolveProposalPaths(created.id);
    const handler = createRequestReferenceImagesHandler({
      projectId: created.id,
      projectDir: paths.projectDir,
      pendingDir: paths.pendingDir,
      referencePendingDir: paths.referencePendingDir,
    });

    await handler({ sceneIds: ['scene_1'] });
    const repeated = await handler({ sceneIds: ['scene_1'] });

    expect(repeated.content[0].text).toContain('Already queued: scene_1');
    await expect(store.listPendingReferenceRequests(created.id)).resolves.toHaveLength(1);
  });

  it('names every unknown scene in one response', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    await writeFile(path.join(dir, 'project.json'), JSON.stringify(studioServerProjectFixture));

    const result = await createRequestReferenceImagesHandler({
      projectId: 'project_1',
      projectDir: dir,
      pendingDir: path.join(dir, 'proposals', 'pending'),
      referencePendingDir: path.join(dir, 'reference-requests', 'pending'),
    })({ sceneIds: ['nope', 'also_missing'] });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown scenes: nope, also_missing');
  });

  it.each([
    { sceneIds: null as unknown as string[], message: 'sceneIds must be an array.' },
    { sceneIds: [], message: 'At least one scene id is required.' },
    {
      sceneIds: Array.from({ length: 25 }, (_, index) => `scene_${index}`),
      message: 'At most 24 scene ids may be requested at once.',
    },
    { sceneIds: ['unsafe/id'], message: 'Invalid scene ids: unsafe/id' },
    { sceneIds: ['scene_1', 'scene_1'], message: 'Duplicate scene ids: scene_1' },
  ])('explains an invalid reference request selection: $message', async ({ sceneIds, message }) => {
    const result = await createRequestReferenceImagesHandler({
      projectId: 'project_1',
      projectDir: '',
      pendingDir: '',
      referencePendingDir: '',
    })({ sceneIds });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(message);
  });

  it('read_storyboard returns revision, settings and scenes without operational state', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    await writeFile(path.join(dir, 'project.json'), JSON.stringify(studioServerProjectFixture));
    const handler = createReadStoryboardHandler({
      projectId: 'project_1',
      projectDir: dir,
      pendingDir: '',
      referencePendingDir: '',
    });

    const result = await handler({});
    const text = result.content[0].text;
    expect(text).toContain('"revision": 7');
    expect(text).toContain('Sunrise');
    expect(text).not.toContain('jobIds');
  });

  it('propose_storyboard writes a record and reports recorded but never accepted', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    await writeFile(path.join(dir, 'project.json'), JSON.stringify(studioServerProjectFixture));
    const pendingDir = path.join(dir, 'proposals', 'pending');
    await mkdir(pendingDir, { recursive: true });
    await mkdir(path.join(dir, 'proposals', 'slots'), { recursive: true });
    const handler = createProposeStoryboardHandler({
      projectId: 'project_1',
      projectDir: dir,
      pendingDir,
      referencePendingDir: '',
    });

    const result = await handler({
      base_revision: 7,
      scene_order: ['scene_1'],
      scenes: {
        scene_1: {
          title: 'Sunrise over the terraces',
          purpose: 'Origin',
          visualPrompt: 'Golden hour terraces',
          narration: 'It starts at 1,600 meters.',
          onScreenText: '',
          mediaKind: 'image',
          durationSeconds: 5,
          referenceAssetId: null,
        },
      },
    });

    const text = result.content[0].text;
    expect(text).toContain('recorded');
    expect(text).not.toMatch(/accepted|applied/i);
  });

  it('propose_storyboard fails typed when base_revision differs from the project file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    await writeFile(path.join(dir, 'project.json'), JSON.stringify(studioServerProjectFixture));
    const pendingDir = path.join(dir, 'proposals', 'pending');
    await mkdir(pendingDir, { recursive: true });
    const handler = createProposeStoryboardHandler({
      projectId: 'project_1',
      projectDir: dir,
      pendingDir,
      referencePendingDir: '',
    });

    const result = await handler({
      base_revision: 3,
      scene_order: ['scene_1'],
      scenes: {
        scene_1: {
          title: 'Sunrise',
          purpose: '',
          visualPrompt: '',
          narration: '',
          onScreenText: '',
          mediaKind: 'image',
          durationSeconds: 5,
          referenceAssetId: null,
        },
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('read_storyboard');
  });

  it('leaves project.json byte-unchanged across every tool call', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    const projectFile = path.join(dir, 'project.json');
    await writeFile(projectFile, JSON.stringify(studioServerProjectFixture));
    const pendingDir = path.join(dir, 'proposals', 'pending');
    const referencePendingDir = path.join(dir, 'reference-requests', 'pending');
    await mkdir(pendingDir, { recursive: true });
    await mkdir(path.join(dir, 'proposals', 'slots'), { recursive: true });
    await mkdir(referencePendingDir, { recursive: true });
    await mkdir(path.join(dir, 'reference-requests', 'slots'), { recursive: true });
    const before = await readFile(projectFile, 'utf8');
    const env = { projectId: 'project_1', projectDir: dir, pendingDir, referencePendingDir };

    await createReadStoryboardHandler(env)({});
    await createProposeStoryboardHandler(env)({
      base_revision: 7,
      scene_order: ['scene_1'],
      scenes: {
        scene_1: {
          title: 'x',
          purpose: '',
          visualPrompt: '',
          narration: '',
          onScreenText: '',
          mediaKind: 'image',
          durationSeconds: 5,
          referenceAssetId: null,
        },
      },
    });
    await createRequestReferenceImagesHandler(env)({ sceneIds: ['scene_1'] });

    expect(await readFile(projectFile, 'utf8')).toBe(before);
  });
});
