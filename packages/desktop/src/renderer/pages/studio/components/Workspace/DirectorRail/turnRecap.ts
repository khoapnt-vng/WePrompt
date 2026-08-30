/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BUILTIN_STUDIO_NAME } from '@/common/config/builtinCapabilities';
import {
  STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_PROJECT_STATUS_STAGE_ORDER_V2,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  type StudioRendererProposalCatalogV2,
} from '@/common/types/project/creativeStudioTypes';
import type {
  InterpretedToolOutcome,
  ToolOutcomeInterpreter,
  TurnDomainOutcome,
} from '@/renderer/pages/conversation/Messages/components/toolActivity/buildTurnClose';

const STUDIO_TOOLS = [
  'studio_list_routes',
  'read_storyboard',
  'studio_get_conditioning_frame',
  'studio_request_reference_images',
  'propose_storyboard',
  'propose_brief_rule',
  'studio_apply_edits',
  'studio_apply_free_fix',
  'studio_propose_paid_recovery',
  'studio_get_project_status',
  'studio_get_proposal',
  'studio_get_command_status',
] as const;

type StudioToolName = (typeof STUDIO_TOOLS)[number];

const STUDIO_TOOL_NAMES = new Set<string>(STUDIO_TOOLS);
const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;
const MAX_STORED_OUTPUT_CHARS = 1024 * 1024;
const PROPOSAL_OUTPUT =
  /^Proposal ([A-Za-z0-9_-]{1,256}) recorded for user review; the user decides what happens next\.$/;
const RULE_OUTPUT =
  /^Rule ([A-Za-z0-9_-]{1,256}) recorded for user review; nothing is pinned until the user accepts it\.$/;
const REFERENCE_REQUEST_OUTPUT =
  /^Queued ([1-9][0-9]*) reference image request\(s\) for user approval\. Nothing was generated\.$/;

type ProposalOutcomeIndex = ReadonlyMap<string, TurnDomainOutcome> | null;
type PendingProposalIdentity = Record<string, unknown> & { id: string };
type ReceiptIdentity = Record<string, unknown> & { commandId: string; decidedAt: string };
type DirectorQuery =
  | { kind: 'get_project_status'; detail: boolean }
  | { kind: 'list_routes' }
  | { kind: 'get_proposal'; proposalId: string };

