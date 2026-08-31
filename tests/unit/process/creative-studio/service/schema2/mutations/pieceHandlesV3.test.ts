/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_MAX_PIECE_HANDLE_SCALARS_V3,
  STUDIO_MAX_PIECE_PRIOR_HANDLES_V3,
  type StudioProjectV3,
} from '@/common/types/project/creativeStudioTypes';
import {
  deriveStudioPieceHandleFromImportFileNameV3,
  deriveStudioPieceHandleV3,
  isCanonicalStudioPieceHandleV3,
  normalizeStudioPieceHandleV3,
  resolveStudioPieceRenameV3,
  studioPieceHandleNamespaceV3,
} from '@/process/services/creative-studio/service/schema2/mutations/pieceHandles';

const catalogue = (
  handle: string,
  priorHandles: string[] = [],
  other: Array<[string, string, string[]]> = []
): Pick<StudioProjectV3, 'pieceOrder' | 'pieces'> => ({
  pieceOrder: ['piece_1', ...other.map(([id]) => id)],
  pieces: Object.fromEntries([
    [
      'piece_1',
      {
        id: 'piece_1',
        kind: 'photograph',
        handle,
        priorHandles,
        currentAssetId: null,
        jobIds: [],
        createdAt: '2026-08-30T00:00:00.000Z',
        updatedAt: '2026-08-30T00:00:00.000Z',
      },
    ],
    ...other.map(([id, otherHandle, aliases]) => [
      id,
      {
        id,
        kind: 'photograph' as const,
        handle: otherHandle,
        priorHandles: aliases,
        currentAssetId: null,
        jobIds: [],
        createdAt: '2026-08-30T00:00:00.000Z',
        updatedAt: '2026-08-30T00:00:00.000Z',
      },
    ]),
  ]),
});

