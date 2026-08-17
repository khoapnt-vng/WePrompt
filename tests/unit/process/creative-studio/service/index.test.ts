/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { promises as nodeFs } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  type CreateStudioProjectInput,
  type CreateStudioProjectInputV2,
  type StudioAsset,
  type StudioAssetV2,
  type StudioCut,
  type StudioEditableCut,
  type StudioEditableScene,
  type StudioJob,
  type StudioJobV2,
  type StudioProject,
  type StudioProjectV2,
  type StudioRendererProject,
  type StudioRouteCatalog,
  type StudioRouteCatalogEntry,
  type StudioScene,
  type StudioSetBriefRulesRequest,
  type StudioTextModelOption,
  type StudioUpdateModelSelectionRequest,
} from '@/common/types/project/creativeStudioTypes';
import type { StudioBriefRule, StudioBriefRuleDraft } from '@/common/types/project/creativeStudioRules';
import { STUDIO_ENV } from '@/common/types/project/creativeStudioMcpEnv';
import type { IProvider } from '@/common/config/storage';
import type { GenerationProviderAdapter } from '@process/services/creative-studio/adapters';
import {
  hasImageConditioningFields,
  ProviderDeadlineError,
  runWithProviderDeadline,
} from '@process/services/creative-studio/adapters/types';
import { STUDIO_E2E_BOUNDARY_SENTINELS } from '@process/services/creative-studio/adapters/e2eFakeAdapter';
import type { CreativeStudioStore, CreativeStudioStoreError } from '@process/services/creative-studio/store';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';
import {
  createCreativeStudioService,
  createCreativeStudioServiceV2,
  createStudioDirectorCommandService,
  derivePayableClipIds,
  type CreativeStudioService,
} from '@process/services/creative-studio/service';
import {
  applyStudioMutationBatchV2,
  createEmptyStudioProjectV2,
} from '@process/services/creative-studio/service/schema2';
import { createStudioMediaChoiceId } from '@process/services/creative-studio/providerResolver';
import { canCancelJob } from '@process/services/creative-studio/jobManager';
import {
  StudioStoryboardPlannerError,
  type StudioStoryboardPlanner,
} from '@process/services/creative-studio/planning/storyboardPlanner';
import {
  createListRoutesHandler,
  createProposeBriefRuleHandler,
  createProposeBriefRuleHandlerV2,
  createProposeStoryboardHandler,
  createProposeStoryboardHandlerV2,
  createReadStoryboardHandler,
  createReadStoryboardHandlerV2,
  createRequestReferenceImagesHandler,
  createRequestReferenceImagesHandlerV2,
  parseStudioServerEnv,
  registerStudioTools,
  registerStudioToolsV2,
  studioApplyEditsInputSchemaV2,
  studioProposeStoryboardInputSchemaV2,
  studioRequestReferenceImagesInputSchemaV2,
} from '@process/resources/builtinMcp/studioServer';
import { BUILTIN_STUDIO_NAME } from '@process/resources/builtinMcp/constants';
import * as referenceRequestWriter from '@process/resources/builtinMcp/studioReferenceRequestWriter';
import { writeProposalRecordV2 } from '@process/resources/builtinMcp/studioProposalWriter';
import { writePendingRecordV2 } from '@process/resources/builtinMcp/studioPendingRecordWriter';

const createStudioMcpProtocolHarness = async (
  config: Parameters<typeof registerStudioTools>[1] = null,
  writerDeps: Parameters<typeof registerStudioTools>[2] = {}
) => {
  const server = new McpServer({ name: 'studio-test', version: '1.0.0' });
  registerStudioTools(server, config, writerDeps);
  const client = new Client({ name: 'studio-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: () => server.close(),
  };
};

const createStudioMcpProtocolHarnessV2 = async (
  config: Parameters<typeof registerStudioToolsV2>[1] = null,
  writerDeps: Parameters<typeof registerStudioToolsV2>[2] = {}
) => {
  const server = new McpServer({ name: 'studio-v2-test', version: '2.0.0' });
  registerStudioToolsV2(server, config, writerDeps);
  const client = new Client({ name: 'studio-v2-test-client', version: '2.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: () => server.close(),
  };
};

const makeInput = (overrides: Partial<CreateStudioProjectInput> = {}): CreateStudioProjectInput => ({
  name: 'Launch film',
  brief: 'A short launch story',
  aspectRatio: '16:9',
  targetDurationSeconds: 12,
  resolution: '1080p',
  ...overrides,
});

type RuleContractVerdict = 'accept' | 'reject';

type RuleContractCase = {
  name: string;
  storedRules: StudioBriefRule[];
  serviceRules: StudioBriefRuleDraft[];
  mcpInput: Record<string, unknown>;
  mcpProjectRules?: StudioBriefRule[];
  expected: {
    store: RuleContractVerdict;
    service: RuleContractVerdict;
    mcpSchema: RuleContractVerdict;
    mcpHandler: RuleContractVerdict | 'not_run';
  };
  expectedStoreError?: string;
  expectedServiceError?: string;
  expectedMcpSchemaIssue?: string;
  expectedMcpHandlerError?: string;
  expectedTerms?: {
    store: string[];
    service: string[];
    mcp: string[];
  };
  expectedRuleCount?: {
    store: number;
    service: number;
    mcpAfterProposal: number;
  };
  expectedText?: string;
  expectedServiceScope?: StudioBriefRule['scope'];
  expectedMcpPredicate?: StudioBriefRule['predicate'];
};

const contractStoredRule = (overrides: Partial<StudioBriefRule> = {}): StudioBriefRule => ({
  id: 'rule_1',
  scope: 'project',
  text: 'Keep the kits generic.',
  predicate: null,
  createdAt: '2026-08-13T00:00:00.000Z',
  ...overrides,
});

const contractDraftRule = (overrides: Partial<StudioBriefRuleDraft> = {}): StudioBriefRuleDraft => ({
  id: 'rule_1',
  text: 'Keep the kits generic.',
  predicate: null,
  ...overrides,
});

const contractMcpInput = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  base_revision: 1,
  text: 'Keep the kits generic.',
  forbidden_terms: [],
  ...overrides,
});

const maximumRuleList = (): StudioBriefRule[] =>
  Array.from({ length: 24 }, (_, index) =>
    contractStoredRule({ id: `rule_${index + 1}`, text: `Project rule ${index + 1}` })
  );

const maximumTerms = (): string[] =>
  Array.from({ length: 8 }, (_, index) => `term${index}_${String.fromCodePoint(97 + index).repeat(58)}`);

const inclusiveMaximumRuleList = (): StudioBriefRule[] => [
  contractStoredRule({
    id: 'rule_maximum',
    text: 'x'.repeat(240),
    predicate: { kind: 'forbidden_terms', terms: maximumTerms() },
  }),
  ...Array.from({ length: 23 }, (_, index) =>
    contractStoredRule({ id: `rule_filler_${index + 1}`, text: `Project rule ${index + 1}` })
  ),
];

const ruleContractCases: RuleContractCase[] = [
  {
    name: 'inclusive maxima',
    storedRules: inclusiveMaximumRuleList(),
    serviceRules: inclusiveMaximumRuleList().map(({ id, text, predicate }) => ({ id, text, predicate })),
    mcpInput: contractMcpInput({ text: 'x'.repeat(240), forbidden_terms: maximumTerms() }),
    mcpProjectRules: maximumRuleList().slice(0, 23),
    expected: { store: 'accept', service: 'accept', mcpSchema: 'accept', mcpHandler: 'accept' },
    expectedTerms: { store: maximumTerms(), service: maximumTerms(), mcp: maximumTerms() },
    expectedRuleCount: { store: 24, service: 24, mcpAfterProposal: 24 },
    expectedText: 'x'.repeat(240),
  },
  {
    name: '241-character text',
    storedRules: [contractStoredRule({ text: 'x'.repeat(241) })],
    serviceRules: [contractDraftRule({ text: 'x'.repeat(241) })],
    mcpInput: contractMcpInput({ text: 'x'.repeat(241) }),
    expected: { store: 'reject', service: 'reject', mcpSchema: 'reject', mcpHandler: 'not_run' },
    expectedStoreError: 'Invalid Studio project payload',
    expectedServiceError: 'Invalid Studio rule text',
    expectedMcpSchemaIssue: 'too_big',
  },
  {
    name: 'ninth term',
    storedRules: [
      contractStoredRule({
        predicate: { kind: 'forbidden_terms', terms: Array.from({ length: 9 }, (_, index) => `term_${index}`) },
      }),
    ],
    serviceRules: [
      contractDraftRule({
        predicate: { kind: 'forbidden_terms', terms: Array.from({ length: 9 }, (_, index) => `term_${index}`) },
      }),
    ],
    mcpInput: contractMcpInput({ forbidden_terms: Array.from({ length: 9 }, (_, index) => `term_${index}`) }),
    expected: { store: 'reject', service: 'reject', mcpSchema: 'reject', mcpHandler: 'not_run' },
    expectedStoreError: 'Invalid Studio project payload',
    expectedServiceError: 'Invalid Studio rule predicate',
    expectedMcpSchemaIssue: 'too_big',
  },
  {
    name: '65-character term',
    storedRules: [contractStoredRule({ predicate: { kind: 'forbidden_terms', terms: ['x'.repeat(65)] } })],
    serviceRules: [contractDraftRule({ predicate: { kind: 'forbidden_terms', terms: ['x'.repeat(65)] } })],
    mcpInput: contractMcpInput({ forbidden_terms: ['x'.repeat(65)] }),
    expected: { store: 'reject', service: 'reject', mcpSchema: 'reject', mcpHandler: 'not_run' },
    expectedStoreError: 'Invalid Studio project payload',
    expectedServiceError: 'Invalid Studio rule term',
    expectedMcpSchemaIssue: 'too_big',
  },
  {
    name: '25th rule',
    storedRules: [...maximumRuleList(), contractStoredRule({ id: 'rule_25', text: 'Project rule 25' })],
    serviceRules: Array.from({ length: 25 }, (_, index) =>
      contractDraftRule({ id: `rule_${index + 1}`, text: `Project rule ${index + 1}` })
    ),
    mcpInput: contractMcpInput(),
    mcpProjectRules: maximumRuleList(),
    expected: { store: 'reject', service: 'reject', mcpSchema: 'accept', mcpHandler: 'reject' },
    expectedStoreError: 'Invalid Studio project payload',
    expectedServiceError: 'Invalid Studio rule list',
    expectedMcpHandlerError: 'maximum of 24 rules',
    // The registered schema cannot know project state; the handler owns the existing-rule count check.
  },
  {
    name: 'duplicate rule ids',
    storedRules: [contractStoredRule(), contractStoredRule({ text: 'Keep logos abstract.' })],
    serviceRules: [contractDraftRule(), contractDraftRule({ text: 'Keep logos abstract.' })],
    mcpInput: contractMcpInput(),
    expected: { store: 'reject', service: 'reject', mcpSchema: 'accept', mcpHandler: 'accept' },
    expectedStoreError: 'Invalid Studio project payload',
    expectedServiceError: 'Invalid Studio rule list',
    // MCP proposes one rule at a time and mints proposal ids itself, so a caller cannot supply duplicate rule ids.
  },
  {
    name: 'Nike and Nike! duplicate-equivalent terms',
    storedRules: [contractStoredRule({ predicate: { kind: 'forbidden_terms', terms: ['Nike', 'Nike!'] } })],
    serviceRules: [contractDraftRule({ predicate: { kind: 'forbidden_terms', terms: ['Nike', 'Nike!'] } })],
    mcpInput: contractMcpInput({ forbidden_terms: ['Nike', 'Nike!'] }),
    expected: { store: 'accept', service: 'accept', mcpSchema: 'accept', mcpHandler: 'accept' },
    expectedTerms: { store: ['Nike', 'Nike!'], service: ['Nike'], mcp: ['Nike', 'Nike!'] },
    // Store and MCP preserve distinct user spellings; the accepting service is the canonicalisation boundary.
  },
  ...['+++', '®', '😀'].map(
    (term): RuleContractCase => ({
      name: `tokenless term ${term}`,
      storedRules: [contractStoredRule({ predicate: { kind: 'forbidden_terms', terms: [term] } })],
      serviceRules: [contractDraftRule({ predicate: { kind: 'forbidden_terms', terms: [term] } })],
      mcpInput: contractMcpInput({ forbidden_terms: [term] }),
      expected: { store: 'reject', service: 'reject', mcpSchema: 'accept', mcpHandler: 'reject' },
      expectedStoreError: 'Invalid Studio project payload',
      expectedServiceError: 'Invalid Studio rule predicate',
      expectedMcpHandlerError: `unenforceable term: "${term}"`,
      // Token enforceability is semantic, so the registered shape admits it and the handler returns the real refusal.
    })
  ),
  {
    name: 'empty term list',
    storedRules: [contractStoredRule({ predicate: { kind: 'forbidden_terms', terms: [] } })],
    serviceRules: [contractDraftRule({ predicate: { kind: 'forbidden_terms', terms: [] } })],
    mcpInput: contractMcpInput({ forbidden_terms: [] }),
    expected: { store: 'reject', service: 'reject', mcpSchema: 'accept', mcpHandler: 'accept' },
    expectedStoreError: 'Invalid Studio project payload',
    expectedServiceError: 'Invalid Studio rule predicate',
    expectedMcpPredicate: null,
    // Empty forbidden_terms is the MCP representation of a context-only rule, not an empty predicate.
  },
  {
    name: 'predicate null',
    storedRules: [contractStoredRule({ predicate: null })],
    serviceRules: [contractDraftRule({ predicate: null })],
    mcpInput: contractMcpInput({ forbidden_terms: [] }),
    expected: { store: 'accept', service: 'accept', mcpSchema: 'accept', mcpHandler: 'accept' },
    expectedMcpPredicate: null,
  },
  {
    name: 'organisation scope',
    storedRules: [contractStoredRule({ scope: 'organisation' })],
    serviceRules: [{ ...contractDraftRule(), scope: 'organisation' } as StudioBriefRuleDraft],
    mcpInput: contractMcpInput({ scope: 'organisation' }),
    expected: { store: 'reject', service: 'accept', mcpSchema: 'accept', mcpHandler: 'accept' },
    expectedStoreError: 'Invalid Studio project payload',
    expectedServiceScope: 'project',
    // Organisation rules are code-resident; service and MCP deliberately discard caller scope and mint project scope.
  },
];

type RuleContractOutcome = { verdict: 'accept'; error?: never } | { verdict: 'reject'; error: unknown };

