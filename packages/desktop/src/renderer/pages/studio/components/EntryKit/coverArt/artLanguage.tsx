/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

/**
 * Cover art is drawn, not stored.
 *
 * The earlier decision was "no thumbnails", and its reason was real: `resources/` is already 456MB
 * and bundling raster covers would push the installer further. That objection does not apply to
 * generated vector art, which costs zero bytes in the installer — so cards get pictures after all.
 *
 * Each format owns a visual *language*, and the seed only varies hue, count and placement inside it.
 * That is deliberate: a random-looking picture per card would be noise, while a family of pictures
 * per format means the artwork itself tells the user what kind of video a card makes, before they
 * read a word of it.
 */
export type StudioEntryArtFormat = 'motion-graphics' | 'trailer' | 'tiktok' | 'reels' | 'facebook-ad';

export const STUDIO_ENTRY_ART_FORMATS: readonly StudioEntryArtFormat[] = [
  'motion-graphics',
  'trailer',
  'tiktok',
  'reels',
  'facebook-ad',
];

/** `gradientId` is supplied by the caller from `useId()`, so two copies of one card cannot collide. */
type ArtRenderer = (rng: () => number, gradientId: string) => React.ReactNode;

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 180;

/** Flat geometry, a dot grid, and nested rounded rectangles: the vocabulary of a title sequence. */
const motionGraphics: ArtRenderer = (rng) => {
  const hue = 18 + Math.floor(rng() * 26);
  const dots: React.ReactNode[] = [];
  for (let x = 20; x < VIEW_WIDTH; x += 26) {
    for (let y = 18; y < VIEW_HEIGHT; y += 26) {
      dots.push(<circle key={`d-${x}-${y}`} cx={x} cy={y} r={1.2} fill={`hsl(${hue} 20% 46%)`} opacity={0.5} />);
    }
  }
  const rects = [0, 1, 2].map((index) => {
    const inset = 30 + index * 22;
    return (
      <rect
        key={`r-${index}`}
        x={inset + rng() * 8}
        y={inset * 0.55 + 14}
        width={250 - inset * 1.4}
        height={120 - inset * 0.62}
        rx={10}
        fill='none'
        stroke={`hsl(${hue} ${62 - index * 14}% ${58 - index * 6}%)`}
        strokeWidth={2.4 - index * 0.5}
        opacity={0.9 - index * 0.26}
      />
    );
  });
  return (
    <>
      <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill='#171A20' />
      {dots}
      {rects}
      <circle cx={210 + rng() * 50} cy={58 + rng() * 50} r={13 + rng() * 7} fill={`hsl(${hue} 78% 56%)`} />
      <rect x={30} y={152} width={70 + rng() * 90} height={4} rx={2} fill={`hsl(${hue} 70% 54%)`} opacity={0.75} />
    </>
  );
};

/** A light shaft through darkness, silhouetted verticals, embers. Cold blues, one warm accent. */
const trailer: ArtRenderer = (rng, gradientId) => {
  const hue = 206 + Math.floor(rng() * 34);
  const shaftX = 120 + rng() * 90;
  const bars = [0, 1, 2, 3].map((index) => {
    const barX = 34 + index * 68 + rng() * 16;
    const barHeight = 52 + rng() * 66;
    return (
      <rect
        key={`b-${index}`}
        x={barX}
        y={VIEW_HEIGHT - barHeight}
        width={16 + rng() * 12}
        height={barHeight}
        rx={3}
        fill='#0B0D12'
        opacity={0.82}
      />
    );
  });
  const embers = Array.from({ length: 14 }, (_unused, index) => (
    <circle
      key={`e-${index}`}
      cx={rng() * VIEW_WIDTH}
      cy={40 + rng() * 130}
      r={0.7 + rng() * 1.5}
      fill='hsl(28 88% 62%)'
      opacity={0.25 + rng() * 0.5}
    />
  ));
  return (
    <>
      <defs>
        <radialGradient id={`tg-${gradientId}`} cx='50%' cy='6%' r='88%'>
          <stop offset='0%' stopColor={`hsl(${hue} 46% 40%)`} />
          <stop offset='58%' stopColor={`hsl(${hue} 40% 15%)`} />
          <stop offset='100%' stopColor='#080A0E' />
        </radialGradient>
      </defs>
      <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill={`url(#tg-${gradientId})`} />
      <polygon
        points={`${shaftX},0 ${shaftX + 46},0 ${shaftX + 96},${VIEW_HEIGHT} ${shaftX - 52},${VIEW_HEIGHT}`}
        fill={`hsl(${hue} 60% 72%)`}
        opacity={0.13}
      />
      {bars}
      {embers}
    </>
  );
};

