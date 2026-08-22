/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  StudioConnectionCandidate,
  StudioConnectionCandidateModel,
  StudioConnectionIntegration,
  StudioConnectionIntegrationLabelKey,
  StudioConnectionRecord,
  StudioConnectionValidationFailureReason,
  StudioConnectionValidationResult,
  StudioConnectionValidationSuccess,
  StudioMediaKind,
  StudioRendererConnectionCapabilities,
  StudioSaveConnectionRequest,
} from '@/common/types/project/creativeStudioTypes';
import { Alert, AutoComplete, Button, Modal, Popconfirm, Select, Spin, Tag } from '@arco-design/web-react';
import { Plus, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CLOSED_CANDIDATE_MODEL_LABEL_KEYS } from '@/common/types/project/creativeStudioConnectionPlan';
import { useTranslation } from 'react-i18next';

type SafeCandidate = Pick<StudioConnectionCandidate, 'providerId' | 'providerName' | 'models' | 'integrationModels'>;
type SafeIntegration = StudioConnectionIntegration;
type SafeBinding = StudioConnectionRecord;
type SafeValidation = StudioConnectionValidationSuccess;
type SafeValidationAttempt =
  | { valid: true; validation: SafeValidation }
  | { valid: false; reason: StudioConnectionValidationFailureReason };
type EditorState = {
  visible: boolean;
  original: SafeBinding | null;
  kind: StudioMediaKind;
  providerId: string;
  integrationId: string;
  model: string;
};

export type StudioMediaModelsSectionProps = {
  providerRefreshToken: number;
  onAddProvider: () => void;
};

export const sanitizeStudioMediaModelCapabilities = (
  capabilities: StudioRendererConnectionCapabilities
): StudioRendererConnectionCapabilities => {
  const supportedDurationSeconds = Array.isArray(capabilities.supportedDurationSeconds)
    ? [...new Set(capabilities.supportedDurationSeconds)]
        .filter((value): value is number => Number.isInteger(value) && value >= 4 && value <= 15)
        .toSorted((left, right) => left - right)
    : [];
  return {
    mediaKinds: [...capabilities.mediaKinds],
    ...(capabilities.audioModes ? { audioModes: [...capabilities.audioModes] } : {}),
    ...(capabilities.aspectRatios ? { aspectRatios: [...capabilities.aspectRatios] } : {}),
    ...(capabilities.resolutions ? { resolutions: [...capabilities.resolutions] } : {}),
    ...(capabilities.minDurationSeconds === undefined ? {} : { minDurationSeconds: capabilities.minDurationSeconds }),
    ...(capabilities.maxDurationSeconds === undefined ? {} : { maxDurationSeconds: capabilities.maxDurationSeconds }),
    ...(supportedDurationSeconds.length === 0 ? {} : { supportedDurationSeconds }),
    ...(capabilities.supportsFirstFrame === undefined ? {} : { supportsFirstFrame: capabilities.supportsFirstFrame }),
    ...(Number.isInteger(capabilities.maxConditioningImages) &&
    capabilities.maxConditioningImages !== undefined &&
    capabilities.maxConditioningImages >= 0 &&
    capabilities.maxConditioningImages <= 6
      ? { maxConditioningImages: capabilities.maxConditioningImages }
      : {}),
  };
};

const CONNECTION_VALIDATION_FAILURE_REASONS = [
  'unsupported',
  'auth',
  'rate_limited',
  'provider_unavailable',
  'timeout',
  'invalid_response',
  'unknown',
] as const satisfies readonly StudioConnectionValidationFailureReason[];
const CONNECTION_VALIDATION_FAILURE_REASON_SET: ReadonlySet<unknown> = new Set(CONNECTION_VALIDATION_FAILURE_REASONS);
const CONNECTION_VALIDATION_FAILURE_KEYS = {
  unsupported: 'settings.mediaModels.validationFailure.unsupported',
  auth: 'settings.mediaModels.validationFailure.auth',
  rate_limited: 'settings.mediaModels.validationFailure.rateLimited',
  provider_unavailable: 'settings.mediaModels.validationFailure.providerUnavailable',
  timeout: 'settings.mediaModels.validationFailure.timeout',
  invalid_response: 'settings.mediaModels.validationFailure.invalidResponse',
  unknown: 'settings.mediaModels.validationFailure.unknown',
} as const satisfies Record<StudioConnectionValidationFailureReason, string>;

