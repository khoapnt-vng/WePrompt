/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { renderStudioRulesBlock } from '@/common/types/project/creativeStudioRules';
import {
  STUDIO_BOARD_STYLES_V2,
  STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION,
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

const assertSafeId = (value: string, field: string): void => {
  if (!SAFE_STUDIO_ID.test(value)) throw new TypeError(`${field} must be a safe Studio ID`);
};

const cloneRoute = (route: StudioMediaModelRef): StudioMediaModelRef => {
  assertSafeId(route.providerId, 'route.providerId');
  if (!ADAPTER_IDS.has(route.adapterId)) throw new TypeError('route.adapterId is invalid');
  if (route.model.length === 0 || route.model !== route.model.trim() || route.model.length > 256) {
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
 * Proves both deterministic prompt bytes and the quote/job authority that selected those inputs.
 * Callers still validate the surrounding exact-key envelope before using this predicate.
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
    if (!studioGenerationCompositionsEqualV2(composition, recomposeStudioGenerationV2(composition))) return false;
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
