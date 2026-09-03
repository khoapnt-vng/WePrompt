/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  type StudioAspectRatio,
  type StudioResolution,
} from '@/common/types/project/creativeStudioTypes';
import type { StudioClipWindow } from '@/common/types/project/studioClipWindow';

/** Two seconds is fine enough to feel like a choice without listing lengths nobody distinguishes. */
const DURATION_STEP_SECONDS = 2;

/**
 * The window a length must satisfy to be both renderable and storable.
 *
 * The engine and the store disagree *in both directions* — `seedance-1-0-pro-250528` renders from
 * 2s where the store's floor is 4s, and the store's ceiling of 15s is above what some engines
 * reach. So neither range alone is safe to offer from: the engine's alone yields lengths the IPC
 * boundary refuses (`payloadSchemas.ts` zod-rejects the `add_shot`, and the reducer fails it
 * `invalid_shot_duration`), which the person only discovers after choosing.
 *
 * `resolveEngineClipWindow` deliberately keeps reporting the *engine's* limits, because describing
 * what the engine can do is a different question, asked elsewhere. The intersection belongs here,
 * where we decide what to offer.
 *
 * Null when the two ranges do not overlap at all — the right answer for an engine whose whole
 * range sits outside what the store accepts, since there is no length that both would honour.
 *
 * A discrete engine's ladder is narrowed the same way, and for the same reason: a rung the store
 * would refuse is not offerable however happily the engine would render it. Null again when no rung
 * survives, because "somewhere in 4..15" is not an offer when the engine only renders 2s and 16s.
 */
const resolveOfferableWindow = (clipWindow: StudioClipWindow | null): StudioClipWindow | null => {
  if (clipWindow === null) return null;
  const minDurationSeconds = Math.max(STUDIO_MIN_SHOT_SECONDS, clipWindow.minDurationSeconds);
  const maxDurationSeconds = Math.min(STUDIO_MAX_SHOT_SECONDS, clipWindow.maxDurationSeconds);
  if (minDurationSeconds > maxDurationSeconds) return null;

  const declared = clipWindow.supportedDurationSeconds;
  if (!Array.isArray(declared)) return { minDurationSeconds, maxDurationSeconds };
  const supportedDurationSeconds = [...new Set(declared)]
    .filter((seconds) => Number.isInteger(seconds) && seconds >= minDurationSeconds && seconds <= maxDurationSeconds)
    .toSorted((left, right) => left - right);
  if (supportedDurationSeconds.length === 0) return null;
  return { minDurationSeconds, maxDurationSeconds, supportedDurationSeconds };
};

/**
 * The lengths a short may be offered, given what is actually connected.
 *
 * A short is *one* engine clip, so the only honest offers are the lengths a single clip can hold —
 * and that the store will then accept, which is why this steps across `resolveOfferableWindow`
 * rather than the engine window it is handed.
 *
 * The maximum is always the last entry even when the step overshoots it, because the longest clip
 * available is the one people reach for and it must never be unreachable.
 *
 * Stepping is only correct for an engine that renders anything in its range. An engine that
 * declares its exact lengths refuses everything between them, so its ladder is offered verbatim —
 * the step would otherwise put lengths on screen that price fine and then fail at generation, which
 * is a charge for a take nobody can use.
 *
 * An empty list rather than a fallback ladder for an absent, reversed, or nonsensical window: with
 * no engine connected there is no length we can promise, and a list of guesses is indistinguishable
 * to the reader from a list of real offers.
 */
export const studioShortDurations = (clipWindow: StudioClipWindow | null): number[] => {
  if (clipWindow === null) return [];
  const { minDurationSeconds: rawMin, maxDurationSeconds: rawMax } = clipWindow;
  if (!Number.isInteger(rawMin) || !Number.isInteger(rawMax)) return [];
  if (rawMin <= 0 || rawMax <= 0 || rawMin > rawMax) return [];

  // Validate what the engine reported *before* intersecting, so a nonsensical window stays
  // recognisably nonsensical instead of being rescued into the store's range by the clamp.
  const offerable = resolveOfferableWindow(clipWindow);
  if (offerable === null) return [];
  const { minDurationSeconds: min, maxDurationSeconds: max, supportedDurationSeconds } = offerable;
  if (supportedDurationSeconds !== undefined) return supportedDurationSeconds;

  const durations: number[] = [];
  for (let seconds = min; seconds <= max; seconds += DURATION_STEP_SECONDS) durations.push(seconds);
  if (durations[durations.length - 1] !== max) durations.push(max);
  return durations;
};

