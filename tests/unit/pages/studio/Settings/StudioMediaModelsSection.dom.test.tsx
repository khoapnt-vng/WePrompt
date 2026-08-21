/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioCommandResult,
  StudioConnectionCandidate,
  StudioConnectionInventory,
  StudioConnectionRecord,
  StudioConnectionValidationResult,
  StudioRendererConnectionCapabilities,
} from '@/common/types/project/creativeStudioTypes';
import {
  sanitizeStudioMediaModelCapabilities,
  StudioMediaModelsSection,
} from '@renderer/components/settings/SettingsModal/contents/ModelModalContent/StudioMediaModelsSection';

const bridge = vi.hoisted(() => ({
  listConnectionCandidates: { invoke: vi.fn() },
  listConnections: { invoke: vi.fn() },
  validateConnection: { invoke: vi.fn() },
  saveConnection: { invoke: vi.fn() },
  removeConnection: { invoke: vi.fn() },
}));

vi.mock('@/common', () => ({ ipcBridge: { creativeStudio: bridge } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@icon-park/react', () => ({
  Plus: () => <span aria-hidden='true'>+</span>,
  Refresh: () => <span aria-hidden='true'>↻</span>,
}));
vi.mock('@arco-design/web-react', async () => {
  const ReactModule = await import('react');

  const Button = ({
    children,
    onClick,
    disabled,
    loading,
    long: _long,
    icon: _icon,
    status: _status,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    loading?: boolean;
    long?: boolean;
    icon?: React.ReactNode;
    status?: string;
  }) => (
    <button disabled={disabled || loading} onClick={onClick} {...props}>
      {children}
    </button>
  );
  const Modal = ({
    visible,
    title,
    children,
    footer,
  }: {
    visible?: boolean;
    title?: React.ReactNode;
    children?: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    visible ? (
      <div role='dialog' aria-label={typeof title === 'string' ? title : undefined}>
        <h2>{title}</h2>
        {children}
        {footer}
      </div>
    ) : null;
  const Option = ({ children, value }: { children?: React.ReactNode; value?: string }) => (
    <option value={value}>{children}</option>
  );
  const Select = ({
    children,
    value,
    onChange,
    disabled,
    ...props
  }: {
    children?: React.ReactNode;
    value?: string;
    onChange?: (value: string) => void;
    disabled?: boolean;
    ['aria-label']?: string;
  }) => (
    <select
      aria-label={props['aria-label']}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange?.(event.target.value)}
    >
      <option value='' />
      {children}
    </select>
  );
  Select.Option = Option;

  return {
    Alert: ({ content, type }: { content?: React.ReactNode; type?: string }) => (
      <div role={type === 'error' ? 'alert' : 'status'}>{content}</div>
    ),
    AutoComplete: ({
      value,
      onChange,
      disabled,
      inputProps,
      data,
    }: {
      value?: string;
      onChange?: (value: string) => void;
      disabled?: boolean;
      inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
      data?: string[];
    }) => (
      <>
        <input
          {...inputProps}
          list={data?.length ? 'media-model-options' : undefined}
          value={value ?? ''}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.value)}
        />
        {data?.length ? (
          <datalist id='media-model-options'>
            {data.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        ) : null}
      </>
    ),
    Button,
    Modal,
    Popconfirm: ({
      children,
      onOk,
    }: {
      children: React.ReactElement<{ onClick?: React.MouseEventHandler }>;
      onOk?: () => void;
    }) => ReactModule.cloneElement(children, { onClick: () => onOk?.() }),
    Select,
    Spin: () => <div role='status'>loading</div>,
    Tag: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  };
});

const ok = <T,>(data: T): StudioCommandResult<T> => ({ ok: true, data });
const failure = <T,>(messageKey = 'settings.mediaModels.loadFailed'): StudioCommandResult<T> => ({
  ok: false,
  error: { code: 'provider_error', messageKey },
});

