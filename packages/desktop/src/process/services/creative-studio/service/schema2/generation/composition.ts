/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { types as nodeTypes } from 'node:util';
import { hasRuleToken, renderStudioRulesBlock, STUDIO_RULE_LIMITS } from '@/common/types/project/creativeStudioRules';
import {
  STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
  STUDIO_BOARD_STYLES_V2,
  STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION,
  STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION_V3,
  STUDIO_MAX_GENERATION_PROMPT_LENGTH,
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_MAX_REFERENCE_PROMPT_LENGTH,
  STUDIO_MAX_SHOOTING_SCRIPT_LENGTH,
  STUDIO_MAX_STORY_LENGTH,
  type StudioAspectRatio,
  type StudioBoardStyleV2,
  type StudioBriefRule,
  type StudioGenerationCompositionInputSnapshotV2,
  type StudioGenerationCompositionV2,
  type StudioGenerationReferenceInputSnapshot,
  type StudioGenerationTargetV2,
  type StudioJobPurpose,
  type StudioMediaModelRef,
  type StudioPieceGenerationCompositionInputSnapshotV3,
  type StudioPieceGenerationCompositionV3,
  type StudioPieceGenerationTargetV3,
  type StudioProviderAdapterId,
  type StudioResolution,
} from '@/common/types/project/creativeStudioTypes';

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const ASPECT_RATIOS: ReadonlySet<StudioAspectRatio> = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS: ReadonlySet<StudioResolution> = new Set(['720p', '1080p']);
const ADAPTER_IDS: ReadonlySet<StudioProviderAdapterId> = new Set([
  'weprompt-image-v1',
  'byteplus-seedance-v1',
  'weprompt-media-gateway-v1',
  'openrouter-video-v1',
]);

export type StudioGenerationCompositionInputV2 = Omit<StudioGenerationCompositionInputSnapshotV2, 'schemaVersion'>;

const assertSafeId: (value: unknown, field: string) => asserts value is string = (value, field) => {
  if (typeof value !== 'string' || !SAFE_STUDIO_ID.test(value)) {
    throw new TypeError(`${field} must be a safe Studio ID`);
  }
};

const cloneRoute = (route: StudioMediaModelRef): StudioMediaModelRef => {
  assertSafeId(route.providerId, 'route.providerId');
  if (typeof route.adapterId !== 'string' || !ADAPTER_IDS.has(route.adapterId)) {
    throw new TypeError('route.adapterId is invalid');
  }
  if (
    typeof route.model !== 'string' ||
    route.model.length === 0 ||
    route.model !== route.model.trim() ||
    route.model.length > 256
  ) {
    throw new TypeError('route.model must be a nonempty trimmed model name');
  }
  return { providerId: route.providerId, adapterId: route.adapterId, model: route.model };
};

const cloneRules = (rules: readonly StudioBriefRule[]): StudioBriefRule[] =>
  rules.map((rule) => ({
    id: rule.id,
    scope: rule.scope,
    text: rule.text,
    predicate:
      rule.predicate === null
        ? null
        : {
            kind: rule.predicate.kind,
            terms: [...rule.predicate.terms],
          },
    createdAt: rule.createdAt,
  }));

const cloneSource = (
  source: StudioGenerationCompositionInputSnapshotV2['source']
): StudioGenerationCompositionInputSnapshotV2['source'] =>
  source.kind === 'shot'
    ? {
        kind: source.kind,
        beatId: source.beatId,
        story: source.story,
        shotId: source.shotId,
        shootingScript: source.shootingScript,
      }
    : {
        kind: source.kind,
        referenceId: source.referenceId,
        referenceKind: source.referenceKind,
        prompt: source.prompt,
      };

