/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type { StudioPiecePhotoSettingsV3 } from '@/common/types/project/creativeStudioTypes';
import { createEmptyStudioProjectV3 } from '@/process/services/creative-studio/service/schema2/factories';
import {
  createStudioAutomaticReferenceRetryJobId,
  createStudioAuthoringFingerprintV3,
  createStudioPieceQuotedGenerationIdV3,
  createStudioQuotedGenerationId,
  studioGenerationTargetKey,
  studioPieceGenerationTargetKeyV3,
} from '@/process/services/creative-studio/service/schema2/generation/submission/v3';

const makePersistedPieceJob = (
  jobId: string,
  pieceId: string,
  retryOfJobId: string | null = null,
  retryReason: 'provider_failure' | 'submission_unknown' | 'variation_grid' | 'cancelled' | null = null,
  words = 'Retry exactly.',
  settings: StudioPiecePhotoSettingsV3 = { aspectRatio: '1:1', resolution: '720p' }
) => ({
  id: jobId,
  projectId: 'project_1',
  target: { kind: 'piece' as const, pieceId },
  purpose: 'piece_image' as const,
  retryOfJobId,
  retryReason,
  composition: {
    inputs: {
      schemaVersion: 3 as const,
      projectRevisionAtPreparation: 1,
      authoringRevision: 1,
      authoringFingerprintVersion: 2 as const,
      authoringFingerprint: 'a'.repeat(64),
      brief: '',
      rules: [],
      source: { kind: 'piece' as const, pieceId, words, settings: { ...settings } },
      purpose: 'piece_image' as const,
      conditioningInputs: [] as [],
      route: { providerId: 'provider_1', adapterId: 'weprompt-image-v1' as const, model: 'image-model' },
      instructionProfile: 'weprompt-image-v1.piece-image.v2',
    },
    prompt: `PHOTO REQUEST\n${words}`,
  },
});

describe('createStudioQuotedGenerationId', () => {
  it('matches the frozen quote-item vector', () => {
    expect(
      createStudioQuotedGenerationId({
        projectId: 'project_1',
        projectRevision: 7,
        target: { kind: 'shot', shotId: 'shot_1' },
        purpose: 'video_take',
      })
    ).toBe('item_4ce18f1fe50f45c89e006a4ea5159289a83e10aae0441c03dc6d0e159a1f74de');
  });

  it('keeps sibling quote options on the same deterministic item identity', () => {
    const input = {
      projectId: 'project_1',
      projectRevision: 7,
      target: { kind: 'shot', shotId: 'shot_1' },
      purpose: 'seed_still',
    } as const;

    expect(createStudioQuotedGenerationId(input)).toBe(createStudioQuotedGenerationId({ ...input }));
  });

  it('gives a Board item its own frozen purpose identity', () => {
    expect(
      createStudioQuotedGenerationId({
        projectId: 'project_1',
        projectRevision: 7,
        target: { kind: 'shot', shotId: 'shot_1' },
        purpose: 'board_still',
      })
    ).toBe('item_3591305b656e0aabcac0ed7ed1938a20a4ed148c43c8885303dfa45f3aac9fe7');
  });

  it('keeps two semantic references in separate item namespaces', () => {
    const base = {
      projectId: 'project_1',
      projectRevision: 7,
      purpose: 'reference_image' as const,
    };
    expect(
      createStudioQuotedGenerationId({
        ...base,
        target: { kind: 'reference', referenceId: 'reference_ming' },
      })
    ).not.toBe(
      createStudioQuotedGenerationId({
        ...base,
        target: { kind: 'reference', referenceId: 'reference_mei' },
      })
    );
  });

  it('preserves the schema-5 ID coercion behavior from before the schema-6 helpers were added', () => {
    expect(studioGenerationTargetKey({ kind: 'shot', shotId: 102 } as never)).toBe('shot:102');
    expect(
      createStudioQuotedGenerationId({
        projectId: 101,
        projectRevision: 7,
        target: { kind: 'shot', shotId: 102 },
        purpose: 'video_take',
      } as never)
    ).toBe(
      createStudioQuotedGenerationId({
        projectId: '101',
        projectRevision: 7,
        target: { kind: 'shot', shotId: '102' },
        purpose: 'video_take',
      })
    );
    expect(
      createStudioAutomaticReferenceRetryJobId({ authorizationId: 201, itemId: 202, idempotencyKey: 203 } as never)
    ).toBe(
      createStudioAutomaticReferenceRetryJobId({
        authorizationId: '201',
        itemId: '202',
        idempotencyKey: '203',
      })
    );
  });

  it.each([
    [
      {
        projectId: '../project',
        projectRevision: 7,
        target: { kind: 'shot', shotId: 'shot_1' },
        purpose: 'video_take',
      },
      TypeError,
    ],
    [
      {
        projectId: 'project_1',
        projectRevision: 0,
        target: { kind: 'shot', shotId: 'shot_1' },
        purpose: 'video_take',
      },
      RangeError,
    ],
    [
      {
        projectId: 'project_1',
        projectRevision: Number.MAX_SAFE_INTEGER + 1,
        target: { kind: 'shot', shotId: 'shot_1' },
        purpose: 'video_take',
      },
      RangeError,
    ],
    [
      {
        projectId: 'project_1',
        projectRevision: 7,
        target: { kind: 'shot', shotId: 'shot/1' },
        purpose: 'video_take',
      },
      TypeError,
    ],
    [
      {
        projectId: 'project_1',
        projectRevision: 7,
        target: { kind: 'shot', shotId: 'shot_1' },
        purpose: 'unknown',
      },
      TypeError,
    ],
  ] as const)('rejects invalid quote identity input %#', (input, errorType) => {
    expect(() => createStudioQuotedGenerationId(input as never)).toThrow(errorType);
  });
});

