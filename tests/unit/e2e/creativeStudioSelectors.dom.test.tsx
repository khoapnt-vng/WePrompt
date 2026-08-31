/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import i18next, { type i18n } from 'i18next';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StudioRendererProjectV2 } from '@/common/types/project/creativeStudioTypes';
import conversation from '@renderer/services/i18n/locales/en-US/conversation.json';

const mocks = vi.hoisted(() => {
  const event = () => ({ on: vi.fn(() => vi.fn()) });
  return {
    bridge: {
      getProject: { invoke: vi.fn() },
      listProposals: { invoke: vi.fn() },
      acceptProposal: { invoke: vi.fn() },
      rejectProposal: { invoke: vi.fn() },
      listReferenceRequests: { invoke: vi.fn() },
      decideReferenceRequest: { invoke: vi.fn() },
      listReferenceGenerationHandoffs: { invoke: vi.fn() },
      getProjectWorkspace: { invoke: vi.fn() },
      getProjectStatus: { invoke: vi.fn() },
      listRoutes: { invoke: vi.fn() },
      getFilmExportCapability: { invoke: vi.fn() },
      getFilmExportStatus: { invoke: vi.fn() },
      listExports: { invoke: vi.fn() },
      hasUnsavedWork: { provider: vi.fn(() => vi.fn()) },
      flushUnsavedWork: { provider: vi.fn(() => vi.fn()) },
      projectUpdated: event(),
      proposalUpdated: event(),
      referenceUpdated: event(),
    },
  };
});

vi.mock('@/common', () => ({ ipcBridge: { creativeStudio: mocks.bridge } }));
vi.mock('@renderer/pages/studio/components/Workspace/DirectorRail', () => ({ DirectorRail: () => null }));

import StudioPage from '@renderer/pages/studio/StudioPage';

const specFile = join(process.cwd(), 'tests/e2e/features/workspaces/creative-studio.e2e.ts');

