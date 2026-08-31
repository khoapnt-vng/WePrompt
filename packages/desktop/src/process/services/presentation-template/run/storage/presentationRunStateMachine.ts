/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  PRESENTATION_RUN_ARTIFACT_PHASES,
  PRESENTATION_RUN_DISPATCH_STATUSES,
  PRESENTATION_RUN_DISPOSITIONS,
  PRESENTATION_RUN_LIMITS,
} from '@/common/config/constants';
import type {
  PresentationReadinessBlocker,
  PresentationReadinessEvidence,
} from '@/common/types/office/artifactReadiness';
import { normalizePresentationConversationId } from '@/common/types/office/presentationConversationId';
import type {
  PresentationGrantOwner,
  PresentationSourceDescriptor,
  PresentationSourceRef,
} from '@/common/types/office/presentationRun';

export type PresentationRunDispatchStatus = (typeof PRESENTATION_RUN_DISPATCH_STATUSES)[number];
export type PresentationRunArtifactPhase = (typeof PRESENTATION_RUN_ARTIFACT_PHASES)[number] | null;
export type PresentationRunDisposition = (typeof PRESENTATION_RUN_DISPOSITIONS)[number] | null;

export type PresentationRunRetainedCandidate = {
  relativePath: string;
  sha256: string;
  byteLength: number;
};

export type PresentationRunBinding = {
  conversationId: string;
  turnId: string;
  runtime: 'aionrs' | 'acp' | null;
  boundAt: string;
};

export type PresentationInitialDispatchLease = {
  holderId: string;
  leaseToken: string;
  claimedAt: string;
  expiresAt: string;
};

export type PresentationRuntimeReleaseObservation = {
  state: 'idle';
  can_send_message: true;
  has_task: false;
  task_status?: 'finished';
  is_processing: false;
  pending_confirmations: 0;
  turn_id: null;
};

export type PresentationRunTerminalEvidence = {
  conversationId: string;
  turnId: string;
  eventObservedAt: string;
  runtimeObservedAt: string;
  runtime: PresentationRuntimeReleaseObservation;
};

export type PresentationRunRetentionProof = {
  stagingBeforeRetain: string;
  retainedTemp: string;
  stagingAfterRetain: string;
};

export type PresentationRunReadiness =
  | { status: 'passed'; recordedAt: string; evidence: PresentationReadinessEvidence }
  | { status: 'blocked'; recordedAt: string; blockers: readonly PresentationReadinessBlocker[] }
  | { status: 'error'; recordedAt: string; code: string };

export type PresentationRunPreparationFile = {
  fileName: string;
  sha256: string;
  byteLength: number;
};

export type PresentationRunPreparationPayload = {
  version: 1;
  rawInput: string;
  directive: string;
  sourceRefs: PresentationSourceRef[];
  injectSkills: ['officecli'];
  template: {
    theme: PresentationRunPreparationFile;
    reference: PresentationRunPreparationFile;
  };
  grounding: {
    relativePath: 'agent/grounding.md';
    sha256: string;
    byteLength: number;
  };
  candidate: {
    relativePath: 'agent/candidate.pptx';
    sha256: string;
    byteLength: number;
  };
};

/** Durable proof for the authoritative preparation.json payload and its staged inputs. */
export type PresentationRunPreparationRecord = {
  payload: PresentationRunPreparationPayload;
  relativePath: 'preparation.json';
  sha256: string;
  byteLength: number;
};

export type PresentationRunManifest = {
  version: 2;
  runId: string;
  clientRequestId: string;
  conversationId: string;
  selectedTemplateId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  statusEnteredAt: string;
  committedAt: string | null;
  retainedAt: string | null;
  dispatchStatus: PresentationRunDispatchStatus;
  artifactPhase: PresentationRunArtifactPhase;
  disposition: PresentationRunDisposition;
  retainedCandidate: PresentationRunRetainedCandidate | null;
  sourceGrants: string[];
  binding: PresentationRunBinding | null;
  postInvoked: boolean;
  retainedBytes: number;
  /** Optional only for canonical manifests written before the preparation schema existed. */
  preparation?: PresentationRunPreparationRecord | null;
  /** Optional only for exact Task 1-7 version-2 manifests. New writes always include all five fields. */
  initialDispatchLease?: PresentationInitialDispatchLease | null;
  terminalEvidence?: PresentationRunTerminalEvidence | null;
  runtimeReleaseObservations?: string[];
  retentionProof?: PresentationRunRetentionProof | null;
  readiness?: PresentationRunReadiness | null;
};

export type PresentationRunTransition = {
  expectedRevision: number;
  dispatchStatus: PresentationRunDispatchStatus;
  artifactPhase?: Exclude<PresentationRunArtifactPhase, null>;
  disposition?: PresentationRunDisposition;
  retainedCandidate?: PresentationRunRetainedCandidate | null;
  retentionProof?: PresentationRunRetentionProof;
  binding?: PresentationRunBinding;
  postInvoked?: boolean;
  now: string;
};

export type BindPresentationRunTurnInput = {
  expectedRevision: number;
  conversationId: string;
  turnId: string;
  runtime: Exclude<PresentationRunBinding['runtime'], null>;
  now: string;
};

const DISPATCH_TRANSITIONS: Readonly<Record<PresentationRunDispatchStatus, readonly PresentationRunDispatchStatus[]>> =
  {
    allocating: ['allocating', 'committed', 'failed_retained', 'discarded'],
    committed: ['committed', 'dispatching', 'failed_retained', 'discarded'],
    dispatching: ['dispatching', 'bound', 'dispatch_uncertain'],
    bound: ['bound', 'terminal_verified', 'retained', 'dispatch_uncertain'],
    terminal_verified: ['terminal_verified', 'retained', 'failed_retained'],
    retained: ['retained', 'discarded'],
    failed_retained: ['failed_retained', 'discarded'],
    dispatch_uncertain: ['dispatch_uncertain'],
    discarded: ['discarded'],
  };

