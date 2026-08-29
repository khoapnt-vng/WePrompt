/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The one Studio blocker that has a remedy, rendered with that remedy attached.
 *
 * BUG-183: the route-catalogue blocker told the person to "Refresh routes" while that control sat
 * in the More menu, several clicks away and unmentioned — a sentence naming a verb they could not
 * find. Describing the location in the copy is the fragile fix; it goes stale the moment the menu
 * moves. Putting the control in the banner cannot.
 *
 * Only this one key gets an action. Every other notice renders exactly as it did, so the generic
 * error path does not become a table of special cases.
 */
export const STUDIO_ROUTE_CATALOG_BLOCKER_KEY = 'conversation.creativeStudio.workspace.controls.routeCatalogRequired';

export type StudioBlockerAlertProps = {
  messageKey: string | null;
  /** Omitted where no refresh is reachable; the notice then reads exactly as before. */
  onRefreshRoutes?: () => void;
  refreshing?: boolean;
};

/**
 * The remedy on its own, for a surface that already owns its `role='alert'` wrapper.
 *
 * The workspace shell wraps its notice in one (`WorkspaceShell.tsx:550`), and Arco's `Alert`
 * hardcodes a second — nesting them would announce the same blocker twice. This gives that surface
 * the control without the box.
 */
export const StudioBlockerRemedy: React.FC<StudioBlockerAlertProps> = ({
  messageKey,
  onRefreshRoutes,
  refreshing = false,
}) => {
  const { t } = useTranslation();
  if (messageKey !== STUDIO_ROUTE_CATALOG_BLOCKER_KEY || onRefreshRoutes === undefined) return null;
  return (
    <Button loading={refreshing} onClick={onRefreshRoutes} size='mini'>
      {t('conversation.creativeStudio.workspace.controls.refreshRoutes')}
    </Button>
  );
};

export const StudioBlockerAlert: React.FC<StudioBlockerAlertProps> = ({
  messageKey,
  onRefreshRoutes,
  refreshing = false,
}) => {
  const { t } = useTranslation();
  if (messageKey === null) return null;
  const remediable = messageKey === STUDIO_ROUTE_CATALOG_BLOCKER_KEY && onRefreshRoutes !== undefined;
  return (
    <Alert
      action={
        remediable ? (
          <Button loading={refreshing} onClick={onRefreshRoutes} size='mini'>
            {t('conversation.creativeStudio.workspace.controls.refreshRoutes')}
          </Button>
        ) : undefined
      }
      content={t(messageKey)}
      type='error'
    />
  );
};
