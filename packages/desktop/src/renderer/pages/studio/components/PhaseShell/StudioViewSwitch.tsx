/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { STUDIO_VIEWS, type StudioView } from '../../studioPhaseRoute';
import styles from './StudioPhaseShell.module.css';

const VIEW_LABEL_KEYS: Record<StudioView, string> = {
  table: 'conversation.creativeStudio.phase.nav.table',
  board: 'conversation.creativeStudio.phase.nav.board',
  cut: 'conversation.creativeStudio.phase.nav.cut',
  brief: 'conversation.creativeStudio.phase.nav.brief',
};

export type StudioViewSwitchProps = {
  activeView: StudioView;
  disabled: boolean;
  onSelect: (view: StudioView) => void;
};

/**
 * Switches between the document's views.
 *
 * Not a stepper: there is no order to complete, so it carries no numerals, no completion markers
 * and no `aria-current='step'`. Each view is a routable address, which is why it stays a navigation
 * landmark and marks the active one with `aria-current='page'`. An unordered list says the same
 * thing structurally — the `<ol>` it replaced promised a sequence the app no longer has.
 */
export const StudioViewSwitch: React.FC<StudioViewSwitchProps> = ({ activeView, disabled, onSelect }) => {
  const { t } = useTranslation();

  return (
    <nav aria-label={t('conversation.creativeStudio.phase.nav.viewsLabel')} className={styles.viewSwitch}>
      <ul className={styles.viewList}>
        {STUDIO_VIEWS.map((view) => {
          const active = view === activeView;
          return (
            <li key={view} className={styles.viewItem}>
              <Button
                type='text'
                aria-current={active ? 'page' : undefined}
                data-active={active}
                className={`${styles.viewButton} ${active ? styles.viewButtonActive : ''}`}
                disabled={disabled}
                onClick={() => onSelect(view)}
              >
                <span className={styles.viewLabel}>{t(VIEW_LABEL_KEYS[view])}</span>
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
