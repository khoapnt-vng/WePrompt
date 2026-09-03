/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioAspectRatio } from '@/common/types/project/creativeStudioTypes';
import type { StudioClipWindow } from '@renderer/pages/studio/studioClipWindow';
import type {
  StudioAudioPreference,
  StudioMediaSource,
  StudioProjectSettings,
  StudioSubtitleMode,
} from '@renderer/pages/studio/components/EntryKit/types';

export type CreatorContextInput = {
  toneLabel: string;
  durationLabel: string;
  formatLabel: string;
  /**
   * The frame, stated here because no template's prose states it any more.
   *
   * Every template instruction used to open with its own "(16:9)". That was safe while the modal only
   * offered the shape the template was written for; it stopped being safe when the platform picker
   * let the user send the same template to TikTok, because the instruction then told the Director
   * 16:9 while the project was 9:16. The frame is the creator's pick, so it belongs with the picks.
   */
  aspectRatio: StudioAspectRatio;
  about: string;
  /** The eight Settings answers as stored on the project. Stated to the Director, not translated. */
  settings: StudioProjectSettings;
  lookCount: number;
  /** The connected video engines' shared clip window, or null when none is connected. */
  clipWindow: StudioClipWindow | null;
};

/**
 * Each enum answer written the way the Director should read it.
 *
 * English constants, deliberately: these are instructions to a model, and AGENTS.md puts model input
 * next to the code that sends it rather than in i18n. The user picked from translated labels; what
 * travels is the meaning.
 */
const MEDIA_SOURCE_SENTENCE: Record<StudioMediaSource, string> = {
  generated_clips: 'Media: generated video clips only.',
  generated_images: 'Media: generated stills only — build every beat from images, no motion clips.',
  stock_and_generated: 'Media: stock footage and generated media may be mixed.',
};

const SUBTITLE_SENTENCE: Record<StudioSubtitleMode, string> = {
  none: '',
  any: 'Subtitles: wanted, in whichever form is easiest to produce.',
  burned_in: 'Subtitles: burned into the picture.',
  sidecar: 'Subtitles: delivered as a separate subtitle file, not burned in.',
};

const AUDIO_PREFERENCE_SENTENCE: Record<StudioAudioPreference, string> = {
  best_available: 'Audio: use the best the engine can produce.',
  silent: 'Audio: keep the finished video silent.',
};

/**
 * The Settings answers as brief lines, in the order the block presents them.
 *
 * Only answers that were actually chosen appear. A line saying "background music: not specified"
 * would read to the Director as a constraint the user stated, when in fact they never opened that
 * line — the same reasoning that makes an empty `about` say so explicitly rather than stay silent,
 * applied the other way round: `about` is always asked, these are not.
 */
const settingsLines = (settings: StudioProjectSettings): readonly string[] => {
  const lines = [MEDIA_SOURCE_SENTENCE[settings.mediaSource]];
  if (settings.backgroundMusic !== null) lines.push(`Background music: ${settings.backgroundMusic}.`);
  if (settings.language !== null) {
    lines.push(`Language: ${settings.language} — write all narration, captions and on-screen text in it.`);
  }
  if (SUBTITLE_SENTENCE[settings.subtitles].length > 0) lines.push(SUBTITLE_SENTENCE[settings.subtitles]);
  if (settings.voice !== null) lines.push(`Voice: ${settings.voice}.`);
  if (settings.watermarkText !== null) lines.push(`Watermark text: "${settings.watermarkText}".`);
  lines.push(AUDIO_PREFERENCE_SENTENCE[settings.audioPreference]);
  if (settings.generativeStyle !== null) lines.push(`Generative style: ${settings.generativeStyle}.`);
  return lines;
};

export type ComposeInstructionInput = CreatorContextInput & {
  /** The template's own operational instruction, taken verbatim from the catalog. */
  instruction: string;
};

/**
 * The creator's picks, written out as context for the Director.
 *
 * An empty `about` is stated as unspecified rather than omitted. A silent omission reads to the
 * Director as "no subject constraint"; saying so explicitly makes the first question obvious.
 *
 * Used on its own by the composer, where the picks *are* the whole brief, and as the preamble to a
 * template's instruction. One builder for both, because two would drift and the difference would
 * show up as two projects started the same way behaving differently.
 */
export const composeCreatorContext = ({
  toneLabel,
  durationLabel,
  formatLabel,
  aspectRatio,
  about,
  settings,
  lookCount,
  clipWindow,
}: CreatorContextInput): string => {
  const trimmedAbout = about.trim();
  const lines = [
    `Context from the creator: ${toneLabel.toLowerCase()} tone, aiming for about ${durationLabel}, framed ${aspectRatio}, styled for ${formatLabel}.`,
    trimmedAbout.length > 0
      ? `What it's about: "${trimmedAbout}"`
      : `What it's about: not specified yet — ask before writing.`,
    /*
     * The one place the engine's clip limits are stated, read live from the connected route.
     *
     * The templates used to carry "4-15 seconds" in their own prose, which is one model's window —
     * `seedance-1-0-pro` is 2-12s and `seedance-1-5-pro` is 4-12s — so connecting a different engine
     * silently made every instruction wrong. Stating it here means the numbers come from whatever is
     * actually connected, and the templates only ever refer back to this line.
     *
     * With nothing connected it says so rather than falling back to a default. A guessed window is
     * indistinguishable to the Director from a real one, and it would reintroduce exactly the bug
     * this replaces.
     */
    clipWindow === null
      ? 'Engine clip window: no video engine is connected yet, so clip length limits are unknown. Ask before committing to any clip length.'
      : `Engine clip window: every clip must be between ${clipWindow.minDurationSeconds} and ${clipWindow.maxDurationSeconds} seconds. Never propose a beat shorter than ${clipWindow.minDurationSeconds} seconds — the engine cannot render it.`,
  ];
  lines.push(...settingsLines(settings));
  if (lookCount > 0) {
    lines.push(
      `Look references: ${lookCount} image${lookCount === 1 ? '' : 's'} attached — match these for cast, product, and style.`
    );
  }
  return lines.join('\n');
};

/**
 * Prepends the creator's picks to the template's instruction as a context preamble.
 *
 * Prepends rather than rewrites, and that is the point: each template's instruction contains
 * carefully worded operational guidance, and regenerating that text from the picks would put those
 * constraints at the mercy of a string builder. The picks are context; the instruction is contract.
 */
export const composeInstruction = ({ instruction, ...context }: ComposeInstructionInput): string =>
  `${composeCreatorContext(context)}\n\n${instruction}`;
