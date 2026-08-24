/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STUDIO_RULE_LIMITS,
  type StudioBriefRule,
  type StudioBriefRuleDraft,
} from '@/common/types/project/creativeStudioRules';
import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  type StudioRendererChainStatusV2,
  type StudioRendererProjectV2,
  type StudioRendererWorkspaceStatusV2,
  type StudioRouteCatalogV2,
} from '@/common/types/project/creativeStudioTypes';
import { WorkspaceProjectMenu } from '@/renderer/pages/studio/components/Workspace/Views/WorkspaceProjectMenu';
import type { WorkspaceMutationCallbacks } from '@/renderer/pages/studio/components/Workspace/Views/viewTypes';
import { useWorkspaceDrafts } from '@/renderer/pages/studio/components/Workspace/useWorkspaceDrafts';
import { projectWorkspace } from '@/renderer/pages/studio/components/Workspace/workspaceProjection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values === undefined ? key : `${key}:${JSON.stringify(values)}`,
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}));

const MORE = 'common.more';
const SETTINGS_TITLE = 'conversation.creativeStudio.workspace.controls.settingsTitle';
const BRIEF_RULES_TITLE = 'conversation.creativeStudio.workspace.controls.briefAndRulesTitle';
const NAME = 'conversation.creativeStudio.workspace.controls.name';
const TARGET_DURATION = 'conversation.creativeStudio.workspace.controls.targetDuration';
const ASPECT_RATIO = 'conversation.creativeStudio.workspace.controls.aspectRatio';
const RESOLUTION = 'conversation.creativeStudio.workspace.controls.resolution';
const BRIEF = 'conversation.creativeStudio.workspace.controls.brief';
const IMAGE_ROUTE = 'conversation.creativeStudio.workspace.controls.imageRoute';
const VIDEO_ROUTE = 'conversation.creativeStudio.workspace.controls.videoRoute';
const SPEND_CURRENCY = 'conversation.creativeStudio.workspace.controls.spendCurrency';
const SPEND_CAP = 'conversation.creativeStudio.workspace.controls.spendCap';
const REFRESH_ROUTES = 'conversation.creativeStudio.workspace.controls.refreshRoutes';
const RESET_SETTINGS = 'conversation.creativeStudio.workspace.controls.reset';
const SAVE_SETTINGS = 'conversation.creativeStudio.workspace.controls.saveSettings';
const SAVE_BRIEF = 'conversation.creativeStudio.workspace.controls.saveBrief';
const RULE_TEXT = 'conversation.creativeStudio.rules.textLabel';
const RULE_TERMS = 'conversation.creativeStudio.rules.termsLabel';
const ADD_RULE = 'conversation.creativeStudio.rules.add';
const EDIT_RULE = /^common\.edit:/;
const SAVE_RULE_EDIT = 'common.save';
const REMOVE_RULE = 'conversation.creativeStudio.rules.removeAccessible';

type RuleUpdater = (latestRules: readonly StudioBriefRule[]) => StudioBriefRuleDraft[] | null;

const projectRule = (id: string, text: string, predicate: StudioBriefRule['predicate'] = null): StudioBriefRule => ({
  id,
  scope: 'project',
  text,
  predicate,
  createdAt: '2026-08-21T00:00:00.000Z',
});

const organisationRule = (id: string, text: string): StudioBriefRule => ({
  id,
  scope: 'organisation',
  text,
  predicate: { kind: 'forbidden_terms', terms: ['competitor'] },
  createdAt: '2026-08-21T00:00:00.000Z',
});

const toDraft = ({ id, text, predicate }: StudioBriefRule): StudioBriefRuleDraft => ({
  id,
  text,
  predicate: predicate === null ? null : { kind: 'forbidden_terms', terms: [...predicate.terms] },
});

const makeProject = (
  rules: StudioBriefRule[] = [],
  overrides: Partial<StudioRendererProjectV2> = {}
): StudioRendererProjectV2 =>
  ({
    schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
    revision: 7,
    id: 'project_1',
    name: 'Launch film',
    brief: 'A launch film.',
    rules,
    aspectRatio: '16:9',
    targetDurationSeconds: 12,
    resolution: '720p',
    boardStyle: null,
    beatOrder: [],
    beats: {},
    shots: {},
    referenceOrder: [],
    references: {},
    bin: [],
    bedAssetId: null,
    spendPolicy: null,
    imageRouteId: 'route_image',
    videoRouteId: 'route_video',
    assets: {},
    jobs: {},
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  }) as StudioRendererProjectV2;

const workspaceStatus = (project: StudioRendererProjectV2): StudioRendererWorkspaceStatusV2 => ({
  projectId: project.id,
  projectRevision: project.revision,
  undoTop: null,
  dirtyShots: [],
  boardPanels: [],
  cascadeProgress: [],
  currentVideoJobs: [],
  parkEligibility: [],
});

const chainStatus = (project: StudioRendererProjectV2): StudioRendererChainStatusV2 => ({
  projectId: project.id,
  projectRevision: project.revision,
  conditioningFailures: [],
  boundaries: [],
});

const makeMutations = (
  setRules = vi.fn(async (_updater: RuleUpdater): Promise<boolean> => true)
): {
  callbacks: WorkspaceMutationCallbacks;
  editProject: ReturnType<typeof vi.fn>;
  applyAuthoring: ReturnType<typeof vi.fn>;
  refreshRoutes: ReturnType<typeof vi.fn>;
  acknowledgeRuleAdoption: ReturnType<typeof vi.fn>;
  setRules: typeof setRules;
} => {
  const editProject = vi.fn(async () => true);
  const applyAuthoring = vi.fn(async () => true);
  const refreshRoutes = vi.fn(async () => true);
  const acknowledgeRuleAdoption = vi.fn();
  return {
    callbacks: {
      editProject,
      applyAuthoring,
      setRules,
      acknowledgeRuleAdoption,
      refreshRoutes,
      undo: vi.fn(async () => true),
      retryConditioning: vi.fn(async () => true),
      cancelWaiting: vi.fn(async () => true),
      chooseCascadeAsset: vi.fn(async () => true),
    } as unknown as WorkspaceMutationCallbacks,
    editProject,
    applyAuthoring,
    refreshRoutes,
    acknowledgeRuleAdoption,
    setRules,
  };
};

const readyRouteCatalog = {
  image: {
    status: 'ready',
    selected: null,
    selectedRoute: null,
    selectionIssue: null,
    options: [
      {
        choiceId: 'route_image',
        providerId: 'provider_image',
        providerName: 'Image provider',
        model: 'image-model',
      },
    ],
  },
  video: {
    status: 'ready',
    selected: null,
    selectedRoute: null,
    selectionIssue: null,
    options: [
      {
        choiceId: 'route_video',
        providerId: 'provider_video',
        providerName: 'Video provider',
        model: 'video-model',
      },
    ],
  },
  catalogVersion: 'catalog_1',
} as StudioRouteCatalogV2;

type MenuHarnessProps = {
  project?: StudioRendererProjectV2;
  pending?: boolean;
  errorMessageKey?: string | null;
  organisationRules?: readonly StudioBriefRule[];
  requestShapeLocked?: boolean;
  routeCatalog?: StudioRouteCatalogV2 | null;
  staleRevision?: boolean;
  onRuleDraftDirtyCountChange?: (count: number) => void;
  mutations: WorkspaceMutationCallbacks;
};

