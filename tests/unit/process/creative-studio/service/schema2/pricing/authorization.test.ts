/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type {
  StudioProjectV2,
  StudioQuotedGeneration,
  StudioSpendAuthorization,
} from '@/common/types/project/creativeStudioTypes';
import {
  calculateStudioQuotedGenerationAmounts,
  createStudioQuotedGenerationId,
  createStudioResolvedGenerationRequestPlan,
} from '@/process/services/creative-studio/service/schema2/generation';
import {
  createStudioRateCardV2,
  createStudioSpendAuthorizationV2,
  createStudioSpendReceiptV2,
  createStudioSubmissionQuoteCoreV2,
  studioSpendReceiptMatchesJobV2,
  type StudioSpendAuthorizationInputV2,
} from '@/process/services/creative-studio/service/schema2/pricing';

const imageRate = {
  routeId: 'image_route',
  kind: 'image',
  currency: 'USD',
  rateUnit: 'generation',
  rateMinorUnits: 25,
} as const;

const videoRate = {
  routeId: 'video_route',
  kind: 'video',
  currency: 'USD',
  rateUnit: 'second',
  rateMinorUnits: 7,
} as const;

const template = {
  prompt: 'A precise cinematic frame',
  aspectRatio: '16:9',
  resolution: '1080p',
  durationSeconds: 8,
  referenceInput: null,
} as const;

const makeShot = (id: string): StudioProjectV2['shots'][string] => ({
  id,
  line: id,
  derivation: 'derived',
  derivedFromActionRevision: 1,
  narration: '',
  onScreenText: '',
  durationSeconds: 8,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak: 'none',
  seedStillId: null,
  boardAssetId: null,
  supersededBoardAssetIds: [],
  videoAssetId: null,
  supersededVideoAssetIds: [],
  assetIds: [],
  jobIds: [],
});

const makeQuote = () => {
  const project = {
    id: 'project_1',
    revision: 7,
    beatOrder: ['beat_1'],
    beats: {
      beat_1: {
        id: 'beat_1',
        title: 'Opening',
        action: '',
        look: '',
        actionRevision: 1,
        targetSeconds: null,
        shotOrder: ['shot_1', 'shot_2'],
        lineHistory: [],
      },
    },
    shots: { shot_1: makeShot('shot_1'), shot_2: makeShot('shot_2') },
    jobs: {},
  };
  const core = createStudioSubmissionQuoteCoreV2({
    project,
    originReferenceHandoffId: null,
    rateCard: createStudioRateCardV2([imageRate, videoRate]),
    baseItems: [
      {
        shotId: 'shot_1',
        purpose: 'seed_still',
        routeId: imageRate.routeId,
        generationCount: 1,
        requestPlan: createStudioResolvedGenerationRequestPlan({
          purpose: 'seed_still',
          template,
          conditioningInput: null,
        }),
      },
      {
        shotId: 'shot_2',
        purpose: 'video_take',
        routeId: videoRate.routeId,
        generationCount: 1,
        requestPlan: createStudioResolvedGenerationRequestPlan({
          purpose: 'video_take',
          template,
          conditioningInput: { kind: 'seed_still', assetId: 'seed_asset' },
        }),
      },
    ],
    cascadeItems: [],
  });
  return { ...core, id: 'authorization_1', expiresAt: '2026-08-18T00:05:00.000Z' };
};

const makeAuthorizationInput = () => {
  const quote = makeQuote();
  const [seed, video] = quote.baseItems;
  return {
    quote,
    confirmedAt: '2026-08-18T00:04:00.000Z',
    providerBindings: [
      {
        itemId: seed!.id,
        provider: { providerId: 'provider_image', adapterId: 'weprompt-image-v1' as const, model: 'image-model' },
      },
      {
        itemId: video!.id,
        provider: { providerId: 'provider_video', adapterId: 'openrouter-video-v1' as const, model: 'video-model' },
      },
    ],
    idempotencyKeys: [
      { itemId: seed!.id, key: 'key_seed' },
      { itemId: video!.id, key: 'key_video' },
    ],
  };
};

