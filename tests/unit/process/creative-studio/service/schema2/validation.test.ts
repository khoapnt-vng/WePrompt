/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type {
  StudioAssetV2,
  StudioShot,
  StudioJobV2,
  StudioProjectV2,
  StudioBeat,
} from '@/common/types/project/creativeStudioTypes';
import {
  createEmptyStudioProjectV2,
  validateStudioProjectV2,
} from '@/process/services/creative-studio/service/schema2';

const timestamp = '2026-08-17T00:00:00.000Z';

const makeShot = (id: string, overrides: Partial<StudioShot> = {}): StudioShot => ({
  id,
  line: '',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 1,
  referenceAssetId: null,
  selectedTakeId: null,
  assetIds: [],
  jobIds: [],
  ...overrides,
});

const makeBeat = (id: string, shotOrder: string[] = []): StudioBeat => ({
  id,
  title: '',
  action: '',
  look: '',
  shotOrder,
});

const makeAsset = (id: string, shotId: string | null = 'clip_1'): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: `${id}.png` },
  byteSize: 1,
  sha256: 'a'.repeat(64),
  createdAt: timestamp,
});

const makeJob = (id: string, shotId = 'clip_1'): StudioJobV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  status: 'queued_local',
  provider: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'image-model' },
  idempotencyKey: `idem_${id}`,
  providerJobId: null,
  cancellationPolicy: 'none',
  outputAssetIds: [],
  error: null,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const ownRecord = <T>(entries: Array<readonly [string, T]>): Record<string, T> =>
  Object.fromEntries(entries) as Record<string, T>;

const sparseArray = <T>(length: number): T[] => {
  const value: T[] = [];
  value.length = length;
  return value;
};

const recordWithInheritedValue = <T>(record: Record<string, T>, id: string, value: T): Record<string, T> =>
  Object.assign(Object.create(ownRecord([[id, value]]) as object) as Record<string, T>, record);

const makeValidProject = (): StudioProjectV2 => ({
  schemaVersion: 2,
  revision: 1,
  id: 'project_1',
  name: 'Project One',
  brief: '',
  rules: [],
  ruleListUndo: null,
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '1080p',
  beatOrder: ['section_1'],
  beats: { section_1: makeBeat('section_1', ['clip_1']) },
  shots: { clip_1: makeShot('clip_1') },
  bin: [],
  cuts: {},
  activeCutId: null,
  assets: {},
  jobs: {},
  routing: { image: null, video: null },
  createdAt: timestamp,
  updatedAt: timestamp,
});

const makeEmptyProject = (): StudioProjectV2 =>
  createEmptyStudioProjectV2(
    {
      name: 'Project One',
      brief: '',
      aspectRatio: '16:9',
      targetDurationSeconds: 30,
      resolution: '1080p',
    },
    'project_1',
    timestamp
  );

const makePopulatedProject = (): StudioProjectV2 => {
  const project = makeValidProject();
  project.shots.clip_1 = makeShot('clip_1', {
    referenceAssetId: 'reference_1',
    selectedTakeId: 'asset_1',
    assetIds: ['reference_1', 'asset_1', 'thumbnail_1'],
    jobIds: ['job_1'],
  });
  project.assets.reference_1 = {
    ...makeAsset('reference_1'),
    managedAsset: { collection: 'imports', fileName: 'reference_1.png' },
  };
  project.assets.asset_1 = makeAsset('asset_1');
  project.assets.thumbnail_1 = {
    ...makeAsset('thumbnail_1'),
    managedAsset: { collection: 'thumbnails', fileName: 'thumbnail_1.png' },
  };
  project.assets.cast_1 = {
    ...makeAsset('cast_1', null),
    managedAsset: { collection: 'imports', fileName: 'cast_1.png' },
    briefReferenceRole: 'cast',
    briefReferenceLabel: 'Lead',
  };
  project.jobs.job_1 = {
    ...makeJob('job_1'),
    status: 'succeeded',
    providerJobId: 'remote_1',
    remoteStartedAt: timestamp,
    outputAssetIds: ['asset_1', 'thumbnail_1'],
  };
  project.cuts.cut_1 = {
    id: 'cut_1',
    name: 'Cut One',
    orderMode: 'storyboard',
    clipOrder: ['cut_clip_1'],
    clips: {
      cut_clip_1: {
        id: 'cut_clip_1',
        clipId: 'clip_1',
        assetId: 'asset_1',
        sourceInSeconds: null,
        sourceOutSeconds: null,
        crop: null,
        filters: [],
      },
    },
  };
  project.activeCutId = 'cut_1';
  return project;
};