const MenuHarness: React.FC<MenuHarnessProps> = ({
  project = makeProject(),
  pending = false,
  errorMessageKey = null,
  organisationRules = [],
  requestShapeLocked,
  routeCatalog = null,
  staleRevision,
  onRuleDraftDirtyCountChange,
  mutations,
}) => {
  const projected = projectWorkspace(project, workspaceStatus(project), chainStatus(project));
  const projection = requestShapeLocked === undefined ? projected : { ...projected, requestShapeLocked };
  const drafts = useWorkspaceDrafts({
    projectId: project.id,
    projectRevision: project.revision,
    canonicalValues: {
      'settings.name': project.name,
      'settings.targetDurationSeconds': project.targetDurationSeconds,
      'settings.aspectRatio': project.aspectRatio,
      'settings.resolution': project.resolution,
      'brief.text': project.brief,
      'brief.imageRouteId': project.imageRouteId ?? '',
      'brief.videoRouteId': project.videoRouteId ?? '',
      'brief.spendCurrency': project.spendPolicy?.currency ?? '',
      'brief.spendMajorUnits': project.spendPolicy === null ? '' : '10.00',
    },
    activeBeatIds: projection.activeBeatIds,
    activeShotIds: projection.activeShotIds,
  });

  return (
    <WorkspaceProjectMenu
      project={project}
      projection={projection}
      routeCatalog={routeCatalog}
      drafts={staleRevision === undefined ? drafts : { ...drafts, staleRevision }}
      pending={pending}
      errorMessageKey={errorMessageKey}
      mutations={mutations}
      onRuleDraftDirtyCountChange={onRuleDraftDirtyCountChange}
      organisationRules={organisationRules}
    />
  );
};

const openMenu = async (): Promise<HTMLElement> => {
  fireEvent.click(screen.getByRole('button', { name: MORE }));
  return screen.findByRole('menu');
};

const openSettings = async (): Promise<HTMLElement> => {
  const menu = await openMenu();
  fireEvent.click(within(menu).getByRole('menuitem', { name: SETTINGS_TITLE }));
  return screen.findByRole('dialog', { name: SETTINGS_TITLE });
};

const openBriefAndRules = async (): Promise<HTMLElement> => {
  const menu = await openMenu();
  fireEvent.click(within(menu).getByRole('menuitem', { name: BRIEF_RULES_TITLE }));
  return screen.findByRole('dialog', { name: BRIEF_RULES_TITLE });
};

const namedLike = (key: string): RegExp => new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

const capturedUpdater = (setRules: ReturnType<typeof vi.fn>): RuleUpdater => {
  expect(setRules).toHaveBeenCalledTimes(1);
  const updater = setRules.mock.calls[0]?.[0];
  expect(updater).toBeTypeOf('function');
  return updater as RuleUpdater;
};

const projectRuleCard = (ruleId: string): HTMLElement => {
  const card = document.querySelector<HTMLElement>(`[data-studio-project-rule="${ruleId}"]`);
  expect(card).not.toBeNull();
  return card!;
};

const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

