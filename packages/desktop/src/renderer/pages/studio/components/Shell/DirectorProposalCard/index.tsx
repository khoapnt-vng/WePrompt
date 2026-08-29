/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type {
  StudioFixedShotReasonV2,
  StudioMutationReasonV2,
  StudioPaidRecoveryQuoteSummaryV2,
  StudioProjectStatusBlockerCauseV2,
  StudioProjectStatusWhereV2,
  StudioProposalReviewFieldKeyV2,
  StudioProposalReviewFieldV2,
  StudioProposalReviewGroupV2,
  StudioProposalReviewSubjectV2,
  StudioProposalReviewValueV2,
  StudioRendererProjectV2,
  StudioRendererProposalV2,
} from '@/common/types/project/creativeStudioTypes';
import { formatMinorUnits } from '@/renderer/pages/studio/components/Workspace/spendGate';
import styles from './DirectorProposalCard.module.css';

export type DirectorProposalCardProps = {
  project: StudioRendererProjectV2;
  proposal: StudioRendererProposalV2;
  pending: boolean;
  actionsLocked?: boolean;
  authorityState?: 'ready' | 'stale' | 'unavailable' | 'refreshing';
  authorityVerified?: boolean;
  draftBlocker?: 'workspace' | 'rules' | null;
  acceptBlockedMessageKey?: string | null;
  errorMessageKey?: string | null;
  onAccept: (proposalId: string) => Promise<void>;
  onReject: (proposalId: string) => Promise<void>;
  paidRecoveryQuote?: StudioPaidRecoveryQuoteSummaryV2 | null;
  paidRecoveryStatusMessageKey?: string | null;
  onPaidRecoveryAction?: (proposalId: string) => Promise<void>;
  onRequestUpdated?: (proposalId: string, saveWorkspaceDrafts: boolean) => Promise<void>;
  onReviewRuleDrafts?: () => void;
  onEditShotsDirectly?: (beatId: string, shotIds: readonly string[]) => void;
};

const PAID_RECOVERY_CAUSE_KEYS = {
  route_inventory_unavailable:
    'conversation.creativeStudio.workspace.board.shot.blocker.cause.routeInventoryUnavailable',
  route_not_selected: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.routeNotSelected',
  route_setup_required: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.routeSetupRequired',
  route_unavailable: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.routeUnavailable',
  route_retired: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.routeRetired',
  route_incompatible_frame: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.routeIncompatibleFrame',
  route_first_frame_unsupported:
    'conversation.creativeStudio.workspace.board.shot.blocker.cause.routeFirstFrameUnsupported',
  route_duration_unsupported: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.routeDurationUnsupported',
  reference_plan_invalid: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.referencePlanInvalid',
  reference_generation_required:
    'conversation.creativeStudio.workspace.board.shot.blocker.cause.referenceGenerationRequired',
  reference_approval_required:
    'conversation.creativeStudio.workspace.board.shot.blocker.cause.referenceApprovalRequired',
  reference_generation_failed:
    'conversation.creativeStudio.workspace.board.shot.blocker.cause.referenceGenerationFailed',
  reference_binding_unassigned:
    'conversation.creativeStudio.workspace.board.shot.blocker.cause.referenceBindingUnassigned',
  reference_binding_unknown_reference:
    'conversation.creativeStudio.workspace.board.shot.blocker.cause.referenceBindingUnknownReference',
  reference_binding_wrong_kind:
    'conversation.creativeStudio.workspace.board.shot.blocker.cause.referenceBindingWrongKind',
  reference_binding_unapproved_reference:
    'conversation.creativeStudio.workspace.board.shot.blocker.cause.referenceBindingUnapprovedReference',
  reference_binding_missing_asset:
    'conversation.creativeStudio.workspace.board.shot.blocker.cause.referenceBindingMissingAsset',
  reference_binding_capacity_exceeded:
    'conversation.creativeStudio.workspace.board.shot.blocker.cause.referenceBindingCapacityExceeded',
  shooting_script_required: 'conversation.creativeStudio.workspace.gate.errors.pricing.missingShootingScript',
  seed_selection_required: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.seedSelectionRequired',
  seed_generation_required: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.seedGenerationRequired',
  conditioning_frame_required:
    'conversation.creativeStudio.workspace.board.shot.blocker.cause.conditioningFrameRequired',
  extraction_failed: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.extractionFailed',
  dependency_failed: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.dependencyFailed',
  generation_invalid_request: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.generationInvalidRequest',
  generation_content_rejected:
    'conversation.creativeStudio.workspace.board.shot.blocker.cause.generationContentRejected',
  generation_auth: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.generationAuth',
  generation_quota: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.generationQuota',
  generation_rate_limited: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.generationRateLimited',
  generation_provider_unavailable:
    'conversation.creativeStudio.workspace.board.shot.blocker.cause.generationProviderUnavailable',
  generation_timeout: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.generationTimeout',
  generation_poll_deadline: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.generationPollDeadline',
  generation_no_output: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.generationNoOutput',
  generation_variation_grid: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.generationVariationGrid',
  generation_submission_unknown:
    'conversation.creativeStudio.workspace.board.shot.blocker.cause.generationSubmissionUnknown',
  generation_download_failed: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.generationDownloadFailed',
  generation_unsupported: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.generationUnsupported',
  generation_unknown: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.generationUnknown',
  cut_invalid_media: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.cutInvalidMedia',
  cut_bed_too_short: 'conversation.creativeStudio.workspace.board.shot.blocker.cause.cutBedTooShort',
} as const satisfies Record<StudioProjectStatusBlockerCauseV2, string>;