const cloneReferenceInputs = (
  inputs: readonly StudioGenerationReferenceInputSnapshot[]
): StudioGenerationReferenceInputSnapshot[] => {
  if (!Array.isArray(inputs) || inputs.length > STUDIO_MAX_PROJECT_REFERENCES) {
    throw new RangeError('referenceInputs exceed the Studio reference bound');
  }
  const referenceIds = new Set<string>();
  const assetIds = new Set<string>();
  return inputs.map((input) => {
    assertSafeId(input.referenceId, 'referenceInputs[].referenceId');
    assertSafeId(input.assetId, 'referenceInputs[].assetId');
    if (input.kind !== 'character' && input.kind !== 'background') {
      throw new TypeError('referenceInputs[].kind is invalid');
    }
    if (!LOWERCASE_SHA256.test(input.sha256)) {
      throw new TypeError('referenceInputs[].sha256 must be lowercase SHA-256');
    }
    if (referenceIds.has(input.referenceId) || assetIds.has(input.assetId)) {
      throw new TypeError('referenceInputs must not repeat a semantic reference or asset');
    }
    referenceIds.add(input.referenceId);
    assetIds.add(input.assetId);
    return {
      referenceId: input.referenceId,
      kind: input.kind,
      assetId: input.assetId,
      sha256: input.sha256,
    };
  });
};

const instructionProfile = (
  route: Pick<StudioMediaModelRef, 'adapterId'>,
  purpose: StudioJobPurpose,
  source: StudioGenerationCompositionInputSnapshotV2['source']
): string => {
  if (!ADAPTER_IDS.has(route.adapterId)) throw new TypeError('route.adapterId is invalid');
  if (purpose === 'board_still') return `${route.adapterId}.board-still.v1`;
  if (purpose === 'seed_still') return `${route.adapterId}.seed-still.v1`;
  if (purpose === 'video_take') return `${route.adapterId}.video-take.v1`;
  if (source.kind !== 'project_reference') throw new TypeError('reference_image requires a reference source');
  return source.referenceKind === 'character'
    ? `${route.adapterId}.reference-character.v1`
    : `${route.adapterId}.reference-background.v1`;
};

const referenceOutputInstruction = (kind: 'character' | 'background'): string =>
  kind === 'character'
    ? 'Create ONE SINGLE clean character reference photograph showing one figure in one unified scene. Keep identity, age, wardrobe, proportions, and art style precise. Not a grid, not a contact sheet, not a character sheet, not a turnaround: no panels, split screen, repeated figures, captions, borders, or UI.'
    : 'Create ONE SINGLE clean environment reference photograph with no characters, establishing the recurring location, layout, materials, palette, period, and art style. Not a grid or contact sheet: no panels, split screen, captions, borders, or UI.';

const shotOutputInstruction = (purpose: Exclude<StudioJobPurpose, 'reference_image'>): string => {
  if (purpose === 'board_still') {
    return 'Create exactly one production storyboard panel for exactly this Shot. Do not create a grid, contact sheet, split frame, caption, label, border, or UI.';
  }
  if (purpose === 'seed_still') {
    return 'Create exactly one production-ready first-frame still for this Shot. Do not add captions, borders, UI, or alternate panels.';
  }
  return 'Create exactly one continuous video take for this Shot. Follow the authored movement, camera, performance, sound, and dialogue details without adding captions, borders, or UI.';
};

const boardStyleInstruction = (style: StudioBoardStyleV2): string => {
  if (!STUDIO_BOARD_STYLES_V2.includes(style)) throw new TypeError('boardStyle is invalid');
  if (style === 'grey_tone') return 'Use a restrained grey-tone storyboard drawing with clear staging and silhouettes.';
  if (style === 'line_art') return 'Use clean line-art with sparse shading and clear staging and silhouettes.';
  return 'Use a simplified colour-key treatment with a limited palette and clear staging and silhouettes.';
};