/**
 * The duration the connected engine can actually hold, nearest to the one asked for.
 *
 * A template carries the length its shot was authored for, but the engine in front of the person
 * today may be narrower than the one it was authored against. Clamping keeps the template usable —
 * a slightly different length still tells the story — where rejecting it would strand the template
 * behind an engine swap nobody made deliberately.
 *
 * Clamps into the offerable window, not the engine's: a length the engine would render but the
 * store refuses is no more usable than one the engine refuses, and returning it here would push the
 * rejection out to the IPC boundary where it reads as a bug rather than a limit.
 *
 * For an engine that declares its exact lengths this snaps to the nearest *rung*, not merely into
 * the range: a length that sits between two rungs is inside the window and still refused. Ties go to
 * the shorter rung, because clip price scales with length and the person did not ask for either one
 * — given no reason to prefer, prefer the cheaper.
 *
 * Null when nothing is connected, or when the engine and store ranges do not overlap, so callers
 * surface that rather than silently proceeding with an unvetted number.
 */
export const clampToClipWindow = (seconds: number, clipWindow: StudioClipWindow | null): number | null => {
  const offerable = resolveOfferableWindow(clipWindow);
  if (offerable === null) return null;
  const { supportedDurationSeconds } = offerable;
  if (supportedDurationSeconds === undefined) {
    return Math.min(Math.max(seconds, offerable.minDurationSeconds), offerable.maxDurationSeconds);
  }
  // Ascending rungs plus a strict `<` keeps the first of two equidistant rungs — the shorter one.
  return supportedDurationSeconds.reduce((nearest, rung) =>
    Math.abs(rung - seconds) < Math.abs(nearest - seconds) ? rung : nearest
  );
};

/**
 * The shelves the gallery is grouped into.
 *
 * A tuple rather than a bare union so the gallery can render the shelves in a fixed, reviewed order
 * without a second list drifting out of step with the type.
 */
export const STUDIO_TEMPLATE_CATEGORIES = ['game', 'product', 'internal', 'short'] as const;

/** One shelf of the template gallery. */
export type StudioTemplateCategory = (typeof STUDIO_TEMPLATE_CATEGORIES)[number];

/**
 * The subject stated as absent, when the creator gave none.
 *
 * Substituted rather than omitted, because a slot dropped silently leaves the surrounding sentence
 * reading as though no subject was ever asked for — and "no constraint" is exactly the wrong thing
 * to tell a model that is about to spend a generation. Naming the absence makes it ask instead.
 */
const UNSPECIFIED_SUBJECT = 'an unspecified subject';

/** The one slot a template author may write. Anything else is an authoring bug, caught by tests. */
const SUBJECT_SLOT = '{{subject}}';

/**
 * Fills a template's `{{subject}}` slots with what the creator typed.
 *
 * Splits and joins rather than calling `replaceAll`, which reads `$&`, `$1` and friends in the
 * *replacement* as back-references: a creator whose subject contains a dollar sign would otherwise
 * see fragments of the slot pasted back into their own prose.
 *
 * @param text A template's `instruction` or `shootingScript`.
 * @param subject The creator's subject, as typed; trimmed here so the prose reads correctly.
 * @returns The text with every `{{subject}}` replaced.
 */
export const fillTemplateSlots = (text: string, subject: string): string => {
  const trimmed = subject.trim();
  return text.split(SUBJECT_SLOT).join(trimmed.length > 0 ? trimmed : UNSPECIFIED_SUBJECT);
};

