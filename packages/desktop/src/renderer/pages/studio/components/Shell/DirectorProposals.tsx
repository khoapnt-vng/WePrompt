/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type {
  StudioProposalV2,
  StudioReferenceRequestV2,
  StudioRendererReferenceGenerationHandoffV2,
} from '@/common/types/project/creativeStudioTypes';
import { DirectorProposalCard } from './DirectorProposalCard';

export type DirectorProposalsProps = {
  proposals: readonly StudioProposalV2[];
  referenceRequests: readonly StudioReferenceRequestV2[];
  referenceGenerationHandoffs: readonly StudioRendererReferenceGenerationHandoffV2[];
  pendingActionId: string | null;
  proposalErrorMessageKey?: string | null;
  referenceErrorMessageKey?: string | null;
  onAcceptProposal: (proposalId: string) => Promise<void>;
  onRejectProposal: (proposalId: string) => Promise<void>;
  onGenerateReferences: (requestId: string) => Promise<void>;
  onRejectReferences: (requestId: string) => Promise<void>;
  onReviewHandoff: (handoff: StudioRendererReferenceGenerationHandoffV2) => void;
  onDismissHandoff: (handoff: StudioRendererReferenceGenerationHandoffV2) => Promise<void>;
  gateLocked?: boolean;
  reviewBlockedMessageKey?: string | null;
};

export const pendingDirectorProposals = (proposals: readonly StudioProposalV2[]): StudioProposalV2[] =>
  proposals.filter((proposal) => proposal.status === 'pending');

const uniqueHandoffs = (
  handoffs: readonly StudioRendererReferenceGenerationHandoffV2[]
): StudioRendererReferenceGenerationHandoffV2[] => {
  const byId = new Map<string, StudioRendererReferenceGenerationHandoffV2>();
  for (const handoff of handoffs) {
    const current = byId.get(handoff.handoffId);
    if (current === undefined || (current.status === 'open' && handoff.status !== 'open')) {
      byId.set(handoff.handoffId, handoff);
    }
  }
  return [...byId.values()];
};

/** Reviewed Director output with persistent, explicitly actioned generation handoffs. */
export const DirectorProposals: React.FC<DirectorProposalsProps> = ({
  proposals,
  referenceRequests,
  referenceGenerationHandoffs,
  pendingActionId,
  proposalErrorMessageKey = null,
  referenceErrorMessageKey = null,
  onAcceptProposal,
  onRejectProposal,
  onGenerateReferences,
  onRejectReferences,
  onReviewHandoff,
  onDismissHandoff,
  gateLocked = false,
  reviewBlockedMessageKey = null,
}) => {
  const { t } = useTranslation();
  const pendingProposals = pendingDirectorProposals(proposals);
  const handoffs = uniqueHandoffs(referenceGenerationHandoffs);
  if (
    pendingProposals.length === 0 &&
    referenceRequests.length === 0 &&
    handoffs.length === 0 &&
    proposalErrorMessageKey === null &&
    referenceErrorMessageKey === null
  ) {
    return null;
  }

  return (
    <section aria-label={t('conversation.creativeStudio.workspace.review.title')}>
      <h2>{t('conversation.creativeStudio.workspace.review.title')}</h2>
      {proposalErrorMessageKey !== null ? <div role='alert'>{t(proposalErrorMessageKey)}</div> : null}
      {referenceErrorMessageKey !== null ? <div role='alert'>{t(referenceErrorMessageKey)}</div> : null}
      {pendingProposals.map((proposal) => (
        <DirectorProposalCard
          key={proposal.id}
          proposal={proposal}
          pending={pendingActionId === proposal.id}
          onAccept={onAcceptProposal}
          onReject={onRejectProposal}
        />
      ))}
      {referenceRequests.map((request) => (
        <Card
          key={request.id}
          data-testid={`studio-reference-${request.id}`}
          title={t('conversation.creativeStudio.workspace.references.title')}
        >
          <p>
            {t('conversation.creativeStudio.workspace.references.shotCount', {
              count: request.shotIds.length,
            })}
          </p>
          <div className='flex gap-8px'>
            <Button
              type='primary'
              loading={pendingActionId === request.id}
              onClick={() => void onGenerateReferences(request.id)}
            >
              {t('conversation.creativeStudio.workspace.references.generate')}
            </Button>
            <Button disabled={pendingActionId === request.id} onClick={() => void onRejectReferences(request.id)}>
              {t('conversation.creativeStudio.workspace.references.reject')}
            </Button>
          </div>
        </Card>
      ))}
      {handoffs.map((handoff) => (
        <Card
          key={handoff.handoffId}
          data-testid={`studio-handoff-${handoff.handoffId}`}
          title={t('conversation.creativeStudio.workspace.handoffs.title')}
        >
          <p>
            {t('conversation.creativeStudio.workspace.handoffs.shotCount', {
              count: handoff.shotIds.length,
            })}
          </p>
          {handoff.status === 'open' ? (
            <div className='flex gap-8px'>
              <Button
                type='primary'
                disabled={gateLocked || reviewBlockedMessageKey !== null}
                onClick={() => onReviewHandoff(handoff)}
              >
                {t('conversation.creativeStudio.workspace.handoffs.review')}
              </Button>
              <Button
                disabled={gateLocked || pendingActionId === handoff.handoffId}
                loading={pendingActionId === handoff.handoffId}
                onClick={() => void onDismissHandoff(handoff)}
              >
                {t('conversation.creativeStudio.workspace.handoffs.dismiss')}
              </Button>
              {reviewBlockedMessageKey === null ? null : <p>{t(reviewBlockedMessageKey)}</p>}
            </div>
          ) : (
            <p>{t(`conversation.creativeStudio.workspace.handoffs.${handoff.status}`)}</p>
          )}
        </Card>
      ))}
    </section>
  );
};
