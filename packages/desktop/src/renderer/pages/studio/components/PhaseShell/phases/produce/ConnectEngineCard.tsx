/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { copyText } from '@/renderer/utils/ui/clipboard';
import { Button } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import styles from './produce.module.css';

export type ConnectEngineCardProps = {
  disabled?: boolean;
  headingId?: string;
  onOpenSettings: (path: '/settings/model') => void;
};

/** The sole Produce surface until the workspace has an explicitly selected media route. */
export const ConnectEngineCard: React.FC<ConnectEngineCardProps> = ({
  disabled = false,
  headingId = 'studio-produce-connect-heading',
  onOpenSettings,
}) => {
  const { t } = useTranslation();

  const askTeammate = (): void => {
    void copyText(t('conversation.creativeStudio.phase.produce.askTeammateCopy')).catch((): undefined => undefined);
  };

  return (
    <section className={styles.connectCard} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.connectHeading}>
        {t('conversation.creativeStudio.phase.produce.connectEngine')}
      </h2>
      <div className={styles.connectActions}>
        <Button type='primary' disabled={disabled} onClick={() => onOpenSettings('/settings/model')}>
          {t('conversation.creativeStudio.models.openSettings')}
        </Button>
        <Button onClick={askTeammate}>{t('conversation.creativeStudio.phase.produce.askTeammate')}</Button>
      </div>
    </section>
  );
};
