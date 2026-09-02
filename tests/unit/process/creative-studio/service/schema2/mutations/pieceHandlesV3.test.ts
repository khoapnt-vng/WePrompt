/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_MAX_ASSEMBLIES_V4,
  STUDIO_MAX_BOARDS_V4,
  STUDIO_MAX_PIECES_V3,
  STUDIO_MAX_PIECE_HANDLE_SCALARS_V3,
  STUDIO_MAX_PIECE_PRIOR_HANDLES_V3,
  type StudioProjectV3,
} from '@/common/types/project/creativeStudioTypes';
import {
  deriveStudioPieceHandleFromImportFileNameV3,
  deriveStudioPieceHandleV3,
  deriveStudioPieceCreateIdentityV4,
  isCanonicalStudioPieceHandleV3,
  normalizeStudioPieceHandleV3,
  resolveStudioPieceRenameV3,
  studioCanvasHandleNamespaceV4,
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
    ['Persian ZWNJ', 'عکس‌های شب', 'عکس‌های_شب'],
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

  it('preserves a contextual Persian ZWNJ across derive, import, rename, and canonical checks', () => {
    const handle = 'عکس‌های';
    expect(normalizeStudioPieceHandleV3(handle, 'derive')).toBe(handle);
    expect(normalizeStudioPieceHandleV3(handle, 'rename')).toBe(handle);
    expect(deriveStudioPieceHandleV3(handle)).toBe(handle);
    expect(deriveStudioPieceHandleFromImportFileNameV3(`${handle}.png`)).toBe(handle);
    expect(isCanonicalStudioPieceHandleV3(handle)).toBe(true);
    expect(resolveStudioPieceRenameV3(catalogue('photo'), 'piece_1', handle)).toEqual({
      handle,
      priorHandles: ['photo'],
    });
  });

  it('refuses ineffective or ambiguous joiner contexts and keeps ZWJ and bidi controls unsafe', () => {
    for (const value of [
      '\u200Cسه',
      'سه\u200C',
      'ا\u200Cب',
      'د\u200Cه',
      'و\u200Cی',
      'س\u200Cء',
      'a\u200Cب',
      'س\u200Ca',
      'س\u200Dه',
      'س\u202Eه',
      'سَ\u200Cه',
      'س\u200Cَه',
    ]) {
      expect(() => normalizeStudioPieceHandleV3(value, 'rename'), value).toThrow(
        expect.objectContaining({ code: 'unsafe_character' })
      );
      expect(isCanonicalStudioPieceHandleV3(value), value).toBe(false);
    }
  });

  it('discards a malformed joiner during derivation without admitting it into the stored form', () => {
    expect(deriveStudioPieceHandleV3('photo\u200C')).toBe('photo');
    expect(deriveStudioPieceHandleV3('س\u200Dه')).toBe('سه');
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

    const overBoundaryWithJoiner = `${'a'.repeat(STUDIO_MAX_PIECE_HANDLE_SCALARS_V3 - 2)}س\u200Cه`;
    const truncatedJoiner = deriveStudioPieceHandleV3(overBoundaryWithJoiner);
    expect(truncatedJoiner.endsWith('\u200C')).toBe(false);
    expect(isCanonicalStudioPieceHandleV3(truncatedJoiner)).toBe(true);

    const exactBoundaryWithJoiner = `${'a'.repeat(STUDIO_MAX_PIECE_HANDLE_SCALARS_V3 - 3)}س\u200Cه`;
    const suffixedJoiner = deriveStudioPieceHandleV3(exactBoundaryWithJoiner, [exactBoundaryWithJoiner]);
    expect(suffixedJoiner.endsWith('_2')).toBe(true);
    expect(suffixedJoiner.includes('\u200C')).toBe(false);
    expect(isCanonicalStudioPieceHandleV3(suffixedJoiner)).toBe(true);
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
    expect(deriveStudioPieceHandleV3('عکس‌های', ['عکس‌های'])).toBe('عکس‌های_2');
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

describe('schema-7 immutable run stems', () => {
  it('uses one namespace across Piece, Board, Assembly, aliases, and reservations', () => {
    const namespace = studioCanvasHandleNamespaceV4(
      {
        pieceOrder: ['piece_1'],
        pieces: {
          piece_1: { handle: 'photo', priorHandles: ['portrait'] },
        },
        boardOrder: ['board_1'],
        boards: {
          board_1: { handle: 'storyboard', priorHandles: ['board_alias'] },
        },
        assemblyOrder: ['assembly_1'],
        assemblies: {
          assembly_1: { handle: 'the_cut', priorHandles: ['cut_alias'] },
        },
      } as never,
      ['reserved']
    );

    expect([...namespace]).toEqual([
      'photo',
      'portrait',
      'storyboard',
      'board_alias',
      'the_cut',
      'cut_alias',
      'reserved',
    ]);
    expect(deriveStudioPieceCreateIdentityV4(null, 'Storyboard', namespace)).toEqual({
      proposedHandle: 'storyboard_2',
      runStem: null,
    });
    expect(deriveStudioPieceCreateIdentityV4('The cut', 'ignored', namespace)).toEqual({
      proposedHandle: 'the_cut_2',
      runStem: 'the_cut',
    });
  });

  it('admits the complete schema-7 namespace bound and refuses one entry beyond it', () => {
    const maximum =
      (STUDIO_MAX_PIECES_V3 + STUDIO_MAX_BOARDS_V4 + STUDIO_MAX_ASSEMBLIES_V4) *
        (STUDIO_MAX_PIECE_PRIOR_HANDLES_V3 + 1) +
      STUDIO_MAX_PIECES_V3;
    const fullNamespace = Array.from({ length: maximum }, (_, index) => `subject_${index}`);

    expect(deriveStudioPieceCreateIdentityV4(null, 'fresh', fullNamespace)).toEqual({
      proposedHandle: 'fresh',
      runStem: null,
    });
    expect(() => deriveStudioPieceCreateIdentityV4(null, 'fresh', [...fullNamespace, 'overflow'])).toThrow(
      expect.objectContaining({ code: 'invalid_namespace' })
    );
  });

  it('stops consuming active reservations at the schema bound and contains hostile iterables', () => {
    const emptyCanvas = {
      pieceOrder: [],
      pieces: {},
      boardOrder: [],
      boards: {},
      assemblyOrder: [],
      assemblies: {},
    } as never;
    const maximum =
      (STUDIO_MAX_PIECES_V3 + STUDIO_MAX_BOARDS_V4 + STUDIO_MAX_ASSEMBLIES_V4) *
        (STUDIO_MAX_PIECE_PRIOR_HANDLES_V3 + 1) +
      STUDIO_MAX_PIECES_V3;
    let yielded = 0;
    function* endlessReservations(): Generator<string> {
      while (true) {
        const ordinal = yielded;
        yielded += 1;
        yield `reservation_${ordinal}`;
      }
    }

    expect(() => studioCanvasHandleNamespaceV4(emptyCanvas, endlessReservations())).toThrow(
      expect.objectContaining({ code: 'invalid_namespace' })
    );
    expect(yielded).toBe(maximum + 1);

    const hostile = {
      [Symbol.iterator]: () => {
        throw new Error('must be contained');
      },
    };
    expect(() => studioCanvasHandleNamespaceV4(emptyCanvas, hostile)).toThrow(
      expect.objectContaining({ code: 'invalid_namespace' })
    );
  });

  it('keeps one long explicit suggestion stable while collision suffixes truncate each visible handle', () => {
    const suggestion = 'A salt flat at dawn, one figure walking away from camera';
    const first = deriveStudioPieceCreateIdentityV4(suggestion, 'first words');
    const second = deriveStudioPieceCreateIdentityV4(suggestion, 'different words', [first.proposedHandle]);
    const unavailable = [first.proposedHandle, second.proposedHandle];
    for (let ordinal = 3; ordinal < 10; ordinal += 1) {
      unavailable.push(deriveStudioPieceCreateIdentityV4(suggestion, `attempt ${ordinal}`, unavailable).proposedHandle);
    }
    const tenth = deriveStudioPieceCreateIdentityV4(suggestion, 'tenth words', unavailable);

    expect(first).toEqual({
      proposedHandle: 'a_salt_flat_at_dawn_one_figure_walking_away_from',
      runStem: 'a_salt_flat_at_dawn_one_figure_walking_away_from',
    });
    expect(second).toEqual({
      proposedHandle: 'a_salt_flat_at_dawn_one_figure_walking_away_fr_2',
      runStem: first.runStem,
    });
    expect(tenth).toEqual({
      proposedHandle: 'a_salt_flat_at_dawn_one_figure_walking_away_f_10',
      runStem: first.runStem,
    });
  });

  it('does not imply sibling grouping when creation falls back to request words', () => {
    const first = deriveStudioPieceCreateIdentityV4(null, 'same words');
    const second = deriveStudioPieceCreateIdentityV4(null, 'same words', [first.proposedHandle]);

    expect(first).toEqual({ proposedHandle: 'same_words', runStem: null });
    expect(second).toEqual({ proposedHandle: 'same_words_2', runStem: null });
    expect(() => deriveStudioPieceCreateIdentityV4(undefined, 'words')).toThrow(
      expect.objectContaining({ code: 'invalid_input' })
    );
  });
});
