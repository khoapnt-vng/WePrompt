/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Collapse } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type {
  StudioMutationOperationV2,
  StudioProposalV2,
  StudioRendererProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  buildProposalReview,
  type ProposalOperationReview,
  type ProposalReviewEntity,
  type ProposalReviewField,
  type ProposalReviewFieldKey,
  type ProposalReviewValue,
} from './proposalReview';

export type DirectorProposalCardProps = {
  project: StudioRendererProjectV2;
  proposal: StudioProposalV2;
  pending: boolean;
  acceptBlockedMessageKey?: string | null;
  errorMessageKey?: string | null;
  onAccept: (proposalId: string) => Promise<void>;
  onReject: (proposalId: string) => Promise<void>;
};

const fieldLabelKey = (key: ProposalReviewFieldKey): string => {
  switch (key) {
    case 'brief':
      return 'conversation.creativeStudio.workspace.controls.brief';
    case 'title':
      return 'conversation.creativeStudio.brief.proposalField.title';
    case 'action':
      return 'conversation.creativeStudio.workspace.beatPanel.fields.action';
    case 'look':
      return 'conversation.creativeStudio.workspace.beatPanel.fields.look';
    case 'targetSeconds':
      return 'conversation.creativeStudio.workspace.beatPanel.fields.targetSeconds';
    case 'placement':
      return 'conversation.creativeStudio.workspace.proposals.placement';
    case 'ownerBeat':
      return 'conversation.creativeStudio.workspace.proposals.ownerBeat';
    case 'line':
      return 'conversation.creativeStudio.workspace.beatPanel.fields.line';
    case 'narration':
      return 'conversation.creativeStudio.workspace.beatPanel.fields.narration';
    case 'onScreenText':
      return 'conversation.creativeStudio.workspace.beatPanel.fields.onScreenText';
    case 'durationSeconds':
      return 'conversation.creativeStudio.workspace.beatPanel.fields.duration';
    case 'chainBreak':
      return 'conversation.creativeStudio.workspace.proposals.proposedChain';
    case 'identity':
      return 'conversation.creativeStudio.workspace.proposals.proposedShots';
    case 'order':
      return 'conversation.creativeStudio.workspace.proposals.order';
    case 'referenceKind':
      return 'conversation.creativeStudio.workspace.proposals.referenceKind';
    case 'referencePrompt':
      return 'conversation.creativeStudio.workspace.proposals.referencePrompt';
    case 'assignedShots':
      return 'conversation.creativeStudio.workspace.proposals.assignedShots';
  }
};

const ReviewEntity: React.FC<{ entity: ProposalReviewEntity }> = ({ entity }) => {
  const { t } = useTranslation();
  const kind =
    entity.kind === 'reference'
      ? t('conversation.creativeStudio.workspace.views.references')
      : t(`conversation.creativeStudio.workspace.bin.kind.${entity.kind}`);
  return (
    <bdi dir='auto'>
      {kind}
      {entity.position === null ? null : ` ${entity.position}`}
      {' · '}
      {entity.title === null ? null : `${entity.title} · `}
      {entity.id}
      {entity.ownerBeat === null
        ? null
        : ` · ${t('conversation.creativeStudio.workspace.proposals.ownerBeat')} · ${
            entity.ownerBeat.title === null ? entity.ownerBeat.id : `${entity.ownerBeat.title} · ${entity.ownerBeat.id}`
          }`}
    </bdi>
  );
};

const ReviewValueContent: React.FC<{ fieldKey: ProposalReviewFieldKey; value: ProposalReviewValue }> = ({
  fieldKey,
  value,
}) => {
  const { t } = useTranslation();
  if (value.kind === 'entities') {
    if (value.values.length === 0) {
      return <span>{t('conversation.creativeStudio.workspace.proposals.emptyAuthoredField')}</span>;
    }
    return (
      <ol>
        {value.values.map((entity, index) => (
          <li key={`${index}:${entity.kind}:${entity.id}`}>
            <ReviewEntity entity={entity} />
          </li>
        ))}
      </ol>
    );
  }
  if (value.kind === 'placement') {
    if (value.value === 'bin') return <span>{t('conversation.creativeStudio.workspace.bin.title')}</span>;
    if (value.value === 'end') return <span>{t('conversation.creativeStudio.workspace.bin.restore.atEnd')}</span>;
    return (
      <span>
        {t('conversation.creativeStudio.workspace.proposals.beforeItem', {
          kind: t(`conversation.creativeStudio.workspace.bin.kind.${value.value.before.kind}`),
        })}{' '}
        · <ReviewEntity entity={value.value.before} />
      </span>
    );
  }
  if (value.kind === 'referenceKind') {
    if (value.value === null) {
      return <span>{t('conversation.creativeStudio.workspace.proposals.emptyAuthoredField')}</span>;
    }
    return (
      <span>
        {t(
          `conversation.creativeStudio.workspace.referenceWorkflow.${
            value.value === 'character' ? 'characters' : 'backgrounds'
          }.title`
        )}
      </span>
    );
  }
  if (value.kind === 'chainBreak') {
    if (value.value === null) {
      return <span>{t('conversation.creativeStudio.workspace.proposals.emptyAuthoredField')}</span>;
    }
    return <span>{t(`conversation.creativeStudio.workspace.proposals.chainBreak.${value.value}`)}</span>;
  }
  if (value.value === null || value.value === '') {
    return <span>{t('conversation.creativeStudio.workspace.proposals.emptyAuthoredField')}</span>;
  }
  if (value.kind === 'number' && (fieldKey === 'durationSeconds' || fieldKey === 'targetSeconds')) {
    return (
      <bdi>{t('conversation.creativeStudio.workspace.proposals.proposedDurationValue', { seconds: value.value })}</bdi>
    );
  }
  return <bdi dir='auto'>{value.value}</bdi>;
};