const candidate = (overrides: Partial<StudioConnectionCandidate> = {}): StudioConnectionCandidate => ({
  providerId: 'provider_safe',
  providerName: 'Safe Provider',
  models: [
    { model: 'open-sora', health: 'available' },
    { model: 'open-sora-manual', health: 'unknown' },
  ],
  integrationModels: [],
  ...overrides,
});

const IMAGE_INTEGRATION_ID = 'integration_g7Q2mB4p';
const SEEDANCE_INTEGRATION_ID = 'integration_r9L3vN6k';
const GATEWAY_INTEGRATION_ID = 'integration_x5T8cW1h';
const OPENROUTER_INTEGRATION_ID = 'integration_o4R7vD2m';
const OPENROUTER_VIDEO_MODELS = [
  'bytedance/seedance-2.0',
  'bytedance/seedance-2.0-fast',
  'google/veo-3.1-fast',
  'google/veo-3.1-lite',
  'kwaivgi/kling-v3.0-pro',
  'kwaivgi/kling-v3.0-std',
] as const;

const integrations: StudioConnectionInventory['integrations'] = [
  { integrationId: IMAGE_INTEGRATION_ID, kind: 'image', labelKey: 'imageApi' },
  { integrationId: SEEDANCE_INTEGRATION_ID, kind: 'video', labelKey: 'bytePlusSeedance' },
  { integrationId: GATEWAY_INTEGRATION_ID, kind: 'video', labelKey: 'selfHostedVideoGateway' },
  { integrationId: OPENROUTER_INTEGRATION_ID, kind: 'video', labelKey: 'openRouterVideo' },
];

const binding = (overrides: Partial<StudioConnectionRecord> = {}): StudioConnectionRecord => ({
  bindingId: 'binding_safe',
  providerId: 'provider_safe',
  integrationId: GATEWAY_INTEGRATION_ID,
  labelKey: 'selfHostedVideoGateway',
  model: 'open-sora',
  capabilities: {
    mediaKinds: ['video'],
    audioModes: ['none'],
    aspectRatios: ['16:9'],
    resolutions: ['720p'],
    minDurationSeconds: 2,
    maxDurationSeconds: 12,
    supportsFirstFrame: true,
    maxConditioningImages: 0,
  },
  validatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const validation = (overrides: Partial<StudioConnectionValidationResult> = {}): StudioConnectionValidationResult => {
  const record = binding();
  return {
    providerId: record.providerId,
    integrationId: record.integrationId,
    labelKey: record.labelKey,
    model: record.model,
    capabilities: record.capabilities,
    validatedAt: record.validatedAt,
    ...overrides,
  };
};

const inventory = (connections: StudioConnectionRecord[] = [binding()]): StudioConnectionInventory => ({
  integrations,
  connections,
});

const openAddEditor = async (): Promise<HTMLElement> => {
  fireEvent.click(await screen.findByRole('button', { name: 'settings.mediaModels.add' }));
  return screen.getByRole('dialog', { name: 'settings.mediaModels.addTitle' });
};

const fillVideoTuple = async (model = 'open-sora-manual'): Promise<HTMLElement> => {
  const dialog = await openAddEditor();
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.outputType' }), {
    target: { value: 'video' },
  });
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.provider' }), {
    target: { value: 'provider_safe' },
  });
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.integrationLabel' }), {
    target: { value: GATEWAY_INTEGRATION_ID },
  });
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.model' }), {
    target: { value: model },
  });
  return dialog;
};

