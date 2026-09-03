/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioTemplate } from '@renderer/pages/studio/components/EntryKit/types';

/**
 * The shorts a person can start from.
 *
 * One template, deliberately. The point of this catalogue is to prove the path — pick a card, give a
 * subject and a length, get one clip for one charge — and a shelf of forty would only multiply the
 * authoring before anyone has watched the first one come back. Adding the second is cheap once it has.
 *
 * `readonly` because nothing may append at runtime: the gallery, the brief and the persisted project
 * all read the same entries, and a catalogue that differs between them is a project that cannot be
 * reopened.
 */
export const STUDIO_SHORT_TEMPLATES: readonly StudioTemplate[] = [
  {
    id: 'product-teaser',
    name: 'Product Teaser',
    tagline: 'One unbroken push-in that holds your product and nothing else.',
    category: 'product',
    aspectRatio: '16:9',
    resolution: '720p',
    defaultDurationSeconds: 8,
    rules: [
      {
        id: 'no-real-likenesses',
        terms: ['no real people', 'no recognisable public figures', 'no celebrity likeness', 'no identifiable faces'],
      },
    ],
    firstFrameAsset: 'product-teaser-first-frame.jpg',
    instruction: [
      'This project is a single-shot product teaser for {{subject}}. Build exactly one beat holding exactly one shot.',
      'Do not split it into an opening title, a feature montage and an end card: the whole piece is one continuous take. Cutting it into sections would spend a generation on each section for a result nobody asked for.',
      '',
      'The first frame is already on the shot — an image that ships with this template. Condition the take on that image. Do not generate a seed still first and do not ask for one to be pinned: the shipped frame is what keeps this to one generation and one charge.',
      '',
      'Keep {{subject}} the only thing on screen. No presenter, no hands entering frame, no logo cards, and no text overlays unless the creator asked for them in Settings. If the creator did not say what {{subject}} is, ask before generating anything — a teaser for an unnamed object is a charge for footage they cannot use.',
      '',
      'Use the length the creator picked, kept inside the engine clip window stated above. Never propose a beat shorter than that window allows.',
    ].join('\n'),
    shootingScript: [
      'A single continuous shot, no cuts.',
      '{{subject}} rests on a plain seamless surface in an otherwise empty space, lit by one large soft key from the upper left, with a cool rim picking out its far edge against the darker background.',
      'The camera starts wide enough to hold {{subject}} whole with clear air around it and pushes in slowly and steadily, ending just short of filling the frame. {{subject}} itself never moves; only the camera does.',
      'Fine dust drifts through the key light. Shallow depth of field throughout, the background falling away to an even, unbroken gradient.',
      'No people, no hands, no on-screen text, no logos.',
    ].join(' '),
  },
];

/**
 * The template an id names.
 *
 * Null, not `undefined`, for an id nothing ships — a project persisted against a template that has
 * since been withdrawn hits this, and an explicit null is a case a caller has to answer rather than
 * one it can spread into a render and discover as a blank card.
 *
 * @param id The persisted template id.
 * @returns The catalogue entry, or null when no template carries that id.
 */
export const findShortTemplate = (id: string): StudioTemplate | null =>
  STUDIO_SHORT_TEMPLATES.find((template) => template.id === id) ?? null;