const makeBoardAuthorizationInput = () => {
  const project = {
    id: 'project_1',
    revision: 7,
    beatOrder: ['beat_1'],
    beats: {
      beat_1: {
        id: 'beat_1',
        title: 'Opening',
        action: 'Cross the room',
        look: 'Grey morning',
        actionRevision: 1,
        targetSeconds: null,
        shotOrder: ['shot_1'],
        lineHistory: [],
      },
    },
    shots: { shot_1: makeShot('shot_1') },
    jobs: {},
  };
  const quote = {
    ...createStudioSubmissionQuoteCoreV2({
      project,
      originReferenceHandoffId: null,
      rateCard: createStudioRateCardV2([{ ...imageRate, rateMinorUnits: 3 }]),
      baseItems: [
        {
          shotId: 'shot_1',
          purpose: 'board_still' as const,
          routeId: imageRate.routeId,
          generationCount: 1,
          requestPlan: {
            kind: 'resolved' as const,
            snapshot: {
              ...template,
              durationSeconds: 4,
              conditioningInput: null,
            },
          },
        },
      ],
      cascadeItems: [],
    }),
    id: 'authorization_board',
    expiresAt: '2026-08-18T00:05:00.000Z',
  };
  const item = quote.baseItems[0]!;
  return {
    quote,
    confirmedAt: '2026-08-18T00:04:00.000Z',
    providerBindings: [
      {
        itemId: item.id,
        provider: { providerId: 'provider_image', adapterId: 'weprompt-image-v1' as const, model: 'image-model' },
      },
    ],
    idempotencyKeys: [{ itemId: item.id, key: 'key_board' }],
  };
};

const appendAuthorizationItem = (
  input: StudioSpendAuthorizationInputV2,
  item: StudioQuotedGeneration,
  destination: 'base' | 'cascade'
): void => {
  const amounts = calculateStudioQuotedGenerationAmounts(item);
  if (amounts === null) throw new Error('invalid authorization test item');
  (destination === 'base' ? input.quote.baseItems : input.quote.cascadeItems).push(item);
  input.quote.lowerMinorUnits += amounts.oneGenerationMinorUnits;
  input.quote.upperMinorUnits += amounts.requestedTotalMinorUnits;
  input.providerBindings.push({
    itemId: item.id,
    provider: { providerId: 'provider_image', adapterId: 'weprompt-image-v1', model: 'image-model' },
  });
  input.idempotencyKeys.push({ itemId: item.id, key: `key_${item.shotId}_${item.purpose}` });
};

const makeMixedBoardAuthorizationInput = (): StudioSpendAuthorizationInputV2 => {
  const input: StudioSpendAuthorizationInputV2 = makeBoardAuthorizationInput();
  const seed = structuredClone(makeAuthorizationInput().quote.baseItems[0]!);
  appendAuthorizationItem(input, seed, 'base');
  return input;
};

const makeBoardCascadeAuthorizationInput = (): StudioSpendAuthorizationInputV2 => {
  const input: StudioSpendAuthorizationInputV2 = makeBoardAuthorizationInput();
  const item = structuredClone(input.quote.baseItems[0]!);
  item.shotId = 'shot_2';
  item.id = createStudioQuotedGenerationId({
    projectId: input.quote.projectId,
    projectRevision: input.quote.projectRevision,
    shotId: item.shotId,
    purpose: item.purpose,
  });
  appendAuthorizationItem(input, item, 'cascade');
  return input;
};

const makeBoardHandoffAuthorizationInput = (): StudioSpendAuthorizationInputV2 => {
  const input: StudioSpendAuthorizationInputV2 = makeBoardAuthorizationInput();
  input.quote.originReferenceHandoffId = 'handoff_1';
  return input;
};

const makeOversizedBoardAuthorizationInput = (): StudioSpendAuthorizationInputV2 => {
  const input: StudioSpendAuthorizationInputV2 = makeBoardAuthorizationInput();
  for (let shotNumber = 2; shotNumber <= 25; shotNumber += 1) {
    const item = structuredClone(input.quote.baseItems[0]!);
    item.shotId = `shot_${shotNumber}`;
    item.id = createStudioQuotedGenerationId({
      projectId: input.quote.projectId,
      projectRevision: input.quote.projectRevision,
      shotId: item.shotId,
      purpose: item.purpose,
    });
    appendAuthorizationItem(input, item, 'base');
  }
  return input;
};

