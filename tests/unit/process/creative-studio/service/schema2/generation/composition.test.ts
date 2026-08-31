/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';

import {
  STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION,
  STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION_V3,
  STUDIO_MAX_GENERATION_PROMPT_LENGTH,
  STUDIO_MAX_SHOOTING_SCRIPT_LENGTH,
  STUDIO_MAX_STORY_LENGTH,
  type StudioGenerationCompositionInputSnapshotV2,
  type StudioGenerationReferenceInputSnapshot,
  type StudioMediaModelRef,
} from '@/common/types/project/creativeStudioTypes';
import {
  composeStudioGenerationV2,
  composeStudioPieceGenerationV3,
  deriveStudioPieceInstructionProfileV3,
  deriveStudioInstructionProfileV2,
  recomposeStudioGenerationV2,
  studioGenerationCompositionMatchesAuthorityV2,
  studioGenerationCompositionDigestV2,
  studioGenerationCompositionsEqualV2,
  normalizeStudioPieceWordsV3,
  studioPieceGenerationCompositionMatchesAuthorityV3,
  validateStudioPieceGenerationCompositionV3,
} from '@/process/services/creative-studio/service/schema2/generation/composition';

const route: StudioMediaModelRef = {
  providerId: 'provider_image',
  adapterId: 'weprompt-image-v1',
  model: 'image-model-1',
};

const references: StudioGenerationReferenceInputSnapshot[] = [
  {
    referenceId: 'reference_ming',
    kind: 'character',
    assetId: 'asset_ming',
    sha256: 'a'.repeat(64),
  },
  {
    referenceId: 'reference_dai_pai_dong',
    kind: 'background',
    assetId: 'asset_dai_pai_dong',
    sha256: 'b'.repeat(64),
  },
];

const shotSource: Extract<StudioGenerationCompositionInputSnapshotV2['source'], { kind: 'shot' }> = {
  kind: 'shot',
  beatId: 'beat_reunion',
  story: 'Ming finds Mei at their old dai pai dong after midnight.',
  shotId: 'shot_arrival',
  shootingScript: 'Slow dolly in. Ming steps beneath the red awning; Mei looks up from the counter.',
};

const composeBoard = () =>
  composeStudioGenerationV2({
    projectRevision: 9,
    brief: 'A warm, rain-soaked reunion in Hong Kong.',
    rules: [
      {
        id: 'rule_brands',
        scope: 'project',
        text: 'Keep every brand fictional.',
        predicate: { kind: 'forbidden_terms', terms: ['Acme'] },
        createdAt: '2026-08-24T00:00:00.000Z',
      },
    ],
    source: shotSource,
    purpose: 'board_still',
    referenceInputs: references,
    aspectRatio: '16:9',
    resolution: '1080p',
    route,
    boardStyle: 'line_art',
    instructionProfile: deriveStudioInstructionProfileV2(route, 'board_still', shotSource),
  });