const addShots = (project: StudioProjectV2, beatId: string, count: number, offset = 0): void => {
  const beat = project.beats[beatId]!;
  for (let index = 0; index < count; index += 1) {
    const shotId = `clip_${offset + index + 1}`;
    beat.shotOrder.push(shotId);
    project.shots[shotId] = makeShot(shotId);
  }
};

const addBinTakeAliases = (project: StudioProjectV2, count: number, offset = 0): void => {
  for (let index = 0; index < count; index += 1) {
    const assetId = `asset_${offset + index + 1}`;
    project.assets[assetId] = makeAsset(assetId);
    project.shots.clip_1!.assetIds.push(assetId);
    project.bin.push({ kind: 'take', assetId });
  }
};

const makeRetryChainProject = (count: number): StudioProjectV2 => {
  const project = makeValidProject();
  const jobIds = Array.from({ length: count }, (_, index) => `job_${index}`);
  project.shots.clip_1!.jobIds = jobIds;
  project.jobs = ownRecord(
    jobIds
      .map(
        (jobId, index) =>
          [
            jobId,
            {
              ...makeJob(jobId),
              status: 'failed',
              error: { code: 'timeout', messageKey: 'timeout' },
              retryOfJobId: index === 0 ? null : jobIds[index - 1]!,
              retryReason: index === 0 ? null : 'provider_failure',
            },
          ] as const
      )
      .toReversed()
  );
  return project;
};

const makeOwnPrototypeKeyProject = (id: string): StudioProjectV2 => {
  const project = makeValidProject();
  const shot = makeShot(id, { selectedTakeId: id, assetIds: [id], jobIds: [id] });
  const asset = makeAsset(id, id);
  const job = makeJob(id, id);
  project.beatOrder = [id];
  project.beats = ownRecord([[id, makeBeat(id, [id])]]);
  project.shots = ownRecord([[id, shot]]);
  project.assets = ownRecord([[id, asset]]);
  project.jobs = ownRecord([[id, job]]);
  project.cuts = ownRecord([
    [
      id,
      {
        id,
        name: 'Own prototype key cut',
        orderMode: 'storyboard',
        clipOrder: [id],
        clips: ownRecord([
          [
            id,
            {
              id,
              clipId: id,
              assetId: id,
              sourceInSeconds: null,
              sourceOutSeconds: null,
              crop: null,
              filters: [],
            },
          ],
        ]),
      },
    ],
  ]);
  project.activeCutId = id;
  return project;
};

