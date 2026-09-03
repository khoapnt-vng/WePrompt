/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TFunction } from 'i18next';

/**
 * Spoken length, not clock length: "2 minutes 30 seconds", never "2:30".
 *
 * These labels are read inside a sentence — "aiming for about ___" — and a colon-form timecode
 * reads as data dropped into prose. A short's length is spoken, never compared against other
 * timecodes, so no clock form is offered here at all.
 */
export const formatDurationLabel = (totalSeconds: number, t: TFunction): string => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  // `count` rather than a named `minutes` placeholder because it is what drives i18next's plural
  // selection. Interpolating a plain number produced "1 minutes 30 seconds" in the picker.
  if (minutes === 0) return t('conversation.creativeStudio.entry.ui.durationSeconds', { count: seconds });
  if (seconds === 0) return t('conversation.creativeStudio.entry.ui.durationMinutes', { count: minutes });
  return t('conversation.creativeStudio.entry.ui.durationMinutesSeconds', { count: minutes, seconds });
};