describe('canonical schema-5 generation composition', () => {
  it('orders Brief, rules, Story, Shooting script, approved references, Board style, settings, and output', () => {
    const composition = composeBoard();
    const headings = [
      'PROJECT BRIEF',
      'PROJECT RULES',
      'STORY',
      'SHOOTING SCRIPT',
      'APPROVED REFERENCES',
      'BOARD STYLE',
      'RENDER SETTINGS',
      'OUTPUT',
    ];
    let prior = -1;
    for (const heading of headings) {
      const next = composition.prompt.indexOf(heading);
      expect(next).toBeGreaterThan(prior);
      prior = next;
    }
    expect(composition.prompt).toContain('Ming finds Mei at their old dai pai dong after midnight.');
    expect(composition.prompt).toContain(
      'Slow dolly in. Ming steps beneath the red awning; Mei looks up from the counter.'
    );
    expect(composition.prompt).toContain('1. Character reference_ming: preserve the approved identity');
    expect(composition.prompt).toContain('2. Background reference_dai_pai_dong: preserve the approved layout');
    expect(composition.prompt).toContain('Model: image-model-1');
    expect(composition.prompt).toContain('Instruction profile: weprompt-image-v1.board-still.v1');
    expect(composition.prompt).toContain('Use clean line-art');
    expect(composition.prompt).toContain('Create exactly one production storyboard panel for exactly this Shot.');
  });

  it('freezes the exact revision, route, prose, ordered reference ids/assets/hashes, and canonical profile', () => {
    const composition = composeBoard();
    expect(composition.inputs).toEqual({
      schemaVersion: STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION,
      projectRevision: 9,
      brief: 'A warm, rain-soaked reunion in Hong Kong.',
      rules: expect.any(Array),
      source: shotSource,
      purpose: 'board_still',
      referenceInputs: references,
      aspectRatio: '16:9',
      resolution: '1080p',
      route,
      boardStyle: 'line_art',
      instructionProfile: 'weprompt-image-v1.board-still.v1',
    });
    const same = composeBoard();
    expect(studioGenerationCompositionsEqualV2(composition, same)).toBe(true);
    expect(studioGenerationCompositionDigestV2(composition)).toBe(studioGenerationCompositionDigestV2(same));
  });

  it('matches frozen historical prompt bytes to authority without current-code recomposition', () => {
    const historical = composeBoard();
    historical.prompt = historical.prompt.replace(
      /OUTPUT\n[\s\S]*$/,
      'OUTPUT\nLegacy provider instruction preserved exactly.'
    );
    const authority = {
      projectRevision: 9,
      target: { kind: 'shot' as const, shotId: shotSource.shotId },
      purpose: 'board_still' as const,
      provider: route,
    };

    expect(recomposeStudioGenerationV2(historical).prompt).not.toBe(historical.prompt);
    expect(studioGenerationCompositionMatchesAuthorityV2(historical, authority)).toBe(true);
    expect(studioGenerationCompositionMatchesAuthorityV2(historical, { ...authority, projectRevision: 10 })).toBe(
      false
    );
    expect(
      studioGenerationCompositionMatchesAuthorityV2(historical, {
        ...authority,
        target: { kind: 'shot', shotId: 'shot_other' },
      })
    ).toBe(false);
    expect(
      studioGenerationCompositionMatchesAuthorityV2(historical, {
        ...authority,
        provider: { ...route, model: 'other-model' },
      })
    ).toBe(false);
  });

  it('canonicalizes nested source, rule, predicate, and reference key order', () => {
    const shuffledSource = {
      shootingScript: shotSource.shootingScript,
      shotId: shotSource.shotId,
      story: shotSource.story,
      beatId: shotSource.beatId,
      kind: shotSource.kind,
    } as typeof shotSource;
    const shuffledRule = {
      createdAt: '2026-08-24T00:00:00.000Z',
      predicate: { terms: ['Acme'], kind: 'forbidden_terms' as const },
      text: 'Keep every brand fictional.',
      scope: 'project' as const,
      id: 'rule_brands',
    };
    const shuffledReferences = references.map(
      (reference) =>
        ({
          sha256: reference.sha256,
          assetId: reference.assetId,
          kind: reference.kind,
          referenceId: reference.referenceId,
        }) as StudioGenerationReferenceInputSnapshot
    );
    const composition = composeStudioGenerationV2({
      projectRevision: 9,
      brief: 'A warm, rain-soaked reunion in Hong Kong.',
      rules: [shuffledRule],
      source: shuffledSource,
      purpose: 'board_still',
      referenceInputs: shuffledReferences,
      aspectRatio: '16:9',
      resolution: '1080p',
      route,
      boardStyle: 'line_art',
      instructionProfile: deriveStudioInstructionProfileV2(route, 'board_still', shuffledSource),
    });

    expect(Object.keys(composition.inputs.source)).toEqual(['kind', 'beatId', 'story', 'shotId', 'shootingScript']);
    expect(Object.keys(composition.inputs.rules[0]!)).toEqual(['id', 'scope', 'text', 'predicate', 'createdAt']);
    expect(Object.keys(composition.inputs.rules[0]!.predicate!)).toEqual(['kind', 'terms']);
    expect(Object.keys(composition.inputs.referenceInputs[0]!)).toEqual(['referenceId', 'kind', 'assetId', 'sha256']);
    expect(studioGenerationCompositionsEqualV2(composition, composeBoard())).toBe(true);
    expect(studioGenerationCompositionDigestV2(composition)).toBe(studioGenerationCompositionDigestV2(composeBoard()));
  });

  it('rejects a persisted composition whose nested records are not in canonical byte order', () => {
    const persisted = composeBoard();
    persisted.inputs.source = {
      shootingScript: shotSource.shootingScript,
      shotId: shotSource.shotId,
      story: shotSource.story,
      beatId: shotSource.beatId,
      kind: shotSource.kind,
    } as typeof shotSource;
    persisted.inputs.rules[0] = {
      createdAt: persisted.inputs.rules[0]!.createdAt,
      predicate: {
        terms: [...persisted.inputs.rules[0]!.predicate!.terms],
        kind: 'forbidden_terms',
      },
      text: persisted.inputs.rules[0]!.text,
      scope: persisted.inputs.rules[0]!.scope,
      id: persisted.inputs.rules[0]!.id,
    };
    persisted.inputs.referenceInputs[0] = {
      sha256: references[0]!.sha256,
      assetId: references[0]!.assetId,
      kind: references[0]!.kind,
      referenceId: references[0]!.referenceId,
    } as StudioGenerationReferenceInputSnapshot;

    const recomposed = recomposeStudioGenerationV2(persisted);
    expect(Object.keys(recomposed.inputs.source)).toEqual(['kind', 'beatId', 'story', 'shotId', 'shootingScript']);
    expect(studioGenerationCompositionsEqualV2(persisted, recomposed)).toBe(false);
  });

  it('uses distinct character and background reference-image instructions', () => {
    const characterSource = {
      kind: 'project_reference' as const,
      referenceId: 'reference_ming',
      referenceKind: 'character' as const,
      prompt: 'Ming, late 20s, short black hair, red rain jacket.',
    };
    const backgroundSource = {
      kind: 'project_reference' as const,
      referenceId: 'reference_dai_pai_dong',
      referenceKind: 'background' as const,
      prompt: 'A compact dai pai dong beneath a red awning at night.',
    };
    const composeReference = (source: typeof characterSource | typeof backgroundSource) =>
      composeStudioGenerationV2({
        projectRevision: 9,
        brief: 'A warm reunion.',
        rules: [],
        source,
        purpose: 'reference_image',
        referenceInputs: [],
        aspectRatio: '16:9',
        resolution: '1080p',
        route,
        boardStyle: null,
        instructionProfile: deriveStudioInstructionProfileV2(route, 'reference_image', source),
      });

    const character = composeReference(characterSource);
    const background = composeReference(backgroundSource);
    expect(character.prompt).toContain('ONE SINGLE clean character reference photograph');
    expect(character.prompt).toContain('not a character sheet, not a turnaround');
    expect(character.prompt).not.toContain('with no characters');
    expect(background.prompt).toContain('ONE SINGLE clean environment reference photograph with no characters');
    expect(background.prompt).toContain('Not a grid or contact sheet');
    expect(character.inputs.instructionProfile).toBe('weprompt-image-v1.reference-character.v1');
    expect(background.inputs.instructionProfile).toBe('weprompt-image-v1.reference-background.v1');
  });

  it('uses purpose-specific first-frame and video output instructions without Board style', () => {
    const composeShotPurpose = (purpose: 'seed_still' | 'video_take') =>
      composeStudioGenerationV2({
        projectRevision: 9,
        brief: '',
        rules: [],
        source: shotSource,
        purpose,
        referenceInputs: purpose === 'video_take' ? [] : references,
        aspectRatio: '16:9',
        resolution: '1080p',
        route: {
          providerId: 'provider_video',
          adapterId: purpose === 'video_take' ? 'openrouter-video-v1' : 'weprompt-image-v1',
          model: purpose === 'video_take' ? 'video-model-1' : 'image-model-1',
        },
        boardStyle: null,
        instructionProfile: deriveStudioInstructionProfileV2(
          {
            providerId: 'provider_video',
            adapterId: purpose === 'video_take' ? 'openrouter-video-v1' : 'weprompt-image-v1',
            model: purpose === 'video_take' ? 'video-model-1' : 'image-model-1',
          },
          purpose,
          shotSource
        ),
      });

    expect(composeShotPurpose('seed_still').prompt).toContain('production-ready first-frame still');
    expect(composeShotPurpose('video_take').prompt).toContain('one continuous video take');
    expect(composeShotPurpose('video_take').prompt).not.toContain('APPROVED REFERENCES');
  });

  it('rejects renderer-shaped/cross-purpose inputs instead of silently normalizing them', () => {
    expect(() =>
      composeStudioGenerationV2({
        ...composeBoard().inputs,
        schemaVersion: undefined as never,
        instructionProfile: 'renderer-written-profile',
      })
    ).toThrow(TypeError);
    expect(() =>
      composeStudioGenerationV2({
        ...composeBoard().inputs,
        schemaVersion: undefined as never,
        purpose: 'video_take',
        referenceInputs: references,
        boardStyle: null,
        route: { providerId: 'provider_video', adapterId: 'openrouter-video-v1', model: 'video-model-1' },
        instructionProfile: 'openrouter-video-v1.video-take.v1',
      })
    ).toThrow('video requests cannot carry reference inputs');
  });

  it('rejects duplicate semantic/asset references and invalid source/profile combinations', () => {
    const base = composeBoard().inputs;
    expect(() =>
      composeStudioGenerationV2({
        ...base,
        schemaVersion: undefined as never,
        referenceInputs: [references[0]!, { ...references[1]!, referenceId: references[0]!.referenceId }],
      })
    ).toThrow('referenceInputs must not repeat');
    expect(() =>
      composeStudioGenerationV2({
        ...base,
        schemaVersion: undefined as never,
        source: {
          kind: 'project_reference',
          referenceId: 'reference_ming',
          referenceKind: 'character',
          prompt: 'Ming.',
        },
      })
    ).toThrow('reference sources require reference_image');
  });

  it('permits empty authored Shot fields only when another canonical authored source remains', () => {
    const emptyShot = { ...shotSource, story: '', shootingScript: '' };
    expect(
      composeStudioGenerationV2({
        projectRevision: 1,
        brief: 'The complete visual premise is in the Brief.',
        rules: [],
        source: emptyShot,
        purpose: 'seed_still',
        referenceInputs: [],
        aspectRatio: '16:9',
        resolution: '720p',
        route,
        boardStyle: null,
        instructionProfile: deriveStudioInstructionProfileV2(route, 'seed_still', emptyShot),
      }).prompt
    ).toContain('The complete visual premise is in the Brief.');
    expect(() =>
      composeStudioGenerationV2({
        projectRevision: 1,
        brief: '',
        rules: [],
        source: emptyShot,
        purpose: 'seed_still',
        referenceInputs: [],
        aspectRatio: '16:9',
        resolution: '720p',
        route,
        boardStyle: null,
        instructionProfile: deriveStudioInstructionProfileV2(route, 'seed_still', emptyShot),
      })
    ).toThrow('generation source is empty');
  });

  it('enforces authored-field and final prompt bounds', () => {
    expect(() =>
      composeStudioGenerationV2({
        ...composeBoard().inputs,
        schemaVersion: undefined as never,
        source: { ...shotSource, story: 's'.repeat(STUDIO_MAX_STORY_LENGTH + 1) },
      })
    ).toThrow('story exceeds');
    expect(() =>
      composeStudioGenerationV2({
        ...composeBoard().inputs,
        schemaVersion: undefined as never,
        brief: 'b'.repeat(16 * 1024),
        source: {
          ...shotSource,
          story: 's'.repeat(STUDIO_MAX_STORY_LENGTH),
          shootingScript: 'x'.repeat(STUDIO_MAX_SHOOTING_SCRIPT_LENGTH),
        },
      })
    ).toThrow('composed prompt is empty or exceeds');
  });
});