const makeReferencedBoardAuthorizationInput = (): StudioSpendAuthorizationInputV2 => {
  const input: StudioSpendAuthorizationInputV2 = makeBoardAuthorizationInput();
  const plan = input.quote.baseItems[0]!.requestPlan;
  if (plan.kind !== 'resolved') throw new Error('expected resolved Board plan');
  plan.snapshot.referenceInput = { assetId: 'reference_1', sha256: 'a'.repeat(64) };
  return input;
};

const makeConditionedBoardAuthorizationInput = (): StudioSpendAuthorizationInputV2 => {
  const input: StudioSpendAuthorizationInputV2 = makeBoardAuthorizationInput();
  const plan = input.quote.baseItems[0]!.requestPlan;
  if (plan.kind !== 'resolved') throw new Error('expected resolved Board plan');
  plan.snapshot.conditioningInput = { kind: 'seed_still', assetId: 'seed_1' };
  return input;
};

const makeDeferredBoardAuthorizationInput = (): StudioSpendAuthorizationInputV2 => {
  const input: StudioSpendAuthorizationInputV2 = makeBoardAuthorizationInput();
  input.quote.baseItems[0]!.requestPlan = {
    kind: 'after_take_selection',
    template: { ...template, durationSeconds: 4 },
    dependency: { kind: 'authorized_seed', upstreamItemId: 'seed_item_1', shotId: 'shot_1' },
  };
  return input;
};

