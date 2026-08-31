/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { types as nodeTypes } from 'node:util';
import { hasRuleToken, STUDIO_RULE_LIMITS } from '@/common/types/project/creativeStudioRules';
import {
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_UNDO_ENTRIES_V3,
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
  type StudioBriefRule,
  type StudioBriefRuleDraft,
  type StudioMutationBatchResultV3,
  type StudioMutationBatchV3,
  type StudioMutationOperationV3,
  type StudioProjectV3,
  type StudioSpendPolicy,
  type StudioUndoEntryV3,
} from '@/common/types/project/creativeStudioTypes';
import { validateStudioProjectV3 } from '../validation';
import { normalizeStudioPieceHandleV3, resolveStudioPieceRenameV3, StudioPieceHandleErrorV3 } from './pieceHandles';

export type StudioMutationReasonV3 =
  | 'invalid_operation'
  | 'authoring_revision_conflict'
  | 'identity_collision'
  | 'piece_not_found'
  | 'invalid_handle'
  | 'handle_collision'
  | 'alias_limit'
  | 'no_change'
  | 'undo_conflict'
  | 'validation_failed';

export class StudioMutationErrorV3 extends Error {
  readonly reasonCode: StudioMutationReasonV3;
  readonly operationIndex: number | null;

  constructor(reasonCode: StudioMutationReasonV3, operationIndex: number | null = null) {
    super(reasonCode);
    this.name = 'StudioMutationErrorV3';
    this.reasonCode = reasonCode;
    this.operationIndex = operationIndex;
  }
}

export type StudioMutationReducerContextV3 = {
  mutationId: string;
  capturedAt: string;
};

export type StudioMutationApplyResultV3 = {
  project: StudioProjectV3;
  result: StudioMutationBatchResultV3;
};

const fail = (reasonCode: StudioMutationReasonV3, operationIndex: number | null = null): never => {
  throw new StudioMutationErrorV3(reasonCode, operationIndex);
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const CURRENCY = /^[A-Z]{3}$/;
const LOWERCASE_SHA256 = /^[a-f0-9]{64}$/;
const BATCH_KEYS = new Set(['schemaVersion', 'projectId', 'expectedAuthoringRevision', 'operations']);
const CONTEXT_KEYS = new Set(['mutationId', 'capturedAt']);
const RULE_DRAFT_KEYS = new Set(['id', 'text', 'predicate']);
const RULE_PREDICATE_KEYS = new Set(['kind', 'terms']);
const SPEND_POLICY_KEYS = new Set(['currency', 'maxPerBatchMinorUnits']);
const OPERATION_KEYS: Readonly<Record<StudioMutationOperationV3['kind'], ReadonlySet<string>>> = {
  edit_project: new Set(['kind', 'name']),
  set_brief: new Set(['kind', 'brief']),
  set_rules: new Set(['kind', 'rules']),
  set_spend_policy: new Set(['kind', 'policy']),
  rename_piece: new Set(['kind', 'pieceId', 'handle']),
  undo_last: new Set(['kind', 'entryId']),
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean => {
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.size && ownKeys.every((key) => keys.has(key));
};

const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);
const isSafeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
};

const isDenseArray = (value: unknown, maximum: number): value is unknown[] => {
  if (!Array.isArray(value) || value.length > maximum || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || ownKeys.at(-1) !== 'length') return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return false;
  }
  return true;
};

const hasOnlyOwnDataDeep = (value: unknown, seen = new Set<object>()): boolean => {
  if (typeof value !== 'object' || value === null) return true;
  if (nodeTypes.isProxy(value) || seen.has(value)) return false;
  seen.add(value);
  try {
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) return false;
    } else if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, 'value') ||
        (!descriptor.enumerable && !(Array.isArray(value) && key === 'length')) ||
        !hasOnlyOwnDataDeep(descriptor.value, seen)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
};

const snapshotData = <T>(value: T): T => {
  if (!hasOnlyOwnDataDeep(value)) return fail('invalid_operation');
  try {
    return structuredClone(value);
  } catch {
    return fail('invalid_operation');
  }
};

