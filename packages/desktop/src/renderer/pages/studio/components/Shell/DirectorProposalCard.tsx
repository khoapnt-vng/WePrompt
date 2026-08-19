/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { StudioProposalV2 } from '@/common/types/project/creativeStudioTypes';

export type DirectorProposalCardProps = {
  proposal: StudioProposalV2;
  pending: boolean;
  errorMessageKey?: string | null;
  onAccept: (proposalId: string) => Promise<void>;
  onReject: (proposalId: string) => Promise<void>;
};

/** A schema-2 proposal card. It never flushes drafts or performs paid work. */
export const DirectorProposalCard: React.FC<DirectorProposalCardProps> = ({
  proposal,
  pending,
  errorMessageKey = null,
  onAccept,
  onReject,
}) => {
  const { t } = useTranslation();
  if (proposal.status !== 'pending') return null;

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
                <code>{operation.kind}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className='flex gap-8px'>
        <Button type='primary' loading={pending} onClick={() => void onAccept(proposal.id)}>
          {t('conversation.creativeStudio.workspace.proposals.accept')}
        </Button>
        <Button disabled={pending} onClick={() => void onReject(proposal.id)}>
          {t('conversation.creativeStudio.workspace.proposals.reject')}
        </Button>
      </div>
      {errorMessageKey !== null ? <div role='alert'>{t(errorMessageKey)}</div> : null}
    </Card>
  );
};
