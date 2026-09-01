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
  composeStudioGenerationV2,
  composeStudioPieceGenerationV3,
  createStudioQuotedGenerationId,
  createStudioResolvedGenerationRequestPlan,
  createStudioPieceGenerationRequestPlanV3,
  deriveStudioPieceInstructionProfileV3,
  deriveStudioInstructionProfileV2,
} from '@/process/services/creative-studio/service/schema2/generation';
import {
  createStudioRateCardV2,
  createStudioPieceSpendAuthorizationV3,
  createStudioPieceSpendReceiptV3,
  createStudioPieceSubmissionQuoteV3,
  createStudioSpendAuthorizationV2,
  createStudioSpendReceiptV2,
  createStudioSubmissionQuoteCoreV2,
  studioSpendReceiptMatchesJobV2,
  studioPieceDuplicateChargeAcknowledgementIsValidV3,
  studioPieceSpendReceiptMatchesJobV3,
  validateStudioPieceSpendAuthorizationV3,
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

const imageProvider = {
  providerId: 'provider_image',
  adapterId: 'weprompt-image-v1' as const,
  model: 'image-model',
};
const videoProvider = {
  providerId: 'provider_video',
  adapterId: 'openrouter-video-v1' as const,
  model: 'video-model',
};

const makeShot = (id: string): StudioProjectV2['shots'][string] => ({
  id,
  shootingScript: `Shooting script for ${id}`,
  durationSeconds: 8,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak: 'none',
  referenceBinding: { status: 'ready', characterReferenceIds: [], backgroundReferenceId: null },
  seedStillId: null,
  dismissedSeedStillIds: [],
  boardAssetId: null,
  supersededBoardAssetIds: [],
  videoAssetId: null,
  supersededVideoAssetIds: [],
  assetIds: [],
  jobIds: [],
});

const makeProject = () => ({
  id: 'project_1',
  revision: 7,
  beatOrder: ['beat_1'],
  beats: {
    beat_1: {
      id: 'beat_1',
      title: 'Opening',
      story: 'A precise cinematic opening.',
      targetSeconds: null,
      shotOrder: ['shot_1', 'shot_2'],
    },
  },
  shots: { shot_1: makeShot('shot_1'), shot_2: makeShot('shot_2') },
  references: {},
  jobs: {},
});

const makeComposition = (
  shotId: string,
  purpose: 'seed_still' | 'board_still' | 'video_take',
  referenceInputs: Array<{
    referenceId: string;
    kind: 'character' | 'background';
    assetId: string;
    sha256: string;
  }> = []
) => {
  const route = purpose === 'video_take' ? videoProvider : imageProvider;
  const source = {
    kind: 'shot' as const,
    beatId: 'beat_1',
    story: 'A precise cinematic opening.',
    shotId,
    shootingScript: `Shooting script for ${shotId}`,
  };
  return composeStudioGenerationV2({
    projectRevision: 7,
    brief: 'A precise cinematic frame.',
    rules: [],
    source,
    purpose,
    referenceInputs,
    aspectRatio: '16:9',
    resolution: '1080p',
    route,
    boardStyle: purpose === 'board_still' ? 'grey_tone' : null,
    instructionProfile: deriveStudioInstructionProfileV2(route, purpose, source),
  });
};

const makeResolvedPlan = (
  shotId: string,
  purpose: 'seed_still' | 'board_still' | 'video_take',
  referenceInputs: Parameters<typeof makeComposition>[2] = []
) => {
  const composition = makeComposition(shotId, purpose, referenceInputs);
  return createStudioResolvedGenerationRequestPlan({
    purpose,
    template: {
      composition,
      aspectRatio: composition.inputs.aspectRatio,
      resolution: composition.inputs.resolution,
      durationSeconds: purpose === 'board_still' ? 4 : 8,
      referenceInputs: composition.inputs.referenceInputs,
    },
    conditioningInput: purpose === 'video_take' ? { kind: 'seed_still', assetId: 'seed_asset' } : null,
  });
};

const makeQuote = () => {
  const project = makeProject();
  const core = createStudioSubmissionQuoteCoreV2({
    project,
    originReferenceHandoffId: null,
    rateCard: createStudioRateCardV2([imageRate, videoRate]),
    baseItems: [
      {
        target: { kind: 'shot', shotId: 'shot_1' },
        purpose: 'seed_still',
        routeId: imageRate.routeId,
        generationCount: 1,
        requestPlan: makeResolvedPlan('shot_1', 'seed_still'),
      },
      {
        target: { kind: 'shot', shotId: 'shot_2' },
        purpose: 'video_take',
        routeId: videoRate.routeId,
        generationCount: 1,
        requestPlan: makeResolvedPlan('shot_2', 'video_take'),
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
        provider: imageProvider,
      },
      {
        itemId: video!.id,
        provider: videoProvider,
      },
    ],
    idempotencyKeys: [
      { itemId: seed!.id, key: 'key_seed' },
      { itemId: video!.id, key: 'key_video' },
    ],
  };
};

const makeReferenceAuthorizationInput = (): StudioSpendAuthorizationInputV2 => {
  const referenceId = 'reference_1';
  const project = {
    ...makeProject(),
    referencePlanStatus: 'planned' as const,
    referenceOrder: [referenceId],
    references: {
      [referenceId]: {
        id: referenceId,
        kind: 'character' as const,
        label: 'Ming',
        prompt: 'One candid portrait of Ming.',
        approvedAssetId: null,
        supersededAssetIds: [],
        jobIds: [],
        createdAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:00.000Z',
      },
    },
  };
  const source = {
    kind: 'project_reference' as const,
    referenceId,
    referenceKind: 'character' as const,
    prompt: project.references[referenceId].prompt,
  };
  const composition = composeStudioGenerationV2({
    projectRevision: project.revision,
    brief: 'A precise cinematic frame.',
    rules: [],
    source,
    purpose: 'reference_image',
    referenceInputs: [],
    aspectRatio: '16:9',
    resolution: '1080p',
    route: imageProvider,
    boardStyle: null,
    instructionProfile: deriveStudioInstructionProfileV2(imageProvider, 'reference_image', source),
  });
  const quote = {
    ...createStudioSubmissionQuoteCoreV2({
      project,
      originReferenceHandoffId: null,
      rateCard: createStudioRateCardV2([imageRate]),
      baseItems: [
        {
          target: { kind: 'reference' as const, referenceId },
          purpose: 'reference_image' as const,
          routeId: imageRate.routeId,
          generationCount: 2,
          requestPlan: createStudioResolvedGenerationRequestPlan({
            purpose: 'reference_image',
            template: {
              composition,
              aspectRatio: '16:9',
              resolution: '1080p',
              durationSeconds: 5,
              referenceInputs: [],
            },
            conditioningInput: null,
          }),
        },
      ],
      cascadeItems: [],
    }),
    id: 'authorization_reference',
    expiresAt: '2026-08-18T00:05:00.000Z',
  };
  const item = quote.baseItems[0]!;
  return {
    quote,
    confirmedAt: '2026-08-18T00:04:00.000Z',
    providerBindings: [{ itemId: item.id, provider: imageProvider }],
    idempotencyKeys: [
      { itemId: item.id, key: 'key_reference_first' },
      { itemId: item.id, key: 'key_reference_retry' },
    ],
  };
};

const makeBoardAuthorizationInput = () => {
  const project = makeProject();
  project.beats.beat_1.shotOrder = ['shot_1'];
  delete project.shots.shot_2;
  const quote = {
    ...createStudioSubmissionQuoteCoreV2({
      project,
      originReferenceHandoffId: null,
      rateCard: createStudioRateCardV2([{ ...imageRate, rateMinorUnits: 3 }]),
      baseItems: [
        {
          target: { kind: 'shot', shotId: 'shot_1' },
          purpose: 'board_still' as const,
          routeId: imageRate.routeId,
          generationCount: 1,
          requestPlan: makeResolvedPlan('shot_1', 'board_still'),
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
        provider: imageProvider,
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
  const targetId = item.target.kind === 'shot' ? item.target.shotId : item.target.referenceId;
  input.idempotencyKeys.push({ itemId: item.id, key: `key_${targetId}_${item.purpose}` });
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
  item.target = { kind: 'shot', shotId: 'shot_2' };
  item.id = createStudioQuotedGenerationId({
    projectId: input.quote.projectId,
    projectRevision: input.quote.projectRevision,
    target: item.target,
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
    item.target = { kind: 'shot', shotId: `shot_${shotNumber}` };
    item.id = createStudioQuotedGenerationId({
      projectId: input.quote.projectId,
      projectRevision: input.quote.projectRevision,
      target: item.target,
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
  const referenceInputs = [
    {
      referenceId: 'reference_1',
      kind: 'character' as const,
      assetId: 'asset_reference_1',
      sha256: 'a'.repeat(64),
    },
  ];
  plan.snapshot.composition = makeComposition('shot_1', 'board_still', referenceInputs);
  plan.snapshot.referenceInputs = referenceInputs;
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
  const resolved = makeResolvedPlan('shot_1', 'board_still');
  const { conditioningInput: _conditioningInput, ...template } = resolved.snapshot;
  input.quote.baseItems[0]!.requestPlan = {
    kind: 'after_take_selection',
    template,
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

  it('freezes two distinct reference attempt keys but records each submitted attempt separately', () => {
    const authorization = createStudioSpendAuthorizationV2(makeReferenceAuthorizationInput());
    const item = authorization.baseItems[0]!;
    const receipt = createStudioSpendReceiptV2({
      authorization,
      itemId: item.id,
      jobId: 'job_reference_retry',
    });

    expect(authorization).toMatchObject({ lowerMinorUnits: 25, upperMinorUnits: 50 });
    expect(authorization.idempotencyKeys).toEqual([
      { itemId: item.id, key: 'key_reference_first' },
      { itemId: item.id, key: 'key_reference_retry' },
    ]);
    expect(receipt).toMatchObject({ generationCount: 1, totalMinorUnits: 25 });
    expect(
      studioSpendReceiptMatchesJobV2(receipt, authorization, {
        id: 'job_reference_retry',
        authorizationId: authorization.id,
        authorizationItemId: item.id,
        idempotencyKey: 'key_reference_retry',
        purpose: 'reference_image',
      })
    ).toBe(true);

    const missing = makeReferenceAuthorizationInput();
    missing.idempotencyKeys.pop();
    expect(() => createStudioSpendAuthorizationV2(missing)).toThrow(
      expect.objectContaining({ code: 'invalid_idempotency' })
    );
    const duplicate = makeReferenceAuthorizationInput();
    duplicate.idempotencyKeys[1]!.key = duplicate.idempotencyKeys[0]!.key;
    expect(() => createStudioSpendAuthorizationV2(duplicate)).toThrow(
      expect.objectContaining({ code: 'invalid_idempotency' })
    );
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

  it('retains the exact approved references frozen into a Board authority', () => {
    const authorization = createStudioSpendAuthorizationV2(makeReferencedBoardAuthorizationInput());
    const plan = authorization.baseItems[0]!.requestPlan;
    expect(plan.kind).toBe('resolved');
    if (plan.kind !== 'resolved') throw new Error('expected resolved Board authority');
    expect(plan.snapshot.referenceInputs).toEqual([
      {
        referenceId: 'reference_1',
        kind: 'character',
        assetId: 'asset_reference_1',
        sha256: 'a'.repeat(64),
      },
    ]);
    expect(plan.snapshot.composition.inputs.referenceInputs).toEqual(plan.snapshot.referenceInputs);
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

describe('inactive Piece spend authorization and receipt', () => {
  const reservationId = 'reservation_piece_1';
  const makePieceQuote = () => {
    const composition = composeStudioPieceGenerationV3({
      projectRevisionAtPreparation: 5,
      authoringRevision: 2,
      authoringFingerprintVersion: 2,
      authoringFingerprint: 'a'.repeat(64),
      brief: '',
      rules: [],
      source: {
        kind: 'piece',
        pieceId: 'piece_1',
        words: 'A silver birch under rain.',
        settings: { aspectRatio: '3:4', resolution: '1080p' },
      },
      purpose: 'piece_image',
      conditioningInputs: [],
      route: imageProvider,
      instructionProfile: deriveStudioPieceInstructionProfileV3(imageProvider),
    });
    return createStudioPieceSubmissionQuoteV3({
      reservationId,
      quoteId: 'quote_piece_1',
      quoteRevision: 1,
      projectId: 'project_1',
      projectRevisionAtPreparation: 5,
      authoringRevision: 2,
      authoringFingerprintVersion: 2,
      authoringFingerprint: 'a'.repeat(64),
      rateCardDigest: 'b'.repeat(64),
      currency: 'USD',
      target: { kind: 'piece', pieceId: 'piece_1' },
      routeId: 'image_route',
      requestPlan: createStudioPieceGenerationRequestPlanV3({ composition }),
      rateUnit: 'generation',
      rateMinorUnits: 20,
      expiresAt: '2026-08-30T00:05:00.000Z',
    });
  };

  const makePieceAuthorization = () =>
    createStudioPieceSpendAuthorizationV3({
      reservationId,
      authorizationId: 'authorization_piece_1',
      quote: makePieceQuote(),
      confirmedAt: '2026-08-30T00:04:00.000Z',
      projectRevisionAtAuthorization: 6,
      provider: imageProvider,
      cancellationPolicy: 'queued_and_running',
      idempotencyKey: 'idempotency_piece_1',
    });

  it('keeps quote and authorization identities distinct and freezes provider and cancellation authority', () => {
    const authorization = makePieceAuthorization();
    expect(authorization.id).toBe('authorization_piece_1');
    expect(authorization.quote.id).toBe('quote_piece_1');
    expect(authorization.id).not.toBe(authorization.quote.id);
    expect(authorization.providerBinding).toEqual({
      itemId: authorization.quote.item.id,
      provider: imageProvider,
    });
    expect(authorization.cancellationPolicy).toBe('queued_and_running');
    expect(validateStudioPieceSpendAuthorizationV3(authorization, reservationId)).toBe(true);
    expect(
      validateStudioPieceSpendAuthorizationV3(
        { ...authorization, cancellationPolicy: 'unsupported_policy' },
        reservationId
      )
    ).toBe(false);
    const crossed = structuredClone(authorization);
    crossed.providerBinding.provider.model = 'other-model';
    expect(validateStudioPieceSpendAuthorizationV3(crossed, reservationId)).toBe(false);

    let proxyReads = 0;
    const proxied = structuredClone(authorization);
    proxied.providerBinding.provider = new Proxy(proxied.providerBinding.provider, {
      get: (target, property, receiver) => {
        proxyReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(validateStudioPieceSpendAuthorizationV3(proxied, reservationId)).toBe(false);
    expect(proxyReads).toBe(0);

    let getterReads = 0;
    const accessorBacked = structuredClone(authorization);
    const hostileProvider = {
      providerId: imageProvider.providerId,
      adapterId: imageProvider.adapterId,
    } as Record<string, unknown>;
    Object.defineProperty(hostileProvider, 'model', {
      enumerable: true,
      get: () => {
        getterReads += 1;
        return imageProvider.model;
      },
    });
    accessorBacked.providerBinding.provider = hostileProvider as never;
    expect(validateStudioPieceSpendAuthorizationV3(accessorBacked, reservationId)).toBe(false);
    expect(getterReads).toBe(0);
  });

  it('rejects expired, same-identity, stale-revision, and wrong-provider authorization', () => {
    const quote = makePieceQuote();
    expect(() =>
      createStudioPieceSpendAuthorizationV3({
        reservationId,
        authorizationId: quote.id,
        quote,
        confirmedAt: '2026-08-30T00:04:00.000Z',
        projectRevisionAtAuthorization: 6,
        provider: imageProvider,
        cancellationPolicy: 'queued_and_running',
        idempotencyKey: 'idempotency_piece_1',
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_authorization' }));
    expect(() =>
      createStudioPieceSpendAuthorizationV3({
        reservationId,
        authorizationId: quote.item.id,
        quote,
        confirmedAt: '2026-08-30T00:04:00.000Z',
        projectRevisionAtAuthorization: 6,
        provider: imageProvider,
        cancellationPolicy: 'queued_and_running',
        idempotencyKey: 'idempotency_piece_1',
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_authorization' }));
    expect(() =>
      createStudioPieceSpendAuthorizationV3({
        reservationId,
        authorizationId: 'authorization_piece_1',
        quote,
        confirmedAt: quote.expiresAt,
        projectRevisionAtAuthorization: 6,
        provider: imageProvider,
        cancellationPolicy: 'queued_and_running',
        idempotencyKey: 'idempotency_piece_1',
      })
    ).toThrow(expect.objectContaining({ code: 'expired_quote' }));
    expect(() =>
      createStudioPieceSpendAuthorizationV3({
        reservationId,
        authorizationId: 'authorization_piece_1',
        quote,
        confirmedAt: '2026-08-30T00:04:00.000Z',
        projectRevisionAtAuthorization: 5,
        provider: imageProvider,
        cancellationPolicy: 'queued_and_running',
        idempotencyKey: 'idempotency_piece_1',
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_authorization' }));
    expect(() =>
      createStudioPieceSpendAuthorizationV3({
        reservationId,
        authorizationId: 'authorization_piece_1',
        quote,
        confirmedAt: '2026-08-30T00:04:00.000Z',
        projectRevisionAtAuthorization: 4,
        provider: imageProvider,
        cancellationPolicy: 'queued_and_running',
        idempotencyKey: 'idempotency_piece_1',
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_authorization' }));
    expect(() =>
      createStudioPieceSpendAuthorizationV3({
        reservationId,
        authorizationId: 'authorization_piece_1',
        quote,
        confirmedAt: '2026-08-30T00:04:00.000Z',
        projectRevisionAtAuthorization: 6,
        provider: { ...imageProvider, model: 'other-model' },
        cancellationPolicy: 'queued_and_running',
        idempotencyKey: 'idempotency_piece_1',
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_provider_binding' }));
  });

  it('rejects accessor-backed authorization input without invoking it', () => {
    let getterCalls = 0;
    const input = {
      reservationId,
      authorizationId: 'authorization_piece_1',
      quote: makePieceQuote(),
      projectRevisionAtAuthorization: 6,
      provider: imageProvider,
      cancellationPolicy: 'queued_and_running',
      idempotencyKey: 'idempotency_piece_1',
    } as Record<string, unknown>;
    Object.defineProperty(input, 'confirmedAt', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return '2026-08-30T00:04:00.000Z';
      },
    });

    expect(() => createStudioPieceSpendAuthorizationV3(input as never)).toThrow(
      expect.objectContaining({ code: 'invalid_authorization' })
    );
    expect(getterCalls).toBe(0);

    expect(() =>
      createStudioPieceSpendAuthorizationV3({
        reservationId,
        authorizationId: 'authorization_piece_1',
        quote: makePieceQuote(),
        confirmedAt: '2026-08-30T00:04:00.000Z',
        projectRevisionAtAuthorization: 6,
        provider: imageProvider,
        cancellationPolicy: 'queued_and_running',
        idempotencyKey: 'idempotency_piece_1',
        extra: true,
      } as never)
    ).toThrow(expect.objectContaining({ code: 'invalid_authorization' }));
  });

  it('derives an exact fixed-image receipt and correlates its Job', () => {
    const authorization = makePieceAuthorization();
    const receipt = createStudioPieceSpendReceiptV3({
      reservationId,
      authorization,
      jobId: 'job_piece_1',
      recordedAt: '2026-08-30T00:04:30.000Z',
    });
    expect(receipt).toMatchObject({
      authorizationId: authorization.id,
      quoteId: authorization.quote.id,
      quoteRevision: 1,
      purpose: 'piece_image',
      rateUnit: 'generation',
      generationCount: 1,
      totalMinorUnits: 20,
    });
    expect('durationSeconds' in receipt).toBe(false);
    expect(
      studioPieceSpendReceiptMatchesJobV3(
        receipt,
        authorization,
        {
          id: 'job_piece_1',
          authorizationId: authorization.id,
          authorizationItemId: authorization.quote.item.id,
          idempotencyKey: authorization.idempotencyKey.key,
        },
        reservationId
      )
    ).toBe(true);

    let receiptGetterReads = 0;
    const accessorReceipt = { ...receipt } as Record<string, unknown>;
    Object.defineProperty(accessorReceipt, 'recordedAt', {
      enumerable: true,
      get: () => {
        receiptGetterReads += 1;
        return receipt.recordedAt;
      },
    });
    expect(
      studioPieceSpendReceiptMatchesJobV3(
        accessorReceipt as never,
        authorization,
        {
          id: 'job_piece_1',
          authorizationId: authorization.id,
          authorizationItemId: authorization.quote.item.id,
          idempotencyKey: authorization.idempotencyKey.key,
        },
        reservationId
      )
    ).toBe(false);
    expect(receiptGetterReads).toBe(0);

    let jobProxyReads = 0;
    const proxiedJob = new Proxy(
      {
        id: 'job_piece_1',
        authorizationId: authorization.id,
        authorizationItemId: authorization.quote.item.id,
        idempotencyKey: authorization.idempotencyKey.key,
      },
      {
        get: (target, property, receiver) => {
          jobProxyReads += 1;
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(studioPieceSpendReceiptMatchesJobV3(receipt, authorization, proxiedJob, reservationId)).toBe(false);
    expect(jobProxyReads).toBe(0);
    expect(
      studioPieceSpendReceiptMatchesJobV3(
        { ...receipt, extra: true } as never,
        authorization,
        proxiedJob,
        reservationId
      )
    ).toBe(false);
    expect(
      studioPieceSpendReceiptMatchesJobV3(
        receipt,
        authorization,
        {
          id: 'job_piece_1',
          authorizationId: authorization.id,
          authorizationItemId: authorization.quote.item.id,
          idempotencyKey: 'wrong_key',
        },
        reservationId
      )
    ).toBe(false);

    const reordered = Object.fromEntries(Object.entries(receipt).toReversed()) as typeof receipt;
    expect(
      studioPieceSpendReceiptMatchesJobV3(
        reordered,
        authorization,
        {
          id: 'job_piece_1',
          authorizationId: authorization.id,
          authorizationItemId: authorization.quote.item.id,
          idempotencyKey: authorization.idempotencyKey.key,
        },
        reservationId
      )
    ).toBe(true);

    expect(() =>
      createStudioPieceSpendReceiptV3({
        reservationId,
        authorization,
        jobId: { toString: () => 'job_piece_1' } as never,
        recordedAt: '2026-08-30T00:04:30.000Z',
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_receipt' }));
    expect(() =>
      createStudioPieceSpendReceiptV3({
        reservationId,
        authorization,
        jobId: 'job_piece_1',
        recordedAt: '2026-08-30T00:03:59.999Z',
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_receipt' }));

    let getterCalls = 0;
    const hostileReceiptInput = {
      reservationId,
      authorization,
      recordedAt: '2026-08-30T00:04:30.000Z',
    } as Record<string, unknown>;
    Object.defineProperty(hostileReceiptInput, 'jobId', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'job_piece_1';
      },
    });
    expect(() => createStudioPieceSpendReceiptV3(hostileReceiptInput as never)).toThrow(
      expect.objectContaining({ code: 'invalid_receipt' })
    );
    expect(getterCalls).toBe(0);
    expect(() =>
      createStudioPieceSpendReceiptV3({
        reservationId,
        authorization,
        jobId: 'job_piece_1',
        recordedAt: '2026-08-30T00:04:30.000Z',
        extra: true,
      } as never)
    ).toThrow(expect.objectContaining({ code: 'invalid_receipt' }));
  });

  it('requires duplicate-charge acknowledgement only for submission-unknown retry', () => {
    const timestamp = '2026-08-30T00:04:00.000Z';
    expect(
      studioPieceDuplicateChargeAcknowledgementIsValidV3({
        retryReason: 'submission_unknown',
        duplicateChargeAcknowledged: true,
        duplicateChargeAcknowledgedAt: timestamp,
      })
    ).toBe(true);
    expect(
      studioPieceDuplicateChargeAcknowledgementIsValidV3({
        retryReason: 'submission_unknown',
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
      })
    ).toBe(false);
    for (const retryReason of [null, 'provider_failure', 'variation_grid', 'cancelled'] as const) {
      expect(
        studioPieceDuplicateChargeAcknowledgementIsValidV3({
          retryReason,
          duplicateChargeAcknowledged: false,
          duplicateChargeAcknowledgedAt: null,
        })
      ).toBe(true);
      expect(
        studioPieceDuplicateChargeAcknowledgementIsValidV3({
          retryReason,
          duplicateChargeAcknowledged: true,
          duplicateChargeAcknowledgedAt: timestamp,
        })
      ).toBe(false);
    }
    expect(
      studioPieceDuplicateChargeAcknowledgementIsValidV3({
        retryReason: 'unknown_reason' as never,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
      })
    ).toBe(false);

    let getterReads = 0;
    const hostileAcknowledgement = {
      retryReason: 'provider_failure',
      duplicateChargeAcknowledgedAt: null,
    } as Record<string, unknown>;
    Object.defineProperty(hostileAcknowledgement, 'duplicateChargeAcknowledged', {
      enumerable: true,
      get: () => {
        getterReads += 1;
        return false;
      },
    });
    expect(studioPieceDuplicateChargeAcknowledgementIsValidV3(hostileAcknowledgement as never)).toBe(false);
    expect(getterReads).toBe(0);
    expect(
      studioPieceDuplicateChargeAcknowledgementIsValidV3({
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
        extra: true,
      } as never)
    ).toBe(false);
  });
});
