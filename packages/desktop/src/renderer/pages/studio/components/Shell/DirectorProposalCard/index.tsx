/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type {
  StudioProposalReviewFieldKeyV2,
  StudioProposalReviewFieldV2,
  StudioProposalReviewSubjectV2,
  StudioProposalReviewValueV2,
  StudioRendererProjectV2,
  StudioRendererProposalV2,
} from '@/common/types/project/creativeStudioTypes';

export type DirectorProposalCardProps = {
  project: StudioRendererProjectV2;
  proposal: StudioRendererProposalV2;
  pending: boolean;
  acceptBlockedMessageKey?: string | null;
  errorMessageKey?: string | null;
  onAccept: (proposalId: string) => Promise<void>;
  onReject: (proposalId: string) => Promise<void>;
};

const fieldLabelKey = (key: StudioProposalReviewFieldKeyV2): string =>
  `conversation.creativeStudio.workspace.proposals.field.${key}`;

const ReviewSubject: React.FC<{ subject: StudioProposalReviewSubjectV2 }> = ({ subject }) => {
  const { t } = useTranslation();
  return (
    <bdi dir='auto'>
      {t(`conversation.creativeStudio.workspace.proposals.subject.${subject.kind}`)}
      {subject.position === null ? null : ` ${subject.position}`}
      {subject.title === null || subject.title.length === 0 ? null : ` · ${subject.title}`}
      {' · '}
      {subject.id}
      {subject.ownerBeatId === null
        ? null
        : ` · ${t('conversation.creativeStudio.workspace.proposals.ownerBeat')} · ${
            subject.ownerBeatTitle === null || subject.ownerBeatTitle.length === 0
              ? subject.ownerBeatId
              : `${subject.ownerBeatTitle} · ${subject.ownerBeatId}`
          }`}
    </bdi>
  );
};
const ReviewValue: React.FC<{ value: StudioProposalReviewValueV2 }> = ({ value }) => {
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
            <bdi dir='auto'>{entry}</bdi>
          </li>
        ))}
      </ol>
    );
  }
  if (value.kind === 'placement') {
    return (
      <span>
        {t(`conversation.creativeStudio.workspace.proposals.placementValue.${value.value}`)}
        {value.position === null ? null : ` ${value.position}`}
        {value.ownerBeatId === null
          ? null
          : ` · ${value.ownerBeatTitle === null || value.ownerBeatTitle.length === 0 ? value.ownerBeatId : value.ownerBeatTitle}`}
      </span>
    );
  }
  if (value.value === null || value.value === '') {
    return <span>{t('conversation.creativeStudio.workspace.proposals.emptyAuthoredField')}</span>;
  }
  return <bdi dir='auto'>{value.value}</bdi>;
};

const ReviewField: React.FC<{ field: StudioProposalReviewFieldV2 }> = ({ field }) => {
  const { t } = useTranslation();
  return (
    <div data-proposal-field={field.key}>
      <dt>{t(fieldLabelKey(field.key))}</dt>
      <dd>
        {field.before === null ? null : (
          <div data-proposal-value='before'>
            <span>{t('conversation.creativeStudio.workspace.proposals.before')}</span>
            {' · '}
            <ReviewValue value={field.before} />
          </div>
        )}
        {field.after === null ? null : (
          <div data-proposal-value='after'>
            <span>{t('conversation.creativeStudio.workspace.proposals.after')}</span>
            {' · '}
            <ReviewValue value={field.after} />
          </div>
        )}
      </dd>
    </div>
  );
};

/** A current-schema proposal card. It renders only the main-derived reducer review. */
export const DirectorProposalCard: React.FC<DirectorProposalCardProps> = ({
  proposal,
  pending,
  acceptBlockedMessageKey = null,
  errorMessageKey = null,
  onAccept,
  onReject,
}) => {
  const { t } = useTranslation();
  const acceptBlockId = React.useId();
  if (proposal.status !== 'pending') return null;
  const reviewUnavailable = proposal.review.status !== 'ready';

  return (
    <Card
      data-testid={`studio-proposal-${proposal.id}`}
      title={t('conversation.creativeStudio.workspace.proposals.title')}
    >
      <p>{t('conversation.creativeStudio.workspace.proposals.revision', { revision: proposal.baseRevision })}</p>
      {proposal.review.status === 'stale' ? (
        <p role='alert'>
          {t('conversation.creativeStudio.workspace.proposals.reviewStale', {
            baseRevision: proposal.review.baseRevision,
            currentRevision: proposal.review.currentRevision,
          })}
        </p>
      ) : proposal.review.status === 'unavailable' ? (
        <p role='alert'>{t('conversation.creativeStudio.workspace.proposals.reviewUnavailable')}</p>
      ) : proposal.review.groups.length === 0 ? (
        <p>{t('conversation.creativeStudio.workspace.proposals.noChanges')}</p>
      ) : (
        <ol data-testid='studio-proposal-semantic-review'>
          {proposal.review.groups.map((group, index) => (
            <li key={`${index}:${group.subject.kind}:${group.subject.id}`} data-proposal-change={group.change}>
              <section>
                <h3>
                  {t(`conversation.creativeStudio.workspace.proposals.change.${group.change}`)} ·{' '}
                  <ReviewSubject subject={group.subject} />
                </h3>
                <dl>
                  {group.fields.map((reviewField, fieldIndex) => (
                    <ReviewField key={`${fieldIndex}:${reviewField.key}`} field={reviewField} />
                  ))}
                </dl>
              </section>
            </li>
          ))}
        </ol>
      )}
      <div className='flex gap-8px'>
        <Button
          type='primary'
          aria-describedby={acceptBlockedMessageKey === null ? undefined : acceptBlockId}
          disabled={pending || acceptBlockedMessageKey !== null || reviewUnavailable}
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