const formatPaidRecoveryLocation = (
  where: StudioProjectStatusWhereV2,
  project: StudioRendererProjectV2,
  t: (key: string, values?: Record<string, unknown>) => string
): string => {
  const root = 'conversation.creativeStudio.workspace.proposals.paidRecovery.location';
  if (where.kind === 'project' || where.kind === 'cut') return t(`${root}.${where.kind}`);
  if (where.kind === 'route') {
    return t(`${root}.route`, {
      route: t(`conversation.creativeStudio.workspace.controls.${where.routeKind}Route`),
    });
  }
  if (where.kind === 'reference') {
    const reference = Object.hasOwn(project.references, where.referenceId)
      ? project.references[where.referenceId]
      : undefined;
    return t(`${root}.reference`, { reference: reference?.label ?? where.referenceId });
  }
  const beat = Object.hasOwn(project.beats, where.beatId) ? project.beats[where.beatId] : undefined;
  return t(`${root}.shot`, {
    beat: beat?.title ?? where.beatPosition,
    shot: where.shotPosition,
  });
};

const REFUSAL_REASON_KEYS: Readonly<Record<StudioMutationReasonV2, string>> = {
  beat_capacity_reached: 'conversation.creativeStudio.workspace.proposals.refusal.reason.beat_capacity_reached',
  beat_shot_capacity_reached:
    'conversation.creativeStudio.workspace.proposals.refusal.reason.beat_shot_capacity_reached',
  project_shot_capacity_reached:
    'conversation.creativeStudio.workspace.proposals.refusal.reason.project_shot_capacity_reached',
  invalid_shot_duration: 'conversation.creativeStudio.workspace.proposals.refusal.reason.invalid_shot_duration',
  dependency_blocked: 'conversation.creativeStudio.workspace.proposals.refusal.reason.dependency_blocked',
  identity_collision: 'conversation.creativeStudio.workspace.proposals.refusal.reason.identity_collision',
  invalid_operation: 'conversation.creativeStudio.workspace.proposals.refusal.reason.invalid_operation',
  undo_conflict: 'conversation.creativeStudio.workspace.proposals.refusal.reason.undo_conflict',
  validation_failed: 'conversation.creativeStudio.workspace.proposals.refusal.reason.validation_failed',
};

