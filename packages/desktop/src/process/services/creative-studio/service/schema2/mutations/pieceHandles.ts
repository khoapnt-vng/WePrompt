/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MAX_PIECES_V3,
  STUDIO_MAX_PIECE_HANDLE_SCALARS_V3,
  STUDIO_MAX_PIECE_HANDLE_UTF8_BYTES_V3,
  STUDIO_MAX_PIECE_PRIOR_HANDLES_V3,
  type StudioPieceV2,
  type StudioProjectV3,
} from '@/common/types/project/creativeStudioTypes';

export type StudioPieceHandleModeV3 = 'derive' | 'rename';

export type StudioPieceHandleErrorCodeV3 =
  | 'invalid_input'
  | 'unsafe_character'
  | 'empty_handle'
  | 'handle_too_long'
  | 'handle_collision'
  | 'alias_limit'
  | 'no_change'
  | 'invalid_namespace';

/** A bounded refusal suitable for translation at the renderer boundary. */
export class StudioPieceHandleErrorV3 extends Error {
  readonly code: StudioPieceHandleErrorCodeV3;

  constructor(code: StudioPieceHandleErrorCodeV3) {
    super(code);
    this.name = 'StudioPieceHandleErrorV3';
    this.code = code;
  }
}

const fail = (code: StudioPieceHandleErrorCodeV3): never => {
  throw new StudioPieceHandleErrorV3(code);
};

const LETTER_OR_NUMBER = /^[\p{L}\p{Nd}]$/u;
const MARK = /^\p{M}$/u;
const ORDINARY_SEPARATOR = /^[\p{P}\p{Z}]$/u;
const UNSAFE = /^[\p{Cc}\p{Cf}\p{Cs}\p{Co}]$/u;
const DEFAULT_IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u;
const MAX_NAMESPACE_ENTRIES = STUDIO_MAX_PIECES_V3 * (STUDIO_MAX_PIECE_PRIOR_HANDLES_V3 + 2);

const utf8Length = (value: string): number => Buffer.byteLength(value, 'utf8');

const withinHandleBounds = (value: string): boolean =>
  [...value].length <= STUDIO_MAX_PIECE_HANDLE_SCALARS_V3 && utf8Length(value) <= STUDIO_MAX_PIECE_HANDLE_UTF8_BYTES_V3;

const appendSeparator = (parts: string[]): void => {
  if (parts.length > 0 && parts.at(-1) !== '_') parts.push('_');
};

const normalizedHandleBody = (input: string, mode: StudioPieceHandleModeV3): string => {
  let normalized: string;
  try {
    normalized = input.normalize('NFKC').toLowerCase();
  } catch {
    return fail('invalid_input');
  }

  const parts: string[] = [];
  let markHasBase = false;
  for (const scalar of normalized) {
    if (scalar === '/' || scalar === '\\' || UNSAFE.test(scalar) || DEFAULT_IGNORABLE.test(scalar)) {
      if (mode === 'rename') return fail('unsafe_character');
      continue;
    }
    if (LETTER_OR_NUMBER.test(scalar)) {
      parts.push(scalar);
      markHasBase = true;
      continue;
    }
    if (MARK.test(scalar)) {
      if (markHasBase && parts.at(-1) !== '_') {
        parts.push(scalar);
      } else if (mode === 'rename') {
        return fail('unsafe_character');
      }
      continue;
    }
    if (ORDINARY_SEPARATOR.test(scalar) || /\s/u.test(scalar)) {
      appendSeparator(parts);
      markHasBase = false;
      continue;
    }
    // Symbols (including emoji) and unassigned scalars are unsuitable in a durable handle.
    if (mode === 'rename') return fail('unsafe_character');
  }

  while (parts.at(-1) === '_') parts.pop();
  return parts.join('');
};

/**
 * Applies the one Pilot handle normalization authority.
 *
 * Derivation is lossy and bounded by design. Explicit rename is never truncated or given a
 * fallback, and refuses characters that the stored form would otherwise silently discard.
 */
export const normalizeStudioPieceHandleV3 = (input: unknown, mode: StudioPieceHandleModeV3): string => {
  if (typeof input !== 'string') return fail('invalid_input');
  const body = normalizedHandleBody(input, mode);
  if (mode === 'rename') {
    if (body.length === 0) return fail('empty_handle');
    if (!withinHandleBounds(body)) return fail('handle_too_long');
    return body;
  }
  return truncateStudioPieceHandleV3(body.length === 0 ? 'piece' : body);
};

/** Returns whether a persisted handle is already in its exact bounded stored form. */
export const isCanonicalStudioPieceHandleV3 = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0 || !withinHandleBounds(value)) return false;
  try {
    return normalizeStudioPieceHandleV3(value, 'rename') === value;
  } catch {
    return false;
  }
};

/**
 * Truncates without splitting a Unicode scalar or separating trailing combining marks from their
 * base. The supplied value must already contain only stored-handle characters.
 */
