/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioAspectRatio, StudioResolution } from '@/common/types/project/creativeStudioTypes';
import type { StudioClipWindow } from '@renderer/pages/studio/studioClipWindow';

/** Two seconds is fine enough to feel like a choice without listing lengths nobody distinguishes. */
const DURATION_STEP_SECONDS = 2;

/**
 * The lengths a short may be offered, given what is actually connected.
 *
 * A short is *one* engine clip, so the only honest offers are the lengths a single clip can hold.
 * The window is therefore the engine's, not the store's: the persistence range
 * (`STUDIO_MIN_SHOT_SECONDS` / `STUDIO_MAX_SHOT_SECONDS`) is far wider than any real engine, and
 * clamping to it would offer durations the engine then refuses at generation time — a failure the
 * person only discovers after paying for it.
 *
 * The maximum is always the last entry even when the step overshoots it, because the longest clip
 * the engine can render is the one people reach for and it must never be unreachable.
 *
 * An empty list rather than a fallback ladder for an absent, reversed, or nonsensical window: with
 * no engine connected there is no length we can promise, and a list of guesses is indistinguishable
 * to the reader from a list of real offers.
 */
export const studioShortDurations = (clipWindow: StudioClipWindow | null): number[] => {
  if (clipWindow === null) return [];
  const { minDurationSeconds: min, maxDurationSeconds: max } = clipWindow;
  if (!Number.isInteger(min) || !Number.isInteger(max)) return [];
  if (min <= 0 || max <= 0 || min > max) return [];

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
 * Null when nothing is connected, so callers surface "no engine" rather than silently proceeding
 * with an unvetted number.
 */
export const clampToClipWindow = (seconds: number, clipWindow: StudioClipWindow | null): number | null => {
  if (clipWindow === null) return null;
  return Math.min(Math.max(seconds, clipWindow.minDurationSeconds), clipWindow.maxDurationSeconds);
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
 * A ready-made short: everything a person does not have to decide before one clip is generated.
 *
 * The shape is deliberately data-only — no copy, no component. The human-readable name, blurb and
 * rule labels live with the localised copy so a template can be added without touching translations
 * for twelve locales, and so the same template reads correctly in every language.
 */
export type StudioTemplate = {
  /** Stable across releases: it is persisted on the project and cited in the gallery's copy keys. */
  id: string;
  category: StudioTemplateCategory;
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
  /**
   * One length, not a range: a short is a single clip and a single clip has a single duration.
   * It is the length the template was authored for, and it is clamped into the live engine window
   * (`clampToClipWindow`) before anything is generated, because the engine connected today may be
   * narrower than the one this number was chosen against.
   */
  defaultDurationSeconds: number;
  /**
   * Machine-readable rule terms only — the words a generated take is checked against.
   * The human-readable label for each rule lives with the copy, so that reviewing what a rule
   * *enforces* never depends on which language the reader has selected.
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