const sanitizeValidationFailureReason = (value: unknown): StudioConnectionValidationFailureReason =>
  CONNECTION_VALIDATION_FAILURE_REASON_SET.has(value) ? (value as StudioConnectionValidationFailureReason) : 'unknown';

const CONNECTION_INTEGRATION_LABEL_KEYS = [
  'imageApi',
  'bytePlusSeedance',
  'selfHostedVideoGateway',
  'openRouterVideo',
] as const satisfies readonly StudioConnectionIntegrationLabelKey[];
const CONNECTION_INTEGRATION_LABEL_KEY_SET: ReadonlySet<string> = new Set(CONNECTION_INTEGRATION_LABEL_KEYS);

const CANDIDATE_MODEL_HEALTH_PRIORITY: Record<StudioConnectionCandidateModel['health'], number> = {
  available: 0,
  unknown: 1,
  unavailable: 2,
};

const isCandidateModelHealth = (value: unknown): value is StudioConnectionCandidateModel['health'] =>
  value === 'available' || value === 'unknown' || value === 'unavailable';

const isSafeCandidateModelName = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  value === value.trim() &&
  !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return (
      codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || (codePoint >= 0xd800 && codePoint <= 0xdfff)
    );
  });

const sanitizeCandidateModels = (models: unknown): StudioConnectionCandidateModel[] => {
  if (!Array.isArray(models)) return [];
  const byModel = new Map<string, StudioConnectionCandidateModel>();
  for (const value of models) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const { model, health } = value as Record<string, unknown>;
    if (!isSafeCandidateModelName(model) || !isCandidateModelHealth(health)) continue;
    const existing = byModel.get(model);
    if (!existing || CANDIDATE_MODEL_HEALTH_PRIORITY[health] > CANDIDATE_MODEL_HEALTH_PRIORITY[existing.health]) {
      byModel.set(model, { model, health });
    }
  }
  return [...byModel.values()].toSorted((left, right) => left.model.localeCompare(right.model));
};

const sanitizeCandidateIntegrationModels = (rows: unknown): SafeCandidate['integrationModels'] => {
  if (!Array.isArray(rows)) return [];
  const byLabel = new Map<StudioConnectionIntegrationLabelKey, unknown[]>();
  for (const value of rows) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const { integrationLabelKey, models } = value as Record<string, unknown>;
    if (typeof integrationLabelKey !== 'string' || !CONNECTION_INTEGRATION_LABEL_KEY_SET.has(integrationLabelKey)) {
      continue;
    }
    const labelKey = integrationLabelKey as StudioConnectionIntegrationLabelKey;
    byLabel.set(labelKey, [...(byLabel.get(labelKey) ?? []), ...(Array.isArray(models) ? models : [])]);
  }
  return CONNECTION_INTEGRATION_LABEL_KEYS.flatMap((integrationLabelKey) =>
    byLabel.has(integrationLabelKey)
      ? [{ integrationLabelKey, models: sanitizeCandidateModels(byLabel.get(integrationLabelKey)) }]
      : []
  );
};

const sanitizeCandidate = (candidate: StudioConnectionCandidate): SafeCandidate => ({
  providerId: candidate.providerId,
  providerName: candidate.providerName,
  models: sanitizeCandidateModels(candidate.models),
  integrationModels: sanitizeCandidateIntegrationModels(candidate.integrationModels),
});

const sanitizeIntegration = (integration: StudioConnectionIntegration): SafeIntegration => ({
  integrationId: integration.integrationId,
  kind: integration.kind,
  labelKey: integration.labelKey,
});

const sanitizeBinding = (binding: StudioConnectionRecord): SafeBinding => ({
  bindingId: binding.bindingId,
  providerId: binding.providerId,
  integrationId: binding.integrationId,
  labelKey: binding.labelKey,
  model: binding.model,
  capabilities: sanitizeStudioMediaModelCapabilities(binding.capabilities),
  validatedAt: binding.validatedAt,
});