const composePrompt = (inputs: StudioGenerationCompositionInputSnapshotV2): string => {
  const brief = inputs.brief.trim();
  const rules = renderStudioRulesBlock(inputs.rules).trim();
  const sourceSections: string[] = [];
  let authoredSource = brief;
  if (inputs.source.kind === 'shot') {
    const story = inputs.source.story.trim();
    const shootingScript = inputs.source.shootingScript.trim();
    authoredSource += story + shootingScript;
    sourceSections.push(`STORY\n${story}`, `SHOOTING SCRIPT\n${shootingScript}`);
  } else {
    const prompt = inputs.source.prompt.trim();
    authoredSource += prompt;
    sourceSections.push(`REFERENCE DESCRIPTION\n${prompt}`);
  }
  if (authoredSource.length === 0) throw new RangeError('generation source is empty');

  const referenceGuidance = inputs.referenceInputs.map((reference, index) =>
    reference.kind === 'character'
      ? `${index + 1}. Character ${reference.referenceId}: preserve the approved identity, wardrobe, proportions, and art style.`
      : `${index + 1}. Background ${reference.referenceId}: preserve the approved layout, materials, palette, period, and art style.`
  );
  const output =
    inputs.source.kind === 'project_reference'
      ? referenceOutputInstruction(inputs.source.referenceKind)
      : shotOutputInstruction(inputs.purpose as Exclude<StudioJobPurpose, 'reference_image'>);
  const settings = [
    `Purpose: ${inputs.purpose}`,
    `Aspect ratio: ${inputs.aspectRatio}`,
    `Resolution: ${inputs.resolution}`,
    `Model: ${inputs.route.model}`,
    `Instruction profile: ${inputs.instructionProfile}`,
  ];
  const sections = [
    `PROJECT BRIEF\n${brief}`,
    ...(rules.length === 0 ? [] : [rules]),
    ...sourceSections,
    ...(referenceGuidance.length === 0 ? [] : [`APPROVED REFERENCES\n${referenceGuidance.join('\n')}`]),
    ...(inputs.boardStyle === null ? [] : [`BOARD STYLE\n${boardStyleInstruction(inputs.boardStyle)}`]),
    `RENDER SETTINGS\n${settings.join('\n')}`,
    `OUTPUT\n${output}`,
  ];
  const prompt = sections.join('\n\n');
  if (prompt.length === 0 || prompt.length > STUDIO_MAX_GENERATION_PROMPT_LENGTH) {
    throw new RangeError('composed prompt is empty or exceeds the generation prompt bound');
  }
  return prompt;
};

/** Composes and freezes the one main-owned prompt used by quote readout and provider dispatch. */
export const composeStudioGenerationV2 = (input: StudioGenerationCompositionInputV2): StudioGenerationCompositionV2 => {
  if (!Number.isSafeInteger(input.projectRevision) || input.projectRevision < 1) {
    throw new RangeError('projectRevision must be a positive safe integer');
  }
  if (input.brief.length > 16 * 1024) throw new RangeError('brief exceeds the Studio bound');
  if (!ASPECT_RATIOS.has(input.aspectRatio) || !RESOLUTIONS.has(input.resolution)) {
    throw new TypeError('render dimensions are invalid');
  }
  const source = cloneSource(input.source);
  if (source.kind === 'shot') {
    assertSafeId(source.beatId, 'source.beatId');
    assertSafeId(source.shotId, 'source.shotId');
    if (source.story.length > STUDIO_MAX_STORY_LENGTH) throw new RangeError('story exceeds the Studio bound');
    if (source.shootingScript.length > STUDIO_MAX_SHOOTING_SCRIPT_LENGTH) {
      throw new RangeError('shootingScript exceeds the Studio bound');
    }
    if (input.purpose === 'reference_image') throw new TypeError('reference_image requires a reference source');
  } else {
    assertSafeId(source.referenceId, 'source.referenceId');
    if (source.prompt.length === 0 || source.prompt.length > STUDIO_MAX_REFERENCE_PROMPT_LENGTH) {
      throw new RangeError('reference prompt is empty or exceeds the Studio bound');
    }
    if (input.purpose !== 'reference_image') throw new TypeError('reference sources require reference_image');
  }
  if ((input.purpose === 'board_still') !== (input.boardStyle !== null)) {
    throw new TypeError('boardStyle must be present only for board_still');
  }
  if (input.purpose === 'video_take' && input.referenceInputs.length > 0) {
    throw new TypeError('video requests cannot carry reference inputs');
  }
  const derivedProfile = instructionProfile(input.route, input.purpose, source);
  if (input.instructionProfile !== derivedProfile) throw new TypeError('instructionProfile is not canonical');
  const inputs: StudioGenerationCompositionInputSnapshotV2 = {
    schemaVersion: STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION,
    projectRevision: input.projectRevision,
    brief: input.brief,
    rules: cloneRules(input.rules),
    source,
    purpose: input.purpose,
    referenceInputs: cloneReferenceInputs(input.referenceInputs),
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    route: cloneRoute(input.route),
    boardStyle: input.boardStyle,
    instructionProfile: derivedProfile,
  };
  return { inputs, prompt: composePrompt(inputs) };
};

export const deriveStudioInstructionProfileV2 = instructionProfile;