describe('WorkspaceProjectMenu', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('opens a named More menu with separate settings and Brief actions', async () => {
    const { callbacks } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);

    const trigger = screen.getByRole('button', { name: MORE });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    const menu = await openMenu();
    expect(within(menu).getByRole('menuitem', { name: SETTINGS_TITLE })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: BRIEF_RULES_TITLE })).toBeInTheDocument();
  });

  it('keeps project settings out of the workspace until its modal opens', async () => {
    const { callbacks } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);

    expect(screen.queryByLabelText(NAME)).not.toBeInTheDocument();
    const dialog = await openSettings();
    expect(within(dialog).getByLabelText(NAME)).toHaveValue('Launch film');
    expect(within(dialog).getByRole('combobox', { name: ASPECT_RATIO })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: RESOLUTION })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(BRIEF)).not.toBeInTheDocument();
  });

  it('keeps the Brief and rule editor out of the workspace until their modal opens', async () => {
    const { callbacks } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);

    expect(screen.queryByLabelText(BRIEF)).not.toBeInTheDocument();
    const dialog = await openBriefAndRules();
    expect(within(dialog).getByLabelText(BRIEF)).toHaveValue('A launch film.');
    expect(within(dialog).queryByLabelText(NAME)).not.toBeInTheDocument();
  });

  it('surfaces authoritative errors, blocks stale saves, and restores trigger focus on close', async () => {
    const { callbacks } = makeMutations();
    render(
      <MenuHarness
        mutations={callbacks}
        errorMessageKey='conversation.creativeStudio.workspace.errors.storage'
        staleRevision
      />
    );
    const trigger = screen.getByRole('button', { name: MORE });
    const settings = await openSettings();

    expect(within(settings).getByText('conversation.creativeStudio.workspace.errors.storage')).toBeInTheDocument();
    expect(
      within(settings).getByText('conversation.creativeStudio.workspace.controls.draftConflict')
    ).toBeInTheDocument();
    expect(within(settings).getByRole('button', { name: SAVE_SETTINGS })).toBeDisabled();

    fireEvent.click(within(settings).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: SETTINGS_TITLE })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());

    const brief = await openBriefAndRules();
    expect(within(brief).getByText('conversation.creativeStudio.workspace.errors.storage')).toBeInTheDocument();
    expect(within(brief).getByText('conversation.creativeStudio.workspace.controls.draftConflict')).toBeInTheDocument();
    expect(within(brief).getByRole('button', { name: SAVE_BRIEF })).toBeDisabled();
  });

  it('preserves the project-settings mutation boundary after moving the form', async () => {
    const { callbacks, editProject } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openSettings();

    fireEvent.change(within(dialog).getByLabelText(NAME), { target: { value: 'Retitled film' } });
    fireEvent.click(within(dialog).getByRole('button', { name: SAVE_SETTINGS }));

    await waitFor(() => expect(editProject).toHaveBeenCalledTimes(1));
    expect(editProject).toHaveBeenCalledWith({ name: 'Retitled film' });
  });

  it('resets every project-setting draft without issuing a mutation', async () => {
    const { callbacks, editProject } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openSettings();

    fireEvent.change(within(dialog).getByLabelText(NAME), { target: { value: 'Unsaved title' } });
    fireEvent.change(within(dialog).getByLabelText(TARGET_DURATION), { target: { value: '30' } });
    fireEvent.click(within(dialog).getByRole('button', { name: RESET_SETTINGS }));

    expect(within(dialog).getByLabelText(NAME)).toHaveValue('Launch film');
    expect(within(dialog).getByLabelText(TARGET_DURATION)).toHaveValue('12');
    expect(editProject).not.toHaveBeenCalled();
  });

  it('normalizes an unchanged settings save as a local no-op and resets the draft', async () => {
    const { callbacks, editProject } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openSettings();

    fireEvent.change(within(dialog).getByLabelText(NAME), { target: { value: ' Launch film ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: SAVE_SETTINGS }));

    expect(editProject).not.toHaveBeenCalled();
    await waitFor(() => expect(within(dialog).getByLabelText(NAME)).toHaveValue('Launch film'));
  });

  it('keeps request-shape fields locked while name edits remain saveable', async () => {
    const { callbacks, editProject } = makeMutations();
    render(<MenuHarness mutations={callbacks} requestShapeLocked />);
    const dialog = await openSettings();

    expect(
      within(dialog).getByText('conversation.creativeStudio.workspace.controls.requestShapeLocked')
    ).toBeInTheDocument();
    expect(within(within(dialog).getByText(ASPECT_RATIO).closest('label')!).getByRole('combobox')).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(within(within(dialog).getByText(RESOLUTION).closest('label')!).getByRole('combobox')).toHaveAttribute(
      'aria-disabled',
      'true'
    );

    fireEvent.change(within(dialog).getByLabelText(NAME), { target: { value: 'Safe rename' } });
    fireEvent.click(within(dialog).getByRole('button', { name: SAVE_SETTINGS }));
    await waitFor(() => expect(editProject).toHaveBeenCalledWith({ name: 'Safe rename' }));
  });

  it('preserves settings input when the settings mutation fails', async () => {
    const { callbacks } = makeMutations();
    const editProject = vi.fn(async () => false);
    callbacks.editProject = editProject;
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openSettings();

    fireEvent.change(within(dialog).getByLabelText(NAME), { target: { value: 'Retry this title' } });
    fireEvent.click(within(dialog).getByRole('button', { name: SAVE_SETTINGS }));
    await waitFor(() => expect(editProject).toHaveBeenCalledTimes(1));

    expect(within(dialog).getByLabelText(NAME)).toHaveValue('Retry this title');
  });

  it('preserves the narrow Brief mutation after moving the form', async () => {
    const { callbacks, applyAuthoring } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openBriefAndRules();

    fireEvent.change(within(dialog).getByLabelText(BRIEF), { target: { value: 'A revised launch film.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: SAVE_BRIEF }));

    await waitFor(() => expect(applyAuthoring).toHaveBeenCalledTimes(1));
    expect(applyAuthoring).toHaveBeenCalledWith([{ kind: 'set_brief', brief: 'A revised launch film.' }]);
  });

  it('treats an unchanged Brief save as a local no-op', async () => {
    const { callbacks, applyAuthoring } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openBriefAndRules();

    fireEvent.click(within(dialog).getByRole('button', { name: SAVE_BRIEF }));

    expect(applyAuthoring).not.toHaveBeenCalled();
  });

  it('saves a valid human spend cap in exact minor units', async () => {
    const { callbacks, applyAuthoring } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openBriefAndRules();

    fireEvent.change(within(dialog).getByLabelText(SPEND_CURRENCY), { target: { value: 'usd' } });
    fireEvent.change(within(dialog).getByLabelText(SPEND_CAP), { target: { value: '12.34' } });
    fireEvent.click(within(dialog).getByRole('button', { name: SAVE_BRIEF }));

    await waitFor(() => expect(applyAuthoring).toHaveBeenCalledTimes(1));
    expect(applyAuthoring).toHaveBeenCalledWith([
      { kind: 'set_spend_policy', policy: { currency: 'USD', maxPerBatchMinorUnits: 1_234 } },
    ]);
  });

  it.each([
    ['an invalid amount', 'USD', '-1'],
    ['an invalid currency', 'US', '1.00'],
  ])('rejects %s without issuing a Brief mutation', async (_case, currency, cap) => {
    const { callbacks, applyAuthoring } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openBriefAndRules();

    fireEvent.change(within(dialog).getByLabelText(SPEND_CURRENCY), { target: { value: currency } });
    fireEvent.change(within(dialog).getByLabelText(SPEND_CAP), { target: { value: cap } });
    fireEvent.click(within(dialog).getByRole('button', { name: SAVE_BRIEF }));

    expect(screen.getByText('conversation.creativeStudio.workspace.controls.invalidSpendPolicy')).toBeInTheDocument();
    expect(applyAuthoring).not.toHaveBeenCalled();
  });

  it('clears an existing spend policy through the Brief mutation boundary', async () => {
    const project = makeProject([], {
      spendPolicy: { currency: 'USD', maxPerBatchMinorUnits: 1_000 },
    });
    const { callbacks, applyAuthoring } = makeMutations();
    render(<MenuHarness project={project} mutations={callbacks} />);
    const dialog = await openBriefAndRules();

    fireEvent.change(within(dialog).getByLabelText(SPEND_CAP), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: SAVE_BRIEF }));

    await waitFor(() => expect(applyAuthoring).toHaveBeenCalledTimes(1));
    expect(applyAuthoring).toHaveBeenCalledWith([{ kind: 'set_spend_policy', policy: null }]);
  });

  it('preserves Brief input when its mutation fails', async () => {
    const { callbacks } = makeMutations();
    const applyAuthoring = vi.fn(async () => false);
    callbacks.applyAuthoring = applyAuthoring;
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openBriefAndRules();

    fireEvent.change(within(dialog).getByLabelText(BRIEF), { target: { value: 'Retry this Brief.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: SAVE_BRIEF }));
    await waitFor(() => expect(applyAuthoring).toHaveBeenCalledTimes(1));

    expect(within(dialog).getByLabelText(BRIEF)).toHaveValue('Retry this Brief.');
  });

  it('shows ready route choices and refreshes them without saving the Brief', async () => {
    const { callbacks, applyAuthoring, refreshRoutes } = makeMutations();
    render(<MenuHarness mutations={callbacks} routeCatalog={readyRouteCatalog} />);
    const dialog = await openBriefAndRules();

    expect(
      within(dialog).getAllByText('conversation.creativeStudio.workspace.controls.routeStatus.ready')
    ).toHaveLength(2);
    expect(within(dialog).getByRole('combobox', { name: IMAGE_ROUTE })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: VIDEO_ROUTE })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: REFRESH_ROUTES }));

    expect(refreshRoutes).toHaveBeenCalledTimes(1);
    expect(applyAuthoring).not.toHaveBeenCalled();
  });

  it('renders structured project controls and an injected locked organisation row', async () => {
    const { callbacks } = makeMutations();
    render(
      <MenuHarness
        project={makeProject([projectRule('rule_project', 'Keep the kits generic.')])}
        organisationRules={[organisationRule('rule_org', 'No competitor brands.')]}
        mutations={callbacks}
      />
    );
    await openBriefAndRules();

    const card = projectRuleCard('rule_project');
    const projectEdit = within(card).getByRole('button', { name: EDIT_RULE });
    const projectRemove = within(card).getByRole('button', { name: namedLike(REMOVE_RULE) });
    expect(screen.getByText('conversation.creativeStudio.rules.scope.organisationLocked')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: EDIT_RULE })).toEqual([projectEdit]);
    expect(screen.getAllByRole('button', { name: namedLike(REMOVE_RULE) })).toEqual([projectRemove]);
  });

  it('never exposes the old raw JSON document or its copy', async () => {
    const { callbacks } = makeMutations();
    render(
      <MenuHarness project={makeProject([projectRule('rule_1', 'Keep the kits generic.')])} mutations={callbacks} />
    );
    await openBriefAndRules();

    const oldJsonLabel = 'conversation.creativeStudio.workspace.controls.rules';
    expect(screen.queryByLabelText(oldJsonLabel)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(oldJsonLabel);
    expect(screen.queryByDisplayValue(/^\s*\[/)).not.toBeInTheDocument();
  });

  it('adds a human-authored rule to the newest authoritative list', async () => {
    const existing = projectRule('rule_existing', 'Keep the kits generic.');
    const concurrent = projectRule('rule_concurrent', 'Preserve the new Director rule.');
    const { callbacks, setRules } = makeMutations();
    render(<MenuHarness project={makeProject([existing])} mutations={callbacks} />);
    const dialog = await openBriefAndRules();

    fireEvent.change(within(dialog).getByLabelText(RULE_TEXT), { target: { value: 'No competitor logos.' } });
    fireEvent.change(within(dialog).getByLabelText(RULE_TERMS), { target: { value: 'Acme, Globex' } });
    fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));

    await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));
    const updated = capturedUpdater(setRules)([existing, concurrent])!;
    const mintedId = updated.at(-1)!.id;
    expect(mintedId).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    expect(mintedId).not.toContain('-');
    expect(updated).toEqual([
      toDraft(existing),
      toDraft(concurrent),
      {
        id: mintedId,
        text: 'No competitor logos.',
        predicate: { kind: 'forbidden_terms', terms: ['Acme', 'Globex'] },
      },
    ]);
  });

  it('refuses an add updater when the authoritative list reaches its cap or claims the minted ID', async () => {
    const { callbacks, setRules } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openBriefAndRules();

    fireEvent.change(within(dialog).getByLabelText(RULE_TEXT), { target: { value: 'Keep this rule.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));

    await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));
    const updater = capturedUpdater(setRules);
    const accepted = updater([])!;
    const mintedId = accepted[0]!.id;
    expect(mintedId).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    expect(mintedId).not.toContain('-');

    const newlyFullList = Array.from({ length: STUDIO_RULE_LIMITS.maxRules }, (_, index) =>
      projectRule(`latest_${index}`, `Latest rule ${index}.`)
    );
    expect(updater(newlyFullList)).toBeNull();
    expect(updater([projectRule(mintedId, 'A concurrent writer claimed this ID.')])).toBeNull();
  });

  it('rejects an add when UUID normalization collides on every mint attempt', async () => {
    const existing = projectRule('rule_existing', 'Keep the kits generic.');
    const randomUuid = vi
      .spyOn(window.crypto, 'randomUUID')
      .mockReturnValue('rule-existing' as ReturnType<Crypto['randomUUID']>);
    const { callbacks, setRules } = makeMutations();

    try {
      render(<MenuHarness project={makeProject([existing])} mutations={callbacks} />);
      const dialog = await openBriefAndRules();
      fireEvent.change(within(dialog).getByLabelText(RULE_TEXT), { target: { value: 'Keep this rule.' } });
      fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));

      expect(randomUuid).toHaveBeenCalledTimes(4);
      expect(within(dialog).getByRole('alert')).toHaveTextContent('conversation.creativeStudio.rules.invalidText');
      expect(setRules).not.toHaveBeenCalled();
    } finally {
      randomUuid.mockRestore();
    }
  });

  it('clears an added rule only after the authoritative mutation reports success', async () => {
    const save = deferred<boolean>();
    let adopted: StudioBriefRuleDraft[] | null | undefined;
    const setRules = vi.fn(async (updater: RuleUpdater): Promise<boolean> => {
      adopted = updater([]);
      return save.promise;
    });
    const { callbacks } = makeMutations(setRules);
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openBriefAndRules();
    const text = within(dialog).getByLabelText(RULE_TEXT);
    const terms = within(dialog).getByLabelText(RULE_TERMS);

    fireEvent.change(text, { target: { value: 'No competitor logos.' } });
    fireEvent.change(terms, { target: { value: 'Acme' } });
    fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));

    await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));
    expect(adopted).toHaveLength(1);
    expect(text).toHaveValue('No competitor logos.');
    expect(terms).toHaveValue('Acme');

    save.resolve(true);
    await waitFor(() => expect(text).toHaveValue(''));
    expect(terms).toHaveValue('');
  });

  it('preserves newer add-rule input when an earlier successful mutation finishes', async () => {
    const save = deferred<boolean>();
    let settled = false;
    const setRules = vi.fn(async (updater: RuleUpdater): Promise<boolean> => {
      expect(updater([])).not.toBeNull();
      const result = await save.promise;
      settled = true;
      return result;
    });
    const { callbacks } = makeMutations(setRules);
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openBriefAndRules();
    const text = within(dialog).getByLabelText(RULE_TEXT);
    const terms = within(dialog).getByLabelText(RULE_TERMS);

    fireEvent.change(text, { target: { value: 'First submitted rule.' } });
    fireEvent.change(terms, { target: { value: 'Acme' } });
    fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));
    await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));

    fireEvent.change(text, { target: { value: 'Newer unsaved rule.' } });
    fireEvent.change(terms, { target: { value: 'Globex' } });
    save.resolve(true);

    await waitFor(() => expect(settled).toBe(true));
    expect(text).toHaveValue('Newer unsaved rule.');
    expect(terms).toHaveValue('Globex');
  });

  it('reuses an ambiguous add ID and recognizes an already-adopted retry', async () => {
    const randomUuid = vi
      .spyOn(window.crypto, 'randomUUID')
      .mockReturnValue('11111111-2222-4333-8444-555555555555' as ReturnType<Crypto['randomUUID']>);
    let adopted: StudioBriefRuleDraft[] | null = null;
    const setRules = vi.fn(async (updater: RuleUpdater): Promise<boolean> => {
      if (adopted === null) {
        adopted = updater([]);
        return false;
      }
      const authoritative = adopted.map((rule) => projectRule(rule.id, rule.text, rule.predicate));
      expect(updater(authoritative)).toEqual(adopted);
      return true;
    });
    const { callbacks } = makeMutations(setRules);

    try {
      render(<MenuHarness mutations={callbacks} />);
      const dialog = await openBriefAndRules();
      const text = within(dialog).getByLabelText(RULE_TEXT);
      fireEvent.change(text, { target: { value: 'Keep this retry idempotent.' } });

      fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));
      await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));
      expect(text).toHaveValue('Keep this retry idempotent.');

      fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));
      await waitFor(() => expect(setRules).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(text).toHaveValue(''));
      expect(randomUuid).toHaveBeenCalledTimes(1);
      expect(adopted?.[0]?.id).toBe('11111111_2222_4333_8444_555555555555');
    } finally {
      randomUuid.mockRestore();
    }
  });

  it('reuses an ambiguous add ID after a same-project remount', async () => {
    const randomUuid = vi
      .spyOn(window.crypto, 'randomUUID')
      .mockReturnValue('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' as ReturnType<Crypto['randomUUID']>);
    let adopted: StudioBriefRuleDraft[] | null = null;
    const setRules = vi.fn(async (updater: RuleUpdater): Promise<boolean> => {
      if (adopted === null) {
        adopted = updater([]);
        return false;
      }
      const authoritative = adopted.map((rule) => projectRule(rule.id, rule.text, rule.predicate));
      expect(updater(authoritative)).toEqual(adopted);
      return true;
    });
    const { callbacks } = makeMutations(setRules);

    try {
      const first = render(<MenuHarness mutations={callbacks} />);
      let dialog = await openBriefAndRules();
      fireEvent.change(within(dialog).getByLabelText(RULE_TEXT), {
        target: { value: 'Retry this persisted attempt once.' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));
      await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(window.sessionStorage.getItem('aionui:creative-studio:v2:rule-drafts:project_1')).toContain(
          'aaaaaaaa_bbbb_4ccc_8ddd_eeeeeeeeeeee'
        )
      );
      first.unmount();

      render(<MenuHarness mutations={callbacks} />);
      dialog = await openBriefAndRules();
      expect(within(dialog).getByLabelText(RULE_TEXT)).toHaveValue('Retry this persisted attempt once.');
      fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));

      await waitFor(() => expect(setRules).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(within(dialog).getByLabelText(RULE_TEXT)).toHaveValue(''));
      expect(randomUuid).toHaveBeenCalledTimes(1);
    } finally {
      randomUuid.mockRestore();
    }
  });

  it('clears an ambiguously adopted add when it fills the final rule slot', async () => {
    const existing = Array.from({ length: STUDIO_RULE_LIMITS.maxRules - 1 }, (_, index) =>
      projectRule(`rule_${index}`, `Existing rule ${index}.`)
    );
    let adopted: StudioBriefRuleDraft[] | null = null;
    const setRules = vi.fn(async (updater: RuleUpdater): Promise<boolean> => {
      adopted = updater(existing);
      return false;
    });
    const { callbacks, acknowledgeRuleAdoption } = makeMutations(setRules);
    const { rerender } = render(<MenuHarness project={makeProject(existing)} mutations={callbacks} />);
    const dialog = await openBriefAndRules();
    const text = within(dialog).getByLabelText(RULE_TEXT);
    fireEvent.change(text, { target: { value: 'Fill the final slot once.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));

    await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));
    expect(adopted).toHaveLength(STUDIO_RULE_LIMITS.maxRules);
    expect(text).toHaveValue('Fill the final slot once.');

    const authoritative = adopted!.map((rule) => projectRule(rule.id, rule.text, rule.predicate));
    rerender(<MenuHarness project={makeProject(authoritative, { revision: 8 })} mutations={callbacks} />);

    await waitFor(() => expect(text).toHaveValue(''));
    expect(within(dialog).getByRole('button', { name: ADD_RULE })).toBeDisabled();
    expect(setRules).toHaveBeenCalledTimes(1);
    expect(acknowledgeRuleAdoption).toHaveBeenCalledTimes(1);
  });

  it('rebases a project-rule edit but refuses a changed or disappeared base', async () => {
    const existing = projectRule('rule_existing', 'Keep the kits generic.');
    const concurrent = projectRule('rule_concurrent', 'Preserve the new Director rule.');
    const { callbacks, setRules } = makeMutations();
    render(<MenuHarness project={makeProject([existing])} mutations={callbacks} />);
    await openBriefAndRules();

    const card = projectRuleCard(existing.id);
    fireEvent.click(within(card).getByRole('button', { name: EDIT_RULE }));
    expect(within(card).getByDisplayValue(existing.text)).toHaveFocus();
    fireEvent.change(within(card).getByDisplayValue(existing.text), {
      target: { value: 'Keep every kit generic.' },
    });
    fireEvent.click(within(card).getByRole('button', { name: SAVE_RULE_EDIT }));

    await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));
    const updater = capturedUpdater(setRules);
    expect(updater([existing, concurrent])).toEqual([
      { ...toDraft(existing), text: 'Keep every kit generic.' },
      toDraft(concurrent),
    ]);
    expect(updater([projectRule(existing.id, 'Changed elsewhere.'), concurrent])).toBeNull();
    expect(updater([concurrent])).toBeNull();
    await waitFor(() => expect(within(card).getByRole('button', { name: EDIT_RULE })).toHaveFocus());
  });

  it('closes a semantically unchanged project-rule edit without issuing a mutation', async () => {
    const existing = projectRule('rule_existing', 'Keep the kits generic.');
    const { callbacks, setRules } = makeMutations();
    render(<MenuHarness project={makeProject([existing])} mutations={callbacks} />);
    await openBriefAndRules();

    const card = projectRuleCard(existing.id);
    fireEvent.click(within(card).getByRole('button', { name: EDIT_RULE }));
    fireEvent.change(within(card).getByDisplayValue(existing.text), {
      target: { value: `  ${existing.text}  ` },
    });
    fireEvent.click(within(card).getByRole('button', { name: SAVE_RULE_EDIT }));

    await waitFor(() => expect(within(card).queryByRole('button', { name: SAVE_RULE_EDIT })).not.toBeInTheDocument());
    expect(setRules).not.toHaveBeenCalled();
    expect(within(card).getByRole('button', { name: EDIT_RULE })).toHaveFocus();
  });

  it('keeps delimiter-bearing authoritative terms lossless through an unchanged edit', async () => {
    const existing = projectRule('rule_existing', 'Keep the palette exact.', {
      kind: 'forbidden_terms',
      terms: ['red, white and blue', 'line one\nline two'],
    });
    const { callbacks, setRules } = makeMutations();
    render(<MenuHarness project={makeProject([existing])} mutations={callbacks} />);
    await openBriefAndRules();

    const card = projectRuleCard(existing.id);
    fireEvent.click(within(card).getByRole('button', { name: EDIT_RULE }));
    expect(within(card).getByText('red, white and blue')).toBeInTheDocument();
    expect(
      [...card.querySelectorAll<HTMLElement>('[title]')].some(
        (element) => element.getAttribute('title') === 'line one\nline two'
      )
    ).toBe(true);
    fireEvent.click(within(card).getByRole('button', { name: SAVE_RULE_EDIT }));

    await waitFor(() => expect(within(card).getByRole('button', { name: EDIT_RULE })).toHaveFocus());
    expect(setRules).not.toHaveBeenCalled();
    expect(within(card).getByText('red, white and blue, line one line two')).toBeInTheDocument();
  });

  it('commits a typed edit term once before saving the rule', async () => {
    const existing = projectRule('rule_existing', 'Keep the palette exact.');
    const { callbacks, setRules } = makeMutations();
    render(<MenuHarness project={makeProject([existing])} mutations={callbacks} />);
    await openBriefAndRules();

    const card = projectRuleCard(existing.id);
    fireEvent.click(within(card).getByRole('button', { name: EDIT_RULE }));
    const termsInput = within(card).getByRole('textbox', { name: RULE_TERMS });
    fireEvent.change(termsInput, { target: { value: 'Acme' } });
    fireEvent.keyDown(termsInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => expect(within(card).getByText('Acme')).toBeInTheDocument());
    fireEvent.click(within(card).getByRole('button', { name: SAVE_RULE_EDIT }));

    await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));
    expect(capturedUpdater(setRules)([existing])).toEqual([
      { ...toDraft(existing), predicate: { kind: 'forbidden_terms', terms: ['Acme'] } },
    ]);
  });

  it('recognizes an ambiguously adopted edit and restores focus without a second mutation', async () => {
    const existing = projectRule('rule_existing', 'Keep the kits generic.');
    let intended: StudioBriefRuleDraft[] | null = null;
    const setRules = vi.fn(async (updater: RuleUpdater): Promise<boolean> => {
      intended = updater([existing]);
      return false;
    });
    const { callbacks, acknowledgeRuleAdoption } = makeMutations(setRules);
    const { rerender } = render(<MenuHarness project={makeProject([existing])} mutations={callbacks} />);
    await openBriefAndRules();

    const card = projectRuleCard(existing.id);
    fireEvent.click(within(card).getByRole('button', { name: EDIT_RULE }));
    fireEvent.change(within(card).getByDisplayValue(existing.text), {
      target: { value: 'Keep every kit generic.' },
    });
    fireEvent.click(within(card).getByRole('button', { name: SAVE_RULE_EDIT }));
    await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));
    const adopted = projectRule(existing.id, 'Keep every kit generic.');
    expect(capturedUpdater(setRules)([adopted])).toEqual([toDraft(adopted)]);

    rerender(<MenuHarness project={makeProject([adopted], { revision: 8 })} pending mutations={callbacks} />);

    await waitFor(() =>
      expect(within(projectRuleCard(existing.id)).getByRole('button', { name: SAVE_RULE_EDIT })).toBeDisabled()
    );
    expect(within(projectRuleCard(existing.id)).queryByRole('button', { name: EDIT_RULE })).not.toBeInTheDocument();
    rerender(<MenuHarness project={makeProject([adopted], { revision: 8 })} mutations={callbacks} />);

    await waitFor(() =>
      expect(within(projectRuleCard(existing.id)).getByRole('button', { name: EDIT_RULE })).toHaveFocus()
    );
    expect(intended).toEqual([toDraft(adopted)]);
    expect(setRules).toHaveBeenCalledTimes(1);
    expect(acknowledgeRuleAdoption).toHaveBeenCalledTimes(1);
  });

  it('keeps an invalid project-rule edit open without issuing a mutation', async () => {
    const existing = projectRule('rule_existing', 'Keep the kits generic.');
    const { callbacks, setRules } = makeMutations();
    render(<MenuHarness project={makeProject([existing])} mutations={callbacks} />);
    await openBriefAndRules();

    const card = projectRuleCard(existing.id);
    fireEvent.click(within(card).getByRole('button', { name: EDIT_RULE }));
    fireEvent.change(within(card).getByDisplayValue(existing.text), { target: { value: ' ' } });
    fireEvent.click(within(card).getByRole('button', { name: SAVE_RULE_EDIT }));

    expect(within(card).getByRole('alert')).toHaveTextContent('conversation.creativeStudio.rules.invalidText');
    expect(within(card).getByLabelText(RULE_TEXT)).toHaveAttribute('aria-invalid', 'true');
    expect(setRules).not.toHaveBeenCalled();
  });

  it('cancels a local project-rule edit without issuing a mutation', async () => {
    const existing = projectRule('rule_existing', 'Keep the kits generic.');
    const { callbacks, setRules } = makeMutations();
    render(<MenuHarness project={makeProject([existing])} mutations={callbacks} />);
    await openBriefAndRules();

    const card = projectRuleCard(existing.id);
    fireEvent.click(within(card).getByRole('button', { name: EDIT_RULE }));
    fireEvent.change(within(card).getByDisplayValue(existing.text), { target: { value: 'Discard this edit.' } });
    fireEvent.click(within(card).getByRole('button', { name: 'common.cancel' }));

    expect(within(card).getByText(existing.text)).toBeInTheDocument();
    expect(within(card).queryByDisplayValue('Discard this edit.')).not.toBeInTheDocument();
    expect(setRules).not.toHaveBeenCalled();
    expect(within(card).getByRole('button', { name: EDIT_RULE })).toHaveFocus();
  });

  it('preserves a newer project-rule edit when an earlier save finishes', async () => {
    const existing = projectRule('rule_existing', 'Keep the kits generic.');
    const save = deferred<boolean>();
    let settled = false;
    const firstAdopted = projectRule(existing.id, 'First submitted edit.');
    const setRules = vi.fn(async (updater: RuleUpdater): Promise<boolean> => {
      if (setRules.mock.calls.length === 1) {
        expect(updater([existing])).toEqual([toDraft(firstAdopted)]);
        const result = await save.promise;
        settled = true;
        return result;
      }
      expect(updater([firstAdopted])).toEqual([{ ...toDraft(firstAdopted), text: 'Newer unsaved edit.' }]);
      return true;
    });
    const { callbacks } = makeMutations(setRules);
    render(<MenuHarness project={makeProject([existing])} mutations={callbacks} />);
    await openBriefAndRules();

    const card = projectRuleCard(existing.id);
    fireEvent.click(within(card).getByRole('button', { name: EDIT_RULE }));
    const text = within(card).getByDisplayValue(existing.text);
    fireEvent.change(text, { target: { value: 'First submitted edit.' } });
    fireEvent.click(within(card).getByRole('button', { name: SAVE_RULE_EDIT }));
    fireEvent.change(text, { target: { value: 'Newer unsaved edit.' } });
    save.resolve(true);

    await waitFor(() => expect(settled).toBe(true));
    expect(within(card).getByDisplayValue('Newer unsaved edit.')).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: SAVE_RULE_EDIT }));
    await waitFor(() => expect(setRules).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(card).getByRole('button', { name: EDIT_RULE })).toHaveFocus());
  });

  it('keeps a project-rule edit open when its mutation fails', async () => {
    const existing = projectRule('rule_existing', 'Keep the kits generic.');
    const setRules = vi.fn(async (_updater: RuleUpdater): Promise<boolean> => false);
    const { callbacks } = makeMutations(setRules);
    render(<MenuHarness project={makeProject([existing])} mutations={callbacks} />);
    await openBriefAndRules();

    const card = projectRuleCard(existing.id);
    fireEvent.click(within(card).getByRole('button', { name: EDIT_RULE }));
    fireEvent.change(within(card).getByDisplayValue(existing.text), {
      target: { value: 'Retry this edit.' },
    });
    fireEvent.click(within(card).getByRole('button', { name: SAVE_RULE_EDIT }));

    await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));
    expect(within(card).getByDisplayValue('Retry this edit.')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: SAVE_RULE_EDIT })).toBeInTheDocument();
  });

  it('retains an unsaved rule editor when authority deletes its card', async () => {
    const existing = projectRule('rule_existing', 'Keep the kits generic.');
    const setRules = vi.fn(async (updater: RuleUpdater): Promise<boolean> => {
      expect(updater([])).toBeNull();
      return false;
    });
    const { callbacks } = makeMutations(setRules);
    const { rerender } = render(<MenuHarness project={makeProject([existing])} mutations={callbacks} />);
    await openBriefAndRules();

    const card = projectRuleCard(existing.id);
    fireEvent.click(within(card).getByRole('button', { name: EDIT_RULE }));
    const text = within(card).getByDisplayValue(existing.text);
    expect(text).toHaveFocus();
    fireEvent.change(text, { target: { value: 'Preserve this unsaved external-deletion edit.' } });

    rerender(<MenuHarness project={makeProject([], { revision: 8 })} mutations={callbacks} />);
    expect(
      within(projectRuleCard(existing.id)).getByDisplayValue('Preserve this unsaved external-deletion edit.')
    ).toBeVisible();
    fireEvent.click(within(projectRuleCard(existing.id)).getByRole('button', { name: SAVE_RULE_EDIT }));

    await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));
    expect(
      within(projectRuleCard(existing.id)).getByDisplayValue('Preserve this unsaved external-deletion edit.')
    ).toBeVisible();
    fireEvent.click(within(projectRuleCard(existing.id)).getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => expect(document.querySelector(`[data-studio-project-rule="${existing.id}"]`)).toBeNull());
    expect(screen.getByRole('button', { name: ADD_RULE })).toHaveFocus();
  });

  it('rebases a project-rule removal, recognizes absence, and refuses a changed base', async () => {
    const existing = projectRule('rule_existing', 'Keep the kits generic.');
    const concurrent = projectRule('rule_concurrent', 'Preserve the new Director rule.');
    const { callbacks, setRules } = makeMutations();
    render(<MenuHarness project={makeProject([existing])} mutations={callbacks} />);
    await openBriefAndRules();

    fireEvent.click(within(projectRuleCard(existing.id)).getByRole('button', { name: namedLike(REMOVE_RULE) }));

    await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));
    const updater = capturedUpdater(setRules);
    expect(updater([existing, concurrent])).toEqual([toDraft(concurrent)]);
    expect(updater([projectRule(existing.id, 'Changed elsewhere.'), concurrent])).toBeNull();
    expect(updater([concurrent])).toEqual([toDraft(concurrent)]);
    await waitFor(() => expect(screen.getByRole('button', { name: ADD_RULE })).toHaveFocus());
  });

  it('keeps a project rule visible when its removal mutation fails', async () => {
    const existing = projectRule('rule_existing', 'Keep the kits generic.');
    const setRules = vi.fn(async (_updater: RuleUpdater): Promise<boolean> => false);
    const { callbacks } = makeMutations(setRules);
    render(<MenuHarness project={makeProject([existing])} mutations={callbacks} />);
    await openBriefAndRules();

    fireEvent.click(within(projectRuleCard(existing.id)).getByRole('button', { name: namedLike(REMOVE_RULE) }));

    await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));
    expect(projectRuleCard(existing.id)).toHaveTextContent(existing.text);
  });

  it('recognizes an ambiguously adopted removal and transfers focus without a second mutation', async () => {
    const existing = projectRule('rule_existing', 'Keep the kits generic.');
    const setRules = vi.fn(async (updater: RuleUpdater): Promise<boolean> => {
      expect(updater([existing])).toEqual([]);
      return false;
    });
    const { callbacks, acknowledgeRuleAdoption } = makeMutations(setRules);
    const { rerender } = render(<MenuHarness project={makeProject([existing])} mutations={callbacks} />);
    await openBriefAndRules();

    fireEvent.click(within(projectRuleCard(existing.id)).getByRole('button', { name: namedLike(REMOVE_RULE) }));
    await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));
    expect(capturedUpdater(setRules)([])).toEqual([]);

    rerender(<MenuHarness project={makeProject([], { revision: 8 })} pending mutations={callbacks} />);

    await waitFor(() => expect(screen.getByRole('button', { name: ADD_RULE })).toBeDisabled());
    expect(screen.getByRole('button', { name: ADD_RULE })).not.toHaveFocus();
    rerender(<MenuHarness project={makeProject([], { revision: 8 })} mutations={callbacks} />);

    await waitFor(() => expect(screen.getByRole('button', { name: ADD_RULE })).toHaveFocus());
    expect(document.querySelector(`[data-studio-project-rule="${existing.id}"]`)).toBeNull();
    expect(setRules).toHaveBeenCalledTimes(1);
    expect(acknowledgeRuleAdoption).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty rule with localized feedback', async () => {
    const { callbacks, setRules } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openBriefAndRules();

    fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.rules.invalidText');
    expect(setRules).not.toHaveBeenCalled();
  });

  it('rejects rule text beyond the localized limit', async () => {
    const { callbacks, setRules } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openBriefAndRules();

    fireEvent.change(within(dialog).getByLabelText(RULE_TEXT), {
      target: { value: 'x'.repeat(STUDIO_RULE_LIMITS.text + 1) },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.rules.textTooLong');
    expect(setRules).not.toHaveBeenCalled();
  });

  it('rejects too many localized forbidden terms', async () => {
    const { callbacks, setRules } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openBriefAndRules();

    fireEvent.change(within(dialog).getByLabelText(RULE_TEXT), { target: { value: 'Avoid these terms.' } });
    fireEvent.change(within(dialog).getByLabelText(RULE_TERMS), {
      target: {
        value: Array.from({ length: STUDIO_RULE_LIMITS.maxTerms + 1 }, (_, index) => `term${index}`).join(','),
      },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.rules.tooManyTerms');
    expect(setRules).not.toHaveBeenCalled();
  });

  it('rejects a localized forbidden term beyond its limit', async () => {
    const { callbacks, setRules } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openBriefAndRules();

    fireEvent.change(within(dialog).getByLabelText(RULE_TEXT), { target: { value: 'Avoid this term.' } });
    fireEvent.change(within(dialog).getByLabelText(RULE_TERMS), {
      target: { value: 'ữ'.repeat(STUDIO_RULE_LIMITS.term + 1) },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.rules.termTooLong');
    expect(setRules).not.toHaveBeenCalled();
  });

  it('rejects a forbidden term that Unicode token matching cannot enforce', async () => {
    const { callbacks, setRules } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openBriefAndRules();

    fireEvent.change(within(dialog).getByLabelText(RULE_TEXT), { target: { value: 'Avoid this term.' } });
    fireEvent.change(within(dialog).getByLabelText(RULE_TERMS), { target: { value: '!!!' } });
    fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.rules.termUnusable');
    expect(setRules).not.toHaveBeenCalled();
  });

  it('rejects localized terms that normalize to the same enforced token sequence', async () => {
    const { callbacks, setRules } = makeMutations();
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openBriefAndRules();

    fireEvent.change(within(dialog).getByLabelText(RULE_TEXT), { target: { value: 'Avoid this term.' } });
    fireEvent.change(within(dialog).getByLabelText(RULE_TERMS), { target: { value: 'CÀ PHÊ, cà-phê' } });
    fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.rules.duplicateTerm');
    expect(setRules).not.toHaveBeenCalled();
  });

  it('counts locked organisation rules toward the effective rule limit', async () => {
    const projectRules = Array.from({ length: STUDIO_RULE_LIMITS.maxRules - 1 }, (_, index) =>
      projectRule(`rule_${index}`, `Project rule ${index}.`)
    );
    const { callbacks } = makeMutations();
    render(
      <MenuHarness
        project={makeProject(projectRules)}
        organisationRules={[organisationRule('rule_org', 'Locked rule.')]}
        mutations={callbacks}
      />
    );
    const dialog = await openBriefAndRules();

    expect(within(dialog).getByRole('button', { name: ADD_RULE })).toBeDisabled();
    expect(screen.getByText('conversation.creativeStudio.rules.limitReached')).toBeInTheDocument();
  });

  it('preserves a local rule draft while a command is pending', async () => {
    const { callbacks } = makeMutations();
    const { rerender } = render(<MenuHarness mutations={callbacks} />);
    const dialog = await openBriefAndRules();
    fireEvent.change(within(dialog).getByLabelText(RULE_TEXT), { target: { value: 'Keep this draft.' } });
    fireEvent.change(within(dialog).getByLabelText(RULE_TERMS), { target: { value: 'nhãn hiệu' } });

    rerender(<MenuHarness mutations={callbacks} pending />);

    expect(screen.getByLabelText(RULE_TEXT)).toHaveValue('Keep this draft.');
    expect(screen.getByLabelText(RULE_TERMS)).toHaveValue('nhãn hiệu');
    expect(screen.getByRole('button', { name: ADD_RULE })).toBeDisabled();
  });

  it('persists project-local add and edit drafts across isolated project navigation', async () => {
    const { callbacks } = makeMutations();
    const existing = projectRule('rule_existing', 'Keep the kits generic.');
    const first = makeProject([existing]);
    const second = makeProject([], { id: 'project_2', name: 'Second project' });
    const dirtyCounts = vi.fn();
    const { rerender } = render(
      <MenuHarness project={first} mutations={callbacks} onRuleDraftDirtyCountChange={dirtyCounts} />
    );
    const dialog = await openBriefAndRules();
    fireEvent.change(within(dialog).getByLabelText(RULE_TEXT), { target: { value: 'First-project draft.' } });
    fireEvent.change(within(dialog).getByLabelText(RULE_TERMS), { target: { value: 'Acme' } });
    const firstCard = projectRuleCard(existing.id);
    fireEvent.click(within(firstCard).getByRole('button', { name: EDIT_RULE }));
    fireEvent.change(within(firstCard).getByDisplayValue(existing.text), {
      target: { value: 'Preserve this edit across projects.' },
    });
    await waitFor(() => expect(dirtyCounts).toHaveBeenLastCalledWith(2));

    rerender(<MenuHarness project={second} mutations={callbacks} onRuleDraftDirtyCountChange={dirtyCounts} />);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: BRIEF_RULES_TITLE })).not.toBeInTheDocument());
    const secondDialog = await openBriefAndRules();
    expect(within(secondDialog).getByLabelText(RULE_TEXT)).toHaveValue('');
    expect(within(secondDialog).getByLabelText(RULE_TERMS)).toHaveValue('');
    expect(within(secondDialog).queryByDisplayValue('Preserve this edit across projects.')).not.toBeInTheDocument();
    await waitFor(() => expect(dirtyCounts).toHaveBeenLastCalledWith(2));

    fireEvent.click(within(secondDialog).getByRole('button', { name: 'Close' }));
    rerender(<MenuHarness project={first} mutations={callbacks} onRuleDraftDirtyCountChange={dirtyCounts} />);
    const restoredDialog = await openBriefAndRules();
    expect(
      within(restoredDialog).getByPlaceholderText('conversation.creativeStudio.rules.textPlaceholder')
    ).toHaveValue('First-project draft.');
    expect(
      within(restoredDialog).getByPlaceholderText('conversation.creativeStudio.rules.termsPlaceholder')
    ).toHaveValue('Acme');
    expect(within(restoredDialog).getByDisplayValue('Preserve this edit across projects.')).toBeInTheDocument();
    await waitFor(() => expect(dirtyCounts).toHaveBeenLastCalledWith(2));
    expect(callbacks.setRules).not.toHaveBeenCalled();
  });

  it('restores edits whose canonical base uses legacy whitespace and matcher-equivalent terms', async () => {
    const { callbacks } = makeMutations();
    const legacyRule = projectRule('rule_legacy', '  Keep the original spacing.  ', {
      kind: 'forbidden_terms',
      terms: ['CÀ PHÊ', 'cà-phê'],
    });
    const first = makeProject([legacyRule]);
    const second = makeProject([], { id: 'project_2', name: 'Second project' });
    const { rerender } = render(<MenuHarness project={first} mutations={callbacks} />);
    await openBriefAndRules();
    const card = projectRuleCard(legacyRule.id);
    fireEvent.click(within(card).getByRole('button', { name: EDIT_RULE }));
    fireEvent.change(within(card).getByLabelText(RULE_TEXT), {
      target: { value: 'Preserve this legacy-base edit.' },
    });

    rerender(<MenuHarness project={second} mutations={callbacks} />);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: BRIEF_RULES_TITLE })).not.toBeInTheDocument());
    rerender(<MenuHarness project={first} mutations={callbacks} />);
    const restoredDialog = await openBriefAndRules();

    expect(within(restoredDialog).getByDisplayValue('Preserve this legacy-base edit.')).toBeInTheDocument();
    expect(callbacks.setRules).not.toHaveBeenCalled();
  });

  it('keeps project-local drafts and close protection when session storage rejects writes', async () => {
    const { callbacks } = makeMutations();
    const first = makeProject([], { id: 'project_quota_a' });
    const second = makeProject([], { id: 'project_quota_b' });
    const dirtyCounts = vi.fn();
    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      if (key === 'aionui:creative-studio:v2:rule-drafts:project_quota_a')
        throw new DOMException('Quota', 'QuotaExceededError');
      return Reflect.apply(originalSetItem, window.sessionStorage, [key, value]);
    });
    const { rerender } = render(
      <MenuHarness project={first} mutations={callbacks} onRuleDraftDirtyCountChange={dirtyCounts} />
    );
    const firstDialog = await openBriefAndRules();
    fireEvent.change(within(firstDialog).getByLabelText(RULE_TEXT), {
      target: { value: 'Survive a quota failure.' },
    });
    await waitFor(() => expect(dirtyCounts).toHaveBeenLastCalledWith(1));
    expect(window.sessionStorage.getItem('aionui:creative-studio:v2:rule-drafts:project_quota_a')).toBeNull();

    rerender(<MenuHarness project={second} mutations={callbacks} onRuleDraftDirtyCountChange={dirtyCounts} />);
    await waitFor(() => expect(dirtyCounts).toHaveBeenLastCalledWith(1));
    rerender(<MenuHarness project={first} mutations={callbacks} onRuleDraftDirtyCountChange={dirtyCounts} />);
    const restoredDialog = await openBriefAndRules();
    expect(within(restoredDialog).getByLabelText(RULE_TEXT)).toHaveValue('Survive a quota failure.');

    setItem.mockRestore();
    fireEvent.change(within(restoredDialog).getByLabelText(RULE_TEXT), { target: { value: '' } });
    await waitFor(() => expect(dirtyCounts).toHaveBeenLastCalledWith(0));
  });

  it('uses the bounded volatile copy when session storage becomes unreadable', async () => {
    const { callbacks } = makeMutations();
    const first = makeProject([], { id: 'project_read_a' });
    const second = makeProject([], { id: 'project_read_b' });
    const dirtyCounts = vi.fn();
    const { rerender } = render(
      <MenuHarness project={first} mutations={callbacks} onRuleDraftDirtyCountChange={dirtyCounts} />
    );
    const firstDialog = await openBriefAndRules();
    fireEvent.change(within(firstDialog).getByLabelText(RULE_TEXT), {
      target: { value: 'Survive an unavailable storage read.' },
    });
    await waitFor(() => expect(dirtyCounts).toHaveBeenLastCalledWith(1));

    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Unavailable', 'SecurityError');
    });
    rerender(<MenuHarness project={second} mutations={callbacks} onRuleDraftDirtyCountChange={dirtyCounts} />);
    await waitFor(() => expect(dirtyCounts).toHaveBeenLastCalledWith(1));
    rerender(<MenuHarness project={first} mutations={callbacks} onRuleDraftDirtyCountChange={dirtyCounts} />);
    const restoredDialog = await openBriefAndRules();
    expect(within(restoredDialog).getByLabelText(RULE_TEXT)).toHaveValue('Survive an unavailable storage read.');

    getItem.mockRestore();
    fireEvent.change(within(restoredDialog).getByLabelText(RULE_TEXT), { target: { value: '' } });
    await waitFor(() => expect(dirtyCounts).toHaveBeenLastCalledWith(0));
  });

  it('counts uncommitted tag input as dirty and clears the count only after cancel', async () => {
    const existing = projectRule('rule_existing', 'Keep the kits generic.', {
      kind: 'forbidden_terms',
      terms: ['Acme'],
    });
    const { callbacks } = makeMutations();
    const dirtyCounts = vi.fn();
    render(
      <MenuHarness project={makeProject([existing])} mutations={callbacks} onRuleDraftDirtyCountChange={dirtyCounts} />
    );
    await openBriefAndRules();

    const card = projectRuleCard(existing.id);
    fireEvent.click(within(card).getByRole('button', { name: EDIT_RULE }));
    const termsInput = card.querySelector<HTMLInputElement>('input.arco-input-tag-input');
    expect(termsInput).not.toBeNull();
    fireEvent.change(termsInput!, { target: { value: 'unfinished term' } });
    await waitFor(() => expect(dirtyCounts).toHaveBeenLastCalledWith(1));

    fireEvent.click(within(card).getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => expect(dirtyCounts).toHaveBeenLastCalledWith(0));
  });

  it('drops malformed persisted rule drafts without mutating authority or reporting phantom work', async () => {
    const { callbacks } = makeMutations();
    const dirtyCounts = vi.fn();
    const key = 'aionui:creative-studio:v2:rule-drafts:project_1';
    window.sessionStorage.setItem(
      key,
      JSON.stringify({ version: 1, add: { text: 'poison', termsValue: '', attempt: null }, edits: [{}] })
    );

    render(<MenuHarness mutations={callbacks} onRuleDraftDirtyCountChange={dirtyCounts} />);
    const dialog = await openBriefAndRules();

    expect(within(dialog).getByLabelText(RULE_TEXT)).toHaveValue('');
    expect(within(dialog).getByLabelText(RULE_TERMS)).toHaveValue('');
    await waitFor(() => expect(dirtyCounts).toHaveBeenLastCalledWith(0));
    expect(window.sessionStorage.getItem(key)).toBeNull();
    expect(callbacks.setRules).not.toHaveBeenCalled();
  });

  it.each([
    ['valid hidden attempt', { id: 'rule_bad', text: 'Keep it safe.', predicate: null }],
    ['blank text', { id: 'rule_bad', text: ' ', predicate: null }],
    ['empty predicate', { id: 'rule_bad', text: 'Keep it safe.', predicate: { kind: 'forbidden_terms', terms: [] } }],
    [
      'unenforceable predicate',
      { id: 'rule_bad', text: 'Keep it safe.', predicate: { kind: 'forbidden_terms', terms: ['!!!'] } },
    ],
    [
      'duplicate predicate',
      {
        id: 'rule_bad',
        text: 'Keep it safe.',
        predicate: { kind: 'forbidden_terms', terms: ['CÀ PHÊ', 'cà-phê'] },
      },
    ],
  ])('drops a persisted add attempt with %s without creating phantom dirty work', async (_label, attempt) => {
    const { callbacks } = makeMutations();
    const dirtyCounts = vi.fn();
    const key = 'aionui:creative-studio:v2:rule-drafts:project_1';
    window.sessionStorage.setItem(
      key,
      JSON.stringify({ version: 1, add: { text: '', termsValue: '', attempt }, edits: [] })
    );

    render(<MenuHarness mutations={callbacks} onRuleDraftDirtyCountChange={dirtyCounts} />);
    const dialog = await openBriefAndRules();
    expect(within(dialog).getByLabelText(RULE_TEXT)).toHaveValue('');
    await waitFor(() => expect(dirtyCounts).toHaveBeenLastCalledWith(0));
    expect(window.sessionStorage.getItem(key)).toBeNull();
    expect(callbacks.setRules).not.toHaveBeenCalled();
  });

  it('still counts a valid background-project draft after removing an earlier malformed envelope', async () => {
    const { callbacks } = makeMutations();
    const dirtyCounts = vi.fn();
    window.sessionStorage.setItem('aionui:creative-studio:v2:rule-drafts:project_x', '{not-json');
    window.sessionStorage.setItem(
      'aionui:creative-studio:v2:rule-drafts:project_a',
      JSON.stringify({
        version: 1,
        add: { text: 'A background project draft.', termsValue: '', attempt: null },
        edits: [],
      })
    );

    render(
      <MenuHarness
        project={makeProject([], { id: 'project_b' })}
        mutations={callbacks}
        onRuleDraftDirtyCountChange={dirtyCounts}
      />
    );

    await waitFor(() => expect(dirtyCounts).toHaveBeenLastCalledWith(1));
    expect(window.sessionStorage.getItem('aionui:creative-studio:v2:rule-drafts:project_x')).toBeNull();
    expect(callbacks.setRules).not.toHaveBeenCalled();
  });

  it('preserves a local rule draft when the rule command fails', async () => {
    const setRules = vi.fn(async (_updater: RuleUpdater): Promise<boolean> => false);
    const { callbacks } = makeMutations(setRules);
    render(<MenuHarness mutations={callbacks} />);
    const dialog = await openBriefAndRules();
    fireEvent.change(within(dialog).getByLabelText(RULE_TEXT), { target: { value: 'Keep this draft.' } });
    fireEvent.change(within(dialog).getByLabelText(RULE_TERMS), { target: { value: 'nhãn hiệu' } });

    fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));
    await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));

    expect(screen.getByLabelText(RULE_TEXT)).toHaveValue('Keep this draft.');
    expect(screen.getByLabelText(RULE_TERMS)).toHaveValue('nhãn hiệu');
  });

  it('lets a rejected add attempt be abandoned by clearing both visible fields', async () => {
    const setRules = vi.fn(async (_updater: RuleUpdater): Promise<boolean> => false);
    const { callbacks } = makeMutations(setRules);
    const dirtyCounts = vi.fn();
    render(<MenuHarness mutations={callbacks} onRuleDraftDirtyCountChange={dirtyCounts} />);
    const dialog = await openBriefAndRules();
    const text = within(dialog).getByLabelText(RULE_TEXT);
    const terms = within(dialog).getByLabelText(RULE_TERMS);
    fireEvent.change(text, { target: { value: 'Abandon this rejected rule.' } });
    fireEvent.change(terms, { target: { value: 'Acme' } });
    fireEvent.click(within(dialog).getByRole('button', { name: ADD_RULE }));
    await waitFor(() => expect(setRules).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(dirtyCounts).toHaveBeenLastCalledWith(1));

    fireEvent.change(text, { target: { value: '' } });
    fireEvent.change(terms, { target: { value: '' } });

    await waitFor(() => expect(dirtyCounts).toHaveBeenLastCalledWith(0));
    expect(window.sessionStorage.getItem('aionui:creative-studio:v2:rule-drafts:project_1')).toBeNull();
  });
});
