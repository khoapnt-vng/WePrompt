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
  StudioProposalReviewFieldKeyV2,
  StudioProposalReviewFieldV2,
  StudioProposalReviewGroupV2,
  StudioProposalReviewSubjectV2,
  StudioProposalReviewValueV2,
  StudioRendererProjectV2,
  StudioRendererProposalV2,
} from '@/common/types/project/creativeStudioTypes';
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
  onRequestUpdated?: (proposalId: string, saveWorkspaceDrafts: boolean) => Promise<void>;
  onReviewRuleDrafts?: () => void;
  onEditShotsDirectly?: (beatId: string, shotIds: readonly string[]) => void;
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
    <bdi data-owner-beat-id={subject.ownerBeatId ?? undefined} data-subject-id={subject.id} dir='auto'>
      {t(`conversation.creativeStudio.workspace.proposals.subject.${subject.kind}`)}
      {subject.position === null ? null : ` ${subject.position}`}
      {subject.title === null || subject.title.length === 0 ? null : ` · ${subject.title}`}
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
            <bdi data-review-value-id={entry} dir='auto'>
              {resolveTextEntry(entry)}
            </bdi>
          </li>
        ))}
      </ol>
    );
  }
  if (value.kind === 'placement') {
    return (
      <span data-owner-beat-id={value.ownerBeatId ?? undefined}>
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
  onRequestUpdated = async () => undefined,
  onReviewRuleDrafts = () => undefined,
  onEditShotsDirectly = () => undefined,
}) => {
  const { t } = useTranslation();
  const acceptBlockId = React.useId();
  const reviewDetailsId = React.useId();
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  if (proposal.status !== 'pending') return null;
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
  const resolveTextEntry = (entry: string): string =>
    reviewLabels.get(entry) ?? t('conversation.creativeStudio.workspace.proposals.unlabelledItem');

  return (
    <Card
      className={styles.card}
      data-proposal-state={authorityState}
      data-testid={`studio-proposal-${proposal.id}`}
      title={t('conversation.creativeStudio.workspace.proposals.title')}
    >
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
        <Button
          type={reviewUnavailable ? undefined : 'primary'}
          aria-describedby={effectiveAcceptBlockedMessageKey === null ? undefined : acceptBlockId}
          disabled={actionsLocked || effectiveAcceptBlockedMessageKey !== null || reviewUnavailable}
          loading={pending}
          onClick={() => void onAccept(proposal.id)}
        >
          {t('conversation.creativeStudio.workspace.proposals.accept')}
        </Button>
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
        {draftBlocker === 'rules' ? (
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
      {errorMessageKey !== null ? <div role='alert'>{t(errorMessageKey)}</div> : null}
    </Card>
  );
};