const APPLIED_RECEIPT_KEYS = [
  'schemaVersion',
  'commandId',
  'projectId',
  'expectedRevision',
  'decidedAt',
  'status',
  'appliedRevision',
  'createdBeatIds',
  'createdShotIds',
] as const;
const FREE_FIX_APPLIED_RECEIPT_KEYS = [
  'schemaVersion',
  'commandId',
  'projectId',
  'expectedRevision',
  'decidedAt',
  'status',
  'appliedRevision',
  'recovery',
] as const;
const RECORDED_RECEIPT_KEYS = [
  'schemaVersion',
  'commandId',
  'projectId',
  'expectedRevision',
  'decidedAt',
  'status',
  'proposal',
] as const;
const TERMINAL_RECEIPT_KEYS = [
  'schemaVersion',
  'commandId',
  'projectId',
  'expectedRevision',
  'decidedAt',
  'status',
  'observedRevision',
  'reasonCode',
] as const;
const QUERY_ANSWERED_RECEIPT_KEYS = [
  'schemaVersion',
  'commandId',
  'projectId',
  'decidedAt',
  'status',
  'query',
  'result',
] as const;
const QUERY_TERMINAL_RECEIPT_KEYS = [
  'schemaVersion',
  'commandId',
  'projectId',
  'decidedAt',
  'status',
  'query',
  'reasonCode',
] as const;
const PROPOSAL_RECORD_KEYS = [
  'schemaVersion',
  'id',
  'projectId',
  'status',
  'baseRevision',
  'payload',
  'createdAt',
  'decidedAt',
] as const;
const REJECTION_CODES = new Set([
  'malformed_record',
  'unsupported_version',
  'operation_not_permitted',
  'stale_revision',
  'future_revision',
  'project_not_found',
  'beat_capacity_reached',
  'beat_shot_capacity_reached',
  'project_shot_capacity_reached',
  'invalid_shot_duration',
  'dependency_blocked',
  'identity_collision',
  'invalid_operation',
  'validation_failed',
]);
const NULLABLE_EXPECTED_REVISION_CODES = new Set(['malformed_record', 'unsupported_version']);
const EXPIRY_CODES = new Set(['deadline_elapsed', 'expired_after_restart']);
const INDETERMINATE_CODES = new Set(['commit_attribution_unknown', 'indeterminate_after_restart']);
const QUERY_FAILURE_CODES = new Set([
  'project_not_found',
  'unsupported_prototype_schema',
  'route_inventory_unavailable',
  'project_read_unavailable',
  'response_too_large',
  'result_mismatch',
]);
const MUTATION_TOOLS = new Set<StudioToolName>([
  'studio_apply_edits',
  'studio_apply_free_fix',
  'studio_propose_paid_recovery',
  'studio_get_command_status',
]);
const DIRECT_COMMAND_TOOLS = new Set<StudioToolName>([
  'studio_apply_edits',
  'studio_apply_free_fix',
  'studio_propose_paid_recovery',
  'studio_get_project_status',
  'studio_list_routes',
  'studio_get_proposal',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_STUDIO_ID.test(value);

const isSafeRevision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1;

const isSafeTimestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length === 24 &&
  Number.isFinite(Date.parse(value)) &&
  new Date(Date.parse(value)).toISOString() === value;

const isNonnegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every((key) => typeof key === 'string' && keys.includes(key));
};

const isUniqueSafeIdArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= STUDIO_MAX_MUTATION_OPERATIONS &&
  value.every(isSafeId) &&
  new Set(value).size === value.length;

const parseExactRecord = (value: string | undefined): Record<string, unknown> | null => {
  if (value === undefined || value.length === 0 || value.length > MAX_STORED_OUTPUT_CHARS) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const toolNameFromExactValue = (value: string | undefined): StudioToolName | null => {
  if (value === undefined) return null;
  if (STUDIO_TOOL_NAMES.has(value)) return value as StudioToolName;

  const mcpPrefix = `mcp__${BUILTIN_STUDIO_NAME}__`;
  const sidecarPrefix = `${BUILTIN_STUDIO_NAME}:`;
  const candidate = value.startsWith(mcpPrefix)
    ? value.slice(mcpPrefix.length)
    : value.startsWith(sidecarPrefix)
      ? value.slice(sidecarPrefix.length)
      : null;
  return candidate !== null && STUDIO_TOOL_NAMES.has(candidate) ? (candidate as StudioToolName) : null;
};

const resolveExactStudioTool = (input: Parameters<ToolOutcomeInterpreter>[0]): StudioToolName | null => {
  const matches = new Set<StudioToolName>();
  const add = (value: string | undefined): void => {
    const match = toolNameFromExactValue(value);
    if (match !== null) matches.add(match);
  };
  add(input.step.rawName);
  for (const call of input.step.calls) {
    add(call.name);
    const mcpIdentity = parseExactRecord(call.input);
    if (
      mcpIdentity !== null &&
      hasExactKeys(mcpIdentity, ['server_name', 'tool_name', 'tool_display_name']) &&
      mcpIdentity.server_name === BUILTIN_STUDIO_NAME &&
      typeof mcpIdentity.tool_name === 'string' &&
      typeof mcpIdentity.tool_display_name === 'string' &&
      call.description === `${BUILTIN_STUDIO_NAME}:${mcpIdentity.tool_name}`
    ) {
      add(mcpIdentity.tool_name);
    }
  }
  return matches.size === 1 ? [...matches][0]! : null;
};

const buildProposalOutcomeIndex = (
  projectId: string,
  projectRevision: number | null,
  catalog: StudioRendererProposalCatalogV2 | null
): ProposalOutcomeIndex => {
  if (
    !isSafeRevision(projectRevision) ||
    catalog === null ||
    catalog.projectId !== projectId ||
    catalog.projectRevision !== projectRevision ||
    !Array.isArray(catalog.proposals)
  ) {
    return null;
  }

  const outcomes = new Map<string, TurnDomainOutcome>();
  for (const proposal of catalog.proposals) {
    if (
      proposal.schemaVersion !== STUDIO_PROPOSAL_SCHEMA_VERSION_V2 ||
      !isSafeId(proposal.id) ||
      proposal.projectId !== projectId ||
      !isSafeRevision(proposal.baseRevision) ||
      !isSafeTimestamp(proposal.createdAt) ||
      (proposal.status === 'pending' ? proposal.decidedAt !== null : !isSafeTimestamp(proposal.decidedAt)) ||
      !isRecord(proposal.review) ||
      outcomes.has(proposal.id)
    ) {
      return null;
    }
    if (proposal.status === 'accepted') {
      outcomes.set(proposal.id, 'committed');
      continue;
    }
    if (proposal.status === 'rejected' || proposal.status === 'expired') {
      outcomes.set(proposal.id, 'refused');
      continue;
    }
    if (proposal.status !== 'pending') return null;
    switch (proposal.review.status) {
      case 'ready':
        outcomes.set(proposal.id, 'pending_review');
        break;
      case 'stale':
        outcomes.set(proposal.id, 'needs_revision');
        break;
      case 'unavailable':
        outcomes.set(proposal.id, 'refused');
        break;
      default:
        return null;
    }
  }
  return outcomes;
};

const hasReceiptIdentity = (value: Record<string, unknown>, projectId: string): value is ReceiptIdentity =>
  value.schemaVersion === STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2 &&
  isSafeId(value.commandId) &&
  value.projectId === projectId &&
  isSafeTimestamp(value.decidedAt);

const hasPendingProposalIdentity = (
  value: Record<string, unknown>,
  projectId: string
): value is PendingProposalIdentity =>
  value.schemaVersion === STUDIO_PROPOSAL_SCHEMA_VERSION_V2 &&
  isSafeId(value.id) &&
  value.projectId === projectId &&
  value.status === 'pending' &&
  isSafeRevision(value.baseRevision) &&
  isSafeTimestamp(value.createdAt) &&
  value.decidedAt === null;

const isProposalPayload = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (value.kind === 'mutation_batch') {
    return hasExactKeys(value, ['kind', 'operations']) && Array.isArray(value.operations);
  }
  if (value.kind === 'pin_rule') {
    return hasExactKeys(value, ['kind', 'rule']) && isRecord(value.rule);
  }
  if (value.kind !== 'paid_recovery' || !hasExactKeys(value, ['kind', 'blocker', 'quote'])) return false;
  if (!isRecord(value.blocker) || !isRecord(value.quote)) return false;
  const quote = value.quote;
  return (
    hasExactKeys(quote, [
      'quoteId',
      'projectRevision',
      'expiresAt',
      'currency',
      'lowerMinorUnits',
      'upperMinorUnits',
      'itemCount',
      'includesCascade',
    ]) &&
    isSafeId(quote.quoteId) &&
    isSafeRevision(quote.projectRevision) &&
    isSafeTimestamp(quote.expiresAt) &&
    typeof quote.currency === 'string' &&
    /^[A-Z]{3}$/.test(quote.currency) &&
    isNonnegativeSafeInteger(quote.lowerMinorUnits) &&
    isNonnegativeSafeInteger(quote.upperMinorUnits) &&
    quote.lowerMinorUnits <= quote.upperMinorUnits &&
    isNonnegativeSafeInteger(quote.itemCount) &&
    typeof quote.includesCascade === 'boolean'
  );
};

const isPendingProposalRecord = (
  value: unknown,
  projectId: string
): value is PendingProposalIdentity & { baseRevision: number; createdAt: string; payload: Record<string, unknown> } =>
  isRecord(value) &&
  hasExactKeys(value, PROPOSAL_RECORD_KEYS) &&
  hasPendingProposalIdentity(value, projectId) &&
  isRecord(value.payload) &&
  isProposalPayload(value.payload);

const parseDirectorQuery = (value: unknown): DirectorQuery | null => {
  if (!isRecord(value)) return null;
  if (
    value.kind === 'get_project_status' &&
    hasExactKeys(value, ['kind', 'detail']) &&
    typeof value.detail === 'boolean'
  ) {
    return { kind: 'get_project_status', detail: value.detail };
  }
  if (value.kind === 'list_routes' && hasExactKeys(value, ['kind'])) return { kind: 'list_routes' };
  if (value.kind === 'get_proposal' && hasExactKeys(value, ['kind', 'proposalId']) && isSafeId(value.proposalId)) {
    return { kind: 'get_proposal', proposalId: value.proposalId };
  }
  return null;
};

const queryMatchesTool = (query: DirectorQuery, tool: StudioToolName): boolean =>
  tool === 'studio_get_command_status' ||
  (query.kind === 'get_project_status' && tool === 'studio_get_project_status') ||
  (query.kind === 'list_routes' && tool === 'studio_list_routes') ||
  (query.kind === 'get_proposal' && tool === 'studio_get_proposal');

const isProjectStatusResult = (value: unknown, projectId: string, detailRequested: boolean): boolean => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'projectId',
      'projectRevision',
      'catalogVersion',
      'stages',
      'blockerCount',
      'advisories',
      'boards',
      'detail',
    ]) ||
    value.projectId !== projectId ||
    !isSafeRevision(value.projectRevision) ||
    (value.catalogVersion !== null &&
      (typeof value.catalogVersion !== 'string' || !/^[a-f0-9]{16}$/.test(value.catalogVersion))) ||
    !Array.isArray(value.stages) ||
    value.stages.length !== STUDIO_PROJECT_STATUS_STAGE_ORDER_V2.length ||
    !isNonnegativeSafeInteger(value.blockerCount) ||
    !Array.isArray(value.advisories) ||
    !value.advisories.every(isRecord) ||
    !isRecord(value.boards) ||
    !hasExactKeys(value.boards, ['currentPictureCount', 'shotCount']) ||
    !isNonnegativeSafeInteger(value.boards.currentPictureCount) ||
    !isNonnegativeSafeInteger(value.boards.shotCount) ||
    value.boards.currentPictureCount > value.boards.shotCount
  ) {
    return false;
  }
  let countedBlockers = 0;
  for (const [index, stageValue] of value.stages.entries()) {
    if (
      !isRecord(stageValue) ||
      !hasExactKeys(stageValue, ['id', 'state', 'summary', 'blockers']) ||
      stageValue.id !== STUDIO_PROJECT_STATUS_STAGE_ORDER_V2[index] ||
      !['not_started', 'in_progress', 'complete', 'blocked'].includes(String(stageValue.state)) ||
      !isRecord(stageValue.summary) ||
      !Array.isArray(stageValue.blockers) ||
      !stageValue.blockers.every(isRecord) ||
      (stageValue.state === 'blocked') !== stageValue.blockers.length > 0
    ) {
      return false;
    }
    countedBlockers += stageValue.blockers.length;
  }
  if (countedBlockers !== value.blockerCount) return false;
  if (!detailRequested) return value.detail === null;
  return (
    isRecord(value.detail) &&
    hasExactKeys(value.detail, ['shots', 'references']) &&
    Array.isArray(value.detail.shots) &&
    value.detail.shots.every(isRecord) &&
    Array.isArray(value.detail.references) &&
    value.detail.references.every(isRecord)
  );
};