describe('inactive Piece identities and authoring fingerprint', () => {
  it('binds item identity to the durable reservation and quote fields so it can be rederived after restart', () => {
    const base = {
      projectId: 'project_1',
      reservationId: 'reservation_1',
      quoteId: 'quote_1',
      quoteRevision: 1,
      target: { kind: 'piece' as const, pieceId: 'piece_1' },
      purpose: 'piece_image' as const,
    };
    const first = createStudioPieceQuotedGenerationIdV3(base);
    expect(studioPieceGenerationTargetKeyV3(base.target)).toBe('piece:piece_1');
    expect(first).toBe(createStudioPieceQuotedGenerationIdV3({ ...base }));
    expect(first).not.toBe(createStudioPieceQuotedGenerationIdV3({ ...base, reservationId: 'reservation_retry_2' }));
    expect(first).not.toBe(createStudioPieceQuotedGenerationIdV3({ ...base, quoteRevision: 2 }));
    expect(() =>
      createStudioPieceQuotedGenerationIdV3({ ...base, target: { kind: 'piece', pieceId: '../piece' } })
    ).toThrow(TypeError);
    expect(() =>
      createStudioPieceQuotedGenerationIdV3({
        ...base,
        projectId: { toString: () => 'project_1' },
      } as never)
    ).toThrow(TypeError);
    for (const malformed of [
      { ...base, projectId: 101 },
      { ...base, reservationId: 102 },
      { ...base, quoteId: 103 },
      { ...base, target: { ...base.target, pieceId: 104 } },
    ]) {
      expect(() => createStudioPieceQuotedGenerationIdV3(malformed as never)).toThrow(TypeError);
    }
  });

  it('accepts a full project, ignores declared runtime fields, and rejects undeclared fields', () => {
    const project = createEmptyStudioProjectV3(
      { name: 'Runtime-independent fingerprint', brief: '' },
      'project_1',
      '2026-08-30T00:00:00.000Z'
    );
    const prepared = {
      mode: 'create' as const,
      reservedPieceId: 'piece_1',
      proposedHandle: 'piece',
      orderIndex: 0,
      words: 'A quiet photograph.',
      settings: { aspectRatio: '1:1' as const, resolution: '720p' as const },
      conditioningInputs: [],
    };
    const fingerprint = createStudioAuthoringFingerprintV3({ project, prepared });
    const runtimeOnlyChange = {
      ...project,
      revision: 2,
      updatedAt: '2026-08-30T00:01:00.000Z',
    };

    expect(createStudioAuthoringFingerprintV3({ project: runtimeOnlyChange, prepared })).toBe(fingerprint);
    expect(() =>
      createStudioAuthoringFingerprintV3({
        project: { ...project, undeclaredField: true },
        prepared,
      } as never)
    ).toThrow(TypeError);
  });

  it('invalidates prepared authority when the spend policy is set, changed, or cleared', () => {
    const project = createEmptyStudioProjectV3(
      { name: 'Policy-bound photograph', brief: '' },
      'project_1',
      '2026-08-30T00:00:00.000Z'
    );
    const prepared = {
      mode: 'create' as const,
      reservedPieceId: 'piece_1',
      proposedHandle: 'piece',
      orderIndex: 0,
      words: 'A quiet photograph.',
      settings: { aspectRatio: '1:1' as const, resolution: '720p' as const },
      conditioningInputs: [],
    };
    const withoutPolicy = createStudioAuthoringFingerprintV3({ project, prepared });
    const withPolicyProject = {
      ...project,
      spendPolicy: { currency: 'USD', maxPerBatchMinorUnits: 100 },
    };
    const withPolicy = createStudioAuthoringFingerprintV3({ project: withPolicyProject, prepared });
    const changedCap = createStudioAuthoringFingerprintV3({
      project: {
        ...withPolicyProject,
        spendPolicy: { currency: 'USD', maxPerBatchMinorUnits: 99 },
      },
      prepared,
    });
    const changedCurrency = createStudioAuthoringFingerprintV3({
      project: {
        ...withPolicyProject,
        spendPolicy: { currency: 'EUR', maxPerBatchMinorUnits: 100 },
      },
      prepared,
    });

    expect(withPolicy).not.toBe(withoutPolicy);
    expect(changedCap).not.toBe(withPolicy);
    expect(changedCurrency).not.toBe(withPolicy);
    expect(createStudioAuthoringFingerprintV3({ project: { ...withPolicyProject, spendPolicy: null }, prepared })).toBe(
      withoutPolicy
    );
  });

  it('binds ordered reference Piece and asset facts into authoring authority', () => {
    const project = createEmptyStudioProjectV3(
      { name: 'Reference-bound photograph', brief: '' },
      'project_1',
      '2026-08-30T00:00:00.000Z'
    );
    const first = {
      pieceId: 'piece_reference_1',
      assetId: 'asset_reference_1',
      sha256: '1'.repeat(64),
      mimeType: 'image/png' as const,
      byteSize: 128,
    };
    const second = {
      pieceId: 'piece_reference_2',
      assetId: 'asset_reference_2',
      sha256: '2'.repeat(64),
      mimeType: 'image/webp' as const,
      byteSize: 256,
    };
    const prepared = {
      mode: 'create' as const,
      reservedPieceId: 'piece_target',
      proposedHandle: 'target',
      orderIndex: 0,
      words: 'A reference-guided photograph.',
      settings: { aspectRatio: '1:1' as const, resolution: '720p' as const },
      conditioningInputs: [first, second],
    };
    const fingerprint = createStudioAuthoringFingerprintV3({ project, prepared });
    expect(
      createStudioAuthoringFingerprintV3({
        project,
        prepared: { ...prepared, conditioningInputs: [second, first] },
      })
    ).not.toBe(fingerprint);
    expect(
      createStudioAuthoringFingerprintV3({
        project,
        prepared: { ...prepared, conditioningInputs: [first, { ...second, sha256: '3'.repeat(64) }] },
      })
    ).not.toBe(fingerprint);
  });

  it('canonicalizes Piece-map insertion order and separates create from retry authority', () => {
    const pieceA = {
      id: 'piece_a',
      kind: 'photograph' as const,
      handle: 'ảnh_biển',
      priorHandles: ['bien'],
      currentAssetId: null,
      jobIds: ['job_a'],
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    };
    const pieceB = { ...pieceA, id: 'piece_b', handle: 'ночь', priorHandles: [], jobIds: [] };
    const project = {
      id: 'project_1',
      authoringRevision: 4,
      name: 'Unicode study',
      brief: 'One photograph.',
      rules: [],
      forgeProjectId: null,
      briefConversationId: null,
      spendPolicy: { currency: 'USD', maxPerBatchMinorUnits: 100 },
      pieceOrder: ['piece_a', 'piece_b'],
      pieces: { piece_b: pieceB, piece_a: pieceA },
      jobs: {
        job_a: makePersistedPieceJob('job_a', 'piece_a', null, null, '東京の夜景', {
          aspectRatio: '16:9',
          resolution: '1080p',
        }),
      },
    };
    const create = {
      mode: 'create' as const,
      reservedPieceId: 'piece_c',
      proposedHandle: '東京',
      orderIndex: 2,
      words: '東京の夜景',
      settings: { aspectRatio: '16:9' as const, resolution: '1080p' as const },
      conditioningInputs: [],
    };
    const first = createStudioAuthoringFingerprintV3({ project, prepared: create });
    const reordered = createStudioAuthoringFingerprintV3({
      project: { ...project, pieces: { piece_a: pieceA, piece_b: pieceB } },
      prepared: create,
    });
    const retry = createStudioAuthoringFingerprintV3({
      project,
      prepared: {
        mode: 'retry',
        existingPieceId: 'piece_a',
        sourceJobId: 'job_a',
        words: '東京の夜景',
        settings: create.settings,
        conditioningInputs: [],
      },
    });
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe('a004637e4cc13dd47db2cf3144679cb07de76954c5c4ca18c405fa971af83946');
    expect(first).toBe(reordered);
    expect(first).not.toBe(retry);
    expect(
      createStudioAuthoringFingerprintV3({
        project: { ...project, authoringRevision: 5 },
        prepared: create,
      })
    ).not.toBe(first);
    expect(
      createStudioAuthoringFingerprintV3({ project: { ...project, name: 'Changed name' }, prepared: create })
    ).not.toBe(first);
    expect(
      createStudioAuthoringFingerprintV3({
        project: { ...project, forgeProjectId: 'forge_1' },
        prepared: create,
      })
    ).not.toBe(first);
    expect(
      createStudioAuthoringFingerprintV3({
        project: {
          ...project,
          pieces: { ...project.pieces, piece_a: { ...pieceA, priorHandles: ['changed_alias'] } },
        },
        prepared: create,
      })
    ).not.toBe(first);
    expect(
      createStudioAuthoringFingerprintV3({
        project,
        prepared: { ...create, words: 'Changed request words' },
      })
    ).not.toBe(first);
    expect(
      createStudioAuthoringFingerprintV3({
        project: {
          ...project,
          pieces: {
            ...project.pieces,
            piece_a: {
              ...pieceA,
              currentAssetId: 'asset_runtime',
              jobIds: ['job_runtime'],
              updatedAt: '2026-08-30T01:00:00.000Z',
            },
          },
        },
        prepared: create,
      })
    ).toBe(first);
  });

  it('binds ordered retry topology but rejects unnormalized words and absent source jobs', () => {
    const project = {
      id: 'project_1',
      authoringRevision: 4,
      name: 'Retry',
      brief: '',
      rules: [],
      forgeProjectId: null,
      briefConversationId: null,
      spendPolicy: null,
      pieceOrder: ['piece_1'],
      pieces: {
        piece_1: {
          id: 'piece_1',
          kind: 'photograph' as const,
          handle: 'piece',
          priorHandles: [],
          currentAssetId: null,
          jobIds: ['job_1'],
          createdAt: '2026-08-30T00:00:00.000Z',
          updatedAt: '2026-08-30T00:00:00.000Z',
        },
      },
      jobs: { job_1: makePersistedPieceJob('job_1', 'piece_1', null, null, 'Exact words') },
    };
    const prepared = {
      mode: 'retry' as const,
      existingPieceId: 'piece_1',
      sourceJobId: 'job_1',
      words: 'Exact words',
      settings: { aspectRatio: '1:1' as const, resolution: '720p' as const },
      conditioningInputs: [],
    };
    const base = createStudioAuthoringFingerprintV3({ project, prepared });
    expect(base).toBe('6bd6205cc0bbb17534edd9c51c26f98e051cc10389a7e5f7df6b3bd90cf5ed75');
    const { jobs: omittedJobs, ...projectWithoutJobs } = project;
    void omittedJobs;
    expect(() =>
      createStudioAuthoringFingerprintV3({
        project: projectWithoutJobs,
        prepared,
      } as never)
    ).toThrow('persisted Piece jobs');
    expect(() =>
      createStudioAuthoringFingerprintV3({
        project: { ...project, jobs: {} },
        prepared,
      })
    ).toThrow('resolve persisted jobs');
    expect(
      createStudioAuthoringFingerprintV3({
        project: {
          ...project,
          jobs: {
            job_1: {
              ...project.jobs.job_1,
              status: 'queued',
              progress: null,
              error: null,
            },
          },
        },
        prepared,
      })
    ).toBe(base);
    expect(
      createStudioAuthoringFingerprintV3({
        project: {
          ...project,
          jobs: {
            job_1: {
              ...project.jobs.job_1,
              status: 'succeeded',
              progress: 100,
              error: null,
              outputAssetId: 'asset_runtime',
              updatedAt: '2026-08-30T01:00:00.000Z',
            },
          },
        },
        prepared,
      })
    ).toBe(base);
    expect(
      createStudioAuthoringFingerprintV3({
        project: {
          ...project,
          pieces: {
            piece_1: { ...project.pieces.piece_1, jobIds: ['job_1', 'job_2'] },
          },
          jobs: {
            ...project.jobs,
            job_2: makePersistedPieceJob('job_2', 'piece_1', 'job_1', 'provider_failure', 'Exact words'),
          },
        },
        prepared: {
          ...prepared,
          sourceJobId: 'job_2',
        },
      })
    ).not.toBe(base);
    expect(() =>
      createStudioAuthoringFingerprintV3({
        project,
        prepared: { ...prepared, words: 'Edited retry words' },
      })
    ).toThrow('exactly match');
    expect(() =>
      createStudioAuthoringFingerprintV3({
        project,
        prepared: { ...prepared, settings: { ...prepared.settings, resolution: '1080p' } },
      })
    ).toThrow('exactly match');
    expect(() =>
      createStudioAuthoringFingerprintV3({ project, prepared: { ...prepared, words: '  Exact words' } })
    ).toThrow('normalized');
    expect(() =>
      createStudioAuthoringFingerprintV3({ project, prepared: { ...prepared, sourceJobId: 'job_missing' } })
    ).toThrow('sourceJobId');
    expect(() =>
      createStudioAuthoringFingerprintV3({
        project: {
          ...project,
          jobs: { job_1: makePersistedPieceJob('job_1', 'piece_1', null, 'cancelled', 'Exact words') },
        },
        prepared,
      } as never)
    ).toThrow('topology');
    expect(() =>
      createStudioAuthoringFingerprintV3({
        project,
        prepared: { ...prepared, lineage: [] },
      } as never)
    ).toThrow('exact');
  });

  it('rejects create handles that collide with the current or retained-alias namespace', () => {
    const piece = {
      id: 'piece_1',
      kind: 'photograph' as const,
      handle: 'current_handle',
      priorHandles: ['retained_alias'],
      currentAssetId: null,
      jobIds: ['job_1'],
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    };
    const project = {
      id: 'project_1',
      authoringRevision: 2,
      name: 'Handle namespace',
      brief: '',
      rules: [],
      forgeProjectId: null,
      briefConversationId: null,
      spendPolicy: null,
      pieceOrder: [piece.id],
      pieces: { [piece.id]: piece },
    };
    const create = {
      mode: 'create' as const,
      reservedPieceId: 'piece_2',
      proposedHandle: 'fresh_handle',
      orderIndex: 1,
      words: 'A quiet photograph.',
      settings: { aspectRatio: '1:1' as const, resolution: '720p' as const },
      conditioningInputs: [],
    };

    expect(createStudioAuthoringFingerprintV3({ project, prepared: create })).toMatch(/^[a-f0-9]{64}$/);
    for (const proposedHandle of [piece.handle, ...piece.priorHandles]) {
      expect(() => createStudioAuthoringFingerprintV3({ project, prepared: { ...create, proposedHandle } })).toThrow(
        TypeError
      );
    }
  });

  it('rejects crossed modes, extra keys, proxies, accessors, and object-coerced project ids', () => {
    const project = {
      id: 'project_1',
      authoringRevision: 1,
      name: 'Exact input',
      brief: '',
      rules: [],
      forgeProjectId: null,
      briefConversationId: null,
      spendPolicy: null,
      pieceOrder: [],
      pieces: {},
    };
    const prepared = {
      mode: 'create' as const,
      reservedPieceId: 'piece_1',
      proposedHandle: 'piece',
      orderIndex: 0,
      words: 'A quiet photograph.',
      settings: { aspectRatio: '1:1' as const, resolution: '720p' as const },
      conditioningInputs: [],
    };

    expect(() =>
      createStudioAuthoringFingerprintV3({ project, prepared: { ...prepared, sourceJobId: 'job_crossed' } } as never)
    ).toThrow(TypeError);
    expect(() =>
      createStudioAuthoringFingerprintV3({ project, prepared: { ...prepared, mode: 'unknown' } } as never)
    ).toThrow(TypeError);
    expect(() => createStudioAuthoringFingerprintV3({ project, prepared: new Proxy(prepared, {}) } as never)).toThrow(
      TypeError
    );
    expect(() =>
      createStudioAuthoringFingerprintV3({
        project: { ...project, id: { toString: () => 'project_1' } },
        prepared,
      } as never)
    ).toThrow(TypeError);

    let getterRead = false;
    const accessorPrepared = { ...prepared } as Record<string, unknown>;
    Object.defineProperty(accessorPrepared, 'mode', {
      enumerable: true,
      get: () => {
        getterRead = true;
        return 'create';
      },
    });
    expect(() => createStudioAuthoringFingerprintV3({ project, prepared: accessorPrepared } as never)).toThrow(
      TypeError
    );
    expect(getterRead).toBe(false);
  });

  it('covers alternate valid rules, null-prototype records, settings, bindings, and retry reasons', () => {
    const piece = {
      id: 'piece_1',
      kind: 'photograph' as const,
      handle: '夜景',
      priorHandles: ['night'],
      currentAssetId: null,
      jobIds: ['job_1', 'job_2'],
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    };
    const project = {
      id: 'project_1',
      authoringRevision: 3,
      name: 'Exact alternatives',
      brief: 'One image.',
      rules: [
        {
          id: 'rule_1',
          scope: 'project' as const,
          text: 'Avoid real brands.',
          predicate: { kind: 'forbidden_terms' as const, terms: ['Acme'] },
          createdAt: '2026-08-30T00:00:00.000Z',
        },
        {
          id: 'rule_2',
          scope: 'project' as const,
          text: 'Keep natural light.',
          predicate: null,
          createdAt: '2026-08-30T00:00:00.000Z',
        },
      ],
      forgeProjectId: 'forge_1',
      briefConversationId: 'conversation_1',
      spendPolicy: { currency: 'USD', maxPerBatchMinorUnits: 100 },
      pieceOrder: [piece.id],
      pieces: { [piece.id]: piece },
      jobs: {
        job_1: makePersistedPieceJob('job_1', piece.id),
        job_2: makePersistedPieceJob('job_2', piece.id, 'job_1', 'provider_failure'),
      },
    };
    const nullPrototypeProject = Object.assign(Object.create(null) as typeof project, project);
    expect(
      createStudioAuthoringFingerprintV3({
        project: nullPrototypeProject,
        prepared: {
          mode: 'create',
          reservedPieceId: 'piece_2',
          proposedHandle: 'portrait',
          orderIndex: 1,
          words: 'A quiet portrait.',
          settings: { aspectRatio: '4:3', resolution: '1080p' },
          conditioningInputs: [],
        },
      })
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(
      createStudioAuthoringFingerprintV3({
        project,
        prepared: {
          mode: 'create',
          reservedPieceId: 'piece_2',
          proposedHandle: 'portrait',
          orderIndex: 1,
          words: 'A quiet portrait.',
          settings: { aspectRatio: '3:4', resolution: '720p' },
          conditioningInputs: [],
        },
      })
    ).toMatch(/^[a-f0-9]{64}$/);

    for (const retryReason of ['provider_failure', 'submission_unknown', 'variation_grid', 'cancelled'] as const) {
      expect(
        createStudioAuthoringFingerprintV3({
          project: {
            ...project,
            jobs: {
              ...project.jobs,
              job_2: makePersistedPieceJob('job_2', piece.id, 'job_1', retryReason),
            },
          },
          prepared: {
            mode: 'retry',
            existingPieceId: piece.id,
            sourceJobId: 'job_2',
            words: 'Retry exactly.',
            settings: { aspectRatio: '1:1', resolution: '720p' },
            conditioningInputs: [],
          },
        })
      ).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('covers exact project, Piece, create-arm, and retry-lineage refusal boundaries', () => {
    const piece = {
      id: 'piece_1',
      kind: 'photograph' as const,
      handle: 'piece',
      priorHandles: [] as string[],
      currentAssetId: null,
      jobIds: ['job_1'],
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    };
    const project = {
      id: 'project_1',
      authoringRevision: 2,
      name: 'Boundary matrix',
      brief: '',
      rules: [],
      forgeProjectId: null,
      briefConversationId: null,
      spendPolicy: null,
      pieceOrder: [piece.id],
      pieces: { [piece.id]: piece },
      jobs: { job_1: makePersistedPieceJob('job_1', piece.id) },
    };
    const create = {
      mode: 'create' as const,
      reservedPieceId: 'piece_2',
      proposedHandle: 'fresh_piece',
      orderIndex: 1,
      words: 'A new photograph.',
      settings: { aspectRatio: '16:9' as const, resolution: '1080p' as const },
      conditioningInputs: [],
    };
    const { name: ignoredName, ...missingName } = project;
    void ignoredName;
    const invalidProjects: unknown[] = [
      null,
      [],
      Object.assign(Object.create({ inherited: true }) as typeof project, project),
      missingName,
      { ...project, name: '' },
      { ...project, name: ' padded ' },
      { ...project, name: 'n'.repeat(257) },
      { ...project, brief: 7 },
      { ...project, brief: 'b'.repeat(16 * 1024 + 1) },
      { ...project, forgeProjectId: '../forge' },
      { ...project, briefConversationId: 7 },
      { ...project, briefConversationId: '../conversation' },
      { ...project, spendPolicy: { currency: 'usd', maxPerBatchMinorUnits: 1 } },
      { ...project, spendPolicy: { currency: 'USD', maxPerBatchMinorUnits: -1 } },
      { ...project, id: '../project' },
      { ...project, authoringRevision: 0 },
      { ...project, pieceOrder: {} },
      { ...project, pieceOrder: [piece.id, piece.id] },
      { ...project, pieceOrder: ['piece_missing'] },
      { ...project, pieces: { ...project.pieces, piece_extra: { ...piece, id: 'piece_extra' } } },
      { ...project, pieces: { [piece.id]: { ...piece, id: 'piece_other' } } },
      { ...project, pieces: { [piece.id]: { ...piece, kind: 'video' } } },
      { ...project, pieces: { [piece.id]: { ...piece, handle: 'PIECE' } } },
      { ...project, pieces: { [piece.id]: { ...piece, priorHandles: ['old', 'old'] } } },
      { ...project, pieces: { [piece.id]: { ...piece, priorHandles: [piece.handle] } } },
    ];
    for (const invalidProject of invalidProjects) {
      expect(() =>
        createStudioAuthoringFingerprintV3({ project: invalidProject, prepared: create } as never)
      ).toThrow();
    }

    const invalidCreateArms: unknown[] = [
      { ...create, reservedPieceId: '../piece' },
      { ...create, reservedPieceId: piece.id },
      { ...create, proposedHandle: 'Not Canonical' },
      { ...create, orderIndex: -1 },
      { ...create, orderIndex: 1.5 },
      { ...create, orderIndex: 2 },
      { ...create, words: ' unnormalized' },
      { ...create, settings: { ...create.settings, aspectRatio: '2:1' } },
      { ...create, settings: { ...create.settings, resolution: '4k' } },
      { ...create, extra: true },
    ];
    for (const prepared of invalidCreateArms) {
      expect(() => createStudioAuthoringFingerprintV3({ project, prepared } as never)).toThrow();
    }

    const retry = {
      mode: 'retry' as const,
      existingPieceId: piece.id,
      sourceJobId: 'job_1',
      words: 'Retry exactly.',
      settings: { aspectRatio: '1:1' as const, resolution: '720p' as const },
      conditioningInputs: [],
    };
    const invalidRetries: unknown[] = [
      { ...retry, existingPieceId: 'piece_missing' },
      { ...retry, existingPieceId: '../piece' },
      { ...retry, sourceJobId: '../job' },
      { ...retry, lineage: [] },
      { ...retry, sourceJobId: 'job_missing' },
    ];
    for (const prepared of invalidRetries) {
      expect(() => createStudioAuthoringFingerprintV3({ project, prepared } as never)).toThrow();
    }

    const twoJobProject = structuredClone(project);
    twoJobProject.pieces[piece.id]!.jobIds = ['job_1', 'job_2'];
    twoJobProject.jobs.job_2 = makePersistedPieceJob('job_2', piece.id, null, null);
    expect(() =>
      createStudioAuthoringFingerprintV3({
        project: twoJobProject,
        prepared: {
          ...retry,
          sourceJobId: 'job_2',
        },
      })
    ).toThrow('retry lineage topology is invalid');

    const itemInput = {
      projectId: 'project_1',
      reservationId: 'reservation_1',
      quoteId: 'quote_1',
      quoteRevision: 1,
      target: { kind: 'piece' as const, pieceId: 'piece_1' },
      purpose: 'piece_image' as const,
    };
    expect(() => createStudioPieceQuotedGenerationIdV3({ ...itemInput, quoteRevision: 0 })).toThrow(RangeError);
    expect(() => createStudioPieceQuotedGenerationIdV3({ ...itemInput, purpose: 'seed_still' } as never)).toThrow(
      TypeError
    );
    expect(() => studioPieceGenerationTargetKeyV3({ ...itemInput.target, extra: true } as never)).toThrow(TypeError);

    let getterCalls = 0;
    const hostileIdentity = { ...itemInput } as Record<string, unknown>;
    Object.defineProperty(hostileIdentity, 'projectId', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'project_1';
      },
    });
    expect(() => createStudioPieceQuotedGenerationIdV3(hostileIdentity as never)).toThrow(TypeError);
    expect(getterCalls).toBe(0);
  });
});
