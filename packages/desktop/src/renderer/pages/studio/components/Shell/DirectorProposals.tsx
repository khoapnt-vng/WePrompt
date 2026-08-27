/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type {
  StudioRendererProposalV2,
  StudioReferenceRequestV2,
  StudioRendererProjectV2,
  StudioRendererReferenceGenerationHandoffV2,
} from '@/common/types/project/creativeStudioTypes';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';
import { DirectorProposalCard } from './DirectorProposalCard';

export type DirectorProposalsProps = {
  project: StudioRendererProjectV2;
  proposals: readonly StudioRendererProposalV2[];
  referenceRequests: readonly StudioReferenceRequestV2[];
  referenceGenerationHandoffs: readonly StudioRendererReferenceGenerationHandoffV2[];
  pendingAction: { kind: 'proposal' | 'reference_request' | 'handoff'; id: string } | null;
  actionsLocked?: boolean;
  proposalAuthorityState?: (proposal: StudioRendererProposalV2) => 'ready' | 'stale' | 'unavailable' | 'refreshing';
  proposalAuthorityVerified?: (proposal: StudioRendererProposalV2) => boolean;
  proposalDraftBlocker?: (proposal: StudioRendererProposalV2) => 'workspace' | 'rules' | null;
  proposalErrorMessageKey?: string | null;
  referenceErrorMessageKey?: string | null;
  onAcceptProposal: (proposalId: string) => Promise<void>;
  onRejectProposal: (proposalId: string) => Promise<void>;
  onRequestUpdatedProposal?: (proposalId: string, saveWorkspaceDrafts: boolean) => Promise<void>;
  onReviewRuleDrafts?: () => void;
  onEditProposalShots?: (beatId: string, shotIds: readonly string[]) => void;
  onGenerateReferences: (requestId: string) => Promise<void>;
  onRejectReferences: (requestId: string) => Promise<void>;
  onReviewHandoff: (handoff: StudioRendererReferenceGenerationHandoffV2) => void;
  onReviewReferences: (handoff: StudioRendererReferenceGenerationHandoffV2) => void;
  onRetryFailedReferences: (handoff: StudioRendererReferenceGenerationHandoffV2) => void;
  onDismissHandoff: (handoff: StudioRendererReferenceGenerationHandoffV2) => Promise<void>;
  gateLocked?: boolean;
  reviewBlockedMessageKey?: string | null;
};

export const pendingDirectorProposals = (proposals: readonly StudioRendererProposalV2[]): StudioRendererProposalV2[] =>
  proposals.filter((proposal) => proposal.status === 'pending');

const uniqueHandoffs = (
  handoffs: readonly StudioRendererReferenceGenerationHandoffV2[]
): StudioRendererReferenceGenerationHandoffV2[] => {
  const byId = new Map<string, StudioRendererReferenceGenerationHandoffV2>();
  for (const handoff of handoffs) {
    byId.set(handoff.handoffId, handoff);
  }
  return [...byId.values()];
};