const sanitizeValidation = (validation: StudioConnectionValidationSuccess): SafeValidation => ({
  providerId: validation.providerId,
  integrationId: validation.integrationId,
  labelKey: validation.labelKey,
  model: validation.model,
  capabilities: sanitizeStudioMediaModelCapabilities(validation.capabilities),
  validatedAt: validation.validatedAt,
});

const supportsSilentGatewayOutput = (binding: Pick<SafeBinding, 'labelKey' | 'capabilities'>): boolean =>
  binding.labelKey !== 'selfHostedVideoGateway' || binding.capabilities.audioModes?.includes('none') === true;

const tupleMatches = (
  binding: Pick<SafeBinding, 'providerId' | 'integrationId' | 'model' | 'labelKey' | 'capabilities'>,
  request: StudioSaveConnectionRequest
): boolean =>
  binding.providerId === request.providerId &&
  binding.integrationId === request.integrationId &&
  binding.model === request.model &&
  supportsSilentGatewayOutput(binding);

const sameTuple = (left: SafeBinding, right: StudioSaveConnectionRequest): boolean =>
  left.providerId === right.providerId && left.integrationId === right.integrationId && left.model === right.model;

const replaceCanonicalBinding = (current: SafeBinding[], saved: SafeBinding): SafeBinding[] => [
  ...current.filter((item) => item.bindingId !== saved.bindingId && !sameTuple(item, saved)),
  saved,
];

const emptyEditor = (): EditorState => ({
  visible: false,
  original: null,
  kind: 'image',
  providerId: '',
  integrationId: '',
  model: '',
});