const ReviewFields: React.FC<{ fields: readonly ProposalReviewField[] }> = ({ fields }) => {
  const { t } = useTranslation();
  if (fields.length === 0) return null;
  return (
    <dl>
      {fields.map((field, index) => (
        <div key={`${index}:${field.key}`}>
          <dt>{t(fieldLabelKey(field.key))}</dt>
          <dd>
            {field.before === undefined ? (
              <ReviewValueContent fieldKey={field.key} value={field.after} />
            ) : (
              <div className='flex flex-col gap-4px'>
                <div>
                  {t('conversation.creativeStudio.workspace.proposals.before')} ·{' '}
                  <ReviewValueContent fieldKey={field.key} value={field.before} />
                </div>
                <div>
                  {t('conversation.creativeStudio.workspace.proposals.after')} ·{' '}
                  <ReviewValueContent fieldKey={field.key} value={field.after} />
                </div>
              </div>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
};

const ProposedCoverage: React.FC<{
  review: Extract<ProposalOperationReview, { kind: 'coverage' }>;
  operationIndex: number;
  reviewId: string;
}> = ({ review, operationIndex, reviewId }) => {
  const { t } = useTranslation();
  const fixedReviewId = `${reviewId}-coverage-${operationIndex}`;

  return (
    <section aria-labelledby={`${fixedReviewId}-title`} data-testid={`studio-coverage-review-${operationIndex}`}>
      <h3 id={`${fixedReviewId}-title`}>
        {t('conversation.creativeStudio.workspace.proposals.coverageReviewTitle')} ·{' '}
        <ReviewEntity entity={review.beat} />
      </h3>
      <div data-testid={`studio-coverage-order-${operationIndex}`}>
        <ReviewFields fields={[review.order]} />
      </div>
      <ol aria-label={t('conversation.creativeStudio.workspace.proposals.proposedShots')}>
        {review.shots.map((shot, shotIndex) => (
          <li
            key={`${shotIndex}:${shot.subject.id}`}
            data-change={shot.change}
            data-testid={`studio-proposed-shot-${operationIndex}-${shotIndex}`}
          >
            <h4>
              <ReviewEntity entity={shot.subject} />
            </h4>
            <ReviewFields fields={shot.fields} />
          </li>
        ))}
      </ol>
      <div
        id={fixedReviewId}
        aria-atomic='true'
        aria-live='polite'
        data-testid={`studio-fixed-review-${operationIndex}`}
        role='status'
      >
        <h4>{t('conversation.creativeStudio.workspace.proposals.fixedShotsTitle')}</h4>
        <p>
          {t('conversation.creativeStudio.workspace.proposals.fixedReviewAnnouncement', {
            count: review.fixedShots.length,
          })}
        </p>
        {review.fixedShots.length === 0 ? (
          <p>{t('conversation.creativeStudio.workspace.proposals.noFixedShots')}</p>
        ) : (
          <ol data-testid={`studio-fixed-shot-list-${operationIndex}`}>
            {review.fixedShots.map((fixed, fixedIndex) => (
              <li
                key={`${fixedIndex}:${fixed.shotId}`}
                data-testid={`studio-fixed-shot-${operationIndex}-${fixedIndex}`}
              >
                <p>
                  {t('conversation.creativeStudio.workspace.proposals.fixedShot', { position: fixedIndex + 1 })} ·{' '}
                  <bdi>{fixed.shotId}</bdi>
                </p>
                <ul data-testid={`studio-fixed-reasons-${operationIndex}-${fixedIndex}`}>
                  {fixed.reasons.map((reason, reasonIndex) => (
                    <li key={`${reasonIndex}:${reason}`}>
                      {t(`conversation.creativeStudio.workspace.proposals.fixedReason.${reason}`)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
};

const HumanOperationReview: React.FC<{ review: ProposalOperationReview; operationIndex: number; reviewId: string }> = ({
  review,
  operationIndex,
  reviewId,
}) => {
  const { t } = useTranslation();
  if (review.kind === 'coverage') {
    return <ProposedCoverage review={review} operationIndex={operationIndex} reviewId={reviewId} />;
  }
  const title = t(`conversation.creativeStudio.workspace.controls.undoLabel.${review.operationKind}`);
  if (review.kind === 'references') {
    return (
      <section data-testid={`studio-reference-operation-review-${operationIndex}`}>
        <h3>{title}</h3>
        <div data-testid={`studio-reference-order-${operationIndex}`}>
          <ReviewFields fields={[review.order]} />
        </div>
        <ol>
          {review.references.map((reference, referenceIndex) => (
            <li key={reference.subject.id} data-testid={`studio-proposed-project-reference-${referenceIndex}`}>
              <h4>
                <ReviewEntity entity={reference.subject} />
              </h4>
              <ReviewFields fields={reference.fields} />
            </li>
          ))}
        </ol>
      </section>
    );
  }
  return (
    <section data-testid={`studio-human-operation-review-${operationIndex}`}>
      <h3>
        {title}
        {review.subject === null ? null : (
          <>
            {' · '}
            <ReviewEntity entity={review.subject} />
          </>
        )}
      </h3>
      <ReviewFields fields={review.fields} />
    </section>
  );
};

/** A current-schema proposal card. It never flushes drafts or performs paid work. */
export const DirectorProposalCard: React.FC<DirectorProposalCardProps> = ({
  project,
  proposal,
  pending,
  acceptBlockedMessageKey = null,
  errorMessageKey = null,
  onAccept,
  onReject,
}) => {
  const { t } = useTranslation();
  const reviewId = React.useId();
  const acceptBlockId = `${reviewId}-accept-block`;
  if (proposal.status !== 'pending') return null;

  const review =
    proposal.payload.kind === 'mutation_batch' ? buildProposalReview(project, proposal.payload.operations) : [];
  const fixedReviewIds =
    review?.flatMap((item, operationIndex) =>
      item.kind === 'coverage' ? [`${reviewId}-coverage-${operationIndex}`] : []
    ) ?? [];
  const unsafeReview = review === null;

  return (
    <Card
      data-testid={`studio-proposal-${proposal.id}`}
      title={t('conversation.creativeStudio.workspace.proposals.title')}
    >
      <p>{t('conversation.creativeStudio.workspace.proposals.revision', { revision: proposal.baseRevision })}</p>
      {proposal.payload.kind === 'pin_rule' ? (
        <>
          <p>{t('conversation.creativeStudio.workspace.proposals.pinRule')}</p>
          <p dir='auto'>{proposal.payload.rule.text}</p>
          {proposal.payload.rule.predicate === null ? null : (
            <p dir='auto'>
              {t('conversation.creativeStudio.rules.proposalTerms', {
                terms: proposal.payload.rule.predicate.terms.join(', '),
              })}
            </p>
          )}
        </>
      ) : (
        <>
          <p>
            {t('conversation.creativeStudio.workspace.proposals.mutationCount', {
              count: proposal.payload.operations.length,
            })}
          </p>
          {unsafeReview ? (
            <p role='alert'>{t('conversation.creativeStudio.workspace.proposals.reviewUnavailable')}</p>
          ) : (
            <ol>
              {review.map((item, index) => (
                <li key={`${index}:${item.kind}`}>
                  <HumanOperationReview review={item} operationIndex={index} reviewId={reviewId} />
                </li>
              ))}
            </ol>
          )}
          <Collapse bordered={false}>
            <Collapse.Item
              header={t('conversation.creativeStudio.workspace.proposals.technicalDetails')}
              name='technical-details'
            >
              <ol data-testid='studio-proposal-technical-operations'>
                {proposal.payload.operations.map((operation: StudioMutationOperationV2, index: number) => (
                  <li key={`${index}:${operation.kind}`}>
                    <code>{operation.kind}</code>
                  </li>
                ))}
              </ol>
            </Collapse.Item>
          </Collapse>
        </>
      )}
      <div className='flex gap-8px'>
        <Button
          type='primary'
          aria-describedby={
            [...fixedReviewIds, ...(acceptBlockedMessageKey === null ? [] : [acceptBlockId])].join(' ') || undefined
          }
          disabled={pending || acceptBlockedMessageKey !== null || unsafeReview}
          loading={pending}
          onClick={() => void onAccept(proposal.id)}
        >
          {t('conversation.creativeStudio.workspace.proposals.accept')}
        </Button>
        <Button disabled={pending} onClick={() => void onReject(proposal.id)}>
          {t('conversation.creativeStudio.workspace.proposals.reject')}
        </Button>
      </div>
      {acceptBlockedMessageKey === null ? null : (
        <p id={acceptBlockId} role='status'>
          {t(acceptBlockedMessageKey)}
        </p>
      )}
      {errorMessageKey !== null ? <div role='alert'>{t(errorMessageKey)}</div> : null}
    </Card>
  );
};