const isRuleDraft = (value: unknown): value is StudioBriefRuleDraft => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, RULE_DRAFT_KEYS) ||
    !isSafeId(value.id) ||
    typeof value.text !== 'string' ||
    value.text.trim().length === 0 ||
    value.text.length > STUDIO_RULE_LIMITS.text
  ) {
    return false;
  }
  if (value.predicate === null) return true;
  if (
    !isRecord(value.predicate) ||
    !hasExactKeys(value.predicate, RULE_PREDICATE_KEYS) ||
    value.predicate.kind !== 'forbidden_terms' ||
    !isDenseArray(value.predicate.terms, STUDIO_RULE_LIMITS.maxTerms) ||
    value.predicate.terms.length === 0
  ) {
    return false;
  }
  const terms = new Set<string>();
  for (const term of value.predicate.terms) {
    if (
      typeof term !== 'string' ||
      term.trim().length === 0 ||
      term.length > STUDIO_RULE_LIMITS.term ||
      !hasRuleToken(term) ||
      terms.has(term)
    ) {
      return false;
    }
    terms.add(term);
  }
  return true;
};

const isRuleDraftArray = (value: unknown): value is StudioBriefRuleDraft[] => {
  if (!isDenseArray(value, STUDIO_RULE_LIMITS.maxRules)) return false;
  const ids = new Set<string>();
  for (const rule of value) {
    if (!isRuleDraft(rule) || ids.has(rule.id)) return false;
    ids.add(rule.id);
  }
  return true;
};

const isSpendPolicy = (value: unknown): value is StudioSpendPolicy =>
  isRecord(value) &&
  hasExactKeys(value, SPEND_POLICY_KEYS) &&
  typeof value.currency === 'string' &&
  CURRENCY.test(value.currency) &&
  isSafeInteger(value.maxPerBatchMinorUnits) &&
  value.maxPerBatchMinorUnits >= 0;

const assertOperation: (value: unknown) => asserts value is StudioMutationOperationV3 = (value) => {
  if (!isRecord(value) || typeof value.kind !== 'string' || !Object.hasOwn(OPERATION_KEYS, value.kind)) {
    return fail('invalid_operation');
  }
  const kind = value.kind as StudioMutationOperationV3['kind'];
  if (!hasExactKeys(value, OPERATION_KEYS[kind])) return fail('invalid_operation');
  switch (kind) {
    case 'edit_project':
      if (
        typeof value.name !== 'string' ||
        value.name.length > 256 ||
        value.name.trim().length === 0 ||
        value.name !== value.name.trim()
      ) {
        return fail('invalid_operation');
      }
      return;
    case 'set_brief':
      if (typeof value.brief !== 'string' || value.brief.length > 16 * 1024) return fail('invalid_operation');
      return;
    case 'set_rules':
      if (!isRuleDraftArray(value.rules)) return fail('invalid_operation');
      return;
    case 'set_spend_policy':
      if (value.policy !== null && !isSpendPolicy(value.policy)) return fail('invalid_operation');
      return;
    case 'rename_piece':
      if (!isSafeId(value.pieceId)) return fail('invalid_operation');
      try {
        // Parse the explicit text through the shared authority, but retain it for the reducer.
        normalizeStudioPieceHandleV3(value.handle, 'rename');
      } catch {
        return fail('invalid_handle');
      }
      return;
    case 'undo_last':
      if (!isSafeId(value.entryId)) return fail('invalid_operation');
      return;
  }
};

/** Exact, side-effect-free parser for a schema-6 authoring operation. */
export const validateStudioMutationOperationV3 = (value: unknown): value is StudioMutationOperationV3 => {
  try {
    const snapshot = snapshotData(value);
    assertOperation(snapshot);
    return true;
  } catch {
    return false;
  }
};

/** Exact, hostile-input-safe parser for a complete schema-6 mutation batch. */
export const parseStudioMutationBatchV3 = (value: unknown): StudioMutationBatchV3 => {
  const snapshot = snapshotData(value);
  if (
    !isRecord(snapshot) ||
    !hasExactKeys(snapshot, BATCH_KEYS) ||
    snapshot.schemaVersion !== STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3 ||
    !isSafeId(snapshot.projectId) ||
    !isSafeInteger(snapshot.expectedAuthoringRevision) ||
    snapshot.expectedAuthoringRevision < 1 ||
    !isDenseArray(snapshot.operations, STUDIO_MAX_MUTATION_OPERATIONS) ||
    snapshot.operations.length < 1
  ) {
    return fail('invalid_operation');
  }
  for (const operation of snapshot.operations) assertOperation(operation);
  const operations = snapshot.operations as StudioMutationOperationV3[];
  const renameCount = operations.filter((operation) => operation.kind === 'rename_piece').length;
  if (renameCount > 1 || (renameCount === 1 && operations.length !== 1)) {
    return fail('invalid_operation');
  }
  if (operations.some((operation) => operation.kind === 'undo_last') && operations.length !== 1) {
    return fail('invalid_operation');
  }
  return snapshot as StudioMutationBatchV3;
};

