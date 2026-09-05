/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  promises as nodeFs,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type {
  CreateStudioProjectInputV2,
  StudioAssetV2,
  StudioShot,
  StudioConnectionBinding,
  StudioConnectionCandidate,
  StudioConnectionInventory,
  StudioConnectionRecord,
  StudioConnectionValidationResult,
  StudioCommandResult,
  StudioJobV2,
  StudioGenerationRequestPlan,
  StudioMutationBatchV2,
  StudioMutationReducerContextV2,
  StudioProjectSummary,
  StudioProjectV2,
  StudioProposalCommitAttributionV2,
  StudioProposalRecordV2,
  StudioProposalSlotV2,
  StudioReferenceGenerationHandoffReceiptV2,
  StudioReferenceRequestDecisionV2,
  StudioReferenceRequestSlotV2,
  StudioReferenceRequestV2,
  StudioQuotedGeneration,
  StudioMediaChoiceRef,
  StudioRendererJobV2,
  StudioRendererProject,
  StudioRouteCatalogV2,
  StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import {
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
  STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
} from '@/common/types/project/creativeStudioTypes';
import {
  createEmptyStudioProjectV2,
  type StudioMutationApplyResultV2,
} from '@process/services/creative-studio/service/schema2';
import { createStudioProjectManifestV2 } from '@process/services/creative-studio/service/briefFile';
import {
  calculateStudioQuoteTotals,
  composeStudioGenerationV2,
  createStudioQuotedGenerationId,
  deriveStudioInstructionProfileV2,
  studioGenerationCompositionDigestV2,
} from '@process/services/creative-studio/service/schema2/generation';
import {
  createCreativeStudioStore,
  CreativeStudioStoreError,
  StudioProjectConfirmationError,
  STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT,
  STUDIO_PROJECT_V2_MAX_RECORD_BYTES,
  type CreativeStudioStore,
  type StudioProjectAuthoritySnapshotV2,
  type StudioProjectDeletionAuthoritySnapshotV2,
  type StudioProjectConfirmationInputV2,
  type StudioProjectInventoryV2,
  type StudioProjectStoreLoadResultV2,
  type StudioProjectCommitObserver,
} from '@process/services/creative-studio/store';

const validConnectionBinding = (): StudioConnectionBinding => ({
  schemaVersion: 1,
  id: 'binding_1',
  providerId: 'provider_1',
  adapterId: 'weprompt-media-gateway-v1',
  model: 'open-sora',
  capabilities: { mediaKinds: ['video'], audioModes: ['none'] },
  validatedAt: '2026-07-30T00:00:00.000Z',
});

const makeStudioMutationBatchV2 = (
  project: StudioProjectV2,
  operations: StudioMutationBatchV2['operations'],
  expectedRevision = project.revision
): StudioMutationBatchV2 => ({
  schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  projectId: project.id,
  expectedRevision,
  operations,
});

const makeBoundaryMutationBatchV2 = (projectId: string, expectedRevision = 1): StudioMutationBatchV2 => ({
  schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  projectId,
  expectedRevision,
  operations: [{ kind: 'set_brief', brief: 'Updated without a commit tag' }],
});

const makeMutationContextV2 = (
  overrides: Partial<StudioMutationReducerContextV2> = {}
): StudioMutationReducerContextV2 => ({
  mutationId: 'mutation_store_test',
  capturedAt: '2026-08-17T12:00:00.000Z',
  ...overrides,
});

const createDeferredV2 = <T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

/**
 * The store's cases write and re-read whole project files, so they are bound by disk rather than by
 * their assertions. The duration sweep of 2026-08-28 found 6 of them over 2s — third heaviest file in
 * the suite, behind only the job manager and the media store.
 *
 * Under full-suite parallelism one exceeded the 10s global testTimeout and failed the push gate on
 * timing rather than on merit. As with the sibling suites, the ceiling is set on the describe because
 * which case loses the race under load is arbitrary. It is a hang-detector, not a performance budget.
 */
const STORE_TIMEOUT_MS = 120_000;

describe('schema-2 creative studio project store', { timeout: STORE_TIMEOUT_MS }, () => {
  const timestamp = '2026-08-17T12:00:00.000Z';
  const inputV2: CreateStudioProjectInputV2 = {
    name: 'Schema Two Film',
    brief: 'A clean-cutover project',
    aspectRatio: '16:9',
    targetDurationSeconds: 30,
    resolution: '1080p',
  };
  let rootDir: string;

  const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;

  const seedProjectV2 = (project: StudioProjectV2): void => {
    const directory = path.join(rootDir, project.id);
    mkdirSync(directory);
    writeFileSync(
      path.join(directory, 'project.json'),
      JSON.stringify(createStudioProjectManifestV2(project), null, 2)
    );
    writeFileSync(path.join(directory, 'brief.md'), project.brief);
  };

  const expectPersistedProjectV2 = (project: StudioProjectV2): void => {
    const directory = path.join(rootDir, project.id);
    expect(readJson(path.join(directory, 'project.json'))).toEqual(createStudioProjectManifestV2(project));
    expect(readFileSync(path.join(directory, 'brief.md'), 'utf8')).toBe(project.brief);
  };

  const seedProposalV2 = async (
    store: CreativeStudioStore,
    project: StudioProjectV2,
    input: {
      proposalId?: string;
      payload?: StudioProposalRecordV2['payload'];
      createdAt?: string;
    } = {}
  ): Promise<{
    proposal: StudioProposalRecordV2;
    slot: StudioProposalSlotV2;
    directories: { root: string; pending: string; decisions: string; slots: string; commits: string };
  }> => {
    await store.resolveProposalPathsV2(project.id);
    const familyRoot = path.join(rootDir, project.id, 'proposals');
    const directories = {
      root: familyRoot,
      pending: path.join(familyRoot, 'pending'),
      decisions: path.join(familyRoot, 'decisions'),
      slots: path.join(familyRoot, 'slots'),
      commits: path.join(familyRoot, 'commits'),
    };
    const proposalId = input.proposalId ?? 'proposal_v2';
    const proposal: StudioProposalRecordV2 = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
      id: proposalId,
      projectId: project.id,
      status: 'pending',
      baseRevision: project.revision,
      payload: input.payload ?? {
        kind: 'mutation_batch',
        operations: [{ kind: 'set_brief', brief: 'Accepted brief' }],
      },
      createdAt: input.createdAt ?? timestamp,
      decidedAt: null,
    };
    const slot: StudioProposalSlotV2 = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
      proposalId,
      reservedAt: proposal.createdAt,
    };
    writeFileSync(path.join(directories.pending, `${proposalId}.json`), JSON.stringify(proposal));
    writeFileSync(path.join(directories.slots, '0.slot'), JSON.stringify(slot));
    return { proposal, slot, directories };
  };

  const seedReferenceRequestV2 = async (
    store: CreativeStudioStore,
    project: StudioProjectV2,
    input: { requestId?: string; referenceIds?: string[]; createdAt?: string; slotIndex?: number } = {}
  ): Promise<{
    request: StudioReferenceRequestV2;
    slot: StudioReferenceRequestSlotV2;
    directories: { root: string; pending: string; decisions: string; slots: string; receipts: string };
  }> => {
    await store.resolveReferenceRequestPathsV2(project.id);
    const familyRoot = path.join(rootDir, project.id, 'reference-requests');
    const directories = {
      root: familyRoot,
      pending: path.join(familyRoot, 'pending'),
      decisions: path.join(familyRoot, 'decisions'),
      slots: path.join(familyRoot, 'slots'),
      receipts: path.join(familyRoot, 'receipts'),
    };
    const requestId = input.requestId ?? 'reference_request_v2';
    const request: StudioReferenceRequestV2 = {
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
      id: requestId,
      projectId: project.id,
      referenceIds: input.referenceIds ?? [project.referenceOrder[0] ?? 'ref_reference'],
      status: 'pending',
      createdAt: input.createdAt ?? timestamp,
    };
    const slot: StudioReferenceRequestSlotV2 = {
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
      requestId,
      reservedAt: request.createdAt,
    };
    writeFileSync(path.join(directories.pending, `${requestId}.json`), JSON.stringify(request));
    writeFileSync(path.join(directories.slots, `${input.slotIndex ?? 0}.slot`), JSON.stringify(slot));
    return { request, slot, directories };
  };

  const seedGenerationHandoffV2 = async (
    store: CreativeStudioStore,
    project: StudioProjectV2,
    input: { requestId?: string; referenceIds?: string[]; slotIndex?: number } = {}
  ): Promise<
    Awaited<ReturnType<typeof seedReferenceRequestV2>> & {
      decision: StudioReferenceRequestDecisionV2 & {
        outcome: Extract<StudioReferenceRequestDecisionV2['outcome'], { kind: 'generation_gate' }>;
      };
      handoffId: string;
    }
  > => {
    const seeded = await seedReferenceRequestV2(store, project, input);
    const entry = await store.decideReferenceRequestV2({
      projectId: project.id,
      requestId: seeded.request.id,
      expectedRevision: project.revision,
      outcome: { kind: 'generation_gate' },
    });
    if (entry.decision?.outcome.kind !== 'generation_gate') {
      throw new Error('expected generation handoff decision');
    }
    return {
      ...seeded,
      decision: entry.decision as StudioReferenceRequestDecisionV2 & {
        outcome: Extract<StudioReferenceRequestDecisionV2['outcome'], { kind: 'generation_gate' }>;
      },
      handoffId: entry.decision.outcome.handoffId,
    };
  };

  const addActiveReferenceShotsV2 = async (
    store: CreativeStudioStore,
    project: StudioProjectV2,
    shotIds: string[] = ['shot_reference']
  ): Promise<StudioProjectV2> => {
    const operations: StudioMutationBatchV2['operations'] = [
      {
        kind: 'add_beat',
        beatId: 'beat_reference',
        beat: { title: 'Reference beat', story: 'A scene containing the planned references.', targetSeconds: null },
        beforeBeatId: null,
      },
      ...shotIds.map((shotId): StudioMutationBatchV2['operations'][number] => ({
        kind: 'add_shot',
        beatId: 'beat_reference',
        shotId,
        shot: { shootingScript: `Frame ${shotId}.`, durationSeconds: 4 },
        beforeShotId: null,
      })),
      {
        kind: 'set_reference_plan',
        references: shotIds.map((_shotId, index) => ({
          kind: 'character',
          label: `Reference ${index + 1}`,
          prompt: `Character sheet for reference ${index + 1}.`,
        })),
      },
    ];
    return (
      await store.applyMutationBatchV2(
        {
          schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
          projectId: project.id,
          expectedRevision: project.revision,
          operations,
        },
        { mutationId: `seed_${project.id}`, capturedAt: timestamp }
      )
    ).project;
  };

  const addReferenceAuthorizationV2 = (
    project: StudioProjectV2,
    handoffId: string,
    referenceId = project.referenceOrder[0] ?? 'ref_reference'
  ): StudioProjectV2 => {
    const provider = {
      providerId: 'provider_reference',
      adapterId: 'weprompt-image-v1',
      model: 'image-model',
    } as const;
    const reference = project.references[referenceId];
    if (reference === undefined) throw new Error('Missing reference authorization fixture');
    const source = {
      kind: 'project_reference' as const,
      referenceId,
      referenceKind: reference.kind,
      prompt: reference.prompt,
    };
    const composition = composeStudioGenerationV2({
      projectRevision: project.revision,
      brief: project.brief,
      rules: project.rules,
      source,
      purpose: 'reference_image',
      referenceInputs: [],
      aspectRatio: project.aspectRatio,
      resolution: project.resolution,
      route: provider,
      boardStyle: null,
      instructionProfile: deriveStudioInstructionProfileV2(provider, 'reference_image', source),
    });
    const requestPlan: StudioGenerationRequestPlan = {
      kind: 'resolved',
      snapshot: {
        composition,
        aspectRatio: project.aspectRatio,
        resolution: project.resolution,
        durationSeconds: 4,
        referenceInputs: [],
        conditioningInput: null,
      },
    };
    const target = { kind: 'reference' as const, referenceId };
    const item: StudioQuotedGeneration = {
      id: createStudioQuotedGenerationId({
        projectId: project.id,
        projectRevision: project.revision,
        target,
        purpose: 'reference_image',
      }),
      target,
      purpose: 'reference_image',
      routeId: 'image_route',
      generationCount: 1,
      requestPlan,
      rateUnit: 'generation',
      rateMinorUnits: 2,
    };
    const totals = calculateStudioQuoteTotals([item])!;
    const authorization: StudioSpendAuthorization = {
      id: `authorization_${handoffId}`,
      projectId: project.id,
      projectRevision: project.revision,
      originReferenceHandoffId: handoffId,
      rateCardDigest: 'd'.repeat(64),
      currency: 'USD',
      baseItems: [item],
      cascadeItems: [],
      lowerMinorUnits: totals.lowerMinorUnits,
      upperMinorUnits: totals.upperMinorUnits,
      expiresAt: '2026-08-17T12:05:00.000Z',
      confirmedAt: '2026-08-17T12:00:03.000Z',
      providerBindings: [{ itemId: item.id, provider }],
      idempotencyKeys: [{ itemId: item.id, key: `idem_${handoffId}` }],
    };
    const job: StudioJobV2 = {
      id: `job_${handoffId}`,
      projectId: project.id,
      target,
      status: 'queued_local',
      provider,
      idempotencyKey: `idem_${handoffId}`,
      providerJobId: null,
      cancellationPolicy: 'queued_and_running',
      purpose: 'reference_image',
      authorizationId: authorization.id,
      authorizationItemId: item.id,
      composition,
      requestPlan,
      requestSnapshot: requestPlan.snapshot,
      spendReceipt: null,
      outputAssetIds: [],
      outputAssetIdsByRole: { primary: null, poster: null },
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: authorization.confirmedAt,
      updatedAt: authorization.confirmedAt,
    };
    project.spendAuthorizations.push(authorization);
    project.jobs[job.id] = job;
    project.references[referenceId]!.jobIds.push(job.id);
    project.references[referenceId]!.updatedAt = authorization.confirmedAt;
    return project;
  };

  const snapshotTreeV2 = (directory: string): Array<{ path: string; kind: 'directory' | 'file'; bytes?: string }> => {
    const entries: Array<{ path: string; kind: 'directory' | 'file'; bytes?: string }> = [];
    const visit = (current: string, relative: string): void => {
      for (const name of readdirSync(current).toSorted()) {
        const absolute = path.join(current, name);
        const child = relative.length === 0 ? name : path.join(relative, name);
        const stats = lstatSync(absolute);
        if (stats.isDirectory()) {
          entries.push({ path: child, kind: 'directory' });
          visit(absolute, child);
        } else if (stats.isFile()) {
          entries.push({ path: child, kind: 'file', bytes: readFileSync(absolute).toString('base64') });
        }
      }
    };
    visit(directory, '');
    return entries;
  };

  const failFileSystemOnceV2 = (shouldFail: (method: string, args: readonly unknown[]) => boolean): typeof nodeFs => {
    let failed = false;
    return new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof property !== 'string' || typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          if (!failed && shouldFail(property, args)) {
            failed = true;
            throw Object.assign(new Error('injected proposal crash'), { code: 'EIO' });
          }
          return Reflect.apply(value, target, args);
        };
      },
    }) as typeof nodeFs;
  };

  const seedPrototypeProject = async (projectId = 'prototype_v1'): Promise<{ id: string; revision: number }> => {
    const project = {
      schemaVersion: 1,
      revision: 1,
      id: projectId,
      name: 'Prototype project',
      brief: 'A schema-1 no-touch fixture',
      rules: [],
      ruleListUndo: null,
      briefConversationId: null,
      aspectRatio: '16:9',
      targetDurationSeconds: 12,
      resolution: '1080p',
      sceneOrder: [],
      scenes: {},
      assets: {},
      jobs: {},
      routing: { storyboard: null, image: null, video: null },
      createdAt: timestamp,
      updatedAt: timestamp,
    } as const;
    const projectDirectory = path.join(rootDir, projectId);
    mkdirSync(projectDirectory);
    writeFileSync(path.join(projectDirectory, 'project.json'), JSON.stringify(project));
    writeFileSync(
      path.join(rootDir, 'projects.json'),
      JSON.stringify({
        schemaVersion: 1,
        projects: [
          {
            id: projectId,
            name: project.name,
            aspectRatio: project.aspectRatio,
            targetDurationSeconds: project.targetDurationSeconds,
            resolution: project.resolution,
            sceneCount: 0,
            selectedTakeCount: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      })
    );
    return { id: projectId, revision: project.revision };
  };

  const protectPrototypeIndex = (): { fs: typeof nodeFs; accesses: string[] } => {
    const prototypeIndex = path.join(realpathSync(rootDir), 'projects.json');
    const accesses: string[] = [];
    const fs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          const touchesPrototypeIndex = args.some((argument) => {
            if (typeof argument !== 'string') return false;
            const resolved = path.resolve(argument);
            return resolved === prototypeIndex || resolved.startsWith(`${prototypeIndex}.`);
          });
          if (touchesPrototypeIndex) {
            accesses.push(String(property));
            throw new Error(`schema-2 path accessed projects.json through ${String(property)}`);
          }
          return Reflect.apply(value, target, args);
        };
      },
    }) as typeof nodeFs;
    return { fs, accesses };
  };

  const createStoreV2 = (
    overrides: Omit<Parameters<typeof createCreativeStudioStore>[0], 'rootDir' | 'fs'> = {}
  ): { store: CreativeStudioStore; prototypeIndexAccesses: string[] } => {
    const protectedFs = protectPrototypeIndex();
    return {
      store: createCreativeStudioStore({
        rootDir,
        fs: protectedFs.fs,
        logError: () => undefined,
        ...overrides,
      }),
      prototypeIndexAccesses: protectedFs.accesses,
    };
  };

  const observeFileSystemMethods = (
    observedMethods: ReadonlySet<string>,
    baseFs: typeof nodeFs = nodeFs
  ): { fs: typeof nodeFs; calls: string[] } => {
    const calls: string[] = [];
    const fs = new Proxy(baseFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof property !== 'string' || typeof value !== 'function' || !observedMethods.has(property)) {
          return value;
        }
        return (...args: unknown[]): unknown => {
          calls.push(property);
          return Reflect.apply(value, target, args);
        };
      },
    }) as typeof nodeFs;
    return { fs, calls };
  };

  const makePosterProjectV2 = (id = 'poster_v2'): StudioProjectV2 => {
    const project = createEmptyStudioProjectV2(inputV2, id, timestamp);
    const shot: StudioShot = {
      id: 'clip_video',
      shootingScript: 'A launch vehicle crosses frame.',
      durationSeconds: 4,
      trimInSeconds: null,
      trimOutSeconds: null,
      chainBreak: 'none',
      referenceBinding: { status: 'unassigned', characterReferenceIds: [], backgroundReferenceId: null },
      seedStillId: 'asset_seed',
      dismissedSeedStillIds: [],
      boardAssetId: null,
      supersededBoardAssetIds: [],
      videoAssetId: 'asset_video',
      supersededVideoAssetIds: [],
      assetIds: ['asset_seed', 'asset_video', 'asset_thumbnail'],
      jobIds: ['job_video'],
    };
    const seed: StudioAssetV2 = {
      id: 'asset_seed',
      projectId: id,
      shotId: shot.id,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'asset_seed.png' },
      byteSize: 1,
      sha256: 'c'.repeat(64),
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: null,
      compositionDigest: null,
      createdAt: timestamp,
    };
    const provider = {
      providerId: 'provider_1',
      adapterId: 'byteplus-seedance-v1',
      model: 'model_1',
    } as const;
    const source = {
      kind: 'shot' as const,
      beatId: 'section_1',
      story: 'A launch begins.',
      shotId: shot.id,
      shootingScript: shot.shootingScript,
    };
    const composition = composeStudioGenerationV2({
      projectRevision: 1,
      brief: project.brief,
      rules: project.rules,
      source,
      purpose: 'video_take',
      referenceInputs: [],
      aspectRatio: project.aspectRatio,
      resolution: project.resolution,
      route: provider,
      boardStyle: null,
      instructionProfile: deriveStudioInstructionProfileV2(provider, 'video_take', source),
    });
    const requestPlan: StudioGenerationRequestPlan = {
      kind: 'resolved',
      snapshot: {
        composition,
        aspectRatio: '16:9',
        resolution: '1080p',
        durationSeconds: 4,
        referenceInputs: [],
        conditioningInput: { kind: 'seed_still', assetId: seed.id },
      },
    };
    const target = { kind: 'shot' as const, shotId: shot.id };
    const item: StudioQuotedGeneration = {
      id: createStudioQuotedGenerationId({
        projectId: id,
        projectRevision: 1,
        target,
        purpose: 'video_take',
      }),
      target,
      purpose: 'video_take',
      routeId: 'video_route',
      generationCount: 1,
      requestPlan,
      rateUnit: 'second',
      rateMinorUnits: 2,
    };
    const totals = calculateStudioQuoteTotals([item])!;
    const digest = studioGenerationCompositionDigestV2(composition);
    const video: StudioAssetV2 = {
      id: 'asset_video',
      projectId: id,
      shotId: shot.id,
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'asset_video.mp4' },
      byteSize: 1,
      sha256: 'a'.repeat(64),
      durationSeconds: 4,
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: 'job_video',
      compositionDigest: digest,
      createdAt: timestamp,
    };
    const thumbnail: StudioAssetV2 = {
      id: 'asset_thumbnail',
      projectId: id,
      shotId: shot.id,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'thumbnails', fileName: 'asset_thumbnail.png' },
      byteSize: 1,
      sha256: 'b'.repeat(64),
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: 'job_video',
      compositionDigest: digest,
      createdAt: timestamp,
    };
    const authorization: StudioSpendAuthorization = {
      id: 'authorization_video',
      projectId: id,
      projectRevision: 1,
      originReferenceHandoffId: null,
      rateCardDigest: 'd'.repeat(64),
      currency: 'USD',
      baseItems: [item],
      cascadeItems: [],
      lowerMinorUnits: totals.lowerMinorUnits,
      upperMinorUnits: totals.upperMinorUnits,
      expiresAt: '2026-08-17T12:05:00.000Z',
      confirmedAt: timestamp,
      providerBindings: [{ itemId: item.id, provider }],
      idempotencyKeys: [{ itemId: item.id, key: 'idem_job_video' }],
    };
    const job: StudioJobV2 = {
      id: 'job_video',
      projectId: id,
      target,
      status: 'succeeded',
      provider,
      idempotencyKey: 'idem_job_video',
      providerJobId: 'remote_job_video',
      remoteStartedAt: timestamp,
      cancellationPolicy: 'none',
      purpose: 'video_take',
      authorizationId: authorization.id,
      authorizationItemId: item.id,
      composition,
      requestPlan,
      requestSnapshot: requestPlan.snapshot,
      spendReceipt: {
        authorizationId: authorization.id,
        itemId: item.id,
        jobId: 'job_video',
        purpose: 'video_take',
        routeId: item.routeId,
        currency: authorization.currency,
        rateUnit: 'second',
        rateMinorUnits: item.rateMinorUnits,
        durationSeconds: 4,
        generationCount: 1,
        totalMinorUnits: 8,
      },
      outputAssetIds: [video.id, thumbnail.id],
      outputAssetIdsByRole: { primary: video.id, poster: thumbnail.id },
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    project.beatOrder = ['section_1'];
    project.beats.section_1 = {
      id: 'section_1',
      title: 'Opening',
      story: 'A launch begins.',
      targetSeconds: null,
      shotOrder: [shot.id],
    };
    project.shots[shot.id] = shot;
    project.assets = { [seed.id]: seed, [video.id]: video, [thumbnail.id]: thumbnail };
    project.jobs[job.id] = job;
    project.spendAuthorizations = [authorization];
    project.videoRouteId = 'video_route';
    project.revision = 2;
    return project;
  };

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), 'creative-studio-store-v2-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('uses the default clock when no time dependency is supplied', async () => {
    const store = createCreativeStudioStore({
      rootDir,
      createId: () => 'default_clock_v2',
    });

    const project = await store.createProjectV2(inputV2);

    expect(new Date(project.createdAt).toISOString()).toBe(project.createdAt);
    expect(project.updatedAt).toBe(project.createdAt);
  });

  it('uses the stable storage fallback for non-Error filesystem failures', async () => {
    const fsWithStringFailure = new Proxy(nodeFs, {
      get: (target, property, receiver) =>
        property === 'readdir' ? async () => Promise.reject('string failure') : Reflect.get(target, property, receiver),
    });
    const store = createCreativeStudioStore({
      rootDir,
      fs: fsWithStringFailure,
    });

    await expect(store.listProjectsV2()).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Studio project inventory could not be inspected',
    });
  });

  it('keeps every schema-1 project and proposal entrypoint absent while preserving connections', () => {
    const legacyMethods = [
      'listProjects',
      'listQuarantinedProjectIds',
      'createProject',
      'getProject',
      'updateProject',
      'deleteProject',
      'recordProposal',
      'listProposals',
      'listPendingReferenceRequests',
      'dismissReferenceRequests',
      'acceptProposal',
      'rejectProposal',
      'reapAbandonedProposals',
      'watchProposals',
      'resolveProposalPaths',
      'getVerifiedProjectDirectory',
    ] as const;
    type LegacyMethod = (typeof legacyMethods)[number];
    expectTypeOf<Extract<keyof CreativeStudioStore, LegacyMethod>>().toEqualTypeOf<never>();

    const store = createCreativeStudioStore({ rootDir, now: () => timestamp });
    for (const method of legacyMethods) expect(method in store).toBe(false);
    expect(typeof store.listConnections).toBe('function');
    expect(typeof store.saveConnection).toBe('function');
    expect(typeof store.removeConnection).toBe('function');
  });

  it('returns exact load discriminants without parsing earlier payloads as the current schema', async () => {
    const prototypeId = 'prototype_minimal';
    mkdirSync(path.join(rootDir, prototypeId));
    writeFileSync(
      path.join(rootDir, prototypeId, 'project.json'),
      JSON.stringify({ schemaVersion: 1, id: prototypeId, deliberatelyNotAProject: true })
    );
    const previousSchemaId = 'schema_2_project';
    mkdirSync(path.join(rootDir, previousSchemaId));
    writeFileSync(
      path.join(rootDir, previousSchemaId, 'project.json'),
      JSON.stringify({ schemaVersion: 2, id: previousSchemaId, deliberatelyNotMigrated: true })
    );
    const schema3Id = 'schema_3_project';
    mkdirSync(path.join(rootDir, schema3Id));
    const schema3 = createEmptyStudioProjectV2(inputV2, schema3Id, timestamp) as unknown as Record<string, unknown>;
    schema3.schemaVersion = 3;
    delete schema3.boardStyle;
    writeFileSync(path.join(rootDir, schema3Id, 'project.json'), JSON.stringify(schema3));
    const schema4Id = 'schema_4_project';
    mkdirSync(path.join(rootDir, schema4Id));
    writeFileSync(
      path.join(rootDir, schema4Id, 'project.json'),
      JSON.stringify({ schemaVersion: 4, id: schema4Id, deliberatelyNotMigrated: true })
    );
    const futureSchemaId = 'schema_6_project';
    const futureSchemaBytes = JSON.stringify({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION + 1,
      id: futureSchemaId,
      deliberatelyNotAPrototype: true,
    });
    mkdirSync(path.join(rootDir, futureSchemaId));
    writeFileSync(path.join(rootDir, futureSchemaId, 'project.json'), futureSchemaBytes);
    const malformedId = 'malformed_v2';
    mkdirSync(path.join(rootDir, malformedId));
    writeFileSync(
      path.join(rootDir, malformedId, 'project.json'),
      JSON.stringify({ schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION, id: malformedId })
    );
    const project = createEmptyStudioProjectV2(inputV2, 'supported_v2', timestamp);
    seedProjectV2(project);
    const { store, prototypeIndexAccesses } = createStoreV2();

    const supported: StudioProjectStoreLoadResultV2 = { status: 'supported', project };
    const unsupported: StudioProjectStoreLoadResultV2 = {
      status: 'unsupported_prototype_schema',
      projectId: prototypeId,
    };
    const missing: StudioProjectStoreLoadResultV2 = { status: 'not_found', projectId: 'missing_v2' };
    await expect(store.getProjectV2(project.id)).resolves.toEqual(supported);
    await expect(store.getProjectV2(prototypeId)).resolves.toEqual(unsupported);
    await expect(store.getProjectV2(previousSchemaId)).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      projectId: previousSchemaId,
    });
    await expect(store.getProjectV2(schema3Id)).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      projectId: schema3Id,
    });
    await expect(store.getProjectV2(schema4Id)).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      projectId: schema4Id,
    });
    await expect(store.getProjectV2(futureSchemaId)).rejects.toMatchObject({ code: 'storage_error' });
    expect(readFileSync(path.join(rootDir, futureSchemaId, 'project.json'), 'utf8')).toBe(futureSchemaBytes);
    await expect(store.getProjectV2('missing_v2')).resolves.toEqual(missing);
    await expect(store.getProjectV2(malformedId)).rejects.toMatchObject({ code: 'storage_error' });
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('leaves a valid schema-3 project and interrupted Brief sidecars byte-for-byte untouched', async () => {
    const projectId = 'schema_3_brief_transaction';
    const directory = path.join(rootDir, projectId);
    mkdirSync(directory);
    const schema3 = createEmptyStudioProjectV2(inputV2, projectId, timestamp) as unknown as Record<string, unknown>;
    schema3.schemaVersion = 3;
    delete schema3.boardStyle;
    const projectBytes = JSON.stringify(schema3);
    const briefBytes = 'Schema-3 Brief bytes stay untouched';
    const transactionBytes = JSON.stringify({
      schemaVersion: 1,
      projectId,
      baseManifestSha256: createHash('sha256').update(projectBytes).digest('hex'),
      baseBriefSha256: createHash('sha256').update(briefBytes).digest('hex'),
      candidateManifestSha256: 'c'.repeat(64),
      candidateBrief: 'A schema-3 candidate must never be recovered',
    });
    writeFileSync(path.join(directory, 'project.json'), projectBytes);
    writeFileSync(path.join(directory, 'brief.md'), briefBytes);
    writeFileSync(path.join(directory, '.brief-transaction.json'), transactionBytes);
    const before = new Map(
      readdirSync(directory).map((name) => [name, readFileSync(path.join(directory, name))] as const)
    );
    const { store } = createStoreV2();

    await expect(store.getProjectV2(projectId)).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      projectId,
    });
    await expect(store.listProjectsV2()).resolves.toMatchObject({ unsupportedProjectIds: [projectId] });

    expect(readdirSync(directory).toSorted()).toEqual([...before.keys()].toSorted());
    for (const [name, bytes] of before) expect(readFileSync(path.join(directory, name))).toEqual(bytes);
  });

  it('keeps every read and mutation boundary non-allocating when the configured root is absent', async () => {
    const absentRoot = path.join(rootDir, 'not-created');
    const absent = createCreativeStudioStore({ rootDir: absentRoot, now: () => timestamp });
    const notFound = { code: 'not_found' };

    await expect(absent.inspectProjectsV2()).resolves.toEqual({
      supportedProjectIds: [],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    await expect(absent.listProjectsV2()).resolves.toEqual({
      projects: [],
      projectRevisions: [],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    await expect(absent.getProjectV2('missing_project')).resolves.toEqual({
      status: 'not_found',
      projectId: 'missing_project',
    });
    await expect(absent.getVerifiedProjectDirectoryV2('missing_project')).resolves.toBeNull();
    await expect(
      absent.applyMutationBatchV2(makeBoundaryMutationBatchV2('missing_project'), makeMutationContextV2())
    ).rejects.toMatchObject(notFound);
    await expect(absent.updateProjectV2('missing_project', (project) => project)).rejects.toMatchObject(notFound);
    await expect(absent.deleteProjectV2('missing_project', 1)).resolves.toBe(false);
    await expect(absent.listProposalsV2('missing_project')).rejects.toMatchObject(notFound);
    await expect(absent.acceptProposalV2('missing_project', 'proposal_1')).rejects.toMatchObject(notFound);
    await expect(absent.rejectProposalV2('missing_project', 'proposal_1')).rejects.toMatchObject(notFound);
    await expect(absent.resolveProposalPathsV2('missing_project')).rejects.toMatchObject(notFound);
    await expect(absent.listReferenceRequestsV2('missing_project')).rejects.toMatchObject(notFound);
    await expect(absent.readReferenceGenerationHandoffV2('missing_project', 'handoff_1')).rejects.toMatchObject(
      notFound
    );
    await expect(absent.resolveReferenceRequestPathsV2('missing_project')).rejects.toMatchObject(notFound);
    await expect(absent.reapAbandonedProposalsV2()).resolves.toBeUndefined();
    await expect(absent.reapAbandonedReferenceRequestsV2()).resolves.toBeUndefined();
    expect(existsSync(absentRoot)).toBe(false);
  });

  it('classifies a reordered schema-1 manifest larger than the V2 cap without mutating its tree', async () => {
    const projectId = 'oversized_prototype_v1';
    const projectDirectory = path.join(rootDir, projectId);
    const projectFile = path.join(projectDirectory, 'project.json');
    mkdirSync(projectDirectory);
    const handle = await nodeFs.open(projectFile, 'wx');
    try {
      await handle.write('{"padding":"');
      const chunk = Buffer.alloc(1024 * 1024, 'x');
      for (let index = 0; index <= STUDIO_PROJECT_V2_MAX_RECORD_BYTES / chunk.length; index += 1) {
        // The fixture is deliberately streamed so the test never allocates the oversized record.
        // eslint-disable-next-line no-await-in-loop
        await handle.write(chunk);
      }
      await handle.write(
        `","deep":${'['.repeat(300)}0${']'.repeat(300)},"id":"${projectId}",\n  "schemaVersion" \t : 1.${'0'.repeat(130)}}`
      );
    } finally {
      await handle.close();
    }
    const before = await nodeFs.lstat(projectFile, { bigint: true });
    const rootEntriesBefore = readdirSync(rootDir).toSorted();
    const projectEntriesBefore = readdirSync(projectDirectory).toSorted();
    const protectedFs = protectPrototypeIndex();
    const mutations = observeFileSystemMethods(
      new Set(['appendFile', 'copyFile', 'link', 'mkdir', 'rename', 'rm', 'rmdir', 'truncate', 'unlink', 'writeFile']),
      protectedFs.fs
    );
    const store = createCreativeStudioStore({ rootDir, fs: mutations.fs, logError: () => undefined });

    expect(before.size).toBeGreaterThan(BigInt(STUDIO_PROJECT_V2_MAX_RECORD_BYTES));
    await expect(store.getProjectV2(projectId)).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      projectId,
    });
    await expect(store.listProjectsV2()).resolves.toEqual({
      projects: [],
      projectRevisions: [],
      unsupportedProjectIds: [projectId],
      quarantinedProjectIds: [],
    });
    await expect(store.inspectProjectsV2()).resolves.toEqual({
      supportedProjectIds: [],
      unsupportedProjectIds: [projectId],
      quarantinedProjectIds: [],
    });

    const after = await nodeFs.lstat(projectFile, { bigint: true });
    expect({ dev: after.dev, ino: after.ino, size: after.size, mtimeNs: after.mtimeNs }).toEqual({
      dev: before.dev,
      ino: before.ino,
      size: before.size,
      mtimeNs: before.mtimeNs,
    });
    expect(readdirSync(rootDir).toSorted()).toEqual(rootEntriesBefore);
    expect(readdirSync(projectDirectory).toSorted()).toEqual(projectEntriesBefore);
    expect(mutations.calls).toEqual([]);
    expect(protectedFs.accesses).toEqual([]);
  });

  it('classifies an oversized duplicate-root schema-2 manifest after a no-follow bounded schema sniff', async () => {
    const projectId = 'oversized_v2';
    const projectFilePath = path.join(rootDir, projectId, 'project.json');
    mkdirSync(path.dirname(projectFilePath));
    writeFileSync(
      projectFilePath,
      `{"schemaVersion":1,"payload":{"schemaVersion":1},"schemaVersion":2,"id":"${projectId}"}`
    );
    const projectFile = realpathSync(projectFilePath);
    const protectedFs = protectPrototypeIndex();
    let projectOpenCount = 0;
    let projectReadFileCount = 0;
    const boundedFs = new Proxy(protectedFs.fs, {
      get(target, property, receiver) {
        if (property === 'lstat') {
          return async (...args: Parameters<typeof nodeFs.lstat>) => {
            const stats = await nodeFs.lstat(...args);
            if (path.resolve(String(args[0])) !== projectFile) return stats;
            return new Proxy(stats, {
              get(statsTarget, statsProperty, statsReceiver) {
                if (statsProperty === 'size') return STUDIO_PROJECT_V2_MAX_RECORD_BYTES + 1;
                return Reflect.get(statsTarget, statsProperty, statsReceiver) as unknown;
              },
            });
          };
        }
        if (property === 'open') {
          return (...args: Parameters<typeof nodeFs.open>) => {
            if (path.resolve(String(args[0])) === projectFile) projectOpenCount += 1;
            return nodeFs.open(...args);
          };
        }
        if (property === 'readFile') {
          return (...args: Parameters<typeof nodeFs.readFile>) => {
            if (path.resolve(String(args[0])) === projectFile) projectReadFileCount += 1;
            return nodeFs.readFile(...args);
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({ rootDir, fs: boundedFs });

    await expect(store.getProjectV2(projectId)).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      projectId,
    });
    expect(projectOpenCount).toBe(1);
    expect(projectReadFileCount).toBe(0);
    expect(protectedFs.accesses).toEqual([]);
  });

  it.each([
    ['nested object and array grammar', '{"payload":[{}],"schemaVersion":1}'],
    ['a unicode escape in a root value', '{"padding":"\\u0041","schemaVersion":1}'],
    ['a unicode escape in a nested key', '{"payload":{"\\u0078":1},"schemaVersion":1}'],
    ['a unicode escape in a nested array value', '{"payload":["\\u0041"],"schemaVersion":1}'],
    [
      'every nested scalar and container state',
      '{"payload":{"truth":true,"lie":false,"nil":null,"negative":-12,"zero":0,"fraction":1.25,"exponent":1e+2,"negativeExponent":1e-2,"array":[true,false,null,-0.1e+2,{},[]]},"schemaVersion":1}',
    ],
    ['root literal before the schema member', '{"enabled":true,"schemaVersion":1}'],
    ['root number before the schema member', '{"sequence":-1.5e+2,"schemaVersion":1}'],
    ['empty nested containers', '{"object":{},"array":[],"schemaVersion":1}'],
    ['simple JSON escapes', '{"padding":"\\\"\\\\\\/\\b\\f\\n\\r\\t","schemaVersion":1}'],
    ['an overflowing root-key token', `{"${'x'.repeat(300)}":0,"schemaVersion":1}`],
    ['a fractional spelling of schema one', '{"schemaVersion":1.0}'],
    ['a positive exponent spelling of schema one', '{"schemaVersion":1e+0}'],
    ['a decimal exponent spelling of schema one', '{"schemaVersion":0.1e1}'],
    ['a negative exponent spelling of schema one', '{"schemaVersion":10e-1}'],
    ['schema two', '{"schemaVersion":2}'],
    ['schema three with a decimal exponent', '{"schemaVersion":0.3e1}'],
    ['schema four with a negative exponent', '{"schemaVersion":40e-1}'],
  ])('accepts valid %s as a root prior-schema member', async (_label, bytes) => {
    const projectId = 'oversized_nested_v1';
    const projectFilePath = path.join(rootDir, projectId, 'project.json');
    mkdirSync(path.dirname(projectFilePath));
    writeFileSync(projectFilePath, bytes);
    const projectFile = realpathSync(projectFilePath);
    const oversizedFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property !== 'lstat') return Reflect.get(target, property, receiver) as unknown;
        return async (...args: Parameters<typeof nodeFs.lstat>) => {
          const stats = await nodeFs.lstat(...args);
          if (path.resolve(String(args[0])) !== projectFile) return stats;
          return new Proxy(stats, {
            get(statsTarget, statsProperty, statsReceiver) {
              if (statsProperty === 'size') return STUDIO_PROJECT_V2_MAX_RECORD_BYTES + 1;
              return Reflect.get(statsTarget, statsProperty, statsReceiver) as unknown;
            },
          });
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({ rootDir, fs: oversizedFs });

    await expect(store.getProjectV2(projectId)).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      projectId,
    });
  });

  it('loads a legacy OpenRouter binding without exact durations so route resolution can narrow it', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-openrouter-legacy-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    const legacy = {
      ...validConnectionBinding(),
      adapterId: 'openrouter-video-v1',
      model: 'google/veo-3.1-lite',
      capabilities: {
        mediaKinds: ['video'],
        audioModes: ['none'],
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p', '1080p'],
        minDurationSeconds: 4,
        maxDurationSeconds: 8,
        supportsFirstFrame: false,
        maxConditioningImages: 0,
        cancellationPolicy: 'none',
      },
    };
    try {
      writeFileSync(path.join(root, 'connections.json'), JSON.stringify({ schemaVersion: 1, connections: [legacy] }));

      await expect(connectionStore.listConnections()).resolves.toMatchObject([
        { adapterId: 'openrouter-video-v1', capabilities: { minDurationSeconds: 4, maxDurationSeconds: 8 } },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: 'OpenRouter cancellation beyond none',
      adapterId: 'openrouter-video-v1',
      capabilities: {
        mediaKinds: ['video'],
        audioModes: ['audio'],
        aspectRatios: ['16:9'],
        resolutions: ['720p'],
        minDurationSeconds: 4,
        maxDurationSeconds: 8,
        supportedDurationSeconds: [4, 8],
        supportsFirstFrame: false,
        maxConditioningImages: 0,
        cancellationPolicy: 'queued_only',
      },
    },
    {
      label: 'audio output on a media gateway',
      adapterId: 'weprompt-media-gateway-v1',
      capabilities: {
        mediaKinds: ['video'],
        audioModes: ['audio'],
        cancellationPolicy: 'none',
      },
    },
  ])('rejects $label at the durable connection boundary', async ({ adapterId, capabilities }) => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connection-poison-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      await expect(
        connectionStore.saveConnection({ ...validConnectionBinding(), adapterId, capabilities } as never)
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps a million-level schema sniff compact while preserving exact nested grammar', async () => {
    const projectId = 'oversized_compact_stack_v1';
    const projectFilePath = path.join(rootDir, projectId, 'project.json');
    const depth = 1_000_000;
    mkdirSync(path.dirname(projectFilePath));
    writeFileSync(projectFilePath, `{"payload":${'['.repeat(depth)}0${']'.repeat(depth)},"schemaVersion":1}`);
    const projectFile = realpathSync(projectFilePath);
    const heapBefore = process.memoryUsage().heapUsed;
    let peakHeapGrowth = 0;
    const oversizedFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'lstat') {
          return async (...args: Parameters<typeof nodeFs.lstat>) => {
            const stats = await nodeFs.lstat(...args);
            if (path.resolve(String(args[0])) !== projectFile) return stats;
            return new Proxy(stats, {
              get(statsTarget, statsProperty, statsReceiver) {
                if (statsProperty === 'size') return STUDIO_PROJECT_V2_MAX_RECORD_BYTES + 1;
                return Reflect.get(statsTarget, statsProperty, statsReceiver) as unknown;
              },
            });
          };
        }
        if (property === 'open') {
          return async (...args: Parameters<typeof nodeFs.open>) => {
            const handle = await nodeFs.open(...args);
            if (path.resolve(String(args[0])) !== projectFile) return handle;
            return new Proxy(handle, {
              get(handleTarget, handleProperty, handleReceiver) {
                if (handleProperty !== 'read') {
                  const value = Reflect.get(handleTarget, handleProperty, handleReceiver) as unknown;
                  return typeof value === 'function' ? value.bind(handleTarget) : value;
                }
                return (...readArgs: Parameters<typeof handle.read>) => {
                  peakHeapGrowth = Math.max(peakHeapGrowth, process.memoryUsage().heapUsed - heapBefore);
                  return handle.read(...readArgs);
                };
              },
            });
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({ rootDir, fs: oversizedFs });

    await expect(store.getProjectV2(projectId)).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      projectId,
    });
    expect(peakHeapGrowth).toBeLessThan(24 * 1024 * 1024);
  });

  it.each([
    ['leading garbage', 'garbage{"schemaVersion":1}'],
    ['future-version value bait', '{"schemaVersion":5,"bait":"schemaVersion":1}'],
    ['missing root comma', '{"schemaVersion":1 "future":3}'],
    ['valid future version with quoted bait', '{"schemaVersion":5,"bait":"schemaVersion:1"}'],
    ['crossed nested delimiters', '{"payload":[{]},"schemaVersion":1}'],
    ['invalid nested literal', '{"payload":{"x":garbage},"schemaVersion":1}'],
    ['missing nested comma', '{"payload":[1 2],"schemaVersion":1}'],
    ['a non-object root', '[{"schemaVersion":1}]'],
    ['an empty root object', '{}'],
    ['a missing root key', '{:1,"schemaVersion":1}'],
    ['a missing root colon', '{"padding" 1,"schemaVersion":1}'],
    ['an invalid root value', '{"padding":?,"schemaVersion":1}'],
    ['trailing root data', '{"schemaVersion":1}x'],
    ['an invalid simple escape', '{"padding":"\\q","schemaVersion":1}'],
    ['an invalid unicode escape', '{"padding":"\\u00xz","schemaVersion":1}'],
    ['an unescaped string control', '{"padding":"line\nbreak","schemaVersion":1}'],
    ['a truncated literal', '{"padding":tru'],
    ['an invalid literal', '{"padding":trux,"schemaVersion":1}'],
    ['a leading-zero number', '{"padding":01,"schemaVersion":1}'],
    ['a lone number sign', '{"padding":-,"schemaVersion":1}'],
    ['a fraction without digits', '{"padding":1.,"schemaVersion":1}'],
    ['an exponent without digits', '{"padding":1e,"schemaVersion":1}'],
    ['an exponent sign without digits', '{"padding":1e+,"schemaVersion":1}'],
    ['an invalid number suffix', '{"padding":1x,"schemaVersion":1}'],
    ['a nested object without a key', '{"payload":{:1},"schemaVersion":1}'],
    ['a nested object without a colon', '{"payload":{"x" 1},"schemaVersion":1}'],
    ['a nested object without a value', '{"payload":{"x":},"schemaVersion":1}'],
    ['a nested object trailing comma', '{"payload":{"x":1,},"schemaVersion":1}'],
    ['a nested array trailing comma', '{"payload":[1,],"schemaVersion":1}'],
    ['an invalid nested array value', '{"payload":[?],"schemaVersion":1}'],
    ['an unterminated root string', '{"padding":"open'],
    ['an unterminated nested container', '{"payload":[1,"schemaVersion":1}'],
  ])('rejects an oversized %s manifest instead of treating bait as schema 1', async (_label, bytes) => {
    const projectId = 'oversized_schema_bait';
    const projectFilePath = path.join(rootDir, projectId, 'project.json');
    mkdirSync(path.dirname(projectFilePath));
    writeFileSync(projectFilePath, bytes);
    const projectFile = realpathSync(projectFilePath);
    const oversizedFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property !== 'lstat') return Reflect.get(target, property, receiver) as unknown;
        return async (...args: Parameters<typeof nodeFs.lstat>) => {
          const stats = await nodeFs.lstat(...args);
          if (path.resolve(String(args[0])) !== projectFile) return stats;
          return new Proxy(stats, {
            get(statsTarget, statsProperty, statsReceiver) {
              if (statsProperty === 'size') return STUDIO_PROJECT_V2_MAX_RECORD_BYTES + 1;
              return Reflect.get(statsTarget, statsProperty, statsReceiver) as unknown;
            },
          });
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({ rootDir, fs: oversizedFs });

    await expect(store.getProjectV2(projectId)).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('bounds an oversized schema sniff to the opened size before rejecting concurrent growth', async () => {
    const projectId = 'oversized_growing_v1';
    const projectFilePath = path.join(rootDir, projectId, 'project.json');
    mkdirSync(path.dirname(projectFilePath));
    writeFileSync(projectFilePath, JSON.stringify({ schemaVersion: 1, id: projectId }));
    const projectFile = realpathSync(projectFilePath);
    let readCount = 0;
    const growingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'lstat') {
          return async (...args: Parameters<typeof nodeFs.lstat>) => {
            const stats = await nodeFs.lstat(...args);
            if (path.resolve(String(args[0])) !== projectFile || readCount > 0) return stats;
            return new Proxy(stats, {
              get(statsTarget, statsProperty, statsReceiver) {
                if (statsProperty === 'size') return STUDIO_PROJECT_V2_MAX_RECORD_BYTES + 1;
                return Reflect.get(statsTarget, statsProperty, statsReceiver) as unknown;
              },
            });
          };
        }
        if (property === 'open') {
          return async (...args: Parameters<typeof nodeFs.open>) => {
            const handle = await nodeFs.open(...args);
            if (path.resolve(String(args[0])) !== projectFile) return handle;
            return new Proxy(handle, {
              get(handleTarget, handleProperty, handleReceiver) {
                if (handleProperty !== 'read') {
                  const value = Reflect.get(handleTarget, handleProperty, handleReceiver) as unknown;
                  return typeof value === 'function' ? value.bind(handleTarget) : value;
                }
                return async (...readArgs: Parameters<typeof handle.read>) => {
                  readCount += 1;
                  if (readCount > 4) throw new Error('schema sniff did not honor the opened size');
                  const result = await handle.read(...readArgs);
                  writeFileSync(projectFile, ' ', { flag: 'a' });
                  return result;
                };
              },
            });
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({ rootDir, fs: growingFs });

    await expect(store.getProjectV2(projectId)).rejects.toMatchObject({ code: 'storage_error' });
    expect(readCount).toBe(1);
  });

  it('rejects a symlink raced into the manifest name during the oversized schema sniff', async () => {
    const projectId = 'oversized_sniff_race_v1';
    const projectFilePath = path.join(rootDir, projectId, 'project.json');
    const outsideDirectory = mkdtempSync(path.join(tmpdir(), 'creative-studio-schema-sniff-race-'));
    const outsideFile = path.join(outsideDirectory, 'project.json');
    mkdirSync(path.dirname(projectFilePath));
    writeFileSync(projectFilePath, JSON.stringify({ schemaVersion: 1, id: projectId }));
    writeFileSync(outsideFile, JSON.stringify({ schemaVersion: 1, id: projectId, outside: true }));
    const projectFile = realpathSync(projectFilePath);
    const outsideBefore = readFileSync(outsideFile);
    let raced = false;
    const racedFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'lstat') {
          return async (...args: Parameters<typeof nodeFs.lstat>) => {
            const stats = await nodeFs.lstat(...args);
            if (path.resolve(String(args[0])) !== projectFile || raced) return stats;
            return new Proxy(stats, {
              get(statsTarget, statsProperty, statsReceiver) {
                if (statsProperty === 'size') return STUDIO_PROJECT_V2_MAX_RECORD_BYTES + 1;
                return Reflect.get(statsTarget, statsProperty, statsReceiver) as unknown;
              },
            });
          };
        }
        if (property === 'open') {
          return (...args: Parameters<typeof nodeFs.open>) => {
            if (path.resolve(String(args[0])) === projectFile && !raced) {
              raced = true;
              rmSync(projectFile);
              symlinkSync(outsideFile, projectFile);
            }
            return nodeFs.open(...args);
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({ rootDir, fs: racedFs });

    try {
      await expect(store.getProjectV2(projectId)).rejects.toMatchObject({ code: 'storage_error' });
      expect(raced).toBe(true);
      expect(readFileSync(outsideFile)).toEqual(outsideBefore);
    } finally {
      await rm(outsideDirectory, { recursive: true, force: true });
    }
  });

  it('does not annex a pre-existing project directory that has sidecar data but no manifest', async () => {
    const projectId = 'reserved_v2';
    const projectDirectory = path.join(rootDir, projectId);
    const sidecarFile = path.join(projectDirectory, 'pending-command.sidecar');
    mkdirSync(projectDirectory);
    writeFileSync(sidecarFile, Buffer.from([0, 1, 2, 254, 255]));
    const rootEntriesBefore = readdirSync(rootDir).toSorted();
    const projectEntriesBefore = readdirSync(projectDirectory).toSorted();
    const sidecarBytesBefore = readFileSync(sidecarFile);
    const protectedFs = protectPrototypeIndex();
    const mutations = observeFileSystemMethods(
      new Set(['mkdir', 'open', 'rename', 'rm', 'rmdir', 'truncate', 'unlink', 'writeFile']),
      protectedFs.fs
    );
    const store = createCreativeStudioStore({
      rootDir,
      fs: mutations.fs,
      createId: () => projectId,
      now: () => timestamp,
    });

    await expect(store.createProjectV2(inputV2)).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(readdirSync(rootDir).toSorted()).toEqual(rootEntriesBefore);
    expect(readdirSync(projectDirectory).toSorted()).toEqual(projectEntriesBefore);
    expect(readFileSync(sidecarFile)).toEqual(sidecarBytesBefore);
    expect(existsSync(path.join(projectDirectory, 'project.json'))).toBe(false);
    expect(existsSync(path.join(rootDir, 'projects-v2.json'))).toBe(false);
    expect(mutations.calls).toEqual([]);
    expect(protectedFs.accesses).toEqual([]);
  });

  it('allows exactly one winner when two stores concurrently create the same generated project ID', async () => {
    const projectId = 'concurrent_v2';
    const leftInput = { ...inputV2, name: 'Left contender', brief: 'Created by the left store' };
    const rightInput = { ...inputV2, name: 'Right contender', brief: 'Created by the right store' };
    const left = createStoreV2({ createId: () => projectId, now: () => timestamp });
    const right = createStoreV2({ createId: () => projectId, now: () => timestamp });

    const outcomes = await Promise.allSettled([
      left.store.createProjectV2(leftInput),
      right.store.createProjectV2(rightInput),
    ]);
    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<StudioProjectV2> => outcome.status === 'fulfilled'
    );
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'invalid_payload' });
    const winner = fulfilled[0]!.value;
    const summary = {
      id: projectId,
      name: winner.name,
      aspectRatio: winner.aspectRatio,
      targetDurationSeconds: winner.targetDurationSeconds,
      resolution: winner.resolution,
      beatCount: 0,
      shotCount: 0,
      pictureCount: 0,
      createdAt: winner.createdAt,
      updatedAt: winner.updatedAt,
    };
    expectPersistedProjectV2(winner);
    expect(readJson(path.join(rootDir, 'projects-v2.json'))).toEqual({
      schemaVersion: 2,
      projects: [summary],
    });
    const restarted = createStoreV2().store;
    await expect(restarted.getProjectV2(projectId)).resolves.toEqual({ status: 'supported', project: winner });
    await expect(restarted.listProjectsV2()).resolves.toEqual({
      projects: [summary],
      projectRevisions: [{ projectId, revision: winner.revision }],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    expect(left.prototypeIndexAccesses).toEqual([]);
    expect(right.prototypeIndexAccesses).toEqual([]);
  });

  it('orders summaries by newest updated timestamp before project identity', async () => {
    const projectIds = ['older_summary_v2', 'newer_summary_v2'];
    const observedTimes = ['2026-08-17T12:00:00.000Z', '2026-08-17T12:00:01.000Z'];
    const { store } = createStoreV2({
      createId: () => projectIds.shift()!,
      now: () => observedTimes.shift()!,
    });

    const older = await store.createProjectV2({ ...inputV2, name: 'Older summary' });
    const newer = await store.createProjectV2({ ...inputV2, name: 'Newer summary' });

    await expect(store.listProjectsV2()).resolves.toMatchObject({
      projects: [{ id: newer.id }, { id: older.id }],
    });
  });

  it('validates create input before creating or writing an absent storage root', async () => {
    const absentRoot = path.join(rootDir, 'absent-store');
    const mutations = observeFileSystemMethods(new Set(['mkdir', 'open', 'rename', 'rm', 'writeFile']));
    const store = createCreativeStudioStore({
      rootDir: absentRoot,
      fs: mutations.fs,
      createId: () => 'invalid_input_v2',
      now: () => timestamp,
    });
    const invalidInput = { ...inputV2, unexpected: true } as CreateStudioProjectInputV2;

    await expect(store.createProjectV2(invalidInput)).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(mutations.calls).toEqual([]);
    expect(existsSync(absentRoot)).toBe(false);
  });

  it('rejects oversized generated and caller project IDs before any filesystem path access', async () => {
    const oversizedId = 'p'.repeat(257);
    const pathAccesses = observeFileSystemMethods(
      new Set([
        'access',
        'appendFile',
        'chmod',
        'chown',
        'copyFile',
        'cp',
        'link',
        'lstat',
        'mkdir',
        'open',
        'readFile',
        'readdir',
        'readlink',
        'realpath',
        'rename',
        'rm',
        'rmdir',
        'stat',
        'symlink',
        'truncate',
        'unlink',
        'utimes',
        'writeFile',
      ])
    );
    const store = createCreativeStudioStore({
      rootDir,
      fs: pathAccesses.fs,
      createId: () => oversizedId,
      now: () => timestamp,
    });
    const oversizedBatch: StudioMutationBatchV2 = {
      schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
      projectId: oversizedId,
      expectedRevision: 1,
      operations: [{ kind: 'set_brief', brief: 'must not reach storage' }],
    };

    await expect(store.createProjectV2(inputV2)).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.getProjectV2(oversizedId)).resolves.toEqual({ status: 'not_found', projectId: oversizedId });
    await expect(store.applyMutationBatchV2(oversizedBatch, makeMutationContextV2())).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(store.deleteProjectV2(oversizedId, 1)).resolves.toBe(false);
    expect(pathAccesses.calls).toEqual([]);
  });

  it('scans schema-2 manifests sequentially with one bounded read handle at a time', async () => {
    const projectIds = ['scan_a', 'scan_b', 'scan_c'];
    for (const projectId of projectIds) seedProjectV2(createEmptyStudioProjectV2(inputV2, projectId, timestamp));
    let activeManifestHandles = 0;
    let maxConcurrentManifestHandles = 0;
    const sequentialFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property !== 'open') return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const file = path.resolve(String(args[0]));
          const handle = await nodeFs.open(...args);
          if (!file.endsWith(`${path.sep}project.json`)) return handle;
          activeManifestHandles += 1;
          maxConcurrentManifestHandles = Math.max(maxConcurrentManifestHandles, activeManifestHandles);
          let closed = false;
          return new Proxy(handle, {
            get(handleTarget, handleProperty, handleReceiver) {
              const value = Reflect.get(handleTarget, handleProperty, handleReceiver) as unknown;
              if (typeof value !== 'function') return value;
              if (handleProperty === 'read') {
                return async (...readArgs: unknown[]) => {
                  await new Promise<void>((resolve) => setTimeout(resolve, 10));
                  return Reflect.apply(value, handleTarget, readArgs);
                };
              }
              if (handleProperty === 'close') {
                return async (...closeArgs: unknown[]): Promise<void> => {
                  try {
                    await Reflect.apply(value, handleTarget, closeArgs);
                  } finally {
                    if (!closed) {
                      closed = true;
                      activeManifestHandles -= 1;
                    }
                  }
                };
              }
              return value.bind(handleTarget);
            },
          });
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({ rootDir, fs: sequentialFs });

    await expect(store.inspectProjectsV2()).resolves.toEqual({
      supportedProjectIds: projectIds,
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    expect(maxConcurrentManifestHandles).toBe(1);
    expect(activeManifestHandles).toBe(0);
  });

  it('keeps an absent storage root read-only while reporting empty and missing results', async () => {
    const absentRoot = path.join(rootDir, 'absent-read-store');
    const store = createCreativeStudioStore({ rootDir: absentRoot });

    await expect(store.inspectProjectsV2()).resolves.toEqual({
      supportedProjectIds: [],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    await expect(store.listProjectsV2()).resolves.toEqual({
      projects: [],
      projectRevisions: [],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    await expect(store.getProjectV2('missing_v2')).resolves.toEqual({
      status: 'not_found',
      projectId: 'missing_v2',
    });
    expect(existsSync(absentRoot)).toBe(false);
  });

  it('does not create absent storage while rejecting and ignoring missing mutations', async () => {
    const absentRoot = path.join(rootDir, 'absent-mutation-store');
    const store = createCreativeStudioStore({ rootDir: absentRoot });

    await expect(
      store.applyMutationBatchV2(makeBoundaryMutationBatchV2('missing_v2'), makeMutationContextV2())
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.deleteProjectV2('missing_v2', 1)).resolves.toBe(false);
    expect(existsSync(absentRoot)).toBe(false);
  });

  it('rejects malformed create arguments before allocating storage', async () => {
    const absentRoot = path.join(rootDir, 'absent-create-store');
    const createId = vi.fn(() => 'generated_v2');
    const store = createCreativeStudioStore({ rootDir: absentRoot, createId, now: () => timestamp });

    await expect(store.createProjectV2(null as never)).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(
      store.createProjectV2({ ...inputV2, id: 'caller_v2' } as CreateStudioProjectInputV2)
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(createId).not.toHaveBeenCalled();
    expect(existsSync(absentRoot)).toBe(false);
  });

  it('rejects invalid mutation revisions before consulting storage', async () => {
    const absentRoot = path.join(rootDir, 'absent-revision-store');
    const store = createCreativeStudioStore({ rootDir: absentRoot });
    const identityUpdate = (project: StudioProjectV2): StudioProjectV2 => project;

    await expect(
      store.applyMutationBatchV2(makeBoundaryMutationBatchV2('missing_v2', 0), makeMutationContextV2())
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.updateProjectV2('../unsafe', identityUpdate)).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.updateProjectV2('missing_v2', identityUpdate, 0)).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(store.withProjectAuthorityV2('../unsafe', async () => undefined)).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(store.deleteProjectWithSidecarAuthorityV2('../unsafe', 1, async () => false)).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(store.deleteProjectV2('missing_v2', 0)).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(existsSync(absentRoot)).toBe(false);
  });

  it('requires an exact reducer context before queueing or consulting storage', async () => {
    const absentRoot = path.join(rootDir, 'absent-context-store');
    const mutations = observeFileSystemMethods(
      new Set(['access', 'mkdir', 'open', 'readFile', 'readdir', 'rename', 'rm', 'stat', 'writeFile'])
    );
    const store = createCreativeStudioStore({ rootDir: absentRoot, fs: mutations.fs });
    const batch = makeBoundaryMutationBatchV2('missing_v2');
    const invokeWithoutContext = store.applyMutationBatchV2 as unknown as (
      input: StudioMutationBatchV2
    ) => Promise<unknown>;
    const symbolContext = { ...makeMutationContextV2(), [Symbol('unexpected')]: true };
    const invalidContexts: unknown[] = [
      null,
      {},
      { mutationId: '../unsafe', capturedAt: timestamp },
      { mutationId: 'mutation_bad_time', capturedAt: '2026-08-17' },
      { ...makeMutationContextV2(), unexpected: true },
      symbolContext,
    ];

    await expect(invokeWithoutContext(batch)).rejects.toMatchObject({ code: 'invalid_payload' });
    for (const context of invalidContexts) {
      await expect(store.applyMutationBatchV2(batch, context as StudioMutationReducerContextV2)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    }

    expect(mutations.calls).toEqual([]);
    expect(existsSync(absentRoot)).toBe(false);
  });

  it('distinguishes absent manifests in an existing storage root', async () => {
    const { store, prototypeIndexAccesses } = createStoreV2();

    await expect(
      store.applyMutationBatchV2(makeBoundaryMutationBatchV2('missing_v2'), makeMutationContextV2())
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.deleteProjectV2('missing_v2', 1)).resolves.toBe(false);
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('refuses prototype and malformed manifests through mutation entry points', async () => {
    mkdirSync(path.join(rootDir, 'prototype_boundary_v1'));
    mkdirSync(path.join(rootDir, 'malformed_boundary_v2'));
    writeFileSync(
      path.join(rootDir, 'prototype_boundary_v1', 'project.json'),
      JSON.stringify({ schemaVersion: 1, id: 'prototype_boundary_v1' })
    );
    writeFileSync(
      path.join(rootDir, 'malformed_boundary_v2', 'project.json'),
      JSON.stringify({ schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION, id: 'malformed_boundary_v2' })
    );
    const { store, prototypeIndexAccesses } = createStoreV2();

    await expect(
      store.applyMutationBatchV2(makeBoundaryMutationBatchV2('prototype_boundary_v1'), makeMutationContextV2())
    ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
    await expect(
      store.applyMutationBatchV2(makeBoundaryMutationBatchV2('malformed_boundary_v2'), makeMutationContextV2())
    ).rejects.toMatchObject({ code: 'storage_error' });
    await expect(store.deleteProjectV2('malformed_boundary_v2', 1)).rejects.toMatchObject({ code: 'storage_error' });
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('records an omitted commit tag and rejects deletion with the previous revision', async () => {
    const onProjectCommitted = vi.fn();
    const { store, prototypeIndexAccesses } = createStoreV2({
      createId: () => 'committed_boundary_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);

    const applied = await store.applyMutationBatchV2(
      makeBoundaryMutationBatchV2(project.id, project.revision),
      makeMutationContextV2()
    );
    const scoped = await store.withProjectAuthorityV2(applied.project.id, (snapshot) =>
      snapshot.commit((current) => ({ ...current, brief: 'Scoped commit without a tag' }), applied.project.revision)
    );

    expect(applied.project.revision).toBe(project.revision + 1);
    expect(scoped.revision).toBe(applied.project.revision + 1);
    expect(onProjectCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ commitTag: null }));
    await expect(store.deleteProjectV2(project.id, project.revision)).rejects.toMatchObject({ code: 'stale_project' });
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('holds trusted project authority on the existing project queue and returns an isolated snapshot', async () => {
    const { store } = createStoreV2({ createId: () => 'export_authority_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const entered = createDeferredV2<void>();
    const release = createDeferredV2<void>();
    const authority = store.withProjectAuthorityV2(project.id, async (snapshot) => {
      expect(snapshot.project).toEqual(project);
      expect(realpathSync(snapshot.projectDir)).toBe(snapshot.projectDir);
      expect(snapshot.assertCurrent).toEqual(expect.any(Function));
      await snapshot.assertCurrent?.();
      snapshot.project.name = 'must not escape the isolated snapshot';
      entered.resolve();
      await release.promise;
      return snapshot.project.revision;
    });
    await entered.promise;

    const mutation = store.applyMutationBatchV2(
      makeBoundaryMutationBatchV2(project.id, project.revision),
      makeMutationContextV2()
    );
    let mutationSettled = false;
    void mutation.finally(() => {
      mutationSettled = true;
    });
    await Promise.resolve();
    expect(mutationSettled).toBe(false);

    release.resolve();
    await expect(authority).resolves.toBe(project.revision);
    const committed = await mutation;
    expect(committed.project.name).toBe(project.name);
    expect(committed.project.brief).toBe('Updated without a commit tag');
  });

  it('offers one scoped inside-queue commit and rejects reuse after the authority expires', async () => {
    const onProjectCommitted = vi.fn();
    const { store } = createStoreV2({
      createId: () => 'export_media_authority_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    let escapedCommit: StudioProjectAuthoritySnapshotV2['commit'] | null = null;

    const committed = await store.withProjectAuthorityV2(project.id, async (snapshot) => {
      escapedCommit = snapshot.commit;
      const update = (current: StudioProjectV2): StudioProjectV2 => ({
        ...current,
        brief: 'Committed under shared managed-byte authority',
      });
      await expect(snapshot.commit(update, 0)).rejects.toMatchObject({ code: 'invalid_payload' });
      await expect(snapshot.commit(update, project.revision, 1 as never)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
      await expect(
        snapshot.commit(update, project.revision, 'managed_media', 'not-an-authorizer' as never)
      ).rejects.toMatchObject({ code: 'invalid_payload' });
      const result = await snapshot.commit(update, project.revision, 'managed_media');
      await expect(snapshot.commit((current) => current, result.revision)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
      return result;
    });

    expect(committed.revision).toBe(project.revision + 1);
    expect(committed.brief).toBe('Committed under shared managed-byte authority');
    expect(onProjectCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ commitTag: 'managed_media' }));
    await expect(escapedCommit!((current) => current, committed.revision)).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { revision: committed.revision, brief: committed.brief },
    });
  });

  it('offers one scoped deletion while the project authority queue remains held', async () => {
    const { store } = createStoreV2({ createId: () => 'scoped_delete_authority_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    let escapedDelete: StudioProjectAuthoritySnapshotV2['delete'] | null = null;
    const authorizeBeforeDelete = vi.fn();

    const deleted = await store.withProjectAuthorityV2(project.id, async (snapshot) => {
      escapedDelete = snapshot.delete;
      await expect(snapshot.delete(project.revision, 'not-an-authorizer' as never)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
      return snapshot.delete(project.revision, authorizeBeforeDelete);
    });

    expect(deleted).toBe(true);
    expect(authorizeBeforeDelete).toHaveBeenCalledTimes(2);
    await expect(store.getProjectV2(project.id)).resolves.toEqual({ status: 'not_found', projectId: project.id });
    await expect(escapedDelete!(project.revision)).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('refuses scoped deletion at the final lifecycle fence before publishing its durable marker', async () => {
    const { store } = createStoreV2({ createId: () => 'scoped_delete_close_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const authorizeBeforeDelete = vi.fn(() => {
      throw new CreativeStudioStoreError('busy', 'Studio service closed before deletion');
    });

    await expect(
      store.withProjectAuthorityV2(project.id, (snapshot) => snapshot.delete(project.revision, authorizeBeforeDelete))
    ).rejects.toMatchObject({ code: 'busy' });

    expect(authorizeBeforeDelete).toHaveBeenCalledOnce();
    await expect(store.getProjectV2(project.id)).resolves.toEqual({ status: 'supported', project });
    expect(existsSync(path.join(realpathSync(rootDir), `.delete-${project.id}.json`))).toBe(false);
  });

  it('keeps a detached authority commit inside the queue until its publication settles', async () => {
    const commitEntered = createDeferredV2<void>();
    const releaseCommit = createDeferredV2<void>();
    let delayNextProjectTemporary = false;
    const delayedFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property !== 'open') return Reflect.get(target, property, receiver) as unknown;
        return async (...args: Parameters<typeof nodeFs.open>): Promise<Awaited<ReturnType<typeof nodeFs.open>>> => {
          const handle = await nodeFs.open(...args);
          const file = String(args[0]);
          if (!delayNextProjectTemporary || !/project\.json\.\d+\.\d+\.tmp$/.test(file)) return handle;
          delayNextProjectTemporary = false;
          return new Proxy(handle, {
            get(handleTarget, handleProperty) {
              if (handleProperty !== 'sync') {
                const value = Reflect.get(handleTarget, handleProperty, handleTarget) as unknown;
                return typeof value === 'function' ? value.bind(handleTarget) : value;
              }
              return async (): Promise<void> => {
                commitEntered.resolve();
                await releaseCommit.promise;
                await handle.sync();
              };
            },
          });
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({
      rootDir,
      fs: delayedFs,
      createId: () => 'detached_authority_commit_v2',
      now: () => timestamp,
      logError: () => undefined,
    });
    const project = await store.createProjectV2(inputV2);
    delayNextProjectTemporary = true;

    const authority = store.withProjectAuthorityV2(project.id, async (snapshot) => {
      void snapshot.commit(
        (current) => ({ ...current, brief: 'Detached commit remains queue-owned' }),
        project.revision,
        'detached_authority'
      );
      return 'operation-returned';
    });
    await commitEntered.promise;
    let authoritySettled = false;
    void authority.finally(() => {
      authoritySettled = true;
    });
    const following = store.updateProjectV2(project.id, (current) => ({ ...current, name: 'Following mutation' }));
    let followingSettled = false;
    void following.finally(() => {
      followingSettled = true;
    });
    await Promise.resolve();
    expect(authoritySettled).toBe(false);
    expect(followingSettled).toBe(false);

    releaseCommit.resolve();
    await expect(authority).resolves.toBe('operation-returned');
    const finalProject = await following;
    expect(finalProject.revision).toBe(project.revision + 2);
    expect(finalProject.brief).toBe('Detached commit remains queue-owned');
    expect(finalProject.name).toBe('Following mutation');
  });

  it('rechecks the scoped lifecycle authorizer after the project temporary is durable', async () => {
    const temporarySynced = createDeferredV2<void>();
    const releaseTemporary = createDeferredV2<void>();
    let delayNextProjectTemporary = false;
    const delayedFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property !== 'open') return Reflect.get(target, property, receiver) as unknown;
        return async (...args: Parameters<typeof nodeFs.open>): Promise<Awaited<ReturnType<typeof nodeFs.open>>> => {
          const handle = await nodeFs.open(...args);
          const file = String(args[0]);
          if (!delayNextProjectTemporary || !/project\.json\.\d+\.\d+\.tmp$/.test(file)) return handle;
          delayNextProjectTemporary = false;
          return new Proxy(handle, {
            get(handleTarget, handleProperty) {
              if (handleProperty !== 'sync') {
                const value = Reflect.get(handleTarget, handleProperty, handleTarget) as unknown;
                return typeof value === 'function' ? value.bind(handleTarget) : value;
              }
              return async (): Promise<void> => {
                await handle.sync();
                temporarySynced.resolve();
                await releaseTemporary.promise;
              };
            },
          });
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({
      rootDir,
      fs: delayedFs,
      createId: () => 'lifecycle_authority_commit_v2',
      now: () => timestamp,
      logError: () => undefined,
    });
    const project = await store.createProjectV2(inputV2);
    let active = true;
    delayNextProjectTemporary = true;

    const authority = store.withProjectAuthorityV2(project.id, async (snapshot) =>
      snapshot.commit(
        (current) => ({ ...current, brief: 'must not publish after close' }),
        project.revision,
        'lifecycle_authority',
        () => {
          if (!active) throw new Error('Studio service is closed');
        }
      )
    );
    await temporarySynced.promise;
    active = false;
    releaseTemporary.resolve();

    await expect(authority).rejects.toThrow('Studio service is closed');
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { revision: project.revision, brief: project.brief },
    });
  });

  it('expires every captured authority capability after a detached commit fails', async () => {
    const { store } = createStoreV2({ createId: () => 'failed_authority_commit_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    let escapedAssertCurrent: StudioProjectAuthoritySnapshotV2['assertCurrent'] = undefined;
    let escapedCommit: StudioProjectAuthoritySnapshotV2['commit'] | null = null;

    await expect(
      store.withProjectAuthorityV2(project.id, async (snapshot) => {
        escapedAssertCurrent = snapshot.assertCurrent;
        escapedCommit = snapshot.commit;
        void snapshot.commit(
          (current) => ({ ...current, id: 'changed_identity_is_invalid' }),
          project.revision,
          'invalid_detached_authority'
        );
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(() => escapedAssertCurrent!()).toThrow('Studio project authority has expired');
    await expect(escapedCommit!((current) => current, project.revision)).rejects.toMatchObject({
      code: 'invalid_payload',
    });
  });

  it('snapshots reducer context before queue work and ignores later caller mutation', async () => {
    const { store } = createStoreV2({ createId: () => 'context_snapshot_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const context = makeMutationContextV2({
      mutationId: 'mutation_context_snapshot',
      capturedAt: '2026-08-17T12:34:56.000Z',
    });
    const pending = store.applyMutationBatchV2(
      makeStudioMutationBatchV2(project, [
        {
          kind: 'set_rules',
          rules: [{ id: 'rule_1', text: 'Keep the logo visible', predicate: null }],
        },
      ]),
      context
    );

    context.mutationId = 'mutation_changed_after_call';
    context.capturedAt = '2026-08-17T23:59:59.000Z';
    const applied = await pending;

    expect(applied.project.rules).toEqual([
      {
        id: 'rule_1',
        scope: 'project',
        text: 'Keep the logo visible',
        predicate: null,
        createdAt: '2026-08-17T12:34:56.000Z',
      },
    ]);
    expect(applied.project.undoHistory.at(-1)).toMatchObject({
      id: 'mutation_context_snapshot',
      sourceRevision: project.revision + 1,
    });
  });

  it('snapshots the complete mutation batch before selecting its project queue', async () => {
    const ids = ['batch_snapshot_a_v2', 'batch_snapshot_b_v2'];
    const { store } = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_batch_snapshot',
      now: () => timestamp,
    });
    const firstProject = await store.createProjectV2(inputV2);
    const secondProject = await store.createProjectV2(inputV2);
    const revalidationStarted = createDeferredV2<void>();
    const releaseRevalidation = createDeferredV2<void>();
    const expectedFailure = new Error('release the project queue without a commit');
    const blocker = store.confirmProjectV2({
      projectId: firstProject.id,
      expectedRevision: firstProject.revision,
      expiresAt: '2026-08-17T12:05:00.000Z',
      async revalidate() {
        revalidationStarted.resolve(undefined);
        await releaseRevalidation.promise;
        throw expectedFailure;
      },
      assertActive: () => undefined,
      buildCommit: (project) => ({ project, dispatch: null }),
    });
    await revalidationStarted.promise;
    const batch = makeStudioMutationBatchV2(firstProject, [{ kind: 'set_brief', brief: 'Original batch' }]);
    const pending = store.applyMutationBatchV2(batch, makeMutationContextV2({ mutationId: 'mutation_batch_snapshot' }));

    batch.projectId = secondProject.id;
    (batch.operations[0] as { kind: 'set_brief'; brief: string }).brief = 'Caller mutation';
    releaseRevalidation.resolve(undefined);

    await expect(blocker).rejects.toBe(expectedFailure);
    await expect(pending).resolves.toMatchObject({ project: { id: firstProject.id, brief: 'Original batch' } });
    await expect(store.getProjectV2(secondProject.id)).resolves.toMatchObject({
      status: 'supported',
      project: { id: secondProject.id, brief: secondProject.brief, revision: secondProject.revision },
    });
  });

  it.each(['mutation', 'update', 'confirmation'] as const)(
    'CAS-fences a schema-2 %s write against a same-revision project replacement',
    async (operation) => {
      const projectId = `ordinary_cas_${operation}_v2`;
      const projectDirectory = path.join(realpathSync(rootDir), projectId);
      const projectFile = path.join(projectDirectory, 'project.json');
      const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
      let armed = false;
      let replaced = false;
      let externalBytes = '';
      const racingFs = new Proxy(nodeFs, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver) as unknown;
          if (property !== 'open' || typeof value !== 'function') return value;
          return async (...args: Parameters<typeof nodeFs.open>) => {
            const handle = await nodeFs.open(...args);
            const opened = String(args[0]);
            if (armed && !replaced && opened.startsWith(`${projectFile}.`) && opened.endsWith('.tmp')) {
              const replacement = `${projectFile}.external`;
              writeFileSync(replacement, externalBytes);
              renameSync(replacement, projectFile);
              replaced = true;
            }
            return handle;
          };
        },
      }) as typeof nodeFs;
      const store = createCreativeStudioStore({
        rootDir,
        fs: racingFs,
        createId: () => projectId,
        now: () => timestamp,
        logError: () => undefined,
        onProjectCommitted,
      });
      const project = await store.createProjectV2(inputV2);
      const replacement: StudioProjectV2 = { ...project, name: `External ${operation} winner` };
      externalBytes = `${JSON.stringify(createStudioProjectManifestV2(replacement), null, 2)}\n`;
      const indexFile = path.join(rootDir, 'projects-v2.json');
      const indexBefore = readFileSync(indexFile);
      armed = true;

      const attempt =
        operation === 'mutation'
          ? store.applyMutationBatchV2(
              makeStudioMutationBatchV2(project, [{ kind: 'set_brief', brief: 'Must not overwrite' }]),
              makeMutationContextV2({ mutationId: 'mutation_ordinary_cas' })
            )
          : operation === 'update'
            ? store.updateProjectV2(
                project.id,
                (candidate) => ({ ...candidate, brief: 'Must not overwrite' }),
                project.revision
              )
            : store.confirmProjectV2({
                projectId: project.id,
                expectedRevision: project.revision,
                expiresAt: '2026-08-17T12:05:00.000Z',
                revalidate: async () => ({ routeId: 'video_route' }),
                assertActive: () => undefined,
                buildCommit: (candidate) => ({
                  project: { ...candidate, brief: 'Must not overwrite' },
                  dispatch: { jobIds: ['job_ordinary_cas'] },
                }),
              });

      await expect(attempt).rejects.toMatchObject({ code: 'storage_error' });
      expect(replaced).toBe(true);
      expect(readFileSync(projectFile, 'utf8')).toBe(externalBytes);
      expect(readFileSync(indexFile)).toEqual(indexBefore);
      expect(onProjectCommitted).not.toHaveBeenCalled();
      await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
        status: 'supported',
        project: { name: replacement.name, revision: project.revision },
      });
    }
  );

  it('refuses stale and same-context replay without rewriting or observing a second commit', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({
      createId: () => 'context_replay_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const context = makeMutationContextV2({ mutationId: 'mutation_replay' });
    const originalBatch = makeStudioMutationBatchV2(project, [{ kind: 'set_brief', brief: 'Applied once' }]);
    const first = await store.applyMutationBatchV2(originalBatch, context);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const committedProjectBytes = readFileSync(projectFile);
    const committedIndexBytes = readFileSync(indexFile);

    await expect(store.applyMutationBatchV2(originalBatch, context)).rejects.toMatchObject({
      code: 'stale_project',
    });
    await expect(
      store.applyMutationBatchV2({ ...originalBatch, expectedRevision: first.project.revision }, context)
    ).rejects.toMatchObject({ reasonCode: 'identity_collision' });

    expect(readFileSync(projectFile)).toEqual(committedProjectBytes);
    expect(readFileSync(indexFile)).toEqual(committedIndexBytes);
    expect(onProjectCommitted).toHaveBeenCalledTimes(1);
  });

  it('serializes same-revision V2 batches so exactly one context reaches the reducer commit', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({
      createId: () => 'context_cas_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const outcomes = await Promise.allSettled([
      store.applyMutationBatchV2(
        makeStudioMutationBatchV2(project, [{ kind: 'set_brief', brief: 'Left winner' }]),
        makeMutationContextV2({ mutationId: 'mutation_left' })
      ),
      store.applyMutationBatchV2(
        makeStudioMutationBatchV2(project, [{ kind: 'set_brief', brief: 'Right winner' }]),
        makeMutationContextV2({ mutationId: 'mutation_right' })
      ),
    ]);
    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<StudioMutationApplyResultV2> => outcome.status === 'fulfilled'
    );
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'stale_project' });
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { revision: project.revision + 1, brief: fulfilled[0]!.value.project.brief },
    });
    expect(onProjectCommitted).toHaveBeenCalledTimes(1);
  });

  it('rejects a symlinked project identity during inventory inspection', async () => {
    const backingDirectory = path.join(rootDir, '.inventory-symlink-backing');
    mkdirSync(backingDirectory);
    symlinkSync(backingDirectory, path.join(rootDir, 'unsafe_inventory_v2'), 'dir');
    const { store, prototypeIndexAccesses } = createStoreV2();

    await expect(store.inspectProjectsV2()).rejects.toMatchObject({ code: 'storage_error' });
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('creates an exact empty project in projects-v2.json and reloads it after restart', async () => {
    const { store, prototypeIndexAccesses } = createStoreV2({
      createId: () => 'created_v2',
      now: () => timestamp,
    });

    const project = await store.createProjectV2(inputV2);

    expect(project).toEqual(createEmptyStudioProjectV2(inputV2, 'created_v2', timestamp));
    expect(existsSync(path.join(rootDir, 'projects.json'))).toBe(false);
    expect(readJson(path.join(rootDir, 'projects-v2.json'))).toEqual({
      schemaVersion: 2,
      projects: [
        {
          id: project.id,
          name: 'Schema Two Film',
          aspectRatio: '16:9',
          targetDurationSeconds: 30,
          resolution: '1080p',
          beatCount: 0,
          shotCount: 0,
          pictureCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });

    const restarted = createStoreV2().store;
    await expect(restarted.getProjectV2(project.id)).resolves.toEqual({ status: 'supported', project });
    await expect(restarted.listProjectsV2()).resolves.toEqual({
      projects: [expect.objectContaining({ id: project.id, beatCount: 0, shotCount: 0 })],
      projectRevisions: [{ projectId: project.id, revision: project.revision }],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it.each([
    ['missing', null],
    [
      'stale',
      JSON.stringify({
        schemaVersion: 2,
        projects: [
          {
            id: 'phantom_v2',
            name: 'Phantom project',
            aspectRatio: '9:16',
            targetDurationSeconds: 99,
            resolution: '4k',
            beatCount: 9,
            shotCount: 9,
            pictureCount: 9,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      }),
    ],
    ['corrupt', '{not-json'],
    ['wrong schema', JSON.stringify({ schemaVersion: 1, projects: [] })],
  ])('repairs a %s schema-2 index from classified manifests only', async (_label, indexBytes) => {
    const prototype = await seedPrototypeProject();
    const project = createEmptyStudioProjectV2(inputV2, 'healthy_v2', timestamp);
    seedProjectV2(project);
    const malformedId = 'broken_v2';
    mkdirSync(path.join(rootDir, malformedId));
    writeFileSync(
      path.join(rootDir, malformedId, 'project.json'),
      JSON.stringify({ schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION, id: malformedId })
    );
    if (indexBytes !== null) writeFileSync(path.join(rootDir, 'projects-v2.json'), indexBytes);
    const prototypeIndexBefore = readFileSync(path.join(rootDir, 'projects.json'));
    const { store, prototypeIndexAccesses } = createStoreV2();
    const expectedSummary = {
      id: project.id,
      name: project.name,
      aspectRatio: project.aspectRatio,
      targetDurationSeconds: project.targetDurationSeconds,
      resolution: project.resolution,
      beatCount: 0,
      shotCount: 0,
      pictureCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await expect(store.listProjectsV2()).resolves.toEqual({
      projects: [expectedSummary],
      projectRevisions: [{ projectId: project.id, revision: project.revision }],
      unsupportedProjectIds: [prototype.id],
      quarantinedProjectIds: [malformedId],
    });
    expect(readJson(path.join(rootDir, 'projects-v2.json'))).toEqual({
      schemaVersion: 2,
      projects: [expectedSummary],
    });
    expect(readFileSync(path.join(rootDir, 'projects.json'))).toEqual(prototypeIndexBefore);
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('lists schema-1 separately and persists the exact active video poster summary', async () => {
    const prototype = await seedPrototypeProject();
    const project = makePosterProjectV2();
    seedProjectV2(project);
    writeFileSync(path.join(rootDir, 'projects-v2.json'), JSON.stringify({ schemaVersion: 2, projects: [] }));
    const { store, prototypeIndexAccesses } = createStoreV2();
    const summary = {
      id: project.id,
      name: project.name,
      aspectRatio: '16:9',
      targetDurationSeconds: 30,
      resolution: '1080p',
      beatCount: 1,
      shotCount: 1,
      pictureCount: 1,
      poster: {
        beatId: 'section_1',
        shotId: 'clip_video',
        assetId: 'asset_thumbnail',
        beatPosition: 1,
        shotPosition: 1,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await expect(store.listProjectsV2()).resolves.toEqual({
      projects: [summary],
      projectRevisions: [{ projectId: project.id, revision: project.revision }],
      unsupportedProjectIds: [prototype.id],
      quarantinedProjectIds: [],
    });
    expect(readJson(path.join(rootDir, 'projects-v2.json'))).toEqual({
      schemaVersion: 2,
      projects: [summary],
    });
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('rolls back an earlier operation when a later operation fails', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({ createId: () => 'rollback_v2', now: () => timestamp, onProjectCommitted });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const beforeProject = readFileSync(projectFile);
    const beforeIndex = readFileSync(indexFile);

    await expect(
      store.applyMutationBatchV2(
        makeStudioMutationBatchV2(project, [
          { kind: 'set_brief', brief: 'must roll back' },
          { kind: 'delete_shot', shotId: 'missing_clip' },
        ]),
        makeMutationContextV2({ mutationId: 'mutation_rollback' }),
        'rollback/test'
      )
    ).rejects.toMatchObject({ reasonCode: 'invalid_operation' });

    expect(readFileSync(projectFile)).toEqual(beforeProject);
    expect(readFileSync(indexFile)).toEqual(beforeIndex);
    expect(onProjectCommitted).not.toHaveBeenCalled();
  });

  it('rejects stale mutation authority before writing or observing', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({ createId: () => 'stale_v2', now: () => timestamp, onProjectCommitted });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const beforeProject = readFileSync(projectFile);
    const beforeIndex = readFileSync(indexFile);

    await expect(
      store.applyMutationBatchV2(
        makeStudioMutationBatchV2(project, [{ kind: 'set_brief', brief: 'stale write' }], project.revision + 1),
        makeMutationContextV2({ mutationId: 'mutation_stale' }),
        'stale/test'
      )
    ).rejects.toMatchObject({ code: 'stale_project' });

    expect(readFileSync(projectFile)).toEqual(beforeProject);
    expect(readFileSync(indexFile)).toEqual(beforeIndex);
    expect(onProjectCommitted).not.toHaveBeenCalled();
  });

  it('commits a multi-operation batch as one revision and one frozen observer fact', async () => {
    const facts: Parameters<StudioProjectCommitObserver>[0][] = [];
    const events: string[] = [];
    let clock = Date.parse(timestamp);
    const canonicalRoot = realpathSync(rootDir);
    const committedProjectDirectory = path.join(canonicalRoot, 'committed_v2');
    const protectedFs = protectPrototypeIndex();
    const trackingFs = new Proxy(protectedFs.fs, {
      get(target, property, receiver) {
        if (property === 'rename') {
          return async (...args: Parameters<typeof nodeFs.rename>): ReturnType<typeof nodeFs.rename> => {
            const destination = path.resolve(String(args[1]));
            await protectedFs.fs.rename(...args);
            if (destination.endsWith(`${path.sep}project.json`)) events.push('project-rename');
            if (destination === path.join(canonicalRoot, 'projects-v2.json')) events.push('index-rename');
          };
        }
        if (property !== 'open') return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const file = path.resolve(String(args[0]));
          const handle = await protectedFs.fs.open(...args);
          return new Proxy(handle, {
            get(handleTarget, handleProperty, handleReceiver) {
              if (handleProperty === 'sync' && file === committedProjectDirectory) {
                return async (): Promise<void> => {
                  await handleTarget.sync();
                  events.push('project-directory-sync');
                };
              }
              const value = Reflect.get(handleTarget, handleProperty, handleReceiver) as unknown;
              return typeof value === 'function' ? value.bind(handleTarget) : value;
            },
          });
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({
      rootDir,
      fs: trackingFs,
      createId: () => 'committed_v2',
      now: () => new Date((clock += 1_000)).toISOString(),
      logError: () => undefined,
      onProjectCommitted: (fact) => {
        events.push('observer');
        facts.push(fact);
      },
    });
    const project = await store.createProjectV2(inputV2);
    events.length = 0;

    const result = await store.applyMutationBatchV2(
      makeStudioMutationBatchV2(project, [
        {
          kind: 'add_beat',
          beatId: 'section_new',
          beat: { title: 'First title', story: '', targetSeconds: null },
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId: 'section_new',
          shotId: 'clip_new',
          shot: { shootingScript: '', durationSeconds: 4 },
          beforeShotId: null,
        },
        { kind: 'edit_beat', beatId: 'section_new', changes: { title: 'Final title' } },
      ]),
      makeMutationContextV2({ mutationId: 'mutation_committed', capturedAt: '2026-08-17T12:00:01.000Z' }),
      'opaque/task-3-tag'
    );

    expect(result.project).toMatchObject({ revision: project.revision + 1, brief: project.brief });
    expect(result.project.beats.section_new?.title).toBe('Final title');
    expect(result.createdBeatIds).toEqual(['section_new']);
    expect(result.createdShotIds).toEqual(['clip_new']);
    expect(facts).toEqual([
      {
        projectId: project.id,
        previousRevision: project.revision,
        committedRevision: project.revision + 1,
        committedAt: result.project.updatedAt,
        commitTag: 'opaque/task-3-tag',
      },
    ]);
    expect(facts.every(Object.isFrozen)).toBe(true);
    expect(events).toEqual(['project-rename', 'project-directory-sync', 'observer', 'index-rename']);
    expect(
      readJson<{ schemaVersion: number; projects: Array<{ beatCount: number; shotCount: number }> }>(
        path.join(rootDir, 'projects-v2.json')
      )
    ).toMatchObject({ schemaVersion: 2, projects: [{ beatCount: 1, shotCount: 1 }] });
    expect(protectedFs.accesses).toEqual([]);
  });

  it('keeps durable commits authoritative across malformed observer settlement shapes', async () => {
    const observerFailure = new Error('observer failed');
    const rejectedObserver = new Error('observer rejected');
    const hostileThenable = new Error('observer then getter failed');
    const behaviors = ['throw', 'reject', 'hostile_then', 'plain_object', 'null', 'function'] as const;
    let behaviorIndex = 0;
    let logAttempt = 0;
    const logError = vi.fn(() => {
      if (logAttempt === 0) {
        logAttempt += 1;
        throw new Error('diagnostic logger failed');
      }
      logAttempt += 1;
    });
    const { store } = createStoreV2({
      createId: () => 'observer_settlement_v2',
      now: () => timestamp,
      logError,
      onProjectCommitted: (() => {
        const behavior = behaviors[behaviorIndex++];
        if (behavior === 'throw') throw observerFailure;
        if (behavior === 'reject') return Promise.reject(rejectedObserver);
        if (behavior === 'hostile_then') {
          return new Proxy(
            {},
            {
              get: () => {
                throw hostileThenable;
              },
            }
          );
        }
        if (behavior === 'plain_object') return {};
        if (behavior === 'null') return null;
        return () => undefined;
      }) as StudioProjectCommitObserver,
    });

    let project = await store.createProjectV2(inputV2);
    for (let index = 0; index < behaviors.length; index += 1) {
      // Each successful update advances the observer to the next malformed result shape.
      // eslint-disable-next-line no-await-in-loop
      project = await store.updateProjectV2(
        project.id,
        (current) => ({ ...current, brief: `Observer settlement ${index}` }),
        project.revision
      );
    }

    await vi.waitFor(() => expect(logError).toHaveBeenCalledTimes(3));
    expect(logError.mock.calls).toEqual([
      ['[CreativeStudio] Project commit observer failed', observerFailure],
      ['[CreativeStudio] Project commit observer rejected', rejectedObserver],
      ['[CreativeStudio] Project commit observer rejected', hostileThenable],
    ]);
    expect(behaviorIndex).toBe(behaviors.length);
    await expect(store.getProjectV2(project.id)).resolves.toEqual({ status: 'supported', project });
  });

  it('uses default diagnostics without letting observer exceptions veto commits', async () => {
    const observerFailure = new Error('default observer failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const store = createCreativeStudioStore({
        rootDir: path.join(rootDir, 'default-observer-log'),
        createId: () => 'default_observer_log_v2',
        now: () => timestamp,
        onProjectCommitted: () => {
          throw observerFailure;
        },
      });
      const project = await store.createProjectV2(inputV2);

      const committed = await store.updateProjectV2(
        project.id,
        (current) => ({ ...current, brief: 'Commit survives default observer diagnostics' }),
        project.revision
      );

      expect(committed.revision).toBe(project.revision + 1);
      expect(consoleError).toHaveBeenCalledExactlyOnceWith(
        '[CreativeStudio] Project commit observer failed',
        observerFailure
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('returns a committed batch after one V2 index failure and retries only that V2 index', async () => {
    const projectId = 'repair_retry_v2';
    const facts: Parameters<StudioProjectCommitObserver>[0][] = [];
    const logError = vi.fn();
    const renameDestinations: string[] = [];
    const protectedFs = protectPrototypeIndex();
    let armed = false;
    let indexRenameAttempts = 0;
    let signalRetryStarted: () => void = () => undefined;
    const retryStarted = new Promise<void>((resolve) => {
      signalRetryStarted = resolve;
    });
    let releaseRetry: () => void = () => undefined;
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    const failingOnceFs = new Proxy(protectedFs.fs, {
      get(target, property, receiver) {
        if (property !== 'rename') return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof nodeFs.rename>): ReturnType<typeof nodeFs.rename> => {
          const destination = path.resolve(String(args[1]));
          if (armed) {
            renameDestinations.push(destination);
            if (destination.endsWith(`${path.sep}projects-v2.json`)) {
              indexRenameAttempts += 1;
              if (indexRenameAttempts === 1) throw new Error('schema-2 index rename failed once');
              signalRetryStarted();
              await retryGate;
            }
          }
          return protectedFs.fs.rename(...args);
        };
      },
    }) as typeof nodeFs;
    let clock = Date.parse(timestamp);
    const store = createCreativeStudioStore({
      rootDir,
      fs: failingOnceFs,
      createId: () => projectId,
      now: () => new Date((clock += 1_000)).toISOString(),
      logError,
      onProjectCommitted: (fact) => facts.push(fact),
    });
    const project = await store.createProjectV2(inputV2);
    armed = true;

    const resultPromise = store.applyMutationBatchV2(
      makeStudioMutationBatchV2(project, [
        {
          kind: 'add_beat',
          beatId: 'section_retry',
          beat: { title: 'Retry summary', story: '', targetSeconds: null },
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId: 'section_retry',
          shotId: 'clip_retry',
          shot: { shootingScript: '', durationSeconds: 4 },
          beforeShotId: null,
        },
      ]),
      makeMutationContextV2({ mutationId: 'mutation_retry', capturedAt: '2026-08-17T12:00:02.000Z' }),
      'opaque/retry-tag'
    );
    let settled = false;
    void resultPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await retryStarted;
    expect(settled).toBe(false);
    releaseRetry();
    const result = await resultPromise;

    expect(result.project).toMatchObject({ id: projectId, revision: project.revision + 1 });
    expect(facts).toEqual([
      {
        projectId,
        previousRevision: project.revision,
        committedRevision: result.project.revision,
        committedAt: result.project.updatedAt,
        commitTag: 'opaque/retry-tag',
      },
    ]);
    expect(facts.every(Object.isFrozen)).toBe(true);
    expect(
      readJson<{ projects: Array<{ beatCount: number; shotCount: number }> }>(path.join(rootDir, 'projects-v2.json'))
        .projects
    ).toEqual([expect.objectContaining({ beatCount: 1, shotCount: 1 })]);
    expect(renameDestinations.map((destination) => path.basename(destination))).toEqual([
      'project.json',
      'projects-v2.json',
      'projects-v2.json',
    ]);
    expect(indexRenameAttempts).toBe(2);
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      '[CreativeStudio] Schema-2 project summary repair failed after commit',
      expect.objectContaining({ message: 'schema-2 index rename failed once' })
    );
    expect(protectedFs.accesses).toEqual([]);
  });

  it('reports a busy V2 delete before stale revision when both conditions apply', async () => {
    const project = makePosterProjectV2('busy_delete_v2');
    const shot = project.shots.clip_video!;
    shot.videoAssetId = null;
    shot.supersededVideoAssetIds = [];
    shot.assetIds = ['asset_seed'];
    delete project.assets.asset_video;
    delete project.assets.asset_thumbnail;
    project.jobs.job_video = {
      ...project.jobs.job_video!,
      status: 'running',
      outputAssetIds: [],
      outputAssetIdsByRole: { primary: null, poster: null },
      spendReceipt: null,
    };
    seedProjectV2(project);
    const manifestFile = path.join(rootDir, project.id, 'project.json');
    const manifestBefore = readFileSync(manifestFile);
    const { store, prototypeIndexAccesses } = createStoreV2();

    await expect(store.deleteProjectV2(project.id, project.revision + 1)).rejects.toMatchObject({ code: 'busy' });

    expect(readFileSync(manifestFile)).toEqual(manifestBefore);
    expectPersistedProjectV2(project);
    expect(existsSync(path.join(rootDir, 'projects-v2.json'))).toBe(false);
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('rejects a symlinked V2 project directory before issuing any remove', async () => {
    const projectId = 'symlink_delete_v2';
    const project = createEmptyStudioProjectV2(inputV2, projectId, timestamp);
    const backingDirectory = path.join(rootDir, '.symlink-delete-backing');
    const manifestFile = path.join(backingDirectory, 'project.json');
    mkdirSync(backingDirectory);
    writeFileSync(manifestFile, JSON.stringify(project, null, 2));
    symlinkSync(backingDirectory, path.join(rootDir, projectId), 'dir');
    const manifestBefore = readFileSync(manifestFile);
    const protectedFs = protectPrototypeIndex();
    const rmCalls: string[] = [];
    const noDeleteFs = new Proxy(protectedFs.fs, {
      get(target, property, receiver) {
        if (property !== 'rm') return Reflect.get(target, property, receiver);
        return (...args: Parameters<typeof nodeFs.rm>): ReturnType<typeof nodeFs.rm> => {
          rmCalls.push(String(args[0]));
          return protectedFs.fs.rm(...args);
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({ rootDir, fs: noDeleteFs });

    await expect(store.deleteProjectV2(projectId, project.revision)).rejects.toMatchObject({ code: 'storage_error' });

    expect(rmCalls).toEqual([]);
    expect(existsSync(path.join(rootDir, projectId))).toBe(true);
    expect(readFileSync(manifestFile)).toEqual(manifestBefore);
    expect(protectedFs.accesses).toEqual([]);
  });

  it('preserves and restores a replacement project directory raced into V2 deletion', async () => {
    const { store: base } = createStoreV2({ createId: () => 'delete_replacement_v2', now: () => timestamp });
    const project = await base.createProjectV2(inputV2);
    const targetDirectory = realpathSync(path.join(rootDir, project.id));
    const originalProjectBytes = readFileSync(path.join(targetDirectory, 'project.json'));
    const originalBackup = path.join(rootDir, '.external-original-backup');
    const replacementBytes = Buffer.from('replacement project bytes');
    let replacementInstalled = false;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'rename' || typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          if (
            !replacementInstalled &&
            String(args[0]) === targetDirectory &&
            String(args[1]).endsWith(`/.delete-${project.id}`)
          ) {
            renameSync(targetDirectory, originalBackup);
            mkdirSync(targetDirectory);
            writeFileSync(path.join(targetDirectory, 'sentinel.bin'), replacementBytes);
            replacementInstalled = true;
          }
          return Reflect.apply(value, target, args);
        };
      },
    }) as typeof nodeFs;
    const racing = createCreativeStudioStore({ rootDir, fs: racingFs, logError: () => undefined });

    await expect(racing.deleteProjectV2(project.id, project.revision)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(replacementInstalled).toBe(true);
    expect(readFileSync(path.join(targetDirectory, 'sentinel.bin'))).toEqual(replacementBytes);
    expect(readFileSync(path.join(originalBackup, 'project.json'))).toEqual(originalProjectBytes);
    expect(existsSync(path.join(rootDir, `.delete-${project.id}`))).toBe(false);
  });

  it('resumes an identity-bound V2 deletion on the first queued read after quarantine cleanup fails', async () => {
    const { store: base } = createStoreV2({ createId: () => 'delete_resume_v2', now: () => timestamp });
    const project = await base.createProjectV2(inputV2);
    const quarantineDirectory = realpathSync(rootDir) + `/.delete-${project.id}`;
    const crashing = createCreativeStudioStore({
      rootDir,
      fs: failFileSystemOnceV2(
        (method, args) => method === 'rmdir' && path.basename(String(args[0])).startsWith('.delete-cleanup-')
      ),
      logError: () => undefined,
    });

    await expect(crashing.deleteProjectV2(project.id, project.revision)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(existsSync(path.join(rootDir, project.id))).toBe(false);
    expect(existsSync(quarantineDirectory)).toBe(false);
    const [cleanupDirectory] = readdirSync(realpathSync(rootDir)).filter((entry) =>
      entry.startsWith('.delete-cleanup-')
    );
    expect(cleanupDirectory).toBeDefined();
    expect(existsSync(path.join(realpathSync(rootDir), `.delete-${project.id}.json`))).toBe(true);

    const restarted = createStoreV2().store;
    await expect(restarted.getProjectV2(project.id)).resolves.toEqual({ status: 'not_found', projectId: project.id });
    expect(existsSync(quarantineDirectory)).toBe(false);
    expect(existsSync(path.join(realpathSync(rootDir), cleanupDirectory!))).toBe(false);
    expect(existsSync(path.join(realpathSync(rootDir), `.delete-${project.id}.json`))).toBe(false);
  });

  it('resumes an exact durable deletion marker through the sidecar-serialized deletion authority', async () => {
    const { store: base } = createStoreV2({ createId: () => 'delete_sidecar_retry_v2', now: () => timestamp });
    const project = await base.createProjectV2(inputV2);
    const projectDirectory = realpathSync(path.join(rootDir, project.id));
    const quarantineDirectory = realpathSync(rootDir) + `/.delete-${project.id}`;
    let refusedRename = false;
    const interruptedFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property !== 'rename') return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof nodeFs.rename>): Promise<void> => {
          if (!refusedRename && String(args[0]) === projectDirectory && String(args[1]) === quarantineDirectory) {
            refusedRename = true;
            throw Object.assign(new Error('injected pre-quarantine interruption'), { code: 'EIO' });
          }
          await nodeFs.rename(...args);
        };
      },
    }) as typeof nodeFs;
    const interrupted = createCreativeStudioStore({ rootDir, fs: interruptedFs, logError: () => undefined });

    await expect(interrupted.deleteProjectV2(project.id, project.revision)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(refusedRename).toBe(true);
    expect(existsSync(projectDirectory)).toBe(true);
    expect(existsSync(path.join(realpathSync(rootDir), `.delete-${project.id}.json`))).toBe(true);

    const restarted = createStoreV2().store;
    const sidecarAuthority = vi.fn(async (snapshot: StudioProjectDeletionAuthoritySnapshotV2) =>
      snapshot.delete(project.revision)
    );
    await expect(
      restarted.deleteProjectWithSidecarAuthorityV2(project.id, project.revision, sidecarAuthority)
    ).resolves.toBe(true);
    expect(sidecarAuthority).toHaveBeenCalledOnce();
    expect(existsSync(projectDirectory)).toBe(false);
    expect(existsSync(quarantineDirectory)).toBe(false);
    expect(existsSync(path.join(realpathSync(rootDir), `.delete-${project.id}.json`))).toBe(false);
  });

  it('does not grant deletion authority to a temporary-only marker and promotes it only on an explicit retry', async () => {
    const { store: base } = createStoreV2({ createId: () => 'delete_temp_only_v2', now: () => timestamp });
    const project = await base.createProjectV2(inputV2);
    const projectDirectory = realpathSync(path.join(rootDir, project.id));
    const projectBytes = readFileSync(path.join(projectDirectory, 'project.json'), 'utf8');
    const directory = lstatSync(projectDirectory);
    const temporaryMarker = path.join(realpathSync(rootDir), `.delete-${project.id}.json.publish`);
    writeFileSync(
      temporaryMarker,
      JSON.stringify(
        {
          schemaVersion: 1,
          projectId: project.id,
          expectedRevision: project.revision,
          directoryDev: directory.dev,
          directoryIno: directory.ino,
          projectSha256: createHash('sha256').update(projectBytes).digest('hex'),
        },
        null,
        2
      )
    );

    const restarted = createStoreV2().store;
    await expect(restarted.getProjectV2(project.id)).resolves.toEqual({ status: 'supported', project });
    expect(existsSync(temporaryMarker)).toBe(true);

    await expect(restarted.deleteProjectV2(project.id, project.revision)).resolves.toBe(true);
    expect(existsSync(projectDirectory)).toBe(false);
    expect(existsSync(temporaryMarker)).toBe(false);
    expect(existsSync(path.join(realpathSync(rootDir), `.delete-${project.id}.json`))).toBe(false);
  });

  it('removes only its exact partial deletion-marker temporary when a marker write fails', async () => {
    const { store: base } = createStoreV2({ createId: () => 'delete_partial_marker_v2', now: () => timestamp });
    const project = await base.createProjectV2(inputV2);
    const temporaryMarker = path.join(realpathSync(rootDir), `.delete-${project.id}.json.publish`);
    let injected = false;
    const failingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property !== 'open') return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const handle = await nodeFs.open(...args);
          if (String(args[0]) !== temporaryMarker) return handle;
          return new Proxy(handle, {
            get(handleTarget, handleProperty, handleReceiver) {
              if (handleProperty !== 'writeFile') return Reflect.get(handleTarget, handleProperty, handleReceiver);
              return async (...writeArgs: Parameters<typeof handle.writeFile>) => {
                if (!injected) {
                  injected = true;
                  await handle.writeFile('{', { encoding: 'utf8' });
                  throw Object.assign(new Error('injected deletion marker write failure'), { code: 'EIO' });
                }
                return handle.writeFile(...writeArgs);
              };
            },
          });
        };
      },
    }) as typeof nodeFs;
    const failing = createCreativeStudioStore({ rootDir, fs: failingFs, now: () => timestamp });

    await expect(failing.deleteProjectV2(project.id, project.revision)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(injected).toBe(true);
    expect(existsSync(temporaryMarker)).toBe(false);
    expect(existsSync(path.join(rootDir, `.delete-${project.id}.json`))).toBe(false);
    await expect(base.getProjectV2(project.id)).resolves.toEqual({ status: 'supported', project });
  });

  it('preserves an exact quarantine and a replacement live directory raced in before deletion cleanup', async () => {
    const { store: base } = createStoreV2({ createId: () => 'delete_late_replacement_v2', now: () => timestamp });
    const project = await base.createProjectV2(inputV2);
    const targetDirectory = realpathSync(path.join(rootDir, project.id));
    const quarantineDirectory = realpathSync(rootDir) + `/.delete-${project.id}`;
    const replacementBytes = Buffer.from('late replacement bytes');
    let quarantined = false;
    let replacementInstalled = false;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== 'function') return value;
        if (property === 'rename') {
          return async (...args: Parameters<typeof nodeFs.rename>) => {
            const result = await nodeFs.rename(...args);
            if (String(args[0]) === targetDirectory && String(args[1]) === quarantineDirectory) quarantined = true;
            return result;
          };
        }
        if (property === 'lstat') {
          return async (...args: Parameters<typeof nodeFs.lstat>) => {
            const result = await nodeFs.lstat(...args);
            if (quarantined && !replacementInstalled && String(args[0]) === quarantineDirectory) {
              mkdirSync(targetDirectory);
              writeFileSync(path.join(targetDirectory, 'sentinel.bin'), replacementBytes);
              replacementInstalled = true;
            }
            return result;
          };
        }
        return value.bind(target);
      },
    }) as typeof nodeFs;
    const racing = createCreativeStudioStore({ rootDir, fs: racingFs, now: () => timestamp });

    await expect(racing.deleteProjectV2(project.id, project.revision)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(replacementInstalled).toBe(true);
    expect(readFileSync(path.join(targetDirectory, 'sentinel.bin'))).toEqual(replacementBytes);
    expect(existsSync(path.join(quarantineDirectory, 'project.json'))).toBe(true);
    expect(existsSync(path.join(rootDir, `.delete-${project.id}.json`))).toBe(true);
  });

  it('never removes a foreign directory swapped in for the exact cleanup claim at its destructive boundary', async () => {
    const { store: base } = createStoreV2({ createId: () => 'delete_cleanup_claim_v2', now: () => timestamp });
    const project = await base.createProjectV2(inputV2);
    const canonicalRoot = realpathSync(rootDir);
    const quarantineDirectory = path.join(canonicalRoot, `.delete-${project.id}`);
    const displacedOwnedDirectory = path.join(canonicalRoot, '.displaced-owned-deletion-tree');
    const externalDirectory = path.join(canonicalRoot, '.external-deletion-replacement');
    const sentinelBytes = Buffer.from('foreign deletion sentinel');
    mkdirSync(externalDirectory);
    writeFileSync(path.join(externalDirectory, 'sentinel.bin'), sentinelBytes);
    let swapped = false;
    let cleanupDirectory: string | null = null;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property !== 'rmdir') return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof nodeFs.rmdir>): Promise<void> => {
          const candidate = String(args[0]);
          if (!swapped && path.basename(candidate).startsWith('.delete-cleanup-')) {
            cleanupDirectory = candidate;
            renameSync(candidate, displacedOwnedDirectory);
            renameSync(externalDirectory, candidate);
            swapped = true;
          }
          await nodeFs.rmdir(...args);
        };
      },
    }) as typeof nodeFs;
    const racing = createCreativeStudioStore({ rootDir, fs: racingFs, now: () => timestamp });

    await expect(racing.deleteProjectV2(project.id, project.revision)).rejects.toMatchObject({
      code: 'storage_error',
    });

    expect(swapped).toBe(true);
    expect(cleanupDirectory).not.toBeNull();
    expect(existsSync(quarantineDirectory)).toBe(false);
    expect(readFileSync(path.join(cleanupDirectory!, 'sentinel.bin'))).toEqual(sentinelBytes);
    expect(existsSync(displacedOwnedDirectory)).toBe(true);
    expect(existsSync(path.join(canonicalRoot, `.delete-${project.id}.json`))).toBe(true);
  });

  it('deletes only a supported schema-2 project and refuses the schema-1 identity without touching it', async () => {
    const prototype = await seedPrototypeProject();
    const prototypeManifest = readFileSync(path.join(rootDir, prototype.id, 'project.json'));
    const prototypeIndex = readFileSync(path.join(rootDir, 'projects.json'));
    const { store, prototypeIndexAccesses } = createStoreV2({ createId: () => 'deleted_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);

    await expect(store.deleteProjectV2(prototype.id, prototype.revision)).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await expect(store.deleteProjectV2(project.id, project.revision)).resolves.toBe(true);

    expect(existsSync(path.join(rootDir, project.id))).toBe(false);
    expect(readFileSync(path.join(rootDir, prototype.id, 'project.json'))).toEqual(prototypeManifest);
    expect(readFileSync(path.join(rootDir, 'projects.json'))).toEqual(prototypeIndex);
    expect(readJson(path.join(rootDir, 'projects-v2.json'))).toEqual({
      schemaVersion: 2,
      projects: [],
    });
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('keeps inspection read-only and refreshes its classified ID inventory after create and delete', async () => {
    const prototype = await seedPrototypeProject();
    const malformedId = 'inventory_broken_v2';
    mkdirSync(path.join(rootDir, malformedId));
    writeFileSync(
      path.join(rootDir, malformedId, 'project.json'),
      JSON.stringify({ schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION, id: malformedId })
    );
    const ids = ['inventory_a', 'inventory_b'];
    const { store, prototypeIndexAccesses } = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_id',
      now: () => timestamp,
    });
    const first = await store.createProjectV2(inputV2);
    rmSync(path.join(rootDir, 'projects-v2.json'));

    const firstInventory: StudioProjectInventoryV2 = {
      supportedProjectIds: [first.id],
      unsupportedProjectIds: [prototype.id],
      quarantinedProjectIds: [malformedId],
    };
    await expect(store.inspectProjectsV2()).resolves.toEqual(firstInventory);
    expect(existsSync(path.join(rootDir, 'projects-v2.json'))).toBe(false);

    const second = await store.createProjectV2(inputV2);
    await expect(store.inspectProjectsV2()).resolves.toEqual({
      ...firstInventory,
      supportedProjectIds: [first.id, second.id],
    });
    await store.deleteProjectV2(first.id, first.revision);
    await expect(store.inspectProjectsV2()).resolves.toEqual({
      ...firstInventory,
      supportedProjectIds: [second.id],
    });
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('confirms one frozen revalidation snapshot as one durable revision and returns an isolated frozen dispatch', async () => {
    const confirmedAt = '2026-08-17T12:00:01.000Z';
    const expiresAt = '2026-08-17T12:05:00.000Z';
    const facts: Parameters<StudioProjectCommitObserver>[0][] = [];
    let clock = timestamp;
    const { store } = createStoreV2({
      createId: () => 'confirmed_transaction_v2',
      now: () => clock,
      onProjectCommitted: (fact) => facts.push(fact),
    });
    const project = await store.createProjectV2(inputV2);
    clock = confirmedAt;
    const rawRevalidation = {
      providerBindings: [{ itemId: 'item_1', routeId: 'video_route' }],
    };
    const dispatchSource = {
      jobIds: ['job_1'],
      route: { id: 'video_route' },
    };
    let observedSnapshot: unknown;
    let observedRevalidation: unknown;
    let retainedBuilderProject: StudioProjectV2 | undefined;
    let snapshotMutationSucceeded = true;
    const assertActive = vi.fn();
    const input: StudioProjectConfirmationInputV2<typeof rawRevalidation, typeof dispatchSource> = {
      projectId: project.id,
      expectedRevision: project.revision,
      expiresAt,
      async revalidate(snapshot) {
        observedSnapshot = snapshot;
        snapshotMutationSucceeded = Reflect.set(snapshot, 'brief', 'must not mutate');
        return rawRevalidation;
      },
      assertActive,
      buildCommit(candidate, revalidation, receivedConfirmedAt) {
        retainedBuilderProject = candidate;
        observedRevalidation = revalidation;
        candidate.brief = `Confirmed at ${receivedConfirmedAt}`;
        return { project: candidate, dispatch: dispatchSource };
      },
      commitTag: 'submission/confirm-v2',
    };

    const result = await store.confirmProjectV2(input);

    expect(result.project).toMatchObject({
      revision: project.revision + 1,
      updatedAt: confirmedAt,
      brief: `Confirmed at ${confirmedAt}`,
    });
    expectPersistedProjectV2(result.project);
    expect(assertActive).toHaveBeenCalledTimes(2);
    expect(facts).toEqual([
      {
        projectId: project.id,
        previousRevision: project.revision,
        committedRevision: project.revision + 1,
        committedAt: confirmedAt,
        commitTag: 'submission/confirm-v2',
      },
    ]);
    expect(snapshotMutationSucceeded).toBe(false);
    expect(Object.isFrozen(observedSnapshot)).toBe(true);
    expect(Object.isFrozen((observedSnapshot as { beatOrder: unknown }).beatOrder)).toBe(true);
    expect(observedSnapshot).not.toBe(project);
    expect(Object.isFrozen(observedRevalidation)).toBe(true);
    expect(observedRevalidation).not.toBe(rawRevalidation);
    expect(retainedBuilderProject).not.toBe(project);
    expect(Object.isFrozen(retainedBuilderProject)).toBe(false);
    expect(Object.isFrozen(result.dispatch)).toBe(true);
    expect(Object.isFrozen(result.dispatch.route)).toBe(true);

    rawRevalidation.providerBindings[0]!.routeId = 'changed_after_confirm';
    dispatchSource.jobIds.push('job_2');
    dispatchSource.route.id = 'changed_after_confirm';
    retainedBuilderProject!.brief = 'changed after confirm';

    expect(observedRevalidation).toEqual({
      providerBindings: [{ itemId: 'item_1', routeId: 'video_route' }],
    });
    expect(result.dispatch).toEqual({ jobIds: ['job_1'], route: { id: 'video_route' } });
    expect(() => {
      (result.dispatch as { route: { id: string } }).route.id = 'forbidden';
    }).toThrow(TypeError);
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { brief: `Confirmed at ${confirmedAt}` },
    });
  });

  it('refuses stale confirmation authority before callbacks and preserves every durable byte', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({
      createId: () => 'stale_confirmation_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);
    const revalidate = vi.fn(async () => ({ routeId: 'video_route' }));
    const assertActive = vi.fn();
    const buildCommit = vi.fn((candidate: StudioProjectV2) => ({
      project: candidate,
      dispatch: { jobIds: ['job_1'] },
    }));

    await expect(
      store.confirmProjectV2({
        projectId: project.id,
        expectedRevision: project.revision + 1,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate,
        assertActive,
        buildCommit,
      })
    ).rejects.toMatchObject({ code: 'stale_project' });

    expect(revalidate).not.toHaveBeenCalled();
    expect(assertActive).not.toHaveBeenCalled();
    expect(buildCommit).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
    expect(onProjectCommitted).not.toHaveBeenCalled();
  });

  it('refuses confirmation at exact expiry after revalidation without invoking the commit builder', async () => {
    const expiry = '2026-08-17T12:05:00.000Z';
    let clock = timestamp;
    const { store } = createStoreV2({ createId: () => 'expired_confirmation_v2', now: () => clock });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);
    const revalidate = vi.fn(async () => ({ routeId: 'video_route' }));
    const buildCommit = vi.fn((candidate: StudioProjectV2) => ({ project: candidate, dispatch: null }));
    clock = expiry;

    const confirmation = store.confirmProjectV2({
      projectId: project.id,
      expectedRevision: project.revision,
      expiresAt: expiry,
      revalidate,
      assertActive: () => undefined,
      buildCommit,
    });

    await expect(confirmation).rejects.toBeInstanceOf(StudioProjectConfirmationError);
    expect(revalidate).toHaveBeenCalledOnce();
    expect(buildCommit).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
  });

  it('rechecks expiry after delayed async revalidation and changes no bytes when the clock crosses it', async () => {
    const expiry = '2026-08-17T12:05:00.000Z';
    let clock = timestamp;
    const started = createDeferredV2<void>();
    const release = createDeferredV2<void>();
    const { store } = createStoreV2({ createId: () => 'delayed_expiry_v2', now: () => clock });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);
    const buildCommit = vi.fn((candidate: StudioProjectV2) => ({ project: candidate, dispatch: null }));
    const confirmation = store.confirmProjectV2({
      projectId: project.id,
      expectedRevision: project.revision,
      expiresAt: expiry,
      async revalidate() {
        started.resolve(undefined);
        await release.promise;
        return { routeId: 'video_route' };
      },
      assertActive: () => undefined,
      buildCommit,
    });

    await started.promise;
    clock = expiry;
    release.resolve(undefined);

    await expect(confirmation).rejects.toMatchObject({ code: 'expired_confirmation' });
    expect(buildCommit).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
  });

  it('preserves async revalidation and synchronous builder throws without writing', async () => {
    const revalidationError = new Error('route resolver failed');
    const builderError = new Error('authorization construction failed');
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({
      createId: () => 'confirmation_callback_error_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);
    const buildAfterFailedRevalidation = vi.fn((candidate: StudioProjectV2) => ({
      project: candidate,
      dispatch: null,
    }));

    await expect(
      store.confirmProjectV2({
        projectId: project.id,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => {
          throw revalidationError;
        },
        assertActive: () => undefined,
        buildCommit: buildAfterFailedRevalidation,
      })
    ).rejects.toBe(revalidationError);
    await expect(
      store.confirmProjectV2({
        projectId: project.id,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => ({ routeId: 'video_route' }),
        assertActive: () => undefined,
        buildCommit: () => {
          throw builderError;
        },
      })
    ).rejects.toBe(builderError);

    expect(buildAfterFailedRevalidation).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
    expect(onProjectCommitted).not.toHaveBeenCalled();
  });

  it('rejects thenable guard and commit-builder results before persistence', async () => {
    const { store } = createStoreV2({ createId: () => 'confirmation_thenable_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);
    const buildCommit = vi.fn((candidate: StudioProjectV2) => ({ project: candidate, dispatch: null }));
    const thenableGuard = (() => Promise.resolve()) as unknown as () => void;
    const thenableBuilder = (async (candidate: StudioProjectV2) => ({
      project: candidate,
      dispatch: null,
    })) as unknown as StudioProjectConfirmationInputV2<null, null>['buildCommit'];

    await expect(
      store.confirmProjectV2({
        projectId: project.id,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => null,
        assertActive: thenableGuard,
        buildCommit,
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(
      store.confirmProjectV2({
        projectId: project.id,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => null,
        assertActive: () => undefined,
        buildCommit: thenableBuilder,
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(buildCommit).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
  });

  it('rechecks the live session after building and refuses a close immediately before persistence', async () => {
    const closeError = new Error('prepared submission cache closed');
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({
      createId: () => 'confirmation_close_fence_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);
    let activeChecks = 0;
    const buildCommit = vi.fn((candidate: StudioProjectV2) => ({
      project: { ...candidate, brief: 'must not persist' },
      dispatch: { jobIds: ['job_1'] },
    }));

    await expect(
      store.confirmProjectV2({
        projectId: project.id,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => ({ routeId: 'video_route' }),
        assertActive() {
          activeChecks += 1;
          if (activeChecks === 2) throw closeError;
        },
        buildCommit,
      })
    ).rejects.toBe(closeError);

    expect(activeChecks).toBe(2);
    expect(buildCommit).toHaveBeenCalledOnce();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
    expect(onProjectCommitted).not.toHaveBeenCalled();
  });

  it('rejects an invalid built project and preserves project and summary bytes', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({
      createId: () => 'confirmation_invalid_project_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);

    await expect(
      store.confirmProjectV2({
        projectId: project.id,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => ({ routeId: 'video_route' }),
        assertActive: () => undefined,
        buildCommit: (candidate) => ({
          project: { ...candidate, beatOrder: ['missing_beat'] },
          dispatch: { jobIds: ['job_1'] },
        }),
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
    expect(onProjectCommitted).not.toHaveBeenCalled();
  });

  it('serializes an edit queued before confirmation so stale confirmation never revalidates', async () => {
    const { store } = createStoreV2({ createId: () => 'edit_before_confirmation_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const revalidate = vi.fn(async () => ({ routeId: 'video_route' }));
    const edit = store.updateProjectV2(
      project.id,
      (candidate) => ({ ...candidate, name: 'Edited before confirmation' }),
      project.revision
    );
    const confirmation = store.confirmProjectV2({
      projectId: project.id,
      expectedRevision: project.revision,
      expiresAt: '2026-08-17T12:05:00.000Z',
      revalidate,
      assertActive: () => undefined,
      buildCommit: (candidate) => ({ project: candidate, dispatch: null }),
    });

    const edited = await edit;

    await expect(confirmation).rejects.toMatchObject({ code: 'stale_project' });
    expect(edited).toMatchObject({ revision: project.revision + 1, name: 'Edited before confirmation' });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it('holds an edit queued after confirmation until the confirmed revision is durable', async () => {
    const started = createDeferredV2<void>();
    const release = createDeferredV2<void>();
    let clock = timestamp;
    const { store } = createStoreV2({ createId: () => 'edit_after_confirmation_v2', now: () => clock });
    const project = await store.createProjectV2(inputV2);
    clock = '2026-08-17T12:00:01.000Z';
    const confirmation = store.confirmProjectV2({
      projectId: project.id,
      expectedRevision: project.revision,
      expiresAt: '2026-08-17T12:05:00.000Z',
      async revalidate() {
        started.resolve(undefined);
        await release.promise;
        return { routeId: 'video_route' };
      },
      assertActive: () => undefined,
      buildCommit: (candidate) => ({
        project: { ...candidate, brief: 'Confirmed before the later edit' },
        dispatch: { jobIds: ['job_1'] },
      }),
    });
    await started.promise;
    clock = '2026-08-17T12:00:02.000Z';
    const edit = store.updateProjectV2(project.id, (candidate) => ({
      ...candidate,
      name: 'Edited after confirmation',
    }));
    release.resolve(undefined);

    const confirmed = await confirmation;
    const edited = await edit;

    expect(confirmed.project).toMatchObject({
      revision: project.revision + 1,
      brief: 'Confirmed before the later edit',
    });
    expect(edited).toMatchObject({
      revision: project.revision + 2,
      name: 'Edited after confirmation',
      brief: 'Confirmed before the later edit',
    });
    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({ status: 'supported', project: edited });
  });

  it('never returns dispatch or observes a commit when the atomic project write fails', async () => {
    const projectId = 'confirmation_write_failure_v2';
    const protectedFs = protectPrototypeIndex();
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    let failProjectRename = false;
    const failingFs = new Proxy(protectedFs.fs, {
      get(target, property, receiver) {
        if (property !== 'rename') return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof nodeFs.rename>): ReturnType<typeof nodeFs.rename> => {
          const destination = path.resolve(String(args[1]));
          if (failProjectRename && destination === path.join(realpathSync(rootDir), projectId, 'project.json')) {
            throw new Error('confirmation project rename failed');
          }
          return protectedFs.fs.rename(...args);
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({
      rootDir,
      fs: failingFs,
      createId: () => projectId,
      now: () => timestamp,
      logError: () => undefined,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const projectBefore = readFileSync(projectFile);
    failProjectRename = true;

    await expect(
      store.confirmProjectV2({
        projectId: project.id,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => ({ routeId: 'video_route' }),
        assertActive: () => undefined,
        buildCommit: (candidate) => ({
          project: { ...candidate, brief: 'must not survive failed durability' },
          dispatch: { jobIds: ['job_1'] },
        }),
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(onProjectCommitted).not.toHaveBeenCalled();
    expect(protectedFs.accesses).toEqual([]);
  });

  it('updates one supported schema-2 project with one revision, observer fact, and V2 summary repair', async () => {
    const prototype = await seedPrototypeProject();
    const prototypeManifestFile = path.join(rootDir, prototype.id, 'project.json');
    const prototypeIndexFile = path.join(rootDir, 'projects.json');
    const prototypeManifestBefore = readFileSync(prototypeManifestFile);
    const prototypeIndexBefore = readFileSync(prototypeIndexFile);
    const facts: Parameters<StudioProjectCommitObserver>[0][] = [];
    let clock = Date.parse(timestamp);
    const { store, prototypeIndexAccesses } = createStoreV2({
      createId: () => 'updated_v2',
      now: () => new Date((clock += 1_000)).toISOString(),
      onProjectCommitted: (fact) => facts.push(fact),
    });
    const project = await store.createProjectV2(inputV2);

    const updated = await store.updateProjectV2(
      project.id,
      (candidate) => ({ ...candidate, name: 'Retitled schema-2 film', brief: 'Updated atomically' }),
      project.revision,
      'media/attach-v2'
    );

    expect(updated).toMatchObject({
      id: project.id,
      name: 'Retitled schema-2 film',
      brief: 'Updated atomically',
      revision: project.revision + 1,
      createdAt: project.createdAt,
    });
    expect(updated.updatedAt).not.toBe(project.updatedAt);
    expect(project).toMatchObject({ name: inputV2.name, brief: inputV2.brief, revision: 1 });
    expectPersistedProjectV2(updated);
    expect(readJson(path.join(rootDir, 'projects-v2.json'))).toEqual({
      schemaVersion: 2,
      projects: [
        {
          id: project.id,
          name: updated.name,
          aspectRatio: updated.aspectRatio,
          targetDurationSeconds: updated.targetDurationSeconds,
          resolution: updated.resolution,
          beatCount: 0,
          shotCount: 0,
          pictureCount: 0,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        },
      ],
    });
    expect(facts).toEqual([
      {
        projectId: project.id,
        previousRevision: project.revision,
        committedRevision: updated.revision,
        committedAt: updated.updatedAt,
        commitTag: 'media/attach-v2',
      },
    ]);
    expect(facts.every(Object.isFrozen)).toBe(true);
    expect(readFileSync(prototypeManifestFile)).toEqual(prototypeManifestBefore);
    expect(readFileSync(prototypeIndexFile)).toEqual(prototypeIndexBefore);
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('treats an external Brief edit as authoritative, advances the revision, and rejects a stale save', async () => {
    const facts: Parameters<StudioProjectCommitObserver>[0][] = [];
    const { store } = createStoreV2({
      createId: () => 'external_brief_v2',
      now: vi.fn().mockReturnValueOnce(timestamp).mockReturnValue('2026-08-17T12:00:01.000Z'),
      onProjectCommitted: (fact) => facts.push(fact),
    });
    const project = await store.createProjectV2(inputV2);
    const briefFile = path.join(rootDir, project.id, 'brief.md');
    writeFileSync(briefFile, 'Edited outside WePrompt');

    const loaded = await store.getProjectV2(project.id);

    expect(loaded).toEqual({
      status: 'supported',
      project: expect.objectContaining({
        id: project.id,
        brief: 'Edited outside WePrompt',
        revision: project.revision + 1,
      }),
    });
    const synchronized = loaded.status === 'supported' ? loaded.project : project;
    expectPersistedProjectV2(synchronized);
    expect(facts).toEqual([
      {
        projectId: project.id,
        previousRevision: project.revision,
        committedRevision: project.revision + 1,
        committedAt: '2026-08-17T12:00:01.000Z',
        commitTag: 'brief:file-sync',
      },
    ]);
    await expect(
      store.applyMutationBatchV2(
        makeStudioMutationBatchV2(project, [{ kind: 'set_brief', brief: 'Stale editor save' }]),
        makeMutationContextV2({ mutationId: 'stale_external_brief' })
      )
    ).rejects.toMatchObject({ code: 'stale_project' });
    expect(readFileSync(briefFile, 'utf8')).toBe('Edited outside WePrompt');
  });

  it('recovers a committed manifest after interruption before Brief publication', async () => {
    const projectId = 'brief_transaction_recovery_v2';
    const briefFile = path.join(realpathSync(rootDir), projectId, 'brief.md');
    let armed = false;
    let interrupted = false;
    const interruptingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'rename' || typeof value !== 'function') return value;
        return async (...args: Parameters<typeof nodeFs.rename>) => {
          if (armed && !interrupted && String(args[1]) === briefFile) {
            interrupted = true;
            throw new Error('simulated process interruption before Brief publication');
          }
          return Reflect.apply(value, target, args) as Promise<void>;
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({
      rootDir,
      fs: interruptingFs,
      createId: () => projectId,
      now: () => timestamp,
      logError: () => undefined,
    });
    const project = await store.createProjectV2(inputV2);
    armed = true;

    await expect(
      store.updateProjectV2(
        project.id,
        (candidate) => ({ ...candidate, name: 'Recovered title', brief: 'Recovered Brief' }),
        project.revision
      )
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(interrupted).toBe(true);
    expect(existsSync(path.join(rootDir, project.id, '.brief-transaction.json'))).toBe(true);

    const restarted = createStoreV2().store;
    const recovered = await restarted.getProjectV2(project.id);
    expect(recovered).toEqual({
      status: 'supported',
      project: expect.objectContaining({
        name: 'Recovered title',
        brief: 'Recovered Brief',
        revision: project.revision + 1,
      }),
    });
    expect(existsSync(path.join(rootDir, project.id, '.brief-transaction.json'))).toBe(false);
    if (recovered.status === 'supported') expectPersistedProjectV2(recovered.project);
  });

  it('preserves a concurrent external Brief edit after manifest publication', async () => {
    const projectId = 'brief_external_race_v2';
    const briefFile = path.join(realpathSync(rootDir), projectId, 'brief.md');
    let armed = false;
    let replaced = false;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'open' || typeof value !== 'function') return value;
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const opened = String(args[0]);
          if (armed && !replaced && opened.startsWith(`${briefFile}.`) && opened.endsWith('.tmp')) {
            const replacement = `${briefFile}.external`;
            writeFileSync(replacement, 'External editor wins');
            renameSync(replacement, briefFile);
            replaced = true;
          }
          return Reflect.apply(value, target, args) as ReturnType<typeof nodeFs.open>;
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({
      rootDir,
      fs: racingFs,
      createId: () => projectId,
      now: vi
        .fn()
        .mockReturnValueOnce(timestamp)
        .mockReturnValueOnce('2026-08-17T12:00:01.000Z')
        .mockReturnValue('2026-08-17T12:00:02.000Z'),
      logError: () => undefined,
    });
    const project = await store.createProjectV2(inputV2);
    armed = true;

    await expect(
      store.updateProjectV2(
        project.id,
        (candidate) => ({ ...candidate, name: 'Candidate title', brief: 'Candidate Brief' }),
        project.revision
      )
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(replaced).toBe(true);

    const recovered = await createStoreV2({ now: () => '2026-08-17T12:00:02.000Z' }).store.getProjectV2(project.id);
    expect(recovered).toEqual({
      status: 'supported',
      project: expect.objectContaining({
        name: 'Candidate title',
        brief: 'External editor wins',
        revision: project.revision + 2,
      }),
    });
    if (recovered.status === 'supported') expectPersistedProjectV2(recovered.project);
  });

  it.each(['symlink', 'oversize', 'invalid_utf8'] as const)(
    'fails closed for an unsafe %s Brief file',
    async (kind) => {
      const projectId = `unsafe_brief_${kind}_v2`;
      const { store } = createStoreV2({ createId: () => projectId, now: () => timestamp });
      const project = await store.createProjectV2(inputV2);
      const briefFile = path.join(rootDir, project.id, 'brief.md');
      if (kind === 'symlink') {
        const outside = path.join(rootDir, 'outside-brief.md');
        writeFileSync(outside, 'outside authority');
        rmSync(briefFile);
        symlinkSync(outside, briefFile);
      } else if (kind === 'oversize') {
        writeFileSync(briefFile, 'x'.repeat(64 * 1024 + 1));
      } else {
        writeFileSync(briefFile, Buffer.from([0xff]));
      }

      await expect(store.getProjectV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    }
  );

  it('rejects stale schema-2 update authority before invoking the callback or writing', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const update = vi.fn(
      (candidate: StudioProjectV2): StudioProjectV2 => ({
        ...candidate,
        brief: 'must never run',
      })
    );
    const { store, prototypeIndexAccesses } = createStoreV2({
      createId: () => 'stale_update_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);

    await expect(store.updateProjectV2(project.id, update, project.revision + 1)).rejects.toMatchObject({
      code: 'stale_project',
    });

    expect(update).not.toHaveBeenCalled();
    expect(onProjectCommitted).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('rolls back an invalid schema-2 update callback result without observing it', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store, prototypeIndexAccesses } = createStoreV2({
      createId: () => 'invalid_update_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);

    await expect(
      store.updateProjectV2(project.id, (candidate) => ({ ...candidate, beatOrder: ['missing_section'] }))
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(onProjectCommitted).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('rejects an inherited array serialization hook before writing schema-2 project bytes', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({
      createId: () => 'serialization_hook_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);
    let toJsonCalls = 0;

    await expect(
      store.updateProjectV2(project.id, (candidate) => {
        Object.setPrototypeOf(candidate.beatOrder, {
          toJSON() {
            toJsonCalls += 1;
            return ['missing_section'];
          },
        });
        return candidate;
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(toJsonCalls).toBe(0);
    expect(onProjectCommitted).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
  });

  it('rejects an own hidden serialization hook before writing schema-2 project bytes', async () => {
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store } = createStoreV2({
      createId: () => 'hidden_serialization_hook_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);
    let toJsonCalls = 0;

    await expect(
      store.updateProjectV2(project.id, (candidate) => {
        Object.defineProperty(candidate.frameExtractions, 'toJSON', {
          configurable: true,
          enumerable: false,
          value() {
            toJsonCalls += 1;
            return {};
          },
        });
        return candidate;
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(toJsonCalls).toBe(0);
    expect(onProjectCommitted).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
  });

  it('preserves a schema-2 update callback error and leaves durable state unchanged', async () => {
    const callbackError = new Error('attachment staging failed');
    const onProjectCommitted = vi.fn<StudioProjectCommitObserver>();
    const { store, prototypeIndexAccesses } = createStoreV2({
      createId: () => 'callback_error_v2',
      now: () => timestamp,
      onProjectCommitted,
    });
    const project = await store.createProjectV2(inputV2);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const indexFile = path.join(rootDir, 'projects-v2.json');
    const projectBefore = readFileSync(projectFile);
    const indexBefore = readFileSync(indexFile);

    await expect(
      store.updateProjectV2(project.id, () => {
        throw callbackError;
      })
    ).rejects.toBe(callbackError);

    expect(onProjectCommitted).not.toHaveBeenCalled();
    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readFileSync(indexFile)).toEqual(indexBefore);
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('classifies unsupported, malformed, and missing projects before a schema-2 update callback', async () => {
    const prototype = await seedPrototypeProject();
    const prototypeManifestFile = path.join(rootDir, prototype.id, 'project.json');
    const prototypeIndexFile = path.join(rootDir, 'projects.json');
    const prototypeManifestBefore = readFileSync(prototypeManifestFile);
    const prototypeIndexBefore = readFileSync(prototypeIndexFile);
    const malformedId = 'update_malformed_v2';
    mkdirSync(path.join(rootDir, malformedId));
    writeFileSync(
      path.join(rootDir, malformedId, 'project.json'),
      JSON.stringify({ schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION, id: malformedId })
    );
    const update = vi.fn((project: StudioProjectV2): StudioProjectV2 => project);
    const { store, prototypeIndexAccesses } = createStoreV2();

    await expect(store.updateProjectV2(prototype.id, update)).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await expect(store.updateProjectV2(malformedId, update)).rejects.toMatchObject({ code: 'storage_error' });
    await expect(store.updateProjectV2('missing_update_v2', update)).rejects.toMatchObject({ code: 'not_found' });

    expect(update).not.toHaveBeenCalled();
    expect(readFileSync(prototypeManifestFile)).toEqual(prototypeManifestBefore);
    expect(readFileSync(prototypeIndexFile)).toEqual(prototypeIndexBefore);
    expect(existsSync(path.join(rootDir, 'projects-v2.json'))).toBe(false);
    expect(prototypeIndexAccesses).toEqual([]);
  });

  it('lists, accepts, and restart-retries one mutation proposal without reapplying it', async () => {
    const { store } = createStoreV2({
      createId: () => 'proposal_project_v2',
      now: () => '2026-08-17T12:00:01.000Z',
    });
    const project = await store.createProjectV2(inputV2);
    const { proposal, directories } = await seedProposalV2(store, project);

    await expect(store.listProposalsV2(project.id)).resolves.toEqual([proposal]);
    const accepted = await store.acceptProposalV2(project.id, proposal.id);

    expect(accepted).toMatchObject({ applied: true, proposal: { id: proposal.id, status: 'accepted' } });
    expect(accepted.project).toMatchObject({ revision: project.revision + 1, brief: 'Accepted brief' });
    expect(accepted.project.undoHistory.at(-1)).toMatchObject({
      id: proposal.id,
      sourceRevision: project.revision + 1,
      label: 'set_brief',
    });
    expect(readdirSync(directories.commits)).toEqual([]);
    expect(readdirSync(directories.slots)).toEqual([]);
    expect(readJson<{ status: string }>(path.join(directories.decisions, `${proposal.id}.json`)).status).toBe(
      'accepted'
    );

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:02.000Z' }).store;
    const retry = await restarted.acceptProposalV2(project.id, proposal.id);
    expect(retry.applied).toBe(false);
    expect(retry.project.revision).toBe(project.revision + 1);
    expect(retry.project.undoHistory.filter((entry) => entry.id === proposal.id)).toHaveLength(1);
  });

  it('rejects a current-schema forbidden hard-cut proposal without publishing project or decision bytes', async () => {
    const { store } = createStoreV2({
      createId: () => 'legacy_hard_cut_proposal_project',
      now: () => '2026-08-17T12:00:01.000Z',
    });
    const created = await store.createProjectV2(inputV2);
    const authored = await store.applyMutationBatchV2(
      makeStudioMutationBatchV2(created, [
        {
          kind: 'add_beat',
          beatId: 'beat_1',
          beat: { title: 'Opening', story: '', targetSeconds: null },
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId: 'beat_1',
          shotId: 'shot_1',
          shot: { shootingScript: '', durationSeconds: 5 },
          beforeShotId: null,
        },
        {
          kind: 'add_shot',
          beatId: 'beat_1',
          shotId: 'shot_2',
          shot: { shootingScript: '', durationSeconds: 5 },
          beforeShotId: null,
        },
      ]),
      makeMutationContextV2({ mutationId: 'author_legacy_hard_cut_proposal' })
    );
    const seeded = await seedProposalV2(store, authored.project, {
      proposalId: 'legacy_hard_cut_proposal',
      payload: {
        kind: 'mutation_batch',
        operations: [{ kind: 'set_hard_cut', shotId: 'shot_2', hardCut: true }],
      },
    });
    const projectDir = realpathSync(path.join(rootDir, authored.project.id));
    const before = snapshotTreeV2(projectDir);

    await expect(store.acceptProposalV2(authored.project.id, seeded.proposal.id)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(snapshotTreeV2(projectDir)).toEqual(before);
  });

  it('accepts pin_rule by applying one deterministic set_rules reducer operation', async () => {
    const ids = ['pin_project_v2', 'pinned_rule_v2'];
    const { store } = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_id',
      now: () => '2026-08-17T12:00:01.000Z',
    });
    const project = await store.createProjectV2(inputV2);
    const { proposal } = await seedProposalV2(store, project, {
      proposalId: 'proposal_pin_v2',
      payload: { kind: 'pin_rule', rule: { text: 'Never show a logo', predicate: null } },
    });

    const accepted = await store.acceptProposalV2(project.id, proposal.id);

    expect(accepted.project.rules).toEqual([
      {
        id: 'rule_0821519e257f7e0b149ed7c0',
        scope: 'project',
        text: 'Never show a logo',
        predicate: null,
        createdAt: timestamp,
      },
    ]);
    expect(accepted.project.undoHistory.at(-1)).toMatchObject({ id: proposal.id, label: 'set_rules' });
  });

  it('returns an empty V2 proposal list without creating a proposal directory family', async () => {
    const { store } = createStoreV2({ createId: () => 'empty_proposals_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const projectDir = realpathSync(path.join(rootDir, project.id));
    const before = snapshotTreeV2(projectDir);

    await expect(store.listProposalsV2(project.id)).resolves.toEqual([]);

    expect(snapshotTreeV2(projectDir)).toEqual(before);
    expect(existsSync(path.join(projectDir, 'proposals'))).toBe(false);
  });

  it.each([
    {
      stage: 'attribution link',
      exactBefore: true,
      fail: (method: string, args: readonly unknown[], projectDir: string) =>
        method === 'link' && String(args[1]) === path.join(projectDir, 'proposals', 'commits', 'proposal_crash.json'),
    },
    {
      stage: 'project rename',
      exactBefore: true,
      fail: (method: string, args: readonly unknown[], projectDir: string) =>
        method === 'rename' && String(args[1]) === path.join(projectDir, 'project.json'),
    },
    {
      stage: 'decision link',
      exactBefore: false,
      fail: (method: string, args: readonly unknown[], projectDir: string) =>
        method === 'link' && String(args[1]) === path.join(projectDir, 'proposals', 'decisions', 'proposal_crash.json'),
    },
    {
      stage: 'attribution companion cleanup',
      exactBefore: false,
      fail: (method: string, args: readonly unknown[], projectDir: string) =>
        method === 'rm' &&
        String(args[0]) === path.join(projectDir, 'proposals', 'commits', 'proposal_crash.json.publish'),
    },
    {
      stage: 'attribution quarantine',
      exactBefore: false,
      fail: (method: string, args: readonly unknown[], projectDir: string) =>
        method === 'rename' && String(args[0]) === path.join(projectDir, 'proposals', 'commits', 'proposal_crash.json'),
    },
    {
      stage: 'attribution quarantine cleanup',
      exactBefore: false,
      fail: (method: string, args: readonly unknown[], projectDir: string) =>
        method === 'rm' &&
        String(args[0]).startsWith(path.join(projectDir, 'proposals', 'commits', 'proposal_crash.json.')) &&
        String(args[0]).endsWith('.cleanup'),
    },
    {
      stage: 'slot quarantine',
      exactBefore: false,
      fail: (method: string, args: readonly unknown[], projectDir: string) =>
        method === 'rename' && String(args[0]) === path.join(projectDir, 'proposals', 'slots', '0.slot'),
    },
    {
      stage: 'slot quarantine cleanup',
      exactBefore: false,
      fail: (method: string, args: readonly unknown[], projectDir: string) =>
        method === 'rm' &&
        String(args[0]).startsWith(path.join(projectDir, 'proposals', 'slots', '0.slot.')) &&
        String(args[0]).endsWith('.cleanup'),
    },
  ])('repairs a restart after an injected $stage crash without reducer replay', async ({ exactBefore, fail }) => {
    const base = createStoreV2({
      createId: () => 'crash_project_v2',
      now: () => '2026-08-17T12:00:00.000Z',
    }).store;
    const project = await base.createProjectV2(inputV2);
    const { proposal, directories } = await seedProposalV2(base, project, { proposalId: 'proposal_crash' });
    const projectDir = realpathSync(path.join(rootDir, project.id));
    const crashing = createCreativeStudioStore({
      rootDir,
      fs: failFileSystemOnceV2((method, args) => fail(method, args, projectDir)),
      now: () => '2026-08-17T12:00:01.000Z',
      logError: () => undefined,
    });

    await expect(crashing.acceptProposalV2(project.id, proposal.id)).rejects.toMatchObject({ code: 'storage_error' });

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:02.000Z' }).store;
    const loaded = await restarted.getProjectV2(project.id);
    expect(loaded.status).toBe('supported');
    if (loaded.status !== 'supported') throw new Error('expected supported project');
    expect(loaded.project.revision).toBe(exactBefore ? project.revision : project.revision + 1);
    const repaired = await restarted.listProposalsV2(project.id);
    expect(repaired).toHaveLength(1);
    expect(repaired[0].status).toBe(exactBefore ? 'pending' : 'accepted');
    expect(readdirSync(directories.commits)).toEqual([]);

    const retry = await restarted.acceptProposalV2(project.id, proposal.id);
    expect(retry.applied).toBe(exactBefore);
    expect(retry.project.revision).toBe(project.revision + 1);
    expect(retry.project.undoHistory.filter((entry) => entry.id === proposal.id)).toHaveLength(1);
    expect(readdirSync(directories.slots)).toEqual([]);
  });

  it('rechecks exact project temp bytes after async proposal authority before rename', async () => {
    const base = createStoreV2({ createId: () => 'project_temp_race_v2', now: () => timestamp }).store;
    const project = await base.createProjectV2(inputV2);
    const seeded = await seedProposalV2(base, project, { proposalId: 'proposal_project_temp_race' });
    const projectDir = path.join(rootDir, project.id);
    const projectFile = path.join(projectDir, 'project.json');
    const projectBefore = readFileSync(projectFile);
    let replacedTemporary = false;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'readdir' || typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          if (!replacedTemporary && String(args[0]).endsWith('/proposals/commits')) {
            const temporary = readdirSync(projectDir).find(
              (name) => name.startsWith('project.json.') && name.endsWith('.tmp')
            );
            if (temporary !== undefined) {
              replacedTemporary = true;
              writeFileSync(path.join(projectDir, temporary), '{"third":"state"}');
            }
          }
          return Reflect.apply(value, target, args);
        };
      },
    }) as typeof nodeFs;
    const racing = createCreativeStudioStore({
      rootDir,
      fs: racingFs,
      now: () => '2026-08-17T12:00:01.000Z',
      logError: () => undefined,
    });

    await expect(racing.acceptProposalV2(project.id, seeded.proposal.id)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(replacedTemporary).toBe(true);
    expect(readFileSync(projectFile)).toEqual(projectBefore);

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:02.000Z' }).store;
    await expect(restarted.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { revision: project.revision },
    });
    expect(readdirSync(seeded.directories.commits)).toEqual([]);
  });

  it('rechecks the project CAS after temp verification and preserves a newer project before proposal rename', async () => {
    const base = createStoreV2({ createId: () => 'project_cas_race_v2', now: () => timestamp }).store;
    const project = await base.createProjectV2(inputV2);
    const seeded = await seedProposalV2(base, project, { proposalId: 'proposal_project_cas_race' });
    const projectDir = realpathSync(path.join(rootDir, project.id));
    const projectFile = path.join(projectDir, 'project.json');
    const externalProject = {
      ...(JSON.parse(readFileSync(projectFile, 'utf8')) as StudioProjectV2),
      name: 'External winner',
      revision: project.revision + 1,
      updatedAt: '2026-08-17T12:00:00.500Z',
    };
    const externalBytes = `${JSON.stringify(externalProject, null, 2)}\n`;
    let replacedProject = false;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'realpath' || typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          const projectTemporaryExists = readdirSync(projectDir).some(
            (name) => name.startsWith('project.json.') && name.endsWith('.tmp')
          );
          if (!replacedProject && String(args[0]) === projectDir && projectTemporaryExists) {
            const replacement = `${projectFile}.external`;
            writeFileSync(replacement, externalBytes);
            renameSync(replacement, projectFile);
            replacedProject = true;
          }
          return Reflect.apply(value, target, args);
        };
      },
    }) as typeof nodeFs;
    const racing = createCreativeStudioStore({
      rootDir,
      fs: racingFs,
      now: () => '2026-08-17T12:00:01.000Z',
      logError: () => undefined,
    });

    await expect(racing.acceptProposalV2(project.id, seeded.proposal.id)).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(replacedProject).toBe(true);
    expect(readFileSync(projectFile, 'utf8')).toBe(externalBytes);
  });

  it('fails every fenced project operation on attribution mismatch and preserves the byte tree', async () => {
    const { store } = createStoreV2({
      createId: () => 'mismatch_project_v2',
      now: () => '2026-08-17T12:00:01.000Z',
    });
    const project = await store.createProjectV2(inputV2);
    const { proposal, directories } = await seedProposalV2(store, project, { proposalId: 'proposal_mismatch' });
    const projectBytes = readFileSync(path.join(rootDir, project.id, 'project.json'), 'utf8');
    const attribution: StudioProposalCommitAttributionV2 = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
      proposalId: proposal.id,
      projectId: project.id,
      baseRevision: project.revision,
      appliedRevision: project.revision + 1,
      beforeProjectSha256: createHash('sha256').update(projectBytes).digest('hex'),
      afterProjectSha256: 'b'.repeat(64),
      createdBeatIds: ['forged_beat'],
      createdShotIds: [],
      decidedAt: '2026-08-17T12:00:01.000Z',
    };
    writeFileSync(path.join(directories.commits, `${proposal.id}.json`), JSON.stringify(attribution, null, 2));
    const before = snapshotTreeV2(rootDir);
    const update = vi.fn((current: StudioProjectV2) => current);

    await expect(store.getProjectV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    await expect(store.updateProjectV2(project.id, update, project.revision)).rejects.toMatchObject({
      code: 'storage_error',
    });
    await expect(store.deleteProjectV2(project.id, project.revision)).rejects.toMatchObject({ code: 'storage_error' });
    expect(update).not.toHaveBeenCalled();
    expect(snapshotTreeV2(rootDir)).toEqual(before);
  });

  it('fails an exact-before attribution whose decision predates its immutable proposal', async () => {
    const { store } = createStoreV2({ createId: () => 'attribution_clock_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const seeded = await seedProposalV2(store, project, { proposalId: 'proposal_attribution_clock' });
    const projectBytes = readFileSync(path.join(rootDir, project.id, 'project.json'), 'utf8');
    const attribution: StudioProposalCommitAttributionV2 = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
      proposalId: seeded.proposal.id,
      projectId: project.id,
      baseRevision: project.revision,
      appliedRevision: project.revision + 1,
      beforeProjectSha256: createHash('sha256').update(projectBytes).digest('hex'),
      afterProjectSha256: 'c'.repeat(64),
      createdBeatIds: [],
      createdShotIds: [],
      decidedAt: '2026-08-17T11:59:59.000Z',
    };
    const attributionFile = path.join(seeded.directories.commits, `${seeded.proposal.id}.json`);
    writeFileSync(attributionFile, JSON.stringify(attribution));
    linkSync(attributionFile, `${attributionFile}.publish`);
    const before = snapshotTreeV2(path.join(rootDir, project.id));

    await expect(store.getProjectV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });

    expect(snapshotTreeV2(path.join(rootDir, project.id))).toEqual(before);
  });

  it('rejects, expires, reaps, and deduplicates watched V2 proposal status changes', async () => {
    let notifyChange: ((relativeFile: string) => void) | undefined;
    const listener = vi.fn();
    const { store } = createStoreV2({
      createId: () => 'lifecycle_project_v2',
      now: () => '2026-08-17T12:00:01.000Z',
      watchProposalTree: ({ onChange }) => {
        notifyChange = onChange;
        return { close: vi.fn() };
      },
    });
    const project = await store.createProjectV2(inputV2);
    const first = await seedProposalV2(store, project, { proposalId: 'proposal_reject' });
    const stop = await store.watchProposalsV2(listener);
    notifyChange?.(`${project.id}/proposals/pending/${first.proposal.id}.json`);
    notifyChange?.(`${project.id}/proposals/pending/${first.proposal.id}.json`);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    const projectBefore = readFileSync(path.join(rootDir, project.id, 'project.json'));
    await expect(store.rejectProposalV2(project.id, first.proposal.id)).resolves.toMatchObject({ status: 'rejected' });
    notifyChange?.(`${project.id}/proposals/decisions/${first.proposal.id}.json`);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
    expect(readFileSync(path.join(rootDir, project.id, 'project.json'))).toEqual(projectBefore);
    await stop();

    const expiredProposal: StudioProposalRecordV2 = {
      ...first.proposal,
      id: 'proposal_expire',
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    writeFileSync(path.join(first.directories.pending, `${expiredProposal.id}.json`), JSON.stringify(expiredProposal));
    writeFileSync(
      path.join(first.directories.slots, '1.slot'),
      JSON.stringify({
        schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
        proposalId: expiredProposal.id,
        reservedAt: expiredProposal.createdAt,
      })
    );
    await store.reapAbandonedProposalsV2();
    await expect(store.listProposalsV2(project.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.proposal.id, status: 'rejected' }),
        expect.objectContaining({ id: expiredProposal.id, status: 'expired' }),
      ])
    );
    expect(readdirSync(first.directories.slots)).toEqual([]);
  });

  it('arms the V2 proposal watcher before the first supported project is created', async () => {
    let notifyChange: ((relativeFile: string) => void) | undefined;
    const listener = vi.fn();
    const { store } = createStoreV2({
      createId: () => 'watch_before_project_v2',
      now: () => timestamp,
      watchProposalTree: ({ onChange }) => {
        notifyChange = onChange;
        return { close: vi.fn() };
      },
    });
    const stop = await store.watchProposalsV2(listener);
    const project = await store.createProjectV2(inputV2);
    const seeded = await seedProposalV2(store, project, { proposalId: 'proposal_after_watch' });

    notifyChange?.(`${project.id}/proposals/pending/${seeded.proposal.id}.json`);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(project.id, seeded.proposal.id));
    await stop();
  });

  it('synchronizes and announces a valid external Brief edit through the watcher', async () => {
    let notifyChange: ((relativeFile: string) => void) | undefined;
    const listener = vi.fn();
    const { store } = createStoreV2({
      createId: () => 'brief_watch_v2',
      now: vi.fn().mockReturnValueOnce(timestamp).mockReturnValue('2026-08-17T12:00:01.000Z'),
      watchProposalTree: ({ onChange }) => {
        notifyChange = onChange;
        return { close: vi.fn() };
      },
    });
    const project = await store.createProjectV2(inputV2);
    const stop = await store.watchBriefsV2(listener);
    writeFileSync(path.join(rootDir, project.id, 'brief.md'), 'Watched external Brief');

    notifyChange?.(`${project.id}/brief.md`);

    await vi.waitFor(() => expect(listener).toHaveBeenCalledExactlyOnceWith(project.id, project.revision + 1));
    await expect(store.getProjectV2(project.id)).resolves.toEqual({
      status: 'supported',
      project: expect.objectContaining({ brief: 'Watched external Brief', revision: project.revision + 1 }),
    });
    await stop();
  });

  it('creates only a complete V2 proposal directory generation and refuses a pre-existing partial family', async () => {
    const { store } = createStoreV2({
      createId: vi.fn().mockReturnValueOnce('complete_paths_v2').mockReturnValueOnce('partial_paths_v2'),
      now: () => timestamp,
    });
    const complete = await store.createProjectV2(inputV2);
    const completePaths = await store.resolveProposalPathsV2(complete.id);
    expect(readdirSync(path.join(completePaths.projectDir, 'proposals')).toSorted()).toEqual([
      'commits',
      'decisions',
      'pending',
      'slots',
    ]);

    const partial = await store.createProjectV2(inputV2);
    const partialRoot = path.join(rootDir, partial.id, 'proposals');
    mkdirSync(path.join(partialRoot, 'pending'), { recursive: true });
    mkdirSync(path.join(partialRoot, 'decisions'));
    mkdirSync(path.join(partialRoot, 'slots'));
    await expect(store.resolveProposalPathsV2(partial.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(readdirSync(partialRoot).toSorted()).toEqual(['decisions', 'pending', 'slots']);
  });

  it.each([
    ['proposal', 'proposals', ['pending', 'decisions', 'slots', 'commits']] as const,
    ['reference', 'reference-requests', ['pending', 'decisions', 'slots', 'receipts']] as const,
  ])('does not publish a staged %s family after the project becomes schema-1', async (kind, family, children) => {
    const projectId = `family_schema_race_${kind}_v2`;
    const base = createStoreV2({ createId: () => projectId, now: () => timestamp }).store;
    await base.createProjectV2(inputV2);
    const projectDirectory = realpathSync(path.join(rootDir, projectId));
    const projectFile = path.join(projectDirectory, 'project.json');
    const replacementBytes = `${JSON.stringify({ schemaVersion: 1, id: projectId, sentinel: kind }, null, 2)}\n`;
    let replaced = false;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'lstat' || typeof value !== 'function') return value;
        return async (...args: Parameters<typeof nodeFs.lstat>) => {
          if (!replaced && String(args[0]) === projectFile) {
            const stageName = readdirSync(projectDirectory).find(
              (name) => name.startsWith(`.${family}.`) && name.endsWith('.tmp')
            );
            const stage = stageName === undefined ? null : path.join(projectDirectory, stageName);
            if (stage !== null && children.every((child) => existsSync(path.join(stage, child)))) {
              const replacement = `${projectFile}.external`;
              writeFileSync(replacement, replacementBytes);
              renameSync(replacement, projectFile);
              replaced = true;
            }
          }
          return nodeFs.lstat(...args);
        };
      },
    }) as typeof nodeFs;
    const racing = createCreativeStudioStore({ rootDir, fs: racingFs, logError: () => undefined });

    const attempt =
      kind === 'proposal' ? racing.resolveProposalPathsV2(projectId) : racing.resolveReferenceRequestPathsV2(projectId);
    await expect(attempt).rejects.toMatchObject({ code: 'storage_error' });
    expect(replaced).toBe(true);
    expect(readFileSync(projectFile, 'utf8')).toBe(replacementBytes);
    expect(existsSync(path.join(projectDirectory, family))).toBe(false);
    expect(readdirSync(projectDirectory).filter((name) => name.startsWith(`.${family}.`))).toEqual([]);
  });

  it('lists, generates, dismisses, and restart-retries one reference handoff without changing project bytes', async () => {
    const ids = ['reference_lifecycle_v2', 'handoff_lifecycle_v2'];
    const { store } = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_reference_id',
      now: () => '2026-08-17T12:00:02.000Z',
    });
    const created = await store.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(store, created);
    const { request, directories } = await seedReferenceRequestV2(store, project);
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const projectBefore = readFileSync(projectFile);

    await expect(store.listReferenceRequestsV2(project.id)).resolves.toEqual([
      { request, decision: null, receipt: null },
    ]);
    const decided = await store.decideReferenceRequestV2({
      projectId: project.id,
      requestId: request.id,
      expectedRevision: project.revision,
      outcome: { kind: 'generation_gate' },
    });
    expect(decided).toMatchObject({
      request: { id: request.id },
      decision: {
        outcome: {
          kind: 'generation_gate',
          handoffId: 'handoff_lifecycle_v2',
          referenceIds: request.referenceIds,
        },
      },
      receipt: null,
    });
    expect(readdirSync(directories.slots)).toEqual(['0.slot']);
    const retryDecision = await store.decideReferenceRequestV2({
      projectId: project.id,
      requestId: request.id,
      expectedRevision: 1,
      outcome: { kind: 'generation_gate' },
    });
    expect(retryDecision.decision).toEqual(decided.decision);

    await expect(store.readReferenceGenerationHandoffV2(project.id, 'handoff_lifecycle_v2')).resolves.toEqual(decided);
    const dismissed = await store.recordReferenceGenerationHandoffReceiptV2({
      projectId: project.id,
      handoffId: 'handoff_lifecycle_v2',
      expectedRevision: project.revision,
      result: { kind: 'dismissed' },
    });
    expect(dismissed.receipt).toEqual({
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
      handoffId: 'handoff_lifecycle_v2',
      requestId: request.id,
      completedAt: '2026-08-17T12:00:02.000Z',
      result: { kind: 'dismissed' },
    });
    expect(readdirSync(directories.slots)).toEqual([]);
    await expect(
      store.recordReferenceGenerationHandoffReceiptV2({
        projectId: project.id,
        handoffId: 'handoff_lifecycle_v2',
        expectedRevision: 1,
        result: { kind: 'dismissed' },
      })
    ).resolves.toEqual(dismissed);
    expect(readFileSync(projectFile)).toEqual(projectBefore);

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:04.000Z' }).store;
    await expect(restarted.readReferenceGenerationHandoffV2(project.id, 'handoff_lifecycle_v2')).resolves.toEqual(
      dismissed
    );
  });

  it('confirms one open reference handoff by committing authorization and receipt under one project queue', async () => {
    const ids = ['reference_confirm_v2', 'handoff_confirm_v2'];
    const { store } = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_reference_id',
      now: () => '2026-08-17T12:00:03.000Z',
    });
    const project = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const generated = await seedGenerationHandoffV2(store, project, { requestId: 'request_confirm_v2' });

    const confirmed = await store.confirmReferenceGenerationHandoffV2({
      projectId: project.id,
      handoffId: generated.handoffId,
      expectedRevision: project.revision,
      expiresAt: '2026-08-17T12:05:00.000Z',
      revalidate: async () => ({ routeId: 'image_route' }),
      assertActive: () => undefined,
      buildCommit: (candidate) => ({
        project: addReferenceAuthorizationV2(candidate, generated.handoffId),
        dispatch: { projectId: project.id, jobIds: [`job_${generated.handoffId}`] },
      }),
      commitTag: `confirm_submission:authorization_${generated.handoffId}`,
    });

    expect(confirmed.project).toMatchObject({
      revision: project.revision + 1,
      spendAuthorizations: [
        expect.objectContaining({
          id: `authorization_${generated.handoffId}`,
          originReferenceHandoffId: generated.handoffId,
        }),
      ],
    });
    expect(confirmed.dispatch).toEqual({
      projectId: project.id,
      jobIds: [`job_${generated.handoffId}`],
    });
    await expect(store.readReferenceGenerationHandoffV2(project.id, generated.handoffId)).resolves.toMatchObject({
      receipt: {
        completedAt: '2026-08-17T12:00:03.000Z',
        result: { kind: 'confirmed', authorizationId: `authorization_${generated.handoffId}` },
      },
    });
    expect(readdirSync(generated.directories.slots)).toEqual([]);
    const revalidateCompleted = vi.fn(async () => ({ routeId: 'image_route' }));
    await expect(
      store.confirmReferenceGenerationHandoffV2({
        projectId: project.id,
        handoffId: generated.handoffId,
        expectedRevision: confirmed.project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: revalidateCompleted,
        assertActive: () => undefined,
        buildCommit: (candidate) => ({ project: candidate, dispatch: { jobIds: [] } }),
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(revalidateCompleted).not.toHaveBeenCalled();
  });

  it('refuses a handoff confirmation whose project commit omits the exact origin authorization', async () => {
    const ids = ['reference_confirm_refusal_v2', 'handoff_confirm_refusal_v2'];
    const { store } = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_reference_id',
      now: () => '2026-08-17T12:00:03.000Z',
    });
    const project = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const generated = await seedGenerationHandoffV2(store, project, { requestId: 'request_confirm_refusal_v2' });
    const before = snapshotTreeV2(path.join(rootDir, project.id));

    await expect(
      store.confirmReferenceGenerationHandoffV2({
        projectId: project.id,
        handoffId: generated.handoffId,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => ({ routeId: 'image_route' }),
        assertActive: () => undefined,
        buildCommit: (candidate) => ({ project: candidate, dispatch: { jobIds: [] } }),
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(snapshotTreeV2(path.join(rootDir, project.id))).toEqual(before);
    const missingRevalidation = vi.fn(async () => ({ routeId: 'image_route' }));
    await expect(
      store.confirmReferenceGenerationHandoffV2({
        projectId: project.id,
        handoffId: 'missing_handoff',
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: missingRevalidation,
        assertActive: () => undefined,
        buildCommit: (candidate) => ({ project: candidate, dispatch: { jobIds: [] } }),
      })
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(missingRevalidation).not.toHaveBeenCalled();

    await expect(
      store.confirmReferenceGenerationHandoffV2({
        projectId: project.id,
        handoffId: generated.handoffId,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => ({ routeId: 'image_route' }),
        assertActive: () => undefined,
        buildCommit: (candidate) => {
          const duplicated = addReferenceAuthorizationV2(candidate, generated.handoffId);
          duplicated.spendAuthorizations.push({
            ...structuredClone(duplicated.spendAuthorizations[0]!),
            id: 'duplicate_origin_authorization',
          });
          return { project: duplicated, dispatch: { jobIds: [] } };
        },
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(snapshotTreeV2(path.join(rootDir, project.id))).toEqual(before);
  });

  it('refuses a handoff decision inode replaced during revalidation without changing durable bytes', async () => {
    const ids = ['reference_confirm_replaced_v2', 'handoff_confirm_replaced_v2'];
    const { store } = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_reference_id',
      now: () => '2026-08-17T12:00:03.000Z',
    });
    const project = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const generated = await seedGenerationHandoffV2(store, project, { requestId: 'request_confirm_replaced_v2' });
    const projectFile = path.join(rootDir, project.id, 'project.json');
    const projectBefore = readFileSync(projectFile);
    const decisionFile = path.join(generated.directories.decisions, `${generated.request.id}.json`);

    await expect(
      store.confirmReferenceGenerationHandoffV2({
        projectId: project.id,
        handoffId: generated.handoffId,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => {
          const replacement = `${decisionFile}.external`;
          writeFileSync(replacement, readFileSync(decisionFile));
          renameSync(replacement, decisionFile);
          return { routeId: 'image_route' };
        },
        assertActive: () => undefined,
        buildCommit: (candidate) => ({
          project: addReferenceAuthorizationV2(candidate, generated.handoffId),
          dispatch: { jobIds: [] },
        }),
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    expect(readFileSync(projectFile)).toEqual(projectBefore);
    expect(readdirSync(generated.directories.receipts)).toEqual([]);
  });

  it('rechecks the active confirmation session after the final handoff authority proof', async () => {
    const ids = ['reference_confirm_cancelled_v2', 'handoff_confirm_cancelled_v2'];
    const base = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_reference_id',
      now: () => '2026-08-17T12:00:03.000Z',
    }).store;
    const project = await addActiveReferenceShotsV2(base, await base.createProjectV2(inputV2));
    const generated = await seedGenerationHandoffV2(base, project, { requestId: 'request_confirm_cancelled_v2' });
    const projectDirectory = realpathSync(path.join(rootDir, project.id));
    const projectFile = path.join(projectDirectory, 'project.json');
    const before = snapshotTreeV2(path.join(rootDir, project.id));
    const closeError = new Error('prepared handoff confirmation closed');
    let activeChecks = 0;
    let projectLstatsWhileTemporary = 0;
    let closed = false;
    const closingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'lstat' || typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          if (
            String(args[0]) === projectFile &&
            readdirSync(projectDirectory).some((name) => name.startsWith('project.json.') && name.endsWith('.tmp'))
          ) {
            projectLstatsWhileTemporary += 1;
            if (projectLstatsWhileTemporary === 3) closed = true;
          }
          return Reflect.apply(value, target, args);
        };
      },
    }) as typeof nodeFs;
    const store = createCreativeStudioStore({
      rootDir,
      fs: closingFs,
      now: () => '2026-08-17T12:00:03.000Z',
      logError: () => undefined,
    });

    await expect(
      store.confirmReferenceGenerationHandoffV2({
        projectId: project.id,
        handoffId: generated.handoffId,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => ({ routeId: 'image_route' }),
        assertActive: () => {
          activeChecks += 1;
          if (closed) throw closeError;
        },
        buildCommit: (candidate) => ({
          project: addReferenceAuthorizationV2(candidate, generated.handoffId),
          dispatch: { jobIds: [] },
        }),
      })
    ).rejects.toMatchObject({ code: 'storage_error', message: closeError.message });

    expect(activeChecks).toBe(5);
    expect(closed).toBe(true);
    expect(snapshotTreeV2(path.join(rootDir, project.id))).toEqual(before);
  });

  it('serializes confirm and dismiss so exactly one terminal handoff outcome wins', async () => {
    const ids = [
      'reference_confirm_wins_v2',
      'handoff_confirm_wins_v2',
      'reference_dismiss_wins_v2',
      'handoff_dismiss_wins_v2',
    ];
    const { store } = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_reference_id',
      now: () => '2026-08-17T12:00:03.000Z',
    });
    const confirmProject = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const confirmHandoff = await seedGenerationHandoffV2(store, confirmProject, {
      requestId: 'request_confirm_wins_v2',
    });
    let releaseRevalidation!: () => void;
    const revalidationGate = new Promise<void>((resolve) => {
      releaseRevalidation = resolve;
    });
    let markRevalidationStarted!: () => void;
    const revalidationStarted = new Promise<void>((resolve) => {
      markRevalidationStarted = resolve;
    });
    const confirming = store.confirmReferenceGenerationHandoffV2({
      projectId: confirmProject.id,
      handoffId: confirmHandoff.handoffId,
      expectedRevision: confirmProject.revision,
      expiresAt: '2026-08-17T12:05:00.000Z',
      revalidate: async () => {
        markRevalidationStarted();
        await revalidationGate;
        return { routeId: 'image_route' };
      },
      assertActive: () => undefined,
      buildCommit: (candidate) => ({
        project: addReferenceAuthorizationV2(candidate, confirmHandoff.handoffId),
        dispatch: { jobIds: [`job_${confirmHandoff.handoffId}`] },
      }),
    });
    await revalidationStarted;
    const losingDismiss = store.recordReferenceGenerationHandoffReceiptV2({
      projectId: confirmProject.id,
      handoffId: confirmHandoff.handoffId,
      expectedRevision: confirmProject.revision,
      result: { kind: 'dismissed' },
    });
    releaseRevalidation();
    const [confirmOutcome, losingDismissOutcome] = await Promise.allSettled([confirming, losingDismiss]);
    expect(confirmOutcome).toMatchObject({
      status: 'fulfilled',
      value: { project: { revision: confirmProject.revision + 1 } },
    });
    expect(losingDismissOutcome).toMatchObject({ status: 'rejected', reason: { code: 'invalid_payload' } });

    const dismissProject = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const dismissHandoff = await seedGenerationHandoffV2(store, dismissProject, {
      requestId: 'request_dismiss_wins_v2',
    });
    const projectBefore = readFileSync(path.join(rootDir, dismissProject.id, 'project.json'));
    const revalidate = vi.fn(async () => ({ routeId: 'image_route' }));
    const winningDismiss = store.recordReferenceGenerationHandoffReceiptV2({
      projectId: dismissProject.id,
      handoffId: dismissHandoff.handoffId,
      expectedRevision: dismissProject.revision,
      result: { kind: 'dismissed' },
    });
    const losingConfirm = store.confirmReferenceGenerationHandoffV2({
      projectId: dismissProject.id,
      handoffId: dismissHandoff.handoffId,
      expectedRevision: dismissProject.revision,
      expiresAt: '2026-08-17T12:05:00.000Z',
      revalidate,
      assertActive: () => undefined,
      buildCommit: (candidate) => ({
        project: addReferenceAuthorizationV2(candidate, dismissHandoff.handoffId),
        dispatch: { jobIds: [] },
      }),
    });
    const [winningDismissOutcome, losingConfirmOutcome] = await Promise.allSettled([winningDismiss, losingConfirm]);
    expect(winningDismissOutcome).toMatchObject({
      status: 'fulfilled',
      value: { receipt: { result: { kind: 'dismissed' } } },
    });
    expect(losingConfirmOutcome).toMatchObject({ status: 'rejected', reason: { code: 'invalid_payload' } });
    expect(revalidate).not.toHaveBeenCalled();
    expect(readFileSync(path.join(rootDir, dismissProject.id, 'project.json'))).toEqual(projectBefore);
  });

  it('repairs a confirmed receipt after publication is interrupted following the project commit', async () => {
    const ids = ['reference_confirm_crash_v2', 'handoff_confirm_crash_v2'];
    const base = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_reference_id',
      now: () => '2026-08-17T12:00:03.000Z',
    }).store;
    const project = await addActiveReferenceShotsV2(base, await base.createProjectV2(inputV2));
    const generated = await seedGenerationHandoffV2(base, project, { requestId: 'request_confirm_crash_v2' });
    const receiptFile = path.join(realpathSync(generated.directories.receipts), `${generated.handoffId}.json`);
    const crashing = createCreativeStudioStore({
      rootDir,
      fs: failFileSystemOnceV2((method, args) => method === 'link' && String(args[1]) === receiptFile),
      now: () => '2026-08-17T12:00:03.000Z',
      logError: () => undefined,
    });

    await expect(
      crashing.confirmReferenceGenerationHandoffV2({
        projectId: project.id,
        handoffId: generated.handoffId,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => ({ routeId: 'image_route' }),
        assertActive: () => undefined,
        buildCommit: (candidate) => ({
          project: addReferenceAuthorizationV2(candidate, generated.handoffId),
          dispatch: { jobIds: [`job_${generated.handoffId}`] },
        }),
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(readJson<StudioProjectV2>(path.join(rootDir, project.id, 'project.json'))).toMatchObject({
      revision: project.revision + 1,
      spendAuthorizations: [expect.objectContaining({ originReferenceHandoffId: generated.handoffId })],
    });

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:04.000Z' }).store;
    await expect(restarted.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { revision: project.revision + 1 },
    });
    await expect(restarted.readReferenceGenerationHandoffV2(project.id, generated.handoffId)).resolves.toMatchObject({
      receipt: {
        completedAt: '2026-08-17T12:00:03.000Z',
        result: { kind: 'confirmed', authorizationId: `authorization_${generated.handoffId}` },
      },
    });
    expect(readdirSync(generated.directories.slots)).toEqual([]);
  });

  it('terminally rechecks project CAS after delayed handoff sidecar proofs', async () => {
    const ids = ['reference_confirm_project_race_v2', 'handoff_confirm_project_race_v2'];
    const base = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_reference_id',
      now: () => '2026-08-17T12:00:03.000Z',
    }).store;
    const project = await addActiveReferenceShotsV2(base, await base.createProjectV2(inputV2));
    const generated = await seedGenerationHandoffV2(base, project, { requestId: 'request_confirm_project_race_v2' });
    const projectDirectory = realpathSync(path.join(rootDir, project.id));
    const projectFile = path.join(projectDirectory, 'project.json');
    const decisionFile = path.join(realpathSync(generated.directories.decisions), `${generated.request.id}.json`);
    const replacement = { ...readJson<StudioProjectV2>(projectFile), name: 'External project winner' };
    const replacementBytes = `${JSON.stringify(replacement, null, 2)}\n`;
    let replaced = false;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'lstat' || typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          if (
            !replaced &&
            String(args[0]) === decisionFile &&
            readdirSync(projectDirectory).some((name) => name.startsWith('project.json.') && name.endsWith('.tmp'))
          ) {
            const external = `${projectFile}.external`;
            writeFileSync(external, replacementBytes);
            renameSync(external, projectFile);
            replaced = true;
          }
          return Reflect.apply(value, target, args);
        };
      },
    }) as typeof nodeFs;
    const racing = createCreativeStudioStore({
      rootDir,
      fs: racingFs,
      now: () => '2026-08-17T12:00:03.000Z',
      logError: () => undefined,
    });

    await expect(
      racing.confirmReferenceGenerationHandoffV2({
        projectId: project.id,
        handoffId: generated.handoffId,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => ({ routeId: 'image_route' }),
        assertActive: () => undefined,
        buildCommit: (candidate) => ({
          project: addReferenceAuthorizationV2(candidate, generated.handoffId),
          dispatch: { jobIds: [] },
        }),
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    expect(replaced).toBe(true);
    expect(readFileSync(projectFile, 'utf8')).toBe(replacementBytes);
    expect(readJson<StudioProjectV2>(projectFile).spendAuthorizations).toEqual([]);
    expect(readdirSync(generated.directories.receipts)).toEqual([]);
  });

  it('refuses authorization when an external dismissal wins after the first write proof', async () => {
    const ids = ['reference_confirm_receipt_race_v2', 'handoff_confirm_receipt_race_v2'];
    const base = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_reference_id',
      now: () => '2026-08-17T12:00:03.000Z',
    }).store;
    const project = await addActiveReferenceShotsV2(base, await base.createProjectV2(inputV2));
    const generated = await seedGenerationHandoffV2(base, project, { requestId: 'request_confirm_receipt_race_v2' });
    const projectFile = path.join(realpathSync(path.join(rootDir, project.id)), 'project.json');
    const before = readFileSync(projectFile);
    const receiptFile = path.join(realpathSync(generated.directories.receipts), `${generated.handoffId}.json`);
    let temporaryProofs = 0;
    let dismissed = false;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'lstat' || typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          const file = String(args[0]);
          if (file.startsWith(`${projectFile}.`) && file.endsWith('.tmp')) {
            temporaryProofs += 1;
            if (temporaryProofs === 2) {
              writeFileSync(
                receiptFile,
                JSON.stringify({
                  schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
                  handoffId: generated.handoffId,
                  requestId: generated.request.id,
                  completedAt: '2026-08-17T12:00:03.000Z',
                  result: { kind: 'dismissed' },
                })
              );
              dismissed = true;
            }
          }
          return Reflect.apply(value, target, args);
        };
      },
    }) as typeof nodeFs;
    const racing = createCreativeStudioStore({
      rootDir,
      fs: racingFs,
      now: () => '2026-08-17T12:00:03.000Z',
      logError: () => undefined,
    });

    await expect(
      racing.confirmReferenceGenerationHandoffV2({
        projectId: project.id,
        handoffId: generated.handoffId,
        expectedRevision: project.revision,
        expiresAt: '2026-08-17T12:05:00.000Z',
        revalidate: async () => ({ routeId: 'image_route' }),
        assertActive: () => undefined,
        buildCommit: (candidate) => ({
          project: addReferenceAuthorizationV2(candidate, generated.handoffId),
          dispatch: { jobIds: [] },
        }),
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    expect(dismissed).toBe(true);
    expect(readFileSync(projectFile)).toEqual(before);
    expect(readJson<StudioReferenceGenerationHandoffReceiptV2>(receiptFile).result).toEqual({ kind: 'dismissed' });
  });

  it('rejects hidden and symbol extras on reference decision and receipt inputs before touching the ledger', async () => {
    const ids = ['exact_input_project', 'exact_input_handoff'];
    const { store } = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp });
    const project = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const seeded = await seedReferenceRequestV2(store, project, { requestId: 'exact_input_request' });
    const decisionInput = {
      projectId: project.id,
      requestId: seeded.request.id,
      expectedRevision: project.revision,
      outcome: { kind: 'generation_gate' as const },
    };
    Object.defineProperty(decisionInput.outcome, 'hidden', { value: true, enumerable: false });
    const before = snapshotTreeV2(seeded.directories.root);
    await expect(store.decideReferenceRequestV2(decisionInput)).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(snapshotTreeV2(seeded.directories.root)).toEqual(before);

    const generated = await seedGenerationHandoffV2(store, project, {
      requestId: 'exact_receipt_request',
      slotIndex: 1,
    });
    const receiptInput = {
      projectId: project.id,
      handoffId: generated.handoffId,
      expectedRevision: project.revision,
      result: { kind: 'dismissed' as const },
    };
    Object.defineProperty(receiptInput, Symbol('extra'), { value: true, enumerable: false });
    const receiptBefore = snapshotTreeV2(generated.directories.root);
    await expect(store.recordReferenceGenerationHandoffReceiptV2(receiptInput)).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    expect(snapshotTreeV2(generated.directories.root)).toEqual(receiptBefore);
  });

  it('rejects every malformed reference decision and receipt shape before touching the ledger', async () => {
    const ids = ['reference_input_contract_v2', 'reference_input_contract_handoff_v2'];
    const { store } = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp });
    const project = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const seeded = await seedReferenceRequestV2(store, project, { requestId: 'reference_input_contract_request' });
    const decisionInput = {
      projectId: project.id,
      requestId: seeded.request.id,
      expectedRevision: project.revision,
      outcome: { kind: 'generation_gate' as const },
    };
    const before = snapshotTreeV2(seeded.directories.root);
    const malformedDecisions: unknown[] = [
      null,
      { ...decisionInput, extra: true },
      { ...decisionInput, projectId: '../unsafe' },
      { ...decisionInput, requestId: '../unsafe' },
      { ...decisionInput, expectedRevision: 0 },
      { ...decisionInput, outcome: null },
      { ...decisionInput, outcome: { kind: 'rejected', extra: true } },
      { ...decisionInput, outcome: { kind: 'generation_gate', extra: true } },
      { ...decisionInput, outcome: { kind: 'imported_reference', assetId: 'asset', extra: true } },
      { ...decisionInput, outcome: { kind: 'imported_reference', assetId: '../unsafe' } },
      { ...decisionInput, outcome: { kind: 'unknown' } },
    ];
    for (const malformed of malformedDecisions) {
      // Each malformed shape is deliberately outside the public TypeScript contract.
      // eslint-disable-next-line no-await-in-loop
      await expect(store.decideReferenceRequestV2(malformed as never)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    }
    expect(snapshotTreeV2(seeded.directories.root)).toEqual(before);

    const generated = await seedGenerationHandoffV2(store, project, {
      requestId: 'reference_receipt_contract_request',
      slotIndex: 1,
    });
    const receiptInput = {
      projectId: project.id,
      handoffId: generated.handoffId,
      expectedRevision: project.revision,
      result: { kind: 'dismissed' as const },
    };
    const receiptBefore = snapshotTreeV2(generated.directories.root);
    const malformedReceipts: unknown[] = [
      null,
      { ...receiptInput, extra: true },
      { ...receiptInput, projectId: '../unsafe' },
      { ...receiptInput, handoffId: '../unsafe' },
      { ...receiptInput, expectedRevision: 0 },
      { ...receiptInput, result: null },
      { ...receiptInput, result: { kind: 'dismissed', extra: true } },
      { ...receiptInput, result: { kind: 'confirmed', authorizationId: 'authorization', extra: true } },
      { ...receiptInput, result: { kind: 'confirmed', authorizationId: '../unsafe' } },
      { ...receiptInput, result: { kind: 'unknown' } },
    ];
    for (const malformed of malformedReceipts) {
      // Each malformed shape is deliberately outside the public TypeScript contract.
      // eslint-disable-next-line no-await-in-loop
      await expect(store.recordReferenceGenerationHandoffReceiptV2(malformed as never)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    }
    expect(snapshotTreeV2(generated.directories.root)).toEqual(receiptBefore);
  });

  it('rejects unsafe proposal and reference identities at every public ledger boundary', async () => {
    const { store } = createStoreV2({ createId: () => 'ledger_identity_contract_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);

    await expect(store.listProposalsV2('../unsafe')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.acceptProposalV2('../unsafe', 'proposal')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.acceptProposalV2(project.id, '../unsafe')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.rejectProposalV2('../unsafe', 'proposal')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.rejectProposalV2(project.id, '../unsafe')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.resolveProposalPathsV2('../unsafe')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.listReferenceRequestsV2('../unsafe')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.resolveReferenceRequestPathsV2('../unsafe')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(store.readReferenceGenerationHandoffV2('../unsafe', 'handoff')).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(store.readReferenceGenerationHandoffV2(project.id, '../unsafe')).rejects.toMatchObject({
      code: 'invalid_payload',
    });
  });

  it('distinguishes absent ledgers from empty ledgers at every proposal and reference lookup boundary', async () => {
    const { store } = createStoreV2({ createId: () => 'empty_ledger_contract_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const missingReceipt = {
      projectId: project.id,
      handoffId: 'missing_handoff',
      expectedRevision: project.revision,
      result: { kind: 'dismissed' as const },
    };
    const missingDecision = {
      projectId: project.id,
      requestId: 'missing_request',
      expectedRevision: project.revision,
      outcome: { kind: 'rejected' as const },
    };

    await expect(store.acceptProposalV2(project.id, 'missing_proposal')).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.rejectProposalV2(project.id, 'missing_proposal')).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.decideReferenceRequestV2(missingDecision)).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.recordReferenceGenerationHandoffReceiptV2(missingReceipt)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(store.readReferenceGenerationHandoffV2(project.id, 'missing_handoff')).resolves.toBeNull();

    await store.resolveProposalPathsV2(project.id);
    await store.resolveReferenceRequestPathsV2(project.id);
    await expect(store.acceptProposalV2(project.id, 'missing_proposal')).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.rejectProposalV2(project.id, 'missing_proposal')).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.decideReferenceRequestV2(missingDecision)).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.recordReferenceGenerationHandoffReceiptV2(missingReceipt)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(store.readReferenceGenerationHandoffV2(project.id, 'missing_handoff')).resolves.toBeNull();
  });

  it('fails closed without mutation for malformed proposal and reference directory entries', async () => {
    const { store } = createStoreV2({ createId: () => 'malformed_ledger_entries_v2', now: () => timestamp });
    const project = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const proposal = await seedProposalV2(store, project, { proposalId: 'malformed_entry_proposal' });
    const reference = await seedReferenceRequestV2(store, project, {
      requestId: 'malformed_entry_reference',
    });
    const cases: Array<{ root: string; directory: string; name: string; list: () => Promise<unknown> }> = [
      {
        root: proposal.directories.root,
        directory: proposal.directories.pending,
        name: 'not-json.txt',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: proposal.directories.root,
        directory: proposal.directories.pending,
        name: '.json',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: proposal.directories.root,
        directory: proposal.directories.decisions,
        name: 'not-json.txt',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: proposal.directories.root,
        directory: proposal.directories.decisions,
        name: '.json',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: proposal.directories.root,
        directory: proposal.directories.slots,
        name: '99.slot',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: proposal.directories.root,
        directory: proposal.directories.slots,
        name: 'not-slot.txt',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: proposal.directories.root,
        directory: proposal.directories.commits,
        name: 'not-commit.txt',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: proposal.directories.root,
        directory: proposal.directories.commits,
        name: '.accepted.json',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: reference.directories.root,
        directory: reference.directories.pending,
        name: 'not-json.txt',
        list: () => store.listReferenceRequestsV2(project.id),
      },
      {
        root: reference.directories.root,
        directory: reference.directories.pending,
        name: '.json',
        list: () => store.listReferenceRequestsV2(project.id),
      },
      {
        root: reference.directories.root,
        directory: reference.directories.decisions,
        name: 'not-json.txt',
        list: () => store.listReferenceRequestsV2(project.id),
      },
      {
        root: reference.directories.root,
        directory: reference.directories.decisions,
        name: '.json',
        list: () => store.listReferenceRequestsV2(project.id),
      },
      {
        root: reference.directories.root,
        directory: reference.directories.slots,
        name: '99.slot',
        list: () => store.listReferenceRequestsV2(project.id),
      },
      {
        root: reference.directories.root,
        directory: reference.directories.receipts,
        name: 'not-json.txt',
        list: () => store.listReferenceRequestsV2(project.id),
      },
      {
        root: reference.directories.root,
        directory: reference.directories.receipts,
        name: '.json',
        list: () => store.listReferenceRequestsV2(project.id),
      },
    ];

    for (const malformed of cases) {
      const file = path.join(malformed.directory, malformed.name);
      writeFileSync(file, '{}');
      const before = snapshotTreeV2(malformed.root);
      // Each case uses a different durable ledger namespace.
      // eslint-disable-next-line no-await-in-loop
      await expect(malformed.list()).rejects.toMatchObject({ code: 'storage_error' });
      expect(snapshotTreeV2(malformed.root)).toEqual(before);
      rmSync(file);
    }
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(1);
    await expect(store.listReferenceRequestsV2(project.id)).resolves.toHaveLength(1);
  });

  it('rejects malformed terminal journal publications without promoting or removing them', async () => {
    const { store } = createStoreV2({ createId: () => 'malformed_terminal_publications_v2', now: () => timestamp });
    const project = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const proposal = await seedProposalV2(store, project, { proposalId: 'malformed_journal_proposal' });
    const reference = await seedReferenceRequestV2(store, project, {
      requestId: 'malformed_journal_reference',
    });
    const cases: Array<{ root: string; file: string; bytes: string; list: () => Promise<unknown> }> = [
      {
        root: proposal.directories.root,
        file: path.join(proposal.directories.decisions, `${proposal.proposal.id}.json.publish`),
        bytes: '{}',
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: proposal.directories.root,
        file: path.join(proposal.directories.commits, `${proposal.proposal.id}.accepted.json.publish`),
        bytes: JSON.stringify({ schemaVersion: 1 }),
        list: () => store.listProposalsV2(project.id),
      },
      {
        root: reference.directories.root,
        file: path.join(reference.directories.decisions, `${reference.request.id}.json.publish`),
        bytes: '{}',
        list: () => store.listReferenceRequestsV2(project.id),
      },
      {
        root: reference.directories.root,
        file: path.join(reference.directories.receipts, 'malformed_handoff.json.publish'),
        bytes: '{}',
        list: () => store.listReferenceRequestsV2(project.id),
      },
    ];

    for (const malformed of cases) {
      writeFileSync(malformed.file, malformed.bytes);
      const before = snapshotTreeV2(malformed.root);
      // Each malformed publication must fail before recovery mutates the journal.
      // eslint-disable-next-line no-await-in-loop
      await expect(malformed.list()).rejects.toMatchObject({ code: 'storage_error' });
      expect(snapshotTreeV2(malformed.root)).toEqual(before);
      rmSync(malformed.file);
    }
  });

  it('fails closed for missing or duplicate proposal and reference slot authority', async () => {
    const { store } = createStoreV2({ createId: () => 'slot_authority_contract_v2', now: () => timestamp });
    const project = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const proposal = await seedProposalV2(store, project, { proposalId: 'slot_authority_proposal' });
    const proposalSlot = path.join(proposal.directories.slots, '0.slot');
    const proposalSlotBytes = readFileSync(proposalSlot);
    const duplicateProposalSlot = path.join(proposal.directories.slots, '1.slot');
    writeFileSync(duplicateProposalSlot, proposalSlotBytes);
    await expect(store.listProposalsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    rmSync(duplicateProposalSlot);
    rmSync(proposalSlot);
    await expect(store.listProposalsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    writeFileSync(proposalSlot, proposalSlotBytes);

    const reference = await seedReferenceRequestV2(store, project, {
      requestId: 'slot_authority_reference',
    });
    const referenceSlot = path.join(reference.directories.slots, '0.slot');
    const referenceSlotBytes = readFileSync(referenceSlot);
    const duplicateReferenceSlot = path.join(reference.directories.slots, '1.slot');
    writeFileSync(duplicateReferenceSlot, referenceSlotBytes);
    await expect(store.listReferenceRequestsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    rmSync(duplicateReferenceSlot);
    rmSync(referenceSlot);
    await expect(store.listReferenceRequestsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('repairs an authorization-origin handoff into one exact confirmed receipt before project exposure', async () => {
    const ids = ['reference_repair_v2', 'handoff_repair_v2'];
    const { store } = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_reference_id',
      now: () => '2026-08-17T12:00:02.000Z',
    });
    const created = await store.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(store, created);
    const { request, slot, directories } = await seedReferenceRequestV2(store, project, {
      requestId: 'request_repair',
    });
    const decided = await store.decideReferenceRequestV2({
      projectId: project.id,
      requestId: request.id,
      expectedRevision: project.revision,
      outcome: { kind: 'generation_gate' },
    });
    const handoffId = (
      decided.decision as StudioReferenceRequestDecisionV2 & {
        outcome: { kind: 'generation_gate'; handoffId: string; referenceIds: string[] };
      }
    ).outcome.handoffId;
    const authorized = await store.updateProjectV2(
      project.id,
      (draft) => addReferenceAuthorizationV2(draft, handoffId),
      project.revision
    );
    const receiptFile = path.join(directories.receipts, `${handoffId}.json`);
    rmSync(receiptFile);
    rmSync(`${receiptFile}.publish`);
    writeFileSync(path.join(directories.slots, '0.slot'), JSON.stringify(slot));
    expect(readdirSync(directories.receipts)).toEqual([]);

    await expect(store.getProjectV2(project.id)).resolves.toMatchObject({
      status: 'supported',
      project: { revision: authorized.revision },
    });
    const receipt = readJson<StudioReferenceGenerationHandoffReceiptV2>(
      path.join(directories.receipts, `${handoffId}.json`)
    );
    expect(receipt).toEqual({
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
      handoffId,
      requestId: request.id,
      completedAt: '2026-08-17T12:00:03.000Z',
      result: { kind: 'confirmed', authorizationId: `authorization_${handoffId}` },
    });
    expect(readdirSync(directories.slots)).toEqual([]);
    await expect(store.listReferenceRequestsV2(project.id)).resolves.toEqual([expect.objectContaining({ receipt })]);
  });

  it('arms the reference watcher before any V2 project and expires old requests with deduplicated notifications', async () => {
    let notifyChange: ((relativeFile: string) => void) | undefined;
    const listener = vi.fn();
    const { store } = createStoreV2({
      createId: () => 'reference_watch_v2',
      now: () => '2026-08-17T12:00:02.000Z',
      watchProposalTree: ({ onChange }) => {
        notifyChange = onChange;
        return { close: vi.fn() };
      },
    });
    const stop = await store.watchReferenceRequestsV2(listener);
    const project = await store.createProjectV2(inputV2);
    const active = await addActiveReferenceShotsV2(store, project);
    const seeded = await seedReferenceRequestV2(store, active, { requestId: 'request_watch' });
    notifyChange?.(`${active.id}/reference-requests/pending/${seeded.request.id}.json`);
    notifyChange?.(`${active.id}/reference-requests/pending/${seeded.request.id}.json`);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    writeFileSync(
      path.join(seeded.directories.pending, `${seeded.request.id}.json`),
      JSON.stringify({ ...seeded.request, createdAt: '2026-08-17T12:00:01.000Z' })
    );
    notifyChange?.(`${active.id}/reference-requests/pending/${seeded.request.id}.json`);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
    await store.decideReferenceRequestV2({
      projectId: active.id,
      requestId: seeded.request.id,
      expectedRevision: active.revision,
      outcome: { kind: 'rejected' },
    });
    notifyChange?.(`${active.id}/reference-requests/decisions/${seeded.request.id}.json`);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(3));
    await stop();

    const expired = await seedReferenceRequestV2(store, active, {
      requestId: 'request_expired',
      createdAt: '2026-08-01T00:00:00.000Z',
      slotIndex: 1,
    });
    await store.reapAbandonedReferenceRequestsV2();
    await expect(store.listReferenceRequestsV2(active.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          request: expect.objectContaining({ id: expired.request.id }),
          decision: expect.objectContaining({ outcome: { kind: 'expired' } }),
        }),
      ])
    );
    expect(readdirSync(expired.directories.slots)).toEqual([]);
  });

  it('creates a complete reference directory family, keeps list read-only, and refuses a partial family', async () => {
    const { store } = createStoreV2({
      createId: vi.fn().mockReturnValueOnce('reference_paths_v2').mockReturnValueOnce('reference_partial_v2'),
      now: () => timestamp,
    });
    const project = await store.createProjectV2(inputV2);
    await expect(store.listReferenceRequestsV2(project.id)).resolves.toEqual([]);
    expect(existsSync(path.join(rootDir, project.id, 'reference-requests'))).toBe(false);
    const paths = await store.resolveReferenceRequestPathsV2(project.id);
    expect(readdirSync(path.join(paths.projectDir, 'reference-requests')).toSorted()).toEqual([
      'decisions',
      'pending',
      'receipts',
      'slots',
    ]);

    const partial = await store.createProjectV2(inputV2);
    const partialRoot = path.join(rootDir, partial.id, 'reference-requests');
    mkdirSync(path.join(partialRoot, 'pending'), { recursive: true });
    mkdirSync(path.join(partialRoot, 'slots'));
    await expect(store.resolveReferenceRequestPathsV2(partial.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(readdirSync(partialRoot).toSorted()).toEqual(['pending', 'slots']);
  });

  it('rejects a same-project generation handoff collision without changing any reference bytes', async () => {
    const ids = ['reference_collision_v2', 'shared_handoff_v2', 'shared_handoff_v2'];
    const { store } = createStoreV2({
      createId: () => ids.shift() ?? 'unexpected_reference_id',
      now: () => timestamp,
    });
    const created = await store.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(store, created);
    const first = await seedReferenceRequestV2(store, project, { requestId: 'request_collision_a', slotIndex: 0 });
    await store.decideReferenceRequestV2({
      projectId: project.id,
      requestId: first.request.id,
      expectedRevision: project.revision,
      outcome: { kind: 'generation_gate' },
    });
    const second = await seedReferenceRequestV2(store, project, { requestId: 'request_collision_b', slotIndex: 1 });
    const before = snapshotTreeV2(second.directories.root);
    await expect(
      store.decideReferenceRequestV2({
        projectId: project.id,
        requestId: second.request.id,
        expectedRevision: project.revision,
        outcome: { kind: 'generation_gate' },
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(snapshotTreeV2(second.directories.root)).toEqual(before);
  });

  it.each([
    { label: 'request id', mutate: 'request' as const },
    { label: 'handoff id', mutate: 'handoff' as const },
  ])('fails closed on a receipt whose $label does not match its generation relation', async ({ mutate }) => {
    const ids = [`relation_project_${mutate}`, `relation_handoff_${mutate}`];
    const { store } = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp });
    const created = await store.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(store, created);
    const generated = await seedGenerationHandoffV2(store, project, { requestId: `relation_request_${mutate}` });
    const receipt: StudioReferenceGenerationHandoffReceiptV2 = {
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
      handoffId: mutate === 'handoff' ? 'different_handoff' : generated.handoffId,
      requestId: mutate === 'request' ? 'different_request' : generated.request.id,
      completedAt: timestamp,
      result: { kind: 'dismissed' },
    };
    writeFileSync(path.join(generated.directories.receipts, `${generated.handoffId}.json`), JSON.stringify(receipt));
    const before = snapshotTreeV2(generated.directories.root);

    await expect(store.getProjectV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });

    expect(snapshotTreeV2(generated.directories.root)).toEqual(before);
    expect(readdirSync(generated.directories.slots)).toEqual(['0.slot']);
  });

  it.each([
    { label: 'confirmed receipt without authorization', auth: false, result: 'confirmed' as const, early: false },
    { label: 'confirmed receipt with the wrong authorization', auth: true, result: 'confirmed' as const, early: false },
    { label: 'dismissed receipt with authorization', auth: true, result: 'dismissed' as const, early: false },
    { label: 'authorization confirmed before its decision', auth: true, result: null, early: true },
  ])('preserves bytes for $label', async ({ auth, result, early }) => {
    const ids = [`auth_project_${result ?? 'early'}`, `auth_handoff_${result ?? 'early'}`];
    const decisionTime = early ? '2026-08-17T12:00:04.000Z' : timestamp;
    const { store } = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => decisionTime });
    const created = await store.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(store, created);
    const generated = await seedGenerationHandoffV2(store, project, {
      requestId: `auth_request_${result ?? 'early'}`,
    });
    if (auth) {
      writeFileSync(
        path.join(rootDir, project.id, 'project.json'),
        JSON.stringify(addReferenceAuthorizationV2(structuredClone(project), generated.handoffId), null, 2)
      );
    }
    if (result !== null) {
      const receipt: StudioReferenceGenerationHandoffReceiptV2 = {
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
        handoffId: generated.handoffId,
        requestId: generated.request.id,
        completedAt: '2026-08-17T12:00:03.000Z',
        result:
          result === 'dismissed'
            ? { kind: 'dismissed' }
            : {
                kind: 'confirmed',
                authorizationId: auth ? 'wrong_authorization' : 'missing_authorization',
              },
      };
      const receiptFile = path.join(generated.directories.receipts, `${generated.handoffId}.json`);
      writeFileSync(receiptFile, JSON.stringify(receipt));
      if (auth && result === 'confirmed') linkSync(receiptFile, `${receiptFile}.publish`);
    }
    const before = snapshotTreeV2(path.join(rootDir, project.id));

    await expect(store.getProjectV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });

    expect(snapshotTreeV2(path.join(rootDir, project.id))).toEqual(before);
    expect(readdirSync(generated.directories.slots)).toEqual(['0.slot']);
  });

  it('scopes the same generated handoff identity independently across projects', async () => {
    const ids = ['cross_project_a', 'cross_project_b', 'shared_reference_handoff', 'shared_reference_handoff'];
    const { store } = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp });
    const first = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const second = await addActiveReferenceShotsV2(store, await store.createProjectV2(inputV2));
    const firstHandoff = await seedGenerationHandoffV2(store, first, { requestId: 'cross_request_a' });
    const secondHandoff = await seedGenerationHandoffV2(store, second, { requestId: 'cross_request_b' });

    expect(firstHandoff.handoffId).toBe('shared_reference_handoff');
    expect(secondHandoff.handoffId).toBe('shared_reference_handoff');
    await expect(store.readReferenceGenerationHandoffV2(first.id, firstHandoff.handoffId)).resolves.toMatchObject({
      request: { id: 'cross_request_a', projectId: first.id },
    });
    await store.recordReferenceGenerationHandoffReceiptV2({
      projectId: first.id,
      handoffId: firstHandoff.handoffId,
      expectedRevision: first.revision,
      result: { kind: 'dismissed' },
    });
    await expect(store.readReferenceGenerationHandoffV2(second.id, secondHandoff.handoffId)).resolves.toMatchObject({
      request: { id: 'cross_request_b', projectId: second.id },
      receipt: null,
    });
  });

  it('restart-reconciles an exact linked reference decision publication residue', async () => {
    const ids = ['decision_publish_project', 'decision_publish_handoff'];
    const base = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp }).store;
    const created = await base.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(base, created);
    const seeded = await seedReferenceRequestV2(base, project, { requestId: 'decision_publish_request' });
    const decisionFile = path.join(seeded.directories.decisions, `${seeded.request.id}.json`);
    const crashing = createCreativeStudioStore({
      rootDir,
      fs: failFileSystemOnceV2(
        (method, args) =>
          method === 'rm' && String(args[0]).includes('/slots/0.slot.') && String(args[0]).endsWith('.cleanup')
      ),
      now: () => '2026-08-17T12:00:01.000Z',
      logError: () => undefined,
    });

    await expect(
      crashing.decideReferenceRequestV2({
        projectId: project.id,
        requestId: seeded.request.id,
        expectedRevision: project.revision,
        outcome: { kind: 'rejected' },
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(lstatSync(decisionFile).ino).toBe(lstatSync(`${decisionFile}.publish`).ino);

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:02.000Z' }).store;
    await expect(restarted.listReferenceRequestsV2(project.id)).resolves.toMatchObject([
      { decision: { outcome: { kind: 'rejected' } } },
    ]);
    expect(existsSync(`${decisionFile}.publish`)).toBe(true);
    expect(readdirSync(seeded.directories.slots)).toEqual([]);
  });

  it('promotes relationally valid temp-only proposal and reference journal records after restart', async () => {
    const ids = ['temp_journal_project', 'temp_journal_handoff'];
    const store = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp }).store;
    const created = await store.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(store, created);
    const proposal = await seedProposalV2(store, project, { proposalId: 'temp_journal_proposal' });
    const proposalDecisionFile = path.join(proposal.directories.decisions, `${proposal.proposal.id}.json`);
    writeFileSync(
      `${proposalDecisionFile}.publish`,
      JSON.stringify({
        schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
        proposalId: proposal.proposal.id,
        status: 'rejected',
        decidedAt: timestamp,
      })
    );
    const reference = await seedReferenceRequestV2(store, project, {
      requestId: 'temp_journal_reference',
      slotIndex: 1,
    });
    const referenceDecisionFile = path.join(reference.directories.decisions, `${reference.request.id}.json`);
    writeFileSync(
      `${referenceDecisionFile}.publish`,
      JSON.stringify({
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
        requestId: reference.request.id,
        projectId: project.id,
        decidedAt: timestamp,
        outcome: { kind: 'rejected' },
      })
    );

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:01.000Z' }).store;
    await expect(restarted.listProposalsV2(project.id)).resolves.toMatchObject([
      { id: proposal.proposal.id, status: 'rejected' },
    ]);
    await expect(restarted.listReferenceRequestsV2(project.id)).resolves.toMatchObject([
      { request: { id: reference.request.id }, decision: { outcome: { kind: 'rejected' } } },
    ]);
    expect(existsSync(proposalDecisionFile)).toBe(true);
    expect(existsSync(`${proposalDecisionFile}.publish`)).toBe(true);
    expect(lstatSync(proposalDecisionFile).ino).toBe(lstatSync(`${proposalDecisionFile}.publish`).ino);
    expect(existsSync(referenceDecisionFile)).toBe(true);
    expect(existsSync(`${referenceDecisionFile}.publish`)).toBe(true);
    expect(lstatSync(referenceDecisionFile).ino).toBe(lstatSync(`${referenceDecisionFile}.publish`).ino);
  });

  it('preserves a temp-only journal whose otherwise valid decision predates its immutable source', async () => {
    const { store } = createStoreV2({ createId: () => 'temp_journal_mismatch_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const proposal = await seedProposalV2(store, project, { proposalId: 'temp_journal_mismatch' });
    const decisionFile = path.join(proposal.directories.decisions, `${proposal.proposal.id}.json`);
    const publicationFile = `${decisionFile}.publish`;
    writeFileSync(
      publicationFile,
      JSON.stringify({
        schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
        proposalId: proposal.proposal.id,
        status: 'rejected',
        decidedAt: '2026-08-16T23:59:59.999Z',
      })
    );
    const before = snapshotTreeV2(proposal.directories.root);

    await expect(store.listProposalsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });

    expect(existsSync(decisionFile)).toBe(false);
    expect(existsSync(publicationFile)).toBe(true);
    expect(snapshotTreeV2(proposal.directories.root)).toEqual(before);
  });

  it('restart-reconciles an exact linked receipt publication and receipt-first slot cleanup', async () => {
    const ids = ['receipt_publish_project', 'receipt_publish_handoff'];
    const base = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp }).store;
    const created = await base.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(base, created);
    const generated = await seedGenerationHandoffV2(base, project, { requestId: 'receipt_publish_request' });
    const receiptFile = path.join(generated.directories.receipts, `${generated.handoffId}.json`);
    const crashingPublication = createCreativeStudioStore({
      rootDir,
      fs: failFileSystemOnceV2(
        (method, args) =>
          method === 'rm' && String(args[0]).includes('/slots/0.slot.') && String(args[0]).endsWith('.cleanup')
      ),
      now: () => '2026-08-17T12:00:02.000Z',
      logError: () => undefined,
    });
    await expect(
      crashingPublication.recordReferenceGenerationHandoffReceiptV2({
        projectId: project.id,
        handoffId: generated.handoffId,
        expectedRevision: project.revision,
        result: { kind: 'dismissed' },
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(lstatSync(receiptFile).ino).toBe(lstatSync(`${receiptFile}.publish`).ino);
    expect(
      readdirSync(generated.directories.slots).some((name) => name.startsWith('0.slot.') && name.endsWith('.cleanup'))
    ).toBe(true);

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:04.000Z' }).store;
    const repaired = await restarted.recordReferenceGenerationHandoffReceiptV2({
      projectId: project.id,
      handoffId: generated.handoffId,
      expectedRevision: project.revision,
      result: { kind: 'dismissed' },
    });
    expect(repaired.receipt?.completedAt).toBe('2026-08-17T12:00:02.000Z');
    expect(readdirSync(generated.directories.receipts)).toEqual([
      `${generated.handoffId}.json`,
      `${generated.handoffId}.json.publish`,
    ]);
    expect(readdirSync(generated.directories.slots)).toEqual([]);
  });

  it('reconciles exact linked pending/slot temps and PID slot cleanup residues for both V2 ledgers', async () => {
    const ids = ['residue_project_v2', 'residue_handoff_v2'];
    const { store } = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp });
    const created = await store.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(store, created);
    const proposal = await seedProposalV2(store, project, { proposalId: 'proposal_residue' });
    const proposalFile = path.join(proposal.directories.pending, `${proposal.proposal.id}.json`);
    const proposalSlot = path.join(proposal.directories.slots, '0.slot');
    linkSync(proposalFile, `${proposalFile}.123_1.tmp`);
    linkSync(proposalSlot, `${proposalSlot}.123_2.tmp`);
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(1);
    expect(readdirSync(proposal.directories.pending)).toEqual([`${proposal.proposal.id}.json`]);
    expect(readdirSync(proposal.directories.slots)).toEqual(['0.slot']);

    const proposalWinnerBytes = readFileSync(proposalFile);
    const proposalWinnerInode = lstatSync(proposalFile).ino;
    const collidedProposalTemporary = `${proposalFile}.123_20.tmp`;
    const collidedProposalReady = `${proposalFile}.123_20.ready`;
    writeFileSync(
      collidedProposalTemporary,
      JSON.stringify({ ...proposal.proposal, createdAt: '2026-08-17T12:00:00.001Z' })
    );
    linkSync(collidedProposalTemporary, collidedProposalReady);
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(1);
    expect(existsSync(collidedProposalTemporary)).toBe(false);
    expect(existsSync(collidedProposalReady)).toBe(false);
    expect(readFileSync(proposalFile)).toEqual(proposalWinnerBytes);
    expect(lstatSync(proposalFile).ino).toBe(proposalWinnerInode);

    const collidedSlotTemporary = `${proposalSlot}.123_21.tmp`;
    const collidedSlotReady = `${proposalSlot}.123_21.ready`;
    writeFileSync(
      collidedSlotTemporary,
      JSON.stringify({
        schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
        proposalId: 'proposal_collision',
        reservedAt: timestamp,
      })
    );
    linkSync(collidedSlotTemporary, collidedSlotReady);
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(1);
    expect(existsSync(collidedSlotTemporary)).toBe(false);
    expect(existsSync(collidedSlotReady)).toBe(false);
    expect(readdirSync(proposal.directories.slots)).toEqual(['0.slot']);

    renameSync(proposalSlot, `${proposalSlot}.123_3.cleanup`);
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(1);
    expect(readdirSync(proposal.directories.slots)).toEqual(['0.slot']);
    linkSync(proposalSlot, `${proposalSlot}.123_31.cleanup`);
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(1);
    expect(readdirSync(proposal.directories.slots)).toEqual(['0.slot']);

    const rolledBackProposal: StudioProposalRecordV2 = {
      ...proposal.proposal,
      id: 'proposal_temp_only',
    };
    writeFileSync(
      path.join(proposal.directories.pending, 'proposal_temp_only.json.123_4.tmp'),
      JSON.stringify(rolledBackProposal)
    );
    writeFileSync(
      path.join(proposal.directories.slots, '9.slot.123_5.tmp'),
      JSON.stringify({
        schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
        proposalId: rolledBackProposal.id,
        reservedAt: timestamp,
      })
    );
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(1);
    expect(readdirSync(proposal.directories.pending)).toEqual([`${proposal.proposal.id}.json`]);
    expect(readdirSync(proposal.directories.slots)).toEqual(['0.slot']);

    const readyProposal: StudioProposalRecordV2 = { ...proposal.proposal, id: 'proposal_ready_phase' };
    const readyProposalFile = path.join(proposal.directories.pending, `${readyProposal.id}.json`);
    const readyProposalTemporary = `${readyProposalFile}.123_32.tmp`;
    const readyProposalPhase = `${readyProposalFile}.123_32.ready`;
    writeFileSync(readyProposalTemporary, JSON.stringify(readyProposal));
    linkSync(readyProposalTemporary, readyProposalPhase);
    writeFileSync(
      path.join(proposal.directories.slots, '2.slot'),
      JSON.stringify({
        schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
        proposalId: readyProposal.id,
        reservedAt: timestamp,
      })
    );
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(2);
    expect(lstatSync(readyProposalFile).ino).toBe(lstatSync(readyProposalPhase).ino);
    expect(lstatSync(readyProposalFile).ino).toBe(lstatSync(readyProposalTemporary).ino);

    const orphanProposalSlot = path.join(proposal.directories.slots, '3.slot');
    const orphanProposalTemporary = `${orphanProposalSlot}.123_33.tmp`;
    const orphanProposalPhase = `${orphanProposalSlot}.123_33.ready`;
    writeFileSync(
      orphanProposalTemporary,
      JSON.stringify({
        schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
        proposalId: 'proposal_orphan_ready',
        reservedAt: timestamp,
      })
    );
    linkSync(orphanProposalTemporary, orphanProposalPhase);
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(2);
    expect(existsSync(orphanProposalTemporary)).toBe(false);
    expect(existsSync(orphanProposalPhase)).toBe(false);

    const reference = await seedReferenceRequestV2(store, project, { requestId: 'reference_residue', slotIndex: 1 });
    const referenceFile = path.join(reference.directories.pending, `${reference.request.id}.json`);
    const referenceSlot = path.join(reference.directories.slots, '1.slot');
    linkSync(referenceFile, `${referenceFile}.123_6.tmp`);
    linkSync(referenceSlot, `${referenceSlot}.123_7.tmp`);
    await expect(store.listReferenceRequestsV2(project.id)).resolves.toHaveLength(1);
    const referenceWinnerBytes = readFileSync(referenceFile);
    const referenceWinnerInode = lstatSync(referenceFile).ino;
    const collidedReferenceTemporary = `${referenceFile}.123_60.tmp`;
    const collidedReferenceReady = `${referenceFile}.123_60.ready`;
    writeFileSync(
      collidedReferenceTemporary,
      JSON.stringify({ ...reference.request, createdAt: '2026-08-17T12:00:00.001Z' })
    );
    linkSync(collidedReferenceTemporary, collidedReferenceReady);
    await expect(store.listReferenceRequestsV2(project.id)).resolves.toHaveLength(1);
    expect(existsSync(collidedReferenceTemporary)).toBe(false);
    expect(existsSync(collidedReferenceReady)).toBe(false);
    expect(readFileSync(referenceFile)).toEqual(referenceWinnerBytes);
    expect(lstatSync(referenceFile).ino).toBe(referenceWinnerInode);
    renameSync(referenceSlot, `${referenceSlot}.123_8.cleanup`);
    await expect(store.listReferenceRequestsV2(project.id)).resolves.toHaveLength(1);
    expect(readdirSync(reference.directories.slots).toSorted()).toEqual(['1.slot']);

    const rolledBackReference: StudioReferenceRequestV2 = {
      ...reference.request,
      id: 'reference_temp_only',
    };
    writeFileSync(
      path.join(reference.directories.pending, 'reference_temp_only.json.123_9.tmp'),
      JSON.stringify(rolledBackReference)
    );
    writeFileSync(
      path.join(reference.directories.slots, '9.slot.123_10.tmp'),
      JSON.stringify({
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
        requestId: rolledBackReference.id,
        reservedAt: timestamp,
      })
    );
    await expect(store.listReferenceRequestsV2(project.id)).resolves.toHaveLength(1);
    expect(readdirSync(reference.directories.pending)).toEqual([`${reference.request.id}.json`]);
    expect(readdirSync(reference.directories.slots)).toEqual(['1.slot']);

    const readyReference: StudioReferenceRequestV2 = { ...reference.request, id: 'reference_ready_phase' };
    const readyReferenceFile = path.join(reference.directories.pending, `${readyReference.id}.json`);
    const readyReferenceTemporary = `${readyReferenceFile}.123_34.tmp`;
    const readyReferencePhase = `${readyReferenceFile}.123_34.ready`;
    writeFileSync(readyReferenceTemporary, JSON.stringify(readyReference));
    linkSync(readyReferenceTemporary, readyReferencePhase);
    writeFileSync(
      path.join(reference.directories.slots, '2.slot'),
      JSON.stringify({
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
        requestId: readyReference.id,
        reservedAt: timestamp,
      })
    );
    await expect(store.listReferenceRequestsV2(project.id)).resolves.toHaveLength(2);
    expect(lstatSync(readyReferenceFile).ino).toBe(lstatSync(readyReferencePhase).ino);
    expect(lstatSync(readyReferenceFile).ino).toBe(lstatSync(readyReferenceTemporary).ino);
  });

  it('recovers terminal slot companion cleanup when the second unlink is interrupted', async () => {
    const { store } = createStoreV2({ createId: () => 'companion_cleanup_project', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const seeded = await seedProposalV2(store, project, { proposalId: 'companion_cleanup_proposal' });
    const slotFile = path.join(seeded.directories.slots, '0.slot');
    const temporaryFile = `${slotFile}.123_40.tmp`;
    const readyFile = `${slotFile}.123_40.ready`;
    linkSync(slotFile, temporaryFile);
    linkSync(slotFile, readyFile);
    const interrupted = createCreativeStudioStore({
      rootDir,
      fs: failFileSystemOnceV2((method, args) => method === 'rm' && String(args[0]).endsWith('.tmp')),
      now: () => '2026-08-17T12:00:01.000Z',
      logError: () => undefined,
    });

    await expect(interrupted.rejectProposalV2(project.id, seeded.proposal.id)).rejects.toMatchObject({ code: 'EIO' });
    expect(existsSync(readyFile)).toBe(false);
    expect(existsSync(temporaryFile)).toBe(true);
    expect(existsSync(slotFile)).toBe(true);

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:02.000Z' }).store;
    await expect(restarted.rejectProposalV2(project.id, seeded.proposal.id)).resolves.toMatchObject({
      status: 'rejected',
    });
    expect(readdirSync(seeded.directories.slots)).toEqual([]);
  });

  it('restart-recovers an interrupted same-ID pending publication collision without replacing the winner', async () => {
    const { store } = createStoreV2({ createId: () => 'pending_collision_project', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const seeded = await seedProposalV2(store, project, { proposalId: 'pending_collision_proposal' });
    const proposalFile = path.join(seeded.directories.pending, `${seeded.proposal.id}.json`);
    const temporaryFile = `${proposalFile}.123_41.tmp`;
    const readyFile = `${proposalFile}.123_41.ready`;
    const winnerBytes = readFileSync(proposalFile);
    const winnerInode = lstatSync(proposalFile).ino;
    writeFileSync(temporaryFile, JSON.stringify({ ...seeded.proposal, createdAt: '2026-08-17T12:00:00.001Z' }));
    linkSync(temporaryFile, readyFile);
    const interrupted = createCreativeStudioStore({
      rootDir,
      fs: failFileSystemOnceV2(
        (method, args) => method === 'rm' && String(args[0]).endsWith(path.basename(temporaryFile))
      ),
      now: () => '2026-08-17T12:00:01.000Z',
      logError: () => undefined,
    });

    await expect(interrupted.listProposalsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(existsSync(readyFile)).toBe(false);
    expect(existsSync(temporaryFile)).toBe(true);
    expect(readFileSync(proposalFile)).toEqual(winnerBytes);
    expect(lstatSync(proposalFile).ino).toBe(winnerInode);

    const restarted = createStoreV2({ now: () => '2026-08-17T12:00:02.000Z' }).store;
    await expect(restarted.listProposalsV2(project.id)).resolves.toHaveLength(1);
    expect(existsSync(temporaryFile)).toBe(false);
    expect(readFileSync(proposalFile)).toEqual(winnerBytes);
    expect(lstatSync(proposalFile).ino).toBe(winnerInode);
  });

  it('does not touch malformed or schema-1 same-ID pending publication collisions', async () => {
    const { store } = createStoreV2({ createId: () => 'invalid_pending_collision_project', now: () => timestamp });
    const created = await store.createProjectV2(inputV2);
    const project = await addActiveReferenceShotsV2(store, created);
    const proposal = await seedProposalV2(store, project, { proposalId: 'malformed_pending_collision' });
    const proposalFile = path.join(proposal.directories.pending, `${proposal.proposal.id}.json`);
    const proposalTemporary = `${proposalFile}.123_42.tmp`;
    const proposalReady = `${proposalFile}.123_42.ready`;
    writeFileSync(proposalTemporary, '{');
    linkSync(proposalTemporary, proposalReady);
    const proposalBefore = snapshotTreeV2(proposal.directories.root);

    await expect(store.listProposalsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(snapshotTreeV2(proposal.directories.root)).toEqual(proposalBefore);
    rmSync(proposalReady);
    rmSync(proposalTemporary);

    const reference = await seedReferenceRequestV2(store, project, {
      requestId: 'schema_one_pending_collision',
    });
    const referenceFile = path.join(reference.directories.pending, `${reference.request.id}.json`);
    const referenceTemporary = `${referenceFile}.123_43.tmp`;
    const referenceReady = `${referenceFile}.123_43.ready`;
    writeFileSync(referenceTemporary, JSON.stringify({ ...reference.request, schemaVersion: 1 }));
    linkSync(referenceTemporary, referenceReady);
    const referenceBefore = snapshotTreeV2(reference.directories.root);

    await expect(store.listReferenceRequestsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(snapshotTreeV2(reference.directories.root)).toEqual(referenceBefore);
  });

  it('preserves incomplete temp-only writer residue and an unsafe-name collision', async () => {
    const { store } = createStoreV2({ createId: () => 'temp_only_residue_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const paths = await store.resolveProposalPathsV2(project.id);
    const slots = path.join(path.dirname(paths.pendingDir), 'slots');
    const pendingResidue = path.join(paths.pendingDir, 'interrupted.json.123_1.tmp');
    const slotResidue = path.join(slots, '1.slot.123_2.tmp');
    writeFileSync(pendingResidue, '');
    writeFileSync(slotResidue, '{"schemaVersion":');

    await expect(store.listProposalsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(existsSync(pendingResidue)).toBe(true);
    expect(existsSync(slotResidue)).toBe(true);
    rmSync(pendingResidue);
    rmSync(slotResidue);

    const collision = path.join(paths.pendingDir, 'not safe.json.123_3.tmp');
    writeFileSync(collision, 'foreign bytes');
    const before = readFileSync(collision);

    await expect(store.listProposalsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });

    expect(readFileSync(collision)).toEqual(before);
  });

  it('preserves unsafe journal residue, unowned publication collisions, and out-of-range slots', async () => {
    const ids = ['journal_collision_project', 'journal_collision_handoff'];
    const base = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp }).store;
    const project = await addActiveReferenceShotsV2(base, await base.createProjectV2(inputV2));
    const seeded = await seedReferenceRequestV2(base, project, { requestId: 'journal_collision_request' });
    const unsafeResidue = path.join(seeded.directories.decisions, 'not safe.json.publish');
    writeFileSync(unsafeResidue, 'foreign journal bytes');
    const unsafeBefore = readFileSync(unsafeResidue);
    await expect(base.listReferenceRequestsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(readFileSync(unsafeResidue)).toEqual(unsafeBefore);
    rmSync(unsafeResidue);

    const decisionFile = path.join(seeded.directories.decisions, `${seeded.request.id}.json`);
    const publication = `${decisionFile}.publish`;
    const sentinel = 'unowned publication collision';
    let collidedPublication: string | null = null;
    const collisionFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (property !== 'open' || typeof value !== 'function') return value;
        return async (...args: unknown[]): Promise<unknown> => {
          const openedFile = String(args[0]);
          if (
            openedFile.endsWith('/journal_collision_request.json.publish') &&
            String(args[1]) === 'wx' &&
            !existsSync(openedFile)
          ) {
            collidedPublication = openedFile;
            writeFileSync(openedFile, sentinel);
          }
          return Reflect.apply(value, target, args) as unknown;
        };
      },
    }) as typeof nodeFs;
    const colliding = createCreativeStudioStore({ rootDir, fs: collisionFs, now: () => timestamp });
    await expect(
      colliding.decideReferenceRequestV2({
        projectId: project.id,
        requestId: seeded.request.id,
        expectedRevision: project.revision,
        outcome: { kind: 'generation_gate' },
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(collidedPublication?.endsWith('/journal_collision_request.json.publish')).toBe(true);
    expect(readFileSync(publication, 'utf8')).toBe(sentinel);
    expect(existsSync(decisionFile)).toBe(false);
    await expect(base.listReferenceRequestsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(readFileSync(publication, 'utf8')).toBe(sentinel);
    expect(existsSync(decisionFile)).toBe(false);
    rmSync(publication);

    renameSync(path.join(seeded.directories.slots, '0.slot'), path.join(seeded.directories.slots, '50.slot'));
    const beforeRangeCheck = snapshotTreeV2(seeded.directories.root);
    await expect(base.listReferenceRequestsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
    expect(snapshotTreeV2(seeded.directories.root)).toEqual(beforeRangeCheck);
  });

  it('rejects rollback clocks before proposal, reference decision, or dismissed receipt publication', async () => {
    const ids = ['rollback_clock_project', 'rollback_clock_handoff'];
    const base = createStoreV2({ createId: () => ids.shift() ?? 'unexpected_id', now: () => timestamp }).store;
    const project = await addActiveReferenceShotsV2(base, await base.createProjectV2(inputV2));
    const proposal = await seedProposalV2(base, project, { proposalId: 'rollback_clock_proposal' });
    const reference = await seedReferenceRequestV2(base, project, {
      requestId: 'rollback_clock_reference',
      slotIndex: 1,
    });
    const rollback = createStoreV2({
      createId: () => 'rollback_clock_handoff',
      now: () => '2026-08-17T11:59:59.000Z',
    }).store;
    const before = snapshotTreeV2(path.join(rootDir, project.id));
    await expect(rollback.rejectProposalV2(project.id, proposal.proposal.id)).rejects.toMatchObject({
      code: 'storage_error',
    });
    await expect(
      rollback.decideReferenceRequestV2({
        projectId: project.id,
        requestId: reference.request.id,
        expectedRevision: project.revision,
        outcome: { kind: 'generation_gate' },
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(snapshotTreeV2(path.join(rootDir, project.id))).toEqual(before);

    const generated = await seedGenerationHandoffV2(base, project, {
      requestId: 'rollback_receipt_reference',
      slotIndex: 2,
    });
    const receiptBefore = snapshotTreeV2(generated.directories.root);
    await expect(
      rollback.recordReferenceGenerationHandoffReceiptV2({
        projectId: project.id,
        handoffId: generated.handoffId,
        expectedRevision: project.revision,
        result: { kind: 'dismissed' },
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(snapshotTreeV2(generated.directories.root)).toEqual(receiptBefore);
  });

  it('fails closed when a reference directory generation is replaced', async () => {
    const { store } = createStoreV2({ createId: () => 'reference_directory_replacement', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const seeded = await seedReferenceRequestV2(store, project, { requestId: 'directory_replacement_request' });
    const outside = mkdtempSync(path.join(tmpdir(), 'reference-decisions-replacement-'));
    const marker = path.join(outside, 'marker');
    writeFileSync(marker, 'must survive');
    rmSync(seeded.directories.decisions, { recursive: true });
    symlinkSync(outside, seeded.directories.decisions);
    const before = snapshotTreeV2(path.join(rootDir, project.id));

    try {
      await expect(store.listReferenceRequestsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });
      expect(readFileSync(marker, 'utf8')).toBe('must survive');
      expect(snapshotTreeV2(path.join(rootDir, project.id))).toEqual(before);
    } finally {
      rmSync(seeded.directories.decisions);
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('counts only unresolved live records against V2 proposal and reference capacity', async () => {
    const { store } = createStoreV2({ createId: () => 'history_capacity_v2', now: () => timestamp });
    const project = await store.createProjectV2(inputV2);
    const proposalPaths = await store.resolveProposalPathsV2(project.id);
    const proposalRoot = path.dirname(proposalPaths.pendingDir);
    for (let index = 0; index < STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT; index += 1) {
      const proposalId = `terminal_${index}`;
      const proposal: StudioProposalRecordV2 = {
        schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
        id: proposalId,
        projectId: project.id,
        status: 'pending',
        baseRevision: project.revision,
        payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: proposalId }] },
        createdAt: timestamp,
        decidedAt: null,
      };
      const decision = {
        schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
        proposalId,
        status: 'rejected',
        decidedAt: timestamp,
      };
      writeFileSync(path.join(proposalPaths.pendingDir, `${proposalId}.json`), JSON.stringify(proposal));
      writeFileSync(path.join(proposalRoot, 'decisions', `${proposalId}.json`), JSON.stringify(decision));
    }
    const live = await seedProposalV2(store, project, { proposalId: 'live_after_history' });
    await expect(store.listProposalsV2(project.id)).resolves.toHaveLength(STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT + 1);
    for (let index = 1; index <= STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT; index += 1) {
      const proposalId = `live_overflow_${index}`;
      const proposal: StudioProposalRecordV2 = {
        ...live.proposal,
        id: proposalId,
      };
      writeFileSync(path.join(live.directories.pending, `${proposalId}.json`), JSON.stringify(proposal));
      writeFileSync(
        path.join(live.directories.slots, `${index}.slot`),
        JSON.stringify({ schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2, proposalId, reservedAt: timestamp })
      );
    }
    await expect(store.listProposalsV2(project.id)).rejects.toMatchObject({ code: 'storage_error' });

    const referenceStore = createStoreV2({
      createId: () => 'reference_history_capacity_v2',
      now: () => timestamp,
    }).store;
    const referenceProject = await referenceStore.createProjectV2(inputV2);
    const referencePaths = await referenceStore.resolveReferenceRequestPathsV2(referenceProject.id);
    const referenceRoot = path.dirname(referencePaths.pendingDir);
    for (let index = 0; index < STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT; index += 1) {
      const requestId = `terminal_reference_${index}`;
      const request: StudioReferenceRequestV2 = {
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
        id: requestId,
        projectId: referenceProject.id,
        referenceIds: ['historical_reference'],
        status: 'pending',
        createdAt: timestamp,
      };
      const decision: StudioReferenceRequestDecisionV2 = {
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
        requestId,
        projectId: referenceProject.id,
        decidedAt: timestamp,
        outcome: { kind: 'rejected' },
      };
      writeFileSync(path.join(referencePaths.pendingDir, `${requestId}.json`), JSON.stringify(request));
      writeFileSync(path.join(referenceRoot, 'decisions', `${requestId}.json`), JSON.stringify(decision));
    }
    const liveReference = await seedReferenceRequestV2(referenceStore, referenceProject, {
      requestId: 'live_reference_after_history',
    });
    await expect(referenceStore.listReferenceRequestsV2(referenceProject.id)).resolves.toHaveLength(
      STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT + 1
    );
    for (let index = 1; index <= STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT; index += 1) {
      const requestId = `live_reference_overflow_${index}`;
      const request: StudioReferenceRequestV2 = { ...liveReference.request, id: requestId };
      writeFileSync(path.join(liveReference.directories.pending, `${requestId}.json`), JSON.stringify(request));
      writeFileSync(
        path.join(liveReference.directories.slots, `${index}.slot`),
        JSON.stringify({ schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION, requestId, reservedAt: timestamp })
      );
    }
    await expect(referenceStore.listReferenceRequestsV2(referenceProject.id)).rejects.toMatchObject({
      code: 'storage_error',
    });
  });

  it('leaves a complete V1 project and sidecar tree byte-identical across every V2 ledger entrypoint', async () => {
    const prototype = await seedPrototypeProject('prototype_proposals_v1');
    const prototypeDirectory = path.join(rootDir, prototype.id);
    for (const relativeDirectory of [
      path.join('proposals', 'pending'),
      path.join('proposals', 'decisions'),
      path.join('proposals', 'slots'),
      path.join('reference-requests', 'pending'),
      path.join('reference-requests', 'slots'),
    ]) {
      mkdirSync(path.join(prototypeDirectory, relativeDirectory), { recursive: true });
    }
    const before = snapshotTreeV2(rootDir);
    const watchProposalTree = vi.fn(() => ({ close: vi.fn() }));
    const v2 = createCreativeStudioStore({
      rootDir,
      now: () => timestamp,
      watchProposalTree,
      logError: () => undefined,
    });

    await expect(v2.listProposalsV2(prototype.id)).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
    await expect(v2.acceptProposalV2(prototype.id, 'proposal_v1')).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await expect(v2.rejectProposalV2(prototype.id, 'proposal_v1')).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await expect(v2.resolveProposalPathsV2(prototype.id)).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await expect(v2.listReferenceRequestsV2(prototype.id)).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await expect(
      v2.decideReferenceRequestV2({
        projectId: prototype.id,
        requestId: 'request_v1',
        expectedRevision: 1,
        outcome: { kind: 'rejected' },
      })
    ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
    await expect(v2.readReferenceGenerationHandoffV2(prototype.id, 'handoff_v1')).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await expect(
      v2.recordReferenceGenerationHandoffReceiptV2({
        projectId: prototype.id,
        handoffId: 'handoff_v1',
        expectedRevision: 1,
        result: { kind: 'dismissed' },
      })
    ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
    await expect(v2.resolveReferenceRequestPathsV2(prototype.id)).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await v2.reapAbandonedProposalsV2();
    await v2.reapAbandonedReferenceRequestsV2();
    const stopProposals = await v2.watchProposalsV2(vi.fn());
    const stopReferences = await v2.watchReferenceRequestsV2(vi.fn());
    await stopProposals();
    await stopReferences();

    expect(watchProposalTree).toHaveBeenCalledTimes(2);
    expect(snapshotTreeV2(rootDir)).toEqual(before);
  });

  it('returns a verified path only for a supported schema-2 manifest without touching the V1 index', async () => {
    const prototype = await seedPrototypeProject();
    const prototypeManifestFile = path.join(rootDir, prototype.id, 'project.json');
    const prototypeIndexFile = path.join(rootDir, 'projects.json');
    const prototypeManifestBefore = readFileSync(prototypeManifestFile);
    const prototypeIndexBefore = readFileSync(prototypeIndexFile);
    const supported = createEmptyStudioProjectV2(inputV2, 'verified_path_v2', timestamp);
    seedProjectV2(supported);
    const malformedId = 'path_malformed_v2';
    mkdirSync(path.join(rootDir, malformedId));
    writeFileSync(
      path.join(rootDir, malformedId, 'project.json'),
      JSON.stringify({ schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION, id: malformedId })
    );
    const orphanId = 'path_without_manifest_v2';
    mkdirSync(path.join(rootDir, orphanId));
    writeFileSync(path.join(rootDir, orphanId, 'sidecar.bin'), Buffer.from([0, 1, 2]));
    const { store, prototypeIndexAccesses } = createStoreV2();

    await expect(store.getVerifiedProjectDirectoryV2(supported.id)).resolves.toBe(
      realpathSync(path.join(rootDir, supported.id))
    );
    await expect(store.getVerifiedProjectDirectoryV2(prototype.id)).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    await expect(store.getVerifiedProjectDirectoryV2(malformedId)).rejects.toMatchObject({ code: 'storage_error' });
    await expect(store.getVerifiedProjectDirectoryV2(orphanId)).resolves.toBeNull();
    await expect(store.getVerifiedProjectDirectoryV2('missing_path_v2')).resolves.toBeNull();
    await expect(store.getVerifiedProjectDirectoryV2('../unsafe')).resolves.toBeNull();

    expect(readFileSync(prototypeManifestFile)).toEqual(prototypeManifestBefore);
    expect(readFileSync(prototypeIndexFile)).toEqual(prototypeIndexBefore);
    expect(existsSync(path.join(rootDir, 'projects-v2.json'))).toBe(false);
    expect(prototypeIndexAccesses).toEqual([]);
  });
});

describe('creative studio renderer DTO contract', () => {
  it('keeps command responses free of filesystem paths, credentials, signed URLs, and media bytes', () => {
    type ForbiddenRendererField =
      | 'path'
      | 'filePath'
      | 'credential'
      | 'apiKey'
      | 'signedUrl'
      | 'url'
      | 'bytes'
      | 'base64'
      | 'providerJobId'
      | 'remoteStartedAt'
      | 'idempotencyKey'
      | 'adapterId'
      | 'cancellationPolicy';
    type KeysOfUnion<Value> = Value extends unknown ? keyof Value : never;
    type RendererDto =
      | StudioRendererProject
      | StudioProjectSummary
      | StudioAssetV2
      | StudioRendererJobV2
      | StudioMediaChoiceRef
      | StudioRouteCatalogV2
      | StudioConnectionRecord
      | StudioConnectionInventory
      | StudioConnectionValidationResult
      | StudioConnectionCandidate;
    type RendererProjectKeys = KeysOfUnion<RendererDto>;
    type NoForbiddenRendererFields = Extract<RendererProjectKeys, ForbiddenRendererField>;
    const result: StudioCommandResult<StudioProjectSummary[]> = { ok: true, data: [] };

    expectTypeOf<NoForbiddenRendererFields>().toEqualTypeOf<never>();
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('keeps rejected commands typed instead of throwing unstructured renderer errors', () => {
    const result: StudioCommandResult<never> = {
      ok: false,
      error: { code: 'invalid_payload', messageKey: 'conversation.creativeStudio.errors.invalidPayload' },
    };

    expect(result.error.code).toBe('invalid_payload');
  });
});

describe('CreativeStudioStore connections', () => {
  it('preserves an absent legacy conditioning capacity without writing a default', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-capacity-legacy-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      writeFileSync(
        path.join(root, 'connections.json'),
        JSON.stringify({ schemaVersion: 1, connections: [validConnectionBinding()] })
      );

      const [loaded] = await connectionStore.listConnections();

      expect(loaded?.capabilities).not.toHaveProperty('maxConditioningImages');
      expect(readFileSync(path.join(root, 'connections.json'), 'utf8')).not.toContain('maxConditioningImages');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([0, 6])('persists admitted conditioning capacity %i exactly', async (maxConditioningImages) => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-capacity-valid-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      const saved = await connectionStore.saveConnection({
        ...validConnectionBinding(),
        capabilities: { ...validConnectionBinding().capabilities, maxConditioningImages },
      });

      expect(saved.capabilities).toHaveProperty('maxConditioningImages', maxConditioningImages);
      await expect(connectionStore.listConnections()).resolves.toEqual([saved]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([-1, 1.5, 7])('rejects conditioning capacity %s at connection read and write boundaries', async (value) => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-capacity-invalid-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    const malformed = {
      ...validConnectionBinding(),
      capabilities: { ...validConnectionBinding().capabilities, maxConditioningImages: value },
    };
    try {
      await expect(connectionStore.saveConnection(malformed as never)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
      writeFileSync(
        path.join(root, 'connections.json'),
        JSON.stringify({ schemaVersion: 1, connections: [malformed] })
      );
      await expect(connectionStore.listConnections()).rejects.toMatchObject({ code: 'storage_error' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists only a secret-free validated binding in the separately atomic connection file', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      const saved = await connectionStore.saveConnection(validConnectionBinding());

      expect(saved.id).toBe('binding_1');
      expect(await connectionStore.listConnections()).toEqual([saved]);
      const raw = readFileSync(path.join(root, 'connections.json'), 'utf8');
      expect(raw).not.toContain('api_key');
      expect(raw).not.toContain('https://');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts the OpenRouter video adapter in the durable media-binding allowlist', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-openrouter-connection-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      const saved = await connectionStore.saveConnection({
        ...validConnectionBinding(),
        adapterId: 'openrouter-video-v1',
        model: 'bytedance/seedance-2.0-fast',
        capabilities: {
          mediaKinds: ['video'],
          audioModes: ['audio'],
          aspectRatios: ['16:9'],
          resolutions: ['720p'],
          minDurationSeconds: 4,
          maxDurationSeconds: 15,
          supportedDurationSeconds: [4, 6, 8, 10, 12, 15],
          supportsFirstFrame: false,
          maxConditioningImages: 0,
          cancellationPolicy: 'none',
        },
      });

      expect(saved.adapterId).toBe('openrouter-video-v1');
      expect(saved.capabilities.supportedDurationSeconds).toEqual([4, 6, 8, 10, 12, 15]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    { label: 'missing exact durations', supportedDurationSeconds: undefined, min: 4, max: 15 },
    { label: 'duplicate exact durations', supportedDurationSeconds: [4, 8, 8], min: 4, max: 8 },
    { label: 'unsorted exact durations', supportedDurationSeconds: [4, 12, 8], min: 4, max: 12 },
    { label: 'a lower endpoint mismatch', supportedDurationSeconds: [4, 8, 12], min: 5, max: 12 },
    { label: 'an upper endpoint mismatch', supportedDurationSeconds: [4, 8, 12], min: 4, max: 15 },
    { label: 'an out-of-domain duration', supportedDurationSeconds: [3, 4, 8], min: 3, max: 8 },
  ])('rejects OpenRouter durable capabilities with $label', async ({ supportedDurationSeconds, min, max }) => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-openrouter-invalid-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      const candidate = {
        ...validConnectionBinding(),
        adapterId: 'openrouter-video-v1' as const,
        capabilities: {
          mediaKinds: ['video'] as const,
          audioModes: ['audio'],
          aspectRatios: ['16:9'],
          resolutions: ['720p'],
          minDurationSeconds: min,
          maxDurationSeconds: max,
          ...(supportedDurationSeconds === undefined ? {} : { supportedDurationSeconds }),
          supportsFirstFrame: false,
          maxConditioningImages: 0,
          cancellationPolicy: 'none' as const,
        },
      };

      await expect(connectionStore.saveConnection(candidate as never)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts the image adapter only with its canonical image-only capabilities', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-image-connection-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      const saved = await connectionStore.saveConnection({
        ...validConnectionBinding(),
        adapterId: 'weprompt-image-v1',
        model: 'image-model',
        capabilities: { mediaKinds: ['image'] },
      });

      expect(saved.capabilities).toEqual({ mediaKinds: ['image'], cancellationPolicy: 'none' });
      await expect(connectionStore.listConnections()).resolves.toEqual([saved]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    { legacy: true, expected: 'queued_only' },
    { legacy: false, expected: 'none' },
    { legacy: undefined, expected: 'none' },
  ])(
    'canonicalizes legacy cancellation $legacy to $expected when reading connections',
    async ({ legacy, expected }) => {
      const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-legacy-read-'));
      const connectionStore = createCreativeStudioStore({ rootDir: root });
      try {
        const binding = validConnectionBinding() as StudioConnectionBinding & {
          capabilities: StudioConnectionBinding['capabilities'] & { cancellation?: boolean };
        };
        if (legacy !== undefined) binding.capabilities.cancellation = legacy;
        writeFileSync(
          path.join(root, 'connections.json'),
          JSON.stringify({ schemaVersion: 1, connections: [binding] })
        );

        const [loaded] = await connectionStore.listConnections();

        expect(loaded?.capabilities).toMatchObject({ cancellationPolicy: expected });
        expect(loaded?.capabilities).not.toHaveProperty('cancellation');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it('canonicalizes legacy cancellation on save and persists only cancellationPolicy', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-legacy-save-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      const legacy = validConnectionBinding() as StudioConnectionBinding & {
        capabilities: StudioConnectionBinding['capabilities'] & { cancellation: boolean };
      };
      legacy.capabilities.cancellation = true;

      const saved = await connectionStore.saveConnection(legacy);
      const raw = readFileSync(path.join(root, 'connections.json'), 'utf8');

      expect(saved.capabilities).toMatchObject({ cancellationPolicy: 'queued_only' });
      expect(saved.capabilities).not.toHaveProperty('cancellation');
      expect(raw).toContain('"cancellationPolicy": "queued_only"');
      expect(raw).not.toContain('"cancellation"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    { label: 'an invalid explicit policy', capabilities: { cancellationPolicy: 'always' } },
    { label: 'a non-string explicit policy', capabilities: { cancellationPolicy: 1 } },
    { label: 'a non-boolean legacy policy', capabilities: { cancellation: 'yes' } },
    {
      label: 'both legacy and explicit policy fields',
      capabilities: { cancellation: true, cancellationPolicy: 'none' },
    },
  ])('rejects $label at connection read and write boundaries', async ({ capabilities }) => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-policy-invalid-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    const malformed = {
      ...validConnectionBinding(),
      capabilities: { ...validConnectionBinding().capabilities, ...capabilities },
    };
    try {
      await expect(connectionStore.saveConnection(malformed as never)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
      writeFileSync(
        path.join(root, 'connections.json'),
        JSON.stringify({ schemaVersion: 1, connections: [malformed] })
      );
      await expect(connectionStore.listConnections()).rejects.toMatchObject({ code: 'storage_error' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    { label: 'a non-record binding', malformed: null },
    { label: 'non-record capabilities', malformed: { ...validConnectionBinding(), capabilities: null } },
  ])('rejects $label before connection canonicalization', async ({ malformed }) => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-shape-invalid-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      await expect(connectionStore.saveConnection(malformed as never)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    'unknown',
    'api_key',
    'base_url',
    'file_path',
    'token',
    'secret',
    'accessToken',
    'client-secret',
    'payloadBase64',
    'response_bytes',
    'raw-metadata',
  ])('rejects an unsafe or unknown top-level binding field on save: %s', async (field) => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-save-keys-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      await expect(
        connectionStore.saveConnection({ ...validConnectionBinding(), [field]: 'must-not-persist' } as never)
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['unknown', 'api_key', 'base_url', 'file_path', 'token', 'secret'])(
    'rejects an unsafe or unknown top-level binding field while reading: %s',
    async (field) => {
      const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-read-keys-'));
      const connectionStore = createCreativeStudioStore({ rootDir: root });
      try {
        writeFileSync(
          path.join(root, 'connections.json'),
          JSON.stringify({
            schemaVersion: 1,
            connections: [{ ...validConnectionBinding(), [field]: 'must-not-load' }],
          })
        );

        await expect(connectionStore.listConnections()).rejects.toMatchObject({ code: 'storage_error' });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it.each([
    { label: 'oversized connection id', override: { id: 'i'.repeat(257) } },
    { label: 'oversized provider id', override: { providerId: 'p'.repeat(257) } },
    { label: 'leading model whitespace', override: { model: ' open-sora' } },
    { label: 'trailing model whitespace', override: { model: 'open-sora ' } },
    { label: 'model control characters', override: { model: 'open\nsora' } },
    { label: 'model C1 control characters', override: { model: 'open\u0080sora' } },
    { label: 'oversized model', override: { model: 'm'.repeat(257) } },
    { label: 'non-ISO validation time', override: { validatedAt: 'yesterday' } },
    { label: 'non-canonical validation time', override: { validatedAt: '2026-07-30T07:00:00+07:00' } },
    { label: 'impossible validation time', override: { validatedAt: '2026-02-30T00:00:00.000Z' } },
  ])('rejects unsafe bounded binding metadata: $label', async ({ override }) => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-metadata-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      await expect(connectionStore.saveConnection({ ...validConnectionBinding(), ...override })).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['api_key', 'base_url', 'token', 'metadata'])(
    'rejects an unknown or sensitive manifest-root field while reading: %s',
    async (field) => {
      const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-root-'));
      const connectionStore = createCreativeStudioStore({ rootDir: root });
      try {
        writeFileSync(
          path.join(root, 'connections.json'),
          JSON.stringify({
            schemaVersion: 1,
            connections: [validConnectionBinding()],
            [field]: 'must-not-load',
          })
        );

        await expect(connectionStore.listConnections()).rejects.toMatchObject({ code: 'storage_error' });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it('rejects connection capabilities with unknown fields instead of durable provider metadata', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-invalid-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      await expect(
        connectionStore.saveConnection({
          schemaVersion: 1,
          id: 'binding_1',
          providerId: 'provider_1',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'open-sora',
          capabilities: { mediaKinds: ['video'], baseUrl: 'https://not-stored.invalid' } as never,
          validatedAt: '2026-07-30T00:00:00.000Z',
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('upserts the same provider adapter and model instead of creating duplicate routes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-upsert-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      const base = {
        schemaVersion: 1 as const,
        providerId: 'provider_1',
        adapterId: 'weprompt-media-gateway-v1' as const,
        model: 'open-sora',
        capabilities: { mediaKinds: ['video' as const], audioModes: ['none'] },
        validatedAt: '2026-07-30T00:00:00.000Z',
      };
      await connectionStore.saveConnection({ ...base, id: 'binding_1' });
      await connectionStore.saveConnection({ ...base, id: 'binding_2' });

      await expect(connectionStore.listConnections()).resolves.toMatchObject([{ id: 'binding_2' }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    { mediaKinds: ['image'], audioModes: ['none'] },
    { mediaKinds: ['video'], audioModes: ['none', 'stereo'] },
    { mediaKinds: ['video'], audioModes: ['none', 'none'] },
    { mediaKinds: ['video'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '16:9'] },
    { mediaKinds: ['video'], resolutions: ['720p', '1080p', '720p'] },
  ])('rejects unbounded or non-silent persisted capability arrays', async (capabilities) => {
    const root = mkdtempSync(path.join(tmpdir(), 'creative-studio-connections-bounds-'));
    const connectionStore = createCreativeStudioStore({ rootDir: root });
    try {
      await expect(
        connectionStore.saveConnection({
          schemaVersion: 1,
          id: 'binding_1',
          providerId: 'provider_1',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'open-sora',
          capabilities: capabilities as never,
          validatedAt: '2026-07-30T00:00:00.000Z',
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