export const studioGenerationCompositionsEqualV2 = (
  left: StudioGenerationCompositionV2,
  right: StudioGenerationCompositionV2
): boolean => JSON.stringify(left) === JSON.stringify(right);

/** Re-derives a persisted composition from only its frozen inputs. */
export const recomposeStudioGenerationV2 = (
  composition: StudioGenerationCompositionV2
): StudioGenerationCompositionV2 => {
  const { schemaVersion, ...inputs } = composition.inputs;
  if (schemaVersion !== STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION) {
    throw new TypeError('composition schemaVersion is invalid');
  }
  return composeStudioGenerationV2(inputs);
};

/**
 * Proves that a frozen composition still names the quote/job authority that selected its inputs.
 * Prompt bytes are historical provider evidence: callers validate the surrounding stored copies
 * for exact equality, but must not reinterpret them with the current composer implementation.
 */
export const studioGenerationCompositionMatchesAuthorityV2 = (
  composition: StudioGenerationCompositionV2,
  authority: {
    projectRevision: number;
    target: StudioGenerationTargetV2;
    purpose: StudioJobPurpose;
    provider: StudioMediaModelRef;
  }
): boolean => {
  try {
    const inputs = composition.inputs;
    if (
      inputs.projectRevision !== authority.projectRevision ||
      inputs.purpose !== authority.purpose ||
      inputs.route.providerId !== authority.provider.providerId ||
      inputs.route.adapterId !== authority.provider.adapterId ||
      inputs.route.model !== authority.provider.model
    ) {
      return false;
    }
    return authority.target.kind === 'shot'
      ? inputs.source.kind === 'shot' && inputs.source.shotId === authority.target.shotId
      : inputs.source.kind === 'project_reference' && inputs.source.referenceId === authority.target.referenceId;
  } catch {
    return false;
  }
};

export const studioGenerationCompositionDigestV2 = (composition: StudioGenerationCompositionV2): string =>
  createHash('sha256').update(JSON.stringify(composition), 'utf8').digest('hex');

const PIECE_IMAGE_ADAPTER_ID: StudioProviderAdapterId = 'weprompt-image-v1';
export const STUDIO_CURRENT_PIECE_INSTRUCTION_PROFILE_V3 = `${PIECE_IMAGE_ADAPTER_ID}.piece-image.v1`;
const STUDIO_PIECE_INSTRUCTION_PROFILE_V3 = /^weprompt-image-v1\.piece-image\.v[1-9][0-9]*$/u;

/**
 * Historical profiles remain valid provenance after the current composer advances. New work must
 * still use the one current profile returned by `deriveStudioPieceInstructionProfileV3`.
 */
export const isStudioPieceInstructionProfileV3 = (value: unknown): value is string =>
  typeof value === 'string' && STUDIO_PIECE_INSTRUCTION_PROFILE_V3.test(value);

const isSafePieceModelV3 = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value !== value.trim()) return false;
  return !Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
};

export type StudioPieceGenerationCompositionInputV3 = Omit<
  StudioPieceGenerationCompositionInputSnapshotV3,
  'schemaVersion'
>;

const PIECE_COMPOSITION_INPUT_KEYS_V3 = [
  'projectRevisionAtPreparation',
  'authoringRevision',
  'authoringFingerprintVersion',
  'authoringFingerprint',
  'brief',
  'rules',
  'source',
  'purpose',
  'conditioningInputs',
  'route',
  'instructionProfile',
] as const;

const isCanonicalTimestampV3 = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
};

const hasExactStringKeysV3 = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || nodeTypes.isProxy(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const ownKeys = Reflect.ownKeys(value);
    return (
      ownKeys.length === keys.length &&
      ownKeys.every((key) => typeof key === 'string' && keys.includes(key)) &&
      keys.every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value');
      })
    );
  } catch {
    return false;
  }
};

