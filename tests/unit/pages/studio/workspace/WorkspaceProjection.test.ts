// @vitest-environment jsdom

import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  StudioAssetV2,
  StudioRendererJobV2,
  StudioRendererProjectV2,
  StudioRendererChainStatusV2,
  StudioRendererWorkspaceStatusV2,
} from '@/common/types/project/creativeStudioTypes';
import { projectWorkspace, useWorkspaceDrafts } from '@/renderer/pages/studio/components/Workspace';

const makeAsset = (
  id: string,
  shotId: string | null,
  mediaKind: StudioAssetV2['mediaKind'] = 'image',
  collection: StudioAssetV2['managedAsset']['collection'] = 'assets',
  createdAt = '2026-08-19T00:00:00.000Z'
): StudioAssetV2 => ({
  id,
  projectId: 'project_1',
  shotId,
  mediaKind,
  mimeType: mediaKind === 'video' ? 'video/mp4' : 'image/png',
  managedAsset: { collection, fileName: `${id}.bin` },
  byteSize: 10,
  sha256: 'a'.repeat(64),
  ...(mediaKind === 'video' ? { durationSeconds: 4 } : {}),
  createdAt,
});

const makeJob = (id: string, shotId: string, overrides: Partial<StudioRendererJobV2> = {}): StudioRendererJobV2 =>
  ({
    id,
    projectId: 'project_1',
    shotId,
    status: 'succeeded',
    provider: { choiceId: 'route_video', providerId: 'provider_safe', model: 'model_safe' },
    outputAssetIds: [],
    outputAssetIdsByRole: { primary: null, poster: null },
    error: null,
    canCancel: false,
    canRetryDownload: false,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    purpose: 'video_take',
    generationIndex: 0,
    spendReceipt: null,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  }) as StudioRendererJobV2;

const makeShot = (id: string, line: string, chainBreak: 'none' | 'hard_cut' = 'hard_cut') => ({
  id,
  line,
  derivation: 'derived' as const,
  derivedFromActionRevision: 1,
  narration: '',
  onScreenText: '',
  durationSeconds: 4,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak,
  seedStillId: null,
  selectedTakeId: null,
  assetIds: [] as string[],
  jobIds: [] as string[],
});

const makeProject = (): StudioRendererProjectV2 =>
  ({
    schemaVersion: 2,
    revision: 3,
    id: 'project_1',
    name: 'Launch film',
    brief: 'A launch film.',
    rules: [],
    aspectRatio: '16:9',
    targetDurationSeconds: 12,
    resolution: '720p',
    beatOrder: ['beat_1', 'beat_2'],
    beats: {
      beat_1: {
        id: 'beat_1',
        title: 'Opening',
        action: 'Open',
        look: 'Bright',
        actionRevision: 1,
        targetSeconds: 8,
        shotOrder: ['shot_1', 'shot_2'],
        lineHistory: [],
      },
      beat_2: {
        id: 'beat_2',
        title: 'Close',
        action: 'Close',
        look: 'Warm',
        actionRevision: 1,
        targetSeconds: 4,
        shotOrder: ['shot_3'],
        lineHistory: [],
      },
      beat_parked: {
        id: 'beat_parked',
        title: 'Parked beat',
        action: 'Parked',
        look: 'Muted',
        actionRevision: 1,
        targetSeconds: null,
        shotOrder: ['shot_parked'],
        lineHistory: [],
      },
    },
    shots: {
      shot_1: makeShot('shot_1', 'First'),
      shot_2: makeShot('shot_2', 'Second', 'none'),
      shot_3: makeShot('shot_3', 'Third'),
      shot_parked: makeShot('shot_parked', 'Parked'),
    },
    bin: [],
    bedAssetId: null,
    matchToShotId: null,
    spendPolicy: null,
    imageRouteId: 'route_image',
    videoRouteId: 'route_video',
    assets: {},
    jobs: {},
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  }) as StudioRendererProjectV2;

const workspaceStatus = (revision = 3): StudioRendererWorkspaceStatusV2 => ({
  projectId: 'project_1',
  projectRevision: revision,
  undoTop: { entryId: 'undo_1', label: 'Edit shot', sourceRevision: 2 },
  dirtyShots: [{ shotId: 'shot_2', causes: ['continuity_stale'] }],
  cascadeProgress: [],
  parkEligibility: [],
});

const chainStatus = (revision = 3): StudioRendererChainStatusV2 => ({
  projectId: 'project_1',
  projectRevision: revision,
  conditioningFailures: [{ dependentShotId: 'shot_2', reason: 'conditioning_failed', canRetry: true }],
});