const ARTIFACT_PHASES: readonly Exclude<PresentationRunArtifactPhase, null>[] = [
  'none',
  'sources_snapshotted',
  'sources_extracted',
  'candidate_retained',
  'candidate_copied',
  'structurally_valid',
  'ooxml_inspected',
  'rendered_exact_hash',
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Durable records may retain pre-normalization uppercase UUID conversation ids. */
const isPersistedPresentationConversationId = (value: unknown): value is string =>
  normalizePresentationConversationId(value) !== null;

const isSamePersistedPresentationConversation = (left: unknown, right: unknown): boolean => {
  const normalizedLeft = normalizePresentationConversationId(left);
  return normalizedLeft !== null && normalizedLeft === normalizePresentationConversationId(right);
};

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function isSameBinding(left: PresentationRunBinding, right: BindPresentationRunTurnInput): boolean {
  return (
    isSamePersistedPresentationConversation(left.conversationId, right.conversationId) &&
    left.turnId === right.turnId &&
    left.runtime === right.runtime
  );
}

function assertArtifactTransition(current: PresentationRunArtifactPhase, next: PresentationRunArtifactPhase): void {
  if (next === null) return;
  if (current === null) throw new Error('Illegal presentation run artifact transition');
  const currentIndex = ARTIFACT_PHASES.indexOf(current);
  const nextIndex = ARTIFACT_PHASES.indexOf(next);
  if (nextIndex !== currentIndex && nextIndex !== currentIndex + 1) {
    throw new Error('Illegal presentation run artifact transition');
  }
}

function assertCandidate(candidate: PresentationRunRetainedCandidate | null): void {
  if (candidate === null) return;
  if (
    candidate.relativePath !== 'retained/candidate.pptx' ||
    !/^[0-9a-f]{64}$/.test(candidate.sha256) ||
    !Number.isSafeInteger(candidate.byteLength) ||
    candidate.byteLength < 0 ||
    candidate.byteLength > PRESENTATION_RUN_LIMITS.MAX_CANDIDATE_COMPRESSED_BYTES
  ) {
    throw new Error('Invalid retained presentation candidate');
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

const VISUAL_ANCHOR_KIND_ORDER = ['picture', 'chart', 'table', 'connector'] as const;
const VISUAL_ANCHOR_KINDS = new Set(VISUAL_ANCHOR_KIND_ORDER);
const SLIDE_ROLES = new Set(['cover', 'divider', 'quote', 'closing', 'minimal', 'content']);

/** Returns true only for the complete, exact Task-8 terminal proof bound to this run. */
export function hasExactPresentationTerminalEvidence(run: PresentationRunManifest): boolean {
  const terminal = run.terminalEvidence;
  if (
    !isPlainRecord(terminal) ||
    !hasExactManifestKeys(terminal, ['conversationId', 'turnId', 'eventObservedAt', 'runtimeObservedAt', 'runtime'])
  ) {
    return false;
  }
  const runtime = terminal.runtime;
  if (!isPlainRecord(runtime)) return false;
  const runtimeKeys = [
    'state',
    'can_send_message',
    'has_task',
    'is_processing',
    'pending_confirmations',
    'turn_id',
    ...(Object.hasOwn(runtime, 'task_status') ? ['task_status'] : []),
  ];
  return (
    hasExactManifestKeys(runtime, runtimeKeys) &&
    isSamePersistedPresentationConversation(terminal.conversationId, run.conversationId) &&
    typeof terminal.turnId === 'string' &&
    UUID_RE.test(terminal.turnId) &&
    isIsoTimestamp(terminal.eventObservedAt) &&
    isIsoTimestamp(terminal.runtimeObservedAt) &&
    Date.parse(terminal.runtimeObservedAt) >= Date.parse(terminal.eventObservedAt) &&
    runtime.state === 'idle' &&
    runtime.can_send_message === true &&
    runtime.has_task === false &&
    runtime.is_processing === false &&
    runtime.pending_confirmations === 0 &&
    runtime.turn_id === null &&
    (!Object.hasOwn(runtime, 'task_status') || runtime.task_status === 'finished') &&
    run.binding !== null &&
    (run.binding.runtime === 'aionrs' || run.binding.runtime === 'acp') &&
    isSamePersistedPresentationConversation(terminal.conversationId, run.binding.conversationId) &&
    terminal.turnId === run.binding.turnId
  );
}

function hasExactArtifactIdentity(value: unknown, maximumByteLength: number): boolean {
  return (
    isPlainRecord(value) &&
    hasExactManifestKeys(value, ['sha256', 'byteLength']) &&
    isSha256(value.sha256) &&
    isBoundedInteger(value.byteLength, 1, maximumByteLength)
  );
}

function hasExactOoxmlSlide(value: unknown, slideNumber: number): boolean {
  if (
    !isPlainRecord(value) ||
    !hasExactManifestKeys(value, [
      'slideNumber',
      'shapeCount',
      'textCharCount',
      'textOnlyShapeCount',
      'notesTextCharCount',
      'visualAnchorKinds',
    ]) ||
    value.slideNumber !== slideNumber ||
    !isBoundedInteger(value.shapeCount, 0, PRESENTATION_RUN_LIMITS.MAX_SHAPES_PER_SLIDE) ||
    !isBoundedInteger(value.textCharCount, 0, PRESENTATION_RUN_LIMITS.MAX_TEXT_CHARS_PER_SLIDE) ||
    !isBoundedInteger(value.textOnlyShapeCount, 0, value.shapeCount as number) ||
    !isBoundedInteger(value.notesTextCharCount, 0, PRESENTATION_RUN_LIMITS.MAX_TEXT_CHARS_PER_SLIDE) ||
    !Array.isArray(value.visualAnchorKinds) ||
    value.visualAnchorKinds.length > VISUAL_ANCHOR_KINDS.size ||
    value.visualAnchorKinds.some(
      (kind) => typeof kind !== 'string' || !VISUAL_ANCHOR_KINDS.has(kind as (typeof VISUAL_ANCHOR_KIND_ORDER)[number])
    ) ||
    new Set(value.visualAnchorKinds).size !== value.visualAnchorKinds.length ||
    value.visualAnchorKinds.some(
      (kind, index) =>
        index > 0 &&
        VISUAL_ANCHOR_KIND_ORDER.indexOf(kind as (typeof VISUAL_ANCHOR_KIND_ORDER)[number]) <=
          VISUAL_ANCHOR_KIND_ORDER.indexOf(
            (value.visualAnchorKinds as unknown[])[index - 1] as (typeof VISUAL_ANCHOR_KIND_ORDER)[number]
          )
    )
  ) {
    return false;
  }
  return true;
}

function hasExactPolicySlide(value: unknown, slideNumber: number, knownSourceRefs: ReadonlySet<string>): boolean {
  return (
    isPlainRecord(value) &&
    hasExactManifestKeys(value, ['slideNumber', 'role', 'sourceRefs', 'requiresNotes', 'requiresVisualAnchor']) &&
    value.slideNumber === slideNumber &&
    typeof value.role === 'string' &&
    SLIDE_ROLES.has(value.role) &&
    Array.isArray(value.sourceRefs) &&
    value.sourceRefs.length <= PRESENTATION_RUN_LIMITS.MAX_SOURCE_REFS_PER_SLIDE &&
    value.sourceRefs.every(
      (sourceRef) =>
        typeof sourceRef === 'string' &&
        sourceRef.length > 0 &&
        sourceRef.length <= 256 &&
        knownSourceRefs.has(sourceRef)
    ) &&
    new Set(value.sourceRefs).size === value.sourceRefs.length &&
    typeof value.requiresNotes === 'boolean' &&
    typeof value.requiresVisualAnchor === 'boolean' &&
    value.requiresNotes === (value.role === 'content') &&
    value.requiresVisualAnchor === (value.role === 'content')
  );
}

/**
 * Validates the complete path-free Task-6 evidence graph against the canonical
 * retained candidate and retention proof. This predicate is the sole evidence
 * authority used by persistence and recovery action projection.
 */
export function hasExactPassedPresentationReadiness(run: PresentationRunManifest): boolean {
  const candidate = run.retainedCandidate;
  const proof = run.retentionProof;
  const readiness = run.readiness;
  if (
    candidate === null ||
    !isPlainRecord(proof) ||
    !hasExactManifestKeys(proof, ['stagingBeforeRetain', 'retainedTemp', 'stagingAfterRetain']) ||
    proof.stagingBeforeRetain !== candidate.sha256 ||
    proof.retainedTemp !== candidate.sha256 ||
    proof.stagingAfterRetain !== candidate.sha256 ||
    !isPlainRecord(readiness) ||
    !hasExactManifestKeys(readiness, ['status', 'recordedAt', 'evidence']) ||
    readiness.status !== 'passed' ||
    !isIsoTimestamp(readiness.recordedAt)
  ) {
    return false;
  }

  const evidence = readiness.evidence;
  if (
    !isPlainRecord(evidence) ||
    !hasExactManifestKeys(evidence, [
      'version',
      'candidate',
      'plan',
      'hashChain',
      'structure',
      'ooxml',
      'policy',
      'renders',
    ]) ||
    evidence.version !== 1 ||
    !hasExactArtifactIdentity(evidence.candidate, PRESENTATION_RUN_LIMITS.MAX_CANDIDATE_COMPRESSED_BYTES) ||
    evidence.candidate.sha256 !== candidate.sha256 ||
    evidence.candidate.byteLength !== candidate.byteLength ||
    !hasExactArtifactIdentity(evidence.plan, PRESENTATION_RUN_LIMITS.MAX_PLAN_JSON_BYTES)
  ) {
    return false;
  }

  const hashChain = evidence.hashChain;
  if (
    !isPlainRecord(hashChain) ||
    !hasExactManifestKeys(hashChain, [
      'stagingBeforeRetain',
      'retainedTemp',
      'stagingAfterRetain',
      'manifestRetained',
      'inspectionCopy',
      'retainedAfterStructuralValidation',
      'retainedAfterOoxmlInspection',
      'retainedAfterEachSlideRender',
    ]) ||
    !Array.isArray(hashChain.retainedAfterEachSlideRender) ||
    [
      hashChain.stagingBeforeRetain,
      hashChain.retainedTemp,
      hashChain.stagingAfterRetain,
      hashChain.manifestRetained,
      hashChain.inspectionCopy,
      hashChain.retainedAfterStructuralValidation,
      hashChain.retainedAfterOoxmlInspection,
      ...hashChain.retainedAfterEachSlideRender,
    ].some((hash) => hash !== candidate.sha256)
  ) {
    return false;
  }

  const structure = evidence.structure;
  const ooxml = evidence.ooxml;
  if (
    !isPlainRecord(structure) ||
    !hasExactManifestKeys(structure, ['officeCliValidated']) ||
    structure.officeCliValidated !== true ||
    !isPlainRecord(ooxml) ||
    !hasExactManifestKeys(ooxml, [
      'zipEntryCount',
      'expandedByteLength',
      'xmlByteLength',
      'slideCount',
      'totalTextChars',
      'slides',
    ]) ||
    !isBoundedInteger(ooxml.zipEntryCount, 1, PRESENTATION_RUN_LIMITS.MAX_ZIP_ENTRIES) ||
    !isBoundedInteger(ooxml.expandedByteLength, 1, PRESENTATION_RUN_LIMITS.MAX_ZIP_EXPANDED_BYTES) ||
    !isBoundedInteger(ooxml.xmlByteLength, 1, PRESENTATION_RUN_LIMITS.MAX_XML_BYTES) ||
    !isBoundedInteger(ooxml.slideCount, 1, PRESENTATION_RUN_LIMITS.MAX_SLIDES) ||
    !isBoundedInteger(ooxml.totalTextChars, 0, PRESENTATION_RUN_LIMITS.MAX_TEXT_CHARS_TOTAL) ||
    !Array.isArray(ooxml.slides) ||
    ooxml.slides.length !== ooxml.slideCount ||
    ooxml.slides.some((slide, index) => !hasExactOoxmlSlide(slide, index + 1)) ||
    ooxml.slides.reduce((total, slide) => total + (slide as Record<string, number>).textCharCount, 0) !==
      ooxml.totalTextChars
  ) {
    return false;
  }

  const policy = evidence.policy;
  const knownSourceRefs = new Set(run.sourceGrants);
  if (
    !isPlainRecord(policy) ||
    !hasExactManifestKeys(policy, ['version', 'plan', 'slides', 'blockers']) ||
    policy.version !== 1 ||
    !isPlainRecord(policy.plan) ||
    !hasExactManifestKeys(policy.plan, ['valid', 'slideCount', 'sourceRefCount']) ||
    policy.plan.valid !== true ||
    policy.plan.slideCount !== ooxml.slideCount ||
    !isBoundedInteger(
      policy.plan.sourceRefCount,
      0,
      PRESENTATION_RUN_LIMITS.MAX_SLIDES * PRESENTATION_RUN_LIMITS.MAX_SOURCE_REFS_PER_SLIDE
    ) ||
    !Array.isArray(policy.slides) ||
    policy.slides.length !== ooxml.slideCount ||
    policy.slides.some((slide, index) => !hasExactPolicySlide(slide, index + 1, knownSourceRefs)) ||
    policy.slides.reduce(
      (total, slide) => total + ((slide as Record<string, unknown>).sourceRefs as readonly unknown[]).length,
      0
    ) !== policy.plan.sourceRefCount ||
    !Array.isArray(policy.blockers) ||
    policy.blockers.length !== 0
  ) {
    return false;
  }

  const renders = evidence.renders;
  if (
    !Array.isArray(renders) ||
    renders.length !== ooxml.slideCount ||
    hashChain.retainedAfterEachSlideRender.length !== renders.length
  ) {
    return false;
  }
  let totalRenderBytes = 0;
  for (const [index, render] of renders.entries()) {
    if (
      !isPlainRecord(render) ||
      !hasExactManifestKeys(render, ['slideNumber', 'candidateSha256', 'sha256', 'byteLength']) ||
      render.slideNumber !== index + 1 ||
      render.candidateSha256 !== candidate.sha256 ||
      !isSha256(render.sha256) ||
      !isBoundedInteger(render.byteLength, 1, PRESENTATION_RUN_LIMITS.MAX_RENDER_BYTES_PER_SLIDE)
    ) {
      return false;
    }
    totalRenderBytes += render.byteLength;
    if (totalRenderBytes > PRESENTATION_RUN_LIMITS.MAX_RENDER_BYTES_TOTAL) return false;
  }
  return true;
}

const CURRENT_LIFECYCLE_KEYS = [
  'initialDispatchLease',
  'terminalEvidence',
  'runtimeReleaseObservations',
  'retentionProof',
  'readiness',
] as const;

function hasCurrentLifecycleSchema(run: PresentationRunManifest): boolean {
  const fieldCount = CURRENT_LIFECYCLE_KEYS.filter((key) => Object.hasOwn(run, key)).length;
  if (fieldCount !== 0 && fieldCount !== CURRENT_LIFECYCLE_KEYS.length) {
    throw new Error('Invalid presentation lifecycle schema');
  }
  return fieldCount === CURRENT_LIFECYCLE_KEYS.length;
}

function assertLifecycleEvidence(run: PresentationRunManifest): void {
  const lease = run.initialDispatchLease;
  if (
    lease !== undefined &&
    lease !== null &&
    (!isPlainRecord(lease) ||
      !hasExactManifestKeys(lease, ['holderId', 'leaseToken', 'claimedAt', 'expiresAt']) ||
      !UUID_RE.test(lease.holderId) ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(lease.leaseToken) ||
      !isIsoTimestamp(lease.claimedAt) ||
      !isIsoTimestamp(lease.expiresAt) ||
      Date.parse(lease.expiresAt) <= Date.parse(lease.claimedAt))
  ) {
    throw new Error('Invalid presentation dispatch lease');
  }

  const observations = run.runtimeReleaseObservations;
  if (
    observations !== undefined &&
    (!Array.isArray(observations) ||
      observations.length > 2 ||
      observations.some((value) => !isIsoTimestamp(value)) ||
      observations.some((value, index) => index > 0 && value <= observations[index - 1]!))
  ) {
    throw new Error('Invalid presentation runtime release observations');
  }

  const terminal = run.terminalEvidence;
  if (terminal !== undefined && terminal !== null && !hasExactPresentationTerminalEvidence(run)) {
    throw new Error('Invalid presentation terminal evidence');
  }
  const isCurrentLifecycleSchema = hasCurrentLifecycleSchema(run);
  const requiresTerminalEvidence =
    run.dispatchStatus === 'terminal_verified' ||
    run.retainedCandidate !== null ||
    run.disposition === 'REVIEW_REQUIRED' ||
    run.retentionProof != null ||
    run.readiness != null;
  if (isCurrentLifecycleSchema && requiresTerminalEvidence && !hasExactPresentationTerminalEvidence(run)) {
    throw new Error('Invalid presentation terminal evidence');
  }

  const proof = run.retentionProof;
  if (
    proof !== undefined &&
    proof !== null &&
    (!isPlainRecord(proof) ||
      !hasExactManifestKeys(proof, ['stagingBeforeRetain', 'retainedTemp', 'stagingAfterRetain']) ||
      !isSha256(proof.stagingBeforeRetain) ||
      !isSha256(proof.retainedTemp) ||
      !isSha256(proof.stagingAfterRetain) ||
      proof.stagingBeforeRetain !== proof.retainedTemp ||
      proof.retainedTemp !== proof.stagingAfterRetain ||
      run.retainedCandidate === null ||
      proof.retainedTemp !== run.retainedCandidate.sha256)
  ) {
    throw new Error('Invalid presentation retention proof');
  }
  if (isCurrentLifecycleSchema && run.retainedCandidate !== null && (proof === undefined || proof === null)) {
    throw new Error('Invalid presentation retention proof');
  }

  const readiness = run.readiness;
  if (readiness === undefined || readiness === null) return;
  if (!isPlainRecord(readiness) || !isIsoTimestamp(readiness.recordedAt)) {
    throw new Error('Invalid presentation readiness evidence');
  }
  if (readiness.status === 'passed') {
    if (!hasExactPassedPresentationReadiness(run)) {
      throw new Error('Invalid presentation readiness evidence');
    }
    return;
  }
  if (readiness.status === 'blocked') {
    if (
      !hasExactManifestKeys(readiness, ['status', 'recordedAt', 'blockers']) ||
      !Array.isArray(readiness.blockers) ||
      readiness.blockers.length < 1 ||
      readiness.blockers.length > 512
    ) {
      throw new Error('Invalid presentation readiness evidence');
    }
    return;
  }
  if (
    readiness.status !== 'error' ||
    !hasExactManifestKeys(readiness, ['status', 'recordedAt', 'code']) ||
    typeof readiness.code !== 'string' ||
    !/^[A-Z0-9_]{1,128}$/.test(readiness.code)
  ) {
    throw new Error('Invalid presentation readiness evidence');
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertHashAndLength(
  value: unknown,
  maximumByteLength: number,
  allowEmpty = false
): asserts value is Record<string, unknown> & { sha256: string; byteLength: number } {
  if (
    !isPlainRecord(value) ||
    typeof value.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.byteLength) ||
    (value.byteLength as number) < (allowEmpty ? 0 : 1) ||
    (value.byteLength as number) > maximumByteLength
  ) {
    throw new Error('Invalid presentation run preparation');
  }
}

/** Validates the exact restart-safe preparation schema before it enters canonical storage. */
export function assertPresentationRunPreparationRecord(
  value: unknown
): asserts value is PresentationRunPreparationRecord {
  if (
    !isPlainRecord(value) ||
    !hasExactManifestKeys(value, ['payload', 'relativePath', 'sha256', 'byteLength']) ||
    value.relativePath !== 'preparation.json'
  ) {
    throw new Error('Invalid presentation run preparation');
  }
  assertHashAndLength(value, PRESENTATION_RUN_LIMITS.MAX_NON_RENDER_COPY_WRITE_BYTES_PER_RUN);
  const payload = value.payload;
  if (
    !isPlainRecord(payload) ||
    !hasExactManifestKeys(payload, [
      'version',
      'rawInput',
      'directive',
      'sourceRefs',
      'injectSkills',
      'template',
      'grounding',
      'candidate',
    ]) ||
    payload.version !== 1 ||
    typeof payload.rawInput !== 'string' ||
    payload.rawInput.length < 1 ||
    typeof payload.directive !== 'string' ||
    payload.directive.length < 1 ||
    !Array.isArray(payload.sourceRefs) ||
    payload.sourceRefs.length > PRESENTATION_RUN_LIMITS.MAX_SOURCES_PER_RUN ||
    !Array.isArray(payload.injectSkills) ||
    payload.injectSkills.length !== 1 ||
    payload.injectSkills[0] !== 'officecli' ||
    !isPlainRecord(payload.template) ||
    !hasExactManifestKeys(payload.template, ['theme', 'reference']) ||
    !isPlainRecord(payload.grounding) ||
    !hasExactManifestKeys(payload.grounding, ['relativePath', 'sha256', 'byteLength']) ||
    payload.grounding.relativePath !== 'agent/grounding.md' ||
    !isPlainRecord(payload.candidate) ||
    !hasExactManifestKeys(payload.candidate, ['relativePath', 'sha256', 'byteLength']) ||
    payload.candidate.relativePath !== 'agent/candidate.pptx'
  ) {
    throw new Error('Invalid presentation run preparation');
  }
  const sourceGrantIds = new Set<string>();
  for (const sourceRef of payload.sourceRefs) {
    if (
      !isPlainRecord(sourceRef) ||
      !hasExactManifestKeys(sourceRef, ['grantId', 'expectedByteLength', 'expectedSha256']) ||
      typeof sourceRef.grantId !== 'string' ||
      !UUID_RE.test(sourceRef.grantId) ||
      !Number.isSafeInteger(sourceRef.expectedByteLength) ||
      (sourceRef.expectedByteLength as number) < 1 ||
      (sourceRef.expectedByteLength as number) > PRESENTATION_RUN_LIMITS.MAX_SOURCE_BYTES ||
      typeof sourceRef.expectedSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(sourceRef.expectedSha256) ||
      sourceGrantIds.has(sourceRef.grantId)
    ) {
      throw new Error('Invalid presentation run preparation');
    }
    sourceGrantIds.add(sourceRef.grantId);
  }
  const theme = payload.template.theme;
  const reference = payload.template.reference;
  if (
    !isPlainRecord(theme) ||
    !hasExactManifestKeys(theme, ['fileName', 'sha256', 'byteLength']) ||
    typeof theme.fileName !== 'string' ||
    theme.fileName.length < 1 ||
    theme.fileName.length > 256 ||
    theme.fileName.includes('/') ||
    theme.fileName.includes('\\') ||
    !isPlainRecord(reference) ||
    !hasExactManifestKeys(reference, ['fileName', 'sha256', 'byteLength']) ||
    typeof reference.fileName !== 'string' ||
    reference.fileName.length < 1 ||
    reference.fileName.length > 256 ||
    reference.fileName.includes('/') ||
    reference.fileName.includes('\\')
  ) {
    throw new Error('Invalid presentation run preparation');
  }
  assertHashAndLength(theme, PRESENTATION_RUN_LIMITS.MAX_THEME_BYTES);
  assertHashAndLength(reference, PRESENTATION_RUN_LIMITS.MAX_REFERENCE_BYTES);
  assertHashAndLength(payload.grounding, PRESENTATION_RUN_LIMITS.MAX_NON_RENDER_COPY_WRITE_BYTES_PER_RUN);
  assertHashAndLength(payload.candidate, PRESENTATION_RUN_LIMITS.MAX_CANDIDATE_COMPRESSED_BYTES);
}

export function assertPresentationRunManifestState(run: PresentationRunManifest): void {
  if (
    run.version !== 2 ||
    !UUID_RE.test(run.runId) ||
    !isIdentifier(run.clientRequestId) ||
    !isPersistedPresentationConversationId(run.conversationId) ||
    !isIdentifier(run.selectedTemplateId) ||
    !Number.isSafeInteger(run.revision) ||
    run.revision < 0 ||
    !isIsoTimestamp(run.createdAt) ||
    !isIsoTimestamp(run.updatedAt) ||
    !isIsoTimestamp(run.statusEnteredAt) ||
    (run.committedAt !== null && !isIsoTimestamp(run.committedAt)) ||
    (run.retainedAt !== null && !isIsoTimestamp(run.retainedAt)) ||
    !(PRESENTATION_RUN_DISPATCH_STATUSES as readonly unknown[]).includes(run.dispatchStatus) ||
    (run.artifactPhase !== null &&
      !(PRESENTATION_RUN_ARTIFACT_PHASES as readonly unknown[]).includes(run.artifactPhase)) ||
    (run.disposition !== null && !(PRESENTATION_RUN_DISPOSITIONS as readonly unknown[]).includes(run.disposition)) ||
    !Array.isArray(run.sourceGrants) ||
    run.sourceGrants.some((grantId) => typeof grantId !== 'string' || !UUID_RE.test(grantId)) ||
    new Set(run.sourceGrants).size !== run.sourceGrants.length ||
    typeof run.postInvoked !== 'boolean' ||
    !Number.isSafeInteger(run.retainedBytes) ||
    run.retainedBytes < 0
  ) {
    throw new Error('Invalid presentation run manifest');
  }
  if (run.preparation !== undefined && run.preparation !== null) {
    assertPresentationRunPreparationRecord(run.preparation);
  }
  assertLifecycleEvidence(run);
  const createdAt = Date.parse(run.createdAt);
  const updatedAt = Date.parse(run.updatedAt);
  const statusEnteredAt = Date.parse(run.statusEnteredAt);
  const committedAt = run.committedAt === null ? null : Date.parse(run.committedAt);
  const retainedAt = run.retainedAt === null ? null : Date.parse(run.retainedAt);
  if (
    updatedAt < createdAt ||
    statusEnteredAt < createdAt ||
    statusEnteredAt > updatedAt ||
    (committedAt !== null && (committedAt < createdAt || committedAt > updatedAt)) ||
    (retainedAt !== null && (retainedAt < createdAt || retainedAt > updatedAt)) ||
    (run.dispatchStatus === 'allocating' && (committedAt !== null || retainedAt !== null)) ||
    (['committed', 'dispatching', 'bound', 'terminal_verified', 'dispatch_uncertain', 'retained'].includes(
      run.dispatchStatus
    ) &&
      committedAt === null) ||
    (run.dispatchStatus !== 'retained' &&
      run.dispatchStatus !== 'failed_retained' &&
      run.dispatchStatus !== 'discarded' &&
      retainedAt !== null) ||
    ((run.dispatchStatus === 'retained' || run.dispatchStatus === 'failed_retained') &&
      (retainedAt === null || retainedAt !== statusEnteredAt || (committedAt !== null && retainedAt < committedAt)))
  ) {
    throw new Error('Invalid presentation run lifecycle timestamps');
  }
  if (
    run.binding !== null &&
    (!isSamePersistedPresentationConversation(run.binding.conversationId, run.conversationId) ||
      !isIdentifier(run.binding.turnId) ||
      !['aionrs', 'acp', null].includes(run.binding.runtime) ||
      !isIsoTimestamp(run.binding.boundAt) ||
      Date.parse(run.binding.boundAt) < createdAt ||
      Date.parse(run.binding.boundAt) > updatedAt)
  ) {
    throw new Error('Invalid presentation run manifest');
  }
  if (hasCurrentLifecycleSchema(run) && run.binding !== null && run.binding.runtime === null) {
    throw new Error('Invalid presentation binding runtime');
  }
  if (run.dispatchStatus === 'discarded') {
    if (
      run.artifactPhase !== null ||
      run.disposition !== null ||
      run.retainedCandidate !== null ||
      (run.preparation !== undefined && run.preparation !== null)
    ) {
      throw new Error('Invalid discarded presentation run state');
    }
    return;
  }

  if (run.artifactPhase === null) throw new Error('Invalid presentation run artifact phase');
  const phaseIndex = ARTIFACT_PHASES.indexOf(run.artifactPhase);
  const candidatePhase = ARTIFACT_PHASES.indexOf('candidate_retained');
  const preparedPhase = ARTIFACT_PHASES.indexOf('sources_extracted');
  const hasCandidate = run.retainedCandidate !== null;
  const isCandidatePhaseOrLater = phaseIndex >= candidatePhase;
  if (isCandidatePhaseOrLater !== hasCandidate) {
    throw new Error('Retained candidate does not match artifact phase');
  }
  assertCandidate(run.retainedCandidate);
  if (phaseIndex < preparedPhase && run.preparation !== undefined && run.preparation !== null) {
    throw new Error('Preparation does not match artifact phase');
  }

  if (run.dispatchStatus === 'allocating' || run.dispatchStatus === 'committed') {
    if (run.postInvoked || run.binding !== null || run.disposition !== null || phaseIndex > 2) {
      throw new Error('Invalid pre-dispatch presentation run state');
    }
    return;
  }
  if (run.dispatchStatus === 'dispatching') {
    if (!run.postInvoked || run.binding !== null || run.disposition !== null || phaseIndex > 2) {
      throw new Error('Invalid dispatching presentation run state');
    }
    return;
  }
  if (run.dispatchStatus === 'bound') {
    if (!run.postInvoked || run.binding === null || run.disposition !== null || phaseIndex > 2) {
      throw new Error('Invalid bound presentation run state');
    }
    return;
  }
  if (run.dispatchStatus === 'dispatch_uncertain') {
    if (
      !run.postInvoked ||
      run.disposition !== 'TRACKING_REQUIRED' ||
      run.retainedCandidate !== null ||
      phaseIndex > 2
    ) {
      throw new Error('Invalid uncertain presentation run state');
    }
    return;
  }
  if (run.dispatchStatus === 'terminal_verified') {
    if (
      !run.postInvoked ||
      run.binding === null ||
      run.disposition !== null ||
      phaseIndex < 2 ||
      run.artifactPhase === 'rendered_exact_hash'
    ) {
      throw new Error('Invalid terminal presentation run state');
    }
    return;
  }

  const isTracking = run.disposition === 'TRACKING_REQUIRED';
  const isReview = run.disposition === 'REVIEW_REQUIRED';
  if (isTracking && run.retainedCandidate === null && phaseIndex <= 2) return;
  if (isReview && run.retainedCandidate !== null && phaseIndex >= candidatePhase) return;
  throw new Error('Invalid retained presentation run state');
}

/** Applies one compare-and-swap guarded presentation-run lifecycle transition. */
export function transitionPresentationRunState(
  current: PresentationRunManifest,
  transition: PresentationRunTransition
): PresentationRunManifest {
  assertPresentationRunManifestState(current);
  if (!isIsoTimestamp(transition.now)) throw new Error('Invalid presentation run transition timestamp');
  if (Date.parse(transition.now) < Date.parse(current.updatedAt)) {
    throw new Error('Presentation run transition timestamp regressed');
  }
  if (current.postInvoked && transition.postInvoked === false) {
    throw new Error('Presentation POST invocation proof is monotonic');
  }
  if (current.revision !== transition.expectedRevision) {
    throw new Error('Presentation run revision conflict');
  }

  if (transition.dispatchStatus === 'discarded') {
    const isPredispatch = current.dispatchStatus === 'allocating' || current.dispatchStatus === 'committed';
    const isReviewRetained =
      (current.dispatchStatus === 'retained' || current.dispatchStatus === 'failed_retained') &&
      current.disposition === 'REVIEW_REQUIRED';
    const isFailedTracking =
      current.dispatchStatus === 'failed_retained' && current.disposition === 'TRACKING_REQUIRED';
    if ((!isPredispatch && !isReviewRetained && !isFailedTracking) || (isPredispatch && current.postInvoked)) {
      throw new Error('Illegal presentation run dispatch transition');
    }
    return {
      ...current,
      revision: current.revision + 1,
      updatedAt: transition.now,
      statusEnteredAt: transition.now,
      dispatchStatus: 'discarded',
      artifactPhase: null,
      disposition: null,
      retainedCandidate: null,
      binding: null,
      retainedBytes: 0,
      ...(current.preparation === undefined ? {} : { preparation: null }),
      ...(current.initialDispatchLease === undefined ? {} : { initialDispatchLease: null }),
      ...(current.terminalEvidence === undefined ? {} : { terminalEvidence: null }),
      ...(current.runtimeReleaseObservations === undefined ? {} : { runtimeReleaseObservations: [] }),
      ...(current.retentionProof === undefined ? {} : { retentionProof: null }),
      ...(current.readiness === undefined ? {} : { readiness: null }),
    };
  }

  if (!DISPATCH_TRANSITIONS[current.dispatchStatus].includes(transition.dispatchStatus)) {
    throw new Error('Illegal presentation run dispatch transition');
  }

  const artifactPhase = transition.artifactPhase ?? current.artifactPhase;
  assertArtifactTransition(current.artifactPhase, artifactPhase);
  if (
    current.retainedCandidate === null &&
    artifactPhase === 'candidate_retained' &&
    transition.dispatchStatus !== 'terminal_verified'
  ) {
    throw new Error('Candidate retention requires terminal verification');
  }

  const next: PresentationRunManifest = {
    ...current,
    revision: current.revision + 1,
    updatedAt: transition.now,
    statusEnteredAt: current.dispatchStatus === transition.dispatchStatus ? current.statusEnteredAt : transition.now,
    committedAt: current.committedAt ?? (transition.dispatchStatus === 'committed' ? transition.now : null),
    retainedAt:
      current.retainedAt ??
      (transition.dispatchStatus === 'retained' || transition.dispatchStatus === 'failed_retained'
        ? transition.now
        : null),
    dispatchStatus: transition.dispatchStatus,
    artifactPhase,
    disposition:
      transition.disposition ??
      (transition.dispatchStatus === 'dispatch_uncertain' || transition.dispatchStatus === 'failed_retained'
        ? 'TRACKING_REQUIRED'
        : current.disposition),
    retainedCandidate:
      transition.retainedCandidate === undefined ? current.retainedCandidate : transition.retainedCandidate,
    ...(transition.retentionProof === undefined && current.retentionProof === undefined
      ? {}
      : { retentionProof: transition.retentionProof ?? current.retentionProof ?? null }),
    binding: transition.binding ?? current.binding,
    postInvoked: transition.postInvoked ?? current.postInvoked,
  };
  assertPresentationRunManifestState(next);
  return next;
}

/** Binds the exact acknowledged turn once; an exact replay does not mutate the manifest. */
export function bindPresentationRunTurn(
  current: PresentationRunManifest,
  input: BindPresentationRunTurnInput
): { status: 'bound' | 'already_bound'; manifest: PresentationRunManifest } {
  if (input.runtime !== 'aionrs' && input.runtime !== 'acp') {
    throw new Error('Invalid presentation binding runtime');
  }
  if (current.binding !== null) {
    if (isSameBinding(current.binding, input)) {
      return { status: 'already_bound', manifest: current };
    }
    throw new Error('Presentation run is already bound to another turn');
  }
  if (!isSamePersistedPresentationConversation(current.conversationId, input.conversationId)) {
    throw new Error('Presentation run conversation does not match binding');
  }
  const manifest = transitionPresentationRunState(current, {
    expectedRevision: input.expectedRevision,
    dispatchStatus: 'bound',
    binding: {
      conversationId: input.conversationId,
      turnId: input.turnId,
      runtime: input.runtime,
      boundAt: input.now,
    },
    now: input.now,
  });
  return { status: 'bound', manifest };
}

export type PresentationSourceFormat = PresentationSourceDescriptor['format'];
export type PresentationSourceKind = PresentationSourceDescriptor['sourceKind'];

export type PresentationSourceOwnerManifest = {
  version: 2;
  recordType: 'presentation-source-owner';
  ownerId: string;
  owner: PresentationGrantOwner;
  principalId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  grantIds: string[];
  unboundBytes: number;
  draftClientRequestId: string | null;
  draftLifecycle: 'active' | 'bound' | 'expired' | 'purged' | null;
};

export type PresentationSourceGrantManifest = {
  version: 2;
  recordType: 'presentation-source-grant';
  grantId: string;
  owner: PresentationGrantOwner;
  revision: number;
  displayName: string;
  format: PresentationSourceFormat;
  sourceKind: PresentationSourceKind;
  snapshotRelativePath: `source.${PresentationSourceDescriptor['format']}`;
  sha256: string;
  byteLength: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  stateEnteredAt: string;
  state: 'active' | 'claimed' | 'consumed' | 'revoked' | 'expired';
  queueExtendedAt: string | null;
  queueItemId: string | null;
  claimedRunId: string | null;
};

export type PresentationSourceDraftManifest = {
  version: 2;
  recordType: 'presentation-source-draft';
  draftId: string;
  clientRequestId: string;
  principalId: string;
  revision: number;
  state: 'active' | 'bound';
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  boundConversationId: string | null;
  boundAt: string | null;
};

type PresentationSourceGrantTombstoneBase = {
  recordType: 'presentation-source-grant-tombstone';
  revision: 0;
  grantId: string;
  owner: PresentationGrantOwner;
  terminalAt: string;
  tombstonedAt: string;
  deleteAfter: string;
  lastRevision: number;
};

export type PresentationSourceGrantTombstone =
  | (PresentationSourceGrantTombstoneBase & {
      version: 2;
      terminalState: 'consumed' | 'revoked' | 'expired';
    })
  | (PresentationSourceGrantTombstoneBase & {
      version: 3;
      terminalState: 'revoked';
      queueUnboundAtRevoke: true;
    });

export type PresentationSourceDraftTombstone = {
  version: 2;
  recordType: 'presentation-source-draft-tombstone';
  revision: 0;
  draftId: string;
  clientRequestId: string;
  principalId: string;
  terminalState: 'bound' | 'expired';
  terminalAt: string;
  tombstonedAt: string;
  deleteAfter: string;
  lastRevision: number;
  boundConversationId: string | null;
};

const SOURCE_FORMATS: ReadonlySet<PresentationSourceFormat> = new Set([
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'txt',
  'md',
  'csv',
]);
const SOURCE_KINDS: ReadonlySet<PresentationSourceKind> = new Set([
  'native-picker',
  'external-drop',
  'workspace-relative',
]);
const SOURCE_STATES: readonly PresentationSourceGrantManifest['state'][] = [
  'active',
  'claimed',
  'consumed',
  'revoked',
  'expired',
];

function hasExactManifestKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isGrantOwner(value: unknown): value is PresentationGrantOwner {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if ('owner_type' in value && value.owner_type === 'draft') {
    return (
      hasExactManifestKeys(value, ['owner_type', 'draft_id']) &&
      'draft_id' in value &&
      typeof value.draft_id === 'string' &&
      UUID_RE.test(value.draft_id)
    );
  }
  return (
    'owner_type' in value &&
    value.owner_type === 'conversation' &&
    hasExactManifestKeys(value, ['owner_type', 'conversation_id']) &&
    'conversation_id' in value &&
    isPersistedPresentationConversationId(value.conversation_id)
  );
}

function assertOrderedTimestamps(createdAt: string, updatedAt: string, ...timestamps: (string | null)[]): void {
  if (!isIsoTimestamp(createdAt) || !isIsoTimestamp(updatedAt) || Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error('Invalid presentation source lifecycle timestamps');
  }
  for (const timestamp of timestamps) {
    if (timestamp !== null && (!isIsoTimestamp(timestamp) || Date.parse(timestamp) < Date.parse(createdAt))) {
      throw new Error('Invalid presentation source lifecycle timestamps');
    }
  }
}

export function assertPresentationSourceOwnerManifest(value: PresentationSourceOwnerManifest): void {
  if (
    !hasExactManifestKeys(value, [
      'version',
      'recordType',
      'ownerId',
      'owner',
      'principalId',
      'revision',
      'createdAt',
      'updatedAt',
      'grantIds',
      'unboundBytes',
      'draftClientRequestId',
      'draftLifecycle',
    ]) ||
    value.version !== 2 ||
    value.recordType !== 'presentation-source-owner' ||
    !UUID_RE.test(value.ownerId) ||
    !isGrantOwner(value.owner) ||
    !isIdentifier(value.principalId) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.grantIds) ||
    value.grantIds.some((grantId) => !UUID_RE.test(grantId)) ||
    new Set(value.grantIds).size !== value.grantIds.length ||
    !Number.isSafeInteger(value.unboundBytes) ||
    value.unboundBytes < 0 ||
    (value.owner.owner_type === 'conversation' &&
      (value.draftClientRequestId !== null || value.draftLifecycle !== null)) ||
    (value.owner.owner_type === 'draft' &&
      (!isIdentifier(value.draftClientRequestId) ||
        !['active', 'bound', 'expired', 'purged'].includes(value.draftLifecycle ?? '')))
  ) {
    throw new Error('Invalid presentation source owner manifest');
  }
  assertOrderedTimestamps(value.createdAt, value.updatedAt);
  if (value.draftLifecycle !== null && value.draftLifecycle !== 'active' && value.grantIds.length !== 0) {
    throw new Error('Terminal presentation draft owner retained live grants');
  }
}

export function assertPresentationSourceGrantManifest(value: PresentationSourceGrantManifest): void {
  if (
    !hasExactManifestKeys(value, [
      'version',
      'recordType',
      'grantId',
      'owner',
      'revision',
      'displayName',
      'format',
      'sourceKind',
      'snapshotRelativePath',
      'sha256',
      'byteLength',
      'createdAt',
      'updatedAt',
      'expiresAt',
      'stateEnteredAt',
      'state',
      'queueExtendedAt',
      'queueItemId',
      'claimedRunId',
    ]) ||
    value.version !== 2 ||
    value.recordType !== 'presentation-source-grant' ||
    !UUID_RE.test(value.grantId) ||
    !isGrantOwner(value.owner) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !isIdentifier(value.displayName) ||
    value.displayName.includes('/') ||
    value.displayName.includes('\\') ||
    !SOURCE_FORMATS.has(value.format) ||
    !SOURCE_KINDS.has(value.sourceKind) ||
    value.snapshotRelativePath !== `source.${value.format}` ||
    !/^[0-9a-f]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength < 1 ||
    value.byteLength > PRESENTATION_RUN_LIMITS.MAX_SOURCE_BYTES ||
    !SOURCE_STATES.includes(value.state) ||
    (value.queueExtendedAt === null) !== (value.queueItemId === null) ||
    (value.queueItemId !== null && !isIdentifier(value.queueItemId)) ||
    (value.state === 'claimed' || value.state === 'consumed') !== (value.claimedRunId !== null) ||
    (value.claimedRunId !== null && !UUID_RE.test(value.claimedRunId))
  ) {
    throw new Error('Invalid presentation source grant manifest');
  }
  assertOrderedTimestamps(
    value.createdAt,
    value.updatedAt,
    value.expiresAt,
    value.stateEnteredAt,
    value.queueExtendedAt
  );
  if (
    Date.parse(value.stateEnteredAt) > Date.parse(value.updatedAt) ||
    (value.state === 'active' && Date.parse(value.updatedAt) > Date.parse(value.expiresAt)) ||
    (value.queueExtendedAt !== null &&
      (Date.parse(value.queueExtendedAt) > Date.parse(value.updatedAt) ||
        Date.parse(value.expiresAt) < Date.parse(value.queueExtendedAt)))
  ) {
    throw new Error('Invalid presentation source lifecycle timestamps');
  }
}

export function assertPresentationSourceDraftManifest(value: PresentationSourceDraftManifest): void {
  if (
    !hasExactManifestKeys(value, [
      'version',
      'recordType',
      'draftId',
      'clientRequestId',
      'principalId',
      'revision',
      'state',
      'createdAt',
      'updatedAt',
      'expiresAt',
      'boundConversationId',
      'boundAt',
    ]) ||
    value.version !== 2 ||
    value.recordType !== 'presentation-source-draft' ||
    !UUID_RE.test(value.draftId) ||
    !isIdentifier(value.clientRequestId) ||
    !isIdentifier(value.principalId) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !['active', 'bound'].includes(value.state) ||
    (value.state === 'active' && (value.boundConversationId !== null || value.boundAt !== null)) ||
    (value.state === 'bound' && (value.boundConversationId === null || value.boundAt === null)) ||
    (value.boundConversationId !== null && !isPersistedPresentationConversationId(value.boundConversationId))
  ) {
    throw new Error('Invalid presentation source draft manifest');
  }
  assertOrderedTimestamps(value.createdAt, value.updatedAt, value.expiresAt, value.boundAt);
  if (
    Date.parse(value.updatedAt) > Date.parse(value.expiresAt) ||
    (value.boundAt !== null && Date.parse(value.boundAt) > Date.parse(value.updatedAt))
  ) {
    throw new Error('Invalid presentation source lifecycle timestamps');
  }
}

export function assertPresentationSourceGrantTombstone(value: PresentationSourceGrantTombstone): void {
  const commonKeys = [
    'version',
    'recordType',
    'revision',
    'grantId',
    'owner',
    'terminalState',
    'terminalAt',
    'tombstonedAt',
    'deleteAfter',
    'lastRevision',
  ];
  const hasVersionedKeys =
    (value.version === 2 && hasExactManifestKeys(value, commonKeys)) ||
    (value.version === 3 && hasExactManifestKeys(value, [...commonKeys, 'queueUnboundAtRevoke']));
  if (
    !hasVersionedKeys ||
    value.recordType !== 'presentation-source-grant-tombstone' ||
    value.revision !== 0 ||
    !UUID_RE.test(value.grantId) ||
    !isGrantOwner(value.owner) ||
    !['consumed', 'revoked', 'expired'].includes(value.terminalState) ||
    !Number.isSafeInteger(value.lastRevision) ||
    value.lastRevision < 0
  ) {
    throw new Error('Invalid presentation source grant tombstone');
  }
  if (value.version === 3 && (value.terminalState !== 'revoked' || value.queueUnboundAtRevoke !== true)) {
    throw new Error('Invalid presentation source grant tombstone');
  }
  assertOrderedTimestamps(value.terminalAt, value.tombstonedAt, value.deleteAfter);
}

export function assertPresentationSourceDraftTombstone(value: PresentationSourceDraftTombstone): void {
  if (
    !hasExactManifestKeys(value, [
      'version',
      'recordType',
      'revision',
      'draftId',
      'clientRequestId',
      'principalId',
      'terminalState',
      'terminalAt',
      'tombstonedAt',
      'deleteAfter',
      'lastRevision',
      'boundConversationId',
    ]) ||
    value.version !== 2 ||
    value.recordType !== 'presentation-source-draft-tombstone' ||
    value.revision !== 0 ||
    !UUID_RE.test(value.draftId) ||
    !isIdentifier(value.clientRequestId) ||
    !isIdentifier(value.principalId) ||
    !['bound', 'expired'].includes(value.terminalState) ||
    !Number.isSafeInteger(value.lastRevision) ||
    value.lastRevision < 0 ||
    (value.terminalState === 'bound') !== (value.boundConversationId !== null) ||
    (value.boundConversationId !== null && !isPersistedPresentationConversationId(value.boundConversationId))
  ) {
    throw new Error('Invalid presentation source draft tombstone');
  }
  assertOrderedTimestamps(value.terminalAt, value.tombstonedAt, value.deleteAfter);
}