const isRouteCatalogResult = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['image', 'video', 'catalogVersion']) ||
    typeof value.catalogVersion !== 'string' ||
    !/^[a-f0-9]{16}$/.test(value.catalogVersion)
  ) {
    return false;
  }
  for (const role of ['image', 'video'] as const) {
    const media = value[role];
    if (
      !isRecord(media) ||
      !hasExactKeys(media, ['status', 'selected', 'selectedRoute', 'selectionIssue', 'options']) ||
      !['ready', 'selection_required', 'setup_required', 'unavailable'].includes(String(media.status)) ||
      (media.selected !== null && !isRecord(media.selected)) ||
      (media.selectedRoute !== null && !isRecord(media.selectedRoute)) ||
      (media.selectionIssue !== null && !isRecord(media.selectionIssue)) ||
      !Array.isArray(media.options) ||
      !media.options.every(isRecord)
    ) {
      return false;
    }
    if (media.status === 'ready' && (media.selected === null || media.selectedRoute === null)) return false;
  }
  return true;
};

const isFreeRecovery = (value: unknown): boolean =>
  isRecord(value) &&
  ((value.op === 'retry_conditioning_frame' &&
    hasExactKeys(value, ['op', 'dependentShotId']) &&
    isSafeId(value.dependentShotId)) ||
    (value.op === 'terminalize_refused_job' && hasExactKeys(value, ['op', 'jobId']) && isSafeId(value.jobId)));