describe('inactive schema-2 Piece generation composition', () => {
  const pieceRoute: StudioMediaModelRef = {
    providerId: 'provider_image',
    adapterId: 'weprompt-image-v1',
    model: 'image-model-2',
  };
  const composePiece = () =>
    composeStudioPieceGenerationV3({
      projectRevisionAtPreparation: 11,
      authoringRevision: 4,
      authoringFingerprintVersion: 1,
      authoringFingerprint: 'c'.repeat(64),
      brief: 'A quiet, human-scale photographic study.',
      rules: [],
      source: {
        kind: 'piece',
        pieceId: 'piece_salt_flat',
        words: '  Bình minh\ttrên   cánh đồng muối  ',
        settings: { aspectRatio: '4:3', resolution: '1080p' },
      },
      purpose: 'piece_image',
      conditioningInputs: [],
      route: pieceRoute,
      instructionProfile: deriveStudioPieceInstructionProfileV3(pieceRoute),
    });

  it('normalizes Unicode words and freezes exact schema-2 Piece authority', () => {
    const composition = composePiece();
    expect(normalizeStudioPieceWordsV3('  Bình minh\ttrên   cánh đồng muối  ')).toBe('Bình minh trên cánh đồng muối');
    expect(composition.inputs).toEqual({
      schemaVersion: STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION_V3,
      projectRevisionAtPreparation: 11,
      authoringRevision: 4,
      authoringFingerprintVersion: 1,
      authoringFingerprint: 'c'.repeat(64),
      brief: 'A quiet, human-scale photographic study.',
      rules: [],
      source: {
        kind: 'piece',
        pieceId: 'piece_salt_flat',
        words: 'Bình minh trên cánh đồng muối',
        settings: { aspectRatio: '4:3', resolution: '1080p' },
      },
      purpose: 'piece_image',
      conditioningInputs: [],
      route: pieceRoute,
      instructionProfile: 'weprompt-image-v1.piece-image.v1',
    });
    expect(composition.prompt).toContain('PHOTO REQUEST\nBình minh trên cánh đồng muối');
    expect(composition.prompt).toContain('Create exactly one standalone photograph.');
    expect(validateStudioPieceGenerationCompositionV3(composition)).toBe(true);
    expect(
      studioPieceGenerationCompositionMatchesAuthorityV3(composition, {
        projectRevisionAtPreparation: 11,
        authoringRevision: 4,
        authoringFingerprint: 'c'.repeat(64),
        target: { kind: 'piece', pieceId: 'piece_salt_flat' },
        provider: pieceRoute,
      })
    ).toBe(true);
  });

  it('validates historical prompt bytes without recomposition', () => {
    const historical = composePiece();
    historical.prompt = 'A historical provider prompt whose former template no longer exists.';
    expect(validateStudioPieceGenerationCompositionV3(historical)).toBe(true);
    expect(composePiece().prompt).not.toBe(historical.prompt);

    historical.inputs.instructionProfile = 'weprompt-image-v1.piece-image.v2';
    expect(validateStudioPieceGenerationCompositionV3(historical)).toBe(true);

    const { schemaVersion: ignoredSchemaVersion, ...currentInput } = composePiece().inputs;
    void ignoredSchemaVersion;
    expect(() =>
      composeStudioPieceGenerationV3({
        ...currentInput,
        instructionProfile: 'weprompt-image-v1.piece-image.v2',
      })
    ).toThrow('instructionProfile is not canonical');

    for (const instructionProfile of [
      'weprompt-image-v1.piece-image.v0',
      'weprompt-image-v1.piece-image.v01',
      'openrouter-video-v1.piece-image.v2',
      'weprompt-image-v1.piece-image.v2 ',
    ]) {
      expect(
        validateStudioPieceGenerationCompositionV3({
          ...historical,
          inputs: { ...historical.inputs, instructionProfile },
        })
      ).toBe(false);
    }
  });

  it('fails closed on source, purpose, conditioning, adapter, and normalization drift', () => {
    const base = composePiece();
    const { schemaVersion: ignoredSchemaVersion, ...input } = base.inputs;
    void ignoredSchemaVersion;
    expect(validateStudioPieceGenerationCompositionV3({ ...base, extra: true })).toBe(false);
    expect(validateStudioPieceGenerationCompositionV3({ ...base, prompt: '   ' })).toBe(false);
    expect(
      validateStudioPieceGenerationCompositionV3({
        ...base,
        inputs: { ...base.inputs, conditioningInputs: [{ kind: 'seed_still' }] },
      })
    ).toBe(false);
    expect(
      validateStudioPieceGenerationCompositionV3({
        ...base,
        inputs: { ...base.inputs, source: { ...base.inputs.source, words: ` ${base.inputs.source.words}` } },
      })
    ).toBe(false);
    expect(() =>
      composeStudioPieceGenerationV3({
        ...input,
        route: { ...pieceRoute, adapterId: 'openrouter-video-v1' },
        instructionProfile: 'openrouter-video-v1.piece-image.v1',
      })
    ).toThrow('image adapter');
    expect(() =>
      composeStudioPieceGenerationV3({
        ...input,
        purpose: 'video_take' as never,
      })
    ).toThrow('Piece sources require piece_image');
  });

  it('rejects accessor and Proxy graphs without invoking hostile input', () => {
    const base = composePiece();
    const { schemaVersion: ignoredSchemaVersion, ...input } = base.inputs;
    void ignoredSchemaVersion;
    let getterCalls = 0;
    const source = { ...input.source } as Record<string, unknown>;
    Object.defineProperty(source, 'words', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'A different photograph.';
      },
    });

    expect(() => composeStudioPieceGenerationV3({ ...input, source } as never)).toThrow(TypeError);
    expect(getterCalls).toBe(0);
    expect(
      validateStudioPieceGenerationCompositionV3({
        ...base,
        inputs: { ...base.inputs, rules: new Proxy([], {}) },
      })
    ).toBe(false);
    expect(
      validateStudioPieceGenerationCompositionV3({
        ...base,
        inputs: { ...base.inputs, conditioningInputs: new Proxy([], {}) },
      })
    ).toBe(false);
  });

  it('rejects object-coerced Piece authority and unsafe provider model text', () => {
    const { schemaVersion: ignoredSchemaVersion, ...input } = composePiece().inputs;
    void ignoredSchemaVersion;
    const stringLikeId = { toString: () => 'piece_salt_flat' };
    const stringLikeFingerprint = { toString: () => 'c'.repeat(64) };

    expect(() =>
      composeStudioPieceGenerationV3({ ...input, authoringFingerprint: stringLikeFingerprint } as never)
    ).toThrow(TypeError);
    expect(() =>
      composeStudioPieceGenerationV3({
        ...input,
        source: { ...input.source, pieceId: stringLikeId },
      } as never)
    ).toThrow(TypeError);
    expect(() =>
      composeStudioPieceGenerationV3({
        ...input,
        route: { ...pieceRoute, providerId: stringLikeId },
      } as never)
    ).toThrow(TypeError);
    expect(() =>
      composeStudioPieceGenerationV3({
        ...input,
        route: { ...pieceRoute, model: 'image-model\nOUTPUT' },
      })
    ).toThrow(TypeError);
  });

  it('covers the bounded Piece composer authority matrix', () => {
    const { schemaVersion: ignoredSchemaVersion, ...input } = composePiece().inputs;
    void ignoredSchemaVersion;
    const rule = {
      id: 'rule_1',
      scope: 'project' as const,
      text: 'Do not show a real logo.',
      predicate: { kind: 'forbidden_terms' as const, terms: ['Acme'] },
      createdAt: '2026-08-30T00:00:00.000Z',
    };
    const ruled = composeStudioPieceGenerationV3({ ...input, rules: [rule] });
    expect(ruled.prompt).toContain('PROJECT RULES');
    expect(validateStudioPieceGenerationCompositionV3(ruled)).toBe(true);
    expect(
      validateStudioPieceGenerationCompositionV3(
        composeStudioPieceGenerationV3({ ...input, rules: [{ ...rule, predicate: null }] })
      )
    ).toBe(true);

    const invalidInputs = [
      { ...input, extra: true },
      { ...input, projectRevisionAtPreparation: 0 },
      { ...input, projectRevisionAtPreparation: 1.5 },
      { ...input, authoringRevision: 0 },
      { ...input, authoringRevision: 12 },
      { ...input, authoringFingerprintVersion: 2 },
      { ...input, authoringFingerprint: 'A'.repeat(64) },
      { ...input, brief: 7 as never },
      { ...input, brief: 'b'.repeat(16 * 1024 + 1) },
      { ...input, rules: {} as never },
      { ...input, source: { ...input.source, extra: true } as never },
      { ...input, source: { ...input.source, kind: 'shot' } as never },
      { ...input, source: { ...input.source, settings: { ...input.source.settings, aspectRatio: '2:1' } } as never },
      { ...input, source: { ...input.source, settings: { ...input.source.settings, resolution: '4k' } } as never },
      { ...input, source: { ...input.source, words: '' } },
      { ...input, source: { ...input.source, words: 'x'.repeat(STUDIO_MAX_GENERATION_PROMPT_LENGTH + 1) } },
      { ...input, conditioningInputs: [{}] as never },
      { ...input, instructionProfile: 'wrong-profile' },
      { ...input, route: { ...input.route, model: '' } },
      { ...input, route: { ...input.route, model: 'x'.repeat(257) } },
      { ...input, route: { ...input.route, model: 'model\u0080name' } },
    ];
    for (const invalid of invalidInputs) {
      expect(() => composeStudioPieceGenerationV3(invalid as never)).toThrow();
    }
    expect(() => normalizeStudioPieceWordsV3(7 as never)).toThrow(TypeError);
  });

  it('covers exact persisted-composition refusal boundaries and authority mismatches', () => {
    const base = composePiece();
    const invalidRecords: unknown[] = [
      null,
      [],
      { ...base, prompt: '' },
      { ...base, prompt: 'x'.repeat(STUDIO_MAX_GENERATION_PROMPT_LENGTH + 1) },
      { ...base, inputs: { ...base.inputs, schemaVersion: 1 } },
      { ...base, inputs: { ...base.inputs, projectRevisionAtPreparation: 0 } },
      { ...base, inputs: { ...base.inputs, authoringRevision: 0 } },
      { ...base, inputs: { ...base.inputs, authoringRevision: 12 } },
      { ...base, inputs: { ...base.inputs, authoringFingerprintVersion: 2 } },
      { ...base, inputs: { ...base.inputs, authoringFingerprint: 'A'.repeat(64) } },
      { ...base, inputs: { ...base.inputs, brief: 'b'.repeat(16 * 1024 + 1) } },
      { ...base, inputs: { ...base.inputs, rules: [{ id: 'bad' }] } },
      { ...base, inputs: { ...base.inputs, source: { ...base.inputs.source, pieceId: '../piece' } } },
      { ...base, inputs: { ...base.inputs, source: { ...base.inputs.source, words: '' } } },
      { ...base, inputs: { ...base.inputs, purpose: 'seed_still' } },
      { ...base, inputs: { ...base.inputs, route: { ...base.inputs.route, providerId: '../provider' } } },
      { ...base, inputs: { ...base.inputs, route: { ...base.inputs.route, model: '' } } },
      { ...base, inputs: { ...base.inputs, instructionProfile: 'wrong-profile' } },
      new Proxy(base, {}),
    ];
    for (const invalid of invalidRecords) expect(validateStudioPieceGenerationCompositionV3(invalid)).toBe(false);

    const authority = {
      projectRevisionAtPreparation: 11,
      authoringRevision: 4,
      authoringFingerprint: 'c'.repeat(64),
      target: { kind: 'piece' as const, pieceId: 'piece_salt_flat' },
      provider: pieceRoute,
    };
    expect(
      studioPieceGenerationCompositionMatchesAuthorityV3(base, {
        ...authority,
        projectRevisionAtPreparation: 12,
      })
    ).toBe(false);
    expect(
      studioPieceGenerationCompositionMatchesAuthorityV3(base, {
        ...authority,
        provider: { ...pieceRoute, model: 'other-model' },
      })
    ).toBe(false);
  });
});