const parseContext = (value: unknown): StudioMutationReducerContextV3 => {
  const snapshot = snapshotData(value);
  if (
    !isRecord(snapshot) ||
    !hasExactKeys(snapshot, CONTEXT_KEYS) ||
    !isSafeId(snapshot.mutationId) ||
    !isCanonicalTimestamp(snapshot.capturedAt)
  ) {
    return fail('invalid_operation');
  }
  return snapshot as StudioMutationReducerContextV3;
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
};

const sameValue = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);

const pieceCatalogProjection = (project: Pick<StudioProjectV3, 'pieceOrder' | 'pieces'>): unknown[] =>
  project.pieceOrder.map((pieceId) => {
    const piece = Object.hasOwn(project.pieces, pieceId) ? project.pieces[pieceId] : undefined;
    if (piece === undefined) return fail('validation_failed');
    return { pieceId, handle: piece.handle, priorHandles: [...piece.priorHandles] };
  });

/** Digest of only authored Piece handle/alias state; runtime Job and asset fields are excluded. */
export const studioPieceCatalogDigestV3 = (project: Pick<StudioProjectV3, 'pieceOrder' | 'pieces'>): string =>
  createHash('sha256')
    .update('weprompt:studio-piece-catalog-undo:v1\0', 'utf8')
    .update(canonicalJson(pieceCatalogProjection(project)), 'utf8')
    .digest('hex');

const mapHandleError = (error: StudioPieceHandleErrorV3): StudioMutationReasonV3 => {
  switch (error.code) {
    case 'handle_collision':
      return 'handle_collision';
    case 'alias_limit':
      return 'alias_limit';
    case 'no_change':
      return 'no_change';
    case 'invalid_namespace':
      return 'validation_failed';
    default:
      return 'invalid_handle';
  }
};

const applyUndo = (
  project: StudioProjectV3,
  entryId: string,
  context: StudioMutationReducerContextV3
): StudioProjectV3 => {
  const entry = project.undoHistory.at(-1);
  if (
    entry === undefined ||
    entry.id !== entryId ||
    entry.patches.length !== 1 ||
    studioPieceCatalogDigestV3(project) !== entry.patches[0].afterDigest
  ) {
    return fail('undo_conflict');
  }
  const patch = entry.patches[0];
  const piece = Object.hasOwn(project.pieces, patch.pieceId) ? project.pieces[patch.pieceId] : undefined;
  if (piece === undefined) return fail('undo_conflict');
  const draft = structuredClone(project);
  draft.pieces[patch.pieceId] = {
    ...draft.pieces[patch.pieceId]!,
    handle: patch.before.handle,
    priorHandles: [...patch.before.priorHandles],
    updatedAt: context.capturedAt,
  };
  draft.undoHistory = draft.undoHistory.slice(0, -1);
  return draft;
};

/**
 * Applies one atomic schema-6 authoring batch. Storage revision is intentionally not accepted from
 * the renderer: Main calls this with its current queued project and both revisions advance once.
 */