/** Bold diagonal bands, a burst, and the 9:16 frame drawn as a dashed guide. */
const tiktok: ArtRenderer = (rng) => {
  const hue = 320 + Math.floor(rng() * 40);
  const bands = [0, 1, 2].map((index) => {
    const offset = -60 + index * 108 + rng() * 26;
    return (
      <polygon
        key={`band-${index}`}
        points={`${offset},${VIEW_HEIGHT} ${offset + 74},${VIEW_HEIGHT} ${offset + 148},0 ${offset + 74},0`}
        fill={`hsl(${(hue + index * 22) % 360} ${74 - index * 12}% ${52 - index * 5}%)`}
        opacity={0.92 - index * 0.2}
      />
    );
  });
  const burstX = 96 + rng() * 130;
  const burstY = 60 + rng() * 60;
  const rays = Array.from({ length: 9 }, (_unused, index) => {
    const angle = (index / 9) * Math.PI * 2 + rng();
    const length = 20 + rng() * 24;
    return (
      <line
        key={`ray-${index}`}
        x1={burstX}
        y1={burstY}
        x2={burstX + Math.cos(angle) * length}
        y2={burstY + Math.sin(angle) * length}
        stroke='#FFF6EE'
        strokeWidth={2.4}
        strokeLinecap='round'
        opacity={0.85}
      />
    );
  });
  return (
    <>
      <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill='#141118' />
      {bands}
      <rect
        x={120}
        y={14}
        width={80}
        height={152}
        rx={8}
        fill='none'
        stroke='#FFF6EE'
        strokeWidth={1.4}
        opacity={0.34}
        strokeDasharray='5 5'
      />
      {rays}
    </>
  );
};

/** Soft radial glow, stacked pills, sparkles. The vertical frame is solid rather than dashed. */
const reels: ArtRenderer = (rng, gradientId) => {
  const hue = 276 + Math.floor(rng() * 46);
  const pills = [0, 1, 2].map((index) => (
    <rect
      key={`p-${index}`}
      x={40 + rng() * 30}
      y={44 + index * 34 + rng() * 10}
      width={96 + rng() * 96}
      height={18}
      rx={9}
      fill={`hsl(${(hue + index * 18) % 360} 66% ${62 - index * 8}%)`}
      opacity={0.9 - index * 0.18}
    />
  ));
  const sparks = Array.from({ length: 11 }, (_unused, index) => {
    const x = rng() * VIEW_WIDTH;
    const y = rng() * VIEW_HEIGHT;
    const size = 1.6 + rng() * 2.6;
    const arm = size * 0.36;
    return (
      <path
        key={`s-${index}`}
        d={`M${x} ${y - size}L${x + arm} ${y - arm}L${x + size} ${y}L${x + arm} ${y + arm}L${x} ${y + size}L${x - arm} ${y + arm}L${x - size} ${y}L${x - arm} ${y - arm}Z`}
        fill='#FFF2E4'
        opacity={0.3 + rng() * 0.55}
      />
    );
  });
  return (
    <>
      <defs>
        <radialGradient id={`rg-${gradientId}`} cx={`${28 + rng() * 44}%`} cy={`${30 + rng() * 40}%`} r='82%'>
          <stop offset='0%' stopColor={`hsl(${hue} 58% 34%)`} />
          <stop offset='100%' stopColor='#120F17' />
        </radialGradient>
      </defs>
      <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill={`url(#rg-${gradientId})`} />
      <rect
        x={118}
        y={12}
        width={84}
        height={156}
        rx={8}
        fill='none'
        stroke='#FFF2E4'
        strokeWidth={1.2}
        opacity={0.26}
      />
      {pills}
      {sparks}
    </>
  );
};

/** A product lit on a horizon: the one language with a recognisable subject, because ads sell one. */
const facebookAd: ArtRenderer = (rng, gradientId) => {
  const hue = 32 + Math.floor(rng() * 22);
  const horizon = 118 + rng() * 18;
  const boxWidth = 46 + rng() * 30;
  const boxHeight = 44 + rng() * 30;
  const boxX = 128 + rng() * 40;
  const centreX = boxX + boxWidth / 2;
  return (
    <>
      <defs>
        <linearGradient id={`fg-${gradientId}`} x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stopColor={`hsl(${hue} 34% 26%)`} />
          <stop offset='100%' stopColor={`hsl(${hue} 26% 13%)`} />
        </linearGradient>
        <radialGradient id={`fs-${gradientId}`} cx='50%' cy='50%' r='50%'>
          <stop offset='0%' stopColor={`hsl(${hue} 88% 66%)`} stopOpacity={0.5} />
          <stop offset='100%' stopColor={`hsl(${hue} 88% 66%)`} stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill={`url(#fg-${gradientId})`} />
      <ellipse cx={centreX} cy={horizon} rx={96} ry={52} fill={`url(#fs-${gradientId})`} />
      <line
        x1={0}
        y1={horizon}
        x2={VIEW_WIDTH}
        y2={horizon}
        stroke={`hsl(${hue} 40% 48%)`}
        strokeWidth={1}
        opacity={0.5}
      />
      <rect x={boxX} y={horizon - boxHeight} width={boxWidth} height={boxHeight} rx={6} fill={`hsl(${hue} 24% 9%)`} />
      <ellipse cx={centreX} cy={horizon + 5} rx={boxWidth * 0.7} ry={5} fill='#000' opacity={0.4} />
      <circle cx={centreX} cy={horizon - boxHeight - 16} r={7} fill={`hsl(${hue} 88% 62%)`} />
    </>
  );
};

const ART_LANGUAGE: Record<StudioEntryArtFormat, ArtRenderer> = {
  'motion-graphics': motionGraphics,
  trailer,
  tiktok,
  reels,
  'facebook-ad': facebookAd,
};

/** Motion graphics is the fallback language: the most neutral of the five. */
export const resolveArtRenderer = (format: StudioEntryArtFormat | undefined): ArtRenderer =>
  format === undefined ? motionGraphics : ART_LANGUAGE[format];

export const ART_VIEW_BOX = `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`;