export const StudioMediaModelsSection: React.FC<StudioMediaModelsSectionProps> = ({
  providerRefreshToken,
  onAddProvider,
}) => {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<SafeCandidate[]>([]);
  const [integrations, setIntegrations] = useState<SafeIntegration[]>([]);
  const [bindings, setBindings] = useState<SafeBinding[]>([]);
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [validated, setValidated] = useState<SafeValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyConnectionIds, setBusyConnectionIds] = useState<readonly string[]>([]);
  const [listFailed, setListFailed] = useState(false);
  const [mutationFailed, setMutationFailed] = useState(false);
  const [editorValidationFailure, setEditorValidationFailure] =
    useState<StudioConnectionValidationFailureReason | null>(null);
  const [rowValidationFailure, setRowValidationFailure] = useState<StudioConnectionValidationFailureReason | null>(
    null
  );
  const requestSequence = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setListFailed(false);
    try {
      const [candidateResult, bindingResult] = await Promise.all([
        ipcBridge.creativeStudio.listConnectionCandidates.invoke(),
        ipcBridge.creativeStudio.listConnections.invoke(),
      ]);
      if (sequence !== requestSequence.current) return;
      if (candidateResult.ok === false || bindingResult.ok === false) {
        setListFailed(true);
        return;
      }
      setCandidates(candidateResult.data.map(sanitizeCandidate));
      setIntegrations(bindingResult.data.integrations.map(sanitizeIntegration));
      setBindings(bindingResult.data.connections.map(sanitizeBinding));
    } catch {
      if (sequence === requestSequence.current) setListFailed(true);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      requestSequence.current += 1;
    };
  }, [providerRefreshToken, refresh]);

  const availableIntegrations = useMemo(
    () => integrations.filter((integration) => integration.kind === editor.kind),
    [editor.kind, integrations]
  );
  const selectedCandidate = candidates.find((candidate) => candidate.providerId === editor.providerId) ?? null;
  const selectedIntegration = integrations.find((integration) => integration.integrationId === editor.integrationId);
  const integrationModels = selectedCandidate?.integrationModels.find(
    (models) => models.integrationLabelKey === selectedIntegration?.labelKey
  );
  const usesClosedCandidateModelSet =
    selectedIntegration !== undefined && CLOSED_CANDIDATE_MODEL_LABEL_KEYS.has(selectedIntegration.labelKey);
  const candidateModels =
    selectedCandidate && selectedIntegration
      ? (integrationModels?.models ?? (usesClosedCandidateModelSet ? [] : selectedCandidate.models))
      : [];
  const modelOptions = candidateModels.map(({ model }) => model);
  const closedModelIsSelectable = !usesClosedCandidateModelSet || modelOptions.includes(editor.model.trim());
  const request = useMemo<StudioSaveConnectionRequest | null>(() => {
    const normalizedModel = editor.model.trim();
    if (!editor.providerId || !editor.integrationId || !normalizedModel || !closedModelIsSelectable) return null;
    return {
      providerId: editor.providerId,
      integrationId: editor.integrationId,
      model: normalizedModel,
    };
  }, [closedModelIsSelectable, editor.integrationId, editor.model, editor.providerId]);
  const validationMatchesRequest = request !== null && validated !== null && tupleMatches(validated, request);
  const busy = validating || saving;

  const resetValidation = (): void => {
    setValidated(null);
    setEditorValidationFailure(null);
    setRowValidationFailure(null);
    setMutationFailed(false);
  };

  const openAdd = (): void => {
    const firstIntegration = integrations.find((integration) => integration.kind === 'image');
    setEditor({
      ...emptyEditor(),
      visible: true,
      integrationId: firstIntegration?.integrationId ?? '',
    });
    resetValidation();
  };

  const openEdit = (binding: SafeBinding): void => {
    const integration = integrations.find((item) => item.integrationId === binding.integrationId);
    setEditor({
      visible: true,
      original: binding,
      kind: integration?.kind ?? 'image',
      providerId: binding.providerId,
      integrationId: binding.integrationId,
      model: binding.model,
    });
    resetValidation();
  };

  const closeEditor = (): void => {
    if (busy) return;
    setEditor(emptyEditor());
    resetValidation();
  };

  const updateKind = (kind: StudioMediaKind): void => {
    const firstIntegration = integrations.find((integration) => integration.kind === kind);
    if (!firstIntegration) return;
    setEditor((current) => ({
      ...current,
      kind,
      integrationId: firstIntegration.integrationId,
      ...(current.kind === kind ? {} : { model: '' }),
    }));
    resetValidation();
  };

  const updateProvider = (providerId: string): void => {
    setEditor((current) => ({
      ...current,
      providerId,
      ...(current.providerId === providerId ? {} : { model: '' }),
    }));
    resetValidation();
  };

  const updateIntegration = (integrationId: string): void => {
    setEditor((current) => ({
      ...current,
      integrationId,
      ...(current.integrationId === integrationId ? {} : { model: '' }),
    }));
    resetValidation();
  };

  const updateModel = (model: string): void => {
    setEditor((current) => ({ ...current, model }));
    resetValidation();
  };

  const validateRequest = async (safeRequest: StudioSaveConnectionRequest): Promise<SafeValidationAttempt> => {
    try {
      const result = await ipcBridge.creativeStudio.validateConnection.invoke(safeRequest);
      if (result.ok === false) return { valid: false, reason: 'unknown' };
      const validation: StudioConnectionValidationResult = result.data;
      if (validation.valid === false) {
        return { valid: false, reason: sanitizeValidationFailureReason(validation.reason) };
      }
      const safeValidation = sanitizeValidation(validation.connection);
      return tupleMatches(safeValidation, safeRequest)
        ? { valid: true, validation: safeValidation }
        : { valid: false, reason: 'unknown' };
    } catch {
      return { valid: false, reason: 'unknown' };
    }
  };

  const validateEditor = async (): Promise<void> => {
    if (!request || busy) return;
    setValidating(true);
    setValidated(null);
    setEditorValidationFailure(null);
    setMutationFailed(false);
    const validation = await validateRequest(request);
    setValidated(validation.valid ? validation.validation : null);
    setEditorValidationFailure(validation.valid === false ? validation.reason : null);
    setValidating(false);
  };

  const saveRequest = async (safeRequest: StudioSaveConnectionRequest): Promise<SafeBinding | null> => {
    try {
      const result = await ipcBridge.creativeStudio.saveConnection.invoke(safeRequest);
      if (result.ok === false) return null;
      const safeBinding = sanitizeBinding(result.data);
      return tupleMatches(safeBinding, safeRequest) ? safeBinding : null;
    } catch {
      return null;
    }
  };

  const saveEditor = async (): Promise<void> => {
    if (!request || !validationMatchesRequest || busy) return;
    setSaving(true);
    setMutationFailed(false);
    const saved = await saveRequest(request);
    if (!saved) {
      setMutationFailed(true);
      await refresh();
      setSaving(false);
      return;
    }

    const original = editor.original;
    setBindings((current) => replaceCanonicalBinding(current, saved));
    if (original && !sameTuple(original, request)) {
      try {
        const removeResult = await ipcBridge.creativeStudio.removeConnection.invoke({
          bindingId: original.bindingId,
        });
        if (removeResult.ok === false || !removeResult.data) {
          setMutationFailed(true);
          await refresh();
          setSaving(false);
          setEditor(emptyEditor());
          setValidated(null);
          return;
        }
        setBindings((current) => current.filter((item) => item.bindingId !== original.bindingId));
      } catch {
        setMutationFailed(true);
        await refresh();
        setSaving(false);
        setEditor(emptyEditor());
        setValidated(null);
        return;
      }
    }
    setSaving(false);
    setEditor(emptyEditor());
    setValidated(null);
  };

  const revalidate = async (binding: SafeBinding): Promise<void> => {
    if (busyConnectionIds.includes(binding.bindingId)) return;
    setBusyConnectionIds((current) => [...current, binding.bindingId]);
    setMutationFailed(false);
    setRowValidationFailure(null);
    const safeRequest: StudioSaveConnectionRequest = {
      providerId: binding.providerId,
      integrationId: binding.integrationId,
      model: binding.model,
    };
    const validation = await validateRequest(safeRequest);
    if (validation.valid === false) {
      setRowValidationFailure(validation.reason);
      setBusyConnectionIds((current) => current.filter((id) => id !== binding.bindingId));
      return;
    }
    const saved = await saveRequest(safeRequest);
    if (!saved) {
      setMutationFailed(true);
      await refresh();
    } else {
      setBindings((current) => replaceCanonicalBinding(current, saved));
    }
    setBusyConnectionIds((current) => current.filter((id) => id !== binding.bindingId));
  };

  const remove = async (bindingId: string): Promise<void> => {
    if (busyConnectionIds.includes(bindingId)) return;
    setBusyConnectionIds((current) => [...current, bindingId]);
    setMutationFailed(false);
    setRowValidationFailure(null);
    try {
      const result = await ipcBridge.creativeStudio.removeConnection.invoke({ bindingId });
      if (result.ok === false || !result.data) {
        setMutationFailed(true);
        await refresh();
      } else {
        setBindings((current) => current.filter((binding) => binding.bindingId !== bindingId));
      }
    } catch {
      setMutationFailed(true);
      await refresh();
    } finally {
      setBusyConnectionIds((current) => current.filter((id) => id !== bindingId));
    }
  };

  const editorFooter = (
    <div className='flex justify-end gap-8px'>
      <Button disabled={busy} onClick={closeEditor}>
        {t('settings.mediaModels.cancel')}
      </Button>
      <Button
        type='primary'
        loading={saving}
        disabled={!validationMatchesRequest || busy}
        onClick={() => void saveEditor()}
      >
        {t('settings.mediaModels.save')}
      </Button>
    </div>
  );

  return (
    <section aria-labelledby='studio-media-models-title' className='mt-24px flex flex-col gap-12px'>
      <div className='flex flex-wrap items-start justify-between gap-12px border-t border-border-2 pt-20px'>
        <div className='min-w-0'>
          <h2 id='studio-media-models-title' className='m-0 text-16px font-600 text-t-primary'>
            {t('settings.mediaModels.title')}
          </h2>
          <p className='mb-0 mt-4px text-13px text-t-secondary'>{t('settings.mediaModels.description')}</p>
        </div>
        <Button type='primary' icon={<Plus />} onClick={openAdd}>
          {t('settings.mediaModels.add')}
        </Button>
      </div>

      {listFailed && (
        <div className='flex flex-col gap-8px'>
          <Alert type='error' content={t('settings.mediaModels.loadFailed')} />
          <Button icon={<Refresh />} onClick={() => void refresh()}>
            {t('settings.mediaModels.refresh')}
          </Button>
        </div>
      )}
      {rowValidationFailure && (
        <Alert type='error' content={t(CONNECTION_VALIDATION_FAILURE_KEYS[rowValidationFailure])} />
      )}
      {mutationFailed && <Alert type='error' content={t('settings.mediaModels.validationFailed')} />}

      {listFailed && bindings.length === 0 ? null : loading && bindings.length === 0 ? (
        <div className='flex min-h-80px items-center justify-center'>
          <Spin />
        </div>
      ) : bindings.length === 0 ? (
        <div className='flex flex-col items-start gap-10px rounded-8px border border-border-2 bg-fill-1 p-14px'>
          <span className='text-13px text-t-secondary'>{t('settings.mediaModels.empty')}</span>
          <Button onClick={onAddProvider}>{t('settings.mediaModels.addProvider')}</Button>
        </div>
      ) : (
        <ul aria-label={t('settings.mediaModels.title')} className='m-0 flex list-none flex-col gap-8px p-0'>
          {bindings.map((binding) => {
            const candidate = candidates.find((item) => item.providerId === binding.providerId);
            const integration = integrations.find((item) => item.integrationId === binding.integrationId);
            const kind = integration?.kind ?? binding.capabilities.mediaKinds[0] ?? 'image';
            const rowBusy = busyConnectionIds.includes(binding.bindingId);
            return (
              <li
                key={binding.bindingId}
                aria-label={binding.model}
                className='rounded-8px border border-border-2 bg-fill-1 p-12px'
              >
                <div className='flex flex-wrap items-start justify-between gap-12px'>
                  <dl className='m-0 grid min-w-0 flex-1 grid-cols-[max-content_minmax(0,1fr)] gap-x-10px gap-y-5px'>
                    <dt className='text-11px text-t-tertiary'>{t('settings.mediaModels.outputType')}</dt>
                    <dd className='m-0 text-12px text-t-primary'>{t(`settings.mediaModels.${kind}`)}</dd>
                    <dt className='text-11px text-t-tertiary'>{t('settings.mediaModels.provider')}</dt>
                    <dd className='m-0 break-all text-12px text-t-primary'>
                      {candidate?.providerName ?? binding.providerId}
                      {!candidate && (
                        <Tag className='ml-6px' color='orange'>
                          {t('settings.mediaModels.unavailable')}
                        </Tag>
                      )}
                    </dd>
                    <dt className='text-11px text-t-tertiary'>{t('settings.mediaModels.integrationLabel')}</dt>
                    <dd className='m-0 text-12px text-t-primary'>
                      {t(`settings.mediaModels.integration.${binding.labelKey}`)}
                    </dd>
                    <dt className='text-11px text-t-tertiary'>{t('settings.mediaModels.model')}</dt>
                    <dd className='m-0 break-all text-12px text-t-primary'>{binding.model}</dd>
                    <dt className='text-11px text-t-tertiary'>{t('settings.mediaModels.validatedAt')}</dt>
                    <dd className='m-0 text-12px text-t-secondary'>
                      <time dateTime={binding.validatedAt}>{new Date(binding.validatedAt).toLocaleString()}</time>
                    </dd>
                  </dl>
                  <div className='flex flex-wrap gap-6px'>
                    <Button size='mini' disabled={rowBusy} onClick={() => openEdit(binding)}>
                      {t('settings.mediaModels.edit')}
                    </Button>
                    <Button size='mini' loading={rowBusy} disabled={rowBusy} onClick={() => void revalidate(binding)}>
                      {t('settings.mediaModels.revalidate')}
                    </Button>
                    <Popconfirm
                      title={t('settings.mediaModels.removeConfirm')}
                      onOk={() => void remove(binding.bindingId)}
                    >
                      <Button size='mini' status='danger' disabled={rowBusy}>
                        {t('settings.mediaModels.remove')}
                      </Button>
                    </Popconfirm>
                  </div>
                </div>
                {supportsSilentGatewayOutput(binding) && binding.labelKey === 'selfHostedVideoGateway' && (
                  <div className='mt-8px'>
                    <Tag color='green'>{t('settings.mediaModels.silentOutputSupported')}</Tag>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        visible={editor.visible}
        title={t(editor.original ? 'settings.mediaModels.editTitle' : 'settings.mediaModels.addTitle')}
        footer={editorFooter}
        closable={!busy}
        maskClosable={!busy}
        escToExit={!busy}
        unmountOnExit
        onCancel={closeEditor}
      >
        <div className='flex flex-col gap-12px'>
          <div className='flex flex-col gap-6px text-12px text-t-secondary'>
            {t('settings.mediaModels.outputType')}
            <Select
              aria-label={t('settings.mediaModels.outputType')}
              value={editor.kind}
              disabled={busy}
              onChange={(value) => updateKind(value as StudioMediaKind)}
            >
              <Select.Option value='image'>{t('settings.mediaModels.image')}</Select.Option>
              <Select.Option value='video'>{t('settings.mediaModels.video')}</Select.Option>
            </Select>
          </div>
          <div className='flex flex-col gap-6px text-12px text-t-secondary'>
            {t('settings.mediaModels.provider')}
            <Select
              aria-label={t('settings.mediaModels.provider')}
              value={editor.providerId || undefined}
              disabled={busy}
              onChange={(value) => updateProvider(String(value))}
            >
              {candidates.map((candidate) => (
                <Select.Option key={candidate.providerId} value={candidate.providerId}>
                  {candidate.providerName}
                </Select.Option>
              ))}
            </Select>
          </div>
          <div className='flex flex-col gap-6px text-12px text-t-secondary'>
            {t('settings.mediaModels.integrationLabel')}
            <Select
              aria-label={t('settings.mediaModels.integrationLabel')}
              value={editor.integrationId || undefined}
              disabled={busy}
              onChange={(value) => updateIntegration(String(value))}
            >
              {availableIntegrations.map((integration) => (
                <Select.Option key={integration.integrationId} value={integration.integrationId}>
                  {t(`settings.mediaModels.integration.${integration.labelKey}`)}
                </Select.Option>
              ))}
            </Select>
          </div>
          <label className='flex flex-col gap-6px text-12px text-t-secondary'>
            {t('settings.mediaModels.model')}
            {usesClosedCandidateModelSet ? (
              <Select
                aria-label={t('settings.mediaModels.model')}
                value={editor.model || undefined}
                disabled={!editor.providerId || busy || modelOptions.length === 0}
                placeholder={t('settings.mediaModels.modelPlaceholder')}
                showSearch
                onChange={(value) => updateModel(String(value))}
              >
                {modelOptions.map((model) => (
                  <Select.Option key={model} value={model}>
                    {model}
                  </Select.Option>
                ))}
              </Select>
            ) : (
              <AutoComplete
                value={editor.model}
                data={modelOptions}
                disabled={!editor.providerId || busy}
                placeholder={t('settings.mediaModels.modelPlaceholder')}
                inputProps={{
                  'aria-label': t('settings.mediaModels.model'),
                }}
                onChange={updateModel}
              />
            )}
          </label>
          <Button long loading={validating} disabled={request === null || busy} onClick={() => void validateEditor()}>
            {t(validating ? 'settings.mediaModels.validating' : 'settings.mediaModels.validate')}
          </Button>
          {validated && validationMatchesRequest && (
            <Alert type='success' content={t('settings.mediaModels.validationSuccess')} />
          )}
          {!validating && request && editorValidationFailure && (
            <Alert type='error' content={t(CONNECTION_VALIDATION_FAILURE_KEYS[editorValidationFailure])} />
          )}
        </div>
      </Modal>
    </section>
  );
};