export const applyStudioMutationBatchV3 = (
  project: StudioProjectV3,
  batch: unknown,
  context: StudioMutationReducerContextV3
): StudioMutationApplyResultV3 => {
  if (!validateStudioProjectV3(project)) return fail('validation_failed');
  const parsedBatch = parseStudioMutationBatchV3(batch);
  const parsedContext = parseContext(context);
  if (parsedBatch.projectId !== project.id) return fail('invalid_operation');
  if (parsedBatch.expectedAuthoringRevision !== project.authoringRevision) {
    return fail('authoring_revision_conflict');
  }
  if (
    project.revision >= Number.MAX_SAFE_INTEGER ||
    project.authoringRevision >= Number.MAX_SAFE_INTEGER ||
    parsedContext.capturedAt < project.updatedAt
  ) {
    return fail('validation_failed');
  }

  let draft = structuredClone(project);
  const undoOperation = parsedBatch.operations[0]?.kind === 'undo_last' ? parsedBatch.operations[0] : null;
  if (undoOperation?.kind === 'undo_last') {
    draft = applyUndo(draft, undoOperation.entryId, parsedContext);
  } else {
    let renameBefore: { pieceId: string; handle: string; priorHandles: string[] } | null = null;
    for (let operationIndex = 0; operationIndex < parsedBatch.operations.length; operationIndex += 1) {
      const operation = parsedBatch.operations[operationIndex]!;
      try {
        switch (operation.kind) {
          case 'edit_project':
            if (draft.name === operation.name) return fail('no_change');
            draft.name = operation.name;
            break;
          case 'set_brief':
            if (draft.brief === operation.brief) return fail('no_change');
            draft.brief = operation.brief;
            break;
          case 'set_rules': {
            const existingById = new Map(draft.rules.map((rule) => [rule.id, rule]));
            const rules: StudioBriefRule[] = operation.rules.map((rule) => ({
              id: rule.id,
              scope: 'project',
              text: rule.text,
              predicate: rule.predicate === null ? null : { kind: 'forbidden_terms', terms: [...rule.predicate.terms] },
              createdAt: existingById.get(rule.id)?.createdAt ?? parsedContext.capturedAt,
            }));
            if (sameValue(draft.rules, rules)) return fail('no_change');
            draft.rules = rules;
            break;
          }
          case 'set_spend_policy':
            if (sameValue(draft.spendPolicy, operation.policy)) return fail('no_change');
            draft.spendPolicy = operation.policy === null ? null : { ...operation.policy };
            break;
          case 'rename_piece': {
            const piece = Object.hasOwn(draft.pieces, operation.pieceId) ? draft.pieces[operation.pieceId] : undefined;
            if (piece === undefined || !draft.pieceOrder.includes(operation.pieceId)) {
              return fail('piece_not_found');
            }
            renameBefore = {
              pieceId: piece.id,
              handle: piece.handle,
              priorHandles: [...piece.priorHandles],
            };
            const renamed = resolveStudioPieceRenameV3(draft, piece.id, operation.handle);
            draft.pieces[piece.id] = {
              ...piece,
              ...renamed,
              updatedAt: parsedContext.capturedAt,
            };
            break;
          }
          case 'undo_last':
            return fail('invalid_operation');
        }
      } catch (error) {
        if (error instanceof StudioPieceHandleErrorV3) {
          throw new StudioMutationErrorV3(mapHandleError(error), operationIndex);
        }
        if (error instanceof StudioMutationErrorV3 && error.operationIndex === null) {
          throw new StudioMutationErrorV3(error.reasonCode, operationIndex);
        }
        throw error;
      }
    }

    if (renameBefore !== null) {
      if (draft.undoHistory.some((entry) => entry.id === parsedContext.mutationId)) {
        return fail('identity_collision');
      }
      const undoEntry: StudioUndoEntryV3 = {
        id: parsedContext.mutationId,
        sourceRevision: project.revision + 1,
        sourceAuthoringRevision: project.authoringRevision + 1,
        label: 'rename_piece',
        patches: [
          {
            kind: 'piece_catalog',
            pieceId: renameBefore.pieceId,
            before: {
              handle: renameBefore.handle,
              priorHandles: renameBefore.priorHandles,
            },
            afterDigest: studioPieceCatalogDigestV3(draft),
          },
        ],
      };
      draft.undoHistory = [...draft.undoHistory, undoEntry].slice(-STUDIO_MAX_UNDO_ENTRIES_V3);
    }
  }

  draft.revision += 1;
  draft.authoringRevision += 1;
  draft.updatedAt = parsedContext.capturedAt;
  if (!validateStudioProjectV3(draft)) return fail('validation_failed');
  return {
    project: draft,
    result: {
      projectId: draft.id,
      revision: draft.revision,
      authoringRevision: draft.authoringRevision,
    },
  };
};

export const isStudioPieceCatalogDigestV3 = (value: unknown): value is string =>
  typeof value === 'string' && LOWERCASE_SHA256.test(value);