const hasOnlyOwnDataGraphV3 = (value: unknown, seen = new Set<object>()): boolean => {
  if (typeof value !== 'object' || value === null) return true;
  if (nodeTypes.isProxy(value) || seen.has(value)) return false;
  seen.add(value);
  try {
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        (!descriptor.enumerable && !(isArray && key === 'length')) ||
        !hasOnlyOwnDataGraphV3(descriptor.value, seen)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
};

const isDenseArrayV3 = (value: unknown, maximum: number): value is unknown[] => {
  try {
    if (
      nodeTypes.isProxy(value) ||
      !Array.isArray(value) ||
      value.length > maximum ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return false;
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
    }
    return Reflect.ownKeys(value).every(
      (key) =>
        key === 'length' || (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length)
    );
  } catch {
    return false;
  }
};

const validatePieceRulesV3 = (value: unknown): value is StudioBriefRule[] => {
  if (!isDenseArrayV3(value, STUDIO_RULE_LIMITS.maxRules)) return false;
  const ids = new Set<string>();
  return value.every((candidate) => {
    if (!hasExactStringKeysV3(candidate, ['id', 'scope', 'text', 'predicate', 'createdAt'])) return false;
    if (
      typeof candidate.id !== 'string' ||
      !SAFE_STUDIO_ID.test(candidate.id) ||
      ids.has(candidate.id) ||
      candidate.scope !== 'project' ||
      typeof candidate.text !== 'string' ||
      candidate.text.trim().length === 0 ||
      candidate.text.length > STUDIO_RULE_LIMITS.text ||
      !isCanonicalTimestampV3(candidate.createdAt)
    ) {
      return false;
    }
    ids.add(candidate.id);
    if (candidate.predicate === null) return true;
    if (!hasExactStringKeysV3(candidate.predicate, ['kind', 'terms'])) return false;
    if (
      candidate.predicate.kind !== 'forbidden_terms' ||
      !isDenseArrayV3(candidate.predicate.terms, STUDIO_RULE_LIMITS.maxTerms) ||
      candidate.predicate.terms.length === 0
    ) {
      return false;
    }
    const terms = candidate.predicate.terms;
    const uniqueTerms = new Set<string>();
    return terms.every((term) => {
      if (
        typeof term !== 'string' ||
        term.trim().length === 0 ||
        term.length > STUDIO_RULE_LIMITS.term ||
        !hasRuleToken(term) ||
        uniqueTerms.has(term)
      ) {
        return false;
      }
      uniqueTerms.add(term);
      return true;
    });
  });
};

const validatePieceSettingsV3 = (value: unknown): boolean =>
  hasExactStringKeysV3(value, ['aspectRatio', 'resolution']) &&
  typeof value.aspectRatio === 'string' &&
  ASPECT_RATIOS.has(value.aspectRatio as StudioAspectRatio) &&
  typeof value.resolution === 'string' &&
  RESOLUTIONS.has(value.resolution as StudioResolution);

/** Normalizes authored Piece words without dropping or transliterating any script. */
export const normalizeStudioPieceWordsV3 = (value: string): string => {
  if (typeof value !== 'string') throw new TypeError('words must be text');
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0 || normalized.length > STUDIO_MAX_GENERATION_PROMPT_LENGTH) {
    throw new RangeError('words are empty or exceed the generation prompt bound');
  }
  return normalized;
};

export const deriveStudioPieceInstructionProfileV3 = (route: Pick<StudioMediaModelRef, 'adapterId'>): string => {
  if (route.adapterId !== PIECE_IMAGE_ADAPTER_ID) throw new TypeError('Piece photo route must be an image adapter');
  return STUDIO_CURRENT_PIECE_INSTRUCTION_PROFILE_V3;
};

const composePiecePromptV3 = (inputs: StudioPieceGenerationCompositionInputSnapshotV3): string => {
  const sections = [
    ...(inputs.brief.trim().length === 0 ? [] : [`PROJECT BRIEF\n${inputs.brief.trim()}`]),
    ...(inputs.rules.length === 0 ? [] : [renderStudioRulesBlock(inputs.rules).trim()]),
    `PHOTO REQUEST\n${inputs.source.words}`,
    `RENDER SETTINGS\nAspect ratio: ${inputs.source.settings.aspectRatio}\nResolution: ${inputs.source.settings.resolution}\nModel: ${inputs.route.model}\nInstruction profile: ${inputs.instructionProfile}`,
    'OUTPUT\nCreate exactly one standalone photograph. Do not create a grid, contact sheet, split frame, caption, label, border, or UI.',
  ];
  const prompt = sections.join('\n\n');
  if (prompt.length === 0 || prompt.length > STUDIO_MAX_GENERATION_PROMPT_LENGTH) {
    throw new RangeError('composed prompt is empty or exceeds the generation prompt bound');
  }
  return prompt;
};

