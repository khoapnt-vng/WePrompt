/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { StudioMutationOperationV2, StudioProposalV2 } from '@/common/types/project/creativeStudioTypes';

export type DirectorProposalCardProps = {
  proposal: StudioProposalV2;
  pending: boolean;
  acceptBlockedMessageKey?: string | null;
  errorMessageKey?: string | null;
  onAccept: (proposalId: string) => Promise<void>;
  onReject: (proposalId: string) => Promise<void>;
};

const ProposedCoverage: React.FC<{
  operation: Extract<StudioMutationOperationV2, { kind: 'apply_coverage' }>;
  operationIndex: number;
  reviewId: string;
}> = ({ operation, operationIndex, reviewId }) => {
  const { t } = useTranslation();
  const fixedReviewId = `${reviewId}-coverage-${operationIndex}`;

  return (
    <section aria-labelledby={`${fixedReviewId}-title`} data-testid={`studio-coverage-review-${operationIndex}`}>
      <h3 id={`${fixedReviewId}-title`}>
        {t('conversation.creativeStudio.workspace.proposals.coverageReviewTitle')} <bdi>{operation.beatId}</bdi>
      </h3>
      <ol aria-label={t('conversation.creativeStudio.workspace.proposals.proposedShots')}>
        {operation.shots.map((shot, shotIndex) => (
          <li key={`${shotIndex}:${shot.shotId}`} data-testid={`studio-proposed-shot-${operationIndex}-${shotIndex}`}>
            <p>
              {t('conversation.creativeStudio.workspace.proposals.proposedShot', {
                position: shotIndex + 1,
              })}{' '}
              · <bdi>{shot.shotId}</bdi>
            </p>
            <dl>
              <div>
                <dt>{t('conversation.creativeStudio.workspace.proposals.proposedDuration')}</dt>
                <dd>
                  <bdi>
                    {t('conversation.creativeStudio.workspace.proposals.proposedDurationValue', {
                      seconds: shot.durationSeconds,
                    })}
                  </bdi>
                </dd>
              </div>
              <div>
                <dt>{t('conversation.creativeStudio.workspace.proposals.proposedLine')}</dt>
                <dd dir='auto'>{shot.line}</dd>
              </div>
              <div>
                <dt>{t('conversation.creativeStudio.workspace.proposals.proposedNarration')}</dt>
                <dd dir='auto'>
                  {shot.narration || t('conversation.creativeStudio.workspace.proposals.emptyAuthoredField')}
                </dd>
              </div>
              <div>
                <dt>{t('conversation.creativeStudio.workspace.proposals.proposedOnScreenText')}</dt>
                <dd dir='auto'>
                  {shot.onScreenText || t('conversation.creativeStudio.workspace.proposals.emptyAuthoredField')}
                </dd>
              </div>
              <div>
                <dt>{t('conversation.creativeStudio.workspace.proposals.proposedChain')}</dt>
                <dd>{t(`conversation.creativeStudio.workspace.proposals.chainBreak.${shot.chainBreak}`)}</dd>
              </div>
            </dl>
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
            count: operation.fixedShots.length,
          })}
        </p>
        {operation.fixedShots.length === 0 ? (
          <p>{t('conversation.creativeStudio.workspace.proposals.noFixedShots')}</p>
        ) : (
          <ol data-testid={`studio-fixed-shot-list-${operationIndex}`}>
            {operation.fixedShots.map((fixed, fixedIndex) => (
              <li
                key={`${fixedIndex}:${fixed.shotId}`}
                data-testid={`studio-fixed-shot-${operationIndex}-${fixedIndex}`}
              >
                <p>
                  {t('conversation.creativeStudio.workspace.proposals.fixedShot', {
                    position: fixedIndex + 1,
                  })}{' '}
                  · <bdi>{fixed.shotId}</bdi>
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

const ProposedRederivation: React.FC<{
  operation: Extract<StudioMutationOperationV2, { kind: 'rederive_line' }>;
  operationIndex: number;
}> = ({ operation, operationIndex }) => {
  const { t } = useTranslation();
  return (
    <section data-testid={`studio-rederive-review-${operationIndex}`}>
      <h3>{t('conversation.creativeStudio.workspace.proposals.rederiveTitle')}</h3>
      <p>
        {t('conversation.creativeStudio.workspace.proposals.rederiveShot')} <bdi>{operation.shotId}</bdi>
      </p>
      <p>{t('conversation.creativeStudio.workspace.proposals.proposedLine')}</p>
      <p dir='auto'>{operation.line}</p>
    </section>
  );
};

/** A schema-2 proposal card. It never flushes drafts or performs paid work. */
export const DirectorProposalCard: React.FC<DirectorProposalCardProps> = ({
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

  const fixedReviewIds =
    proposal.payload.kind === 'mutation_batch'
      ? proposal.payload.operations.flatMap((operation, operationIndex) =>
          operation.kind === 'apply_coverage' ? [`${reviewId}-coverage-${operationIndex}`] : []
        )
      : [];

  return (
    <Card
      data-testid={`studio-proposal-${proposal.id}`}
      title={t('conversation.creativeStudio.workspace.proposals.title')}
    >
      <p>
        {t('conversation.creativeStudio.workspace.proposals.revision', {
          revision: proposal.baseRevision,
        })}
      </p>
      {proposal.payload.kind === 'pin_rule' ? (
        <>
          <p>{t('conversation.creativeStudio.workspace.proposals.pinRule')}</p>
          <p>{proposal.payload.rule.text}</p>
        </>
      ) : (
        <>
          <p>
            {t('conversation.creativeStudio.workspace.proposals.mutationCount', {
              count: proposal.payload.operations.length,
            })}
          </p>
          <ul>
            {proposal.payload.operations.map((operation, index) => (
              <li key={`${index}:${operation.kind}`}>
                {operation.kind === 'apply_coverage' ? (
                  <ProposedCoverage operation={operation} operationIndex={index} reviewId={reviewId} />
                ) : operation.kind === 'rederive_line' ? (
                  <ProposedRederivation operation={operation} operationIndex={index} />
                ) : (
                  <code>{operation.kind}</code>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className='flex gap-8px'>
        <Button
          type='primary'
          aria-describedby={
            [...fixedReviewIds, ...(acceptBlockedMessageKey === null ? [] : [acceptBlockId])].join(' ') || undefined
          }
          disabled={pending || acceptBlockedMessageKey !== null}
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
