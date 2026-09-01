import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next, { type i18n as I18nInstance } from 'i18next';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
  type StudioApplyMutationBatchResultV3,
  type StudioSpendPolicy,
} from '@/common/types/project/creativeStudioTypes';
import { PilotSpendingLimitDialog, type PilotSpendingLimitClientV3 } from '@/renderer/pages/studio/components/Pilot';
import conversation from '@renderer/services/i18n/locales/en-US/conversation.json';

let testI18n: I18nInstance;

beforeAll(async () => {
  testI18n = i18next.createInstance();
  await testI18n.init({
    lng: 'en-US',
    fallbackLng: false,
    resources: { 'en-US': { translation: { conversation } } },
    interpolation: { escapeValue: false },
  });
});

const mutationResult: StudioApplyMutationBatchResultV3 = {
  projectId: 'project_1',
  revision: 8,
  authoringRevision: 5,
  undoEntryId: null,
};

const makeClient = () => ({
  applyMutationBatchV3: vi.fn(async () => mutationResult),
  preparePhotoV3: vi.fn(),
  confirmPreparedPhotoV3: vi.fn(),
  exportPieceV3: vi.fn(),
});

const renderDialog = ({
  currentPolicy = null,
  client = makeClient(),
  onClose = vi.fn(),
  onSaved = vi.fn(),
  onError = vi.fn(),
}: {
  currentPolicy?: StudioSpendPolicy | null;
  client?: ReturnType<typeof makeClient>;
  onClose?: ReturnType<typeof vi.fn>;
  onSaved?: ReturnType<typeof vi.fn>;
  onError?: ReturnType<typeof vi.fn>;
} = {}) => {
  render(
    <I18nextProvider i18n={testI18n}>
      <PilotSpendingLimitDialog
        open
        currentPolicy={currentPolicy}
        projectId='project_1'
        expectedAuthoringRevision={4}
        client={client satisfies PilotSpendingLimitClientV3}
        onClose={onClose}
        onSaved={onSaved}
        onError={onError}
      />
    </I18nextProvider>
  );
  return { client, onClose, onSaved, onError };
};

describe('inactive Creative Studio 4 Pilot project spending menu', () => {
  it('sets the exact per-request policy at the displayed authoring revision without starting paid work', async () => {
    const { client, onClose, onSaved } = renderDialog();

    fireEvent.change(screen.getByLabelText('Currency code'), { target: { value: 'usd' } });
    fireEvent.change(screen.getByLabelText('Maximum per batch (minor units)'), { target: { value: '275' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save limit' }));

    await waitFor(() =>
      expect(client.applyMutationBatchV3).toHaveBeenCalledWith({
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
        projectId: 'project_1',
        expectedAuthoringRevision: 4,
        operations: [
          {
            kind: 'set_spend_policy',
            policy: { currency: 'USD', maxPerBatchMinorUnits: 275 },
          },
        ],
      })
    );
    expect(onSaved).toHaveBeenCalledWith(mutationResult);
    expect(onClose).toHaveBeenCalledOnce();
    expect(client.preparePhotoV3).not.toHaveBeenCalled();
    expect(client.confirmPreparedPhotoV3).not.toHaveBeenCalled();
    expect(client.exportPieceV3).not.toHaveBeenCalled();
  });

  it('clears only the current policy through the typed mutation operation', async () => {
    const { client } = renderDialog({
      currentPolicy: { currency: 'EUR', maxPerBatchMinorUnits: 450 },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear limit' }));

    await waitFor(() =>
      expect(client.applyMutationBatchV3).toHaveBeenCalledWith({
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
        projectId: 'project_1',
        expectedAuthoringRevision: 4,
        operations: [{ kind: 'set_spend_policy', policy: null }],
      })
    );
  });

  it('accepts a zero ceiling and rejects malformed, negative, fractional, or unsafe limits', () => {
    renderDialog();
    const currency = screen.getByLabelText('Currency code');
    const minorUnits = screen.getByLabelText('Maximum per batch (minor units)');
    const save = screen.getByRole('button', { name: 'Save limit' });

    fireEvent.change(currency, { target: { value: 'US' } });
    fireEvent.change(minorUnits, { target: { value: '1' } });
    expect(save).toBeDisabled();

    fireEvent.change(currency, { target: { value: 'US1' } });
    expect(save).toBeDisabled();

    fireEvent.change(currency, { target: { value: 'USD' } });
    for (const invalid of ['-1', '1.5', String(Number.MAX_SAFE_INTEGER + 1)]) {
      fireEvent.change(minorUnits, { target: { value: invalid } });
      expect(save).toBeDisabled();
    }
    fireEvent.change(minorUnits, { target: { value: '0' } });
    expect(save).toBeEnabled();
  });

  it('reports a rejected policy mutation without closing or claiming it was saved', async () => {
    const refusal = new Error('stale_authoring_revision');
    const client = makeClient();
    client.applyMutationBatchV3.mockRejectedValueOnce(refusal);
    const { onClose, onSaved, onError } = renderDialog({ client });

    fireEvent.change(screen.getByLabelText('Currency code'), { target: { value: 'JPY' } });
    fireEvent.change(screen.getByLabelText('Maximum per batch (minor units)'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save limit' }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith(refusal));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