/** Composes the inactive schema-2 provenance for one text-only Piece photograph. */
export const composeStudioPieceGenerationV3 = (
  input: StudioPieceGenerationCompositionInputV3
): StudioPieceGenerationCompositionV3 => {
  let snapshot: StudioPieceGenerationCompositionInputV3;
  if (!hasExactStringKeysV3(input, PIECE_COMPOSITION_INPUT_KEYS_V3) || !hasOnlyOwnDataGraphV3(input)) {
    throw new TypeError('Piece composition input must be exact own data');
  }
  try {
    snapshot = structuredClone(input);
  } catch {
    throw new TypeError('Piece composition input must be snapshot-safe');
  }
  if (!Number.isSafeInteger(snapshot.projectRevisionAtPreparation) || snapshot.projectRevisionAtPreparation < 1) {
    throw new RangeError('projectRevisionAtPreparation must be a positive safe integer');
  }
  if (!Number.isSafeInteger(snapshot.authoringRevision) || snapshot.authoringRevision < 1) {
    throw new RangeError('authoringRevision must be a positive safe integer');
  }
  if (snapshot.authoringRevision > snapshot.projectRevisionAtPreparation) {
    throw new RangeError('authoringRevision cannot exceed projectRevisionAtPreparation');
  }
  if (
    snapshot.authoringFingerprintVersion !== STUDIO_AUTHORING_FINGERPRINT_VERSION_V3 ||
    typeof snapshot.authoringFingerprint !== 'string' ||
    !LOWERCASE_SHA256.test(snapshot.authoringFingerprint)
  ) {
    throw new TypeError('authoring fingerprint authority is invalid');
  }
  if (typeof snapshot.brief !== 'string' || snapshot.brief.length > 16 * 1024) {
    throw new RangeError('brief exceeds the Studio bound');
  }
  if (!validatePieceRulesV3(snapshot.rules)) throw new TypeError('rules are invalid');
  if (!hasExactStringKeysV3(snapshot.source, ['kind', 'pieceId', 'words', 'settings'])) {
    throw new TypeError('Piece source is invalid');
  }
  if (snapshot.source.kind !== 'piece') throw new TypeError('piece_image requires a Piece source');
  assertSafeId(snapshot.source.pieceId, 'source.pieceId');
  if (!validatePieceSettingsV3(snapshot.source.settings)) throw new TypeError('Piece photo settings are invalid');
  const words = normalizeStudioPieceWordsV3(snapshot.source.words);
  if (!isDenseArrayV3(snapshot.conditioningInputs, 0)) {
    throw new TypeError('Piece photo conditioning inputs must be exactly empty');
  }
  if (snapshot.purpose !== 'piece_image') throw new TypeError('Piece sources require piece_image');
  if (!isSafePieceModelV3(snapshot.route.model)) throw new TypeError('Piece photo route model is invalid');
  const route = cloneRoute(snapshot.route);
  const profile = deriveStudioPieceInstructionProfileV3(route);
  if (snapshot.instructionProfile !== profile) throw new TypeError('instructionProfile is not canonical');
  const settings = {
    aspectRatio: snapshot.source.settings.aspectRatio,
    resolution: snapshot.source.settings.resolution,
  };
  const inputs: StudioPieceGenerationCompositionInputSnapshotV3 = {
    schemaVersion: STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION_V3,
    projectRevisionAtPreparation: snapshot.projectRevisionAtPreparation,
    authoringRevision: snapshot.authoringRevision,
    authoringFingerprintVersion: STUDIO_AUTHORING_FINGERPRINT_VERSION_V3,
    authoringFingerprint: snapshot.authoringFingerprint,
    brief: snapshot.brief,
    rules: cloneRules(snapshot.rules),
    source: { kind: 'piece', pieceId: snapshot.source.pieceId, words, settings },
    purpose: 'piece_image',
    conditioningInputs: [],
    route,
    instructionProfile: profile,
  };
  return { inputs, prompt: composePiecePromptV3(inputs) };
};

/**
 * Validates frozen Piece provenance by exact shape and internal consistency only. Historical prompt
 * bytes are deliberately not regenerated with the current instruction template.
 */