describe('schema-2 Studio spend authorization', () => {
  it('freezes a complete provider binding and idempotency bijection', () => {
    const input = makeAuthorizationInput();
    const authorization = createStudioSpendAuthorizationV2(input);

    expect(authorization).toMatchObject({
      id: 'authorization_1',
      confirmedAt: '2026-08-18T00:04:00.000Z',
      lowerMinorUnits: 81,
      upperMinorUnits: 81,
    });
    expect(authorization.providerBindings.map((binding) => binding.itemId)).toEqual(
      authorization.baseItems.map((item) => item.id)
    );
    expect(authorization.idempotencyKeys).toHaveLength(2);

    input.quote.baseItems[0]!.rateMinorUnits = 999;
    input.providerBindings[0]!.provider.model = 'changed';
    input.idempotencyKeys[0]!.key = 'changed';
    expect(authorization.baseItems[0]!.rateMinorUnits).toBe(25);
    expect(authorization.providerBindings[0]!.provider.model).toBe('image-model');
    expect(authorization.idempotencyKeys[0]!.key).toBe('key_seed');
  });

  it('rejects exact-expiry confirmation and incomplete or ambiguous maps', () => {
    const expired = makeAuthorizationInput();
    expired.confirmedAt = expired.quote.expiresAt;
    expect(() => createStudioSpendAuthorizationV2(expired)).toThrow(expect.objectContaining({ code: 'expired_quote' }));

    const missingBinding = makeAuthorizationInput();
    missingBinding.providerBindings.pop();
    expect(() => createStudioSpendAuthorizationV2(missingBinding)).toThrow(
      expect.objectContaining({ code: 'invalid_provider_binding' })
    );

    const wrongPair = makeAuthorizationInput();
    wrongPair.idempotencyKeys[1]!.itemId = wrongPair.idempotencyKeys[0]!.itemId;
    expect(() => createStudioSpendAuthorizationV2(wrongPair)).toThrow(
      expect.objectContaining({ code: 'invalid_idempotency' })
    );

    const duplicateKey = makeAuthorizationInput();
    duplicateKey.idempotencyKeys[1]!.key = duplicateKey.idempotencyKeys[0]!.key;
    expect(() => createStudioSpendAuthorizationV2(duplicateKey)).toThrow(
      expect.objectContaining({ code: 'invalid_idempotency' })
    );
  });

  it('rejects tampered deterministic IDs and recomputed totals', () => {
    const badId = makeAuthorizationInput();
    badId.quote.baseItems[0]!.id = 'item_random';
    badId.providerBindings[0]!.itemId = 'item_random';
    badId.idempotencyKeys[0]!.itemId = 'item_random';
    expect(() => createStudioSpendAuthorizationV2(badId)).toThrow(
      expect.objectContaining({ code: 'invalid_authorization' })
    );

    const badTotal = makeAuthorizationInput();
    badTotal.quote.upperMinorUnits += 1;
    expect(() => createStudioSpendAuthorizationV2(badTotal)).toThrow(
      expect.objectContaining({ code: 'invalid_authorization' })
    );
  });

  it('derives exact-one seed and video receipts', () => {
    const authorization = createStudioSpendAuthorizationV2(makeAuthorizationInput());
    const [seed, video] = authorization.baseItems;

    expect(createStudioSpendReceiptV2({ authorization, itemId: seed!.id, jobId: 'job_seed' })).toMatchObject({
      purpose: 'seed_still',
      durationSeconds: null,
      generationCount: 1,
      totalMinorUnits: 25,
    });
    expect(createStudioSpendReceiptV2({ authorization, itemId: video!.id, jobId: 'job_video' })).toMatchObject({
      purpose: 'video_take',
      durationSeconds: 8,
      generationCount: 1,
      totalMinorUnits: 56,
    });
  });

  it('records a Board panel as one image generation with no billable duration', () => {
    const authorization = createStudioSpendAuthorizationV2(makeBoardAuthorizationInput());
    const item = authorization.baseItems[0]!;

    expect(createStudioSpendReceiptV2({ authorization, itemId: item.id, jobId: 'job_board' })).toMatchObject({
      purpose: 'board_still',
      durationSeconds: null,
      rateUnit: 'generation',
      totalMinorUnits: 3,
    });
  });

  it('refuses a Board authority whose image plumbing duration is not canonical', () => {
    const input = makeBoardAuthorizationInput();
    const plan = input.quote.baseItems[0]!.requestPlan;
    if (plan.kind !== 'resolved') throw new Error('expected resolved Board plan');
    plan.snapshot.durationSeconds = 5;

    expect(() => createStudioSpendAuthorizationV2(input)).toThrow(
      expect.objectContaining({ code: 'invalid_authorization' })
    );
  });

  it.each([
    ['mixed Board and seed rows', makeMixedBoardAuthorizationInput],
    ['a Board cascade row', makeBoardCascadeAuthorizationInput],
    ['a Board reference handoff origin', makeBoardHandoffAuthorizationInput],
    ['more than 24 Board rows', makeOversizedBoardAuthorizationInput],
    ['a referenced Board request', makeReferencedBoardAuthorizationInput],
    ['a conditioned Board request', makeConditionedBoardAuthorizationInput],
    ['a deferred Board request', makeDeferredBoardAuthorizationInput],
  ] as const)('refuses %s before minting spend authority', (_label, makeInput) => {
    expect(() => createStudioSpendAuthorizationV2(makeInput())).toThrow(
      expect.objectContaining({ code: 'invalid_authorization' })
    );
  });

  it('correlates the paired job and rejects a wrong logical idempotency entry', () => {
    const authorization = createStudioSpendAuthorizationV2(makeAuthorizationInput());
    const item = authorization.baseItems[1]!;
    const receipt = createStudioSpendReceiptV2({
      authorization,
      itemId: item.id,
      jobId: 'job_video',
    });
    const job = {
      id: 'job_video',
      authorizationId: authorization.id,
      authorizationItemId: item.id,
      idempotencyKey: 'key_video',
      purpose: 'video_take',
    } as const;

    expect(studioSpendReceiptMatchesJobV2(receipt, authorization, job)).toBe(true);
    expect(studioSpendReceiptMatchesJobV2(receipt, authorization, { ...job, idempotencyKey: 'key_seed' })).toBe(false);
  });

  it('keeps historical receipts unchanged after a current rate-card change', () => {
    const authorization: StudioSpendAuthorization = createStudioSpendAuthorizationV2(makeAuthorizationInput());
    const item = authorization.baseItems[1]!;
    const before = createStudioSpendReceiptV2({
      authorization,
      itemId: item.id,
      jobId: 'job_video',
    });

    createStudioRateCardV2([imageRate, { ...videoRate, rateMinorUnits: 99 }]);
    expect(
      createStudioSpendReceiptV2({
        authorization,
        itemId: item.id,
        jobId: 'job_video',
      })
    ).toEqual(before);
  });
});
