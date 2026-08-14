/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Dropdown, Menu, Spin, Tooltip } from '@arco-design/web-react';
import React, { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { UseStudioModelsResult } from '../../hooks/useStudioModels';
import type { StudioRendererProject, StudioRouteCatalogEntry } from '@/common/types/project/creativeStudioTypes';

import { integrationTranslationKey, type EngineSlotView } from './engineState';
import styles from './EngineStrip.module.css';

export type EngineSlotProps = {
  slot: EngineSlotView;
  project: Pick<StudioRendererProject, 'aspectRatio' | 'resolution'>;
  models: UseStudioModelsResult;
  locked: boolean;
  openModelSettings: (path: '/settings/model') => void;
  onCommitted: (model: string) => void;
};

const engineKey = (leaf: string): string => `conversation.creativeStudio.models.engine.${leaf}`;

export const EngineSlot: React.FC<EngineSlotProps> = ({
  slot,
  project,
  models,
  locked,
  openModelSettings,
  onCommitted,
}) => {
  const { t } = useTranslation();
  const instanceId = useId();
  const [visible, setVisible] = useState(false);
  const [opening, setOpening] = useState(false);
  const roleLabel = t(engineKey(slot.role === 'image' ? 'roleImage' : 'roleVideo'));
  const roleHint = t(engineKey(slot.role === 'image' ? 'roleImageHint' : 'roleVideoHint'));
  const roleId = `studio-engine-${slot.role}-${instanceId}-label`;
  const detailId = `studio-engine-${slot.role}-${instanceId}-detail`;
  const pending = models.pendingRole !== null;
  const isPendingRole = models.pendingRole === slot.role;
  const disabled = locked || pending;

  const routeSummary = (route: StudioRouteCatalogEntry): string => {
    const duration = t(engineKey('durationRange'), {
      min: route.constraints.minDurationSeconds,
      max: route.constraints.maxDurationSeconds,
    });
    return t(engineKey('summary'), {
      resolution: route.constraints.resolutions.join(', '),
      duration,
      audio: t(engineKey(route.constraints.silentOutput ? 'audioSilent' : 'audioOn')),
      frame: t(engineKey(route.constraints.supportsFirstFrame ? 'frameYes' : 'frameNo')),
    });
  };

  const selectedRouteSummary = (route: StudioRouteCatalogEntry): string =>
    slot.role === 'image'
      ? t(engineKey('summaryImage'), {
          resolution: route.constraints.resolutions.join(', '),
          frame: t(engineKey(route.constraints.supportsFirstFrame ? 'frameYes' : 'frameNo')),
        })
      : routeSummary(route);

  const copy = useMemo(() => {
    switch (slot.state) {
      case 'unloaded':
        return { primary: t(engineKey('catalogUnloaded')), detail: t(engineKey('catalogUnloaded')) };
      case 'not_set':
        return {
          primary: t(engineKey(slot.role === 'image' ? 'notSetImage' : 'notSetVideo')),
          detail: t(engineKey('notSetCount'), { count: slot.availableCount }),
        };
      case 'no_fit':
        return {
          primary: t(engineKey(slot.role === 'image' ? 'noFitImage' : 'noFitVideo')),
          detail: t(engineKey('noFitHint'), { ratio: project.aspectRatio, resolution: project.resolution }),
        };
      case 'ready':
        return { primary: slot.selectedRoute.model, detail: selectedRouteSummary(slot.selectedRoute) };
      case 'retired':
        return {
          primary: slot.selectedModel,
          detail: `${t(engineKey('retired'), { model: slot.selectedModel })} ${t(engineKey('retiredAction'))}`,
        };
      case 'needs_setup':
        return {
          primary: slot.selectedModel,
          detail: `${t(engineKey('needsSetup'), { provider: slot.providerName })} ${t(engineKey('needsSetupHint'))}`,
        };
      case 'health':
        return {
          primary: slot.selectedModel,
          detail: t(engineKey('notAnswering'), { model: slot.selectedModel }),
        };
      case 'frame':
        return {
          primary: slot.selectedModel,
          detail: t(engineKey('frameMismatch'), {
            model: slot.selectedModel,
            ratio: slot.aspectRatio,
            resolution: slot.resolution,
          }),
        };
    }
    // Translation identity is intentionally in the dependencies: a locale switch must rebuild the whole disclosure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.aspectRatio, project.resolution, slot, t]);

  const disabledExplanation = locked
    ? t(engineKey('lockedDuringReview'))
    : isPendingRole
      ? t(engineKey('saving'))
      : pending
        ? t(engineKey('savingOther'))
        : null;
  const description = disabledExplanation ?? copy.detail;
  const triggerText = isPendingRole
    ? t(engineKey('saving'))
    : slot.state === 'not_set' && slot.prearmedRoute !== null
      ? slot.prearmedRoute.model
      : copy.primary;
  const triggerLabel = isPendingRole ? t(engineKey('saving')) : copy.primary;

  const refreshBeforeOpen = async (): Promise<void> => {
    setOpening(true);
    try {
      await models.refresh();
      setVisible(true);
    } finally {
      setOpening(false);
    }
  };

  const handleVisibleChange = (nextVisible: boolean): void => {
    if (!nextVisible) {
      setVisible(false);
      return;
    }
    if (disabled || opening) return;
    void refreshBeforeOpen();
  };

  const selectRoute = async (choiceId: string): Promise<void> => {
    const route = slot.options.find((candidate) => candidate.choiceId === choiceId);
    if (route === undefined) return;
    setVisible(false);
    const committed = await models.updateSelection({ role: slot.role, selection: { choiceId } });
    if (committed) onCommitted(route.model);
  };

  const refreshMenu = async (): Promise<void> => {
    setOpening(true);
    try {
      await models.refresh();
    } finally {
      setOpening(false);
    }
  };

  const trigger = (
    <Tooltip trigger={['hover', 'focus', 'click']} content={description}>
      <Button
        type='text'
        className={styles.engineTrigger}
        disabled={disabled}
        aria-label={triggerLabel}
        aria-describedby={detailId}
        aria-busy={isPendingRole || undefined}
      >
        {isPendingRole || opening ? <Spin size={12} /> : null}
        <span>{triggerText}</span>
        {slot.action === 'menu' ? <span aria-hidden='true'>▾</span> : null}
      </Button>
    </Tooltip>
  );

  const menu = (
    <div className={styles.menuSurface}>
      {opening || models.loading ? (
        <div className={styles.loadingRow}>
          <Spin size={14} /> {t(engineKey('refreshing'))}
        </div>
      ) : (
        <Menu>
          {slot.state === 'retired' ? (
            <Menu.ItemGroup title={t(engineKey('replacing'), { model: slot.selectedModel })}>
              {slot.options.map((route) => (
                <EngineMenuItem
                  key={route.choiceId}
                  route={route}
                  summary={routeSummary(route)}
                  onSelect={selectRoute}
                />
              ))}
            </Menu.ItemGroup>
          ) : (
            slot.options.map((route) => (
              <EngineMenuItem key={route.choiceId} route={route} summary={routeSummary(route)} onSelect={selectRoute} />
            ))
          )}
        </Menu>
      )}
      <div className={styles.menuFooter}>
        <Button type='text' onClick={() => void refreshMenu()} disabled={opening}>
          {t(engineKey('refresh'))}
        </Button>
        <Button type='text' onClick={() => openModelSettings('/settings/model')}>
          {t(engineKey('manage'))}
        </Button>
      </div>
    </div>
  );

  return (
    <section
      className={styles.slot}
      role='group'
      aria-labelledby={roleId}
      aria-describedby={detailId}
      tabIndex={-1}
      data-engine-role={slot.role}
      data-state={slot.state}
    >
      <div className={styles.slotHeading}>
        <h3 id={roleId}>{roleLabel}</h3>
        <span>{roleHint}</span>
      </div>
      {slot.action === 'menu' ? (
        <Dropdown
          trigger='click'
          popupVisible={visible}
          onVisibleChange={handleVisibleChange}
          droplist={menu}
          position='bl'
        >
          {trigger}
        </Dropdown>
      ) : slot.action === 'settings' ? (
        <div className={styles.staticState}>
          <p>{copy.primary}</p>
          <p>{copy.detail}</p>
          <Button
            type='text'
            aria-describedby={detailId}
            onClick={() => openModelSettings('/settings/model')}
            disabled={disabled}
          >
            {t(engineKey('manageShort'))}
          </Button>
        </div>
      ) : (
        <div className={styles.staticState}>
          <p>{copy.primary}</p>
          {copy.detail !== copy.primary ? <p>{copy.detail}</p> : null}
        </div>
      )}
      {slot.action === 'menu' ? <p className={styles.slotSummary}>{copy.detail}</p> : null}
      <span id={detailId} className='sr-only'>
        {description}
      </span>
    </section>
  );
};

const EngineMenuItem: React.FC<{
  route: StudioRouteCatalogEntry;
  summary: string;
  onSelect: (choiceId: string) => Promise<void>;
}> = ({ route, summary, onSelect }) => {
  const { t } = useTranslation();
  return (
    <Menu.Item key={route.choiceId} onClick={() => void onSelect(route.choiceId)}>
      <div className={styles.optionRow}>
        <strong>
          {t(engineKey('optionLabel'), {
            model: route.model,
            provider: route.providerName,
            integration: t(integrationTranslationKey(route)),
          })}
        </strong>
        {route.health === 'unknown' ? <span>{t(engineKey('unverified'))}</span> : null}
        <span>{summary}</span>
      </div>
    </Menu.Item>
  );
};
