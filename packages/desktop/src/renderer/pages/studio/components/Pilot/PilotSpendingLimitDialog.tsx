/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
  type StudioApplyMutationBatchRequestV3,
  type StudioApplyMutationBatchResultV3,
  type StudioSpendPolicy,
} from '@/common/types/project/creativeStudioTypes';
import { Button, Input, Modal } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './PilotSpendingLimitDialog.module.css';

export type PilotSpendingLimitClientV3 = {
  applyMutationBatchV3(input: StudioApplyMutationBatchRequestV3): Promise<StudioApplyMutationBatchResultV3>;
};

export type PilotSpendingLimitDialogProps = {
  open: boolean;
  currentPolicy: StudioSpendPolicy | null;
  projectId: string;
  expectedAuthoringRevision: number;
  client: PilotSpendingLimitClientV3;
  onClose: () => void;
  onSaved: (result: StudioApplyMutationBatchResultV3) => void;
  onError: (error: unknown) => void;
};

const draftFromPolicy = (policy: StudioSpendPolicy | null): { currency: string; minorUnits: string } => ({
  currency: policy?.currency ?? '',
  minorUnits: policy === null ? '' : String(policy.maxPerBatchMinorUnits),
});

const parseMinorUnits = (value: string): number | null => {
  if (!/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

/** Human-owned schema-6 per-batch spending policy editor. */
export const PilotSpendingLimitDialog: React.FC<PilotSpendingLimitDialogProps> = ({
  open,
  currentPolicy,
  projectId,
  expectedAuthoringRevision,
  client,
  onClose,
  onSaved,
  onError,
}) => {
  const { t } = useTranslation();
  const initialDraft = useMemo(() => draftFromPolicy(currentPolicy), [currentPolicy]);
  const [currency, setCurrency] = useState(initialDraft.currency);
  const [minorUnits, setMinorUnits] = useState(initialDraft.minorUnits);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCurrency(initialDraft.currency);
    setMinorUnits(initialDraft.minorUnits);
  }, [initialDraft, open]);

  const parsedMinorUnits = parseMinorUnits(minorUnits);
  const validCurrency = /^[A-Z]{3}$/.test(currency);
  const nextPolicy =
    validCurrency && parsedMinorUnits !== null
      ? ({ currency, maxPerBatchMinorUnits: parsedMinorUnits } satisfies StudioSpendPolicy)
      : null;
  const unchanged =
    nextPolicy !== null &&
    currentPolicy !== null &&
    nextPolicy.currency === currentPolicy.currency &&
    nextPolicy.maxPerBatchMinorUnits === currentPolicy.maxPerBatchMinorUnits;

  const submit = async (policy: StudioSpendPolicy | null): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await client.applyMutationBatchV3({
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION_V3,
        projectId,
        expectedAuthoringRevision,
        operations: [{ kind: 'set_spend_policy', policy }],
      });
      onSaved(result);
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={open}
      title={t('conversation.creativeStudio.pilot.spending.title')}
      unmountOnExit
      maskClosable={false}
      onCancel={() => {
        if (!saving) onClose();
      }}
      footer={
        <div className={styles.actions}>
          <Button disabled={saving} onClick={onClose}>
            {t('conversation.creativeStudio.pilot.common.cancel')}
          </Button>
          <Button disabled={saving || currentPolicy === null} onClick={() => void submit(null)}>
            {t('conversation.creativeStudio.pilot.spending.clear')}
          </Button>
          <Button
            type='primary'
            loading={saving}
            disabled={saving || nextPolicy === null || unchanged}
            onClick={() => {
              if (nextPolicy !== null) void submit(nextPolicy);
            }}
          >
            {t('conversation.creativeStudio.pilot.spending.save')}
          </Button>
        </div>
      }
    >
      <div className={styles.body}>
        <p className={styles.description}>{t('conversation.creativeStudio.pilot.spending.description')}</p>
        <label className={styles.field} htmlFor='pilot-spending-limit-currency'>
          <span>{t('conversation.creativeStudio.pilot.spending.currency')}</span>
          <Input
            id='pilot-spending-limit-currency'
            value={currency}
            dir='ltr'
            maxLength={3}
            autoCapitalize='characters'
            spellCheck={false}
            disabled={saving}
            aria-invalid={currency.length > 0 && !validCurrency}
            onChange={(value) => setCurrency(value.toUpperCase())}
          />
        </label>
        <label className={styles.field} htmlFor='pilot-spending-limit-minor-units'>
          <span>{t('conversation.creativeStudio.pilot.spending.maximum')}</span>
          <Input
            id='pilot-spending-limit-minor-units'
            value={minorUnits}
            dir='ltr'
            inputMode='numeric'
            disabled={saving}
            aria-invalid={minorUnits.length > 0 && parsedMinorUnits === null}
            onChange={setMinorUnits}
          />
        </label>
        {(currency.length > 0 && !validCurrency) || (minorUnits.length > 0 && parsedMinorUnits === null) ? (
          <p role='alert' className={styles.error}>
            {t('conversation.creativeStudio.pilot.spending.invalid')}
          </p>
        ) : null}
      </div>
    </Modal>
  );
};
