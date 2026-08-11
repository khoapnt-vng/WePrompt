/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Spin } from '@arco-design/web-react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './SendBox/sendbox.css';

export interface ThoughtData {
  subject: string;
  description: string;
}

type ThoughtDisplayProps = {
  thought?: ThoughtData;
  style?: 'default' | 'compact';
  running?: boolean;
  statusText?: string;
  onStop?: () => void;
  // Absolute start timestamp (ms) supplied by an external source (e.g. team slot work).
  startedAtMs?: number | null;
  // Explicit flag declaring elapsed time is driven by an external timestamp (team chain).
  externalElapsedSource?: boolean;
  // The run is blocked on a permission confirmation the user has not answered yet.
  // The model is not working, so the thinking label, spinner and elapsed timer would all lie.
  awaitingApproval?: boolean;
};

const ThoughtDisplay: React.FC<ThoughtDisplayProps> = ({
  thought,
  style = 'default',
  running = false,
  statusText,
  onStop: _onStop,
  startedAtMs,
  externalElapsedSource,
  awaitingApproval = false,
}) => {
  const { t } = useTranslation();

  // Format elapsed time with localized units
  const formatElapsedTime = (seconds: number): string => {
    const sUnit = t('common.unit.second_short', { defaultValue: 's' });
    const mUnit = t('common.unit.minute_short', { defaultValue: 'm' });

    if (seconds < 60) {
      return `${seconds}${sUnit}`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}${mUnit} ${remainingSeconds}${sUnit}`;
  };

  const [elapsedTime, setElapsedTime] = useState(0);
  const startTimeRef = useRef<number>(Date.now());
  // Keep the indicator mounted while blocked even if the backend has already stopped
  // reporting the turn as processing — the user still needs to be told they are the blocker.
  const hasActivity = running || awaitingApproval || Boolean(thought?.subject);

  // External mode with a valid absolute start timestamp → derive elapsed from it (state A).
  const hasValidStartedAt =
    externalElapsedSource === true &&
    typeof startedAtMs === 'number' &&
    Number.isFinite(startedAtMs) &&
    startedAtMs > 0;
  // External mode but timestamp invalid → suppress the elapsed number (state B).
  const suppressElapsed = externalElapsedSource === true && !hasValidStartedAt;
  // Show the elapsed number only while running and not suppressed; the spinner stays gated on `running`.
  // While blocked on approval the clock is measuring the user, not the model, so it is hidden.
  const showElapsed = running && !suppressElapsed && !awaitingApproval;

  // Timer for elapsed time
  useEffect(() => {
    // Branch A: external timestamp mode with a valid start. Base the elapsed time on the
    // absolute `startedAtMs`, so remount or effect re-runs recompute from the same origin
    // instead of resetting to zero. The inline predicate narrows `startedAtMs` to a number.
    if (
      externalElapsedSource === true &&
      typeof startedAtMs === 'number' &&
      Number.isFinite(startedAtMs) &&
      startedAtMs > 0
    ) {
      const tick = () => setElapsedTime(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
      tick();
      const timer = setInterval(tick, 1000);
      return () => clearInterval(timer);
    }

    // Branch B: external timestamp mode without a valid start. Do not start a timer; the
    // render layer suppresses the number and only shows the status text and spinner.
    if (externalElapsedSource === true) {
      setElapsedTime(0);
      return;
    }

    // Branch C: non-external mode (non-team). Preserve the original local timer behavior.
    if (!hasActivity) {
      setElapsedTime(0);
      return;
    }

    startTimeRef.current = Date.now();
    setElapsedTime(0);

    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedTime(elapsed);
    }, 1000);

    return () => clearInterval(timer);
  }, [externalElapsedSource, startedAtMs, hasActivity]);

  const className = [
    'thought-display',
    running && !awaitingApproval ? 'thought-display--running' : '',
    awaitingApproval ? 'thought-display--awaiting-approval' : '',
    style === 'compact' ? 'thought-display--compact' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (!hasActivity && !statusText) {
    return null;
  }

  // An approval block outranks any label the model left behind: the last thought subject
  // describes work that has already stopped, so showing it keeps the run looking active.
  const isFallbackActivity = !awaitingApproval && !thought?.subject && !statusText;
  const rawActivityLabel = awaitingApproval
    ? t('conversation.thinking.waitingApproval')
    : thought?.subject || statusText || t('conversation.thinking.label');
  const activityLabel = isFallbackActivity ? rawActivityLabel.replace(/(?:\.\.\.|…)\s*$/, '') : rawActivityLabel;
  const showDescription = !awaitingApproval && Boolean(thought?.description && thought.description !== thought.subject);
  // Bare thinking state hides the initial 0s to avoid flicker; a status text or
  // external timestamp means the caller wants the timer visible immediately.
  const showElapsedTime = showElapsed && (elapsedTime > 0 || Boolean(statusText) || externalElapsedSource === true);
  const activityKey = `${activityLabel}:${thought?.description ?? ''}`;

  return (
    <div
      data-testid='thought-display'
      data-awaiting-approval={awaitingApproval ? 'true' : undefined}
      className={className}
      role='status'
      aria-live='polite'
    >
      <div className='thought-display__content' key={activityKey}>
        {running && !awaitingApproval && <Spin size={14} />}
        <span className='thought-display__label'>{activityLabel}</span>
        {running && !awaitingApproval && isFallbackActivity && (
          <span data-testid='thought-display-dots' className='thought-display__dots' aria-hidden='true'>
            <span />
            <span />
            <span />
          </span>
        )}
        {showDescription && <span className='thought-display__description'>{thought?.description}</span>}
        {showElapsedTime && <span className='thought-display__elapsed'>{formatElapsedTime(elapsedTime)}</span>}
      </div>
    </div>
  );
};

export default ThoughtDisplay;
