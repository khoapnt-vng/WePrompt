/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  resolveActiveStudioBriefReferences,
  STUDIO_MAX_ACTIVE_BRIEF_REFERENCES,
} from '@/common/types/project/creativeStudioManagedAssetCollections';
import type {
  StudioAsset,
  StudioBriefReferenceRole,
  StudioRendererProject,
} from '@/common/types/project/creativeStudioTypes';
import { createManagedStudioAssetUrl } from '../../Preview';
import type { UseStudioModelsResult } from '../../../hooks/useStudioModels';
import { getProjectEngineSlots } from '../../EngineStrip/engineState';
import styles from './StudioBriefReferences.module.css';

export type StudioBriefReferencesProps = {
  project: StudioRendererProject;
  models: UseStudioModelsResult;
  pending: boolean;
  issueMessageKey: string | null;
  onAdd: (role: StudioBriefReferenceRole) => Promise<string | null>;
  onRemove: (assetId: string) => Promise<boolean>;
  openModelSettings: () => void;
};

type FocusIntent =
  | { kind: 'remove'; assetId: string; fallbackRole: StudioBriefReferenceRole }
  | { kind: 'add'; role: StudioBriefReferenceRole };

const referenceKey = (leaf: string): string => `conversation.creativeStudio.briefReferences.${leaf}`;

export const StudioBriefReferences: React.FC<StudioBriefReferencesProps> = ({
  project,
  models,
  pending,
  issueMessageKey,
  onAdd,
  onRemove,
  openModelSettings,
}) => {
  const { t } = useTranslation();
  const instanceId = useId();
  const titleId = `studio-brief-references-${instanceId}-title`;
  const limitId = `studio-brief-references-${instanceId}-limit`;
  const addCastRef = useRef<HTMLButtonElement>(null);
  const addLookRef = useRef<HTMLButtonElement>(null);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const [focusIntent, setFocusIntent] = useState<FocusIntent | null>(null);
  const resolved = useMemo(() => resolveActiveStudioBriefReferences(project.assets), [project.assets]);
  const active = resolved ?? [];
  const cast = active.filter((asset) => asset.briefReferenceRole === 'cast');
  const look = active.filter((asset) => asset.briefReferenceRole === 'look');
  const atLimit = active.length >= STUDIO_MAX_ACTIVE_BRIEF_REFERENCES;
  const imageSlot = useMemo(() => getProjectEngineSlots(models.catalog, project)[0], [models.catalog, project]);
  const imageMaximum = imageSlot.state === 'ready' ? imageSlot.maxConditioningImages : null;

  const addRef = (role: StudioBriefReferenceRole): React.RefObject<HTMLButtonElement | null> =>
    role === 'cast' ? addCastRef : addLookRef;

  useEffect(() => {
    if (focusIntent === null) return;
    const target =
      focusIntent.kind === 'remove'
        ? (removeRefs.current.get(focusIntent.assetId) ?? addRef(focusIntent.fallbackRole).current)
        : addRef(focusIntent.role).current;
    target?.focus();
    setFocusIntent(null);
  }, [active, focusIntent]);

  const add = async (role: StudioBriefReferenceRole): Promise<void> => {
    const importedAssetId = await onAdd(role);
    setFocusIntent(
      importedAssetId === null
        ? { kind: 'add', role }
        : { kind: 'remove', assetId: importedAssetId, fallbackRole: role }
    );
  };

  const remove = async (asset: StudioAsset, roleAssets: StudioAsset[]): Promise<void> => {
    const index = roleAssets.findIndex(({ id }) => id === asset.id);
    const nextAssetId = roleAssets[index + 1]?.id ?? roleAssets[index - 1]?.id ?? null;
    const removed = await onRemove(asset.id);
    if (!removed) {
      removeRefs.current.get(asset.id)?.focus();
      return;
    }
    setFocusIntent(
      nextAssetId === null
        ? { kind: 'add', role: asset.briefReferenceRole! }
        : { kind: 'remove', assetId: nextAssetId, fallbackRole: asset.briefReferenceRole! }
    );
  };

  const renderGroup = (role: StudioBriefReferenceRole, assets: StudioAsset[]): React.ReactNode => {
    const roleHeading = t(referenceKey(role === 'cast' ? 'castHeading' : 'lookHeading'));
    const addLabel = t(referenceKey(role === 'cast' ? 'addCast' : 'addLook'));
    const emptyLabel = t(referenceKey(role === 'cast' ? 'castEmpty' : 'lookEmpty'));
    return (
      <section role='group' aria-label={roleHeading} className={styles.group}>
        <div className={styles.groupHeader}>
          <h3>{roleHeading}</h3>
          <Button
            ref={role === 'cast' ? addCastRef : addLookRef}
            size='small'
            disabled={pending || atLimit}
            aria-describedby={atLimit ? limitId : undefined}
            onClick={() => void add(role)}
          >
            {addLabel}
          </Button>
        </div>
        {assets.length === 0 ? <p className={styles.empty}>{emptyLabel}</p> : null}
        <div className={styles.cards}>
          {assets.map((asset) => {
            const label = asset.briefReferenceLabel!;
            const previewSource = createManagedStudioAssetUrl(project.id, asset.id);
            return (
              <article key={asset.id} className={styles.card}>
                {previewSource === null ? null : (
                  <img
                    className={styles.preview}
                    src={previewSource}
                    alt={t(referenceKey('previewAccessible'), { role: roleHeading, label })}
                  />
                )}
                <div className={styles.cardBody}>
                  <span className={styles.label}>{label}</span>
                  <Button
                    ref={(node) => {
                      const button = node as HTMLButtonElement | null;
                      if (button === null) removeRefs.current.delete(asset.id);
                      else removeRefs.current.set(asset.id, button);
                    }}
                    type='text'
                    size='small'
                    disabled={pending}
                    aria-label={t(referenceKey('removeAccessible'), { label })}
                    onClick={() => void remove(asset, assets)}
                  >
                    {t(referenceKey('removeFromBrief'))}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <section role='region' aria-labelledby={titleId} className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headingCopy}>
          <h2 id={titleId}>{t(referenceKey('title'))}</h2>
          <p>{t(referenceKey('inheritanceDescription'))}</p>
        </div>
        <span className={styles.count}>{t(referenceKey('activeCount'), { count: active.length })}</span>
      </div>
      {renderGroup('cast', cast)}
      {renderGroup('look', look)}
      {atLimit ? (
        <p id={limitId} className={styles.notice}>
          {t(referenceKey('limitReached'))}
        </p>
      ) : null}
      {imageMaximum === 0 ? (
        <div className={styles.notice}>
          <p>{t(referenceKey('engineCapacityNone'))}</p>
          <Button type='text' size='small' onClick={openModelSettings}>
            {t('conversation.creativeStudio.models.engine.manage')}
          </Button>
        </div>
      ) : null}
      {imageMaximum !== null && imageMaximum > 0 && active.length > imageMaximum ? (
        <p className={styles.notice}>
          {t(referenceKey('capacityMismatch'), { count: active.length, maximum: imageMaximum })}
        </p>
      ) : null}
      {issueMessageKey === null ? null : (
        <p role='alert' className={styles.error}>
          {t(issueMessageKey)}
        </p>
      )}
    </section>
  );
};
