/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  StudioCommandResult,
  StudioEditableScene,
  StudioProposal,
  StudioProposalAcceptance,
  StudioProposalRequest,
  StudioRendererProject,
} from '@/common/types/project/creativeStudioTypes';
import type { UseStoryboardEditorResult } from '@/renderer/pages/studio/hooks/useStoryboardEditor';

const EDITABLE_SCENE_FIELDS = [
  'title',
  'purpose',
  'visualPrompt',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
] as const satisfies readonly (keyof StudioEditableScene)[];

export type BriefProposalAction = (
  request: StudioProposalRequest
) => Promise<StudioCommandResult<StudioProposalAcceptance>>;
export type BriefProposalRejectAction = (
  request: StudioProposalRequest
) => Promise<StudioCommandResult<StudioProposal>>;

export type BriefProposalCardProps = {
  project: StudioRendererProject;
  proposal: StudioProposal;
  editor: Pick<UseStoryboardEditorResult, 'hasUnsavedSceneDrafts' | 'flushAllSceneDrafts'>;
  acceptProposal: BriefProposalAction;
  rejectProposal: BriefProposalRejectAction;
  onRepropose: () => Promise<void>;
};

const sceneChanged = (current: StudioEditableScene, proposed: StudioEditableScene): boolean =>
  EDITABLE_SCENE_FIELDS.some((field) => current[field] !== proposed[field]);

const proposalDiff = (project: StudioRendererProject, proposal: StudioProposal) => {
  const proposedIds = new Set(proposal.payload.sceneOrder);
  const currentIds = new Set(project.sceneOrder);
  const added = proposal.payload.sceneOrder.filter((sceneId) => !currentIds.has(sceneId)).length;
  const removed = project.sceneOrder.filter((sceneId) => !proposedIds.has(sceneId)).length;
  const changed = proposal.payload.sceneOrder.filter((sceneId) => {
    const current = project.scenes[sceneId];
    const proposed = proposal.payload.scenes[sceneId];
    return current !== undefined && proposed !== undefined && sceneChanged(current, proposed);
  }).length;
  return { added, removed, changed };
};

export const BriefProposalCard: React.FC<BriefProposalCardProps> = ({
  project,
  proposal,
  editor,
  acceptProposal,
  rejectProposal,
  onRepropose,
}) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState(proposal.status);
  const [pending, setPending] = useState(false);
  const [messageKey, setMessageKey] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const diff = useMemo(() => proposalDiff(project, proposal), [project, proposal]);
  const request = { projectId: project.id, proposalId: proposal.id };

  const accept = async (): Promise<void> => {
    if (pending || status !== 'pending') return;
    setPending(true);
    setMessageKey(null);
    setStale(false);
    try {
      if (editor.hasUnsavedSceneDrafts) {
        const flushed = await editor.flushAllSceneDrafts();
        if (flushed.failed.length > 0 || flushed.dirtied.length > 0) {
          setMessageKey('conversation.creativeStudio.brief.proposalFlushRefused');
          return;
        }
      }
      const result = await acceptProposal(request);
      if (result.ok === false) {
        if (result.error.code === 'stale_project') {
          setStale(true);
          setMessageKey('conversation.creativeStudio.brief.proposalStale');
        } else {
          setMessageKey(result.error.messageKey);
        }
        return;
      }
      setStatus('accepted');
      setMessageKey('conversation.creativeStudio.brief.proposalAccepted');
    } finally {
      setPending(false);
    }
  };

  const reject = async (): Promise<void> => {
    if (pending || status !== 'pending') return;
    setPending(true);
    setMessageKey(null);
    try {
      const result = await rejectProposal(request);
      if (result.ok === false) {
        setMessageKey(result.error.messageKey);
        return;
      }
      setStatus('rejected');
      setMessageKey('conversation.creativeStudio.brief.proposalRejected');
    } finally {
      setPending(false);
    }
  };

  return (
    <Card title={t('conversation.creativeStudio.brief.proposalTitle')}>
      <p>
        {t('conversation.creativeStudio.brief.proposalMeta', {
          revision: proposal.baseRevision,
          createdAt: new Date(proposal.createdAt).toLocaleString(),
        })}
      </p>
      <p>{t('conversation.creativeStudio.brief.proposalSummary', diff)}</p>
      <ul>
        {proposal.payload.sceneOrder.map((sceneId) => (
          <li key={sceneId}>{proposal.payload.scenes[sceneId]?.title ?? sceneId}</li>
        ))}
      </ul>
      {status === 'pending' ? (
        <div className='flex gap-8px'>
          <Button type='primary' loading={pending} onClick={() => void accept()}>
            {t('conversation.creativeStudio.brief.proposalAccept')}
          </Button>
          <Button disabled={pending} onClick={() => void reject()}>
            {t('conversation.creativeStudio.brief.proposalReject')}
          </Button>
        </div>
      ) : (
        <div role='status' aria-live='polite'>
          {t(
            status === 'accepted'
              ? 'conversation.creativeStudio.brief.proposalAccepted'
              : status === 'rejected'
                ? 'conversation.creativeStudio.brief.proposalRejected'
                : 'conversation.creativeStudio.brief.proposalExpired'
          )}
        </div>
      )}
      {messageKey !== null && status === 'pending' && (
        <div role='status' aria-live='polite'>
          {t(messageKey)}
        </div>
      )}
      {stale && (
        <Button onClick={() => void onRepropose()}>{t('conversation.creativeStudio.brief.proposalRepropose')}</Button>
      )}
    </Card>
  );
};
