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
  StudioClip,
  StudioJobV2,
  StudioProjectV2,
  StudioSection,
} from '@/common/types/project/creativeStudioTypes';
import { validateStudioProjectV2 } from '@/process/services/creative-studio/service/schema2';

const timestamp = '2026-08-17T00:00:00.000Z';

const makeClip = (id: string, overrides: Partial<StudioClip> = {}): StudioClip => ({
  id,
  shotPrompt: '',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 1,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  ...overrides,
});

const makeSection = (id: string, clipOrder: string[] = []): StudioSection => ({
  id,
  title: '',
  storyLine: '',
  visualPrompt: '',
  clipOrder,
});

const makeAsset = (id: string, clipId: string | null = 'clip_1'): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  clipId,
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: `${id}.png` },
  byteSize: 1,
  sha256: 'a'.repeat(64),
  createdAt: timestamp,
});

const makeJob = (id: string, clipId = 'clip_1'): StudioJobV2 => ({
  id,
  projectId: 'project_1',
  clipId,
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
  sectionOrder: ['section_1'],
  sections: { section_1: makeSection('section_1', ['clip_1']) },
  clips: { clip_1: makeClip('clip_1') },
  shelf: [],
  cuts: {},
  activeCutId: null,
  assets: {},
  jobs: {},
  routing: { image: null, video: null },
  createdAt: timestamp,
  updatedAt: timestamp,
});