const FIXED_REASON_KEYS: Readonly<Record<StudioFixedShotReasonV2, string>> = {
  owned_asset: 'conversation.creativeStudio.workspace.proposals.refusal.fixedReason.owned_asset',
  owned_job: 'conversation.creativeStudio.workspace.proposals.refusal.fixedReason.owned_job',
  video_asset: 'conversation.creativeStudio.workspace.proposals.refusal.fixedReason.video_asset',
  seed_still: 'conversation.creativeStudio.workspace.proposals.refusal.fixedReason.seed_still',
  conditioning_frame: 'conversation.creativeStudio.workspace.proposals.refusal.fixedReason.conditioning_frame',
  conditioning_input: 'conversation.creativeStudio.workspace.proposals.refusal.fixedReason.conditioning_input',
  shooting_script: 'conversation.creativeStudio.workspace.proposals.refusal.fixedReason.shooting_script',
};

const fieldLabelKey = (key: StudioProposalReviewFieldKeyV2): string =>
  `conversation.creativeStudio.workspace.proposals.field.${key}`;

const ReviewSubject: React.FC<{ subject: StudioProposalReviewSubjectV2 }> = ({ subject }) => {
  const { t } = useTranslation();
  return (
    <bdi
      data-owner-beat-id={subject.ownerBeatId ?? undefined}
      data-subject-id={subject.id}
      dir='auto'
      title={subject.id}
    >
      {t(`conversation.creativeStudio.workspace.proposals.subject.${subject.kind}`)}
      {subject.position === null ? null : ` ${subject.position}`}
      {subject.title === null || subject.title.length === 0 ? null : ` · ${subject.title}`}
      {/*
        A subject with neither a position nor a title identifies nothing — the person is asked to
        judge a bare word (BUG-182). The id is not a name, but it is what the Director used and it
        beats nothing at all. Main now supplies a title for Beats a refused batch would create, so
        this is the last resort rather than the common case.
      */}
      {subject.position === null && (subject.title === null || subject.title.length === 0) ? ` · ${subject.id}` : null}
      {subject.ownerBeatTitle === null || subject.ownerBeatTitle.length === 0
        ? null
        : ` · ${t('conversation.creativeStudio.workspace.proposals.ownerBeat')} · ${subject.ownerBeatTitle}`}
    </bdi>
  );
};
const ReviewValue: React.FC<{
  resolveTextEntry: (entry: string) => string;
  value: StudioProposalReviewValueV2;
}> = ({ resolveTextEntry, value }) => {
  const { t } = useTranslation();
  if (value.kind === 'rule_list') {
    return value.values.length === 0 ? (
      <span>{t('conversation.creativeStudio.workspace.proposals.emptyAuthoredField')}</span>
    ) : (
      <ol>
        {value.values.map((rule, index) => (
          <li key={`${index}:${rule.text}`}>
            <bdi dir='auto'>{rule.text}</bdi>
            {rule.forbiddenTerms.length === 0 ? null : (
              <span>
                {' · '}
                {t('conversation.creativeStudio.rules.proposalTerms', {
                  terms: rule.forbiddenTerms.join(', '),
                })}
              </span>
            )}
          </li>
        ))}
      </ol>
    );
  }
  if (value.kind === 'text_list') {
    return value.values.length === 0 ? (
      <span>{t('conversation.creativeStudio.workspace.proposals.emptyAuthoredField')}</span>
    ) : (
      <ol>
        {value.values.map((entry, index) => (
          <li key={`${index}:${entry}`}>
            <bdi data-review-value-id={entry} dir='auto' title={entry}>
              {resolveTextEntry(entry)}
            </bdi>
          </li>
        ))}
      </ol>
    );
  }
  if (value.kind === 'placement') {
    return (
      <span data-owner-beat-id={value.ownerBeatId ?? undefined} title={value.ownerBeatId ?? undefined}>
        {t(`conversation.creativeStudio.workspace.proposals.placementValue.${value.value}`)}
        {value.position === null ? null : ` ${value.position}`}
        {value.ownerBeatTitle === null || value.ownerBeatTitle.length === 0 ? null : ` · ${value.ownerBeatTitle}`}
      </span>
    );
  }
  if (value.value === null || value.value === '') {
    return <span>{t('conversation.creativeStudio.workspace.proposals.emptyAuthoredField')}</span>;
  }
  return <bdi dir='auto'>{value.value}</bdi>;
};