const settleRuleContract = async (operation: () => Promise<unknown>): Promise<RuleContractOutcome> => {
  try {
    await operation();
    return { verdict: 'accept' };
  } catch (error) {
    return { verdict: 'reject', error };
  }
};

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
  rules: [],
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
      adapterId: 'weprompt-image-v1' | 'byteplus-seedance-v1' | 'weprompt-media-gateway-v1' | 'openrouter-video-v1';
      cancellationPolicy: 'none' | 'queued_only' | 'queued_and_running';
    }
  > = {}
): StudioRouteCatalogEntry & {
  adapterId: 'weprompt-image-v1' | 'byteplus-seedance-v1' | 'weprompt-media-gateway-v1' | 'openrouter-video-v1';
  cancellationPolicy: 'none' | 'queued_only' | 'queued_and_running';
} => {
  const route = {
    providerId: 'provider_1',
    providerName: 'Provider One',
    adapterId: kind === 'image' ? ('weprompt-image-v1' as const) : ('weprompt-media-gateway-v1' as const),
    model: `${kind}-model`,
    integrationLabelKey:
      kind === 'image'
        ? ('imageApi' as const)
        : overrides.adapterId === 'byteplus-seedance-v1'
          ? ('bytePlusSeedance' as const)
          : overrides.adapterId === 'openrouter-video-v1'
            ? ('openRouterVideo' as const)
            : ('selfHostedVideoGateway' as const),
    health: 'available' as const,
    kind,
    cancellationPolicy: 'none' as const,
    constraints: {
      aspectRatios: ['16:9'],
      resolutions: ['1080p'],
      minDurationSeconds: 1,
      maxDurationSeconds: 12,
      supportsFirstFrame: true,
      maxConditioningImages: 0,
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
const IMAGE_INTEGRATION_ID = 'integration_g7Q2mB4p';
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

  it('rejects a checked reference-request consume when the queued id maps to another scene', async () => {
    const created = await service.createProject(makeInput());
    const project = await store.updateProject(created.id, (current) => ({
      ...current,
      sceneOrder: ['scene_1'],
      scenes: {
        scene_1: {
          id: 'scene_1',
          ...makeScene('scene_1'),
          selectedAssetId: null,
          assetIds: [],
          jobIds: [],
          reviewState: 'draft',
        },
      },
    }));
    const paths = await store.resolveProposalPaths(project.id);
    const request = await referenceRequestWriter.writeReferenceRequestRecord({
      pendingDir: paths.referencePendingDir,
      projectId: project.id,
      sceneId: 'scene_1',
      requestId: 'request_checked',
    });

    await expect(
      service.dismissReferenceRequests({
        projectId: project.id,
        requestIds: [request.id],
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(
      service.dismissReferenceRequests({
        projectId: project.id,
        requestIds: [request.id],
        expectedRequests: [{ id: request.id, sceneId: request.sceneId }],
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    await expect(
      service.dismissReferenceRequests({
        projectId: project.id,
        requestIds: [request.id],
        expectedRevision: project.revision,
        expectedRequests: [{ id: request.id, sceneId: 'scene_2' }],
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    await expect(store.listPendingReferenceRequests(project.id)).resolves.toMatchObject([
      { id: request.id, sceneId: request.sceneId },
    ]);
  });

  it('opens a project written before rules existed, and the first rule write rewrites the record', async () => {
    const project = await service.createProject(makeInput());
    const file = path.join(rootDir, project.id, 'project.json');
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    delete raw.rules;
    delete raw.ruleListUndo;
    await writeFile(file, JSON.stringify(raw), 'utf8');

    const reopened = await service.getProject(project.id);
    expect(reopened?.rules).toEqual([]);
    expect(reopened?.ruleListUndo).toBeNull();
    expect(await store.listQuarantinedProjectIds()).toEqual([]);

    const written = await service.setBriefRules({
      projectId: project.id,
      expectedRevision: reopened!.revision,
      rules: [{ id: 'rule_1', text: 'Keep the kits generic.', predicate: null }],
    });
    const persisted = JSON.parse(await readFile(file, 'utf8')) as {
      rules: unknown[];
      revision: number;
      ruleListUndo: unknown;
    };

    expect(persisted.rules).toHaveLength(1);
    expect(persisted.revision).toBe(written.revision);
    expect(persisted.ruleListUndo).toEqual({ capturedRevision: reopened!.revision, previousRules: [] });
  });

  it('replaces the rule list, stamps project scope, and preserves createdAt for a rule that stays', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime('2026-08-13T00:00:00.000Z');
      const project = await service.createProject(makeInput());

      const first = await service.setBriefRules({
        projectId: project.id,
        expectedRevision: project.revision,
        rules: [{ id: 'rule_1', text: '  Keep the kits generic.  ', predicate: null }],
      });

      vi.setSystemTime('2026-08-13T00:01:00.000Z');
      const second = await service.setBriefRules({
        projectId: project.id,
        expectedRevision: first.revision,
        rules: [
          { id: 'rule_1', text: 'Keep the kits generic.', predicate: null },
          { id: 'rule_2', text: 'No competitor logos.', predicate: { kind: 'forbidden_terms', terms: ['acme'] } },
        ],
      });

      expect(second.rules).toEqual([
        {
          id: 'rule_1',
          scope: 'project',
          text: 'Keep the kits generic.',
          predicate: null,
          createdAt: '2026-08-13T00:00:00.000Z',
        },
        {
          id: 'rule_2',
          scope: 'project',
          text: 'No competitor logos.',
          predicate: { kind: 'forbidden_terms', terms: ['acme'] },
          createdAt: '2026-08-13T00:01:00.000Z',
        },
      ]);
      expect(second.ruleListUndo).toEqual({
        capturedRevision: first.revision,
        previousRules: first.rules,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('undoes the latest rule-list write after unrelated project changes by reading a fresh revision', async () => {
    const project = await service.createProject(makeInput());
    const ruled = await service.setBriefRules({
      projectId: project.id,
      expectedRevision: project.revision,
      rules: [{ id: 'rule_1', text: 'Keep the kits generic.', predicate: null }],
    });
    const renamed = await service.updateProject({
      projectId: project.id,
      expectedRevision: ruled.revision,
      name: 'Renamed after the rule write',
    });

    const undone = await service.undoBriefRules({ projectId: project.id });

    expect(undone.revision).toBe(renamed.revision + 1);
    expect(undone.name).toBe('Renamed after the rule write');
    expect(undone.rules).toEqual([]);
    expect(undone.ruleListUndo).toBeNull();
  });

  it('keeps Director edits outside rule undo and leaves notification to the later receipt owner', async () => {
    const created = await service.createProject(makeInput());
    const ruled = await service.setBriefRules({
      projectId: created.id,
      expectedRevision: created.revision,
      rules: [{ id: 'rule_1', text: 'Keep the kits generic.', predicate: null }],
    });
    const seeded = await store.updateProject(
      ruled.id,
      (current) => {
        const next = structuredClone(current);
        next.sceneOrder = ['scene_1', 'scene_2'];
        next.scenes = {
          scene_1: {
            id: 'scene_1',
            ...makeScene('scene_1'),
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'ready',
          },
          scene_2: {
            id: 'scene_2',
            ...makeScene('scene_2'),
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'ready',
          },
        };
        addTake(next, 'scene_1', 'take_1', 4, false);
        return next;
      },
      ruled.revision
    );
    const director = createStudioDirectorCommandService({
      store,
      now: () => Date.parse('2026-08-17T00:00:00.000Z'),
    });
    const submitScenes = vi.spyOn(service, 'submitScenes');
    const retryJob = vi.spyOn(service, 'retryJob');
    onProjectUpdated.mockClear();

    const applied = await director.apply(
      {
        schemaVersion: 1,
        commandId: 'command_rule_undo',
        projectId: seeded.id,
        expectedRevision: seeded.revision,
        createdAt: '2026-08-17T00:00:00.000Z',
        deadlineAt: '2026-08-17T00:00:15.000Z',
        policy: 'auto_apply',
        operations: [
          { kind: 'set_brief', brief: 'Director brief survives rule undo' },
          { kind: 'edit_scene', sceneId: 'scene_2', changes: { title: 'Director scene survives' } },
          { kind: 'reorder_scenes', sceneOrder: ['scene_2', 'scene_1'] },
          { kind: 'select_take', sceneId: 'scene_1', assetId: 'take_1' },
        ],
      },
      Date.parse('2026-08-17T00:00:13.000Z'),
      { commitTag: 'command_rule_undo' }
    );

    expect(applied.project.ruleListUndo).toEqual(seeded.ruleListUndo);
    expect(onProjectUpdated).not.toHaveBeenCalled();
    expect(submitScenes).not.toHaveBeenCalled();
    expect(retryJob).not.toHaveBeenCalled();

    const undone = await service.undoBriefRules({ projectId: seeded.id });

    expect(undone.rules).toEqual([]);
    expect(undone.ruleListUndo).toBeNull();
    expect(undone).toMatchObject({
      brief: 'Director brief survives rule undo',
      sceneOrder: ['scene_2', 'scene_1'],
      scenes: {
        scene_1: { selectedAssetId: 'take_1' },
        scene_2: { title: 'Director scene survives' },
      },
    });
    expect(onProjectUpdated).toHaveBeenCalledOnce();
  });

  it('refuses undo when the project changes between its fresh read and compare-and-set write', async () => {
    const project = await service.createProject(makeInput());
    const ruled = await service.setBriefRules({
      projectId: project.id,
      expectedRevision: project.revision,
      rules: [{ id: 'rule_1', text: 'Keep the kits generic.', predicate: null }],
    });
    let injectConcurrentEdit = true;
    const racingStore: CreativeStudioStore = {
      ...store,
      updateProject: async (projectId, update, expectedRevision) => {
        if (injectConcurrentEdit && projectId === project.id) {
          injectConcurrentEdit = false;
          await store.updateProject(projectId, (current) => ({ ...current, name: 'Concurrent edit' }), ruled.revision);
        }
        return store.updateProject(projectId, update, expectedRevision);
      },
    };
    const racingService = createCreativeStudioService({
      store: racingStore,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
    });

    await expect(racingService.undoBriefRules({ projectId: project.id })).rejects.toMatchObject({
      code: 'stale_project',
    } satisfies Partial<CreativeStudioStoreError>);
  });

  it('refuses undo when no rule-list write is available', async () => {
    const project = await service.createProject(makeInput());

    await expect(service.undoBriefRules({ projectId: project.id })).rejects.toMatchObject({ code: 'invalid_payload' });
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

  it('deduplicates forbidden terms that tokenise to the same match key', async () => {
    const project = await service.createProject(makeInput());

    const updated = await service.setBriefRules({
      projectId: project.id,
      expectedRevision: project.revision,
      rules: [
        {
          id: 'rule_1',
          text: 'No competitor marks.',
          predicate: {
            kind: 'forbidden_terms',
            terms: ['Nike', 'Nike!', 'Nike.', '(Nike)', 'Nike-', 'Nike,', 'Nike;', 'Nike?'],
          },
        },
      ],
    });

    expect(updated.rules[0].predicate?.terms).toEqual(['Nike']);
  });

  it('deduplicates forbidden terms within each rule rather than across the whole rule list', async () => {
    const project = await service.createProject(makeInput());

    const updated = await service.setBriefRules({
      projectId: project.id,
      expectedRevision: project.revision,
      rules: [
        {
          id: 'rule_1',
          text: 'No sportswear brands.',
          predicate: { kind: 'forbidden_terms', terms: ['Nike', 'Adidas'] },
        },
        {
          id: 'rule_2',
          text: 'No Nike marks.',
          predicate: { kind: 'forbidden_terms', terms: ['Nike'] },
        },
      ],
    });

    expect(updated.rules.map((rule) => rule.predicate?.terms)).toEqual([['Nike', 'Adidas'], ['Nike']]);
  });

  it('rejects duplicate draft rule ids before replacing the project rule list', async () => {
    const project = await service.createProject(makeInput());

    await expect(
      service.setBriefRules({
        projectId: project.id,
        expectedRevision: project.revision,
        rules: [
          { id: 'rule_1', text: 'Keep the kits generic.', predicate: null },
          { id: 'rule_1', text: 'No competitor marks.', predicate: null },
        ],
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it.each(ruleContractCases)(
    'keeps the $name verdict explicit across store, service, and MCP',
    async (contractCase) => {
      const project = await service.createProject(makeInput());
      const projectFile = path.join(rootDir, project.id, 'project.json');
      const projectBeforeStore = (await store.getProject(project.id))!;
      const manifestBeforeStore = await readFile(projectFile);
      let storedProject: StudioProject | undefined;
      const storeOutcome = await settleRuleContract(async () => {
        storedProject = await store.updateProject(
          project.id,
          (current) => ({ ...current, rules: contractCase.storedRules }),
          project.revision
        );
      });

      expect(storeOutcome.verdict).toBe(contractCase.expected.store);
      if (contractCase.expected.store === 'reject') {
        expect(storeOutcome.error).toMatchObject({
          code: 'invalid_payload',
          message: contractCase.expectedStoreError,
        });
        expect(await store.getProject(project.id)).toEqual(projectBeforeStore);
        expect(await readFile(projectFile)).toEqual(manifestBeforeStore);
      } else {
        expect(storeOutcome.error).toBeUndefined();
      }
      if (contractCase.expectedTerms !== undefined) {
        expect(storedProject?.rules[0]?.predicate?.terms).toEqual(contractCase.expectedTerms.store);
      }
      if (contractCase.expectedRuleCount !== undefined) {
        expect(storedProject?.rules).toHaveLength(contractCase.expectedRuleCount.store);
      }
      if (contractCase.expectedText !== undefined) {
        expect(storedProject?.rules[0]?.text).toBe(contractCase.expectedText);
      }

      let current = (await store.getProject(project.id))!;
      current = await store.updateProject(current.id, (value) => ({ ...value, rules: [] }), current.revision);

      const projectBeforeService = structuredClone(current);
      const manifestBeforeService = await readFile(projectFile);
      let serviceProject: StudioRendererProject | undefined;
      const serviceOutcome = await settleRuleContract(async () => {
        const request: StudioSetBriefRulesRequest = {
          projectId: current.id,
          expectedRevision: current.revision,
          rules: contractCase.serviceRules,
        };
        serviceProject = await service.setBriefRules(request);
      });

      expect(serviceOutcome.verdict).toBe(contractCase.expected.service);
      if (contractCase.expected.service === 'reject') {
        expect(serviceOutcome.error).toMatchObject({
          code: 'invalid_payload',
          message: contractCase.expectedServiceError,
        });
        expect(await store.getProject(current.id)).toEqual(projectBeforeService);
        expect(await readFile(projectFile)).toEqual(manifestBeforeService);
      } else {
        expect(serviceOutcome.error).toBeUndefined();
      }
      if (contractCase.expectedTerms !== undefined) {
        expect(serviceProject?.rules[0]?.predicate?.terms).toEqual(contractCase.expectedTerms.service);
      }
      if (contractCase.expectedRuleCount !== undefined) {
        expect(serviceProject?.rules).toHaveLength(contractCase.expectedRuleCount.service);
      }
      if (contractCase.expectedText !== undefined) {
        expect(serviceProject?.rules[0]?.text).toBe(contractCase.expectedText);
      }
      if (contractCase.expectedServiceScope !== undefined) {
        expect(serviceProject?.rules[0]?.scope).toBe(contractCase.expectedServiceScope);
      }

      current = (await store.getProject(project.id))!;
      current = await store.updateProject(
        current.id,
        (value) => ({ ...value, rules: contractCase.mcpProjectRules ?? [] }),
        current.revision
      );
      const { projectDir, pendingDir, referencePendingDir } = await store.resolveProposalPaths(current.id);
      const config = { projectId: current.id, projectDir, pendingDir, referencePendingDir };
      const tool = vi.fn();
      registerStudioTools({ tool: tool as never, registerTool: vi.fn() as never }, config);
      const registration = tool.mock.calls.find(([name]) => name === 'propose_brief_rule');
      expect(registration).toBeDefined();

      // This matches the SDK's registration path: a raw tool shape becomes one Zod object before
      // the parsed value reaches createProposeBriefRuleHandler.
      const registeredSchema = z.object(registration?.[2] as Parameters<typeof z.object>[0]);
      const schemaResult = registeredSchema.safeParse({
        ...contractCase.mcpInput,
        base_revision: current.revision,
      });
      const mcpSchemaVerdict: RuleContractVerdict = schemaResult.success ? 'accept' : 'reject';
      expect(mcpSchemaVerdict).toBe(contractCase.expected.mcpSchema);
      if (!schemaResult.success) {
        expect(schemaResult.error.issues[0]?.code).toBe(contractCase.expectedMcpSchemaIssue);
      }

      let mcpHandlerVerdict: RuleContractVerdict | 'not_run' = 'not_run';
      let mcpResult: Awaited<ReturnType<ReturnType<typeof createProposeBriefRuleHandler>>> | undefined;
      if (schemaResult.success) {
        const registeredHandler = registration?.[3] as ReturnType<typeof createProposeBriefRuleHandler> | undefined;
        expect(registeredHandler).toBeTypeOf('function');
        mcpResult = await registeredHandler!(
          schemaResult.data as Parameters<ReturnType<typeof createProposeBriefRuleHandler>>[0]
        );
        mcpHandlerVerdict = mcpResult.isError === true ? 'reject' : 'accept';
      }
      expect(mcpHandlerVerdict).toBe(contractCase.expected.mcpHandler);
      if (mcpHandlerVerdict === 'reject') {
        expect(mcpResult?.content[0]?.text).toContain(contractCase.expectedMcpHandlerError);
      }

      const proposals = await service.listProposals({ projectId: current.id });
      if (mcpHandlerVerdict === 'accept') {
        expect(proposals).toHaveLength(1);
        expect(proposals[0]?.payload.kind).toBe('pin_rule');
        if (proposals[0]?.payload.kind === 'pin_rule') {
          if (contractCase.expectedTerms !== undefined) {
            expect(proposals[0].payload.rule.predicate?.terms).toEqual(contractCase.expectedTerms.mcp);
          }
          if (contractCase.expectedMcpPredicate !== undefined) {
            expect(proposals[0].payload.rule.predicate).toEqual(contractCase.expectedMcpPredicate);
          }
          if (contractCase.expectedText !== undefined) {
            expect(proposals[0].payload.rule.text).toBe(contractCase.expectedText);
          }
          if (contractCase.expectedServiceScope !== undefined) {
            expect(proposals[0].payload.rule).not.toHaveProperty('scope');
          }
        }
        if (contractCase.expectedRuleCount !== undefined) {
          expect(current.rules.length + proposals.length).toBe(contractCase.expectedRuleCount.mcpAfterProposal);
        }
      } else {
        expect(proposals).toEqual([]);
        expect(await readdir(pendingDir)).toEqual([]);
        expect(await readdir(path.join(path.dirname(pendingDir), 'slots'))).toEqual([]);
      }
    }
  );

  it('notifies the renderer after replacing the project rule list', async () => {
    const project = await service.createProject(makeInput());
    onProjectUpdated.mockClear();

    await service.setBriefRules({
      projectId: project.id,
      expectedRevision: project.revision,
      rules: [{ id: 'rule_1', text: 'Keep the kits generic.', predicate: null }],
    });

    expect(onProjectUpdated).toHaveBeenCalledExactlyOnceWith(project.id);
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

  it('projects Brief classification and clones complete plate provenance from the exact source object', async () => {
    const project = await service.createProject(makeInput());
    await store.updateProject(project.id, (current) => {
      const next = structuredClone(current);
      next.assets.cast_1 = {
        id: 'cast_1',
        projectId: next.id,
        sceneId: null,
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'imports', fileName: 'cast_1.png' },
        byteSize: 1,
        sha256: 'c'.repeat(64),
        createdAt: next.createdAt,
        briefReferenceRole: 'cast',
        briefReferenceLabel: 'Lead Hero',
      };
      addReferencePlate(next, 'Aerial, drifting. Smoke columns.');
      Object.assign(next.assets.reference_1, {
        sourceReferenceAssetIds: ['cast_1'],
        sourceAspectRatio: '16:9',
        sourceResolution: '1080p',
      });
      return next;
    });

    const sourceProject = await store.getProject(project.id);
    expect(sourceProject).not.toBeNull();
    const stableStore: CreativeStudioStore = {
      ...store,
      getProject: vi.fn(async () => sourceProject),
    };
    const projectionService = createCreativeStudioService({
      store: stableStore,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
    });

    const rendererProject = await projectionService.getProject(project.id);
    const rendererIds = rendererProject?.assets.reference_1.sourceReferenceAssetIds;

    expect(rendererProject?.assets.cast_1).toMatchObject({
      briefReferenceRole: 'cast',
      briefReferenceLabel: 'Lead Hero',
    });
    expect(rendererProject?.assets.reference_1).toMatchObject({
      sourceVisualPrompt: 'Aerial, drifting. Smoke columns.',
      sourceReferenceAssetIds: ['cast_1'],
      sourceAspectRatio: '16:9',
      sourceResolution: '1080p',
    });
    rendererIds?.push('renderer_only');
    expect(sourceProject?.assets.reference_1.sourceReferenceAssetIds).toEqual(['cast_1']);
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
    const ensureOrder: string[] = [];
    const ensureDirectorCommandMailbox = vi.fn(async () => {
      ensureOrder.push('ensure');
    });
    const paths = await store.resolveProposalPaths(project.id);
    const resolveProposalPaths = store.resolveProposalPaths.bind(store);
    vi.spyOn(store, 'resolveProposalPaths').mockImplementation(async (projectId) => {
      ensureOrder.push('paths');
      return resolveProposalPaths(projectId);
    });
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
      ensureDirectorCommandMailbox,
    } as unknown as Parameters<typeof createCreativeStudioService>[0]);
    const routeCatalog = await descriptorService.listRoutes({ projectId: project.id });

    const descriptor = await descriptorService.getBriefSessionServer({ projectId: project.id });

    expect(descriptor).toEqual({
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
    expect(ensureDirectorCommandMailbox).toHaveBeenCalledWith(project.id);
    expect(ensureOrder).toEqual(['ensure', 'paths']);
    expect(Object.keys(descriptor.transport.env ?? {}).toSorted()).toEqual(Object.values(STUDIO_ENV).toSorted());
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

  it('forwards one classified import and returns its asset with the canonical successful project revision', async () => {
    const created = await service.createProject(makeInput());
    onProjectUpdated.mockClear();
    const canonical = await store.getProject(created.id);
    if (canonical === null) throw new Error('project fixture missing');
    const asset: StudioAsset = {
      id: 'asset_cast',
      projectId: created.id,
      sceneId: null,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'asset_cast.png' },
      byteSize: 33,
      sha256: 'a'.repeat(64),
      briefReferenceRole: 'cast',
      briefReferenceLabel: 'Lead Hero',
      createdAt: '2026-08-15T01:02:03.000Z',
    };
    const importedProject = structuredClone(canonical);
    importedProject.revision += 1;
    importedProject.assets[asset.id] = asset;
    const importReferenceFromPath = vi.fn(async () => ({ asset, project: importedProject }));
    const importService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      mediaStore: {
        importReferenceFromPath,
        detachBriefReference: vi.fn(),
        exportAssetsToDirectory: vi.fn(),
        getLatestProjectOutput: vi.fn(async () => null),
      },
    });

    await expect(
      importService.importReferenceFromPath({
        projectId: created.id,
        expectedRevision: created.revision,
        briefReferenceRole: 'cast',
        sourcePath: '/private/Lead Hero.png',
      })
    ).resolves.toMatchObject({
      asset,
      project: { id: created.id, revision: importedProject.revision, assets: { asset_cast: asset } },
    });
    expect(importReferenceFromPath).toHaveBeenCalledExactlyOnceWith({
      projectId: created.id,
      expectedRevision: created.revision,
      briefReferenceRole: 'cast',
      sourcePath: '/private/Lead Hero.png',
      returnProject: true,
    });
    expect(onProjectUpdated).toHaveBeenCalledExactlyOnceWith(created.id);
  });

  it('forwards one legacy scene import and returns the exact successful scene-linked outcome', async () => {
    const created = await service.createProject(makeInput());
    const sceneProject = await store.updateProject(
      created.id,
      (project) => ({
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
      }),
      created.revision
    );
    onProjectUpdated.mockClear();
    const asset: StudioAsset = {
      id: 'asset_scene_reference',
      projectId: created.id,
      sceneId: 'scene_1',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'asset_scene_reference.png' },
      byteSize: 33,
      sha256: 'b'.repeat(64),
      createdAt: '2026-08-15T01:02:03.000Z',
    };
    const importedProject = structuredClone(sceneProject);
    importedProject.revision += 1;
    importedProject.assets[asset.id] = asset;
    importedProject.scenes.scene_1.assetIds.push(asset.id);
    importedProject.scenes.scene_1.referenceAssetId = asset.id;
    const importReferenceFromPath = vi.fn(async () => ({ asset, project: importedProject }));
    const importService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      mediaStore: {
        importReferenceFromPath,
        detachBriefReference: vi.fn(),
        exportAssetsToDirectory: vi.fn(),
        getLatestProjectOutput: vi.fn(async () => null),
      },
    });
    const input = {
      projectId: created.id,
      sceneId: 'scene_1',
      expectedRevision: sceneProject.revision,
      sourcePath: '/private/scene-reference.png',
    };

    await expect(importService.importReferenceFromPath(input)).resolves.toEqual({
      asset,
      project: expect.objectContaining({
        assets: expect.objectContaining({ asset_scene_reference: asset }),
        scenes: expect.objectContaining({
          scene_1: expect.objectContaining({ referenceAssetId: asset.id, assetIds: [asset.id] }),
        }),
      }),
    });
    expect(importReferenceFromPath).toHaveBeenCalledExactlyOnceWith({ ...input, returnProject: true });
    expect(onProjectUpdated).toHaveBeenCalledExactlyOnceWith(created.id);
  });

  it('forwards detach once and returns the canonical successful renderer project revision', async () => {
    const created = await service.createProject(makeInput());
    onProjectUpdated.mockClear();
    const canonical = await store.getProject(created.id);
    if (canonical === null) throw new Error('project fixture missing');
    const detachedProject = { ...canonical, revision: canonical.revision + 1 };
    const detachBriefReference = vi.fn(async () => detachedProject);
    const detachService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      mediaStore: {
        importReferenceFromPath: vi.fn(),
        detachBriefReference,
        exportAssetsToDirectory: vi.fn(),
        getLatestProjectOutput: vi.fn(async () => null),
      },
    });
    const input = { projectId: created.id, assetId: 'asset_cast', expectedRevision: created.revision };

    await expect(detachService.detachBriefReference(input)).resolves.toMatchObject({
      id: created.id,
      revision: detachedProject.revision,
    });
    expect(detachBriefReference).toHaveBeenCalledExactlyOnceWith(input);
    expect(onProjectUpdated).toHaveBeenCalledExactlyOnceWith(created.id);
  });

  it.each([
    [
      'role combined with scene',
      {
        projectId: 'project_1',
        expectedRevision: 1,
        sourcePath: '/private/reference.png',
        sceneId: 'scene_1',
        briefReferenceRole: 'look',
      },
    ],
    [
      'invalid role',
      {
        projectId: 'project_1',
        expectedRevision: 1,
        sourcePath: '/private/reference.png',
        briefReferenceRole: 'subject',
      },
    ],
  ] as const)('rejects a classified import with %s before media mutation', async (_label, input) => {
    const importReferenceFromPath = vi.fn();
    const guardedService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner(),
      mediaStore: {
        importReferenceFromPath,
        detachBriefReference: vi.fn(),
        exportAssetsToDirectory: vi.fn(),
        getLatestProjectOutput: vi.fn(async () => null),
      },
    });

    await expect(guardedService.importReferenceFromPath(input as never)).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    expect(importReferenceFromPath).not.toHaveBeenCalled();
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

    it('finalizes an accepted proposal when summary repair fails after the project commit', async () => {
      const project = await service.createProject(makeInput());
      await store.recordProposal({
        projectId: project.id,
        proposalId: 'proposal_summary_repair',
        baseRevision: project.revision,
        payload,
      });
      let failSummaryRename = true;
      let projectRenameAttempts = 0;
      let summaryRenameAttempts = 0;
      const failingSummaryFs = new Proxy(nodeFs, {
        get(target, property, receiver) {
          if (property !== 'rename') return Reflect.get(target, property, receiver);
          return async (...args: Parameters<typeof nodeFs.rename>): ReturnType<typeof nodeFs.rename> => {
            const destination = String(args[1]);
            if (destination.endsWith(`${path.sep}project.json`)) projectRenameAttempts += 1;
            if (destination.endsWith(`${path.sep}projects.json`)) {
              summaryRenameAttempts += 1;
              if (failSummaryRename) {
                failSummaryRename = false;
                throw new Error('summary rename failed');
              }
            }
            return nodeFs.rename(...args);
          };
        },
      }) as typeof nodeFs;
      const repairStore = createCreativeStudioStore({
        rootDir,
        now: () => '2026-07-30T00:00:00.000Z',
        fs: failingSummaryFs,
        logError: vi.fn(),
      });
      const repairService = createCreativeStudioService({
        store: repairStore,
        onProjectUpdated,
        storyboardPlanner: makePlanner(),
      });
      onProjectUpdated.mockClear();

      const accepted = await repairService.acceptProposal({
        projectId: project.id,
        proposalId: 'proposal_summary_repair',
      });
      const replay = await repairStore.acceptProposal(project.id, 'proposal_summary_repair', () => {
        throw new Error('an accepted proposal must not mutate again');
      });

      expect(accepted.project.revision).toBe(project.revision + 1);
      expect(replay).toMatchObject({ applied: false, project: { revision: accepted.project.revision } });
      expect(
        JSON.parse(
          await readFile(
            path.join(rootDir, project.id, 'proposals', 'decisions', 'proposal_summary_repair.json'),
            'utf8'
          )
        )
      ).toMatchObject({ proposalId: 'proposal_summary_repair', status: 'accepted' });
      expect(await readdir(path.join(rootDir, project.id, 'proposals', 'slots'))).toEqual([]);
      await vi.waitFor(async () => {
        const index = JSON.parse(await readFile(path.join(rootDir, 'projects.json'), 'utf8')) as {
          projects: Array<{ id: string; sceneCount: number }>;
        };
        expect(index.projects).toEqual([expect.objectContaining({ id: project.id, sceneCount: 1 })]);
      });
      expect(projectRenameAttempts).toBe(1);
      expect(summaryRenameAttempts).toBe(2);
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

    it('records a rule the user reviews, and generates nothing', async () => {
      const ruled = createCreativeStudioService({
        store,
        onProjectUpdated,
        storyboardPlanner: makePlanner(),
        createRuleId: () => 'rule_minted',
      });
      const project = await ruled.createProject(makeInput());
      const { projectDir, pendingDir, referencePendingDir } = await store.resolveProposalPaths(project.id);
      const handler = createProposeBriefRuleHandler({
        projectId: project.id,
        projectDir,
        pendingDir,
        referencePendingDir,
      });

      const result = await handler({
        base_revision: project.revision,
        text: 'Keep the kits generic.',
        forbidden_terms: ['acme'],
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('recorded for user review');
      const [proposal] = await ruled.listProposals({ projectId: project.id });
      // This assertion reads through `toRendererProposal` → `toRendererProposalPayload`, so it is also
      // the guard on Step 6.4.1's projection branch: without it, `rule` is stripped here.
      expect(proposal.payload).toEqual({
        kind: 'pin_rule',
        rule: { text: 'Keep the kits generic.', predicate: { kind: 'forbidden_terms', terms: ['acme'] } },
      });

      const accepted = await ruled.acceptProposal({ projectId: project.id, proposalId: proposal.id });
      expect(accepted.project.rules).toEqual([
        {
          id: 'rule_minted',
          scope: 'project',
          text: 'Keep the kits generic.',
          predicate: { kind: 'forbidden_terms', terms: ['acme'] },
          createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        },
      ]);
      expect(accepted.project.ruleListUndo).toEqual({
        capturedRevision: project.revision,
        previousRules: [],
      });
    });

    it('refuses a proposed rule term that the accept path cannot enforce', async () => {
      const project = await service.createProject(makeInput());
      const { projectDir, pendingDir, referencePendingDir } = await store.resolveProposalPaths(project.id);
      const handler = createProposeBriefRuleHandler({
        projectId: project.id,
        projectDir,
        pendingDir,
        referencePendingDir,
      });

      const result = await handler({
        base_revision: project.revision,
        text: 'Never show a registered-trademark mark.',
        forbidden_terms: ['acme', '®'],
      });

      expect(result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('®') }] });
      await expect(service.listProposals({ projectId: project.id })).resolves.toEqual([]);
    });

    it('refuses a rule drafted against a stale revision instead of pinning the wrong thing', async () => {
      const project = await service.createProject(makeInput());
      const projectDir = path.join(rootDir, project.id);
      const handler = createProposeBriefRuleHandler({
        projectId: project.id,
        projectDir,
        pendingDir: path.join(projectDir, 'proposals', 'pending'),
        referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
      });

      const result = await handler({ base_revision: project.revision + 1, text: 'x', forbidden_terms: [] });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('read_storyboard');
    });

    it('refuses an accepted proposal term that token matching can never enforce', async () => {
      const project = await service.createProject(makeInput());
      await store.recordProposal({
        projectId: project.id,
        proposalId: 'proposal_unenforceable',
        baseRevision: project.revision,
        payload: {
          kind: 'pin_rule',
          rule: {
            text: 'No symbol-only mark.',
            predicate: { kind: 'forbidden_terms', terms: ['+++'] },
          },
        },
      });

      await expect(
        service.acceptProposal({ projectId: project.id, proposalId: 'proposal_unenforceable' })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
      await expect(service.getProject(project.id)).resolves.toMatchObject({ rules: [] });
    });

    it('deduplicates accepted proposal terms by their matcher key', async () => {
      const project = await service.createProject(makeInput());
      await store.recordProposal({
        projectId: project.id,
        proposalId: 'proposal_duplicate_terms',
        baseRevision: project.revision,
        payload: {
          kind: 'pin_rule',
          rule: {
            text: 'No competitor marks.',
            predicate: { kind: 'forbidden_terms', terms: ['Nike', 'nike', 'Nike!', 'Adidas'] },
          },
        },
      });

      const accepted = await service.acceptProposal({
        projectId: project.id,
        proposalId: 'proposal_duplicate_terms',
      });

      expect(accepted.project.rules[0].predicate?.terms).toEqual(['Nike', 'Adidas']);
    });

    it('leaves the rules unchanged when accepting a duplicate rule proposal', async () => {
      const project = await service.createProject(makeInput());
      const seeded = await service.setBriefRules({
        projectId: project.id,
        expectedRevision: project.revision,
        rules: [{ id: 'rule_existing', text: 'Keep the kits generic.', predicate: null }],
      });
      await store.recordProposal({
        projectId: project.id,
        proposalId: 'proposal_duplicate_rule',
        baseRevision: seeded.revision,
        payload: {
          kind: 'pin_rule',
          rule: { text: 'KEEP THE KITS GENERIC.', predicate: null },
        },
      });

      const accepted = await service.acceptProposal({
        projectId: project.id,
        proposalId: 'proposal_duplicate_rule',
      });

      expect(accepted.project.rules).toEqual(seeded.rules);
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

  it('preserves an admitted image capacity through validation, save, listing, and revalidation', async () => {
    const validateInternalConnection = vi.fn(async (input) => ({
      schemaVersion: 1 as const,
      id: 'validation_only',
      providerId: input.providerId,
      adapterId: input.adapterId,
      model: input.model,
      capabilities: {
        mediaKinds: ['image' as const],
        supportsFirstFrame: false,
        maxConditioningImages: 6,
        cancellationPolicy: 'none' as const,
      },
      validatedAt: '2026-07-30T00:00:00.000Z',
    }));
    const connectionService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      createConnectionId: () => 'binding_image',
      validateConnection: validateInternalConnection,
    });
    const request = {
      providerId: 'provider_1',
      integrationId: IMAGE_INTEGRATION_ID,
      model: 'image-model',
    };

    await expect(connectionService.validateConnection(request)).resolves.toMatchObject({
      capabilities: { supportsFirstFrame: true, maxConditioningImages: 6 },
    });
    await expect(connectionService.saveConnection(request)).resolves.toMatchObject({
      capabilities: { supportsFirstFrame: true, maxConditioningImages: 6 },
    });
    await expect(connectionService.listConnections()).resolves.toMatchObject({
      connections: [{ capabilities: { supportsFirstFrame: true, maxConditioningImages: 6 } }],
    });
    await expect(connectionService.saveConnection(request)).resolves.toMatchObject({
      capabilities: { supportsFirstFrame: true, maxConditioningImages: 6 },
    });
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
        maxConditioningImages: 0,
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
        maxConditioningImages: 0,
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

  it('propagates an already-aborted parent signal before starting provider work', async () => {
    const parent = new AbortController();
    parent.abort();
    let operationSignal: AbortSignal | undefined;
    const operation = vi.fn((signal: AbortSignal) => {
      operationSignal = signal;
      return new Promise<never>(() => undefined);
    });

    await expect(runWithProviderDeadline(parent.signal, 30_000, operation)).rejects.toBeInstanceOf(
      ProviderDeadlineError
    );
    expect(operation).toHaveBeenCalledOnce();
    expect(operationSignal?.aborted).toBe(true);
  });

  it('detects either reserved image-conditioning field even when its value is undefined', () => {
    const baseRequest = {
      prompt: 'A product on a clean table',
      mediaKind: 'image' as const,
      aspectRatio: '16:9' as const,
      resolution: '1080p' as const,
      durationSeconds: 5,
      idempotencyKey: 'conditioning_shape',
    };

    expect(hasImageConditioningFields(baseRequest)).toBe(false);
    expect(hasImageConditioningFields({ ...baseRequest, conditioningImages: undefined })).toBe(true);
    expect(hasImageConditioningFields({ ...baseRequest, conditioningImageLimit: undefined })).toBe(true);
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

  it('edits and reorders a 24-scene project but refuses one more scene with a store error', async () => {
    const created = await service.createProject(makeInput());
    const sceneOrder = Array.from({ length: 24 }, (_, index) => `scene_${index + 1}`);
    const admitted = await store.updateProject(created.id, (current) => ({
      ...current,
      sceneOrder,
      scenes: Object.fromEntries(
        sceneOrder.map((sceneId) => [
          sceneId,
          {
            id: sceneId,
            ...makeScene(sceneId),
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'ready' as const,
          },
        ])
      ),
    }));

    const edited = await service.updateScene({
      projectId: admitted.id,
      expectedRevision: admitted.revision,
      sceneId: 'scene_1',
      scene: { ...makeScene('scene_1'), title: 'Edited at capacity' },
    });
    expect(edited.scenes.scene_1.title).toBe('Edited at capacity');

    const reversedOrder = [...sceneOrder].reverse();
    const reordered = await service.reorderScenes({
      projectId: edited.id,
      expectedRevision: edited.revision,
      sceneOrder: reversedOrder,
    });
    expect(reordered.sceneOrder).toEqual(reversedOrder);

    await expect(
      service.updateScene({
        projectId: reordered.id,
        expectedRevision: reordered.revision,
        sceneId: 'scene_25',
        scene: makeScene('scene_25'),
      })
    ).rejects.toMatchObject({
      name: 'CreativeStudioStoreError',
      code: 'invalid_payload',
      message: 'Studio scene limit exceeded',
    });
  });

  it('rejects a planner replacement above the shared scene limit without changing the project', async () => {
    const draftedScenes = Array.from({ length: 25 }, (_, index) => ({
      ...storyboardProposal.scenes[0],
      title: `Draft ${index + 1}`,
    }));
    let sceneId = 0;
    const cappedService = createCreativeStudioService({
      store,
      onProjectUpdated,
      storyboardPlanner: makePlanner({
        draft: async () => ({ projectSummary: 'Too many scenes', scenes: draftedScenes }),
      }),
      createSceneId: () => `planned_${++sceneId}`,
    });
    const created = await cappedService.createProject(makeInput());
    const selected = await selectStoryboard(store, created);

    await expect(
      cappedService.proposeStoryboard({
        projectId: selected.id,
        expectedRevision: selected.revision,
        replaceExisting: false,
      })
    ).rejects.toMatchObject({ code: 'invalid_payload', message: 'Studio scene limit exceeded' });
    await expect(store.getProject(selected.id)).resolves.toMatchObject({
      revision: selected.revision,
      sceneOrder: [],
      scenes: {},
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

  it('retains a reference output role when projecting a job for the renderer', async () => {
    const created = await service.createProject(makeInput());
    await store.updateProject(created.id, (current) => ({
      ...current,
      sceneOrder: ['scene_1'],
      scenes: {
        scene_1: {
          id: 'scene_1',
          ...makeScene('scene_1'),
          selectedAssetId: null,
          assetIds: [],
          jobIds: ['job_reference'],
          reviewState: 'generating',
        },
      },
      jobs: {
        job_reference: {
          id: 'job_reference',
          projectId: current.id,
          sceneId: 'scene_1',
          status: 'succeeded',
          provider: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'image-model' },
          idempotencyKey: 'reference-idempotency-key',
          providerJobId: 'reference-provider-job',
          cancellationPolicy: 'none',
          outputRole: 'reference',
          referenceInputSnapshot: {
            sourceVisualPrompt: 'Reviewed one-off plate',
            conditioningReferenceAssetIds: [],
            aspectRatio: '16:9',
            resolution: '720p',
          },
          outputAssetIds: [],
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

    const rendererProject = await service.getProject(created.id);

    expect(rendererProject?.jobs.job_reference).toMatchObject({ outputRole: 'reference' });
    expect(rendererProject?.jobs.job_reference).not.toHaveProperty('referenceInputSnapshot');
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
    expect(projectResult?.jobs.job_1).not.toHaveProperty('outputRole');
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
        diagnostics?: Array<
          | {
              status: 'retired' | 'health';
              providerId: string;
              adapterId: 'weprompt-media-gateway-v1';
              model: string;
            }
          | {
              status: 'needs_setup';
              providerId: string;
              providerName: string;
              adapterId: 'weprompt-media-gateway-v1';
              model: string;
            }
        >;
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
        diagnostics: options.diagnostics ?? [],
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

    it('changes the renderer catalog version when image conditioning capacity changes', async () => {
      const zero = routeOption('image', {
        constraints: { ...routeOption('image').constraints, maxConditioningImages: 0 },
      });
      const six = routeOption('image', {
        constraints: { ...routeOption('image').constraints, maxConditioningImages: 6 },
      });
      const harness = await createCatalogHarness({ routes: [zero] });

      const first = await harness.service.listRoutes({ projectId: harness.project.id });
      harness.listGenerationRoutes.mockResolvedValue({
        routes: [six],
        diagnostics: [],
        generationCatalogVersion: 'generation-v2',
      });
      const changed = await harness.service.listRoutes({ projectId: harness.project.id });

      expect(first.image.options[0]?.constraints).toHaveProperty('maxConditioningImages', 0);
      expect(changed.image.options[0]?.constraints).toHaveProperty('maxConditioningImages', 6);
      expect(changed.catalogVersion).not.toBe(first.catalogVersion);
    });

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
          listGenerationRoutes: async () => ({
            routes: [],
            diagnostics: [],
            generationCatalogVersion: 'generation-v2',
          }),
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
        selectionIssue: { code: 'retired' },
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

    it('projects distinct integration labels for distinct adapters sharing a provider and model', async () => {
      const routes = [
        routeOption('video', { adapterId: 'byteplus-seedance-v1', model: 'shared-video-model' }),
        routeOption('video', { adapterId: 'weprompt-media-gateway-v1', model: 'shared-video-model' }),
      ];
      const harness = await createCatalogHarness({ routes });

      const catalog = await harness.service.listRoutes({ projectId: harness.project.id });

      expect(
        catalog.video.options.map(({ choiceId, integrationLabelKey }) => ({ choiceId, integrationLabelKey }))
      ).toEqual([
        { choiceId: routes[0]!.choiceId, integrationLabelKey: 'bytePlusSeedance' },
        { choiceId: routes[1]!.choiceId, integrationLabelKey: 'selfHostedVideoGateway' },
      ]);
      expectRendererBoundaryToHideAdapters(catalog);
    });

    it.each([
      {
        name: 'removed binding',
        routes: [],
        diagnostics: [],
        expectedIssue: { code: 'retired' },
      },
      {
        name: 'missing credentials',
        routes: [],
        diagnostics: [
          {
            status: 'needs_setup' as const,
            providerId: 'provider_1',
            providerName: 'Provider One',
            adapterId: KNOWN_ADAPTER_SENTINEL,
            model: 'video-model',
          },
        ],
        expectedIssue: { code: 'needs_setup', providerName: 'Provider One' },
      },
      {
        name: 'unavailable provider health',
        routes: [],
        diagnostics: [
          {
            status: 'health' as const,
            providerId: 'provider_1',
            adapterId: KNOWN_ADAPTER_SENTINEL,
            model: 'video-model',
          },
        ],
        expectedIssue: { code: 'health' },
      },
      {
        name: 'unsupported project frame',
        routes: [
          routeOption('video', {
            constraints: { ...routeOption('video').constraints, aspectRatios: ['1:1'] },
          }),
        ],
        diagnostics: [],
        expectedIssue: { code: 'frame', aspectRatio: '16:9', resolution: '1080p' },
      },
    ])('explains an unavailable persisted media selection with a $name issue', async (testCase) => {
      const harness = await createCatalogHarness({
        routes: testCase.routes,
        diagnostics: testCase.diagnostics,
      });
      await harness.store.updateProject(harness.project.id, (current) => ({
        ...current,
        routing: {
          ...current.routing,
          video: {
            providerId: 'provider_1',
            adapterId: KNOWN_ADAPTER_SENTINEL,
            model: 'video-model',
          },
        },
      }));

      const catalog = await harness.service.listRoutes({ projectId: harness.project.id });

      expect(catalog.video).toMatchObject({
        status: 'unavailable',
        selectedRoute: null,
        selectionIssue: testCase.expectedIssue,
      });
    });

    it('keeps a selected no-first-frame route ready because the capability is shot-specific', async () => {
      const route = routeOption('video', {
        constraints: { ...routeOption('video').constraints, supportsFirstFrame: false },
      });
      const harness = await createCatalogHarness({ routes: [route] });
      await harness.store.updateProject(harness.project.id, (current) => ({
        ...current,
        routing: {
          ...current.routing,
          video: {
            providerId: route.providerId,
            adapterId: route.adapterId,
            model: route.model,
          },
        },
      }));

      const catalog = await harness.service.listRoutes({ projectId: harness.project.id });

      expect(catalog.video).toMatchObject({
        status: 'ready',
        selectedRoute: { choiceId: route.choiceId },
        selectionIssue: null,
      });
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

const makeSchema2ServiceProject = (): StudioProjectV2 => {
  const input: CreateStudioProjectInputV2 = {
    name: 'Schema 2 launch',
    brief: 'A clip-owned launch film',
    aspectRatio: '16:9',
    targetDurationSeconds: 12,
    resolution: '1080p',
  };
  const empty = createEmptyStudioProjectV2(input, 'project_v2', '2026-08-17T00:00:00.000Z');
  return applyStudioMutationBatchV2(empty, {
    schemaVersion: 2,
    projectId: empty.id,
    expectedRevision: empty.revision,
    operations: [
      {
        kind: 'add_section',
        sectionId: 'section_1',
        section: { title: 'Opening', storyLine: '', visualPrompt: 'Warm sunrise over a quiet city' },
        firstClipId: 'clip_1',
        firstClip: {
          shotPrompt: 'A wide establishing shot',
          narration: '',
          onScreenText: '',
          mediaKind: 'image',
          durationSeconds: 5,
          referenceAssetId: null,
        },
        beforeSectionId: null,
      },
      {
        kind: 'add_section',
        sectionId: 'section_2',
        section: { title: 'Close', storyLine: '', visualPrompt: 'Soft evening light over the skyline' },
        firstClipId: 'clip_2',
        firstClip: {
          shotPrompt: 'A slow closing composition',
          narration: '',
          onScreenText: '',
          mediaKind: 'image',
          durationSeconds: 5,
          referenceAssetId: null,
        },
        beforeSectionId: null,
      },
    ],
  }).project;
};

describe('CreativeStudioServiceV2', () => {
  const imageRoute = {
    choiceId: createStudioMediaChoiceId({
      providerId: 'provider_1',
      adapterId: 'weprompt-image-v1',
      model: 'image-model',
      kind: 'image',
    }),
    providerId: 'provider_1',
    providerName: 'Image provider',
    adapterId: 'weprompt-image-v1' as const,
    model: 'image-model',
    health: 'available' as const,
    kind: 'image' as const,
    cancellationPolicy: 'none' as const,
    constraints: {
      aspectRatios: ['16:9' as const],
      resolutions: ['1080p' as const],
      minDurationSeconds: 1,
      maxDurationSeconds: 60,
      supportsFirstFrame: true,
      maxConditioningImages: 1,
      silentOutput: true,
    },
  };

  const makeSchema2Job = (project: StudioProjectV2, overrides: Partial<StudioJobV2> = {}): StudioJobV2 => ({
    id: 'job_1',
    projectId: project.id,
    clipId: 'clip_1',
    status: 'failed',
    provider: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'image-model' },
    idempotencyKey: 'idempotency_secret',
    providerJobId: null,
    remoteStartedAt: null,
    cancellationPolicy: 'none',
    outputAssetIds: [],
    error: { code: 'provider_unavailable', messageKey: 'providerUnavailable' },
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:01.000Z',
    ...overrides,
  });

  const makeHarness = (project = makeSchema2ServiceProject(), options: { includeMediaStore?: boolean } = {}) => {
    let current = structuredClone(project);
    const store = {
      listProjectsV2: vi.fn(async () => ({ projects: [], unsupportedProjectIds: [], quarantinedProjectIds: [] })),
      createProjectV2: vi.fn(async () => structuredClone(current)),
      getProjectV2: vi.fn(async () => ({ status: 'supported' as const, project: structuredClone(current) })),
      applyMutationBatchV2: vi.fn(async () => ({
        project: structuredClone(current),
        createdSectionIds: [],
        createdClipIds: [],
      })),
      deleteProjectV2: vi.fn(async () => true),
    };
    const submitClips = vi.fn(async () => []);
    const cancelJobV2 = vi.fn(async () => makeSchema2Job(current, { status: 'cancelled', error: null }));
    const retryJobV2 = vi.fn(async () => makeSchema2Job(current, { status: 'queued_local', error: null }));
    const retryDownloadV2 = vi.fn(async () => makeSchema2Job(current, { status: 'succeeded', error: null }));
    const referenceAsset = {
      id: 'reference_1',
      projectId: current.id,
      clipId: 'clip_1',
      mediaKind: 'image' as const,
      mimeType: 'image/png',
      managedAsset: { collection: 'imports' as const, fileName: 'reference_1.png' },
      byteSize: 8,
      sha256: 'a'.repeat(64),
      createdAt: '2026-08-17T00:00:00.000Z',
    };
    const importReferenceFromPathV2 = vi.fn(async () => ({
      asset: structuredClone(referenceAsset),
      project: structuredClone(current),
    }));
    const detachBriefReferenceV2 = vi.fn(async () => structuredClone(current));
    const persistCapturedPosterV2 = vi.fn(async () => structuredClone(referenceAsset));
    const providerResolver = {
      listGenerationRoutes: vi.fn(async () => ({
        routes: [structuredClone(imageRoute)],
        diagnostics: [{ status: 'available' as const, route: structuredClone(imageRoute) }],
        generationCatalogVersion: 'catalog_v2',
      })),
    };
    const onProjectUpdated = vi.fn();
    const service = createCreativeStudioServiceV2({
      store: store as unknown as CreativeStudioStore,
      jobManager: { submitClips, cancelJobV2, retryJobV2, retryDownloadV2 } as never,
      providerResolver: providerResolver as never,
      ...(options.includeMediaStore === false
        ? {}
        : {
            mediaStore: {
              importReferenceFromPathV2,
              detachBriefReferenceV2,
              persistCapturedPosterV2,
            } as never,
          }),
      onProjectUpdated,
    });
    return {
      service,
      store,
      submitClips,
      cancelJobV2,
      retryJobV2,
      retryDownloadV2,
      importReferenceFromPathV2,
      detachBriefReferenceV2,
      persistCapturedPosterV2,
      providerResolver,
      onProjectUpdated,
      setProject: (next: StudioProjectV2): void => {
        current = structuredClone(next);
      },
    };
  };

  it('derives payable clips in persisted section and clip order', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);

    const result = await harness.service.getGenerationReadiness({
      projectId: 'project_v2',
      sectionIds: ['section_2', 'section_1'],
    });

    expect(derivePayableClipIds(project, ['section_2', 'section_1'])).toEqual(['clip_1', 'clip_2']);
    expect(result.payableClipIds).toEqual(['clip_1', 'clip_2']);
    expect(result.clips.every((clip) => clip.ready)).toBe(true);
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
  });

  it('reports exact authored and durable blockers without treating optional copy as required', async () => {
    const project = makeSchema2ServiceProject();
    project.sections.section_1.title = '';
    project.clips.clip_2.shotPrompt = '';
    const harness = makeHarness(project);

    const result = await harness.service.getGenerationReadiness({
      projectId: project.id,
      sectionIds: ['section_1', 'section_2'],
    });

    expect(result.payableClipIds).toEqual([]);
    expect(result.clips.map(({ clipId, issues }) => ({ clipId, issues }))).toEqual([
      { clipId: 'clip_1', issues: ['missing_section_title'] },
      { clipId: 'clip_2', issues: ['missing_shot_prompt'] },
    ]);
  });

  it('projects only image and video route catalogs without storyboard authority', async () => {
    const project = makeSchema2ServiceProject();
    project.routing.image = {
      providerId: imageRoute.providerId,
      adapterId: imageRoute.adapterId,
      model: imageRoute.model,
    };
    const harness = makeHarness(project);

    const catalog = await harness.service.listRoutes({ projectId: project.id });

    expect(Object.keys(catalog)).toEqual(['image', 'video', 'catalogVersion']);
    expect(catalog.image.selectedRoute?.choiceId).toBe(imageRoute.choiceId);
    expect(catalog.catalogVersion).toBe('catalog_v2');
  });

  it('strips durable provider, charge, and remote-task authority from schema-2 jobs', async () => {
    const project = makeSchema2ServiceProject();
    const job: StudioJobV2 = {
      id: 'job_1',
      projectId: project.id,
      clipId: 'clip_1',
      status: 'queued_remote',
      provider: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'image-model' },
      idempotencyKey: 'idempotency_secret',
      providerJobId: 'provider_job_secret',
      remoteStartedAt: '2026-08-17T00:00:01.000Z',
      cancellationPolicy: 'queued_only',
      outputAssetIds: [],
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:01.000Z',
    };
    project.jobs[job.id] = job;
    project.clips.clip_1.jobIds = [job.id];
    const harness = makeHarness(project);

    const loaded = await harness.service.getProject(project.id);
    const rendererJob = loaded.status === 'supported' ? loaded.project.jobs.job_1 : undefined;

    expect(rendererJob?.provider).toEqual({
      choiceId: imageRoute.choiceId,
      providerId: 'provider_1',
      model: 'image-model',
    });
    expect(rendererJob).not.toHaveProperty('providerJobId');
    expect(rendererJob).not.toHaveProperty('idempotencyKey');
  });

  it('resolves a reviewed clip route immediately before the sole paid boundary', async () => {
    const project = makeSchema2ServiceProject();
    project.routing.image = {
      providerId: imageRoute.providerId,
      adapterId: imageRoute.adapterId,
      model: imageRoute.model,
    };
    const harness = makeHarness(project);

    await harness.service.submitClips({
      projectId: project.id,
      expectedRevision: project.revision,
      clipIds: ['clip_1'],
      routes: [{ clipId: 'clip_1', choiceId: imageRoute.choiceId, kind: 'image' }],
      catalogVersion: 'catalog_v2',
    });

    expect(harness.submitClips).toHaveBeenCalledTimes(1);
    expect(harness.submitClips).toHaveBeenCalledWith({
      projectId: project.id,
      expectedRevision: project.revision,
      clipIds: ['clip_1'],
      routes: [
        {
          clipId: 'clip_1',
          providerId: imageRoute.providerId,
          adapterId: imageRoute.adapterId,
          model: imageRoute.model,
          kind: 'image',
        },
      ],
      catalogVersion: 'catalog_v2',
    });
  });

  it('keeps an explicit reference request separate from take-payability', async () => {
    const project = makeSchema2ServiceProject();
    project.routing.image = {
      providerId: imageRoute.providerId,
      adapterId: imageRoute.adapterId,
      model: imageRoute.model,
    };
    project.assets.take_1 = {
      id: 'take_1',
      projectId: project.id,
      clipId: 'clip_1',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'assets', fileName: 'take_1.png' },
      byteSize: 8,
      sha256: 'a'.repeat(64),
      createdAt: '2026-08-17T00:00:00.000Z',
    };
    project.clips.clip_1.assetIds = ['take_1'];
    project.clips.clip_1.selectedAssetId = 'take_1';
    const harness = makeHarness(project);

    await harness.service.submitClips({
      projectId: project.id,
      expectedRevision: project.revision,
      clipIds: ['clip_1'],
      routes: [{ clipId: 'clip_1', choiceId: imageRoute.choiceId, kind: 'image' }],
      catalogVersion: 'catalog_v2',
      outputRole: 'reference',
      referencePrompts: [{ clipId: 'clip_1', prompt: 'A clean first-frame reference' }],
    });

    expect(harness.submitClips).toHaveBeenCalledOnce();
    expect(harness.submitClips).toHaveBeenCalledWith(
      expect.objectContaining({
        outputRole: 'reference',
        referencePrompts: [{ clipId: 'clip_1', prompt: 'A clean first-frame reference' }],
      })
    );
  });

  it('submits nothing when the project changes while routes are being refreshed', async () => {
    const project = makeSchema2ServiceProject();
    project.routing.image = {
      providerId: imageRoute.providerId,
      adapterId: imageRoute.adapterId,
      model: imageRoute.model,
    };
    const harness = makeHarness(project);
    harness.providerResolver.listGenerationRoutes.mockImplementationOnce(async () => {
      harness.setProject({ ...project, revision: project.revision + 1 });
      return {
        routes: [structuredClone(imageRoute)],
        diagnostics: [{ status: 'available' as const, route: structuredClone(imageRoute) }],
        generationCatalogVersion: 'catalog_v2',
      };
    });

    await expect(
      harness.service.submitClips({
        projectId: project.id,
        expectedRevision: project.revision,
        clipIds: ['clip_1'],
        routes: [{ clipId: 'clip_1', choiceId: imageRoute.choiceId, kind: 'image' }],
        catalogVersion: 'catalog_v2',
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    expect(harness.submitClips).not.toHaveBeenCalled();
  });

  it('rejects a stale catalog before job submission', async () => {
    const project = makeSchema2ServiceProject();
    project.routing.image = {
      providerId: imageRoute.providerId,
      adapterId: imageRoute.adapterId,
      model: imageRoute.model,
    };
    const harness = makeHarness(project);

    await expect(
      harness.service.submitClips({
        projectId: project.id,
        expectedRevision: project.revision,
        clipIds: ['clip_1'],
        routes: [{ clipId: 'clip_1', choiceId: imageRoute.choiceId, kind: 'image' }],
        catalogVersion: 'stale_catalog',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
    expect(harness.submitClips).not.toHaveBeenCalled();
  });

  it('rejects a non-bijective route list before resolving providers', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);

    await expect(
      harness.service.submitClips({
        projectId: project.id,
        expectedRevision: project.revision,
        clipIds: ['clip_1'],
        routes: [
          { clipId: 'clip_1', choiceId: imageRoute.choiceId, kind: 'image' },
          { clipId: 'clip_1', choiceId: imageRoute.choiceId, kind: 'image' },
        ],
        catalogVersion: 'catalog_v2',
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
  });

  it('keeps free schema-2 project operations outside provider and job-manager code', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);
    const poison = (): never => {
      throw new Error('paid boundary reached by a free operation');
    };
    harness.providerResolver.listGenerationRoutes.mockImplementation(poison);
    harness.submitClips.mockImplementation(poison);
    harness.cancelJobV2.mockImplementation(poison);
    harness.retryJobV2.mockImplementation(poison);
    harness.retryDownloadV2.mockImplementation(poison);

    await harness.service.listProjects();
    await harness.service.getProject(project.id);
    await harness.service.createProject({
      name: 'New project',
      brief: '',
      aspectRatio: '16:9',
      targetDurationSeconds: 12,
      resolution: '1080p',
    });
    await harness.service.applyMutations({
      schemaVersion: 2,
      projectId: project.id,
      expectedRevision: project.revision,
      operations: [{ kind: 'set_brief', brief: 'Updated' }],
    });
    await harness.service.getGenerationReadiness({ projectId: project.id, sectionIds: ['section_1'] });
    await harness.service.importReferenceFromPath({
      projectId: project.id,
      clipId: 'clip_1',
      expectedRevision: project.revision,
      sourcePath: '/chosen/reference.png',
    });
    await harness.service.detachBriefReference({
      projectId: project.id,
      assetId: 'reference_1',
      expectedRevision: project.revision,
    });
    await harness.service.persistCapturedPoster({
      projectId: project.id,
      clipId: 'clip_1',
      videoAssetId: 'video_1',
      dataUrl: `data:image/png;base64,${Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')}`,
      width: 1280,
      height: 720,
    });
    await harness.service.deleteProject({ projectId: project.id, expectedRevision: project.revision });

    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(harness.submitClips).not.toHaveBeenCalled();
    expect(harness.cancelJobV2).not.toHaveBeenCalled();
    expect(harness.retryJobV2).not.toHaveBeenCalled();
    expect(harness.retryDownloadV2).not.toHaveBeenCalled();
  });

  it('attaches a reference through the clip-owned media seam and returns a renderer projection', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);

    const result = await harness.service.importReferenceFromPath({
      projectId: project.id,
      clipId: 'clip_1',
      expectedRevision: project.revision,
      sourcePath: '/chosen/reference.png',
    });

    expect(harness.importReferenceFromPathV2).toHaveBeenCalledWith({
      projectId: project.id,
      clipId: 'clip_1',
      expectedRevision: project.revision,
      sourcePath: '/chosen/reference.png',
      returnProject: true,
    });
    expect(result.asset).toMatchObject({ id: 'reference_1', clipId: 'clip_1' });
    expect(harness.onProjectUpdated).toHaveBeenCalledWith(project.id);
  });

  it('decodes a bounded PNG before forwarding a captured poster to V2 media storage', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);
    const png = Buffer.from('89504e470d0a1a0a', 'hex');

    await harness.service.persistCapturedPoster({
      projectId: project.id,
      clipId: 'clip_1',
      videoAssetId: 'video_1',
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      width: 1280,
      height: 720,
    });

    expect(harness.persistCapturedPosterV2).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: project.id,
        clipId: 'clip_1',
        videoAssetId: 'video_1',
        declaredByteSize: png.length,
      })
    );
    expect(harness.onProjectUpdated).toHaveBeenCalledWith(project.id);
  });

  it('forwards cancel, retry, and retry-download through only their named V2 manager seams', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);
    const projectedJob = makeSchema2Job(project, {
      status: 'failed',
      providerJobId: 'remote_job_1',
      outputRole: 'reference',
      error: { code: 'download_failed', messageKey: 'downloadFailed' },
      progress: 0.5,
    });
    harness.cancelJobV2.mockResolvedValueOnce(projectedJob);
    harness.retryJobV2.mockResolvedValueOnce(projectedJob);
    harness.retryDownloadV2.mockResolvedValueOnce(projectedJob);
    const request = { projectId: project.id, jobId: projectedJob.id, expectedRevision: project.revision };

    const cancelled = await harness.service.cancelJob(request);
    const retried = await harness.service.retryJob({ ...request, acknowledgePossibleDuplicateCharge: true });
    const downloaded = await harness.service.retryDownload(request);

    expect(harness.cancelJobV2).toHaveBeenCalledWith(request);
    expect(harness.retryJobV2).toHaveBeenCalledWith({ ...request, acknowledgePossibleDuplicateCharge: true });
    expect(harness.retryDownloadV2).toHaveBeenCalledWith(request);
    for (const job of [cancelled, retried, downloaded]) {
      expect(job).toMatchObject({
        id: projectedJob.id,
        clipId: 'clip_1',
        outputRole: 'reference',
        progress: 0.5,
        canRetryDownload: true,
        error: { code: 'download_failed' },
      });
      expect(job).not.toHaveProperty('providerJobId');
      expect(job).not.toHaveProperty('idempotencyKey');
    }
    expect(harness.submitClips).not.toHaveBeenCalled();
  });

  it('rejects an invalid duplicate-charge acknowledgement before retry manager work', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);

    await expect(
      harness.service.retryJob({
        projectId: project.id,
        jobId: 'job_1',
        expectedRevision: project.revision,
        acknowledgePossibleDuplicateCharge: 'yes' as never,
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.retryJobV2).not.toHaveBeenCalled();
  });

  it('derives visual, duration, active-job, generated-take, and latest-failure blockers', async () => {
    const project = makeSchema2ServiceProject();
    project.sections.section_1.visualPrompt = '   ';
    project.clips.clip_1.mediaKind = 'video';
    project.clips.clip_1.durationSeconds = 3;
    project.assets.take_1 = {
      id: 'take_1',
      projectId: project.id,
      clipId: 'clip_1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'take_1.mp4' },
      byteSize: 8,
      sha256: 'b'.repeat(64),
      createdAt: project.createdAt,
    };
    project.clips.clip_1.assetIds = ['take_1'];
    project.jobs.active_job = makeSchema2Job(project, {
      id: 'active_job',
      status: 'running',
      providerJobId: 'remote_active',
      error: null,
    });
    project.jobs.failed_job = makeSchema2Job(project, {
      id: 'failed_job',
      clipId: 'clip_2',
      error: { code: 'timeout', messageKey: 'timeout' },
    });
    project.clips.clip_1.jobIds = ['active_job'];
    project.clips.clip_2.jobIds = ['failed_job'];
    const harness = makeHarness(project);

    const readiness = await harness.service.getGenerationReadiness({
      projectId: project.id,
      sectionIds: ['section_1', 'section_2'],
    });

    expect(readiness.clips).toEqual([
      {
        clipId: 'clip_1',
        sectionId: 'section_1',
        ready: false,
        issues: ['missing_visual_prompt', 'invalid_clip_duration', 'active_job', 'generated_take_exists'],
      },
      {
        clipId: 'clip_2',
        sectionId: 'section_2',
        ready: false,
        issues: ['latest_job_failed'],
      },
    ]);
    expect(readiness.payableClipIds).toEqual([]);
  });

  it.each([
    ['a non-array', null],
    ['a duplicate active section', ['section_1', 'section_1']],
    ['a non-active section', ['section_missing']],
  ])('rejects %s in a readiness selection', async (_label, sectionIds) => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);

    await expect(
      harness.service.getGenerationReadiness({ projectId: project.id, sectionIds: sectionIds as never })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
  });

  it.each([
    [
      'frame mismatch',
      [{ ...imageRoute, constraints: { ...imageRoute.constraints, aspectRatios: ['9:16' as const] } }],
      [],
      { code: 'frame', aspectRatio: '16:9', resolution: '1080p' },
    ],
    [
      'missing setup',
      [],
      [
        {
          status: 'needs_setup' as const,
          providerId: imageRoute.providerId,
          providerName: imageRoute.providerName,
          adapterId: imageRoute.adapterId,
          model: imageRoute.model,
        },
      ],
      { code: 'needs_setup', providerName: imageRoute.providerName },
    ],
    [
      'provider health',
      [],
      [
        {
          status: 'health' as const,
          providerId: imageRoute.providerId,
          adapterId: imageRoute.adapterId,
          model: imageRoute.model,
        },
      ],
      { code: 'health' },
    ],
    ['retired route', [], [], { code: 'retired' }],
  ])('projects an unavailable selection caused by %s', async (_label, routes, diagnostics, expectedIssue) => {
    const project = makeSchema2ServiceProject();
    project.routing.image = {
      providerId: imageRoute.providerId,
      adapterId: imageRoute.adapterId,
      model: imageRoute.model,
    };
    const harness = makeHarness(project);
    harness.providerResolver.listGenerationRoutes.mockResolvedValueOnce({
      routes,
      diagnostics,
      generationCatalogVersion: 'catalog_v2',
    });

    const catalog = await harness.service.listRoutes({ projectId: project.id });

    expect(catalog.image.status).toBe('unavailable');
    expect(catalog.image.selectedRoute).toBeNull();
    expect(catalog.image.selectionIssue).toEqual(expectedIssue);
  });

  it('projects selection-required catalogs globally and maps resolver failure', async () => {
    const harness = makeHarness();

    await expect(harness.service.listRoutes()).resolves.toMatchObject({
      image: { status: 'selection_required', selectionIssue: null },
    });
    harness.providerResolver.listGenerationRoutes.mockRejectedValueOnce(new Error('resolver unavailable'));
    await expect(harness.service.listRoutes()).rejects.toMatchObject({ code: 'provider_error' });
  });

  it.each([
    ['unsupported prototype', { status: 'unsupported_prototype_schema' as const, projectId: 'project_v2' }],
    ['missing project', { status: 'not_found' as const, projectId: 'project_v2' }],
  ])('keeps %s distinct on V2 operational reads', async (_label, loadResult) => {
    const harness = makeHarness();
    harness.store.getProjectV2.mockResolvedValue(loadResult);

    await expect(
      harness.service.getGenerationReadiness({ projectId: 'project_v2', sectionIds: [] })
    ).rejects.toMatchObject({
      code: loadResult.status === 'unsupported_prototype_schema' ? 'unsupported_prototype_schema' : 'not_found',
    });
    await expect(harness.service.getProject('project_v2')).resolves.toEqual(loadResult);
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
  });

  it('rejects unavailable media seams before any storage work can be mistaken for success', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project, { includeMediaStore: false });
    const png = Buffer.from('89504e470d0a1a0a', 'hex');

    await expect(
      harness.service.importReferenceFromPath({
        projectId: project.id,
        clipId: 'clip_1',
        expectedRevision: project.revision,
        sourcePath: '/chosen/reference.png',
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    await expect(
      harness.service.detachBriefReference({
        projectId: project.id,
        assetId: 'reference_1',
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    await expect(
      harness.service.persistCapturedPoster({
        projectId: project.id,
        clipId: 'clip_1',
        videoAssetId: 'video_1',
        dataUrl: `data:image/png;base64,${png.toString('base64')}`,
        width: 1280,
        height: 720,
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(harness.onProjectUpdated).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid dimensions', { width: 0, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }],
    ['invalid data URL', { width: 1280, dataUrl: 'data:image/jpeg;base64,iVBORw0KGgo=' }],
    ['non-canonical base64', { width: 1280, dataUrl: 'data:image/png;base64,AAAA====' }],
  ])('rejects a captured poster with %s before media storage', async (_label, override) => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);

    await expect(
      harness.service.persistCapturedPoster({
        projectId: project.id,
        clipId: 'clip_1',
        videoAssetId: 'video_1',
        width: override.width,
        height: 720,
        dataUrl: override.dataUrl,
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.persistCapturedPosterV2).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown top-level key', { unexpected: true }],
    ['empty selection', { clipIds: [], routes: [] }],
    ['duplicate clips', { clipIds: ['clip_1', 'clip_1'] }],
    ['reference without prompts', { outputRole: 'reference', referencePrompts: [] }],
    [
      'take with reference prompts',
      { referencePrompts: [{ clipId: 'clip_1', prompt: 'Unexpected reference prompt' }] },
    ],
  ])('rejects a submit boundary with %s before resolver or manager work', async (_label, override) => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);
    const request = {
      projectId: project.id,
      expectedRevision: project.revision,
      clipIds: ['clip_1'],
      routes: [{ clipId: 'clip_1', choiceId: imageRoute.choiceId, kind: 'image' as const }],
      catalogVersion: 'catalog_v2',
      ...override,
    };

    await expect(harness.service.submitClips(request as never)).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(harness.submitClips).not.toHaveBeenCalled();
  });

  it.each([
    ['missing route', 'choice_missing', imageRoute, { providerId: imageRoute.providerId }],
    ['missing selection', imageRoute.choiceId, imageRoute, null],
    ['mismatched selection', imageRoute.choiceId, imageRoute, { providerId: 'provider_other' }],
    [
      'duration mismatch',
      imageRoute.choiceId,
      { ...imageRoute, constraints: { ...imageRoute.constraints, minDurationSeconds: 6 } },
      { providerId: imageRoute.providerId },
    ],
  ])('rejects a reviewed clip with %s before the paid manager boundary', async (_label, choiceId, route, selection) => {
    const project = makeSchema2ServiceProject();
    project.routing.image =
      selection === null
        ? null
        : {
            providerId: selection.providerId,
            adapterId: imageRoute.adapterId,
            model: imageRoute.model,
          };
    const harness = makeHarness(project);
    harness.providerResolver.listGenerationRoutes.mockResolvedValue({
      routes: [route],
      diagnostics: [{ status: 'available', route }],
      generationCatalogVersion: 'catalog_v2',
    });

    await expect(
      harness.service.submitClips({
        projectId: project.id,
        expectedRevision: project.revision,
        clipIds: ['clip_1'],
        routes: [{ clipId: 'clip_1', choiceId, kind: 'image' }],
        catalogVersion: 'catalog_v2',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
    expect(harness.submitClips).not.toHaveBeenCalled();
  });
});

describe('Studio MCP server', () => {
  it('keeps optional descriptor fallbacks bounded when project or catalog fields are absent', () => {
    const required = {
      [STUDIO_ENV.projectId]: 'project_1',
      [STUDIO_ENV.projectDir]: '/tmp/project_1',
      [STUDIO_ENV.pendingDir]: '/tmp/project_1/proposals/pending',
      [STUDIO_ENV.referencePendingDir]: '/tmp/project_1/reference-requests/pending',
    };

    expect(parseStudioServerEnv(required)).toMatchObject({ routeCatalog: null });
    expect(parseStudioServerEnv({ ...required, [STUDIO_ENV.routeCatalog]: '{invalid' })).toMatchObject({
      routeCatalog: null,
    });
    expect(
      parseStudioServerEnv({
        [STUDIO_ENV.projectId]: 'project_1',
        [STUDIO_ENV.pendingDir]: '/tmp/project_1/proposals/pending',
      })
    ).toBeNull();
  });

  it.each([
    ['storyboard reader', () => createReadStoryboardHandler(null)({})],
    ['proposal writer', () => createProposeStoryboardHandler(null)({ base_revision: 1, scene_order: [], scenes: {} })],
    ['rule writer', () => createProposeBriefRuleHandler(null)({ base_revision: 1, text: 'Rule', forbidden_terms: [] })],
    ['reference writer', () => createRequestReferenceImagesHandler(null)({ sceneIds: ['scene_1'] })],
  ] as const)('fails closed when the V1 %s has no project descriptor', async (_label, invoke) => {
    await expect(invoke()).resolves.toMatchObject({
      isError: true,
      content: [{ text: expect.stringMatching(/unavailable/i) }],
    });
  });

  it('publishes the direct edit contract through the real MCP tools/list boundary', async () => {
    const harness = await createStudioMcpProtocolHarness();
    try {
      const { tools } = await harness.client.listTools();
      const applyEdits = tools.find((tool) => tool.name === 'studio_apply_edits');
      const inputSchema = applyEdits?.inputSchema;
      const applyDescription = applyEdits?.description ?? '';
      const canonicalExample = applyDescription.match(/(\{"expectedRevision":8,"operations":\[[^]*\]\})\./)?.[1];
      const operationItems = inputSchema?.properties?.operations as { items?: Record<string, unknown> } | undefined;
      const operationVariants = (operationItems?.items?.anyOf ?? operationItems?.items?.oneOf) as
        | Array<{ properties?: { kind?: { const?: string } } }>
        | undefined;
      const advertisedValidator = new AjvJsonSchemaValidator().getValidator(inputSchema as never);
      const checkpointBatch = {
        expectedRevision: 8,
        operations: [
          { kind: 'set_brief', brief: 'Phase 2A checkpoint: direct free edits verified.' },
          { kind: 'edit_scene', sceneId: 'scene_1', changes: { title: 'Shot 1 - Phase 2A check' } },
          { kind: 'reorder_scenes', sceneOrder: ['scene_2', 'scene_1'] },
        ],
      };
      const legacyWholeProject = {
        base_revision: 8,
        scene_order: ['scene_2', 'scene_1'],
        scenes: {},
      };

      expect(inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        required: ['expectedRevision', 'operations'],
        properties: {
          expectedRevision: { type: 'integer' },
          operations: { type: 'array' },
        },
      });
      expect(operationVariants?.map((variant) => variant.properties?.kind?.const).sort()).toEqual([
        'add_scene',
        'edit_scene',
        'reorder_scenes',
        'select_take',
        'set_brief',
      ]);
      expect(operationVariants?.find((variant) => variant.properties?.kind?.const === 'edit_scene')).toMatchObject({
        required: ['kind', 'sceneId', 'changes'],
        properties: {
          changes: { anyOf: expect.any(Array) },
        },
      });
      expect(operationVariants?.find((variant) => variant.properties?.kind?.const === 'reorder_scenes')).toMatchObject({
        required: ['kind', 'sceneOrder'],
        properties: { sceneOrder: { type: 'array' } },
      });
      expect(advertisedValidator(checkpointBatch)).toMatchObject({ valid: true });
      expect(advertisedValidator(legacyWholeProject)).toMatchObject({ valid: false });
      expect(canonicalExample).toBeDefined();
      expect(JSON.parse(canonicalExample ?? '{}')).toEqual({
        expectedRevision: 8,
        operations: [
          { kind: 'set_brief', brief: '...' },
          { kind: 'edit_scene', sceneId: 'scene_1', changes: { title: '...' } },
          { kind: 'reorder_scenes', sceneOrder: ['scene_2', 'scene_1'] },
        ],
      });
      expect(applyDescription).toMatch(
        /direct patch contract, not legacy whole-project base_revision\/scene_order\/scenes/i
      );
      expect(applyDescription).toMatch(/never starts paid generation/i);
      expect(applyDescription).toMatch(/validation errors and unconfirmed results must not be retried/i);
      expect(
        advertisedValidator({
          expectedRevision: 8,
          operations: [{ kind: 'edit_scene', sceneId: 'scene_1', changes: {} }],
        })
      ).toMatchObject({ valid: false });
    } finally {
      await harness.close();
    }
  });

  it('rejects an add-and-reorder batch through the SDK before minting an ID or writing a mailbox record', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    const createId = vi.fn(() => 'command_should_not_be_minted');
    const harness = await createStudioMcpProtocolHarness(
      { projectId: 'project_1', projectDir, pendingDir: '', referencePendingDir: '' },
      { createId }
    );
    try {
      await expect(
        harness.client.callTool({
          name: 'studio_apply_edits',
          arguments: {
            expectedRevision: 8,
            operations: [
              {
                kind: 'add_scene',
                scene: {
                  title: 'Added scene',
                  purpose: 'Add a beat',
                  visualPrompt: 'A skyline at dawn',
                  narration: 'A new day begins.',
                  onScreenText: '',
                  mediaKind: 'image',
                  durationSeconds: 5,
                },
                beforeSceneId: null,
              },
              { kind: 'reorder_scenes', sceneOrder: ['scene_1'] },
            ],
          },
        })
      ).resolves.toMatchObject({
        isError: true,
        content: [{ text: expect.stringMatching(/add_scene and reorder_scenes cannot be combined/i) }],
      });
      expect(createId).not.toHaveBeenCalled();
      await expect(nodeFs.readdir(path.join(projectDir, 'commands'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await harness.close();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('registers the reference request tool with the approval-before-spend instruction', () => {
    const tool = vi.fn();
    const registerTool = vi.fn();

    registerStudioTools({ tool: tool as never, registerTool: registerTool as never }, null);

    const registration = tool.mock.calls.find(([name]) => name === 'studio_request_reference_images');
    expect(tool).toHaveBeenCalledTimes(5);
    expect(registerTool).toHaveBeenCalledTimes(2);
    expect(tool.mock.calls.length + registerTool.mock.calls.length).toBe(7);
    expect(registration?.[1]).toBe(
      'Request a supporting reference image for one or more scenes. This does NOT generate anything — it queues a request the user approves before any money is spent. One image per scene; do not request a scene that already has one unless the user asked you to replace it.'
    );
  });

  it('registers direct edits and exact status with strict bounded nested schemas', () => {
    const tool = vi.fn();
    const registerTool = vi.fn();
    registerStudioTools({ tool: tool as never, registerTool: registerTool as never }, null);
    const applyRegistration = registerTool.mock.calls.find(([name]) => name === 'studio_apply_edits');
    const statusRegistration = registerTool.mock.calls.find(([name]) => name === 'studio_get_command_status');
    const applySchema = applyRegistration?.[1].inputSchema as z.ZodType;
    const statusSchema = statusRegistration?.[1].inputSchema as z.ZodType;
    const validScene = {
      title: 'Opening',
      purpose: 'Set the scene',
      visualPrompt: 'A dawn skyline',
      narration: 'A new day begins.',
      onScreenText: '',
      mediaKind: 'image',
      durationSeconds: 5,
    };
    const valid = { expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'A sharper brief' }] };
    const invalidCases: Array<{ name: string; input: unknown }> = [
      { name: 'unknown top-level key', input: { ...valid, unknown: true } },
      { name: 'empty operations', input: { expectedRevision: 7, operations: [] } },
      {
        name: 'more than 32 operations',
        input: {
          expectedRevision: 7,
          operations: Array.from({ length: 33 }, (_, index) => ({ kind: 'set_brief', brief: `Brief ${index}` })),
        },
      },
      {
        name: 'empty edit patch',
        input: { expectedRevision: 7, operations: [{ kind: 'edit_scene', sceneId: 'scene_1', changes: {} }] },
      },
      {
        name: 'add and reorder mixture',
        input: {
          expectedRevision: 7,
          operations: [
            { kind: 'add_scene', scene: validScene, beforeSceneId: null },
            { kind: 'reorder_scenes', sceneOrder: ['scene_1'] },
          ],
        },
      },
      {
        name: 'caller-supplied add id',
        input: {
          expectedRevision: 7,
          operations: [{ kind: 'add_scene', sceneId: 'caller_id', scene: validScene, beforeSceneId: null }],
        },
      },
      {
        name: 'unknown nested scene key',
        input: {
          expectedRevision: 7,
          operations: [{ kind: 'add_scene', scene: { ...validScene, referenceAssetId: null }, beforeSceneId: null }],
        },
      },
      {
        name: 'unsafe scene id',
        input: {
          expectedRevision: 7,
          operations: [{ kind: 'select_take', sceneId: '../scene', assetId: 'take_1' }],
        },
      },
      {
        name: 'unbounded text',
        input: { expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'x'.repeat(16 * 1024 + 1) }] },
      },
    ];

    expect(applyRegistration).toBeDefined();
    expect(statusRegistration).toBeDefined();
    expect(applySchema.safeParse(valid).success).toBe(true);
    for (const invalidCase of invalidCases) {
      expect(applySchema.safeParse(invalidCase.input).success, invalidCase.name).toBe(false);
    }
    expect(statusSchema.safeParse({ commandId: 'command_1' }).success).toBe(true);
    expect(statusSchema.safeParse({ commandId: 'unsafe/id' }).success).toBe(false);
    expect(statusSchema.safeParse({ commandId: 'command_1', unknown: true }).success).toBe(false);
  });

  it('describes revision-first edits and explicit unconfirmed and indeterminate recovery without undo claims', () => {
    const registerTool = vi.fn();
    registerStudioTools({ tool: vi.fn() as never, registerTool: registerTool as never }, null);
    const applyDescription = String(
      registerTool.mock.calls.find(([name]) => name === 'studio_apply_edits')?.[1].description
    );
    const statusDescription = String(
      registerTool.mock.calls.find(([name]) => name === 'studio_get_command_status')?.[1].description
    );

    expect(applyDescription).toMatch(/read the current revision first/i);
    expect(applyDescription).toMatch(/unconfirmed.*must not be retried/i);
    expect(statusDescription).toMatch(/indeterminate.*must not be retried/i);
    expect(statusDescription).toMatch(/reread canonical state/i);
    expect(statusDescription).toMatch(/report uncertainty/i);
    expect(statusDescription).toMatch(/await explicit user direction/i);
    expect(`${applyDescription} ${statusDescription}`).not.toMatch(/undo|reversib/i);
  });

  it('lets SDK validation reject before id minting and returns commandId from every accepted handler outcome', async () => {
    const createId = vi.fn(() => 'command_accepted');
    const registerTool = vi.fn();
    registerStudioTools({ tool: vi.fn() as never, registerTool: registerTool as never }, null, {
      createId,
      now: () => Date.parse('2026-08-17T01:02:03.000Z'),
      sleep: async () => undefined,
    });
    const applyRegistration = registerTool.mock.calls.find(([name]) => name === 'studio_apply_edits');
    const statusRegistration = registerTool.mock.calls.find(([name]) => name === 'studio_get_command_status');
    const applySchema = applyRegistration?.[1].inputSchema as z.ZodType;
    const applyHandler = applyRegistration?.[2] as (input: unknown) => Promise<{ content: Array<{ text: string }> }>;
    const statusHandler = statusRegistration?.[2] as (input: unknown) => Promise<{ content: Array<{ text: string }> }>;

    expect(applySchema.safeParse({ expectedRevision: 7, operations: [], unknown: true }).success).toBe(false);
    expect(createId).not.toHaveBeenCalled();

    const accepted = applySchema.parse({
      expectedRevision: 7,
      operations: [{ kind: 'set_brief', brief: 'Accepted by the schema' }],
    });
    const applyResult = JSON.parse((await applyHandler(accepted)).content[0].text) as Record<string, unknown>;
    const statusResult = JSON.parse((await statusHandler({ commandId: 'command_status' })).content[0].text) as Record<
      string,
      unknown
    >;

    expect(applyResult).toMatchObject({ status: 'storage_error', commandId: 'command_accepted' });
    expect(statusResult).toMatchObject({ status: 'storage_error', commandId: 'command_status' });
    expect(createId).toHaveBeenCalledTimes(2);
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
        selectionIssue: null,
        options: [routeOption('image', { model: 'image-model' })],
      },
      video: {
        status: 'ready',
        selected: null,
        selectedRoute: null,
        selectionIssue: null,
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
      maxConditioningImages: 0,
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
      image: { status: 'setup_required', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
      video: { status: 'setup_required', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
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

  it('read_storyboard exposes ordered Brief references and concrete scene plates without operational state', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    const projectFixture = structuredClone(studioServerProjectFixture);
    projectFixture.scenes.scene_1.referenceAssetId = 'plate_1';
    projectFixture.assets = {
      cast_1: {
        id: 'cast_1',
        projectId: 'project_1',
        sceneId: null,
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'imports', fileName: 'cast_1.png' },
        byteSize: 101,
        sha256: 'a'.repeat(64),
        briefReferenceRole: 'cast',
        briefReferenceLabel: 'Lead Hero',
        createdAt: '2026-08-15T01:00:00.000Z',
      },
      look_1: {
        id: 'look_1',
        projectId: 'project_1',
        sceneId: null,
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'imports', fileName: 'look_1.png' },
        byteSize: 102,
        sha256: 'b'.repeat(64),
        briefReferenceRole: 'look',
        briefReferenceLabel: 'Golden Atrium',
        createdAt: '2026-08-15T01:01:00.000Z',
      },
      plate_1: {
        id: 'plate_1',
        projectId: 'project_1',
        sceneId: 'scene_1',
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'references', fileName: 'plate_1.png' },
        byteSize: 103,
        sha256: 'c'.repeat(64),
        sourceVisualPrompt: 'Private provenance prompt',
        sourceReferenceAssetIds: ['cast_1', 'look_1'],
        sourceAspectRatio: '16:9',
        sourceResolution: '720p',
        createdAt: '2026-08-15T01:02:00.000Z',
      },
    };
    projectFixture.jobs = {
      job_1: {
        status: 'running',
        progress: 50,
        error: null,
        provider: { providerId: 'private_provider', adapterId: 'private_adapter' },
        credential: 'private_credential',
        referenceInputSnapshot: { conditioningReferenceAssetIds: ['cast_1', 'look_1'] },
      },
    };
    await writeFile(path.join(dir, 'project.json'), JSON.stringify(projectFixture));
    const handler = createReadStoryboardHandler({
      projectId: 'project_1',
      projectDir: dir,
      pendingDir: '',
      referencePendingDir: '',
    });

    const result = await handler({});
    const view = JSON.parse(result.content[0].text) as {
      briefReferences: unknown;
      scenes: Record<string, Record<string, unknown>>;
    };
    expect(view.briefReferences).toEqual([
      { id: 'cast_1', label: 'Lead Hero', role: 'cast' },
      { id: 'look_1', label: 'Golden Atrium', role: 'look' },
    ]);
    expect(view.scenes.scene_1).toMatchObject({ referenceAssetId: 'plate_1' });
    const serialized = JSON.stringify(view);
    for (const forbidden of [
      'path',
      'sha256',
      'byteSize',
      'sourceVisualPrompt',
      'sourceReferenceAssetIds',
      'sourceAspectRatio',
      'sourceResolution',
      'referenceInputSnapshot',
      'status',
      'progress',
      'error',
      'provider',
      'providerId',
      'adapterId',
      'credential',
      'jobIds',
      'providerJobId',
      'idempotencyKey',
      'managedAsset',
      'fileName',
    ]) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
  });

  it('read_storyboard reports legacy capacity without treating a 25-scene manifest as unavailable', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    const sceneIds = Array.from({ length: 25 }, (_, index) => `scene_${index + 1}`);
    const projectFixture = {
      ...structuredClone(studioServerProjectFixture),
      sceneOrder: sceneIds,
      scenes: Object.fromEntries(
        sceneIds.map((sceneId) => [sceneId, { ...studioServerProjectFixture.scenes.scene_1, id: sceneId }])
      ),
    };
    await writeFile(path.join(dir, 'project.json'), JSON.stringify(projectFixture));

    const result = await createReadStoryboardHandler({
      projectId: 'project_1',
      projectDir: dir,
      pendingDir: '',
      referencePendingDir: '',
    })({});
    const view = JSON.parse(result.content[0].text) as { sceneCapacity: unknown; sceneOrder: string[] };

    expect(result.isError).toBeUndefined();
    expect(view.sceneOrder).toHaveLength(25);
    expect(view.sceneCapacity).toEqual({ current: 25, maximum: 24, remaining: 0, overCapacity: true });
  });

  it('read_storyboard projects canonical takes selected-first, newest-next, id-ascending, and capped at 24', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    const projectFixture = structuredClone(studioServerProjectFixture);
    const selected = {
      id: 'take_selected',
      projectId: 'project_1',
      sceneId: 'scene_1',
      mediaKind: 'image' as const,
      mimeType: 'image/png',
      managedAsset: { collection: 'assets' as const, fileName: 'selected.png' },
      byteSize: 1,
      sha256: 'a'.repeat(64),
      createdAt: '2026-08-15T00:00:00.000Z',
    };
    const regular = Array.from({ length: 25 }, (_, index) => ({
      ...selected,
      id: `take_${String(index).padStart(2, '0')}`,
      managedAsset: { collection: 'assets' as const, fileName: `take_${String(index).padStart(2, '0')}.png` },
      createdAt: '2026-08-15T01:00:00.000Z',
    }));
    const newest = {
      ...selected,
      id: 'take_newest',
      managedAsset: { collection: 'assets' as const, fileName: 'newest.png' },
      createdAt: '2026-08-15T02:00:00.000Z',
    };
    const invalid = {
      ...selected,
      id: 'plate_not_a_take',
      managedAsset: { collection: 'references' as const, fileName: 'plate.png' },
    };
    projectFixture.scenes.scene_1.selectedAssetId = selected.id;
    projectFixture.scenes.scene_1.assetIds = [
      invalid.id,
      ...regular.map(({ id }) => id).reverse(),
      newest.id,
      selected.id,
    ];
    projectFixture.assets = Object.fromEntries(
      [selected, newest, invalid, ...regular].map((asset) => [asset.id, asset])
    );
    projectFixture.sceneOrder.push('scene_invalid');
    projectFixture.scenes.scene_invalid = {
      ...projectFixture.scenes.scene_1,
      id: 'scene_invalid',
      selectedAssetId: invalid.id,
      assetIds: [invalid.id],
    };
    await writeFile(path.join(dir, 'project.json'), JSON.stringify(projectFixture));

    const result = await createReadStoryboardHandler({
      projectId: 'project_1',
      projectDir: dir,
      pendingDir: '',
      referencePendingDir: '',
    })({});
    const view = JSON.parse(result.content[0].text) as {
      scenes: Record<string, { selectedTakeId: string | null; availableTakeIds: string[] }>;
    };

    expect(view.scenes.scene_1.availableTakeIds).toEqual([
      'take_selected',
      'take_newest',
      'take_00',
      'take_01',
      'take_02',
      'take_03',
      'take_04',
      'take_05',
      'take_06',
      'take_07',
      'take_08',
      'take_09',
      'take_10',
      'take_11',
      'take_12',
      'take_13',
      'take_14',
      'take_15',
      'take_16',
      'take_17',
      'take_18',
      'take_19',
      'take_20',
      'take_21',
    ]);
    expect(view.scenes.scene_1.selectedTakeId).toBe('take_selected');
    expect(view.scenes.scene_invalid).toMatchObject({ selectedTakeId: null, availableTakeIds: [] });
  });

  it('shows the Director the project rules, fresh from disk on every call', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    await writeFile(
      path.join(dir, 'project.json'),
      JSON.stringify({
        ...studioServerProjectFixture,
        rules: [
          {
            id: 'rule_1',
            scope: 'project',
            text: 'No competitor logos.',
            predicate: { kind: 'forbidden_terms', terms: ['acme'] },
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ],
      })
    );
    const handler = createReadStoryboardHandler({
      projectId: 'project_1',
      projectDir: dir,
      pendingDir: '',
      referencePendingDir: '',
    });

    const view = JSON.parse((await handler({})).content[0].text) as { rules: unknown };

    expect(view.rules).toEqual([
      { scope: 'project', text: 'No competitor logos.', enforced: true, forbiddenTerms: ['acme'] },
    ]);
  });

  it('shows a context-only project rule as unenforced without forbidden terms', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    await writeFile(
      path.join(dir, 'project.json'),
      JSON.stringify({
        ...studioServerProjectFixture,
        rules: [
          {
            id: 'rule_1',
            scope: 'project',
            text: 'Keep the tone optimistic.',
            predicate: null,
            createdAt: '2026-08-13T00:00:00.000Z',
          },
        ],
      })
    );
    const handler = createReadStoryboardHandler({
      projectId: 'project_1',
      projectDir: dir,
      pendingDir: '',
      referencePendingDir: '',
    });

    const view = JSON.parse((await handler({})).content[0].text) as { rules: unknown };

    expect(view.rules).toEqual([{ scope: 'project', text: 'Keep the tone optimistic.', enforced: false }]);
  });

  it('reads a manifest written before rules existed as an empty list, not an unavailable project', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
    const raw = { ...studioServerProjectFixture } as Record<string, unknown>;
    delete raw.rules;
    await writeFile(path.join(dir, 'project.json'), JSON.stringify(raw));
    const handler = createReadStoryboardHandler({
      projectId: 'project_1',
      projectDir: dir,
      pendingDir: '',
      referencePendingDir: '',
    });

    const result = await handler({});

    // The subprocess does not run migrateSchemaV1Project, and nothing rewrites project.json on open.
    // Without the normalisation in readProject this returns isError: true and the Director loses
    // read_storyboard for every project that predates this change.
    expect(result.isError).toBeUndefined();
    const view = JSON.parse(result.content[0].text) as { rules: unknown; sceneOrder: string[] };
    expect(view.rules).toEqual([]);
    expect(view.sceneOrder).toEqual(['scene_1']);
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

const editableSectionV2 = () => ({
  title: 'Opening',
  storyLine: 'Introduce the product',
  visualPrompt: 'Warm sunrise over a quiet city',
});

const editableClipV2 = (mediaKind: 'image' | 'video' = 'image') => ({
  shotPrompt: 'A wide establishing shot',
  narration: '',
  onScreenText: '',
  mediaKind,
  durationSeconds: mediaKind === 'video' ? 4 : 5,
  referenceAssetId: null,
});

const capturePendingProjectAuthorityV2 = async (projectRoot: string) => {
  const canonicalRoot = await nodeFs.realpath(projectRoot);
  const stats = await nodeFs.lstat(canonicalRoot);
  return { canonicalRoot, rootIdentity: { dev: stats.dev, ino: stats.ino } };
};

const createPendingQueueFixtureV2 = async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'studio-pending-v2-boundary-'));
  const familyRoot = path.join(projectRoot, 'proposals');
  const pendingDir = path.join(familyRoot, 'pending');
  const slotsDir = path.join(familyRoot, 'slots');
  await mkdir(pendingDir, { recursive: true });
  await mkdir(slotsDir);
  return { projectRoot, pendingDir, slotsDir };
};

const pendingRequestInputV2 = (pendingDir: string, recordId = 'request_boundary') => ({
  pendingDir,
  recordId,
  record: { marker: recordId },
  slotRecordKey: 'requestId' as const,
  capacityMessage: 'full',
  tooLargeMessage: 'too large',
});

describe('Studio MCP schema-2 server', () => {
  it('publishes all Section/Clip operations as strict bounded schemas through real MCP tools/list', async () => {
    const harness = await createStudioMcpProtocolHarnessV2();
    try {
      const { tools } = await harness.client.listTools();
      const applyEdits = tools.find((tool) => tool.name === 'studio_apply_edits');
      const applySchema = applyEdits?.inputSchema;
      const operationItems = applySchema?.properties?.operations as { items?: Record<string, unknown> } | undefined;
      const operationVariants = (operationItems?.items?.anyOf ?? operationItems?.items?.oneOf) as
        | Array<{
            additionalProperties?: boolean;
            required?: string[];
            properties?: Record<string, { const?: string; additionalProperties?: boolean }>;
          }>
        | undefined;
      const advertisedValidator = new AjvJsonSchemaValidator().getValidator(applySchema as never);
      const canonicalExample = (applyEdits?.description ?? '').match(
        /(\{"expectedRevision":8,"operations":\[[^]*\]\})\./
      )?.[1];

      expect(tools.map(({ name }) => name).toSorted()).toEqual([
        'propose_brief_rule',
        'propose_storyboard',
        'read_storyboard',
        'studio_apply_edits',
        'studio_get_command_status',
        'studio_list_routes',
        'studio_request_reference_images',
      ]);
      expect(tools.every((tool) => Object.keys(tool.inputSchema).length > 0)).toBe(true);
      expect(applySchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        required: ['expectedRevision', 'operations'],
      });
      expect(operationVariants?.map((variant) => variant.properties?.kind?.const).toSorted()).toEqual([
        'add_clip',
        'add_section',
        'delete_clip',
        'edit_clip',
        'edit_section',
        'park_section',
        'park_take',
        'remove_shelf_alias',
        'reorder_clips',
        'reorder_sections',
        'reorder_shelf',
        'restore_section',
        'select_shelved_take',
        'select_take',
        'set_brief',
      ]);
      const addSection = operationVariants?.find((variant) => variant.properties?.kind?.const === 'add_section');
      const addClip = operationVariants?.find((variant) => variant.properties?.kind?.const === 'add_clip');
      expect(addSection).toMatchObject({
        additionalProperties: false,
        required: ['kind', 'section', 'firstClip', 'beforeSectionId'],
      });
      expect(addSection?.properties).not.toHaveProperty('sectionId');
      expect(addSection?.properties).not.toHaveProperty('firstClipId');
      expect(addClip).toMatchObject({
        additionalProperties: false,
        required: ['kind', 'sectionId', 'clip', 'beforeClipId'],
      });
      expect(addClip?.properties).not.toHaveProperty('clipId');

      const canonicalBatch = {
        expectedRevision: 8,
        operations: [
          { kind: 'set_brief', brief: '...' },
          { kind: 'edit_section', sectionId: 'section_1', changes: { title: '...' } },
          { kind: 'edit_clip', clipId: 'clip_1', changes: { shotPrompt: '...' } },
          { kind: 'reorder_sections', sectionOrder: ['section_2', 'section_1'] },
        ],
      };
      expect(advertisedValidator(canonicalBatch)).toMatchObject({ valid: true });
      expect(
        advertisedValidator({
          ...canonicalBatch,
          operations: [
            {
              kind: 'add_clip',
              sectionId: 'section_1',
              clipId: 'caller_id',
              clip: editableClipV2(),
              beforeClipId: null,
            },
          ],
        })
      ).toMatchObject({ valid: false });
      expect(canonicalExample).toBeDefined();
      expect(JSON.parse(canonicalExample ?? '{}')).toEqual(canonicalBatch);
      expect(applyEdits?.description).toMatch(/never starts paid generation/i);

      const referenceSchema = tools.find((tool) => tool.name === 'studio_request_reference_images')?.inputSchema;
      const referenceValidator = new AjvJsonSchemaValidator().getValidator(referenceSchema as never);
      expect(referenceSchema).toMatchObject({ type: 'object', additionalProperties: false, required: ['clipIds'] });
      expect(referenceValidator({ clipIds: Array.from({ length: 24 }, (_, index) => `clip_${index}`) })).toMatchObject({
        valid: true,
      });
      expect(referenceValidator({ clipIds: [], unknown: true })).toMatchObject({ valid: false });
    } finally {
      await harness.close();
    }
  });

  it('advertises uniqueness, conflict, and video-duration rules that an AJV client can enforce', async () => {
    const harness = await createStudioMcpProtocolHarnessV2();
    try {
      const { tools } = await harness.client.listTools();
      const applySchema = tools.find((tool) => tool.name === 'studio_apply_edits')?.inputSchema;
      const proposalSchema = tools.find((tool) => tool.name === 'propose_storyboard')?.inputSchema;
      const referenceSchema = tools.find((tool) => tool.name === 'studio_request_reference_images')?.inputSchema;
      const applyValidator = new AjvJsonSchemaValidator().getValidator(applySchema as never);
      const proposalValidator = new AjvJsonSchemaValidator().getValidator(proposalSchema as never);
      const referenceValidator = new AjvJsonSchemaValidator().getValidator(referenceSchema as never);
      const invalidApplyInputs = [
        {
          expectedRevision: 7,
          operations: [{ kind: 'reorder_sections', sectionOrder: ['section_1', 'section_1'] }],
        },
        {
          expectedRevision: 7,
          operations: [
            {
              kind: 'reorder_clips',
              sectionId: 'section_1',
              clipOrder: ['clip_1', 'clip_1'],
            },
          ],
        },
        {
          expectedRevision: 7,
          operations: [
            {
              kind: 'reorder_shelf',
              shelf: [
                { kind: 'asset', assetId: 'take_1' },
                { kind: 'asset', assetId: 'take_1' },
              ],
            },
          ],
        },
        {
          expectedRevision: 7,
          operations: [
            { kind: 'add_section', section: editableSectionV2(), firstClip: editableClipV2(), beforeSectionId: null },
            { kind: 'reorder_sections', sectionOrder: ['section_1'] },
          ],
        },
        {
          expectedRevision: 7,
          operations: [
            {
              kind: 'add_clip',
              sectionId: 'section_1',
              clip: { ...editableClipV2('video'), durationSeconds: 3 },
              beforeClipId: null,
            },
          ],
        },
        {
          expectedRevision: 7,
          operations: [
            {
              kind: 'edit_clip',
              clipId: 'clip_1',
              changes: { mediaKind: 'video', durationSeconds: 3 },
            },
          ],
        },
      ];

      for (const input of invalidApplyInputs) expect(applyValidator(input)).toMatchObject({ valid: false });
      expect(
        proposalValidator({
          base_revision: 7,
          operations: [
            {
              kind: 'add_section',
              sectionId: 'section_new',
              section: editableSectionV2(),
              firstClipId: 'clip_new',
              firstClip: editableClipV2(),
              beforeSectionId: null,
            },
            { kind: 'reorder_sections', sectionOrder: ['section_1'] },
          ],
        })
      ).toMatchObject({ valid: false });
      expect(referenceValidator({ clipIds: ['clip_1', 'clip_1'] })).toMatchObject({ valid: false });
    } finally {
      await harness.close();
    }
  });

  it('documents the two deliberate tools/list supersets while enforcing them before handlers', async () => {
    const harness = await createStudioMcpProtocolHarnessV2();
    try {
      const { tools } = await harness.client.listTools();
      const applyTool = tools.find((tool) => tool.name === 'studio_apply_edits');
      const proposalTool = tools.find((tool) => tool.name === 'propose_storyboard');
      const applyValidator = new AjvJsonSchemaValidator().getValidator(applyTool?.inputSchema as never);
      const proposalValidator = new AjvJsonSchemaValidator().getValidator(proposalTool?.inputSchema as never);
      const sameSectionApply = {
        expectedRevision: 7,
        operations: [
          { kind: 'add_clip', sectionId: 'section_1', clip: editableClipV2(), beforeClipId: null },
          { kind: 'reorder_clips', sectionId: 'section_1', clipOrder: ['clip_1'] },
        ],
      };
      const differentSectionApply = {
        expectedRevision: 7,
        operations: [
          { kind: 'add_clip', sectionId: 'section_1', clip: editableClipV2(), beforeClipId: null },
          { kind: 'reorder_clips', sectionId: 'section_2', clipOrder: ['clip_2'] },
        ],
      };
      const sameSectionProposal = {
        base_revision: 7,
        operations: [
          {
            kind: 'add_clip',
            sectionId: 'section_1',
            clipId: 'clip_new',
            clip: editableClipV2(),
            beforeClipId: null,
          },
          { kind: 'reorder_clips', sectionId: 'section_1', clipOrder: ['clip_1'] },
        ],
      };
      const differentSectionProposal = {
        ...sameSectionProposal,
        operations: [
          sameSectionProposal.operations[0],
          { ...sameSectionProposal.operations[1], sectionId: 'section_2' },
        ],
      };
      const oversizedOperations = Array.from({ length: 32 }, (_, index) => ({
        kind: 'set_brief',
        brief: `${index}:${'x'.repeat(16 * 1024 - String(index).length - 1)}`,
      }));
      const oversizedApply = { expectedRevision: 7, operations: oversizedOperations };
      const oversizedProposal = { base_revision: 7, operations: oversizedOperations };

      expect(applyValidator(sameSectionApply)).toMatchObject({ valid: true });
      expect(applyValidator(differentSectionApply)).toMatchObject({ valid: true });
      expect(applyValidator(oversizedApply)).toMatchObject({ valid: true });
      expect(studioApplyEditsInputSchemaV2.safeParse(sameSectionApply).success).toBe(false);
      expect(studioApplyEditsInputSchemaV2.safeParse(differentSectionApply).success).toBe(true);
      expect(studioApplyEditsInputSchemaV2.safeParse(oversizedApply).success).toBe(false);

      expect(proposalValidator(sameSectionProposal)).toMatchObject({ valid: true });
      expect(proposalValidator(differentSectionProposal)).toMatchObject({ valid: true });
      expect(proposalValidator(oversizedProposal)).toMatchObject({ valid: true });
      expect(studioProposeStoryboardInputSchemaV2.safeParse(sameSectionProposal).success).toBe(false);
      expect(studioProposeStoryboardInputSchemaV2.safeParse(differentSectionProposal).success).toBe(true);
      expect(studioProposeStoryboardInputSchemaV2.safeParse(oversizedProposal).success).toBe(false);

      for (const description of [applyTool?.description, proposalTool?.description]) {
        expect(description).toMatch(/same section/i);
        expect(description).toMatch(/256 KiB/i);
      }
    } finally {
      await harness.close();
    }
  });

  it('accepts every V2 operation independently and rejects mutation-sensitive malformed batches', () => {
    const validOperations = [
      { kind: 'set_brief', brief: 'A concise launch story' },
      { kind: 'add_section', section: editableSectionV2(), firstClip: editableClipV2(), beforeSectionId: null },
      { kind: 'edit_section', sectionId: 'section_1', changes: { title: 'A new opening' } },
      { kind: 'reorder_sections', sectionOrder: ['section_2', 'section_1'] },
      { kind: 'park_section', sectionId: 'section_2' },
      { kind: 'restore_section', sectionId: 'section_2', beforeSectionId: 'section_1' },
      { kind: 'add_clip', sectionId: 'section_1', clip: editableClipV2(), beforeClipId: null },
      { kind: 'edit_clip', clipId: 'clip_1', changes: { shotPrompt: 'A tighter shot' } },
      { kind: 'delete_clip', clipId: 'clip_2' },
      { kind: 'reorder_clips', sectionId: 'section_1', clipOrder: ['clip_2', 'clip_1'] },
      { kind: 'park_take', clipId: 'clip_1', assetId: 'take_1' },
      { kind: 'select_shelved_take', clipId: 'clip_1', assetId: 'take_2' },
      { kind: 'remove_shelf_alias', assetId: 'take_3' },
      { kind: 'reorder_shelf', shelf: [{ kind: 'asset', assetId: 'take_3' }] },
      { kind: 'reorder_shelf', shelf: [{ kind: 'section', sectionId: 'section_2' }] },
      { kind: 'select_take', clipId: 'clip_1', assetId: 'take_1' },
    ];
    for (const operation of validOperations) {
      expect(
        studioApplyEditsInputSchemaV2.safeParse({ expectedRevision: 7, operations: [operation] }).success,
        operation.kind
      ).toBe(true);
    }

    const invalidBatches = [
      { expectedRevision: 7, operations: [] },
      {
        expectedRevision: 7,
        operations: Array.from({ length: 33 }, (_, index) => ({ kind: 'set_brief', brief: `Brief ${index}` })),
      },
      { expectedRevision: 7, operations: [{ kind: 'edit_section', sectionId: 'section_1', changes: {} }] },
      { expectedRevision: 7, operations: [{ kind: 'edit_clip', clipId: 'clip_1', changes: {} }] },
      { expectedRevision: 7, operations: [{ kind: 'park_section', sectionId: '../section' }] },
      {
        expectedRevision: 7,
        operations: [
          {
            kind: 'add_section',
            sectionId: 'caller_section',
            section: editableSectionV2(),
            firstClip: editableClipV2(),
            beforeSectionId: null,
          },
        ],
      },
      {
        expectedRevision: 7,
        operations: [
          {
            kind: 'add_clip',
            sectionId: 'section_1',
            clip: { ...editableClipV2('video'), durationSeconds: 3 },
            beforeClipId: null,
          },
        ],
      },
      {
        expectedRevision: 7,
        operations: [
          {
            kind: 'add_clip',
            sectionId: 'section_1',
            clip: { ...editableClipV2('video'), durationSeconds: 16 },
            beforeClipId: null,
          },
        ],
      },
      {
        expectedRevision: 7,
        operations: [{ kind: 'edit_clip', clipId: 'clip_1', changes: { mediaKind: 'video', durationSeconds: 3 } }],
      },
      {
        expectedRevision: 7,
        operations: [{ kind: 'edit_clip', clipId: 'clip_1', changes: { mediaKind: 'video', durationSeconds: 16 } }],
      },
      {
        expectedRevision: 7,
        operations: [
          { kind: 'add_section', section: editableSectionV2(), firstClip: editableClipV2(), beforeSectionId: null },
          { kind: 'reorder_sections', sectionOrder: ['section_1'] },
        ],
      },
      {
        expectedRevision: 7,
        operations: [
          { kind: 'add_clip', sectionId: 'section_1', clip: editableClipV2(), beforeClipId: null },
          { kind: 'reorder_clips', sectionId: 'section_1', clipOrder: ['clip_1'] },
        ],
      },
      { expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Valid', unknown: true }] },
      { expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Valid' }], unknown: true },
    ];
    for (const input of invalidBatches) expect(studioApplyEditsInputSchemaV2.safeParse(input).success).toBe(false);

    expect(
      studioApplyEditsInputSchemaV2.safeParse({
        expectedRevision: 7,
        operations: [
          { kind: 'add_clip', sectionId: 'section_1', clip: editableClipV2(), beforeClipId: null },
          { kind: 'reorder_clips', sectionId: 'section_2', clipOrder: ['clip_2'] },
        ],
      }).success
    ).toBe(true);
    expect(
      studioProposeStoryboardInputSchemaV2.safeParse({
        base_revision: 7,
        operations: [
          {
            kind: 'add_section',
            sectionId: 'section_new',
            section: editableSectionV2(),
            firstClipId: 'clip_new',
            firstClip: editableClipV2(),
            beforeSectionId: null,
          },
        ],
      }).success
    ).toBe(true);
    expect(
      studioProposeStoryboardInputSchemaV2.safeParse({
        base_revision: 7,
        operations: [
          {
            kind: 'add_clip',
            sectionId: 'section_1',
            clipId: 'clip_new',
            clip: editableClipV2(),
            beforeClipId: null,
          },
          { kind: 'reorder_clips', sectionId: 'section_1', clipOrder: ['clip_1'] },
        ],
      }).success
    ).toBe(false);
    expect(
      studioProposeStoryboardInputSchemaV2.safeParse({
        base_revision: 7,
        operations: [{ kind: 'set_brief', brief: 'Valid', unknown: true }],
      }).success
    ).toBe(false);
    for (const clipIds of [
      [],
      Array.from({ length: 25 }, (_, index) => `clip_${index}`),
      ['clip_1', 'clip_1'],
      ['unsafe/clip'],
    ]) {
      expect(studioRequestReferenceImagesInputSchemaV2.safeParse({ clipIds }).success).toBe(false);
    }
  });

  it('rejects conflicting add/reorder commands through the SDK before IDs or mailbox IO', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-'));
    const ids = ['command_valid', 'clip_new', 'lease_valid'];
    const createId = vi.fn(() => ids.shift() ?? 'lease_fallback');
    const harness = await createStudioMcpProtocolHarnessV2(
      { projectId: 'project_v2', projectDir, pendingDir: '', referencePendingDir: '' },
      { createId }
    );
    try {
      for (const operations of [
        [
          { kind: 'add_section', section: editableSectionV2(), firstClip: editableClipV2(), beforeSectionId: null },
          { kind: 'reorder_sections', sectionOrder: ['section_1'] },
        ],
        [
          { kind: 'add_clip', sectionId: 'section_1', clip: editableClipV2(), beforeClipId: null },
          { kind: 'reorder_clips', sectionId: 'section_1', clipOrder: ['clip_1'] },
        ],
      ]) {
        // The second rejection must observe that the first rejection minted nothing.
        // eslint-disable-next-line no-await-in-loop
        await expect(
          harness.client.callTool({ name: 'studio_apply_edits', arguments: { expectedRevision: 7, operations } })
        ).resolves.toMatchObject({ isError: true });
      }
      expect(createId).not.toHaveBeenCalled();
      await expect(nodeFs.readdir(path.join(projectDir, 'commands'))).rejects.toMatchObject({ code: 'ENOENT' });

      const unrelated = await harness.client.callTool({
        name: 'studio_apply_edits',
        arguments: {
          expectedRevision: 7,
          operations: [
            { kind: 'add_clip', sectionId: 'section_1', clip: editableClipV2(), beforeClipId: null },
            { kind: 'reorder_clips', sectionId: 'section_2', clipOrder: ['clip_2'] },
          ],
        },
      });
      expect(JSON.parse(String(unrelated.content[0]?.type === 'text' ? unrelated.content[0].text : '{}'))).toEqual({
        status: 'storage_error',
        commandId: 'command_valid',
      });
      expect(createId).toHaveBeenCalledTimes(3);
    } finally {
      await harness.close();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('rejects maximum-count oversized commands and proposals before IDs or sidecar IO', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-pre-handler-'));
    const createId = vi.fn(() => 'unexpected_id');
    const config = {
      projectId: 'project_v2',
      projectDir,
      pendingDir: path.join(projectDir, 'proposals', 'pending'),
      referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
    };
    const harness = await createStudioMcpProtocolHarnessV2(config, { createId });
    const operations = Array.from({ length: 32 }, (_, index) => ({
      kind: 'set_brief',
      brief: `${index}:${'x'.repeat(16 * 1024 - String(index).length - 1)}`,
    }));
    try {
      await expect(
        harness.client.callTool({
          name: 'studio_apply_edits',
          arguments: { expectedRevision: 7, operations },
        })
      ).resolves.toMatchObject({ isError: true });
      await expect(
        harness.client.callTool({
          name: 'propose_storyboard',
          arguments: { base_revision: 7, operations },
        })
      ).resolves.toMatchObject({ isError: true });
      expect(createId).not.toHaveBeenCalled();
      await expect(nodeFs.lstat(path.join(projectDir, 'commands'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(nodeFs.lstat(path.join(projectDir, 'proposals'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await harness.close();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('projects validated Section/Clip state with selected-first bounded canonical takes', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-'));
    const project = makeSchema2ServiceProject();
    const assets = Array.from({ length: 26 }, (_, index): StudioAssetV2 => {
      const id = `take_${String(index + 1).padStart(2, '0')}`;
      return {
        id,
        projectId: project.id,
        clipId: 'clip_1',
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'assets', fileName: `${id}.png` },
        byteSize: 1,
        sha256: 'a'.repeat(64),
        createdAt: '2026-08-17T00:00:00.000Z',
      };
    });
    const briefReferences: StudioAssetV2[] = [
      ['cast_b', 'cast', 'Second cast'],
      ['cast_a', 'cast', 'First cast'],
      ['look_a', 'look', 'Golden look'],
    ].map(([id, role, label]) => ({
      id: id!,
      projectId: project.id,
      clipId: null,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: `${id}.png` },
      byteSize: 1,
      sha256: 'b'.repeat(64),
      briefReferenceRole: role as 'cast' | 'look',
      briefReferenceLabel: label!,
      createdAt: '2026-08-17T00:00:00.000Z',
    }));
    project.assets = Object.fromEntries([...assets, ...briefReferences].map((asset) => [asset.id, asset]));
    project.clips.clip_1.assetIds = assets.map(({ id }) => id);
    project.clips.clip_1.selectedAssetId = 'take_26';
    project.rules = [
      {
        id: 'rule_context',
        scope: 'project',
        text: 'Keep the tone optimistic.',
        predicate: null,
        createdAt: '2026-08-17T00:00:00.000Z',
      },
      {
        id: 'rule_enforced',
        scope: 'project',
        text: 'Never show competitors.',
        predicate: { kind: 'forbidden_terms', terms: ['competitor'] },
        createdAt: '2026-08-17T00:00:01.000Z',
      },
    ];
    await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));

    const result = await createReadStoryboardHandlerV2({
      projectId: project.id,
      projectDir,
      pendingDir: '',
      referencePendingDir: '',
    })({});
    const view = JSON.parse(result.content[0].text) as {
      sectionOrder: string[];
      sections: Record<string, { clipOrder: string[] }>;
      clips: Record<string, { selectedTakeId: string | null; availableTakeIds: string[] }>;
      shelf: unknown[];
      briefReferences: unknown[];
      rules: unknown[];
    };

    expect(result.isError).toBeUndefined();
    expect(view.sectionOrder).toEqual(['section_1', 'section_2']);
    expect(view.sections.section_1.clipOrder).toEqual(['clip_1']);
    expect(view.clips.clip_1).toMatchObject({ selectedTakeId: 'take_26' });
    expect(view.clips.clip_1.availableTakeIds).toEqual([
      'take_26',
      ...Array.from({ length: 23 }, (_, index) => `take_${String(index + 1).padStart(2, '0')}`),
    ]);
    expect(view.shelf).toEqual([]);
    expect(view.briefReferences).toEqual([
      { id: 'cast_a', label: 'First cast', role: 'cast' },
      { id: 'cast_b', label: 'Second cast', role: 'cast' },
      { id: 'look_a', label: 'Golden look', role: 'look' },
    ]);
    expect(view.rules).toEqual([
      { scope: 'project', text: 'Keep the tone optimistic.', enforced: false },
      {
        scope: 'project',
        text: 'Never show competitors.',
        enforced: true,
        forbiddenTerms: ['competitor'],
      },
    ]);
    expect(view).not.toHaveProperty('sceneOrder');
    expect(view).not.toHaveProperty('scenes');
    await rm(projectDir, { recursive: true, force: true });
  });

  it('counts a parked section against the schema-2 section capacity', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-capacity-'));
    const empty = createEmptyStudioProjectV2(
      {
        name: 'Capacity boundary',
        brief: '',
        aspectRatio: '16:9',
        targetDurationSeconds: 24,
        resolution: '1080p',
      },
      'project_capacity',
      '2026-08-17T00:00:00.000Z'
    );
    let project = applyStudioMutationBatchV2(empty, {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      projectId: empty.id,
      expectedRevision: empty.revision,
      operations: Array.from({ length: 24 }, (_, index) => {
        const ordinal = index + 1;
        return {
          kind: 'add_section' as const,
          sectionId: `section_${ordinal}`,
          section: {
            title: `Section ${ordinal}`,
            storyLine: '',
            visualPrompt: `Visual ${ordinal}`,
          },
          firstClipId: `clip_${ordinal}`,
          firstClip: editableClipV2(),
          beforeSectionId: null,
        };
      }),
    }).project;
    project = applyStudioMutationBatchV2(project, {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      projectId: project.id,
      expectedRevision: project.revision,
      operations: [{ kind: 'park_section', sectionId: 'section_24' }],
    }).project;
    await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));

    try {
      const result = await createReadStoryboardHandlerV2({
        projectId: project.id,
        projectDir,
        pendingDir: '',
        referencePendingDir: '',
      })({});
      const view = JSON.parse(result.content[0].text) as {
        sectionOrder: string[];
        sectionCapacity: { current: number; maximum: number; remaining: number; overCapacity: boolean };
      };

      expect(project.sectionOrder).toHaveLength(23);
      expect(Object.keys(project.sections)).toHaveLength(24);
      expect(view.sectionCapacity).toEqual({ current: 24, maximum: 24, remaining: 0, overCapacity: false });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('rejects a schema-1 manifest as unsupported before proposal or reference sidecar IO', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-legacy-'));
    await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(studioServerProjectFixture));
    const config = {
      projectId: studioServerProjectFixture.id,
      projectDir,
      pendingDir: path.join(projectDir, 'proposals', 'pending'),
      referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
    };

    try {
      const outcomes = await Promise.all([
        createReadStoryboardHandlerV2(config)({}),
        createProposeStoryboardHandlerV2(config)({
          base_revision: studioServerProjectFixture.revision,
          operations: [{ kind: 'set_brief', brief: 'Must remain schema 1' }],
        }),
        createRequestReferenceImagesHandlerV2(config)({ clipIds: ['clip_1'] }),
      ]);

      expect(outcomes.every((result) => result.isError === true)).toBe(true);
      expect(outcomes.every((result) => result.content[0].text.includes('unsupported_prototype_schema'))).toBe(true);
      await expect(readdir(projectDir)).resolves.toEqual(['project.json']);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it.each(['proposal', 'reference'] as const)(
    'rejects a %s queue rooted in another project without changing the foreign project',
    async (requestKind) => {
      const parentDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-cross-root-'));
      const projectDir = path.join(parentDir, 'authorizing-project');
      const foreignProjectDir = path.join(parentDir, 'foreign-project');
      const project = makeSchema2ServiceProject();
      const foreignPendingDir = path.join(foreignProjectDir, 'proposals', 'pending');
      const foreignProposalSlotsDir = path.join(foreignProjectDir, 'proposals', 'slots');
      const foreignReferencePendingDir = path.join(foreignProjectDir, 'reference-requests', 'pending');
      const foreignReferenceSlotsDir = path.join(foreignProjectDir, 'reference-requests', 'slots');
      await mkdir(projectDir);
      await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));
      await mkdir(foreignPendingDir, { recursive: true });
      await mkdir(foreignProposalSlotsDir);
      await mkdir(foreignReferencePendingDir, { recursive: true });
      await mkdir(foreignReferenceSlotsDir);
      await writeFile(path.join(foreignProjectDir, 'project.json'), JSON.stringify(studioServerProjectFixture));
      const captureForeignProject = async () => {
        const captureDirectory = async (directory: string) =>
          Promise.all(
            (await readdir(directory))
              .toSorted()
              .map(async (name) => ({ name, bytes: await readFile(path.join(directory, name), 'utf8') }))
          );
        return {
          project: await readFile(path.join(foreignProjectDir, 'project.json'), 'utf8'),
          proposalPending: await captureDirectory(foreignPendingDir),
          proposalSlots: await captureDirectory(foreignProposalSlotsDir),
          referencePending: await captureDirectory(foreignReferencePendingDir),
          referenceSlots: await captureDirectory(foreignReferenceSlotsDir),
        };
      };
      const before = await captureForeignProject();
      const config = {
        projectId: project.id,
        projectDir,
        pendingDir: foreignPendingDir,
        referencePendingDir: foreignReferencePendingDir,
      };

      try {
        const result =
          requestKind === 'proposal'
            ? await createProposeStoryboardHandlerV2(config)({
                base_revision: project.revision,
                operations: [{ kind: 'set_brief', brief: 'Must stay in the authorizing project' }],
              })
            : await createRequestReferenceImagesHandlerV2(config)({ clipIds: ['clip_1'] });

        expect(result.isError).toBe(true);
        expect(await captureForeignProject()).toEqual(before);
      } finally {
        await rm(parentDir, { recursive: true, force: true });
      }
    }
  );

  it.each(['proposal', 'reference'] as const)(
    'rejects a whole-project-root replacement before publishing a %s sidecar',
    async (requestKind) => {
      const parentDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-root-generation-'));
      const projectDir = path.join(parentDir, 'project_v2');
      const displacedProjectDir = path.join(parentDir, 'project_v2-original');
      const familyName = requestKind === 'proposal' ? 'proposals' : 'reference-requests';
      const pendingDir = path.join(projectDir, familyName, 'pending');
      const referencePendingDir = path.join(projectDir, 'reference-requests', 'pending');
      const originalProject = makeSchema2ServiceProject();
      const replacementProject = { ...structuredClone(originalProject), revision: originalProject.revision + 1 };
      const createdAt = '2026-08-17T01:02:03.000Z';

      const seedProjectRoot = async (root: string, project: StudioProjectV2, marker: string): Promise<void> => {
        const familyRoot = path.join(root, familyName);
        const familyPendingDir = path.join(familyRoot, 'pending');
        const familySlotsDir = path.join(familyRoot, 'slots');
        const recordId = `${marker}_${requestKind}`;
        await mkdir(familyPendingDir, { recursive: true });
        await mkdir(familySlotsDir);
        await writeFile(path.join(root, 'project.json'), JSON.stringify(project));
        await writeFile(
          path.join(familyPendingDir, `${recordId}.json`),
          JSON.stringify(
            requestKind === 'proposal'
              ? {
                  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
                  id: recordId,
                  projectId: project.id,
                  status: 'pending',
                  baseRevision: project.revision,
                  payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: marker }] },
                  createdAt,
                  decidedAt: null,
                }
              : {
                  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
                  id: recordId,
                  projectId: project.id,
                  clipIds: ['clip_2'],
                  status: 'pending',
                  createdAt,
                }
          )
        );
        await writeFile(
          path.join(familySlotsDir, '49.slot'),
          JSON.stringify({
            schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
            [requestKind === 'proposal' ? 'proposalId' : 'requestId']: recordId,
            reservedAt: createdAt,
          })
        );
      };
      const readSidecarSnapshot = async (root: string) => {
        const familyRoot = path.join(root, familyName);
        const snapshotDirectory = async (name: 'pending' | 'slots') => {
          const directory = path.join(familyRoot, name);
          const entries = (await readdir(directory)).toSorted();
          return Promise.all(
            entries.map(async (entry) => ({ entry, bytes: await readFile(path.join(directory, entry), 'utf8') }))
          );
        };
        return { pending: await snapshotDirectory('pending'), slots: await snapshotDirectory('slots') };
      };

      await mkdir(projectDir);
      await seedProjectRoot(projectDir, originalProject, 'original_existing');
      const originalSidecars = await readSidecarSnapshot(projectDir);
      let replacementSidecars: Awaited<ReturnType<typeof readSidecarSnapshot>> | undefined;
      let initialProjectReadClosed = false;
      let rootStatsAfterInitialRead = 0;
      let replacementInstalled = false;
      const swappingFs = new Proxy(nodeFs, {
        get(target, property, receiver) {
          if (property === 'open') {
            return async (file: Parameters<typeof nodeFs.open>[0], ...args: unknown[]) => {
              const handle = await Reflect.apply(nodeFs.open, nodeFs, [file, ...args]);
              if (replacementInstalled || path.basename(String(file)) !== 'project.json') return handle;
              return new Proxy(handle, {
                get(current, key, currentReceiver) {
                  if (key === 'close') {
                    return async () => {
                      await current.close();
                      initialProjectReadClosed = true;
                    };
                  }
                  const value = Reflect.get(current, key, currentReceiver) as unknown;
                  return typeof value === 'function' ? value.bind(current) : value;
                },
              });
            };
          }
          if (property === 'lstat') {
            return async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
              if (
                initialProjectReadClosed &&
                !replacementInstalled &&
                path.resolve(String(file)) === path.resolve(projectDir)
              ) {
                rootStatsAfterInitialRead += 1;
                if (rootStatsAfterInitialRead === 2) {
                  await nodeFs.rename(projectDir, displacedProjectDir);
                  await mkdir(projectDir);
                  await seedProjectRoot(projectDir, replacementProject, 'replacement_existing');
                  replacementSidecars = await readSidecarSnapshot(projectDir);
                  replacementInstalled = true;
                }
              }
              return Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const config = {
        projectId: originalProject.id,
        projectDir,
        pendingDir: requestKind === 'proposal' ? pendingDir : path.join(projectDir, 'proposals', 'pending'),
        referencePendingDir,
        fs: swappingFs,
      };

      try {
        const result =
          requestKind === 'proposal'
            ? await createProposeStoryboardHandlerV2(config)({
                base_revision: originalProject.revision,
                operations: [{ kind: 'set_brief', brief: 'Must not cross the root generation' }],
              })
            : await createRequestReferenceImagesHandlerV2(config)({ clipIds: ['clip_1'] });

        expect(replacementInstalled).toBe(true);
        expect(result.isError).toBe(true);
        expect(await readSidecarSnapshot(displacedProjectDir)).toEqual(originalSidecars);
        expect(await readSidecarSnapshot(projectDir)).toEqual(replacementSidecars);
      } finally {
        await rm(parentDir, { recursive: true, force: true });
      }
    }
  );

  it.each(['symlink', 'oversized'] as const)(
    'rejects a %s schema-2 manifest before proposal or reference sidecar IO',
    async (manifestKind) => {
      const projectDir = await mkdtemp(path.join(tmpdir(), `studio-server-v2-${manifestKind}-`));
      const projectFile = path.join(projectDir, 'project.json');
      if (manifestKind === 'symlink') {
        const target = path.join(projectDir, 'project-target.json');
        await writeFile(target, JSON.stringify(makeSchema2ServiceProject()));
        await nodeFs.symlink(target, projectFile);
      } else {
        await writeFile(projectFile, '');
        await nodeFs.truncate(projectFile, 64 * 1024 * 1024 + 1);
      }
      const config = {
        projectId: 'project_v2',
        projectDir,
        pendingDir: path.join(projectDir, 'proposals', 'pending'),
        referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
      };

      try {
        const outcomes = await Promise.all([
          createReadStoryboardHandlerV2(config)({}),
          createProposeStoryboardHandlerV2(config)({
            base_revision: 3,
            operations: [{ kind: 'set_brief', brief: 'Must not be queued' }],
          }),
          createRequestReferenceImagesHandlerV2(config)({ clipIds: ['clip_1'] }),
        ]);

        expect(outcomes.every((result) => result.isError === true)).toBe(true);
        await expect(nodeFs.lstat(path.join(projectDir, 'proposals'))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(nodeFs.lstat(path.join(projectDir, 'reference-requests'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      } finally {
        await rm(projectDir, { recursive: true, force: true });
      }
    }
  );

  it('rejects a manifest whose identity differs from config before proposal or reference IO', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-'));
    const project = makeSchema2ServiceProject();
    const pendingDir = path.join(projectDir, 'proposals', 'pending');
    const referencePendingDir = path.join(projectDir, 'reference-requests', 'pending');
    await mkdir(pendingDir, { recursive: true });
    await mkdir(path.join(projectDir, 'proposals', 'slots'), { recursive: true });
    await mkdir(referencePendingDir, { recursive: true });
    await mkdir(path.join(projectDir, 'reference-requests', 'slots'), { recursive: true });
    await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));
    const config = { projectId: 'other_project', projectDir, pendingDir, referencePendingDir };

    await expect(createReadStoryboardHandlerV2(config)({})).resolves.toMatchObject({ isError: true });
    await expect(
      createProposeStoryboardHandlerV2(config)({
        base_revision: project.revision,
        operations: [{ kind: 'set_brief', brief: 'Must not be written' }],
      })
    ).resolves.toMatchObject({ isError: true });
    await expect(createRequestReferenceImagesHandlerV2(config)({ clipIds: ['clip_1'] })).resolves.toMatchObject({
      isError: true,
    });
    await expect(readdir(pendingDir)).resolves.toEqual([]);
    await expect(readdir(path.join(projectDir, 'proposals', 'slots'))).resolves.toEqual([]);
    await expect(readdir(referencePendingDir)).resolves.toEqual([]);
    await expect(readdir(path.join(projectDir, 'reference-requests', 'slots'))).resolves.toEqual([]);
    await rm(projectDir, { recursive: true, force: true });
  });

  it('validates proposal records before any slot or record side effect', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-proposal-v2-'));
    const pendingDir = path.join(projectDir, 'proposals', 'pending');
    const slotsDir = path.join(projectDir, 'proposals', 'slots');
    await mkdir(pendingDir, { recursive: true });
    await mkdir(slotsDir);
    const projectAuthority = await capturePendingProjectAuthorityV2(projectDir);

    const record = await writeProposalRecordV2({
      pendingDir,
      projectId: 'project_v2',
      proposalId: 'proposal_valid',
      baseRevision: 7,
      payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: 'A validated proposal' }] },
      projectAuthority,
    });
    expect(record.schemaVersion).toBe(STUDIO_PROJECT_SCHEMA_VERSION);
    expect(JSON.parse(await readFile(path.join(slotsDir, '0.slot'), 'utf8'))).toMatchObject({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      proposalId: 'proposal_valid',
    });
    const beforePending = await readdir(pendingDir);
    const beforeSlots = await readdir(slotsDir);
    const invalidInputs = [
      {
        pendingDir,
        projectId: '../project',
        proposalId: 'unsafe_project',
        baseRevision: 7,
        payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: 'No' }] },
        projectAuthority,
      },
      {
        pendingDir,
        projectId: 'project_v2',
        proposalId: 'bad_revision',
        baseRevision: 0,
        payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: 'No' }] },
        projectAuthority,
      },
      {
        pendingDir,
        projectId: 'project_v2',
        proposalId: 'unknown_nested',
        baseRevision: 7,
        payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: 'No', unknown: true }] },
        projectAuthority,
      },
      new Proxy({} as never, {
        get() {
          throw new Error('hostile input getter');
        },
      }),
    ];
    for (const input of invalidInputs) {
      // Each rejection must leave the same queue snapshot for the next boundary case.
      // eslint-disable-next-line no-await-in-loop
      await expect(writeProposalRecordV2(input as never)).rejects.toMatchObject({ code: 'storage' });
    }
    await expect(readdir(pendingDir)).resolves.toEqual(beforePending);
    await expect(readdir(slotsDir)).resolves.toEqual(beforeSlots);
    await rm(projectDir, { recursive: true, force: true });
  });

  it('writes one bounded exact V2 reference batch and ignores malformed dedup records', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-reference-v2-'));
    const pendingDir = path.join(projectDir, 'reference-requests', 'pending');
    const slotsDir = path.join(projectDir, 'reference-requests', 'slots');
    await mkdir(pendingDir, { recursive: true });
    await mkdir(slotsDir);
    const clipIds = Array.from({ length: 24 }, (_, index) => `clip_${index + 1}`);
    const projectAuthority = await capturePendingProjectAuthorityV2(projectDir);

    const record = await referenceRequestWriter.writeReferenceRequestRecordV2({
      pendingDir,
      projectId: 'project_v2',
      requestId: 'request_valid',
      clipIds,
      projectAuthority,
    });
    expect(record).toMatchObject({ schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION, clipIds });
    expect(JSON.parse(await readFile(path.join(slotsDir, '0.slot'), 'utf8'))).toMatchObject({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      requestId: 'request_valid',
    });
    const beforePending = await readdir(pendingDir);
    const beforeSlots = await readdir(slotsDir);
    const hostileClipIds = new Proxy(['clip_1'], {
      ownKeys() {
        throw new Error('hostile ownKeys');
      },
    });
    for (const invalidClipIds of [
      [],
      Array.from({ length: 25 }, (_, index) => `clip_${index}`),
      ['clip_1', 'clip_1'],
      ['unsafe/clip'],
      hostileClipIds,
    ]) {
      // Keep the no-side-effect queue oracle deterministic between malformed direct calls.
      // eslint-disable-next-line no-await-in-loop
      await expect(
        referenceRequestWriter.writeReferenceRequestRecordV2({
          pendingDir,
          projectId: 'project_v2',
          requestId: `invalid_${invalidClipIds.length}`,
          clipIds: invalidClipIds,
          projectAuthority,
        })
      ).rejects.toMatchObject({ code: 'storage' });
    }
    await expect(readdir(pendingDir)).resolves.toEqual(beforePending);
    await expect(readdir(slotsDir)).resolves.toEqual(beforeSlots);

    await writeFile(
      path.join(pendingDir, 'bad_date.json'),
      JSON.stringify({ ...record, id: 'bad_date', clipIds: ['clip_bad_date'], createdAt: '2026-08-17' })
    );
    await writeFile(
      path.join(pendingDir, 'legacy.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'legacy',
        projectId: 'project_v2',
        sceneId: 'scene_legacy',
        status: 'pending',
        createdAt: '2026-08-17T00:00:00.000Z',
      })
    );
    await expect(
      referenceRequestWriter.listPendingReferenceRequestClipIdsV2(pendingDir, 'project_v2')
    ).resolves.toEqual(new Set(clipIds));

    const racedFile = path.join(pendingDir, 'raced.json');
    const canonicalRacedFile = path.join(await nodeFs.realpath(pendingDir), 'raced.json');
    const oversizedTarget = path.join(projectDir, 'oversized.json');
    await writeFile(racedFile, JSON.stringify({ ...record, id: 'raced', clipIds: ['clip_raced'] }));
    await writeFile(oversizedTarget, 'x'.repeat(256 * 1024 + 1));
    let swapped = false;
    const racedFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'lstat') {
          return async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
            const stats = await Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
            if (!swapped && String(file) === canonicalRacedFile) {
              swapped = true;
              await rm(racedFile);
              await nodeFs.symlink(oversizedTarget, racedFile);
            }
            return stats;
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(
      referenceRequestWriter.listPendingReferenceRequestClipIdsV2(pendingDir, 'project_v2', racedFs)
    ).resolves.toEqual(new Set(clipIds));
    expect(swapped).toBe(true);

    const canonicalPendingDir = await nodeFs.realpath(pendingDir);
    let directoryStatReads = 0;
    const mismatchedDirectoryFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'lstat') {
          return async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
            const stats = await Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
            if (String(file) === pendingDir || String(file) === canonicalPendingDir) {
              directoryStatReads += 1;
              if (directoryStatReads === 2) {
                return new Proxy(stats, {
                  get(current, key, currentReceiver) {
                    if (key === 'ino') return current.ino + 1;
                    const value = Reflect.get(current, key, currentReceiver) as unknown;
                    return typeof value === 'function' ? value.bind(current) : value;
                  },
                });
              }
            }
            return stats;
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(
      referenceRequestWriter.listPendingReferenceRequestClipIdsV2(pendingDir, 'project_v2', mismatchedDirectoryFs)
    ).resolves.toEqual(new Set());
    await rm(projectDir, { recursive: true, force: true });
  });

  it('covers V2 proposal, rule, reference, and unavailable handler outcomes without spending', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-v2-handler-outcomes-'));
    const pendingDir = path.join(projectDir, 'proposals', 'pending');
    const referencePendingDir = path.join(projectDir, 'reference-requests', 'pending');
    await mkdir(pendingDir, { recursive: true });
    await mkdir(path.join(projectDir, 'proposals', 'slots'), { recursive: true });
    await mkdir(referencePendingDir, { recursive: true });
    await mkdir(path.join(projectDir, 'reference-requests', 'slots'), { recursive: true });
    const project = makeSchema2ServiceProject();
    await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));
    const config = { projectId: project.id, projectDir, pendingDir, referencePendingDir };

    await expect(createReadStoryboardHandlerV2(null)({})).resolves.toMatchObject({ isError: true });
    await expect(createListRoutesHandler({ ...config, routeCatalog: null })({})).resolves.toMatchObject({
      isError: true,
    });
    await expect(
      createProposeStoryboardHandlerV2(null)({
        base_revision: project.revision,
        operations: [{ kind: 'set_brief', brief: 'Unavailable' }],
      })
    ).resolves.toMatchObject({ isError: true });
    const proposed = await createProposeStoryboardHandlerV2(config)({
      base_revision: project.revision,
      operations: [{ kind: 'set_brief', brief: 'Proposed only' }],
    });
    expect(proposed.isError).toBeUndefined();
    expect(proposed.content[0].text).toMatch(/recorded for user review/i);
    await expect(
      createProposeStoryboardHandlerV2(config)({
        base_revision: project.revision - 1,
        operations: [{ kind: 'set_brief', brief: 'Stale' }],
      })
    ).resolves.toMatchObject({ isError: true });

    const ruleHandler = createProposeBriefRuleHandlerV2(config);
    for (const input of [
      { base_revision: project.revision, text: '   ', forbidden_terms: [] },
      { base_revision: project.revision, text: 'x'.repeat(241), forbidden_terms: [] },
      { base_revision: project.revision, text: 'No repeats', forbidden_terms: ['logo', 'logo'] },
      { base_revision: project.revision, text: 'Must be enforceable', forbidden_terms: ['+++'] },
      { base_revision: project.revision - 1, text: 'Stale rule', forbidden_terms: [] },
    ]) {
      // These handler outcomes share one durable inbox and are intentionally observed in order.
      // eslint-disable-next-line no-await-in-loop
      await expect(ruleHandler(input)).resolves.toMatchObject({ isError: true });
    }
    await expect(
      createProposeBriefRuleHandlerV2(null)({ base_revision: 1, text: 'Rule', forbidden_terms: [] })
    ).resolves.toMatchObject({
      isError: true,
    });
    await expect(
      ruleHandler({ base_revision: project.revision, text: 'Keep the palette warm.', forbidden_terms: [] })
    ).resolves.not.toHaveProperty('isError');
    await expect(
      ruleHandler({ base_revision: project.revision, text: 'No competitor logos.', forbidden_terms: ['competitor'] })
    ).resolves.not.toHaveProperty('isError');

    const referenceHandler = createRequestReferenceImagesHandlerV2(config);
    for (const input of [
      { clipIds: null as unknown as string[] },
      { clipIds: [] },
      { clipIds: Array.from({ length: 25 }, (_, index) => `clip_${index}`) },
      { clipIds: ['unsafe/clip'] },
      { clipIds: ['clip_1', 'clip_1'] },
      { clipIds: ['inactive_clip'] },
    ]) {
      // These validation outcomes share one dedup inbox and are intentionally observed in order.
      // eslint-disable-next-line no-await-in-loop
      await expect(referenceHandler(input)).resolves.toMatchObject({ isError: true });
    }
    await expect(createRequestReferenceImagesHandlerV2(null)({ clipIds: ['clip_1'] })).resolves.toMatchObject({
      isError: true,
    });
    const queued = await referenceHandler({ clipIds: ['clip_1', 'clip_2'] });
    expect(queued.content[0].text).toMatch(/Queued 2 of 2.*Nothing was generated/i);
    const repeated = await referenceHandler({ clipIds: ['clip_1', 'clip_2'] });
    expect(repeated.content[0].text).toMatch(/Queued 0 of 2.*Already queued: clip_1, clip_2/i);
    expect(await readdir(referencePendingDir)).toHaveLength(1);
    await rm(projectDir, { recursive: true, force: true });
  });

  it.each(['pending_basename', 'family_name', 'project_root'] as const)(
    'rejects the unsafe V2 pending path boundary: %s',
    async (boundary) => {
      const base = await mkdtemp(path.join(tmpdir(), 'studio-pending-v2-path-'));
      let pendingDir: string;
      if (boundary === 'pending_basename') {
        pendingDir = path.join(base, 'proposals', 'inbox');
      } else if (boundary === 'family_name') {
        pendingDir = path.join(base, 'unsafe.family', 'pending');
      } else {
        const projectRoot = path.join(base, 'project-file');
        await writeFile(projectRoot, 'unchanged project-root sentinel');
        pendingDir = path.join(projectRoot, 'proposals', 'pending');
      }
      const beforeEntries = (await readdir(base)).toSorted();

      try {
        await expect(writePendingRecordV2(pendingRequestInputV2(pendingDir))).rejects.toMatchObject({
          code: 'storage',
        });
        await expect(readdir(base)).resolves.toEqual(beforeEntries);
        if (boundary === 'project_root') {
          await expect(readFile(path.join(base, 'project-file'), 'utf8')).resolves.toBe(
            'unchanged project-root sentinel'
          );
        }
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    }
  );

  it.each([
    ['unsupported prototype', 'unsupported_prototype_schema', 'unsupported_prototype_schema'],
    ['invalid authority', 'invalid', 'storage'],
  ] as const)('rejects a %s authority result before reserving a V2 slot', async (_label, status, expectedCode) => {
    const fixture = await createPendingQueueFixtureV2();
    const authorityFence = vi.fn(async () => status);
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir), authorityFence })
      ).rejects.toMatchObject({ code: expectedCode });
      expect(authorityFence).toHaveBeenCalledOnce();
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('cleans its exact reservation when schema-2 authority is revoked immediately before publication', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const statuses = ['valid', 'valid', 'valid', 'unsupported_prototype_schema'] as const;
    const authorityFence = vi.fn(async () => statuses[authorityFence.mock.calls.length - 1] ?? 'invalid');
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir), authorityFence })
      ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
      expect(authorityFence).toHaveBeenCalledTimes(4);
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('preserves an unsupported authority result when its reservation was concurrently reaped', async () => {
    const fixture = await createPendingQueueFixtureV2();
    let fenceCalls = 0;
    const authorityFence = vi.fn(async () => {
      fenceCalls += 1;
      if (fenceCalls !== 4) return 'valid' as const;
      await rm(path.join(fixture.slotsDir, '0.slot'));
      return 'unsupported_prototype_schema' as const;
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir), authorityFence })
      ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('rescans the complete family at the final publication fence and preserves a late V1 slot', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const legacySlot = path.join(fixture.slotsDir, '1.slot');
    const legacyBytes = JSON.stringify({
      schemaVersion: 1,
      requestId: 'late_legacy_request',
      reservedAt: '2026-08-17T00:00:00.000Z',
    });
    let fenceCalls = 0;
    const authorityFence = vi.fn(async () => {
      fenceCalls += 1;
      if (fenceCalls === 4) await writeFile(legacySlot, legacyBytes);
      return 'valid' as const;
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir), authorityFence })
      ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readFile(legacySlot, 'utf8')).resolves.toBe(legacyBytes);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual(['1.slot']);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('preserves a valid replacement when its reserved slot inode changes before final publication', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const slotFile = path.join(fixture.slotsDir, '0.slot');
    const replacement = JSON.stringify({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      requestId: 'other_request',
      reservedAt: '2026-08-17T00:00:00.000Z',
    });
    let fenceCalls = 0;
    const authorityFence = vi.fn(async () => {
      fenceCalls += 1;
      if (fenceCalls === 4) {
        await rm(slotFile);
        await writeFile(slotFile, replacement);
      }
      return 'valid' as const;
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir), authorityFence })
      ).rejects.toMatchObject({ code: 'storage' });
      expect(authorityFence).toHaveBeenCalledTimes(4);
      await expect(readFile(slotFile, 'utf8')).resolves.toBe(replacement);
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual(['0.slot']);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('rechecks its exact reserved slot after syncing the pending temp and immediately before linking', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const recordId = 'request_prelink_recheck';
    const slotFile = path.join(await nodeFs.realpath(fixture.slotsDir), '0.slot');
    const finalFile = path.join(await nodeFs.realpath(fixture.pendingDir), `${recordId}.json`);
    const replacement = JSON.stringify({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      requestId: 'other_request',
      reservedAt: '2026-08-17T00:00:00.000Z',
    });
    let replaced = false;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'open') {
          return async (file: Parameters<typeof nodeFs.open>[0], ...args: unknown[]) => {
            const handle = await Reflect.apply(nodeFs.open, nodeFs, [file, ...args]);
            const fileName = String(file);
            if (!fileName.startsWith(`${finalFile}.`) || !fileName.endsWith('.tmp')) return handle;
            return new Proxy(handle, {
              get(current, key, currentReceiver) {
                if (key === 'sync') {
                  return async () => {
                    await current.sync();
                    if (!replaced) {
                      replaced = true;
                      await rm(slotFile);
                      await writeFile(slotFile, replacement);
                    }
                  };
                }
                const value = Reflect.get(current, key, currentReceiver) as unknown;
                return typeof value === 'function' ? value.bind(current) : value;
              },
            });
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir, recordId), fs: racingFs })
      ).rejects.toMatchObject({ code: 'storage' });
      expect(replaced).toBe(true);
      await expect(readFile(slotFile, 'utf8')).resolves.toBe(replacement);
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('durably restores a replacement moved during exact-slot quarantine cleanup', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const recordId = 'request_cleanup_restore';
    const canonicalSlots = await nodeFs.realpath(fixture.slotsDir);
    const canonicalPending = await nodeFs.realpath(fixture.pendingDir);
    const slotFile = path.join(canonicalSlots, '0.slot');
    const finalFile = path.join(canonicalPending, `${recordId}.json`);
    const replacement = JSON.stringify({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      requestId: 'other_request',
      reservedAt: '2026-08-17T00:00:00.000Z',
    });
    let installedFinal = false;
    let installedReplacement = false;
    let restoredDirectorySyncs = 0;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'link') {
          return async (
            existingPath: Parameters<typeof nodeFs.link>[0],
            newPath: Parameters<typeof nodeFs.link>[1]
          ) => {
            await nodeFs.link(existingPath, newPath);
            if (!installedFinal && String(newPath) === slotFile) {
              installedFinal = true;
              await writeFile(finalFile, JSON.stringify({ schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION }));
            }
          };
        }
        if (property === 'rename') {
          return async (oldPath: Parameters<typeof nodeFs.rename>[0], newPath: Parameters<typeof nodeFs.rename>[1]) => {
            if (!installedReplacement && String(oldPath) === slotFile && String(newPath).endsWith('.cleanup')) {
              installedReplacement = true;
              await rm(slotFile);
              await writeFile(slotFile, replacement);
            }
            await nodeFs.rename(oldPath, newPath);
          };
        }
        if (property === 'open') {
          return async (file: Parameters<typeof nodeFs.open>[0], ...args: unknown[]) => {
            const handle = await Reflect.apply(nodeFs.open, nodeFs, [file, ...args]);
            if (String(file) !== canonicalSlots) return handle;
            return new Proxy(handle, {
              get(current, key, currentReceiver) {
                if (key === 'sync') {
                  return async () => {
                    await current.sync();
                    if (installedReplacement) restoredDirectorySyncs += 1;
                  };
                }
                const value = Reflect.get(current, key, currentReceiver) as unknown;
                return typeof value === 'function' ? value.bind(current) : value;
              },
            });
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir, recordId), fs: racingFs })
      ).rejects.toMatchObject({ code: 'storage' });
      expect(installedFinal).toBe(true);
      expect(installedReplacement).toBe(true);
      expect(restoredDirectorySyncs).toBeGreaterThan(0);
      await expect(readFile(slotFile, 'utf8')).resolves.toBe(replacement);
      expect((await readdir(fixture.slotsDir)).filter((name) => name.endsWith('.cleanup'))).toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['primitive', 'null', 'storage'],
    ['missing version', JSON.stringify({ requestId: 'missing_version' }), 'storage'],
    [
      'unknown version',
      JSON.stringify({ schemaVersion: 99, requestId: 'unknown_version', reservedAt: '2026-08-17T00:00:00.000Z' }),
      'storage',
    ],
    [
      'schema-1 request slot',
      JSON.stringify({ schemaVersion: 1, requestId: 'legacy_request', reservedAt: '2026-08-17T00:00:00.000Z' }),
      'unsupported_prototype_schema',
    ],
    [
      'malformed schema-2 request slot',
      JSON.stringify({ schemaVersion: 2, requestId: 'unsafe/request', reservedAt: '2026-08-17T00:00:00.000Z' }),
      'storage',
    ],
  ] as const)('rejects a %s without changing the V2 queue', async (_label, slotBytes, expectedCode) => {
    const fixture = await createPendingQueueFixtureV2();
    const slotFile = path.join(fixture.slotsDir, '0.slot');
    await writeFile(slotFile, slotBytes);
    try {
      await expect(writePendingRecordV2(pendingRequestInputV2(fixture.pendingDir))).rejects.toMatchObject({
        code: expectedCode,
      });
      await expect(readFile(slotFile, 'utf8')).resolves.toBe(slotBytes);
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual(['0.slot']);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'schema-1',
      JSON.stringify({ schemaVersion: 1, requestId: 'late_legacy', reservedAt: '2026-08-17T00:00:00.000Z' }),
      'unsupported_prototype_schema',
    ],
    [
      'malformed schema-2',
      JSON.stringify({ schemaVersion: 2, requestId: 'unsafe/late', reservedAt: '2026-08-17T00:00:00.000Z' }),
      'storage',
    ],
  ] as const)(
    'classifies a late %s request-slot collision without overwriting it',
    async (_label, installedBytes, expectedCode) => {
      const fixture = await createPendingQueueFixtureV2();
      const slotFile = path.join(fixture.slotsDir, '0.slot');
      let installed = false;
      const collisionFs = new Proxy(nodeFs, {
        get(target, property, receiver) {
          if (property === 'link') {
            return async (
              existingPath: Parameters<typeof nodeFs.link>[0],
              newPath: Parameters<typeof nodeFs.link>[1]
            ) => {
              if (!installed && String(newPath).endsWith(`${path.sep}slots${path.sep}0.slot`)) {
                installed = true;
                await writeFile(slotFile, installedBytes, { flag: 'wx' });
                throw Object.assign(new Error('late slot collision'), { code: 'EEXIST' });
              }
              return Reflect.apply(nodeFs.link, nodeFs, [existingPath, newPath]);
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      try {
        await expect(
          writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir), fs: collisionFs })
        ).rejects.toMatchObject({ code: expectedCode });
        expect(installed).toBe(true);
        await expect(readFile(slotFile, 'utf8')).resolves.toBe(installedBytes);
        await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
        await expect(readdir(fixture.slotsDir)).resolves.toEqual(['0.slot']);
      } finally {
        await rm(fixture.projectRoot, { recursive: true, force: true });
      }
    }
  );

  it.each([
    ['ambiguous link-attempt storage failure', 'storage', false],
    ['late schema-1 record collision', 'unsupported_prototype_schema', true],
  ] as const)('fails closed on a %s after reserving a V2 slot', async (_label, expectedCode, installLegacyRecord) => {
    const fixture = await createPendingQueueFixtureV2();
    const recordId = installLegacyRecord ? 'late_record_collision' : 'pre_link_failure';
    const recordFile = path.join(fixture.pendingDir, `${recordId}.json`);
    const legacyBytes = JSON.stringify({ schemaVersion: 1, id: recordId });
    let failed = false;
    const failingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'link') {
          return async (
            existingPath: Parameters<typeof nodeFs.link>[0],
            newPath: Parameters<typeof nodeFs.link>[1]
          ) => {
            if (
              !failed &&
              path.basename(String(newPath)) === `${recordId}.json` &&
              path.basename(path.dirname(String(newPath))) === 'pending'
            ) {
              failed = true;
              if (installLegacyRecord) await writeFile(recordFile, legacyBytes, { flag: 'wx' });
              throw Object.assign(new Error('injected final publication failure'), {
                code: installLegacyRecord ? 'EEXIST' : 'EIO',
              });
            }
            return Reflect.apply(nodeFs.link, nodeFs, [existingPath, newPath]);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir, recordId), fs: failingFs })
      ).rejects.toMatchObject({ code: expectedCode });
      expect(failed).toBe(true);
      if (installLegacyRecord) {
        await expect(readFile(recordFile, 'utf8')).resolves.toBe(legacyBytes);
        await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
      } else {
        await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
        await expect(readdir(fixture.slotsDir)).resolves.toEqual(['0.slot']);
      }
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('retains the exact pending record and slot when the final link takes effect before reporting EIO', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const recordId = 'pending_link_effect';
    const recordFile = path.join(await nodeFs.realpath(fixture.pendingDir), `${recordId}.json`);
    let failedAfterEffect = false;
    const ambiguousFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'link') {
          return async (
            existingPath: Parameters<typeof nodeFs.link>[0],
            newPath: Parameters<typeof nodeFs.link>[1]
          ) => {
            await nodeFs.link(existingPath, newPath);
            if (!failedAfterEffect && String(newPath) === recordFile) {
              failedAfterEffect = true;
              throw Object.assign(new Error('link result was ambiguous'), { code: 'EIO' });
            }
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir, recordId), fs: ambiguousFs })
      ).rejects.toMatchObject({ code: 'storage' });
      expect(failedAfterEffect).toBe(true);
      await expect(readFile(recordFile, 'utf8')).resolves.toBe(JSON.stringify({ marker: recordId }));
      await expect(readdir(fixture.slotsDir)).resolves.toEqual(['0.slot']);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('bounds pending-record capacity, size, and storage failures behind typed errors', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-pending-v2-'));
    const pendingDir = path.join(projectDir, 'pending');
    const slotsDir = path.join(projectDir, 'slots');
    await mkdir(pendingDir);
    await mkdir(slotsDir);
    const input = (recordId: string, record: unknown) => ({
      pendingDir,
      recordId,
      record,
      slotRecordKey: 'proposalId' as const,
      capacityMessage: 'full',
      tooLargeMessage: 'too large',
    });

    await expect(writePendingRecordV2(input('oversize', { text: 'x'.repeat(256 * 1024) }))).rejects.toMatchObject({
      code: 'too_large',
    });
    await rm(slotsDir, { recursive: true });
    await expect(writePendingRecordV2(input('missing_slots', { ok: true }))).rejects.toMatchObject({
      code: 'storage',
    });
    await mkdir(slotsDir);

    const storageFailureFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'open') {
          return async (file: Parameters<typeof nodeFs.open>[0], ...args: unknown[]) => {
            if (String(file).includes(`${path.sep}slots${path.sep}0.slot.`)) {
              throw Object.assign(new Error('injected storage failure'), { code: 'EIO' });
            }
            return Reflect.apply(nodeFs.open, nodeFs, [file, ...args]);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(
      writePendingRecordV2({ ...input('record_storage_failure', { ok: true }), fs: storageFailureFs })
    ).rejects.toMatchObject({
      code: 'storage',
    });
    await expect(readdir(slotsDir)).resolves.toEqual([]);

    await rm(projectDir, { recursive: true, force: true });
  });
});
