/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Drawer, Tooltip } from '@arco-design/web-react';
import { Left, Right } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { StudioLayoutMode } from '../PhaseShell/useStudioLayoutMode';
import styles from './StudioShell.module.css';
import type { StudioPaneState } from './useStudioPanes';

export type StudioShellProps = {
  /** The Director conversation. Rendered once here, never per phase. */
  director: React.ReactNode;
  directorState: StudioPaneState;
  layoutMode: StudioLayoutMode;
  onDirectorStateChange: (value: StudioPaneState) => void;
  /** Transient overlay open/close below `inline`; never a preference change. */
  directorOverlayOpen: boolean;
  onDirectorOverlayOpenChange: (open: boolean) => void;
  children: React.ReactNode;
};

/**
 * Studio's two-pane frame.
 *
 * The side menu is not included: it belongs to the application layout outside this page, so Studio
 * owns the Director pane and the work panel only.
 *
 * The Director is mounted **once, here**, rather than per phase. That is what makes a phase change
 * unable to tear down a streaming reply — there is one mount and it never unmounts, so the
 * multi-mount hazard the A15 smoke was written for does not arise.
 *
 * Below `inline` the pane cannot sit beside the work panel, so it opens as an overlay instead.
 * Opening and closing that overlay is a UI action and deliberately does not touch the persisted
 * preference.
 */
export const StudioShell: React.FC<StudioShellProps> = ({
  director,
  directorState,
  layoutMode,
  onDirectorStateChange,
  directorOverlayOpen,
  onDirectorOverlayOpenChange,
  children,
}) => {
  const { t } = useTranslation();
  const overlays = layoutMode !== 'inline';
  const collapsed = directorState === 'collapsed';
  const label = collapsed
    ? t('conversation.creativeStudio.shell.showDirector')
    : t('conversation.creativeStudio.shell.hideDirector');

  const toggle = (
    <Tooltip content={label}>
      <Button
        type='text'
        size='small'
        aria-label={label}
        aria-expanded={overlays ? directorOverlayOpen : !collapsed}
        icon={collapsed || overlays ? <Right aria-hidden='true' /> : <Left aria-hidden='true' />}
        onClick={() =>
          overlays
            ? onDirectorOverlayOpenChange(!directorOverlayOpen)
            : onDirectorStateChange(collapsed ? 'expanded' : 'collapsed')
        }
      />
    </Tooltip>
  );

  return (
    <div className={styles.shell} data-studio-shell data-layout={layoutMode}>
      {overlays ? (
        // `mountOnEnter={false}` and `unmountOnExit={false}` are load-bearing, not defaults.
        // Arco's Drawer otherwise defers mounting until first open and tears the subtree down on
        // close — which would drop a reply streaming into a shut overlay. Note AssistantDock does
        // pass `unmountOnExit`, so it is not a precedent for keeping children alive.
        <Drawer
          visible={directorOverlayOpen}
          placement='left'
          width={352}
          footer={null}
          title={null}
          maskClosable
          mountOnEnter={false}
          unmountOnExit={false}
          onCancel={() => onDirectorOverlayOpenChange(false)}
        >
          {director}
        </Drawer>
      ) : (
        <aside
          data-studio-director-pane
          data-collapsed={collapsed ? 'true' : 'false'}
          aria-hidden={collapsed ? 'true' : undefined}
          className={`${styles.directorPane} ${collapsed ? styles.directorPaneCollapsed : ''}`}
        >
          {director}
        </aside>
      )}
      <div className={styles.workPanel} data-studio-work-panel>
        {toggle}
        {children}
      </div>
    </div>
  );
};