/**
 * A ready-made short: everything a person does not have to decide before one clip is generated.
 *
 * The card's copy and the model's prose both ship with the template, in English. That is a narrowing
 * of the original shape, which kept every human-readable string in the localised copy: this feature
 * ships English-only for now, `check-i18n.js` only warns on an untranslated key, and `mergeWithFallback`
 * covers the gap. The rule *labels* still live with the copy, so what a rule asks for reads in the
 * reader's language even while the card around it does not.
 *
 * `instruction` and `shootingScript` are a separate case, and would stay here even if the card were
 * translated: they are read by the model, not the person, and AGENTS.md keeps model input beside the
 * code that sends it, because a mistranslation there changes what the machine does rather than merely
 * reading oddly.
 */
export type StudioTemplate = {
  /** Stable across releases: it is persisted on the project and cited in the gallery's copy keys. */
  id: string;
  /** The card's title. A plain English string, not an i18n key — see the note on this type. */
  name: string;
  /** The one line under the title. A plain English string, not an i18n key. */
  tagline: string;
  /**
   * The template author's operational guidance, appended to the project brief.
   *
   * A model-facing English constant, **never an i18n key**: it is instruction to a machine, and a
   * translation of it would change what gets built rather than how it reads.
   *
   * May contain `{{subject}}`, filled by `fillTemplateSlots` before it is sent.
   */
  instruction: string;
  /**
   * What the single shot is told to depict.
   *
   * A model-facing English constant, **never an i18n key**, for the same reason as `instruction`.
   *
   * May contain `{{subject}}`, filled by `fillTemplateSlots` before it is sent.
   */
  shootingScript: string;
  category: StudioTemplateCategory;
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
  /**
   * One length, not a range: a short is a single clip and a single clip has a single duration.
   * It is the length the template was authored for, and it is clamped (`clampToClipWindow`) into
   * what the connected engine and the store both accept before anything is generated, because
   * neither is guaranteed to match the range this number was chosen against.
   */
  defaultDurationSeconds: number;
  /**
   * Machine-readable rule terms only. These reach the engine as prompt text (via `composition.ts`)
   * — they steer the model, they do not gate it, so nothing rejects a take that ignores them.
   * The human-readable label for each rule lives with the copy, so that reading what a rule asks
   * for never depends on which language the reader has selected.
   */
  rules: readonly { id: string; terms: readonly string[] }[];
  /**
   * The bundled image imported onto the shot before generation.
   *
   * Supplying a first frame is what keeps a template to **one generation and one charge**: the clip
   * prices as a single direct take conditioned on an image we already ship. Without it the shot
   * would first need a seed still generated and then pinned by hand — a second charge, a second
   * wait, and a decision the person came here to avoid making.
   */
  firstFrameAsset: string;
};

/** Where a shot's picture comes from. `stock_and_generated` has no stock source wired yet. */
export type StudioMediaSource = 'generated_clips' | 'generated_images' | 'stock_and_generated';

export type StudioSubtitleMode = 'none' | 'any' | 'burned_in' | 'sidecar';

export type StudioAudioPreference = 'best_available' | 'silent';

/**
 * The creator's answers to the Settings block on the entry screen.
 *
 * Every field is present, and `null` (or the `none`/default member) means "not set", rather than
 * the key being absent. One shape to read is one fewer way for a caller to be wrong, and the
 * composer relies on it: it distinguishes "chose nothing" from "chose this" per field, so a
 * question nobody opened is never stated to the Director as a constraint they gave.
 *
 * These live with the EntryKit vocabulary rather than in
 * `@/common/types/project/creativeStudioTypes` because nothing persists them yet — no store field,
 * no IPC schema, no service reads them. Today they only shape what the Director is *told*. When the
 * Settings block gains persistence, this is the type that moves to the common module, and the move
 * is the moment the store validator and the payload schemas have to agree with it.
 */
export type StudioProjectSettings = {
  mediaSource: StudioMediaSource;
  /** Free text, e.g. "Claymation". Null when the creator did not ask for a style. */
  generativeStyle: string | null;
  /** BCP-47-ish label as the creator typed or picked it; the Director reads it, nothing parses it. */
  language: string | null;
  backgroundMusic: string | null;
  subtitles: StudioSubtitleMode;
  voice: string | null;
  watermarkText: string | null;
  audioPreference: StudioAudioPreference;
};