const makePopulatedProject = (): StudioProjectV2 => {
  const project = makeValidProject();
  project.clips.clip_1 = makeClip('clip_1', {
    referenceAssetId: 'reference_1',
    selectedAssetId: 'asset_1',
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

const addClips = (project: StudioProjectV2, sectionId: string, count: number, offset = 0): void => {
  const section = project.sections[sectionId]!;
  for (let index = 0; index < count; index += 1) {
    const clipId = `clip_${offset + index + 1}`;
    section.clipOrder.push(clipId);
    project.clips[clipId] = makeClip(clipId);
  }
};

describe('validateStudioProjectV2 exact schema', () => {
  it('accepts a valid schema-2 project', () => {
    expect(validateStudioProjectV2(makeValidProject())).toBe(true);
  });

  it('accepts valid asset, job, reference, cut, and project-level Cast ownership', () => {
    expect(validateStudioProjectV2(makePopulatedProject())).toBe(true);
  });

  it.each([
    ['project', (project: StudioProjectV2) => ({ ...project, unexpected: true })],
    [
      'section',
      (project: StudioProjectV2) => ({
        ...project,
        sections: { section_1: { ...project.sections.section_1, unexpected: true } },
      }),
    ],
    [
      'clip',
      (project: StudioProjectV2) => ({
        ...project,
        clips: { clip_1: { ...project.clips.clip_1, unexpected: true } },
      }),
    ],
    [
      'shelf item',
      (project: StudioProjectV2) => ({
        ...project,
        sectionOrder: [],
        shelf: [{ kind: 'section', sectionId: 'section_1', unexpected: true }],
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

  it('rejects a clip owned by two sections', () => {
    const project = makeValidProject();
    project.sectionOrder.push('section_2');
    project.sections.section_2 = makeSection('section_2', ['clip_1']);

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a clip with no owning section', () => {
    const project = makeValidProject();
    project.clips.clip_2 = makeClip('clip_2');

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects an asset missing its clip reverse link', () => {
    const project = makeValidProject();
    project.assets.asset_1 = makeAsset('asset_1');

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a missing asset named by a clip', () => {
    const project = makeValidProject();
    project.clips.clip_1!.assetIds = ['missing_asset'];

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a job missing its clip reverse link', () => {
    const project = makeValidProject();
    project.jobs.job_1 = makeJob('job_1');

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a missing job named by a clip', () => {
    const project = makeValidProject();
    project.clips.clip_1!.jobIds = ['missing_job'];

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a selected take owned by another clip', () => {
    const project = makeValidProject();
    project.sectionOrder.push('section_2');
    project.sections.section_2 = makeSection('section_2', ['clip_2']);
    project.clips.clip_2 = makeClip('clip_2', { assetIds: ['asset_1'] });
    project.assets.asset_1 = makeAsset('asset_1', 'clip_2');
    project.clips.clip_1!.selectedAssetId = 'asset_1';

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a reference owned by another clip', () => {
    const project = makeValidProject();
    project.sectionOrder.push('section_2');
    project.sections.section_2 = makeSection('section_2', ['clip_2']);
    project.clips.clip_2 = makeClip('clip_2', { assetIds: ['reference_1'] });
    project.assets.reference_1 = {
      ...makeAsset('reference_1', 'clip_2'),
      managedAsset: { collection: 'imports', fileName: 'reference_1.png' },
    };
    project.clips.clip_1!.referenceAssetId = 'reference_1';

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a job output owned by another clip', () => {
    const project = makeValidProject();
    project.sectionOrder.push('section_2');
    project.sections.section_2 = makeSection('section_2', ['clip_2']);
    project.clips.clip_1!.jobIds = ['job_1'];
    project.jobs.job_1 = makeJob('job_1');
    project.clips.clip_2 = makeClip('clip_2', { assetIds: ['asset_1'] });
    project.assets.asset_1 = makeAsset('asset_1', 'clip_2');
    project.jobs.job_1!.outputAssetIds = ['asset_1'];

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects retry lineage across clips', () => {
    const project = makeValidProject();
    project.sectionOrder.push('section_2');
    project.sections.section_2 = makeSection('section_2', ['clip_2']);
    project.clips.clip_1!.jobIds = ['job_1'];
    project.jobs.job_1 = { ...makeJob('job_1'), status: 'failed', error: { code: 'timeout', messageKey: 'timeout' } };
    project.clips.clip_2 = makeClip('clip_2', { jobIds: ['job_2'] });
    project.jobs.job_2 = {
      ...makeJob('job_2', 'clip_2'),
      retryOfJobId: 'job_1',
      retryReason: 'provider_failure',
    };

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a cut that names an orphan clip', () => {
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

  it('rejects a section present in both active order and shelf', () => {
    const project = makeValidProject();
    project.shelf = [{ kind: 'section', sectionId: 'section_1' }];

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it.each([
    ['unknown section', { kind: 'section', sectionId: 'missing_section' }],
    ['unknown asset', { kind: 'asset', assetId: 'missing_asset' }],
  ] as const)('rejects a shelf alias for an %s', (_label, shelfItem) => {
    const project = makeValidProject();
    project.shelf = [shelfItem];

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a shelf alias for the selected take', () => {
    const project = makeValidProject();
    project.assets.asset_1 = makeAsset('asset_1');
    project.clips.clip_1!.assetIds = ['asset_1'];
    project.clips.clip_1!.selectedAssetId = 'asset_1';
    project.shelf = [{ kind: 'asset', assetId: 'asset_1' }];

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects duplicate shelf identities', () => {
    const project = makeValidProject();
    project.assets.asset_1 = makeAsset('asset_1');
    project.clips.clip_1!.assetIds = ['asset_1'];
    project.shelf = [
      { kind: 'asset', assetId: 'asset_1' },
      { kind: 'asset', assetId: 'asset_1' },
    ];

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it.each(['imports', 'thumbnails', 'references'] as const)('rejects a shelf alias for a %s asset', (collection) => {
    const project = makeValidProject();
    project.assets.asset_1 = {
      ...makeAsset('asset_1'),
      managedAsset: { collection, fileName: 'asset_1.png' },
    };
    project.clips.clip_1!.assetIds = ['asset_1'];
    project.shelf = [{ kind: 'asset', assetId: 'asset_1' }];

    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('rejects a shelf alias for a take selected by a cut', () => {
    const project = makeValidProject();
    project.assets.asset_1 = makeAsset('asset_1');
    project.clips.clip_1!.assetIds = ['asset_1'];
    project.shelf = [{ kind: 'asset', assetId: 'asset_1' }];
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
  it('accepts exactly 24 sections and rejects 25', () => {
    const project = makeValidProject();
    project.sectionOrder = [];
    project.sections = {};
    project.clips = {};
    for (let index = 1; index <= 24; index += 1) {
      const sectionId = `section_${index}`;
      project.sectionOrder.push(sectionId);
      project.sections[sectionId] = makeSection(sectionId);
    }
    expect(validateStudioProjectV2(project)).toBe(true);

    project.sectionOrder.push('section_25');
    project.sections.section_25 = makeSection('section_25');
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts exactly 8 clips in one section and rejects 9', () => {
    const project = makeValidProject();
    project.sections.section_1!.clipOrder = [];
    project.clips = {};
    addClips(project, 'section_1', 8);
    expect(validateStudioProjectV2(project)).toBe(true);

    addClips(project, 'section_1', 1, 8);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts exactly 96 clips in a project and rejects 97', () => {
    const project = makeValidProject();
    project.sectionOrder = [];
    project.sections = {};
    project.clips = {};
    for (let sectionIndex = 0; sectionIndex < 12; sectionIndex += 1) {
      const sectionId = `section_${sectionIndex + 1}`;
      project.sectionOrder.push(sectionId);
      project.sections[sectionId] = makeSection(sectionId);
      addClips(project, sectionId, 8, sectionIndex * 8);
    }
    expect(validateStudioProjectV2(project)).toBe(true);

    project.sectionOrder.push('section_13');
    project.sections.section_13 = makeSection('section_13');
    addClips(project, 'section_13', 1, 96);
    expect(validateStudioProjectV2(project)).toBe(false);
  });

  it('accepts exactly 120 shelf items and rejects 121', () => {
    const project = makeValidProject();
    for (let index = 2; index <= 24; index += 1) {
      const sectionId = `section_${index}`;
      project.sections[sectionId] = makeSection(sectionId);
      project.shelf.push({ kind: 'section', sectionId });
    }
    for (let index = 1; index <= 98; index += 1) {
      const assetId = `asset_${index}`;
      project.assets[assetId] = makeAsset(assetId);
      project.clips.clip_1!.assetIds.push(assetId);
      project.shelf.push({ kind: 'asset', assetId });
    }
    expect(project.shelf).toHaveLength(121);
    expect(validateStudioProjectV2({ ...project, shelf: project.shelf.slice(0, 120) })).toBe(true);
    expect(validateStudioProjectV2(project)).toBe(false);
  });
});

describe('validateStudioProjectV2 clip duration boundaries', () => {
  it.each([
    ['video', 4],
    ['video', 15],
    ['image', 1],
    ['image', 60],
  ] as const)('accepts %s duration %i seconds', (mediaKind, durationSeconds) => {
    const project = makeValidProject();
    project.clips.clip_1 = makeClip('clip_1', { mediaKind, durationSeconds });

    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it.each([
    ['video', 3],
    ['video', 16],
    ['image', 0],
    ['image', 61],
  ] as const)('rejects %s duration %i seconds', (mediaKind, durationSeconds) => {
    const project = makeValidProject();
    project.clips.clip_1 = makeClip('clip_1', { mediaKind, durationSeconds });

    expect(validateStudioProjectV2(project)).toBe(false);
  });
});
