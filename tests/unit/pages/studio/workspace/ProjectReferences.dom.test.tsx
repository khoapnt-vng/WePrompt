/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bridge: {
    chooseAndImportReference: { invoke: vi.fn() },
    detachBriefReference: { invoke: vi.fn() },
  },
}));

vi.mock('@/common', () => ({ ipcBridge: { creativeStudio: mocks.bridge } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values === undefined ? key : `${key}:${JSON.stringify(values)}`,
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}));

import {
  ProjectReferences,
  type ProjectReferenceItem,
} from '@/renderer/pages/studio/components/Workspace/Views/ProjectReferences';

const ok = <T,>(data: T) => ({ ok: true as const, data });

const reference = (overrides: Partial<ProjectReferenceItem> = {}): ProjectReferenceItem => ({
  assetId: 'asset_1',
  label: 'The Striker',
  role: 'cast',
  ...overrides,
});

const renderPanel = (props: Partial<React.ComponentProps<typeof ProjectReferences>> = {}) =>
  render(
    <ProjectReferences
      projectId='project_1'
      projectRevision={7}
      references={props.references ?? []}
      maxConditioningImages={props.maxConditioningImages ?? 3}
      onChanged={props.onChanged ?? vi.fn()}
      {...props}
    />
  );

const KEY = 'conversation.creativeStudio.briefReferences';

describe('the project references panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bridge.chooseAndImportReference.invoke.mockResolvedValue(
      ok({ status: 'imported', assetId: 'asset_new', projectRevision: 8 })
    );
    mocks.bridge.detachBriefReference.invoke.mockResolvedValue(ok({ projectRevision: 8 }));
  });

  it('offers both roles and says each is empty before anything is added', () => {
    renderPanel();

    expect(screen.getByText(`${KEY}.castEmpty`)).toBeVisible();
    expect(screen.getByText(`${KEY}.lookEmpty`)).toBeVisible();
    expect(screen.getByRole('button', { name: `${KEY}.addCast` })).toBeEnabled();
    expect(screen.getByRole('button', { name: `${KEY}.addLook` })).toBeEnabled();
  });

  it('imports against the role and the revision it was shown, then reports the change', async () => {
    const onChanged = vi.fn();
    renderPanel({ onChanged });

    fireEvent.click(screen.getByRole('button', { name: `${KEY}.addLook` }));

    await waitFor(() =>
      expect(mocks.bridge.chooseAndImportReference.invoke).toHaveBeenCalledWith({
        projectId: 'project_1',
        briefReferenceRole: 'look',
        expectedRevision: 7,
      })
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  });

  it('treats a cancelled file dialog as a non-event rather than a failure', async () => {
    const onChanged = vi.fn();
    mocks.bridge.chooseAndImportReference.invoke.mockResolvedValue(ok({ status: 'cancelled' }));
    renderPanel({ onChanged });

    fireEvent.click(screen.getByRole('button', { name: `${KEY}.addCast` }));

    await waitFor(() => expect(mocks.bridge.chooseAndImportReference.invoke).toHaveBeenCalledOnce());
    expect(screen.queryByText(`${KEY}.importError`)).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('surfaces a failed import instead of silently doing nothing', async () => {
    mocks.bridge.chooseAndImportReference.invoke.mockResolvedValue({
      ok: false as const,
      error: { messageKey: 'x' },
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: `${KEY}.addCast` }));

    expect(await screen.findByText(`${KEY}.importError`)).toBeVisible();
  });

  it('removes the reference the button names', async () => {
    const onChanged = vi.fn();
    renderPanel({ references: [reference({ assetId: 'asset_striker' })], onChanged });

    fireEvent.click(screen.getByRole('button', { name: `${KEY}.removeAccessible:{"label":"The Striker"}` }));

    await waitFor(() =>
      expect(mocks.bridge.detachBriefReference.invoke).toHaveBeenCalledWith({
        projectId: 'project_1',
        assetId: 'asset_striker',
        expectedRevision: 7,
      })
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  });

  it('stops at the project limit the main process already enforces', () => {
    const full = Array.from({ length: 6 }, (_unused, index) =>
      reference({ assetId: `asset_${index}`, label: `Reference ${index}` })
    );
    renderPanel({ references: full, maxConditioningImages: 6 });

    expect(screen.getByText(`${KEY}.limitReached`)).toBeVisible();
    expect(screen.getByRole('button', { name: `${KEY}.addCast` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `${KEY}.addLook` })).toBeDisabled();
  });

  it('says the engine takes no references at all rather than offering a pointless import', () => {
    renderPanel({ maxConditioningImages: 0 });

    expect(screen.getByText(`${KEY}.engineCapacityNone`)).toBeVisible();
    expect(screen.getByRole('button', { name: `${KEY}.addCast` })).toBeDisabled();
  });

  it('warns when the references already held outnumber what the engine accepts', () => {
    renderPanel({
      references: [reference(), reference({ assetId: 'asset_2', label: 'Second' })],
      maxConditioningImages: 1,
    });

    expect(screen.getByText(`${KEY}.capacityMismatch:{"count":2,"maximum":1}`)).toBeVisible();
  });
});