const commandStatusInputId = (input: Parameters<ToolOutcomeInterpreter>[0]): string | null => {
  const terminalInput = parseExactRecord(input.step.calls.at(-1)?.input);
  return terminalInput !== null && hasExactKeys(terminalInput, ['commandId']) && isSafeId(terminalInput.commandId)
    ? terminalInput.commandId
    : null;
};

const commandObservation = (
  outcome: TurnDomainOutcome,
  commandId: string,
  resolves: boolean
): InterpretedToolOutcome => ({
  outcome,
  commandId,
  ...(resolves ? { resolvesCommandId: commandId } : {}),
});

const proposalOutcome = (proposalId: string, proposals: ProposalOutcomeIndex): TurnDomainOutcome =>
  proposals?.get(proposalId) ?? 'unknown';

const proposalLookupOutcome = (
  value: Record<string, unknown>,
  projectId: string,
  proposals: ProposalOutcomeIndex,
  requestedProposalId: string
): TurnDomainOutcome => {
  const result = value.result;
  if (!isRecord(result)) return 'unknown';
  if (result.status === 'not_found') return hasExactKeys(result, ['status']) ? 'observed' : 'unknown';
  if (result.status === 'no_longer_pending') {
    if (
      !hasExactKeys(result, ['status', 'proposalId', 'decision']) ||
      !isSafeId(result.proposalId) ||
      result.proposalId !== requestedProposalId
    ) {
      return 'unknown';
    }
    const authoritativeOutcome = proposalOutcome(result.proposalId, proposals);
    if (result.decision === 'accepted' && authoritativeOutcome === 'committed') return 'committed';
    if ((result.decision === 'rejected' || result.decision === 'expired') && authoritativeOutcome === 'refused') {
      return 'refused';
    }
    return 'unknown';
  }
  if (result.status !== 'pending' || !hasExactKeys(result, ['status', 'proposal'])) return 'unknown';
  const proposal = result.proposal;
  if (!isPendingProposalRecord(proposal, projectId) || proposal.id !== requestedProposalId) return 'unknown';
  return proposalOutcome(proposal.id, proposals);
};

