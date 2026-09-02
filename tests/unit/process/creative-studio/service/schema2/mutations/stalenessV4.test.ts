/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { applyStudioBoardMemberReorderV4 } from '@/process/services/creative-studio/service/schema2/mutations/reorderV4';
import { keepStudioStalePictureV4 } from '@/process/services/creative-studio/service/schema2/mutations/stalenessV4';
import { validateStudioProjectV4 } from '@/process/services/creative-studio/service/schema2/validation';
import { makePhase6Project } from '../../../../../../fixtures/creative-studio/phase6Project';

const reorderedAt = '2026-09-02T00:00:03.000Z';
const keptAt = '2026-09-02T00:00:04.000Z';

const makeStaleProject = () => {
  const project = makePhase6Project();
  project.assemblies.assembly_1!.pictureBindings.shot_2!.source = {
    pieceId: 'piece_photo_1',
    assetId: 'asset_photo_1',
  };
  const reordered = applyStudioBoardMemberReorderV4(
    project,
    {
      kind: 'shot',
      projectId: project.id,
      expectedAuthoringRevision: project.authoringRevision,
      boardId: 'board_1',
      shotId: 'shot_2',
      direction: 'earlier',
    },
    { capturedAt: reorderedAt }
  );
  if (reordered.status !== 'applied') throw new Error(`fixture reorder failed: ${reordered.reason}`);
  return reordered.project;
};

describe('schema-7 stale picture decisions', () => {
  it('records Keep while preserving the stale media, provenance, and Assembly binding', () => {
    const project = makeStaleProject();
    const before = {
      source: structuredClone(project.assemblies.assembly_1!.pictureBindings.shot_1!.source),
      assets: structuredClone(project.assets),
      jobs: structuredClone(project.jobs),
      authorizations: structuredClone(project.spendAuthorizations),
    };

    const result = keepStudioStalePictureV4(
      project,
      {
        kind: 'picture',
        projectId: project.id,
        expectedAuthoringRevision: project.authoringRevision,
        assemblyId: 'assembly_1',
        shotId: 'shot_1',
      },
      { capturedAt: keptAt }
    );

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.project.assemblies.assembly_1!.pictureBindings.shot_1).toMatchObject({
      source: before.source,
      staleness: {
        cause: 'chain',
        upstreamShotId: 'shot_2',
        keptAt,
      },
    });
    expect({
      assets: result.project.assets,
      jobs: result.project.jobs,
      authorizations: result.project.spendAuthorizations,
    }).toEqual({ assets: before.assets, jobs: before.jobs, authorizations: before.authorizations });
    expect(validateStudioProjectV4(result.project)).toBe(true);
  });

  it('fails closed for fresh, already-kept, stale, missing, and malformed claims', () => {
    const fresh = makePhase6Project();
    const request = {
      kind: 'picture' as const,
      projectId: fresh.id,
      expectedAuthoringRevision: fresh.authoringRevision,
      assemblyId: 'assembly_1',
      shotId: 'shot_1',
    };
    expect(keepStudioStalePictureV4(fresh, request, { capturedAt: keptAt })).toEqual({
      status: 'refused',
      reason: 'member_not_stale',
    });

    const stale = makeStaleProject();
    const staleRequest = { ...request, expectedAuthoringRevision: stale.authoringRevision };
    const applied = keepStudioStalePictureV4(stale, staleRequest, { capturedAt: keptAt });
    if (applied.status !== 'applied') throw new Error('Keep fixture failed');
    expect(
      keepStudioStalePictureV4(
        applied.project,
        { ...staleRequest, expectedAuthoringRevision: applied.project.authoringRevision },
        { capturedAt: '2026-09-02T00:00:05.000Z' }
      )
    ).toEqual({ status: 'refused', reason: 'already_kept' });
    expect(
      keepStudioStalePictureV4(
        stale,
        { ...staleRequest, expectedAuthoringRevision: stale.authoringRevision - 1 },
        { capturedAt: keptAt }
      )
    ).toEqual({ status: 'refused', reason: 'stale_project' });
    expect(
      keepStudioStalePictureV4(stale, { ...staleRequest, shotId: 'shot_missing' }, { capturedAt: keptAt })
    ).toEqual({ status: 'refused', reason: 'member_not_found' });
    expect(keepStudioStalePictureV4(stale, { ...staleRequest, extra: true }, { capturedAt: keptAt })).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
    expect(keepStudioStalePictureV4(stale, staleRequest, { capturedAt: '2026-09-02T00:00:02.000Z' })).toEqual({
      status: 'refused',
      reason: 'invalid_request',
    });
  });
});
