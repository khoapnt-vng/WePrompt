/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { StudioConversationSurface } from '../PhaseShell/phases/StudioConversationSurface';
import { useBriefConversationContext } from './BriefConversationContext';
import styles from './DirectorPane.module.css';

const MAX_PROJECT_BRIEF_CHARS = 16 * 1024;

/**
 * The Creative Director conversation, mounted once for the whole of Studio.
 *
 * This is the same thread throughout — the header says so, because a user who reaches Write has no
 * other way to know the Director still remembers the brief they wrote.
 *
 * Every state the conversation can be in lives here rather than in a phase: not yet created (the
 * first-message composer), created (the surface), and dangling because the conversation was deleted
 * out from under the project (the offer to start fresh). Splitting these across phases is what
 * previously required two hook instances to agree.
 */
export const DirectorPane: React.FC = () => {
  const { t } = useTranslation();
  const conversation = useBriefConversationContext();
  const [composerText, setComposerText] = useState('');
  const invalidComposer = composerText.length > MAX_PROJECT_BRIEF_CHARS;

  return (
    <div className={styles.pane} data-studio-director>
      {/* A div, not a header: inside the overlay Drawer a <header> becomes a second banner
          landmark and collides with the phase header. This identifies a pane, not the page. */}
      <div className={styles.header}>
        <span aria-hidden='true' className={styles.avatar}>
          CD
        </span>
        <span className={styles.identity}>
          <span className={styles.name}>{t('conversation.creativeStudio.shell.directorName')}</span>
          <span className={styles.sameThread}>{t('conversation.creativeStudio.shell.sameConversation')}</span>
        </span>
      </div>

      {conversation.state.kind === 'ready' ? (
        <div
          role='region'
          aria-label={t('conversation.creativeStudio.brief.conversationTitle')}
          className={styles.surface}
        >
          <StudioConversationSurface conversation={conversation.state.conversation} />
        </div>
      ) : conversation.state.kind === 'dangling' ? (
        <div className={styles.dangling}>
          <p>{t('conversation.creativeStudio.brief.danglingNotice')}</p>
          <Button type='primary' onClick={conversation.recreate}>
            {t('conversation.creativeStudio.brief.danglingStartFresh')}
          </Button>
        </div>
      ) : (
        <div className={styles.composer}>
          <Input.TextArea
            value={composerText}
            error={invalidComposer}
            maxLength={MAX_PROJECT_BRIEF_CHARS}
            rows={6}
            placeholder={t('conversation.creativeStudio.brief.composerPlaceholder')}
            onChange={setComposerText}
          />
          {invalidComposer && (
            <span role='alert' className={styles.fieldError}>
              {t('conversation.creativeStudio.errors.invalidPayload')}
            </span>
          )}
          {conversation.errorMessageKey !== null && (
            <span role='alert' className={styles.fieldError}>
              {t(conversation.errorMessageKey)}
            </span>
          )}
          <Button
            type='primary'
            loading={conversation.state.kind === 'creating'}
            disabled={composerText.trim().length === 0 || invalidComposer}
            onClick={() => void conversation.sendFirstMessage(composerText)}
          >
            {t('conversation.creativeStudio.brief.composerSend')}
          </Button>
        </div>
      )}
    </div>
  );
};
