/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import ThoughtDisplay from '@/renderer/components/chat/ThoughtDisplay';
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('ThoughtDisplay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a calm thinking state before a live activity is available', () => {
    render(<ThoughtDisplay running />);

    const display = screen.getByTestId('thought-display');
    expect(display).toHaveClass('thought-display');
    expect(display).toHaveClass('thought-display--running');
    expect(display).not.toHaveClass('mb--20px');
    expect(display).not.toHaveClass('pb-30px');
    expect(display).not.toHaveClass('rd-t-20px');
    expect(screen.getByText('conversation.thinking.label')).toBeInTheDocument();
    expect(screen.getByTestId('thought-display-dots')).toBeInTheDocument();
    expect(screen.queryByText('0s')).not.toBeInTheDocument();
  });

  it('narrates the live activity without a separate status tag', () => {
    render(<ThoughtDisplay running thought={{ subject: 'Planning', description: 'Checking files' }} />);

    const display = screen.getByTestId('thought-display');
    expect(display).toHaveClass('thought-display');
    expect(display).toHaveClass('thought-display--running');
    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getByText('Checking files')).toBeInTheDocument();
    expect(display.querySelector('.arco-tag')).not.toBeInTheDocument();
    expect(screen.queryByTestId('thought-display-dots')).not.toBeInTheDocument();
  });

  it('shows elapsed time only after the activity has been running for a few seconds', () => {
    vi.useFakeTimers();
    render(<ThoughtDisplay running />);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.getByText('5s')).toBeInTheDocument();
  });

  it('names the user as the blocker instead of counting time while awaiting approval', () => {
    vi.useFakeTimers();
    render(<ThoughtDisplay running awaitingApproval />);

    act(() => {
      vi.advanceTimersByTime(252_000);
    });

    const display = screen.getByTestId('thought-display');
    expect(display).toHaveAttribute('data-awaiting-approval', 'true');
    expect(display).toHaveClass('thought-display--awaiting-approval');
    expect(display).not.toHaveClass('thought-display--running');
    expect(screen.getByText('conversation.thinking.waitingApproval')).toBeInTheDocument();
    expect(screen.queryByText('conversation.thinking.label')).not.toBeInTheDocument();
    // The run is blocked on the user, so a "4m 12s" model-work timer would be a lie.
    expect(screen.queryByText('4m 12s')).not.toBeInTheDocument();
    expect(screen.queryByTestId('thought-display-dots')).not.toBeInTheDocument();
  });

  it('outranks a stale activity label left behind by the stopped run', () => {
    render(
      <ThoughtDisplay running awaitingApproval thought={{ subject: 'Planning', description: 'Checking files' }} />
    );

    expect(screen.getByText('conversation.thinking.waitingApproval')).toBeInTheDocument();
    expect(screen.queryByText('Planning')).not.toBeInTheDocument();
    expect(screen.queryByText('Checking files')).not.toBeInTheDocument();
  });

  it('stays visible when the backend has already stopped reporting the turn as processing', () => {
    render(<ThoughtDisplay running={false} awaitingApproval />);

    expect(screen.getByTestId('thought-display')).toBeInTheDocument();
    expect(screen.getByText('conversation.thinking.waitingApproval')).toBeInTheDocument();
  });

  it('leaves the ordinary thinking state untouched when nothing is awaiting approval', () => {
    render(<ThoughtDisplay running awaitingApproval={false} />);

    const display = screen.getByTestId('thought-display');
    expect(display).not.toHaveAttribute('data-awaiting-approval');
    expect(display).toHaveClass('thought-display--running');
    expect(screen.getByText('conversation.thinking.label')).toBeInTheDocument();
  });
});