describe('projectWorkspace', () => {
  it('uses active orders only and projects Beat, Shot, and Take bin references separately', () => {
    const project = makeProject();
    const binnedTake = makeAsset('take_parked', 'shot_parked', 'video');
    project.assets[binnedTake.id] = binnedTake;
    project.shots.shot_parked!.assetIds.push(binnedTake.id);
    project.bin = [
      { kind: 'beat', beatId: 'beat_parked', reason: 'lifted' },
      { kind: 'shot', beatId: 'beat_parked', shotId: 'shot_parked', reason: 'lifted' },
      { kind: 'take', assetId: binnedTake.id, reason: 'alternate' },
    ];

    const result = projectWorkspace(project, workspaceStatus(), chainStatus());

    expect(result).toMatchObject({ workspaceStatusReady: true, chainStatusReady: true });
    expect(result.activeBeats.map((beat) => beat.id)).toEqual(['beat_1', 'beat_2']);
    expect(result.activeShotIds).toEqual(['shot_1', 'shot_2', 'shot_3']);
    expect(result.bin.beats).toMatchObject([{ id: 'beat_parked', reason: 'lifted' }]);
    expect(result.bin.shots).toMatchObject([{ id: 'shot_parked', beatId: 'beat_parked', reason: 'lifted' }]);
    expect(result.bin.takes).toEqual([
      {
        assetId: 'take_parked',
        shotId: 'shot_parked',
        beatId: 'beat_parked',
        reason: 'alternate',
        mediaKind: 'video',
      },
    ]);
  });

  it('counts eligible imported/generated image and video Takes while image-only coverage stays seed-ready', () => {
    const project = makeProject();
    const importedUpper = makeAsset('seed_Z', 'shot_1', 'image', 'imports', '2026-08-19T01:00:00.000Z');
    const importedLower = makeAsset('seed_a', 'shot_1', 'image', 'imports', '2026-08-19T01:00:00.000Z');
    const generatedImage = makeAsset('image_take', 'shot_1', 'image', 'assets', '2026-08-19T00:00:00.000Z');
    const video = makeAsset('video_take', 'shot_1', 'video', 'assets', '2026-08-19T00:00:00.000Z');
    Object.assign(project.assets, {
      [importedUpper.id]: importedUpper,
      [importedLower.id]: importedLower,
      [generatedImage.id]: generatedImage,
    });
    project.shots.shot_1!.assetIds.push(importedUpper.id, importedLower.id, generatedImage.id);

    let shot = projectWorkspace(project, null, null).activeBeats[0]!.shots[0]!;
    expect(shot).toMatchObject({
      takeCount: 3,
      coverAssetId: 'seed_a',
      displayState: 'seed_ready',
      hasEffectiveSeed: true,
    });

    project.assets[video.id] = video;
    project.shots.shot_1!.assetIds.push(video.id);
    shot = projectWorkspace(project, null, null).activeBeats[0]!.shots[0]!;
    expect(shot).toMatchObject({ takeCount: 4, displayState: 'takes_available' });
  });

  it('prefers one exact succeeded selected-video poster and rejects malformed video poison', () => {
    const project = makeProject();
    const seed = makeAsset('seed_1', 'shot_1', 'image', 'imports');
    const video = makeAsset('take_1', 'shot_1', 'video');
    const poster = makeAsset('poster_1', 'shot_1', 'image', 'thumbnails');
    const poison = makeAsset('poison_video', 'shot_2', 'video', 'imports');
    Object.assign(project.assets, { seed_1: seed, take_1: video, poster_1: poster, poison_video: poison });
    project.shots.shot_1!.seedStillId = seed.id;
    project.shots.shot_1!.selectedTakeId = video.id;
    project.shots.shot_1!.assetIds.push(seed.id, video.id, poster.id);
    project.shots.shot_1!.jobIds.push('job_1');
    project.jobs.job_1 = makeJob('job_1', 'shot_1', {
      outputAssetIds: [video.id, poster.id],
      outputAssetIdsByRole: { primary: video.id, poster: poster.id },
    });
    project.shots.shot_2!.selectedTakeId = poison.id;
    project.shots.shot_2!.assetIds.push(poison.id);

    const result = projectWorkspace(project, null, null);

    expect(result.activeBeats[0]!.shots[0]).toMatchObject({
      coverAssetId: 'poster_1',
      takeCount: 2,
      displayState: 'selected_take',
    });
    expect(result.activeBeats[0]!.shots[1]).toMatchObject({ takeCount: 0, displayState: 'draft' });
  });

  it('retains paid work from an exact shot-owned job without exposing job identity', () => {
    const project = makeProject();
    project.shots.shot_3!.jobIds.push('job_failed');
    project.jobs.job_failed = makeJob('job_failed', 'shot_3', { status: 'failed' });

    const shot = projectWorkspace(project, null, null).activeBeats[1]!.shots[0]!;

    expect(shot.retainedWork).toBe(true);
    expect(shot).not.toHaveProperty('jobId');
    expect(JSON.stringify(shot)).not.toContain('provider_safe');
  });

  it('fails closed on stale status and derives request-shape lock only from matched blockers', () => {
    const project = makeProject();
    const matched = workspaceStatus();
    matched.parkEligibility.push({
      subject: 'shot',
      action: 'park',
      beatId: 'beat_1',
      shotId: 'shot_1',
      assetId: null,
      allowed: false,
      blockers: [{ shotId: 'shot_1', code: 'bound_nonterminal_request' }],
    });

    expect(projectWorkspace(project, matched, chainStatus()).requestShapeLocked).toBe(true);
    const stale = projectWorkspace(project, workspaceStatus(2), chainStatus(2));
    expect(stale).toMatchObject({
      workspaceStatusReady: false,
      chainStatusReady: false,
      requestShapeLocked: false,
      undoTop: null,
      dirtyShots: [],
      cascadeProgress: [],
      parkEligibility: [],
      conditioningFailures: [],
    });
    expect(projectWorkspace(project, null, null)).toMatchObject({
      workspaceStatusReady: false,
      chainStatusReady: false,
    });
  });
});