export const truncateStudioPieceHandleV3 = (value: string, suffix = ''): string => {
  const suffixScalars = [...suffix].length;
  const suffixBytes = utf8Length(suffix);
  if (suffixScalars > STUDIO_MAX_PIECE_HANDLE_SCALARS_V3 || suffixBytes > STUDIO_MAX_PIECE_HANDLE_UTF8_BYTES_V3) {
    return fail('handle_too_long');
  }

  const clusters: string[] = [];
  for (const scalar of value) {
    if (MARK.test(scalar) && clusters.length > 0) clusters[clusters.length - 1] += scalar;
    else clusters.push(scalar);
  }
  const retained: string[] = [];
  let scalars = suffixScalars;
  let bytes = suffixBytes;
  for (const cluster of clusters) {
    const nextScalars = [...cluster].length;
    const nextBytes = utf8Length(cluster);
    if (
      scalars + nextScalars > STUDIO_MAX_PIECE_HANDLE_SCALARS_V3 ||
      bytes + nextBytes > STUDIO_MAX_PIECE_HANDLE_UTF8_BYTES_V3
    ) {
      break;
    }
    retained.push(cluster);
    scalars += nextScalars;
    bytes += nextBytes;
  }
  while (retained.at(-1) === '_') retained.pop();
  if (retained.length === 0 && value !== 'piece') return truncateStudioPieceHandleV3('piece', suffix);
  const result = `${retained.join('')}${suffix}`;
  if (result.length === 0 || !withinHandleBounds(result)) return fail('handle_too_long');
  return result;
};

const boundedNamespace = (values: Iterable<string>): Set<string> => {
  const namespace = new Set<string>();
  try {
    for (const value of values) {
      if (!isCanonicalStudioPieceHandleV3(value)) return fail('invalid_namespace');
      if (namespace.has(value)) return fail('invalid_namespace');
      namespace.add(value);
      if (namespace.size > MAX_NAMESPACE_ENTRIES) return fail('invalid_namespace');
    }
  } catch (error) {
    if (error instanceof StudioPieceHandleErrorV3) throw error;
    return fail('invalid_namespace');
  }
  return namespace;
};

/** Derives a unique handle, including collision checks against aliases and active reservations. */
export const deriveStudioPieceHandleV3 = (input: unknown, unavailable: Iterable<string> = []): string => {
  const namespace = boundedNamespace(unavailable);
  const base = normalizeStudioPieceHandleV3(input, 'derive');
  if (!namespace.has(base)) return base;
  for (let ordinal = 2; ordinal <= namespace.size + 2; ordinal += 1) {
    const suffix = `_${ordinal}`;
    const candidate = truncateStudioPieceHandleV3(base, suffix);
    if (!namespace.has(candidate)) return candidate;
  }
  return fail('invalid_namespace');
};

/** Derives from a native-picker basename after removing only its final extension. */
export const deriveStudioPieceHandleFromImportFileNameV3 = (
  fileName: unknown,
  unavailable: Iterable<string> = []
): string => {
  if (typeof fileName !== 'string' || fileName.length === 0 || fileName.includes('/') || fileName.includes('\\')) {
    return fail('invalid_input');
  }
  const finalDot = fileName.lastIndexOf('.');
  const stem = finalDot > 0 ? fileName.slice(0, finalDot) : fileName;
  return deriveStudioPieceHandleV3(stem, unavailable);
};

/** Collects the complete current-handle and retained-alias namespace. */
export const studioPieceHandleNamespaceV3 = (
  project: Pick<StudioProjectV3, 'pieceOrder' | 'pieces'>,
  excludePieceId: string | null = null,
  reservations: Iterable<string> = []
): Set<string> => {
  const values: string[] = [];
  for (const pieceId of project.pieceOrder) {
    if (pieceId === excludePieceId) continue;
    const piece = Object.hasOwn(project.pieces, pieceId) ? project.pieces[pieceId] : undefined;
    if (piece === undefined) return fail('invalid_namespace');
    values.push(piece.handle, ...piece.priorHandles);
  }
  for (const reservation of reservations) values.push(reservation);
  return boundedNamespace(values);
};

export type StudioPieceRenameStateV3 = Pick<StudioPieceV2, 'handle' | 'priorHandles'>;

/** Resolves a collision-safe rename, including the bounded rename-back alias swap. */
export const resolveStudioPieceRenameV3 = (
  project: Pick<StudioProjectV3, 'pieceOrder' | 'pieces'>,
  pieceId: string,
  requestedHandle: unknown,
  reservations: Iterable<string> = []
): StudioPieceRenameStateV3 => {
  const piece = Object.hasOwn(project.pieces, pieceId) ? project.pieces[pieceId] : undefined;
  if (piece === undefined || !project.pieceOrder.includes(pieceId)) return fail('invalid_namespace');
  const handle = normalizeStudioPieceHandleV3(requestedHandle, 'rename');
  if (handle === piece.handle) return fail('no_change');

  const priorIndex = piece.priorHandles.indexOf(handle);
  const unavailable = studioPieceHandleNamespaceV3(project, pieceId, reservations);
  if (unavailable.has(handle)) return fail('handle_collision');
  if (priorIndex >= 0) {
    const priorHandles = [...piece.priorHandles];
    priorHandles[priorIndex] = piece.handle;
    return { handle, priorHandles };
  }
  if (piece.priorHandles.length >= STUDIO_MAX_PIECE_PRIOR_HANDLES_V3) return fail('alias_limit');
  return { handle, priorHandles: [...piece.priorHandles, piece.handle] };
};
