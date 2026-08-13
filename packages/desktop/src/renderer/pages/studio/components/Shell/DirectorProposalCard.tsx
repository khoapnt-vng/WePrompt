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
  StudioEditableSceneField,
  StudioProposal,
  StudioProposalDiff,
  StudioProposalAcceptance,
  StudioProposalRequest,
  StudioRendererProject,
} from '@/common/types/project/creativeStudioTypes';
import {
  computeStudioProposalDiff,
  normaliseStudioProposalDiff,
} from '@/common/types/project/creativeStudioProposalDiff';
import type { UseStoryboardEditorResult } from '@/renderer/pages/studio/hooks/useStoryboardEditor';

const SCENE_FIELD_LABEL_KEYS = {
  title: 'conversation.creativeStudio.brief.proposalField.title',
  purpose: 'conversation.creativeStudio.brief.proposalField.purpose',
  visualPrompt: 'conversation.creativeStudio.brief.proposalField.visualPrompt',
  narration: 'conversation.creativeStudio.brief.proposalField.narration',
  onScreenText: 'conversation.creativeStudio.brief.proposalField.onScreenText',
  mediaKind: 'conversation.creativeStudio.brief.proposalField.mediaKind',
  durationSeconds: 'conversation.creativeStudio.brief.proposalField.durationSeconds',
  referenceAssetId: 'conversation.creativeStudio.brief.proposalField.referenceAssetId',
} as const satisfies Record<StudioEditableSceneField, string>;

export type DirectorProposalAction = (
  request: StudioProposalRequest
) => Promise<StudioCommandResult<StudioProposalAcceptance>>;
export type DirectorProposalRejectAction = (
  request: StudioProposalRequest
) => Promise<StudioCommandResult<StudioProposal>>;

export type DirectorProposalCardProps = {
  project: StudioRendererProject;
  proposal: StudioProposal;
  editor: Pick<UseStoryboardEditorResult, 'hasUnsavedSceneDrafts' | 'flushAllSceneDrafts'>;
  acceptProposal: DirectorProposalAction;
  rejectProposal: DirectorProposalRejectAction;
  onRepropose: () => Promise<void>;
};

/**
 * Main freezes a proposal's diff against the project it was drafted from, because a diff recomputed after
 * acceptance reads as no change at all. Null means the truth is not knowable here: a record written before
 * main froze anything, seen only after the script had already moved past the revision it was drafted from.
 */
const resolveProposalDiff = (project: StudioRendererProject, proposal: StudioProposal): StudioProposalDiff | null => {
  // A rule pin has no positional shape, so there is nothing to diff and nothing to be unknowable about.
  if (proposal.payload.kind !== 'replace_storyboard') return null;
  const frozen = normaliseStudioProposalDiff(proposal.diff);
  if (frozen !== undefined) return frozen;
  if (project.revision !== proposal.baseRevision) return null;
  return computeStudioProposalDiff(project, proposal.payload);
};

export const DirectorProposalCard: React.FC<DirectorProposalCardProps> = ({
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
  const diff = useMemo(() => resolveProposalDiff(project, proposal), [project, proposal]);
  // Translator-owned, because the enumeration comma is not ", " everywhere (zh and ja want "、").
  const fieldSeparator = t('conversation.creativeStudio.brief.proposalFieldSeparator');
  const request = { projectId: project.id, proposalId: proposal.id };

  const accept = async (): Promise<void> => {
    if (pending || status !== 'pending') return;
    setPending(true);
    setMessageKey(null);
    setStale(false);
    try {
      if (proposal.payload.kind !== 'pin_rule' && editor.hasUnsavedSceneDrafts) {
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

  if (status !== 'pending') return null;

  if (proposal.payload.kind === 'pin_rule') {
    const { rule } = proposal.payload;
    return (
      <Card title={t('conversation.creativeStudio.rules.proposalTitle')}>
        <p>{t('conversation.creativeStudio.rules.proposalBody')}</p>
        <p>{rule.text}</p>
        {rule.predicate !== null && (
          <p>
            {t('conversation.creativeStudio.rules.proposalTerms', {
              terms: rule.predicate.terms.join(fieldSeparator),
            })}
          </p>
        )}
        <div className='flex gap-8px'>
          <Button type='primary' loading={pending} onClick={() => void accept()}>
            {t('conversation.creativeStudio.brief.proposalAccept')}
          </Button>
          <Button disabled={pending} onClick={() => void reject()}>
            {t('conversation.creativeStudio.brief.proposalReject')}
          </Button>
        </div>
        {messageKey !== null && (
          <div role='status' aria-live='polite'>
            {t(messageKey)}
          </div>
        )}
        {stale && (
          <Button onClick={() => void onRepropose()}>{t('conversation.creativeStudio.brief.proposalRepropose')}</Button>
        )}
      </Card>
    );
  }

  const storyboardPayload = proposal.payload;

  return (
    <Card title={t('conversation.creativeStudio.brief.proposalTitle')}>
      <p>
        {t('conversation.creativeStudio.brief.proposalMeta', {
          revision: proposal.baseRevision,
          createdAt: new Date(proposal.createdAt).toLocaleString(),
        })}
      </p>
      {diff === null ? (
        <p>{t('conversation.creativeStudio.brief.proposalDiffUnavailable')}</p>
      ) : diff.added === 0 && diff.removed === 0 && diff.changed.length === 0 ? (
        <p>{t('conversation.creativeStudio.brief.proposalNoChanges')}</p>
      ) : (
        <>
          <p>
            {t('conversation.creativeStudio.brief.proposalSummary', {
              added: diff.added,
              removed: diff.removed,
              changed: diff.changed.length,
            })}
          </p>
          {diff.changed.length > 0 && (
            <ul>
              {diff.changed.map((change) => (
                <li key={change.position}>
                  {t('conversation.creativeStudio.brief.proposalSceneChange', {
                    position: change.position,
                    fields: change.fields.map((field) => t(SCENE_FIELD_LABEL_KEYS[field])).join(fieldSeparator),
                  })}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <ul>
        {storyboardPayload.sceneOrder.map((sceneId) => (
          <li key={sceneId}>{storyboardPayload.scenes[sceneId]?.title ?? sceneId}</li>
        ))}
      </ul>
      <div className='flex gap-8px'>
        <Button type='primary' loading={pending} onClick={() => void accept()}>
          {t('conversation.creativeStudio.brief.proposalAccept')}
        </Button>
        <Button disabled={pending} onClick={() => void reject()}>
          {t('conversation.creativeStudio.brief.proposalReject')}
        </Button>
      </div>
      {messageKey !== null && (
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
