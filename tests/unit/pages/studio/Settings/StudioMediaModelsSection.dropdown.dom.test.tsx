/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@arco-design/web-react/es/_util/react-19-adapter';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioCommandResult,
  StudioConnectionCandidate,
  StudioConnectionInventory,
} from '@/common/types/project/creativeStudioTypes';
import { StudioMediaModelsSection } from '@renderer/components/settings/SettingsModal/contents/ModelModalContent/StudioMediaModelsSection';

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

const ok = <T,>(data: T): StudioCommandResult<T> => ({ ok: true, data });

const candidates: StudioConnectionCandidate[] = [
  {
    providerId: 'provider_safe',
    providerName: 'Safe Provider',
    models: [
      { model: 'open-sora', health: 'available' },
      { model: 'open-sora-manual', health: 'unknown' },
    ],
    integrationModels: [],
  },
];

const inventory: StudioConnectionInventory = {
  integrations: [
    { integrationId: 'integration_image', kind: 'image', labelKey: 'imageApi' },
    { integrationId: 'integration_video', kind: 'video', labelKey: 'selfHostedVideoGateway' },
  ],
  connections: [],
};

type TestUser = ReturnType<typeof userEvent.setup>;

const openAddEditor = async (user: TestUser): Promise<HTMLElement> => {
  render(<StudioMediaModelsSection providerRefreshToken={0} onAddProvider={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: 'settings.mediaModels.add' }));
  return screen.findByRole('dialog', { name: 'settings.mediaModels.addTitle' });
};

const expectSelectPopup = async (control: HTMLElement, optionNames: string[]): Promise<void> => {
  await waitFor(() => expect(control).toHaveAttribute('aria-expanded', 'true'));
  const popup = document.querySelector<HTMLElement>('.arco-select-popup');
  expect(popup).toBeInTheDocument();
  if (!popup) throw new Error('Expected the Arco Select popup to be mounted');
  await waitFor(() => expect(popup).toHaveStyle({ pointerEvents: 'auto' }));
  for (const optionName of optionNames) {
    expect(within(popup).getByRole('option', { name: optionName })).toBeVisible();
  }
};

describe('StudioMediaModelsSection Arco dropdowns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.listConnectionCandidates.invoke.mockResolvedValue(ok(candidates));
    bridge.listConnections.invoke.mockResolvedValue(ok(inventory));
  });

  it('opens the output type option list from the add media model dialog', async () => {
    const user = userEvent.setup();
    const dialog = await openAddEditor(user);
    const outputType = within(dialog).getByRole('combobox', { name: 'settings.mediaModels.outputType' });

    expect(document.querySelector('.arco-select-popup')).toBeNull();
    await user.click(outputType);

    await expectSelectPopup(outputType, ['settings.mediaModels.image', 'settings.mediaModels.video']);
  });

  it('opens the provider option list from the add media model dialog', async () => {
    const user = userEvent.setup();
    const dialog = await openAddEditor(user);
    const provider = within(dialog).getByRole('combobox', { name: 'settings.mediaModels.provider' });

    await user.click(provider);

    await expectSelectPopup(provider, ['Safe Provider']);
  });

  it('opens the integration option list from the add media model dialog', async () => {
    const user = userEvent.setup();
    const dialog = await openAddEditor(user);
    const integration = within(dialog).getByRole('combobox', {
      name: 'settings.mediaModels.integrationLabel',
    });

    await user.click(integration);

    await expectSelectPopup(integration, ['settings.mediaModels.integration.imageApi']);
  });

  it('enables and opens the model autocomplete after a provider is selected', async () => {
    const user = userEvent.setup();
    const dialog = await openAddEditor(user);
    const provider = within(dialog).getByRole('combobox', { name: 'settings.mediaModels.provider' });
    const model = within(dialog).getByRole('textbox', { name: 'settings.mediaModels.model' });

    expect(model).toBeDisabled();
    await user.click(provider);
    await expectSelectPopup(provider, ['Safe Provider']);
    const providerPopup = document.querySelector<HTMLElement>('.arco-select-popup');
    if (!providerPopup) throw new Error('Expected the provider popup to be mounted');
    await user.click(within(providerPopup).getByRole('option', { name: 'Safe Provider' }));
    await waitFor(() => expect(model).toBeEnabled());

    await user.click(model);

    await waitFor(() => expect(document.querySelector('.arco-autocomplete-popup')).toBeInTheDocument());
    const modelPopup = document.querySelector<HTMLElement>('.arco-autocomplete-popup');
    if (!modelPopup) throw new Error('Expected the Arco AutoComplete popup to be mounted');
    expect(within(modelPopup).getByRole('option', { name: 'open-sora' })).toBeVisible();
    expect(within(modelPopup).getByRole('option', { name: 'open-sora-manual' })).toBeVisible();
  });
});
