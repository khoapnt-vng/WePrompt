/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button } from '@arco-design/web-react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ipcBridge } from '@/common';
import { STUDIO_MAX_ACTIVE_BRIEF_REFERENCES } from '@/common/types/project/creativeStudioManagedAssetCollections';
import type { StudioBriefReferenceRole } from '@/common/types/project/creativeStudioTypes';
import { createManagedStudioAssetUrl } from '@/renderer/pages/studio/studioManagedAssetUrl';

const ROOT = 'conversation.creativeStudio.briefReferences';

export type ProjectReferenceItem = {
  assetId: string;
  label: string;
  role: StudioBriefReferenceRole;
};

export type ProjectReferencesProps = {
  projectId: string;
  projectRevision: number;
  references: readonly ProjectReferenceItem[];
  /** The bound image engine's reference capacity, or null while no engine is bound. */
  maxConditioningImages: number | null;
  disabled?: boolean;
  className?: string;
  /**
   * Optional: the import and detach commands both notify `projectUpdated`, so the project reloads on
   * its own. This exists for owners that want to react to a change the panel actually made, and is
   * deliberately not called when the user cancels the file dialog.
   */
  onChanged?: () => void | Promise<void>;
};

/**
 * The only surface that can put a Cast or Look reference into a project.
 *
 * Everything downstream of it already existed — the import and detach IPC, the per-Shot reference
 * picker in the Beat panel, and the seed-still request that carries the chosen reference — but the
 * picker had no way to acquire an option, so it was permanently empty. Video requests cannot carry a
 * reference by design, so a subject reaches a whole chain through its head Shot's seed still.
 */
export const ProjectReferences: React.FC<ProjectReferencesProps> = ({
  projectId,
  projectRevision,
  references,
  maxConditioningImages,
  disabled = false,
  className,
  onChanged,
}) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const activeCount = references.length;
  const atLimit = activeCount >= STUDIO_MAX_ACTIVE_BRIEF_REFERENCES;
  const engineTakesNone = maxConditioningImages === 0;
  const overCapacity =
    maxConditioningImages !== null && maxConditioningImages > 0 && activeCount > maxConditioningImages;
  const addDisabled = disabled || busy !== null || atLimit || engineTakesNone;

  const importReference = useCallback(
    async (role: StudioBriefReferenceRole): Promise<void> => {
      setBusy(role);
      setFailed(false);
      try {
        const result = await ipcBridge.creativeStudio.chooseAndImportReference.invoke({
          projectId,
          briefReferenceRole: role,
          expectedRevision: projectRevision,
        });
        // Cancelling the file dialog is a decision, not a failure, and must not read as one.
        if (result.ok === false) {
          setFailed(true);
          return;
        }
        if (result.data.status !== 'imported') return;
        await onChanged?.();
      } catch {
        setFailed(true);
      } finally {
        setBusy(null);
      }
    },
    [onChanged, projectId, projectRevision]
  );

  const removeReference = useCallback(
    async (assetId: string): Promise<void> => {
      setBusy(assetId);
      setFailed(false);
      try {
        const result = await ipcBridge.creativeStudio.detachBriefReference.invoke({
          projectId,
          assetId,
          expectedRevision: projectRevision,
        });
        if (result.ok === false) {
          setFailed(true);
          return;
        }
        await onChanged?.();
      } catch {
        setFailed(true);
      } finally {
        setBusy(null);
      }
    },
    [onChanged, projectId, projectRevision]
  );

  const roleSection = (role: StudioBriefReferenceRole): React.ReactNode => {
    const held = references.filter((item) => item.role === role);
    const headingKey = role === 'cast' ? 'castHeading' : 'lookHeading';
    const emptyKey = role === 'cast' ? 'castEmpty' : 'lookEmpty';
    const addKey = role === 'cast' ? 'addCast' : 'addLook';
    return (
      <div className='flex flex-col gap-8px' data-studio-reference-role={role} key={role}>
        <h4>{t(`${ROOT}.${headingKey}`)}</h4>
        {held.length === 0 ? (
          <p>{t(`${ROOT}.${emptyKey}`)}</p>
        ) : (
          <ul className='flex flex-col gap-8px'>
            {held.map((item) => (
              <li className='flex items-center gap-8px' key={item.assetId}>
                <img
                  alt={t(`${ROOT}.previewAccessible`, { role: t(`${ROOT}.${headingKey}`), label: item.label })}
                  className='w-48px h-48px object-cover rd-4px'
                  src={createManagedStudioAssetUrl(projectId, item.assetId)}
                />
                <span className='flex-1'>
                  <bdi dir='auto'>{item.label}</bdi>
                </span>
                <Button
                  aria-label={t(`${ROOT}.removeAccessible`, { label: item.label })}
                  disabled={disabled || busy !== null}
                  onClick={() => void removeReference(item.assetId)}
                  size='small'
                >
                  {t(`${ROOT}.removeFromBrief`)}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button disabled={addDisabled} onClick={() => void importReference(role)}>
          {t(`${ROOT}.${addKey}`)}
        </Button>
      </div>
    );
  };

  return (
    <section className={className ?? 'flex flex-col gap-12px'} data-studio-project-references>
      <h3>{t(`${ROOT}.title`)}</h3>
      <p>{t(`${ROOT}.inheritanceDescription`)}</p>
      <p>{t(`${ROOT}.activeCount`, { count: activeCount })}</p>
      {failed ? <Alert content={t(`${ROOT}.importError`)} type='error' /> : null}
      {engineTakesNone ? <Alert content={t(`${ROOT}.engineCapacityNone`)} type='warning' /> : null}
      {overCapacity ? (
        <Alert
          content={t(`${ROOT}.capacityMismatch`, { count: activeCount, maximum: maxConditioningImages })}
          type='warning'
        />
      ) : null}
      {atLimit ? <Alert content={t(`${ROOT}.limitReached`)} type='warning' /> : null}
      {roleSection('cast')}
      {roleSection('look')}
    </section>
  );
};
