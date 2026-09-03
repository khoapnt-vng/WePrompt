/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useId, useMemo } from 'react';

import { ART_VIEW_BOX, resolveArtRenderer, type StudioEntryArtFormat } from './artLanguage';
import { makeRng } from './makeRng';
import styles from './CoverArt.module.css';

export type CoverArtProps = {
  /** Stable identity of the thing being pictured. Same seed always draws the same picture. */
  seed: string;
  format?: StudioEntryArtFormat;
  /** Adds a bottom-up scrim so overlaid text stays legible whatever the generator produced. */
  scrim?: boolean;
  className?: string;
};

/**
 * Decorative by definition — `aria-hidden`, and never the only carrier of meaning. Every surface
 * that uses it also states the same thing in text, so a screen reader loses nothing.
 */
export const CoverArt: React.FC<CoverArtProps> = ({ seed, format, scrim = false, className }) => {
  // React's own unique id, not the seed: one entity can be pictured twice on screen (a card and
  // the modal hero opened from it), and two SVGs sharing a gradient id makes the second one
  // reference the first one's <defs> — which disappears the moment the first unmounts.
  const gradientId = useId().replace(/[^a-zA-Z0-9-]/g, '');
  const art = useMemo(() => resolveArtRenderer(format)(makeRng(seed), gradientId), [format, gradientId, seed]);

  return (
    <span className={className === undefined ? styles.frame : `${styles.frame} ${className}`}>
      <svg className={styles.canvas} viewBox={ART_VIEW_BOX} preserveAspectRatio='xMidYMid slice' aria-hidden='true'>
        {art}
      </svg>
      {scrim && <span aria-hidden='true' className={styles.scrim} />}
    </span>
  );
};