describe('validateStudioProjectV2 exact schema', () => {
  it('accepts a valid schema-2 project', () => {
    expect(validateStudioProjectV2(makeValidProject())).toBe(true);
  });

  it('rejects a throwing schema-version accessor without invoking it', () => {
    const project = makeValidProject();
    let getterCalls = 0;
    Object.defineProperty(project, 'schemaVersion', {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('schemaVersion getter must not run');
      },
    });

    const result = validateStudioProjectV2(project);

    expect({ getterCalls, result }).toEqual({ getterCalls: 0, result: false });
  });

  it('rejects a throwing nested record accessor without invoking it', () => {
    const project = makeValidProject();
    let getterCalls = 0;
    Object.defineProperty(project.beats, 'section_1', {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('beat getter must not run');
      },
    });

    const result = validateStudioProjectV2(project);

    expect({ getterCalls, result }).toEqual({ getterCalls: 0, result: false });
  });

  it('rejects a throwing nested array accessor without invoking it', () => {
    const project = makeValidProject();
    let getterCalls = 0;
    Object.defineProperty(project.beatOrder, 0, {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('beat-order getter must not run');
      },
    });

    const result = validateStudioProjectV2(project);

    expect({ getterCalls, result }).toEqual({ getterCalls: 0, result: false });
  });

  it('rejects a revoked project proxy without throwing', () => {
    const { proxy, revoke } = Proxy.revocable(makeValidProject(), {});
    revoke();

    expect(validateStudioProjectV2(proxy)).toBe(false);
  });

  it('rejects a project proxy with a throwing get trap without invoking it', () => {
    let getTrapCalls = 0;
    const project = new Proxy(makeValidProject(), {
      get: () => {
        getTrapCalls += 1;
        throw new Error('get trap must not run');
      },
    });

    const result = validateStudioProjectV2(project);

    expect({ getTrapCalls, result }).toEqual({ getTrapCalls: 0, result: false });
  });

  it('rejects a project proxy that lies about schemaVersion without invoking its get trap', () => {
    let getTrapCalls = 0;
    const project = new Proxy(makeValidProject(), {
      get: (target, property, receiver) => {
        getTrapCalls += 1;
        return property === 'schemaVersion' ? 1 : Reflect.get(target, property, receiver);
      },
    });

    const result = validateStudioProjectV2(project);

    expect({ getTrapCalls, result }).toEqual({ getTrapCalls: 0, result: false });
  });

  it('rejects a nested record proxy whose own-key trap throws', () => {
    const project = makeValidProject();
    project.beats = new Proxy(project.beats, {
      ownKeys: () => {
        throw new Error('ownKeys failed');
      },
    });

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts valid values stored in read-only own data descriptors', () => {
    const project = makeValidProject();
    Object.defineProperty(project, 'schemaVersion', {
      configurable: false,
      enumerable: true,
      value: 2,
      writable: false,
    });

    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('rejects a non-enumerable persisted field that JSON serialization would omit', () => {
    const project = makeValidProject();
    Object.defineProperty(project, 'name', {
      configurable: true,
      enumerable: false,
      value: project.name,
      writable: true,
    });

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects an own non-enumerable serialization hook without invoking it', () => {
    const project = makeValidProject();
    let toJsonCalls = 0;
    Object.defineProperty(project.routing, 'toJSON', {
      configurable: true,
      enumerable: false,
      value() {
        toJsonCalls += 1;
        return { image: 'invalid-route', video: null };
      },
    });

    const result = validateStudioProjectV2(project);

    expect({ result, toJsonCalls }).toEqual({ result: false, toJsonCalls: 0 });
  });

  it('rejects an inherited optional field on an otherwise valid factory project', () => {
    const project = makeEmptyProject();
    delete (project as Partial<StudioProjectV2>).briefConversationId;
    Object.setPrototypeOf(project, { briefConversationId: '../../malicious-conversation' });

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects an inherited optional-field getter without invoking it', () => {
    const project = makeEmptyProject();
    let getterCalls = 0;
    const prototype = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(prototype, 'briefConversationId', {
      get() {
        getterCalls += 1;
        throw new Error('briefConversationId getter must not run');
      },
      enumerable: true,
    });
    delete (project as Partial<StudioProjectV2>).briefConversationId;
    Object.setPrototypeOf(project, prototype);

    const result = validateStudioProjectV2(project);

    expect({ getterCalls, result }).toEqual({ getterCalls: 0, result: false });
  });

  it.each([
    ['record collection', (project: StudioProjectV2) => Object.setPrototypeOf(project.beats, {})],
    ['record value', (project: StudioProjectV2) => Object.setPrototypeOf(project.beats.section_1!, {})],
    [
      'array value',
      (project: StudioProjectV2) => {
        project.rules = [
          {
            id: 'rule_1',
            scope: 'project',
            text: 'Keep the subject centered',
            predicate: null,
            createdAt: timestamp,
          },
        ];
        Object.setPrototypeOf(project.rules[0]!, {});
      },
    ],
    ['routing record', (project: StudioProjectV2) => Object.setPrototypeOf(project.routing, {})],
  ])('rejects a nonstandard prototype on a nested %s', (_label, mutate) => {
    const project = makeValidProject();
    mutate(project);

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts valid null-prototype records throughout the captured graph', () => {
    const project = makeValidProject();
    Object.setPrototypeOf(project, null);
    Object.setPrototypeOf(project.beats, null);
    Object.setPrototypeOf(project.beats.section_1!, null);
    Object.setPrototypeOf(project.shots, null);
    Object.setPrototypeOf(project.shots.clip_1!, null);
    Object.setPrototypeOf(project.routing, null);

    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('accepts valid asset, job, reference, cut, and project-level Cast ownership', () => {
    expect(validateStudioProjectV2(makePopulatedProject())).toBe(true);
  });

  it('accepts an opaque 512-character provider job ID', () => {
    const project = makeValidProject();
    project.shots.clip_1!.jobIds = ['job_1'];
    project.jobs.job_1 = {
      ...makeJob('job_1'),
      status: 'queued_remote',
      providerJobId: 'a'.repeat(512),
      remoteStartedAt: timestamp,
    };

    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it.each([
    'https://provider.example/jobs/remote_1',
    '../remote_1',
    'remote_1?token=secret',
    'remote_1#fragment',
    'remote job',
    'remote\njob',
    'a'.repeat(513),
  ])('rejects unsafe provider job ID %j', (providerJobId) => {
    const project = makeValidProject();
    project.shots.clip_1!.jobIds = ['job_1'];
    project.jobs.job_1 = {
      ...makeJob('job_1'),
      status: 'queued_remote',
      providerJobId,
      remoteStartedAt: timestamp,
    };

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it.each(['constructor', 'toString', '__proto__'])('accepts valid own record entries named %s', (id) => {
    expect(validateStudioProjectV2(makeOwnPrototypeKeyProject(id))).toBe(true);
  });

  it.each([
    [
      'asset owner shot',
      (project: StudioProjectV2, id: string) => {
        project.assets.asset_1 = makeAsset('asset_1', id);
      },
    ],
    [
      'job owner shot',
      (project: StudioProjectV2, id: string) => {
        project.jobs.job_1 = makeJob('job_1', id);
      },
    ],
    [
      'selected take',
      (project: StudioProjectV2, id: string) => {
        project.shots.clip_1!.selectedTakeId = id;
      },
    ],
    [
      'reference asset',
      (project: StudioProjectV2, id: string) => {
        project.shots.clip_1!.referenceAssetId = id;
      },
    ],
    [
      'shot asset reverse link',
      (project: StudioProjectV2, id: string) => {
        project.shots.clip_1!.assetIds = [id];
      },
    ],
    [
      'shot job reverse link',
      (project: StudioProjectV2, id: string) => {
        project.shots.clip_1!.jobIds = [id];
      },
    ],
    [
      'Bin take',
      (project: StudioProjectV2, id: string) => {
        project.bin = [{ kind: 'take', assetId: id }];
      },
    ],
    [
      'cut clip',
      (project: StudioProjectV2, id: string) => {
        const populated = makePopulatedProject();
        Object.assign(project, populated);
        project.cuts.cut_1!.clips.cut_clip_1!.clipId = id;
      },
    ],
    [
      'cut asset',
      (project: StudioProjectV2, id: string) => {
        const populated = makePopulatedProject();
        Object.assign(project, populated);
        project.cuts.cut_1!.clips.cut_clip_1!.assetId = id;
      },
    ],
    [
      'asset provenance source',
      (project: StudioProjectV2, id: string) => {
        project.shots.clip_1!.assetIds = ['asset_1'];
        project.assets.asset_1 = {
          ...makeAsset('asset_1'),
          managedAsset: { collection: 'references', fileName: 'asset_1.png' },
          sourceLook: 'Reference',
          sourceReferenceAssetIds: [id],
          sourceAspectRatio: '16:9',
          sourceResolution: '1080p',
        };
      },
    ],
    [
      'job output asset',
      (project: StudioProjectV2, id: string) => {
        project.shots.clip_1!.jobIds = ['job_1'];
        project.jobs.job_1 = { ...makeJob('job_1'), outputAssetIds: [id] };
      },
    ],
    [
      'job snapshot source',
      (project: StudioProjectV2, id: string) => {
        project.shots.clip_1!.jobIds = ['job_1'];
        project.jobs.job_1 = {
          ...makeJob('job_1'),
          outputRole: 'reference',
          referenceInputSnapshot: {
            sourceLook: 'Reference',
            conditioningReferenceAssetIds: [id],
            aspectRatio: '16:9',
            resolution: '1080p',
          },
        };
      },
    ],
    [
      'retry predecessor',
      (project: StudioProjectV2, id: string) => {
        project.shots.clip_1!.jobIds = [id, 'job_1'];
        project.jobs.job_1 = {
          ...makeJob('job_1'),
          retryOfJobId: id,
          retryReason: 'provider_failure',
        };
      },
    ],
  ])('rejects an inherited prototype value used as a %s', (_label, mutate) => {
    for (const id of ['constructor', 'toString', '__proto__']) {
      const project = makeValidProject();
      mutate(project, id);
      expect(validateStudioProjectV2(project)).toBe(false);
    }
  });

  it('rejects valid-looking values inherited through record prototypes', () => {
    const project = makeValidProject();
    const inheritedShot = makeShot('inherited_clip', { assetIds: ['inherited_asset'], jobIds: ['inherited_job'] });
    const inheritedAsset = makeAsset('inherited_asset', 'inherited_clip');
    const inheritedJob = makeJob('inherited_job', 'inherited_clip');
    project.shots = recordWithInheritedValue(project.shots, inheritedShot.id, inheritedShot);
    project.assets = recordWithInheritedValue(project.assets, inheritedAsset.id, inheritedAsset);
    project.jobs = recordWithInheritedValue(project.jobs, inheritedJob.id, inheritedJob);
    project.assets.asset_1 = makeAsset('asset_1', inheritedShot.id);

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects an inherited alias that resolves to an otherwise canonical own asset', () => {
    const project = makePopulatedProject();
    project.assets = recordWithInheritedValue(project.assets, 'inherited_alias', project.assets.asset_1!);
    project.shots.clip_1!.selectedTakeId = 'inherited_alias';

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it.each([
    [
      'shot job IDs',
      (project: StudioProjectV2) => {
        project.shots.clip_1!.jobIds = sparseArray<string>(1);
      },
    ],
    [
      'Bin identities',
      (project: StudioProjectV2) => {
        project.bin = sparseArray(1);
      },
    ],
    [
      'cut filters',
      (project: StudioProjectV2) => {
        Object.assign(project, makePopulatedProject());
        project.cuts.cut_1!.clips.cut_clip_1!.filters = sparseArray(1);
      },
    ],
  ])('rejects a sparse %s array without throwing', (_label, mutate) => {
    const project = makeValidProject();
    mutate(project);

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a non-enumerable own array method shadow without throwing', () => {
    const project = makeValidProject();
    Object.defineProperty(project.bin, 'every', { value: null });

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('does not invoke inherited array iteration methods', () => {
    const project = makeValidProject();
    Object.setPrototypeOf(project.beatOrder, { every: null, [Symbol.iterator]: null });

    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('rejects an inherited array serialization hook without invoking it', () => {
    const project = makeValidProject();
    let toJsonCalls = 0;
    Object.setPrototypeOf(project.beatOrder, {
      toJSON() {
        toJsonCalls += 1;
        return ['missing_section'];
      },
    });

    const result = validateStudioProjectV2(project);

    expect({ result, toJsonCalls }).toEqual({ result: false, toJsonCalls: 0 });
  });

  it('rejects a proxy in an array prototype chain without invoking its traps', () => {
    const project = makeValidProject();
    let descriptorTrapCalls = 0;
    const prototype = new Proxy(Object.create(null) as object, {
      getOwnPropertyDescriptor() {
        descriptorTrapCalls += 1;
        throw new Error('prototype descriptor trap must not run');
      },
    });
    Object.setPrototypeOf(project.beatOrder, prototype);

    const result = validateStudioProjectV2(project);

    expect({ descriptorTrapCalls, result }).toEqual({ descriptorTrapCalls: 0, result: false });
  });

  it.each([
    ['project', (project: StudioProjectV2) => ({ ...project, unexpected: true })],
    [
      'beat',
      (project: StudioProjectV2) => ({
        ...project,
        beats: { section_1: { ...project.beats.section_1, unexpected: true } },
      }),
    ],
    [
      'shot',
      (project: StudioProjectV2) => ({
        ...project,
        shots: { clip_1: { ...project.shots.clip_1, unexpected: true } },
      }),
    ],
    [
      'Bin item',
      (project: StudioProjectV2) => ({
        ...project,
        beatOrder: [],
        bin: [{ kind: 'beat', beatId: 'section_1', unexpected: true }],
      }),
    ],
  ])('rejects unknown keys on a %s', (_label, mutate) => {
    expect(validateStudioProjectV2(mutate(makeValidProject()))).toBe(false);
  });

  it.each([
    [
      'asset',
      (project: StudioProjectV2) => ({
        ...project,
        assets: { ...project.assets, asset_1: { ...project.assets.asset_1, unexpected: true } },
      }),
    ],
    [
      'job',
      (project: StudioProjectV2) => ({
        ...project,
        jobs: { ...project.jobs, job_1: { ...project.jobs.job_1, unexpected: true } },
      }),
    ],
    [
      'cut clip',
      (project: StudioProjectV2) => ({
        ...project,
        cuts: {
          cut_1: {
            ...project.cuts.cut_1,
            clips: {
              cut_clip_1: { ...project.cuts.cut_1!.clips.cut_clip_1, unexpected: true },
            },
          },
        },
      }),
    ],
  ])('rejects unknown keys on an operational %s', (_label, mutate) => {
    expect(validateStudioProjectV2(mutate(makePopulatedProject()))).toBe(false);
  });

  it('rejects a shot owned by two beats', () => {
    const project = makeValidProject();
    project.beatOrder.push('section_2');
    project.beats.section_2 = makeBeat('section_2', ['clip_1']);

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a shot with no owning beat', () => {
    const project = makeValidProject();
    project.shots.clip_2 = makeShot('clip_2');

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects an asset missing its shot reverse link', () => {
    const project = makeValidProject();
    project.assets.asset_1 = makeAsset('asset_1');

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a missing asset named by a shot', () => {
    const project = makeValidProject();
    project.shots.clip_1!.assetIds = ['missing_asset'];

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a job missing its shot reverse link', () => {
    const project = makeValidProject();
    project.jobs.job_1 = makeJob('job_1');

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a missing job named by a shot', () => {
    const project = makeValidProject();
    project.shots.clip_1!.jobIds = ['missing_job'];

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a selected take owned by another shot', () => {
    const project = makeValidProject();
    project.beatOrder.push('section_2');
    project.beats.section_2 = makeBeat('section_2', ['clip_2']);
    project.shots.clip_2 = makeShot('clip_2', { assetIds: ['asset_1'] });
    project.assets.asset_1 = makeAsset('asset_1', 'clip_2');
    project.shots.clip_1!.selectedTakeId = 'asset_1';

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a reference owned by another shot', () => {
    const project = makeValidProject();
    project.beatOrder.push('section_2');
    project.beats.section_2 = makeBeat('section_2', ['clip_2']);
    project.shots.clip_2 = makeShot('clip_2', { assetIds: ['reference_1'] });
    project.assets.reference_1 = {
      ...makeAsset('reference_1', 'clip_2'),
      managedAsset: { collection: 'imports', fileName: 'reference_1.png' },
    };
    project.shots.clip_1!.referenceAssetId = 'reference_1';

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a job output owned by another shot', () => {
    const project = makeValidProject();
    project.beatOrder.push('section_2');
    project.beats.section_2 = makeBeat('section_2', ['clip_2']);
    project.shots.clip_1!.jobIds = ['job_1'];
    project.jobs.job_1 = makeJob('job_1');
    project.shots.clip_2 = makeShot('clip_2', { assetIds: ['asset_1'] });
    project.assets.asset_1 = makeAsset('asset_1', 'clip_2');
    project.jobs.job_1!.outputAssetIds = ['asset_1'];

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects retry lineage across shots', () => {
    const project = makeValidProject();
    project.beatOrder.push('section_2');
    project.beats.section_2 = makeBeat('section_2', ['clip_2']);
    project.shots.clip_1!.jobIds = ['job_1'];
    project.jobs.job_1 = { ...makeJob('job_1'), status: 'failed', error: { code: 'timeout', messageKey: 'timeout' } };
    project.shots.clip_2 = makeShot('clip_2', { jobIds: ['job_2'] });
    project.jobs.job_2 = {
      ...makeJob('job_2', 'clip_2'),
      retryOfJobId: 'job_1',
      retryReason: 'provider_failure',
    };

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts an acyclic 20,000-job retry chain without recursion or quadratic lookup', () => {
    expect(validateStudioProjectV2(makeRetryChainProject(20_000))).toBe(true);
  });

  it('rejects a cycle at the end of a 20,000-job retry chain without throwing', () => {
    const project = makeRetryChainProject(20_000);
    project.jobs.job_0 = {
      ...project.jobs.job_0!,
      retryOfJobId: 'job_19999',
      retryReason: 'provider_failure',
    };

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a retry self-cycle', () => {
    const selfCycle = makeRetryChainProject(1);
    selfCycle.jobs.job_0 = {
      ...selfCycle.jobs.job_0!,
      retryOfJobId: 'job_0',
      retryReason: 'provider_failure',
    };
    expect(validateStudioProjectV2(selfCycle)).toBe(false);
  });

  it('rejects a missing retry predecessor', () => {
    const missingPredecessor = makeRetryChainProject(1);
    missingPredecessor.jobs.job_0 = {
      ...missingPredecessor.jobs.job_0!,
      retryOfJobId: 'missing_job',
      retryReason: 'provider_failure',
    };
    expect(validateStudioProjectV2(missingPredecessor)).toBe(false);
  });

  it('rejects a retry predecessor ordered after its retry', () => {
    const reversedOrder = makeRetryChainProject(2);
    reversedOrder.shots.clip_1!.jobIds = reversedOrder.shots.clip_1!.jobIds.toReversed();
    expect(validateStudioProjectV2(reversedOrder)).toBe(false);
  });

  it('accepts retry branches that converge on the same earlier failed job', () => {
    const project = makeRetryChainProject(3);
    project.jobs.job_2 = {
      ...project.jobs.job_2!,
      retryOfJobId: 'job_0',
    };

    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('rejects a cut clip that names an orphan shot', () => {
    const project = makeValidProject();
    project.cuts = {
      cut_1: {
        id: 'cut_1',
        name: 'Cut One',
        orderMode: 'storyboard',
        clipOrder: ['cut_clip_1'],
        clips: {
          cut_clip_1: {
            id: 'cut_clip_1',
            clipId: 'missing_clip',
            assetId: 'missing_asset',
            sourceInSeconds: null,
            sourceOutSeconds: null,
            crop: null,
            filters: [],
          },
        },
      },
    };
    project.activeCutId = 'cut_1';

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a beat present in both active order and Bin', () => {
    const project = makeValidProject();
    project.bin = [{ kind: 'beat', beatId: 'section_1' }];

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it.each([
    ['unknown beat', { kind: 'beat', beatId: 'missing_section' }],
    ['unknown asset', { kind: 'take', assetId: 'missing_asset' }],
  ] as const)('rejects a Bin alias for an %s', (_label, binItem) => {
    const project = makeValidProject();
    project.bin = [binItem];

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a Bin alias for the selected take', () => {
    const project = makeValidProject();
    project.assets.asset_1 = makeAsset('asset_1');
    project.shots.clip_1!.assetIds = ['asset_1'];
    project.shots.clip_1!.selectedTakeId = 'asset_1';
    project.bin = [{ kind: 'take', assetId: 'asset_1' }];

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects duplicate Bin identities', () => {
    const project = makeValidProject();
    project.assets.asset_1 = makeAsset('asset_1');
    project.shots.clip_1!.assetIds = ['asset_1'];
    project.bin = [
      { kind: 'take', assetId: 'asset_1' },
      { kind: 'take', assetId: 'asset_1' },
    ];

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it.each(['imports', 'thumbnails', 'references'] as const)('rejects a Bin alias for a %s asset', (collection) => {
    const project = makeValidProject();
    project.assets.asset_1 = {
      ...makeAsset('asset_1'),
      managedAsset: { collection, fileName: 'asset_1.png' },
    };
    project.shots.clip_1!.assetIds = ['asset_1'];
    project.bin = [{ kind: 'take', assetId: 'asset_1' }];

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a Bin alias for a take selected by a cut', () => {
    const project = makeValidProject();
    project.assets.asset_1 = makeAsset('asset_1');
    project.shots.clip_1!.assetIds = ['asset_1'];
    project.bin = [{ kind: 'take', assetId: 'asset_1' }];
    project.cuts.cut_1 = {
      id: 'cut_1',
      name: 'Cut One',
      orderMode: 'storyboard',
      clipOrder: ['cut_clip_1'],
      clips: {
        cut_clip_1: {
          id: 'cut_clip_1',
          clipId: 'clip_1',
          assetId: 'asset_1',
          sourceInSeconds: null,
          sourceOutSeconds: null,
          crop: null,
          filters: [],
        },
      },
    };

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a project-level asset without the Cast/Look role and label pair', () => {
    const project = makeValidProject();
    project.assets.asset_1 = {
      ...makeAsset('asset_1', null),
      managedAsset: { collection: 'imports', fileName: 'asset_1.png' },
    };

    expect(validateStudioProjectV2(project)).toBe(false);
  });
});

describe('validateStudioProjectV2 capacities', () => {
  it('accepts exactly 24 beats and rejects 25', () => {
    const project = makeValidProject();
    project.beatOrder = [];
    project.beats = {};
    project.shots = {};
    for (let index = 1; index <= 24; index += 1) {
      const beatId = `section_${index}`;
      project.beatOrder.push(beatId);
      project.beats[beatId] = makeBeat(beatId);
    }
    expect(validateStudioProjectV2(project)).toBe(true);

    project.beatOrder.push('section_25');
    project.beats.section_25 = makeBeat('section_25');
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts exactly 8 shots in one beat and rejects 9', () => {
    const project = makeValidProject();
    project.beats.section_1!.shotOrder = [];
    project.shots = {};
    addShots(project, 'section_1', 8);
    expect(validateStudioProjectV2(project)).toBe(true);

    addShots(project, 'section_1', 1, 8);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts exactly 96 shots in a project and rejects 97', () => {
    const project = makeValidProject();
    project.beatOrder = [];
    project.beats = {};
    project.shots = {};
    for (let beatIndex = 0; beatIndex < 12; beatIndex += 1) {
      const beatId = `section_${beatIndex + 1}`;
      project.beatOrder.push(beatId);
      project.beats[beatId] = makeBeat(beatId);
      addShots(project, beatId, 8, beatIndex * 8);
    }
    expect(validateStudioProjectV2(project)).toBe(true);

    project.beatOrder.push('section_13');
    project.beats.section_13 = makeBeat('section_13');
    addShots(project, 'section_13', 1, 96);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts exactly 24 parked beats and rejects 25', () => {
    const project = makeValidProject();
    project.beatOrder = [];
    project.bin.push({ kind: 'beat', beatId: 'section_1' });
    for (let index = 2; index <= 24; index += 1) {
      const beatId = `section_${index}`;
      project.beats[beatId] = makeBeat(beatId);
      project.bin.push({ kind: 'beat', beatId: beatId });
    }

    expect(project.bin).toHaveLength(24);
    expect(validateStudioProjectV2(project)).toBe(true);

    project.beats.section_25 = makeBeat('section_25');
    project.bin.push({ kind: 'beat', beatId: 'section_25' });
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts exactly 96 take aliases and rejects 97', () => {
    const project = makeValidProject();
    addBinTakeAliases(project, 96);

    expect(validateStudioProjectV2(project)).toBe(true);

    addBinTakeAliases(project, 1, 96);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts exactly 120 total Bin identities and rejects 121', () => {
    const project = makeValidProject();
    project.beatOrder = [];
    project.bin.push({ kind: 'beat', beatId: 'section_1' });
    for (let index = 2; index <= 24; index += 1) {
      const beatId = `section_${index}`;
      project.beats[beatId] = makeBeat(beatId);
      project.bin.push({ kind: 'beat', beatId: beatId });
    }
    addBinTakeAliases(project, 96);

    expect(project.bin).toHaveLength(120);
    expect(validateStudioProjectV2(project)).toBe(true);

    addBinTakeAliases(project, 1, 96);
    expect(project.bin).toHaveLength(121);
    expect(validateStudioProjectV2(project)).toBe(false);
  });
});

describe('validateStudioProjectV2 asset duration boundaries', () => {
  it('accepts Number.MAX_SAFE_INTEGER as the persisted asset duration boundary', () => {
    const project = makePopulatedProject();
    project.assets.asset_1!.durationSeconds = Number.MAX_SAFE_INTEGER;

    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('rejects an asset duration of 1e308', () => {
    const project = makePopulatedProject();
    project.assets.asset_1!.durationSeconds = 1e308;

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a cut trim beyond a safely bounded asset duration', () => {
    const project = makePopulatedProject();
    project.assets.asset_1!.durationSeconds = Number.MAX_SAFE_INTEGER;
    project.cuts.cut_1!.clips.cut_clip_1!.sourceInSeconds = 1e300;

    expect(validateStudioProjectV2(project)).toBe(false);
  });
});

describe('validateStudioProjectV2 shot duration boundaries', () => {
  it.each([
    ['video', 4],
    ['video', 15],
    ['image', 1],
    ['image', 60],
  ] as const)('accepts %s duration %i seconds', (mediaKind, durationSeconds) => {
    const project = makeValidProject();
    project.shots.clip_1 = makeShot('clip_1', { mediaKind, durationSeconds });

    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it.each([
    ['video', 3],
    ['video', 16],
    ['image', 0],
    ['image', 61],
  ] as const)('rejects %s duration %i seconds', (mediaKind, durationSeconds) => {
    const project = makeValidProject();
    project.shots.clip_1 = makeShot('clip_1', { mediaKind, durationSeconds });

    expect(validateStudioProjectV2(project)).toBe(false);
  });
});