describe('schema-6 Unicode Piece handles', () => {
  it.each([
    ['Vietnamese', 'Ảnh đêm', 'ảnh_đêm'],
    ['Persian', 'شب تهران', 'شب_تهران'],
    ['Cyrillic', 'Ана идёт', 'ана_идёт'],
    ['Japanese', '東京・夜', '東京_夜'],
    ['Korean', '서울 밤', '서울_밤'],
    ['Traditional Chinese', '香港 夜景', '香港_夜景'],
    ['RTL punctuation', '  شب—تهران  ', 'شب_تهران'],
  ])('normalizes %s without ASCII fallback', (_label, input, expected) => {
    expect(normalizeStudioPieceHandleV3(input, 'rename')).toBe(expected);
    expect(isCanonicalStudioPieceHandleV3(expected)).toBe(true);
  });

  it('normalizes composed and decomposed accents to the same stored form', () => {
    expect(normalizeStudioPieceHandleV3('A\u0301nh đêm', 'rename')).toBe('ánh_đêm');
    expect(normalizeStudioPieceHandleV3('Ánh đêm', 'rename')).toBe('ánh_đêm');
  });

  it('uses a locale-independent fallback, truncates safely, and reserves room for suffixes', () => {
    expect(deriveStudioPieceHandleV3('🎬✨')).toBe('piece');
    const long = `a${'\u0301'.repeat(80)}${'b'.repeat(80)}`;
    const derived = deriveStudioPieceHandleV3(long);
    expect([...derived].length).toBeLessThanOrEqual(STUDIO_MAX_PIECE_HANDLE_SCALARS_V3);
    expect(derived.endsWith('\u0301')).toBe(false);

    const boundary = '字'.repeat(STUDIO_MAX_PIECE_HANDLE_SCALARS_V3);
    const collision = deriveStudioPieceHandleV3(boundary, [boundary]);
    expect(collision.endsWith('_2')).toBe(true);
    expect([...collision]).toHaveLength(STUDIO_MAX_PIECE_HANDLE_SCALARS_V3);
  });

  it('refuses explicit overflow, unsafe path/invisible input, empty input, and discarded symbols', () => {
    expect(() => normalizeStudioPieceHandleV3('a'.repeat(STUDIO_MAX_PIECE_HANDLE_SCALARS_V3 + 1), 'rename')).toThrow(
      expect.objectContaining({ code: 'handle_too_long' })
    );
    for (const value of [
      'folder/photo',
      'folder\\photo',
      'safe\u202Eevil',
      'photo\uFE0F',
      'pho\u034Fto',
      '🎬',
      'photo🎬',
    ]) {
      expect(() => normalizeStudioPieceHandleV3(value, 'rename'), value).toThrow(
        expect.objectContaining({ code: expect.stringMatching(/unsafe_character|empty_handle/) })
      );
    }
  });

  it('discards default-ignorables only during derivation and still resolves collisions', () => {
    expect(deriveStudioPieceHandleV3('photo\uFE0F')).toBe('photo');
    expect(deriveStudioPieceHandleV3('pho\u034Fto')).toBe('photo');
    expect(deriveStudioPieceHandleV3('photo\uFE0F', ['photo'])).toBe('photo_2');
  });

  it.each([
    ['final extension only', 'Ảnh.đêm.final.PNG', [], 'ảnh_đêm_final'],
    ['Persian Unicode', 'شب تهران.jpeg', [], 'شب_تهران'],
    ['CJK Unicode', '東京・夜.webp', [], '東京_夜'],
    ['collision', 'Ảnh đêm.png', ['ảnh_đêm'], 'ảnh_đêm_2'],
    ['hidden basename', '.env', [], 'env'],
    ['trailing dot', 'photo.', [], 'photo'],
  ])('derives an import handle from the picker basename: %s', (_label, fileName, unavailable, expected) => {
    expect(deriveStudioPieceHandleFromImportFileNameV3(fileName, unavailable)).toBe(expected);
  });

  it('refuses import paths and separators instead of treating them as basenames', () => {
    for (const fileName of ['/tmp/photo.png', 'folder/photo.png', 'folder\\photo.png']) {
      expect(() => deriveStudioPieceHandleFromImportFileNameV3(fileName), fileName).toThrow(
        expect.objectContaining({ code: 'invalid_input' })
      );
    }
  });

  it('suffixes derived collisions against current handles, aliases, and active reservations', () => {
    expect(deriveStudioPieceHandleV3('Ảnh đêm', ['ảnh_đêm', 'ảnh_đêm_2'])).toBe('ảnh_đêm_3');
  });

  it('derives distinct new and import handles from one persisted and active-reservation namespace', () => {
    const persisted = studioPieceHandleNamespaceV3(catalogue('ảnh_đêm', ['portrait']));
    const activeReservations = ['ảnh_đêm_2'];
    const generated = deriveStudioPieceHandleV3('Ảnh đêm', [...persisted, ...activeReservations]);
    const imported = deriveStudioPieceHandleFromImportFileNameV3('Ảnh đêm.png', [
      ...persisted,
      ...activeReservations,
      generated,
    ]);

    expect(generated).toBe('ảnh_đêm_3');
    expect(imported).toBe('ảnh_đêm_4');
    expect(new Set([...persisted, ...activeReservations, generated, imported]).size).toBe(5);
  });

  it('swaps an alias on rename-back without growing the alias list', () => {
    const project = catalogue('current', ['first', 'second']);
    expect(resolveStudioPieceRenameV3(project, 'piece_1', 'First')).toEqual({
      handle: 'first',
      priorHandles: ['current', 'second'],
    });
  });

  it('refuses another alias at the cap but permits rename-back at the cap', () => {
    const aliases = Array.from({ length: STUDIO_MAX_PIECE_PRIOR_HANDLES_V3 }, (_, index) => `alias_${index}`);
    const project = catalogue('current', aliases);
    expect(() => resolveStudioPieceRenameV3(project, 'piece_1', 'fresh')).toThrow(
      expect.objectContaining({ code: 'alias_limit' })
    );
    expect(resolveStudioPieceRenameV3(project, 'piece_1', aliases[7])).toEqual({
      handle: aliases[7],
      priorHandles: aliases.map((alias, index) => (index === 7 ? 'current' : alias)),
    });
  });

  it('refuses collisions with another current handle, retained alias, or reservation', () => {
    const project = catalogue('current', [], [['piece_2', 'other', ['retained']]]);
    for (const requested of ['other', 'retained']) {
      expect(() => resolveStudioPieceRenameV3(project, 'piece_1', requested), requested).toThrow(
        expect.objectContaining({ code: 'handle_collision' })
      );
    }
    expect(() => resolveStudioPieceRenameV3(project, 'piece_1', 'reserved', ['reserved'])).toThrow(
      expect.objectContaining({ code: 'handle_collision' })
    );
  });
});
