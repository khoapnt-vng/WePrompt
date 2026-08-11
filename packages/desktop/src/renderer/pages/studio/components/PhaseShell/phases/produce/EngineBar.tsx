/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioRouteCatalog, StudioRouteCatalogEntry } from '@/common/types/project/creativeStudioTypes';
import { Button, Tooltip } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import styles from './produce.module.css';

export type ReadyStudioRoute = {
  kind: 'image' | 'video';
  route: StudioRouteCatalogEntry;
};

export type EngineBarProps = {
  routes: readonly ReadyStudioRoute[];
  disabled?: boolean;
  headingId?: string;
  onOpenSettings: (path: '/settings/model') => void;
};

/** Returns only main-canonical ready selections; catalog options are never treated as implicit choices. */
export const getReadySelectedRoutes = (catalog: StudioRouteCatalog | null): ReadyStudioRoute[] =>
  (['video', 'image'] as const).flatMap((kind) => {
    const role = catalog?.[kind];
    const selectedRoute = role?.selectedRoute;
    return role?.status === 'ready' && selectedRoute?.kind === kind ? [{ kind, route: selectedRoute }] : [];
  });

/**
 * Compact display of the actual media routes selected by the main-process catalog.
 *
 * Model names and per-route duration limits live in the hover, but the media kinds stay
 * visible: this names the paid engines that a generation will bill against, and an engine's
 * `maxDurationSeconds` silently reshapes the script, so the strip must never collapse to
 * nothing. The detail is reachable without hovering by three independent paths, because
 * hover-only would put spend-relevant facts out of reach: the trigger is a real Button, so
 * the tooltip opens on keyboard focus; `click` is listed explicitly so a touch tap opens it
 * rather than relying on Chromium focusing a tapped button; and `aria-describedby` carries
 * the same text to assistive tech whether or not the tooltip ever opens.
 *
 * Listing both `hover` and `click` means a click while the pointer is already hovering
 * toggles the tooltip shut. That is the accepted cost of a guaranteed tap-to-open.
 */
export const EngineBar: React.FC<EngineBarProps> = ({
  routes,
  disabled = false,
  headingId = 'studio-produce-phase-heading',
  onOpenSettings,
}) => {
  const { t, i18n } = useTranslation();
  const detailsId = `${headingId}-engine-detail`;
  const kindLabel = (kind: ReadyStudioRoute['kind']): string =>
    t(kind === 'image' ? 'conversation.creativeStudio.scene.image' : 'conversation.creativeStudio.scene.video');
  const routeSummary = ({ kind, route }: ReadyStudioRoute): string =>
    t('conversation.creativeStudio.phase.produce.engineSummary', {
      model: route.model,
      kind: kindLabel(kind),
      seconds: route.constraints.maxDurationSeconds,
    });
  // Locale-aware joining, so no separator has to be invented per language. The language is
  // read defensively: it is absent before i18next finishes initialising, and a missing
  // locale must never throw on the strip that names the paid engine.
  const listFormat = new Intl.ListFormat(i18n?.language || undefined, { style: 'short', type: 'unit' });

  return (
    <section className={styles.engineBar} aria-labelledby={headingId}>
      {/* Visually hidden, never removed: StudioPhaseShell focuses [data-studio-phase-heading]
          on every phase transition, and this is the Produce phase's only one. */}
      <h2 id={headingId} data-studio-phase-heading tabIndex={-1} className='sr-only'>
        {t('conversation.creativeStudio.phase.produce.renderingWith')}
      </h2>
      <Tooltip
        trigger={['hover', 'focus', 'click']}
        content={
          <ul className={styles.engineTooltipList}>
            {routes.map((entry) => (
              <li key={`${entry.kind}:${entry.route.choiceId}`}>{routeSummary(entry)}</li>
            ))}
          </ul>
        }
      >
        <Button type='text' className={styles.engineTrigger} aria-describedby={detailsId}>
          {t('conversation.creativeStudio.phase.produce.engineKinds', {
            kinds: listFormat.format(routes.map(({ kind }) => kindLabel(kind))),
          })}
        </Button>
      </Tooltip>
      <span id={detailsId} className='sr-only'>
        {listFormat.format(routes.map(routeSummary))}
      </span>
      <Button
        type='text'
        className={styles.changeEnginesButton}
        disabled={disabled}
        onClick={() => onOpenSettings('/settings/model')}
      >
        {t('conversation.creativeStudio.phase.produce.changeEngines')}
      </Button>
    </section>
  );
};