/** Reviewed Director output with persistent, explicitly actioned generation handoffs. */
export const DirectorProposals: React.FC<DirectorProposalsProps> = ({
  project,
  proposals,
  referenceRequests,
  referenceGenerationHandoffs,
  pendingAction,
  actionsLocked = false,
  proposalAuthorityState = (proposal) => proposal.review.status,
  proposalAuthorityVerified = () => true,
  proposalDraftBlocker = () => null,
  proposalErrorMessageKey = null,
  referenceErrorMessageKey = null,
  onAcceptProposal,
  onRejectProposal,
  onRequestUpdatedProposal = async () => undefined,
  onReviewRuleDrafts = () => undefined,
  onEditProposalShots = () => undefined,
  onGenerateReferences,
  onRejectReferences,
  onReviewHandoff,
  onReviewReferences,
  onRetryFailedReferences,
  onDismissHandoff,
  gateLocked = false,
  reviewBlockedMessageKey = null,
}) => {
  const { t } = useTranslation();
  const pendingProposals = pendingDirectorProposals(proposals);
  const handoffs = uniqueHandoffs(referenceGenerationHandoffs);
  const referenceName = (referenceId: string): string => {
    const reference = Object.hasOwn(project.references, referenceId) ? project.references[referenceId] : undefined;
    return reference?.id === referenceId ? reference.label : referenceId;
  };
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
          project={project}
          proposal={proposal}
          pending={pendingAction?.kind === 'proposal' && pendingAction.id === proposal.id}
          actionsLocked={actionsLocked}
          authorityState={proposalAuthorityState(proposal)}
          authorityVerified={proposalAuthorityVerified(proposal)}
          draftBlocker={proposalDraftBlocker(proposal)}
          acceptBlockedMessageKey={null}
          onAccept={onAcceptProposal}
          onReject={onRejectProposal}
          onRequestUpdated={onRequestUpdatedProposal}
          onReviewRuleDrafts={onReviewRuleDrafts}
          onEditShotsDirectly={onEditProposalShots}
        />
      ))}
      {referenceRequests.map((request) => (
        <Card
          key={request.id}
          data-testid={`studio-reference-${request.id}`}
          title={t('conversation.creativeStudio.workspace.references.title')}
        >
          <p>
            {t('conversation.creativeStudio.workspace.references.referenceCount', {
              total: request.referenceIds.length,
            })}
          </p>
          <ul data-reference-request-names>
            {request.referenceIds.map((referenceId) => (
              <li key={referenceId}>
                <bdi dir='auto'>{referenceName(referenceId)}</bdi>
              </li>
            ))}
          </ul>
          <div className='flex gap-8px'>
            <Button
              type='primary'
              disabled={actionsLocked}
              loading={pendingAction?.kind === 'reference_request' && pendingAction.id === request.id}
              onClick={() => void onGenerateReferences(request.id)}
            >
              {t('conversation.creativeStudio.workspace.references.generate')}
            </Button>
            <Button disabled={actionsLocked} onClick={() => void onRejectReferences(request.id)}>
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
            {t('conversation.creativeStudio.workspace.handoffs.referenceCount', {
              total: handoff.referenceIds.length,
            })}
          </p>
          <ul data-reference-handoff-names>
            {handoff.referenceIds.map((referenceId) => (
              <li key={referenceId}>
                <bdi dir='auto'>{referenceName(referenceId)}</bdi>
              </li>
            ))}
          </ul>
          <p data-reference-handoff-progress>
            {t('conversation.creativeStudio.workspace.handoffs.progress', handoff.counts)}
          </p>
          {handoff.resultAssetIds.length === 0 ? null : (
            <div className='flex flex-wrap gap-8px' data-reference-handoff-thumbnails>
              {handoff.resultAssetIds.map((assetId) => {
                const reference = project.referenceOrder
                  .map((referenceId) => project.references[referenceId])
                  .find(
                    (candidate) =>
                      candidate?.approvedAssetId === assetId || candidate?.supersededAssetIds.includes(assetId)
                  );
                return (
                  <img
                    alt={t('conversation.creativeStudio.workspace.referenceWorkflow.previewAlt', {
                      label: reference?.label ?? t('conversation.creativeStudio.workspace.views.references'),
                    })}
                    className='h-48px w-72px rd-4px object-cover'
                    key={assetId}
                    src={createManagedStudioAssetUrl(project.id, assetId)}
                  />
                );
              })}
            </div>
          )}
          {handoff.status === 'awaiting_spend' ? (
            <div className='flex gap-8px'>
              <Button
                type='primary'
                disabled={gateLocked || actionsLocked || reviewBlockedMessageKey !== null}
                onClick={() => onReviewHandoff(handoff)}
              >
                {t('conversation.creativeStudio.workspace.handoffs.review')}
              </Button>
              <Button
                disabled={gateLocked || actionsLocked}
                loading={pendingAction?.kind === 'handoff' && pendingAction.id === handoff.handoffId}
                onClick={() => void onDismissHandoff(handoff)}
              >
                {t('conversation.creativeStudio.workspace.handoffs.dismiss')}
              </Button>
              {reviewBlockedMessageKey === null ? null : <p>{t(reviewBlockedMessageKey)}</p>}
            </div>
          ) : (
            <>
              <p>{t(`conversation.creativeStudio.workspace.handoffs.${handoff.status}`)}</p>
              {handoff.status === 'succeeded' ||
              handoff.status === 'partially_failed' ||
              handoff.status === 'failed' ? (
                <div className='flex flex-wrap gap-8px'>
                  {handoff.resultAssetIds.length === 0 ? null : (
                    <Button type='primary' disabled={actionsLocked} onClick={() => onReviewReferences(handoff)}>
                      {t('conversation.creativeStudio.workspace.handoffs.reviewReferences')}
                    </Button>
                  )}
                  {handoff.failedReferenceIds.length === 0 ? null : (
                    <Button disabled={gateLocked || actionsLocked} onClick={() => onRetryFailedReferences(handoff)}>
                      {t('conversation.creativeStudio.workspace.handoffs.retryFailed')}
                    </Button>
                  )}
                </div>
              ) : null}
            </>
          )}
        </Card>
      ))}
    </section>
  );
};