describe('useWorkspaceDrafts', () => {
  const storageKey = 'aionui:creative-studio:v2:workspace-drafts:project_1';

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('preserves intentional null values and a true null base through conflict detection', async () => {
    let canonical = { target: 'asset_1' as string | null, nullableBase: null as string | null };
    const view = renderHook(() =>
      useWorkspaceDrafts({ projectId: 'project_1', projectRevision: 3, canonicalValues: canonical, activeShotIds: [] })
    );
    act(() => {
      view.result.current.setValue('target', null);
      view.result.current.setValue('nullableBase', 'draft');
    });
    expect(view.result.current.value('target')).toBeNull();
    canonical = { target: 'asset_1', nullableBase: 'changed' };
    view.rerender();
    await waitFor(() => expect(view.result.current.conflictKeys).toEqual(['nullableBase']));
    expect(view.result.current.entries.nullableBase).toEqual({ baseValue: null, value: 'draft' });
  });

  it('uses session storage across remount and keeps gate preferences out of close dirty count', async () => {
    const input = {
      projectId: 'project_1',
      projectRevision: 3,
      canonicalValues: { name: 'A', 'gate.choices': '{}' },
      activeShotIds: ['shot_1'],
    };
    const first = renderHook(() => useWorkspaceDrafts(input));
    act(() => {
      first.result.current.setValue('name', 'Draft A');
      first.result.current.setValue('gate.choices', '{"shot_1:seed_still":{"generationCount":2}}');
      first.result.current.selectShot('shot_1', 'replace');
    });
    await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).toContain('Draft A'));
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(first.result.current.dirtyCount).toBe(1);
    first.unmount();
    const second = renderHook(() => useWorkspaceDrafts(input));
    expect(second.result.current.value('name')).toBe('Draft A');
    expect(second.result.current.selection.selectedShotIds).toEqual(['shot_1']);
  });

  it('rejects stored prototype keys, deduplicates active order, and caps runtime selection', () => {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 2,
        projectId: 'project_1',
        sourceRevision: 3,
        entries: {
          __proto__: { baseValue: 'x', value: 'y' },
          constructor: { baseValue: 'x', value: 'y' },
          safe: { baseValue: 'A', value: 'B' },
        },
        selection: { selectedShotIds: ['shot_2', 'shot_1', 'shot_2'], anchorShotId: 'shot_2' },
      })
    );
    const decoded = renderHook(() =>
      useWorkspaceDrafts({
        projectId: 'project_1',
        projectRevision: 3,
        canonicalValues: { safe: 'A' },
        activeShotIds: ['shot_1', 'shot_2'],
      })
    );
    expect(Object.keys(decoded.result.current.entries)).toEqual(['safe']);
    expect(decoded.result.current.selection.selectedShotIds).toEqual(['shot_1', 'shot_2']);

    const shots = Array.from({ length: 300 }, (_, index) => `range_${index}`);
    const capped = renderHook(() =>
      useWorkspaceDrafts({ projectId: 'project_2', projectRevision: 1, canonicalValues: {}, activeShotIds: shots })
    );
    act(() => capped.result.current.selectShot(shots[0]!, 'replace'));
    act(() => capped.result.current.selectShot(shots[299]!, 'range'));
    expect(capped.result.current.selection.selectedShotIds).toHaveLength(256);
  });
});

describe('Workspace structure', () => {
  it('keeps source direct children capped and every child directory non-trivial', () => {
    const root = resolve(process.cwd(), 'packages/desktop/src/renderer/pages/studio/components/Workspace');
    const children = readdirSync(root);
    expect(children.length).toBeLessThanOrEqual(10);
    for (const child of children) {
      const path = resolve(root, child);
      if (statSync(path).isDirectory()) expect(readdirSync(path).length).toBeGreaterThanOrEqual(2);
    }
  });
});
