/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_MAX_PIECE_EXPORTS_PER_PIECE_V3,
  STUDIO_MAX_PIECE_EXPORTS_PER_PROJECT_V3,
  type CreativeStudioPilotErrorCodeV3,
} from '@/common/types/project/creativeStudioTypes';
import {
  CreativeStudioPilotContractErrorV3,
  parseStudioApplyMutationBatchRequestV3,
  parseStudioCancelPieceJobRequestV3,
  parseStudioConfirmPreparedPhotoRequestV3,
  parseStudioCreateProjectRequestV3,
  parseStudioDeleteProjectRequestV3,
  parseStudioExportPieceRequestV3,
  parseStudioImportPhotoRequestV3,
  parseStudioPreparePhotoIntentV3,
  parseStudioPreparePhotoRequestV3,
  parseStudioResumePieceJobRequestV3,
  parseStudioRetryPieceDownloadRequestV3,
  parseStudioRetryPieceJobRequestV3,
} from '@/process/services/creative-studio/service/pilot/contracts';

const expectInvalid = (value: () => unknown): void => {
  expect(value).toThrow(CreativeStudioPilotContractErrorV3);
};

describe('CS4 Pilot public wire contracts', () => {
  it('snapshots the exact create, create-photo, retry, confirmation, and mutation inputs', () => {
    const create = { name: 'Light on Water', brief: 'One photograph.' };
    expect(parseStudioCreateProjectRequestV3(create)).toEqual(create);

    const settings = { aspectRatio: '16:9' as const, resolution: '1080p' as const };
    const prepare = {
      mode: 'create' as const,
      projectId: 'project_1',
      expectedAuthoringRevision: 2,
      words: 'Moonlight on calm water.',
      settings,
      suggestedHandle: 'light_on_water',
    };
    const parsedPrepare = parseStudioPreparePhotoRequestV3(prepare);
    expect(parsedPrepare).toEqual(prepare);
    expect(parsedPrepare).not.toBe(prepare);
    expect(parsedPrepare.settings).not.toBe(settings);
    expect(parseStudioPreparePhotoIntentV3(prepare)).toEqual(prepare);

    const retry = {
      mode: 'retry' as const,
      projectId: 'project_1',
      expectedAuthoringRevision: 2,
      pieceId: 'piece_1',
      sourceJobId: 'job_1',
    };
    expect(parseStudioRetryPieceJobRequestV3(retry)).toEqual(retry);
    expect(parseStudioPreparePhotoIntentV3(retry)).toEqual(retry);

    const confirm = {
      reservationId: 'reservation_1',
      quoteId: 'quote_1',
      quoteRevision: 1,
      explicitHumanConfirmation: false,
      duplicateChargeAcknowledged: false,
    };
    expect(parseStudioConfirmPreparedPhotoRequestV3(confirm)).toEqual(confirm);

    const batch = {
      schemaVersion: 6 as const,
      projectId: 'project_1',
      expectedAuthoringRevision: 2,
      operations: [{ kind: 'edit_project' as const, name: 'Light on Water II' }],
    };
    const parsedBatch = parseStudioApplyMutationBatchRequestV3(batch);
    expect(parsedBatch).toEqual(batch);
    expect(parsedBatch).not.toBe(batch);
    expect(parsedBatch.operations).not.toBe(batch.operations);
  });

  it('admits only Main-targeting import, cancel, Piece export, and deletion shapes', () => {
    expect(parseStudioImportPhotoRequestV3({ projectId: 'project_1', expectedAuthoringRevision: 2 })).toEqual({
      projectId: 'project_1',
      expectedAuthoringRevision: 2,
    });
    expect(parseStudioCancelPieceJobRequestV3({ projectId: 'project_1', pieceId: 'piece_1', jobId: 'job_1' })).toEqual({
      projectId: 'project_1',
      pieceId: 'piece_1',
      jobId: 'job_1',
    });
    expect(
      parseStudioExportPieceRequestV3({
        projectId: 'project_1',
        pieceId: 'piece_1',
        expectedRevision: 7,
        expectedCatalogRevision: 3,
      })
    ).toEqual({
      projectId: 'project_1',
      pieceId: 'piece_1',
      expectedRevision: 7,
      expectedCatalogRevision: 3,
    });
    expect(parseStudioDeleteProjectRequestV3({ mode: 'healthy', projectId: 'project_1', expectedRevision: 7 })).toEqual(
      { mode: 'healthy', projectId: 'project_1', expectedRevision: 7 }
    );
    const deletionClaim = `studio-delete-v3_${'a'.repeat(32)}`;
    expect(parseStudioDeleteProjectRequestV3({ mode: 'unreadable', projectId: 'project_1', deletionClaim })).toEqual({
      mode: 'unreadable',
      projectId: 'project_1',
      deletionClaim,
    });
  });

  it('snapshots exact same-Job download and provider-status recovery inputs', () => {
    const retryDownload = {
      projectId: 'project_1',
      pieceId: 'piece_1',
      jobId: 'job_1',
      expectedRevision: 7,
    };
    const resume = { ...retryDownload, jobId: 'job_2' };

    const parsedRetryDownload = parseStudioRetryPieceDownloadRequestV3(retryDownload);
    const parsedResume = parseStudioResumePieceJobRequestV3(resume);
    expect(parsedRetryDownload).toEqual(retryDownload);
    expect(parsedRetryDownload).not.toBe(retryDownload);
    expect(parsedResume).toEqual(resume);
    expect(parsedResume).not.toBe(resume);
  });

  it('rejects extra authority and malformed revisions on same-Job recovery inputs', () => {
    const recovery = {
      projectId: 'project_1',
      pieceId: 'piece_1',
      jobId: 'job_1',
      expectedRevision: 7,
    };
    expectInvalid(() => parseStudioRetryPieceDownloadRequestV3({ ...recovery, quoteId: 'quote_1' }));
    expectInvalid(() => parseStudioResumePieceJobRequestV3({ ...recovery, expectedRevision: 0 }));
    expectInvalid(() => parseStudioResumePieceJobRequestV3({ ...recovery, providerJobId: 'provider_job_1' }));
  });

  it('rejects renderer-supplied identities, routes, paths, prices, and cross-mode fields', () => {
    expectInvalid(() => parseStudioCreateProjectRequestV3({ name: 'Pilot', brief: '', forgeProjectId: 'forge_1' }));
    expectInvalid(() =>
      parseStudioPreparePhotoRequestV3({
        mode: 'create',
        projectId: 'project_1',
        expectedAuthoringRevision: 1,
        words: 'A photograph',
        settings: { aspectRatio: '16:9', resolution: '1080p' },
        suggestedHandle: null,
        routeId: 'renderer_route',
      })
    );
    expectInvalid(() =>
      parseStudioRetryPieceJobRequestV3({
        mode: 'retry',
        projectId: 'project_1',
        expectedAuthoringRevision: 1,
        pieceId: 'piece_1',
        sourceJobId: 'job_1',
        words: 'replacement wording',
      })
    );
    expectInvalid(() =>
      parseStudioImportPhotoRequestV3({
        projectId: 'project_1',
        expectedAuthoringRevision: 1,
        path: '/private/photo.png',
      })
    );
    expectInvalid(() =>
      parseStudioExportPieceRequestV3({
        projectId: 'project_1',
        pieceId: 'piece_1',
        expectedRevision: 1,
        expectedCatalogRevision: 1,
        outputPath: '/private/export',
      })
    );
    expectInvalid(() =>
      parseStudioConfirmPreparedPhotoRequestV3({
        reservationId: 'reservation_1',
        quoteId: 'quote_1',
        quoteRevision: 1,
        explicitHumanConfirmation: false,
        duplicateChargeAcknowledged: false,
        authoringFingerprint: 'a'.repeat(64),
      })
    );
  });

  it('rejects malformed revisions/settings, sparse graphs, accessors, proxies, and inherited data', () => {
    expectInvalid(() =>
      parseStudioPreparePhotoRequestV3({
        mode: 'create',
        projectId: 'project_1',
        expectedAuthoringRevision: 0,
        words: 'A photograph',
        settings: { aspectRatio: '2:1', resolution: '4k' },
        suggestedHandle: null,
      })
    );
    expectInvalid(() => parseStudioCreateProjectRequestV3(Object.create({ name: 'Pilot', brief: '' })));

    let getterReads = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(accessor, {
      name: {
        enumerable: true,
        get: () => {
          getterReads += 1;
          return 'Pilot';
        },
      },
      brief: { enumerable: true, value: '' },
    });
    expectInvalid(() => parseStudioCreateProjectRequestV3(accessor));
    expect(getterReads).toBe(0);

    let proxyReads = 0;
    const proxy = new Proxy(
      { name: 'Pilot', brief: '' },
      {
        get: (target, key, receiver) => {
          proxyReads += 1;
          return Reflect.get(target, key, receiver);
        },
      }
    );
    expectInvalid(() => parseStudioCreateProjectRequestV3(proxy));
    expect(proxyReads).toBe(0);

    const operations: unknown[] = [{ kind: 'edit_project', name: 'Pilot' }];
    delete operations[0];
    expectInvalid(() =>
      parseStudioApplyMutationBatchRequestV3({
        schemaVersion: 6,
        projectId: 'project_1',
        expectedAuthoringRevision: 1,
        operations,
      })
    );
  });

  it('freezes export retention and the typed project-capacity refusal', () => {
    const capacityCode: CreativeStudioPilotErrorCodeV3 = 'project_piece_capacity_reached';
    expect({
      perPiece: STUDIO_MAX_PIECE_EXPORTS_PER_PIECE_V3,
      perProject: STUDIO_MAX_PIECE_EXPORTS_PER_PROJECT_V3,
      capacityCode,
    }).toEqual({ perPiece: 5, perProject: 480, capacityCode: 'project_piece_capacity_reached' });
  });
});