const commandReceiptOutcome = (
  value: Record<string, unknown>,
  projectId: string,
  proposals: ProposalOutcomeIndex,
  tool: StudioToolName,
  requestedCommandId: string | null
): InterpretedToolOutcome => {
  const envelopeCommandId =
    hasExactKeys(value, ['status', 'commandId']) && isSafeId(value.commandId) ? value.commandId : null;
  if (
    tool === 'studio_get_command_status' &&
    requestedCommandId !== null &&
    isSafeId(value.commandId) &&
    value.commandId !== requestedCommandId
  ) {
    return 'unknown';
  }
  const resolves = tool === 'studio_get_command_status';

  if (Object.hasOwn(value, 'query')) {
    const query = parseDirectorQuery(value.query);
    if (!hasReceiptIdentity(value, projectId) || query === null || !queryMatchesTool(query, tool)) return 'unknown';
    if (value.status === 'answered') {
      if (!hasExactKeys(value, QUERY_ANSWERED_RECEIPT_KEYS)) return 'unknown';
      const outcome =
        query.kind === 'get_project_status'
          ? isProjectStatusResult(value.result, projectId, query.detail)
            ? 'observed'
            : 'unknown'
          : query.kind === 'list_routes'
            ? isRouteCatalogResult(value.result)
              ? 'observed'
              : 'unknown'
            : proposalLookupOutcome(value, projectId, proposals, query.proposalId);
      return commandObservation(outcome, value.commandId, resolves && outcome !== 'unknown');
    }
    if (
      !hasExactKeys(value, QUERY_TERMINAL_RECEIPT_KEYS) ||
      typeof value.reasonCode !== 'string' ||
      (value.status === 'failed' && !QUERY_FAILURE_CODES.has(value.reasonCode)) ||
      (value.status === 'expired' && !EXPIRY_CODES.has(value.reasonCode)) ||
      (value.status !== 'failed' && value.status !== 'expired')
    ) {
      return 'unknown';
    }
    return commandObservation('failed', value.commandId, resolves);
  }

  switch (value.status) {
    case 'applied': {
      if (
        !hasReceiptIdentity(value, projectId) ||
        !isSafeRevision(value.expectedRevision) ||
        !isSafeRevision(value.appliedRevision) ||
        value.appliedRevision !== value.expectedRevision + 1
      ) {
        return 'unknown';
      }
      const isFree = Object.hasOwn(value, 'recovery');
      const valid = isFree
        ? hasExactKeys(value, FREE_FIX_APPLIED_RECEIPT_KEYS) &&
          isFreeRecovery(value.recovery) &&
          (tool === 'studio_apply_free_fix' || tool === 'studio_get_command_status')
        : hasExactKeys(value, APPLIED_RECEIPT_KEYS) &&
          isUniqueSafeIdArray(value.createdBeatIds) &&
          isUniqueSafeIdArray(value.createdShotIds) &&
          (tool === 'studio_apply_edits' || tool === 'studio_get_command_status');
      return valid ? commandObservation('committed', value.commandId, resolves) : 'unknown';
    }
    case 'rejected': {
      if (
        !hasExactKeys(value, TERMINAL_RECEIPT_KEYS) ||
        !hasReceiptIdentity(value, projectId) ||
        !MUTATION_TOOLS.has(tool) ||
        (value.observedRevision !== null && !isSafeRevision(value.observedRevision)) ||
        typeof value.reasonCode !== 'string' ||
        !REJECTION_CODES.has(value.reasonCode) ||
        (!isSafeRevision(value.expectedRevision) &&
          !(value.expectedRevision === null && NULLABLE_EXPECTED_REVISION_CODES.has(value.reasonCode)))
      ) {
        return 'unknown';
      }
      return commandObservation('refused', value.commandId, resolves);
    }
    case 'recorded': {
      if (
        !hasExactKeys(value, RECORDED_RECEIPT_KEYS) ||
        !hasReceiptIdentity(value, projectId) ||
        !isSafeRevision(value.expectedRevision) ||
        (tool !== 'studio_propose_paid_recovery' && tool !== 'studio_get_command_status') ||
        !isPendingProposalRecord(value.proposal, projectId)
      ) {
        return 'unknown';
      }
      const proposal = value.proposal;
      if (
        proposal.id !== value.commandId ||
        proposal.baseRevision !== value.expectedRevision ||
        proposal.payload.kind !== 'paid_recovery' ||
        Date.parse(value.decidedAt) < Date.parse(proposal.createdAt)
      ) {
        return 'unknown';
      }
      const current = proposalOutcome(proposal.id, proposals);
      const outcome = current === 'pending_review' ? 'waiting_authorization' : current;
      return commandObservation(outcome, value.commandId, resolves && outcome !== 'unknown');
    }
    case 'expired':
    case 'indeterminate': {
      if (
        !hasExactKeys(value, TERMINAL_RECEIPT_KEYS) ||
        !hasReceiptIdentity(value, projectId) ||
        !MUTATION_TOOLS.has(tool) ||
        !isSafeRevision(value.expectedRevision) ||
        (value.observedRevision !== null && !isSafeRevision(value.observedRevision)) ||
        typeof value.reasonCode !== 'string' ||
        (value.status === 'expired' ? !EXPIRY_CODES.has(value.reasonCode) : !INDETERMINATE_CODES.has(value.reasonCode))
      ) {
        return 'unknown';
      }
      return commandObservation(value.status === 'expired' ? 'failed' : 'indeterminate', value.commandId, resolves);
    }
    case 'answered':
    case 'failed':
      return 'unknown';
    case 'busy':
      return envelopeCommandId !== null && DIRECT_COMMAND_TOOLS.has(tool) ? 'failed' : 'unknown';
    case 'storage_error':
    case 'unsupported_prototype_schema': {
      if (envelopeCommandId === null) return 'unknown';
      const validTool = tool === 'studio_get_command_status' || DIRECT_COMMAND_TOOLS.has(tool);
      return validTool ? commandObservation('failed', envelopeCommandId, false) : 'unknown';
    }
    case 'unconfirmed':
      return envelopeCommandId !== null && DIRECT_COMMAND_TOOLS.has(tool)
        ? commandObservation('unconfirmed', envelopeCommandId, false)
        : 'unknown';
    case 'pending':
    case 'not_found':
      return envelopeCommandId !== null && resolves
        ? commandObservation('unconfirmed', envelopeCommandId, false)
        : 'unknown';
    default:
      return 'unknown';
  }
};