export const validateStudioPieceGenerationCompositionV3 = (
  value: unknown
): value is StudioPieceGenerationCompositionV3 => {
  try {
    if (!hasExactStringKeysV3(value, ['inputs', 'prompt']) || typeof value.prompt !== 'string') return false;
    if (value.prompt.trim().length === 0 || value.prompt.length > STUDIO_MAX_GENERATION_PROMPT_LENGTH) return false;
    const inputs = value.inputs;
    if (
      !hasExactStringKeysV3(inputs, [
        'schemaVersion',
        'projectRevisionAtPreparation',
        'authoringRevision',
        'authoringFingerprintVersion',
        'authoringFingerprint',
        'brief',
        'rules',
        'source',
        'purpose',
        'conditioningInputs',
        'route',
        'instructionProfile',
      ]) ||
      inputs.schemaVersion !== STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION_V3 ||
      !Number.isSafeInteger(inputs.projectRevisionAtPreparation) ||
      (inputs.projectRevisionAtPreparation as number) < 1 ||
      !Number.isSafeInteger(inputs.authoringRevision) ||
      (inputs.authoringRevision as number) < 1 ||
      (inputs.authoringRevision as number) > (inputs.projectRevisionAtPreparation as number) ||
      inputs.authoringFingerprintVersion !== STUDIO_AUTHORING_FINGERPRINT_VERSION_V3 ||
      typeof inputs.authoringFingerprint !== 'string' ||
      !LOWERCASE_SHA256.test(inputs.authoringFingerprint) ||
      typeof inputs.brief !== 'string' ||
      inputs.brief.length > 16 * 1024 ||
      !validatePieceRulesV3(inputs.rules) ||
      !hasExactStringKeysV3(inputs.source, ['kind', 'pieceId', 'words', 'settings']) ||
      inputs.source.kind !== 'piece' ||
      typeof inputs.source.pieceId !== 'string' ||
      !SAFE_STUDIO_ID.test(inputs.source.pieceId) ||
      typeof inputs.source.words !== 'string' ||
      normalizeStudioPieceWordsV3(inputs.source.words) !== inputs.source.words ||
      !validatePieceSettingsV3(inputs.source.settings) ||
      inputs.purpose !== 'piece_image' ||
      !isDenseArrayV3(inputs.conditioningInputs, 0) ||
      !hasExactStringKeysV3(inputs.route, ['providerId', 'adapterId', 'model']) ||
      inputs.route.adapterId !== PIECE_IMAGE_ADAPTER_ID ||
      typeof inputs.route.providerId !== 'string' ||
      !SAFE_STUDIO_ID.test(inputs.route.providerId) ||
      !isSafePieceModelV3(inputs.route.model) ||
      !isStudioPieceInstructionProfileV3(inputs.instructionProfile)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

export const studioPieceGenerationCompositionMatchesAuthorityV3 = (
  composition: StudioPieceGenerationCompositionV3,
  authority: {
    projectRevisionAtPreparation: number;
    authoringRevision: number;
    authoringFingerprint: string;
    target: StudioPieceGenerationTargetV3;
    provider: StudioMediaModelRef;
  }
): boolean =>
  validateStudioPieceGenerationCompositionV3(composition) &&
  composition.inputs.projectRevisionAtPreparation === authority.projectRevisionAtPreparation &&
  composition.inputs.authoringRevision === authority.authoringRevision &&
  composition.inputs.authoringFingerprint === authority.authoringFingerprint &&
  authority.target.kind === 'piece' &&
  composition.inputs.source.pieceId === authority.target.pieceId &&
  composition.inputs.route.providerId === authority.provider.providerId &&
  composition.inputs.route.adapterId === authority.provider.adapterId &&
  composition.inputs.route.model === authority.provider.model;

const canonicalJsonV3 = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonV3).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonV3(record[key])}`)
    .join(',')}}`;
};

export const studioPieceGenerationCompositionsEqualV3 = (
  left: StudioPieceGenerationCompositionV3,
  right: StudioPieceGenerationCompositionV3
): boolean => canonicalJsonV3(left) === canonicalJsonV3(right);

export const studioPieceGenerationCompositionDigestV3 = (composition: StudioPieceGenerationCompositionV3): string =>
  createHash('sha256').update(canonicalJsonV3(composition), 'utf8').digest('hex');
