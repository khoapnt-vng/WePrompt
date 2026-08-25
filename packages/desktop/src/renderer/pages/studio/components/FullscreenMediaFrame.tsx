/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { FullScreen, OffScreen } from '@icon-park/react';
import classNames from 'classnames';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './FullscreenMediaFrame.module.css';

export type FullscreenMediaFrameProps = {
  children: React.ReactNode;
  className?: string;
  enabled?: boolean;
};

/** Keeps image and video fullscreen behavior consistent without cloning the active media element. */
export const FullscreenMediaFrame: React.FC<FullscreenMediaFrameProps> = ({ children, className, enabled = true }) => {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const syncFullscreenState = (): void => setActive(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  const toggleFullscreen = async (): Promise<void> => {
    const frame = frameRef.current;
    if (frame === null) return;
    try {
      if (document.fullscreenElement === frame) {
        if (typeof document.exitFullscreen === 'function') await document.exitFullscreen();
      } else if (typeof frame.requestFullscreen === 'function') {
        await frame.requestFullscreen();
      }
    } catch {
      // Fullscreen can be denied by the host window; the media remains usable in place.
    }
  };

  const label = t(active ? 'common.collapse' : 'common.expand');

  return (
    <div
      ref={frameRef}
      className={classNames(styles.frame, className)}
      data-fullscreen-active={active}
      data-fullscreen-media-frame
    >
      {children}
      {enabled ? (
        <Button
          aria-label={label}
          className={styles.button}
          icon={
            active ? (
              <OffScreen aria-hidden='true' fill='currentColor' size='16' />
            ) : (
              <FullScreen aria-hidden='true' fill='currentColor' size='16' />
            )
          }
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void toggleFullscreen();
          }}
          shape='circle'
          size='mini'
          title={label}
          type='secondary'
        />
      ) : null}
    </div>
  );
};