const readOutcome = (tool: StudioToolName, value: Record<string, unknown>): TurnDomainOutcome => {
  if (tool === 'read_storyboard') {
    return isSafeRevision(value.revision) && typeof value.name === 'string' && typeof value.brief === 'string'
      ? 'observed'
      : 'unknown';
  }
  if (tool === 'studio_get_conditioning_frame') {
    return (value.status === 'ready' || value.status === 'unavailable') &&
      isSafeRevision(value.projectRevision) &&
      isSafeId(value.shotId)
      ? 'observed'
      : 'unknown';
  }
  return 'unknown';
};

/**
 * Interprets only the project-scoped built-in Studio server's exact, bounded terminal outputs.
 * Generic chats never install this interpreter, and an unrecognized or malformed Studio result is
 * deliberately `unknown` so transport success cannot be presented as a committed domain change.
 */
export const createStudioDirectorToolOutcomeInterpreter = (
  projectId: string,
  projectRevision: number | null,
  catalog: StudioRendererProposalCatalogV2 | null
): ToolOutcomeInterpreter => {
  const proposals = buildProposalOutcomeIndex(projectId, projectRevision, catalog);

  return (input): InterpretedToolOutcome => {
    const tool = resolveExactStudioTool(input);
    if (tool === null) return 'unknown';
    if (input.status === 'error') return 'failed';
    if (input.status === 'canceled') return 'canceled';
    if (input.status !== 'completed') return 'unknown';

    const terminalCall = input.step.calls.at(-1);
    const output = terminalCall?.output;
    if (
      terminalCall === undefined ||
      terminalCall.truncated === true ||
      typeof output !== 'string' ||
      output.length === 0 ||
      output.length > MAX_STORED_OUTPUT_CHARS
    ) {
      return 'unknown';
    }

    if (tool === 'propose_storyboard' || tool === 'propose_brief_rule') {
      const match = (tool === 'propose_storyboard' ? PROPOSAL_OUTPUT : RULE_OUTPUT).exec(output);
      return match === null ? 'unknown' : proposalOutcome(match[1]!, proposals);
    }
    if (tool === 'studio_request_reference_images') {
      return REFERENCE_REQUEST_OUTPUT.test(output) ? 'waiting_authorization' : 'unknown';
    }

    const parsed = parseExactRecord(output);
    if (parsed === null) return 'unknown';
    if (tool === 'read_storyboard' || tool === 'studio_get_conditioning_frame') return readOutcome(tool, parsed);
    return commandReceiptOutcome(
      parsed,
      projectId,
      proposals,
      tool,
      tool === 'studio_get_command_status' ? commandStatusInputId(input) : null
    );
  };
};