const studioSpecSelectors = (): string[] => {
  const source = readFileSync(specFile, 'utf8');
  return [...source.matchAll(/const \w+Selector = '([^']*\[data-studio-[^']+)';/g)].map((match) => match[1]!);
};

const project: StudioRendererProjectV2 = {
  schemaVersion: 5,
  revision: 1,
  id: 'project-1',
  name: 'Launch film',
  brief: 'A short launch film.',
  rules: [],
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 18,
  resolution: '720p',
  boardStyle: null,
  beatOrder: [],
  beats: {},
  shots: {},
  referencePlanStatus: 'unplanned',
  referenceOrder: [],
  references: {},
  bin: [],
  bedAssetId: null,
  spendPolicy: null,
  imageRouteId: null,
  videoRouteId: null,
  assets: {},
  jobs: {},
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
};

describe('Creative Studio E2E selectors', () => {
  let i18n: i18n;

  beforeAll(async () => {
    i18n = i18next.createInstance();
    await i18n.init({
      lng: 'en-US',
      fallbackLng: false,
      resources: { 'en-US': { translation: { conversation } } },
      interpolation: { escapeValue: false },
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bridge.listProposals.invoke.mockResolvedValue({
      ok: true,
      data: { projectId: project.id, projectRevision: project.revision, proposals: [] },
    });
    mocks.bridge.listReferenceRequests.invoke.mockResolvedValue({ ok: true, data: [] });
    mocks.bridge.listReferenceGenerationHandoffs.invoke.mockResolvedValue({ ok: true, data: [] });
    mocks.bridge.getProjectWorkspace.invoke.mockResolvedValue({
      ok: true,
      data: {
        status: 'supported',
        snapshot: {
          project,
          workspaceStatus: {
            projectId: project.id,
            projectRevision: project.revision,
            undoTop: null,
            dirtyShots: [],
            boardPanels: [],
            cascadeProgress: [],
            currentVideoJobs: [],
            parkEligibility: [],
          },
          chainStatus: {
            projectId: project.id,
            projectRevision: project.revision,
            conditioningFailures: [],
            boundaries: [],
          },
        },
      },
    });
    mocks.bridge.getProjectStatus.invoke.mockResolvedValue({
      ok: true,
      data: {
        projectId: project.id,
        projectRevision: project.revision,
        catalogVersion: '0123456789abcdef',
        stages: [
          { id: 'brief', state: 'complete', summary: { stage: 'brief', hasBrief: true }, blockers: [] },
          {
            id: 'engines',
            state: 'complete',
            summary: { stage: 'engines', image: 'ready', video: 'ready' },
            blockers: [],
          },
          {
            id: 'references',
            state: 'not_started',
            summary: { stage: 'references', plannedCount: 0, approvedCount: 0 },
            blockers: [],
          },
          {
            id: 'storyboard',
            state: 'not_started',
            summary: {
              stage: 'storyboard',
              beatCount: 0,
              shotCount: 0,
              authoredShotCount: 0,
              plannedSeconds: 0,
              targetSeconds: 18,
            },
            blockers: [],
          },
          {
            id: 'bindings',
            state: 'not_started',
            summary: { stage: 'bindings', readyShotCount: 0, shotCount: 0, maxConditioningImages: 3 },
            blockers: [],
          },
          {
            id: 'production',
            state: 'not_started',
            summary: { stage: 'production', currentTakeCount: 0, shotCount: 0, activeJobCount: 0 },
            blockers: [],
          },
          {
            id: 'cut',
            state: 'not_started',
            summary: {
              stage: 'cut',
              currentTakeCount: 0,
              shotCount: 0,
              durationSeconds: null,
              targetSeconds: 18,
              structurallyPlayable: false,
            },
            blockers: [],
          },
        ],
        blockerCount: 0,
        advisories: [],
        boards: { currentPictureCount: 0, shotCount: 0 },
        detail: { shots: [], references: [] },
      },
    });
    mocks.bridge.listRoutes.invoke.mockResolvedValue({
      ok: true,
      data: {
        image: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        video: { status: 'ready', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
        catalogVersion: 'selector-test',
      },
    });
    mocks.bridge.getFilmExportCapability.invoke.mockResolvedValue({
      ok: true,
      data: { status: 'unavailable', reason: 'ffmpeg_unavailable' },
    });
    mocks.bridge.getFilmExportStatus.invoke.mockResolvedValue({ ok: true, data: { status: 'idle' } });
    mocks.bridge.listExports.invoke.mockResolvedValue({ ok: true, data: { revision: 1, artifacts: [] } });
  });

  it('resolves every stable selector used by the E2E route smoke exactly once', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/studio/project-1/table']}>
          <Routes>
            <Route path='/studio/:id/:view?' element={<StudioPage />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    );

    await screen.findByRole('heading', { level: 1, name: 'Launch film' });
    expect(mocks.bridge.getProjectStatus.invoke).toHaveBeenCalledExactlyOnceWith({
      projectId: project.id,
      detail: true,
    });
    const selectors = studioSpecSelectors();
    expect(selectors).toEqual([
      '[data-studio-workspace]',
      '[data-studio-project-header]',
      '[data-studio-view-navigation]',
      '[data-studio-view]',
    ]);

    await waitFor(() => {
      expect(selectors.filter((selector) => document.querySelectorAll(selector).length !== 1)).toEqual([]);
    });
  });

  it('lands the view hooks on the shared Table, Board, and Cut navigation', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/studio/project-1/table']}>
          <Routes>
            <Route path='/studio/:id/:view?' element={<StudioPage />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    );

    const navigation = await screen.findByRole('navigation', { name: 'Workspace views' });
    expect(navigation).toHaveAttribute('data-studio-view-navigation');
    expect(screen.getByRole('link', { name: 'Table' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Board' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Cut' })).toBeVisible();
    expect(document.querySelector('[data-studio-view="table"]')).not.toBeNull();
  });
});
