/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Spin } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { StudioConversationSurface } from '../PhaseShell/phases/StudioConversationSurface';
import { useBriefConversationContext } from './BriefConversationContext';
import styles from './DirectorPane.module.css';

/**
 * The Creative Director conversation, mounted once for the whole of Studio.
 *
 * The pane has no composer of its own. It used to hand-roll one for the state before a conversation
 * existed, and that stand-in was the entire reason the Director looked unlike the rest of the app:
 * no attachments, no model picker, no permission selector, no `/` commands, no `@` references, no
 * history. The conversation is created when the project opens, so the surface — and with it the
 * real composer, the same component every other conversation uses — is what the user gets.
 *
 * What is left here are the states the conversation itself can be in: starting, started, refused,
 * and dangling because the conversation was deleted out from under the project. Splitting these
 * across phases is what previously required two hook instances to agree.
 */
export type DirectorPaneProps = {
  /**
   * Proposal cards, composed by the page because it owns the project and the accept/reject calls.
   * A slot rather than data: it keeps this pane free of the storyboard editor, which is the only
   * reason the card was stuck in Brief in the first place.
   */
  proposals?: React.ReactNode;
};

export const DirectorPane: React.FC<DirectorPaneProps> = ({ proposals }) => {
  const { t } = useTranslation();
  const conversation = useBriefConversationContext();
  const { state, errorMessageKey } = conversation;
  const dangling = state.kind === 'dangling';
  /** Nothing to say yet and nothing wrong: the conversation is still being created. */
  const starting = !dangling && errorMessageKey === null;

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

      {state.kind === 'ready' ? (
        <div
          role='region'
          aria-label={t('conversation.creativeStudio.brief.conversationTitle')}
          className={styles.surface}
        >
          <StudioConversationSurface conversation={state.conversation} />
        </div>
      ) : (
        <div className={styles.notice}>
          {dangling && <p>{t('conversation.creativeStudio.brief.danglingNotice')}</p>}
          {errorMessageKey !== null && (
            <span role='alert' className={styles.fieldError}>
              {t(errorMessageKey)}
            </span>
          )}
          {starting ? (
            <span className={styles.starting}>
              <Spin size={14} />
              {t('conversation.creativeStudio.shell.directorStarting')}
            </span>
          ) : (
            // Both roads lead back to a working Director: one starts a replacement for a
            // conversation that is gone, the other retries a start that did not finish.
            <Button type='primary' onClick={conversation.recreate}>
              {t(
                dangling
                  ? 'conversation.creativeStudio.brief.danglingStartFresh'
                  : 'conversation.creativeStudio.library.retry'
              )}
            </Button>
          )}
        </div>
      )}

      {proposals !== undefined && <div className={styles.proposals}>{proposals}</div>}
    </div>
  );
};