const ReviewField: React.FC<{
  change: StudioProposalReviewGroupV2['change'];
  field: StudioProposalReviewFieldV2;
  resolveTextEntry: (entry: string) => string;
}> = ({ change, field, resolveTextEntry }) => {
  const { t } = useTranslation();
  const singleValue = field.after ?? field.before;
  return (
    <div className={styles.field} data-proposal-field={field.key}>
      <dt>{t(fieldLabelKey(field.key))}</dt>
      <dd>
        {change !== 'edited' && singleValue !== null ? (
          <ReviewValue resolveTextEntry={resolveTextEntry} value={singleValue} />
        ) : (
          <>
            {field.before === null ? null : (
              <div className={styles.comparison} data-proposal-value='before'>
                <span>{t('conversation.creativeStudio.workspace.proposals.before')}</span>
                <ReviewValue resolveTextEntry={resolveTextEntry} value={field.before} />
              </div>
            )}
            {field.after === null ? null : (
              <div className={styles.comparison} data-proposal-value='after'>
                <span>{t('conversation.creativeStudio.workspace.proposals.after')}</span>
                <ReviewValue resolveTextEntry={resolveTextEntry} value={field.after} />
              </div>
            )}
          </>
        )}
      </dd>
    </div>
  );
};

/** A current-schema proposal card. It renders only the main-derived reducer review. */
export const DirectorProposalCard: React.FC<DirectorProposalCardProps> = ({
  project,
  proposal,
  pending,
  actionsLocked = false,
  authorityState = proposal.review.status,
  authorityVerified = true,
  draftBlocker = null,
  acceptBlockedMessageKey = null,
  errorMessageKey = null,
  onAccept,
  onReject,
  paidRecoveryQuote = null,
  paidRecoveryStatusMessageKey = null,
  onPaidRecoveryAction,
  onRequestUpdated = async () => undefined,
  onReviewRuleDrafts = () => undefined,
  onEditShotsDirectly = () => undefined,
}) => {
  const { t, i18n } = useTranslation();
  const acceptBlockId = React.useId();
  const reviewDetailsId = React.useId();
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  if (proposal.status !== 'pending') return null;
  const paidRecoveryPayload = proposal.payload.kind === 'paid_recovery' ? proposal.payload : null;
  const effectivePaidRecoveryQuote = paidRecoveryQuote ?? paidRecoveryPayload?.quote ?? null;
  const paidRecoveryQuoteExpired =
    effectivePaidRecoveryQuote !== null && Date.parse(effectivePaidRecoveryQuote.expiresAt) <= Date.now();
  const reviewUnavailable = authorityState !== 'ready';
  const authorityUnavailable = authorityState === 'unavailable' && !authorityVerified;
  const actionsUnavailable = !authorityVerified || authorityState === 'refreshing';
  const effectiveAcceptBlockedMessageKey =
    acceptBlockedMessageKey ??
    (draftBlocker === 'workspace'
      ? 'conversation.creativeStudio.workspace.proposals.saveBeforeApply'
      : draftBlocker === 'rules'
        ? 'conversation.creativeStudio.workspace.proposals.reviewRuleDraftsFirst'
        : null);
  const reviewGroups = proposal.review.status === 'ready' ? proposal.review.groups : [];
  const refusal = proposal.review.status === 'unavailable' ? proposal.review.refusal : null;
  const isCoverageDependencyRefusal =
    refusal?.reasonCode === 'dependency_blocked' && refusal.operationKind === 'apply_coverage';
  const coverageRefusalHasShootingScript =
    isCoverageDependencyRefusal && refusal.subjects.some((entry) => entry.fixedReasons.includes('shooting_script'));
  const directEditSubjects = isCoverageDependencyRefusal
    ? refusal.subjects.filter((entry) => entry.subject.kind === 'shot' && entry.subject.ownerBeatId !== null)
    : [];
  const directEditBeatIds = new Set(directEditSubjects.map((entry) => entry.subject.ownerBeatId!));
  const directEditBeatId = directEditBeatIds.size === 1 ? (directEditSubjects[0]?.subject.ownerBeatId ?? null) : null;
  const directEditShotIds = directEditSubjects.map((entry) => entry.subject.id);
  const reviewLabels = new Map<string, string>([[project.id, project.name]]);
  for (const beatId of project.beatOrder) {
    const beat = project.beats[beatId];
    if (beat === undefined) continue;
    reviewLabels.set(beat.id, beat.title);
    beat.shotOrder.forEach((shotId, index) => {
      reviewLabels.set(
        shotId,
        `${t('conversation.creativeStudio.workspace.proposals.subject.shot')} ${index + 1} · ${beat.title}`
      );
    });
  }
  for (const group of reviewGroups) {
    const { subject } = group;
    const label =
      subject.title !== null && subject.title.length > 0
        ? subject.title
        : subject.position === null
          ? null
          : `${t(`conversation.creativeStudio.workspace.proposals.subject.${subject.kind}`)} ${subject.position}${
              subject.ownerBeatTitle === null || subject.ownerBeatTitle.length === 0
                ? ''
                : ` · ${subject.ownerBeatTitle}`
            }`;
    if (label !== null) reviewLabels.set(subject.id, label);
  }
  const resolveTextEntry = (entry: string): string => reviewLabels.get(entry) ?? entry;

  return (
    <Card
      className={styles.card}
      data-proposal-state={authorityState}
      data-testid={`studio-proposal-${proposal.id}`}
      title={t('conversation.creativeStudio.workspace.proposals.title')}
    >
      <p>
        <span>{t('conversation.creativeStudio.workspace.proposals.proposalId')}</span>:{' '}
        <code>
          <bdi dir='auto'>{proposal.id}</bdi>
        </code>
      </p>
      <p>{t('conversation.creativeStudio.workspace.proposals.revision', { revision: proposal.baseRevision })}</p>
      {authorityState === 'refreshing' ? (
        <p role='status'>{t('conversation.creativeStudio.workspace.proposals.refreshing')}</p>
      ) : authorityState === 'stale' && proposal.review.status === 'stale' ? (
        <p role='alert'>
          {t('conversation.creativeStudio.workspace.proposals.reviewStale', {
            baseRevision: proposal.review.baseRevision,
            currentRevision: proposal.review.currentRevision,
          })}
        </p>
      ) : authorityUnavailable ? (
        <p role='alert'>{t('conversation.creativeStudio.workspace.proposals.authorityUnavailable')}</p>
      ) : authorityState === 'unavailable' || proposal.review.status === 'unavailable' ? (
        refusal === null ? (
          <p role='alert'>{t('conversation.creativeStudio.workspace.proposals.reviewUnavailable')}</p>
        ) : (
          <div
            data-proposal-refusal-code={refusal.reasonCode}
            data-proposal-refusal-operation={refusal.operationKind}
            role='alert'
          >
            <p>
              {t(
                isCoverageDependencyRefusal
                  ? coverageRefusalHasShootingScript
                    ? 'conversation.creativeStudio.workspace.proposals.refusal.applyCoverage'
                    : 'conversation.creativeStudio.workspace.proposals.refusal.applyCoverageFixedWork'
                  : REFUSAL_REASON_KEYS[refusal.reasonCode]
              )}
            </p>
            <ul data-proposal-refusal-subjects>
              {refusal.subjects.map((entry) => (
                <li key={`${entry.subject.kind}:${entry.subject.id}`}>
                  <ReviewSubject subject={entry.subject} />
                  {entry.fixedReasons.length === 0 ? null : (
                    <span>
                      {' — '}
                      {entry.fixedReasons.map((reason) => t(FIXED_REASON_KEYS[reason])).join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      ) : paidRecoveryPayload !== null && effectivePaidRecoveryQuote !== null ? (
        <section data-testid='studio-paid-recovery-review'>
          <h3>{t('conversation.creativeStudio.workspace.proposals.paidRecovery.heading')}</h3>
          <p>{t('conversation.creativeStudio.workspace.proposals.paidRecovery.explanation')}</p>
          <dl>
            <dt>{t('conversation.creativeStudio.workspace.proposals.paidRecovery.blockedBy')}</dt>
            <dd>{t(PAID_RECOVERY_CAUSE_KEYS[paidRecoveryPayload.blocker.cause])}</dd>
            <dt>{t('conversation.creativeStudio.workspace.proposals.paidRecovery.affectedWork')}</dt>
            <dd>
              <bdi dir='auto'>{formatPaidRecoveryLocation(paidRecoveryPayload.blocker.where, project, t)}</bdi>
            </dd>
            <dt>{t('conversation.creativeStudio.workspace.proposals.paidRecovery.price')}</dt>
            <dd data-paid-recovery-price>
              <bdi dir='auto'>
                {effectivePaidRecoveryQuote.lowerMinorUnits === effectivePaidRecoveryQuote.upperMinorUnits
                  ? formatMinorUnits(
                      effectivePaidRecoveryQuote.lowerMinorUnits,
                      effectivePaidRecoveryQuote.currency,
                      i18n?.resolvedLanguage ?? i18n?.language ?? 'en-US'
                    )
                  : t('conversation.creativeStudio.workspace.proposals.paidRecovery.priceRange', {
                      lower: formatMinorUnits(
                        effectivePaidRecoveryQuote.lowerMinorUnits,
                        effectivePaidRecoveryQuote.currency,
                        i18n?.resolvedLanguage ?? i18n?.language ?? 'en-US'
                      ),
                      upper: formatMinorUnits(
                        effectivePaidRecoveryQuote.upperMinorUnits,
                        effectivePaidRecoveryQuote.currency,
                        i18n?.resolvedLanguage ?? i18n?.language ?? 'en-US'
                      ),
                    })}
              </bdi>
            </dd>
            <dt>{t('conversation.creativeStudio.workspace.proposals.paidRecovery.generations')}</dt>
            <dd>
              {t('conversation.creativeStudio.workspace.proposals.paidRecovery.generationCount', {
                count: effectivePaidRecoveryQuote.itemCount,
              })}
              {effectivePaidRecoveryQuote.includesCascade
                ? ` · ${t('conversation.creativeStudio.workspace.proposals.paidRecovery.includesCascade')}`
                : ''}
            </dd>
          </dl>
          <p role={paidRecoveryQuoteExpired ? 'alert' : 'status'}>
            {paidRecoveryQuoteExpired
              ? t('conversation.creativeStudio.workspace.proposals.paidRecovery.expired')
              : t('conversation.creativeStudio.workspace.proposals.paidRecovery.expires', {
                  expiresAt: new Intl.DateTimeFormat(i18n?.resolvedLanguage ?? i18n?.language ?? 'en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(effectivePaidRecoveryQuote.expiresAt)),
                })}
          </p>
        </section>
      ) : proposal.review.groups.length === 0 ? (
        <p>{t('conversation.creativeStudio.workspace.proposals.noChanges')}</p>
      ) : (
        <>
          <div className={styles.summary}>
            <p>
              {t('conversation.creativeStudio.workspace.proposals.mutationCount', {
                count: proposal.review.groups.length,
              })}
            </p>
            <Button
              aria-controls={reviewDetailsId}
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen((current) => !current)}
              size='mini'
              type='text'
            >
              {t('conversation.creativeStudio.workspace.proposals.reviewDetails')}
            </Button>
          </div>
          {detailsOpen ? (
            <ol className={styles.reviewList} data-testid='studio-proposal-semantic-review' id={reviewDetailsId}>
              {proposal.review.groups.map((group, index) => (
                <li
                  className={styles.change}
                  key={`${index}:${group.subject.kind}:${group.subject.id}`}
                  data-proposal-change={group.change}
                  data-proposal-subject-id={group.subject.id}
                >
                  <section>
                    <h3 className={styles.changeTitle}>
                      {t(`conversation.creativeStudio.workspace.proposals.change.${group.change}`)} ·{' '}
                      <ReviewSubject subject={group.subject} />
                    </h3>
                    <dl className={styles.fields}>
                      {group.fields.map((reviewField, fieldIndex) => (
                        <ReviewField
                          change={group.change}
                          key={`${fieldIndex}:${reviewField.key}`}
                          field={reviewField}
                          resolveTextEntry={resolveTextEntry}
                        />
                      ))}
                    </dl>
                  </section>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      )}
      <div className={styles.actions}>
        {paidRecoveryPayload === null ? (
          <Button
            type={reviewUnavailable ? undefined : 'primary'}
            aria-describedby={effectiveAcceptBlockedMessageKey === null ? undefined : acceptBlockId}
            disabled={actionsLocked || effectiveAcceptBlockedMessageKey !== null || reviewUnavailable}
            loading={pending}
            onClick={() => void onAccept(proposal.id)}
          >
            {t('conversation.creativeStudio.workspace.proposals.accept')}
          </Button>
        ) : (
          <Button
            type={reviewUnavailable ? undefined : 'primary'}
            disabled={actionsLocked || actionsUnavailable || reviewUnavailable || onPaidRecoveryAction === undefined}
            loading={pending}
            onClick={() => void onPaidRecoveryAction?.(proposal.id)}
          >
            {t(
              paidRecoveryQuoteExpired
                ? 'conversation.creativeStudio.workspace.proposals.paidRecovery.refresh'
                : 'conversation.creativeStudio.workspace.proposals.paidRecovery.confirm'
            )}
          </Button>
        )}
        <Button disabled={actionsLocked || actionsUnavailable} onClick={() => void onReject(proposal.id)}>
          {t('conversation.creativeStudio.workspace.proposals.reject')}
        </Button>
        {directEditBeatId === null || directEditShotIds.length === 0 ? null : (
          <Button
            disabled={actionsLocked || actionsUnavailable}
            onClick={() => onEditShotsDirectly(directEditBeatId, directEditShotIds)}
          >
            {t('conversation.creativeStudio.workspace.proposals.refusal.editShotsDirectly')}
          </Button>
        )}
        {paidRecoveryPayload !== null ? null : draftBlocker === 'rules' ? (
          <Button disabled={actionsLocked} onClick={onReviewRuleDrafts}>
            {t('conversation.creativeStudio.workspace.proposals.reviewRuleDrafts')}
          </Button>
        ) : authorityState !== 'ready' || draftBlocker === 'workspace' ? (
          <Button
            type={actionsUnavailable ? undefined : 'primary'}
            disabled={actionsLocked || actionsUnavailable}
            loading={pending}
            onClick={() => void onRequestUpdated(proposal.id, draftBlocker === 'workspace')}
          >
            {t(
              draftBlocker === 'workspace'
                ? 'conversation.creativeStudio.workspace.proposals.saveAndRequestUpdated'
                : 'conversation.creativeStudio.workspace.proposals.requestUpdated'
            )}
          </Button>
        ) : null}
      </div>
      {effectiveAcceptBlockedMessageKey === null ? null : (
        <p id={acceptBlockId} role='status'>
          {t(effectiveAcceptBlockedMessageKey)}
        </p>
      )}
      {paidRecoveryStatusMessageKey === null ? null : <p role='status'>{t(paidRecoveryStatusMessageKey)}</p>}
      {errorMessageKey !== null ? <div role='alert'>{t(errorMessageKey)}</div> : null}
    </Card>
  );
};