describe('sanitizeStudioMediaModelCapabilities', () => {
  const capabilities = (maxConditioningImages?: number): StudioRendererConnectionCapabilities => ({
    mediaKinds: ['image'],
    ...(maxConditioningImages === undefined ? {} : { maxConditioningImages }),
  });

  it('preserves only absent or integer conditioning capacity values from zero through six', () => {
    const absent = sanitizeStudioMediaModelCapabilities(capabilities());
    const zero = sanitizeStudioMediaModelCapabilities(capabilities(0));
    const six = sanitizeStudioMediaModelCapabilities(capabilities(6));
    const negative = sanitizeStudioMediaModelCapabilities(capabilities(-1));
    const fractional = sanitizeStudioMediaModelCapabilities(capabilities(1.5));
    const excessive = sanitizeStudioMediaModelCapabilities(capabilities(7));

    expect(absent).not.toHaveProperty('maxConditioningImages');
    expect(zero).toHaveProperty('maxConditioningImages', 0);
    expect(six).toHaveProperty('maxConditioningImages', 6);
    expect(negative).not.toHaveProperty('maxConditioningImages');
    expect(fractional).not.toHaveProperty('maxConditioningImages');
    expect(excessive).not.toHaveProperty('maxConditioningImages');
  });
});

describe('StudioMediaModelsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.listConnectionCandidates.invoke.mockResolvedValue(ok([candidate()]));
    bridge.listConnections.invoke.mockResolvedValue(ok(inventory()));
    bridge.validateConnection.invoke.mockResolvedValue(ok(validation()));
    bridge.saveConnection.invoke.mockResolvedValue(ok(binding()));
    bridge.removeConnection.invoke.mockResolvedValue(ok(true));
  });

  it('renders friendly binding rows without secrets or adapter IDs', async () => {
    bridge.listConnectionCandidates.invoke.mockResolvedValue(
      ok([
        {
          ...candidate(),
          apiKey: 'candidate-secret',
          baseUrl: 'https://secret.invalid',
        } as StudioConnectionCandidate,
      ])
    );
    bridge.listConnections.invoke.mockResolvedValue(
      ok(
        inventory([
          {
            ...binding(),
            authorization: 'Bearer secret',
            path: '/private/provider.json',
          } as StudioConnectionRecord,
        ])
      )
    );

    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);

    expect(await screen.findByText('open-sora')).toBeInTheDocument();
    expect(screen.getByText('Safe Provider')).toBeInTheDocument();
    expect(screen.getByText('settings.mediaModels.integration.selfHostedVideoGateway')).toBeInTheDocument();
    expect(screen.getByText('settings.mediaModels.silentOutputSupported')).toBeInTheDocument();
    expect(screen.getByText('settings.mediaModels.video')).toBeInTheDocument();
    expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-07-30T00:00:00.000Z');
    expect(
      screen.queryByText(/weprompt-media-gateway-v1|candidate-secret|Bearer secret|secret\.invalid|private\/provider/)
    ).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/weprompt-(?:image|media-gateway)-v1|byteplus-seedance-v1/);
  });

  it('does not read raw cancellation fields into renderer connection state', async () => {
    const forbiddenReads = vi.fn();
    const rawCapabilities = {
      ...binding().capabilities,
      get cancellation(): boolean {
        forbiddenReads('cancellation');
        return true;
      },
      get cancellationPolicy(): 'queued_and_running' {
        forbiddenReads('cancellationPolicy');
        return 'queued_and_running';
      },
    };
    bridge.listConnections.invoke.mockResolvedValue(
      ok(inventory([{ ...binding(), capabilities: rawCapabilities } as unknown as StudioConnectionRecord]))
    );

    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);

    expect(await screen.findByText('open-sora')).toBeInTheDocument();
    expect(forbiddenReads).not.toHaveBeenCalled();
    expect(binding().capabilities).not.toHaveProperty('cancellation');
    expect(binding().capabilities).not.toHaveProperty('cancellationPolicy');
  });

  it('shows loading, empty inventory, and the provider action', async () => {
    let resolveCandidates: (value: StudioCommandResult<StudioConnectionCandidate[]>) => void = () => undefined;
    bridge.listConnectionCandidates.invoke.mockReturnValue(
      new Promise((resolve) => {
        resolveCandidates = resolve;
      })
    );
    bridge.listConnections.invoke.mockResolvedValue(ok(inventory([])));
    const onAddProvider = vi.fn();
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={onAddProvider} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    resolveCandidates(ok([]));
    expect(await screen.findByText('settings.mediaModels.empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'settings.mediaModels.addProvider' }));
    expect(onAddProvider).toHaveBeenCalledTimes(1);
  });

  it('surfaces list failure and refreshes canonical inventory', async () => {
    bridge.listConnectionCandidates.invoke.mockResolvedValueOnce(failure()).mockResolvedValueOnce(ok([candidate()]));
    bridge.listConnections.invoke.mockResolvedValueOnce(ok(inventory([]))).mockResolvedValueOnce(ok(inventory()));
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('settings.mediaModels.loadFailed');
    expect(screen.queryByText('settings.mediaModels.empty')).toBeNull();
    expect(screen.queryByRole('button', { name: 'settings.mediaModels.addProvider' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'settings.mediaModels.refresh' }));
    expect(await screen.findByText('open-sora')).toBeInTheDocument();
    expect(bridge.listConnections.invoke).toHaveBeenCalledTimes(2);
  });

  it('keeps bindings for deleted providers visible and refetches after provider changes', async () => {
    bridge.listConnectionCandidates.invoke.mockResolvedValueOnce(ok([])).mockResolvedValue(ok([candidate()]));
    const view = render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);

    expect(await screen.findByText('settings.mediaModels.unavailable')).toBeInTheDocument();
    expect(screen.getByText('provider_safe')).toBeInTheDocument();
    view.rerender(<StudioMediaModelsSection providerRefreshToken={1} onAddProvider={vi.fn()} />);
    expect(await screen.findByText('Safe Provider')).toBeInTheDocument();
    expect(bridge.listConnectionCandidates.invoke).toHaveBeenCalledTimes(2);
  });

  it('filters integrations by output type and offers provider models plus manual entry', async () => {
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);
    const dialog = await openAddEditor();
    const integration = within(dialog).getByRole('combobox', {
      name: 'settings.mediaModels.integrationLabel',
    });

    expect(within(integration).getByText('settings.mediaModels.integration.imageApi')).toBeInTheDocument();
    expect(within(integration).queryByText('settings.mediaModels.integration.bytePlusSeedance')).toBeNull();
    expect(dialog.innerHTML).not.toMatch(/weprompt-(?:image|media-gateway)-v1|byteplus-seedance-v1/);

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.outputType' }), {
      target: { value: 'video' },
    });
    expect(within(integration).getByText('settings.mediaModels.integration.bytePlusSeedance')).toBeInTheDocument();
    expect(
      within(integration).getByText('settings.mediaModels.integration.selfHostedVideoGateway')
    ).toBeInTheDocument();
    expect(within(integration).queryByText('settings.mediaModels.integration.imageApi')).toBeNull();

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.provider' }), {
      target: { value: 'provider_safe' },
    });
    const model = within(dialog).getByRole('combobox', { name: 'settings.mediaModels.model' });
    expect(model).toHaveAttribute('list');
    fireEvent.change(model, { target: { value: 'manual-model' } });
    expect(model).toHaveValue('manual-model');
  });

  it('offers all curated OpenRouter video models without generic text suggestions', async () => {
    bridge.listConnectionCandidates.invoke.mockResolvedValue(
      ok([
        candidate({
          models: [
            { model: 'openai/gpt-5', health: 'available' },
            { model: 'anthropic/claude-sonnet-4', health: 'unknown' },
          ],
          integrationModels: [
            {
              integrationLabelKey: 'openRouterVideo',
              models: OPENROUTER_VIDEO_MODELS.map((model) => ({ model, health: 'unknown' as const })),
            },
          ],
        }),
      ])
    );
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);
    const dialog = await openAddEditor();

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.outputType' }), {
      target: { value: 'video' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.provider' }), {
      target: { value: 'provider_safe' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.integrationLabel' }), {
      target: { value: OPENROUTER_INTEGRATION_ID },
    });

    const model = within(dialog).getByRole('combobox', { name: 'settings.mediaModels.model' });
    const options = within(model)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
      .filter(Boolean);
    expect(model.tagName).toBe('SELECT');
    expect(options).toEqual(OPENROUTER_VIDEO_MODELS);
    expect(options).not.toEqual(expect.arrayContaining(['openai/gpt-5', 'anthropic/claude-sonnet-4']));
    expect(dialog.querySelector('#media-model-options')).toBeNull();
  });

  it('does not validate arbitrary free text for a closed OpenRouter model set', async () => {
    bridge.listConnectionCandidates.invoke.mockResolvedValue(
      ok([
        candidate({
          models: [{ model: 'openai/gpt-5', health: 'available' }],
          integrationModels: [
            {
              integrationLabelKey: 'openRouterVideo',
              models: OPENROUTER_VIDEO_MODELS.map((model) => ({ model, health: 'unknown' as const })),
            },
          ],
        }),
      ])
    );
    bridge.listConnections.invoke.mockResolvedValue(ok(inventory([])));
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);
    const dialog = await openAddEditor();

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.outputType' }), {
      target: { value: 'video' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.provider' }), {
      target: { value: 'provider_safe' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.integrationLabel' }), {
      target: { value: OPENROUTER_INTEGRATION_ID },
    });
    const model = within(dialog).getByRole('combobox', { name: 'settings.mediaModels.model' });
    fireEvent.change(model, { target: { value: 'openai/gpt-5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'settings.mediaModels.validate' }));

    expect(bridge.validateConnection.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['missing projection', undefined],
    ['missing scoped row', []],
    ['empty scoped row', [{ integrationLabelKey: 'openRouterVideo', models: [] }]],
    ['malformed scoped row', [null]],
  ] as const)('fails closed for OpenRouter with a %s', async (_case, integrationModels) => {
    const rawCandidate: Record<string, unknown> = {
      ...candidate({
        models: [
          { model: 'openai/gpt-5', health: 'available' },
          { model: 'google/veo-3.1-fast', health: 'unknown' },
        ],
      }),
    };
    if (integrationModels === undefined) delete rawCandidate.integrationModels;
    else rawCandidate.integrationModels = integrationModels;
    bridge.listConnectionCandidates.invoke.mockResolvedValue(ok([rawCandidate as StudioConnectionCandidate]));
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);
    const dialog = await openAddEditor();

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.outputType' }), {
      target: { value: 'video' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.provider' }), {
      target: { value: 'provider_safe' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.integrationLabel' }), {
      target: { value: OPENROUTER_INTEGRATION_ID },
    });

    const model = within(dialog).getByLabelText('settings.mediaModels.model');
    expect(model).toBeDisabled();
    expect(model).not.toHaveAttribute('list');
    expect(dialog.querySelector('#media-model-options')).toBeNull();
  });

  it('clones only safe integration model fields before retaining renderer state', async () => {
    const projectedModels: unknown[] = [];
    projectedModels.length = 1;
    projectedModels.push(
      {
        model: 'google/veo-3.1-lite',
        health: 'available' as const,
        adapterId: 'openrouter-video-v1',
        authorization: 'Bearer private',
      },
      { model: 'google/veo-3.1-fast', health: 'unknown' as const },
      { model: 'google/veo-3.1-fast', health: 'available' as const },
      { model: 'bad\nmodel', health: 'available' as const },
      { model: 'private-health-model', health: 'private' }
    );
    const source = {
      ...candidate(),
      integrationModels: [
        {
          integrationLabelKey: 'openRouterVideo',
          models: projectedModels,
          adapterId: 'openrouter-video-v1',
        },
      ],
      apiKey: 'candidate-secret',
      baseUrl: 'https://private.invalid',
    } as unknown as StudioConnectionCandidate;
    bridge.listConnectionCandidates.invoke.mockResolvedValue(ok([source]));
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);
    await screen.findByText('open-sora');
    projectedModels[1] = { model: 'mutated-after-refresh', health: 'available' };
    const dialog = await openAddEditor();

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.outputType' }), {
      target: { value: 'video' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.provider' }), {
      target: { value: 'provider_safe' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.integrationLabel' }), {
      target: { value: OPENROUTER_INTEGRATION_ID },
    });

    const model = within(dialog).getByRole('combobox', { name: 'settings.mediaModels.model' });
    const options = within(model)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
      .filter(Boolean);
    expect(options).toEqual(['google/veo-3.1-fast', 'google/veo-3.1-lite']);
    expect(document.body.innerHTML).not.toMatch(
      /candidate-secret|private\.invalid|Bearer private|openrouter-video-v1|mutated-after-refresh/
    );
  });

  it('clears a stale model when the selected provider changes', async () => {
    bridge.listConnectionCandidates.invoke.mockResolvedValue(
      ok([
        candidate(),
        candidate({
          providerId: 'provider_other',
          providerName: 'Other Provider',
          models: [{ model: 'other-model', health: 'unknown' }],
        }),
      ])
    );
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);
    const dialog = await openAddEditor();

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.outputType' }), {
      target: { value: 'video' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.provider' }), {
      target: { value: 'provider_safe' },
    });
    const model = within(dialog).getByRole('combobox', { name: 'settings.mediaModels.model' });
    fireEvent.change(model, { target: { value: 'open-sora' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.provider' }), {
      target: { value: 'provider_other' },
    });

    expect(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.model' })).toHaveValue('');
  });

  it('clears a stale model when the selected integration changes', async () => {
    bridge.listConnectionCandidates.invoke.mockResolvedValue(
      ok([
        candidate({
          integrationModels: [
            {
              integrationLabelKey: 'openRouterVideo',
              models: OPENROUTER_VIDEO_MODELS.map((model) => ({ model, health: 'unknown' as const })),
            },
          ],
        }),
      ])
    );
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);
    const dialog = await openAddEditor();

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.outputType' }), {
      target: { value: 'video' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.provider' }), {
      target: { value: 'provider_safe' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.integrationLabel' }), {
      target: { value: GATEWAY_INTEGRATION_ID },
    });
    const model = within(dialog).getByRole('combobox', { name: 'settings.mediaModels.model' });
    fireEvent.change(model, { target: { value: 'open-sora' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.integrationLabel' }), {
      target: { value: OPENROUTER_INTEGRATION_ID },
    });

    expect(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.model' })).toHaveValue('');
  });

  it('saves only the exact tuple after validation and clears validation when a field changes', async () => {
    const validated = validation({
      model: 'open-sora-manual',
    });
    const saved = binding({
      bindingId: 'binding_manual',
      model: 'open-sora-manual',
    });
    bridge.listConnections.invoke.mockResolvedValue(ok(inventory([])));
    bridge.validateConnection.invoke.mockResolvedValue(ok(validated));
    bridge.saveConnection.invoke.mockResolvedValue(ok(saved));
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);
    const dialog = await fillVideoTuple();
    const save = within(dialog).getByRole('button', { name: 'settings.mediaModels.save' });
    expect(save).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'settings.mediaModels.validate' }));
    const safeRequest = {
      providerId: 'provider_safe',
      integrationId: GATEWAY_INTEGRATION_ID,
      model: 'open-sora-manual',
    };
    await waitFor(() => expect(bridge.validateConnection.invoke).toHaveBeenCalledExactlyOnceWith(safeRequest));
    expect(await within(dialog).findByText('settings.mediaModels.validationSuccess')).toBeInTheDocument();
    expect(save).toBeEnabled();

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.model' }), {
      target: { value: 'changed' },
    });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.model' }), {
      target: { value: 'open-sora-manual' },
    });
    expect(save).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'settings.mediaModels.validate' }));
    await waitFor(() => expect(bridge.validateConnection.invoke).toHaveBeenCalledTimes(2));
    fireEvent.click(save);
    await waitFor(() => expect(bridge.saveConnection.invoke).toHaveBeenCalledExactlyOnceWith(safeRequest));
  });

  it('rejects mismatched validation DTOs and gateways without silent output', async () => {
    bridge.listConnections.invoke.mockResolvedValue(ok(inventory([])));
    bridge.validateConnection.invoke
      .mockResolvedValueOnce(ok(validation({ providerId: 'provider_other', model: 'open-sora-manual' })))
      .mockResolvedValueOnce(
        ok(
          validation({
            model: 'open-sora-manual',
            capabilities: { mediaKinds: ['video'], audioModes: ['speech'] },
          })
        )
      );
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);
    const dialog = await fillVideoTuple();
    const validate = within(dialog).getByRole('button', { name: 'settings.mediaModels.validate' });
    const save = within(dialog).getByRole('button', { name: 'settings.mediaModels.save' });

    fireEvent.click(validate);
    expect(await within(dialog).findByText('settings.mediaModels.validationFailed')).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.click(validate);
    await waitFor(() => expect(bridge.validateConnection.invoke).toHaveBeenCalledTimes(2));
    expect(save).toBeDisabled();
  });

  it('saves an edited replacement before removing the prior binding', async () => {
    const calls: string[] = [];
    bridge.validateConnection.invoke.mockImplementation(async () => {
      calls.push('validate');
      return ok(validation({ model: 'replacement' }));
    });
    bridge.saveConnection.invoke.mockImplementation(async () => {
      calls.push('save');
      return ok(binding({ bindingId: 'binding_replacement', model: 'replacement' }));
    });
    bridge.removeConnection.invoke.mockImplementation(async () => {
      calls.push('remove');
      return ok(true);
    });
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);
    const row = await screen.findByRole('listitem', { name: 'open-sora' });
    fireEvent.click(within(row).getByRole('button', { name: 'settings.mediaModels.edit' }));
    const dialog = screen.getByRole('dialog', { name: 'settings.mediaModels.editTitle' });
    expect(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.model' })).toHaveValue('open-sora');
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.model' }), {
      target: { value: 'replacement' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'settings.mediaModels.validate' }));
    const save = within(dialog).getByRole('button', { name: 'settings.mediaModels.save' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(bridge.removeConnection.invoke).toHaveBeenCalledWith({ bindingId: 'binding_safe' }));
    expect(calls).toEqual(['validate', 'save', 'remove']);
  });

  it('revalidates to one canonical visible row when save returns a replacement ID', async () => {
    bridge.saveConnection.invoke.mockResolvedValue(ok(binding({ bindingId: 'binding_revalidated' })));
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);
    const row = await screen.findByRole('listitem', { name: 'open-sora' });
    fireEvent.click(within(row).getByRole('button', { name: 'settings.mediaModels.revalidate' }));
    const request = {
      providerId: 'provider_safe',
      integrationId: GATEWAY_INTEGRATION_ID,
      model: 'open-sora',
    };

    await waitFor(() => expect(bridge.validateConnection.invoke).toHaveBeenCalledExactlyOnceWith(request));
    await waitFor(() => expect(bridge.saveConnection.invoke).toHaveBeenCalledExactlyOnceWith(request));
    await waitFor(() => expect(screen.getAllByRole('listitem', { name: 'open-sora' })).toHaveLength(1));
  });

  it('sanitizes admitted capacity through load and revalidation without rendering new capacity copy', async () => {
    const capacityReads = vi.fn();
    const capabilities = {
      ...binding().capabilities,
      get maxConditioningImages(): number {
        capacityReads();
        return 6;
      },
    };
    bridge.listConnections.invoke.mockResolvedValue(
      ok(inventory([{ ...binding(), capabilities } as StudioConnectionRecord]))
    );
    bridge.validateConnection.invoke.mockResolvedValue(
      ok(validation({ capabilities: capabilities as StudioConnectionValidationResult['capabilities'] }))
    );
    bridge.saveConnection.invoke.mockResolvedValue(
      ok(
        binding({
          bindingId: 'binding_revalidated',
          capabilities: capabilities as StudioConnectionRecord['capabilities'],
        })
      )
    );
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);
    const row = await screen.findByRole('listitem', { name: 'open-sora' });

    fireEvent.click(within(row).getByRole('button', { name: 'settings.mediaModels.revalidate' }));

    await waitFor(() => expect(bridge.saveConnection.invoke).toHaveBeenCalledOnce());
    expect(capacityReads).toHaveBeenCalled();
    const capacityCopy =
      /(?:conditioning|reference|images?|maximum|max|up to).*\b6\b|\b6\b.*(?:conditioning|reference|images?|maximum|max|up to)/i;
    expect(document.body).not.toHaveTextContent(capacityCopy);
    for (const element of [document.body, ...document.body.querySelectorAll('*')]) {
      expect(element).not.toHaveAccessibleName(capacityCopy);
    }
  });

  it('same-tuple edit replaces the visible row instead of duplicating it', async () => {
    bridge.saveConnection.invoke.mockResolvedValue(ok(binding({ bindingId: 'binding_edited' })));
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);
    const row = await screen.findByRole('listitem', { name: 'open-sora' });
    fireEvent.click(within(row).getByRole('button', { name: 'settings.mediaModels.edit' }));
    const dialog = screen.getByRole('dialog', { name: 'settings.mediaModels.editTitle' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'settings.mediaModels.validate' }));
    const save = within(dialog).getByRole('button', { name: 'settings.mediaModels.save' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(() => expect(screen.getAllByRole('listitem', { name: 'open-sora' })).toHaveLength(1));
  });

  it('removes a binding with only its safe connection ID', async () => {
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);
    const row = await screen.findByRole('listitem', { name: 'open-sora' });
    fireEvent.click(within(row).getByRole('button', { name: 'settings.mediaModels.remove' }));

    await waitFor(() =>
      expect(bridge.removeConnection.invoke).toHaveBeenCalledExactlyOnceWith({
        bindingId: 'binding_safe',
      })
    );
  });

  it('refreshes and shows both records when old-binding removal fails after replacement save', async () => {
    const replacement = binding({ bindingId: 'binding_replacement', model: 'replacement' });
    bridge.listConnections.invoke
      .mockResolvedValueOnce(ok(inventory()))
      .mockResolvedValue(ok(inventory([binding(), replacement])));
    bridge.validateConnection.invoke.mockResolvedValue(ok(validation({ model: 'replacement' })));
    bridge.saveConnection.invoke.mockResolvedValue(ok(replacement));
    bridge.removeConnection.invoke.mockResolvedValue(failure('settings.mediaModels.validationFailed'));
    render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);
    const row = await screen.findByRole('listitem', { name: 'open-sora' });
    fireEvent.click(within(row).getByRole('button', { name: 'settings.mediaModels.edit' }));
    const dialog = screen.getByRole('dialog', { name: 'settings.mediaModels.editTitle' });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'settings.mediaModels.model' }), {
      target: { value: 'replacement' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'settings.mediaModels.validate' }));
    await waitFor(() => expect(bridge.validateConnection.invoke).toHaveBeenCalledTimes(1));
    fireEvent.click(within(dialog).getByRole('button', { name: 'settings.mediaModels.save' }));

    expect(await screen.findByRole('listitem', { name: 'replacement' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'open-sora' })).toBeInTheDocument();
    expect(bridge.listConnections.invoke).toHaveBeenCalledTimes(2);
  });
});
