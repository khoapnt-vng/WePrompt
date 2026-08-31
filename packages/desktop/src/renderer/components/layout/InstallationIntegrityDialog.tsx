import { Button, Message, Modal, Space, Typography } from '@arco-design/web-react';
import type { TFunction } from 'i18next';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { BackendStartupFailureInfo, BackendStartupFailureReason } from '@/common/types/platform/electron';
import {
  type FeedbackEventTags,
  type SubmitFeedbackReportResult,
  submitFeedbackReport,
} from '@/renderer/services/feedback/submitFeedbackReport';

type InstallationIntegrityDialogKind =
  | 'incomplete_installation'
  | 'startup_failure'
  | 'database_lineage'
  | 'data_migration'
  | 'local_data_repair'
  | 'recoverable_database_corruption'
  | 'transient_concurrent_startup'
  | 'startup_directory';

export function getBackendStartupIntegrityDialogKind(
  reason: BackendStartupFailureReason
): InstallationIntegrityDialogKind | null {
  switch (reason) {
    case 'backend_incomplete_installation':
      return 'incomplete_installation';
    case 'backend_startup_failed':
      return 'startup_failure';
    case 'backend_database_lineage_incompatible':
      return 'database_lineage';
    case 'backend_data_migration_failed':
      return 'data_migration';
    case 'backend_local_data_repair_failed':
      return 'local_data_repair';
    case 'backend_recoverable_database_corruption':
      return 'recoverable_database_corruption';
    case 'backend_transient_concurrent_startup':
      return 'transient_concurrent_startup';
    case 'backend_startup_directory_unavailable':
      return 'startup_directory';
    case 'backend_incompatible_runtime':
    case 'backend_package_architecture_mismatch':
      return null;
  }
}

export type InstallationIntegrityDiagnostics = {
  source: 'backend_startup_failure' | 'runtime_status';
  description?: string;
  runtime?: {
    failureKind?: string;
    message?: string;
    phase?: string;
    resource?: string;
    resourceId?: string;
    scopeId?: string;
    scopeKind?: string;
  };
  backendStartupFailure?: Record<string, unknown> | null;
};

export function getInstallationIntegrityTitle(
  t: TFunction,
  diagnosticsKind: InstallationIntegrityDialogKind = 'incomplete_installation'
): string {
  if (diagnosticsKind === 'recoverable_database_corruption') {
    return t('common.backendStartup.recoverableDatabaseCorruption.title');
  }
  if (diagnosticsKind === 'transient_concurrent_startup') {
    return t('common.backendStartup.transientConcurrentStartup.title');
  }
  if (diagnosticsKind === 'startup_directory') return t('common.backendStartup.startupDirectory.title');
  if (diagnosticsKind === 'startup_failure') return t('common.backendStartup.genericFailure.title');
  if (diagnosticsKind === 'local_data_repair') return t('common.backendStartup.localDataRepair.title');
  if (diagnosticsKind === 'database_lineage') return t('common.backendStartup.databaseLineage.title');
  return diagnosticsKind === 'data_migration'
    ? t('common.backendStartup.dataMigration.title')
    : t('common.backendStartup.incompleteInstallation.title');
}

export function getBackendStartupInstallationDescription(t: TFunction): string {
  return t('common.backendStartup.incompleteInstallation.description');
}

export function getBackendStartupFailureDescription(t: TFunction): string {
  return t('common.backendStartup.genericFailure.description');
}

export function resolveBackendStartupIntegrityPresentation(
  t: TFunction,
  failure: BackendStartupFailureInfo
): Readonly<{ description: string; diagnosticsKind: InstallationIntegrityDialogKind }> | null {
  const diagnosticsKind = getBackendStartupIntegrityDialogKind(failure.reason);
  if (diagnosticsKind === null) return null;

  const description = (() => {
    switch (failure.reason) {
      case 'backend_incomplete_installation':
        return getBackendStartupInstallationDescription(t);
      case 'backend_startup_failed':
        return getBackendStartupFailureDescription(t);
      case 'backend_database_lineage_incompatible':
        return t('common.backendStartup.databaseLineage.description', {
          appliedVersion: failure.appliedVersion ?? t('common.backendStartup.databaseLineage.unknownVersion'),
          floorVersion: failure.floorVersion ?? t('common.backendStartup.databaseLineage.unknownVersion'),
          latestVersion: failure.latestVersion ?? t('common.backendStartup.databaseLineage.unknownVersion'),
          reason: failure.lineageReason ?? t('common.backendStartup.databaseLineage.unknownReason'),
        });
      case 'backend_data_migration_failed':
        return t('common.backendStartup.dataMigration.description');
      case 'backend_local_data_repair_failed':
        return t('common.backendStartup.localDataRepair.description');
      case 'backend_recoverable_database_corruption':
        return t('common.backendStartup.recoverableDatabaseCorruption.description');
      case 'backend_transient_concurrent_startup':
        return t('common.backendStartup.transientConcurrentStartup.description');
      case 'backend_startup_directory_unavailable':
        return t('common.backendStartup.startupDirectory.description');
      case 'backend_incompatible_runtime':
      case 'backend_package_architecture_mismatch':
        return getBackendStartupFailureDescription(t);
    }
  })();

  return Object.freeze({ description, diagnosticsKind });
}

export function getRuntimeComponentInstallationDescription(t: TFunction, resource: string): string {
  return t('common.backendStartup.incompleteInstallation.runtimeComponentDescription', { resource });
}

export function getInstallationIntegritySendDiagnosticsText(t: TFunction): string {
  return t('common.backendStartup.incompleteInstallation.sendDiagnostics');
}

export function getInstallationIntegrityDiagnosticsSentText(
  t: TFunction,
  diagnosticsKind: InstallationIntegrityDialogKind = 'incomplete_installation'
): string {
  if (diagnosticsKind === 'recoverable_database_corruption') {
    return t('common.backendStartup.recoverableDatabaseCorruption.diagnosticsSent');
  }
  if (diagnosticsKind === 'transient_concurrent_startup') {
    return t('common.backendStartup.transientConcurrentStartup.diagnosticsSent');
  }
  if (diagnosticsKind === 'startup_directory') return t('common.backendStartup.startupDirectory.diagnosticsSent');
  if (diagnosticsKind === 'startup_failure') return t('common.backendStartup.genericFailure.diagnosticsSent');
  if (diagnosticsKind === 'local_data_repair') return t('common.backendStartup.localDataRepair.diagnosticsSent');
  if (diagnosticsKind === 'database_lineage') return t('common.backendStartup.databaseLineage.diagnosticsSent');
  return diagnosticsKind === 'data_migration'
    ? t('common.backendStartup.dataMigration.diagnosticsSent')
    : t('common.backendStartup.incompleteInstallation.diagnosticsSent');
}

function buildInstallationIntegrityTags(diagnostics: InstallationIntegrityDiagnostics): FeedbackEventTags {
  const tags: FeedbackEventTags = {
    'aionui.installation_integrity.user_report': 'true',
    'aionui.installation_integrity.report_source': diagnostics.source,
  };

  if (diagnostics.runtime?.failureKind) {
    tags['aionui.installation_integrity.failure_kind'] = diagnostics.runtime.failureKind;
  }
  if (diagnostics.runtime?.resource) {
    tags['aionui.runtime_resource'] = diagnostics.runtime.resource;
  }
  if (diagnostics.runtime?.resourceId) {
    tags['aionui.runtime_resource_id'] = diagnostics.runtime.resourceId;
  }
  if (diagnostics.runtime?.scopeKind) {
    tags['aionui.runtime_scope'] = diagnostics.runtime.scopeKind;
  }

  const reason = diagnostics.backendStartupFailure?.reason;
  if (typeof reason === 'string') {
    tags['aionui.backend_startup_failure.reason'] = reason;
  }
  const backendBoundaryCode = diagnostics.backendStartupFailure?.backendBoundaryCode;
  if (typeof backendBoundaryCode === 'string') {
    tags['aionui.backend_startup_failure.backend_boundary_code'] = backendBoundaryCode;
  }
  const backendBoundaryStage = diagnostics.backendStartupFailure?.backendBoundaryStage;
  if (typeof backendBoundaryStage === 'string') {
    tags['aionui.backend_startup_failure.backend_boundary_stage'] = backendBoundaryStage;
  }
  for (const field of [
    'actualFingerprint',
    'appliedVersion',
    'expectedFingerprint',
    'floorVersion',
    'latestVersion',
    'lineageReason',
  ] as const) {
    const value = diagnostics.backendStartupFailure?.[field];
    if (typeof value === 'string' || typeof value === 'number') {
      tags[`aionui.backend_startup_failure.${field}`] = String(value);
    }
  }

  return tags;
}

export async function reportInstallationIntegrityDiagnostics(
  diagnostics: InstallationIntegrityDiagnostics,
  t: TFunction,
  diagnosticsKind: InstallationIntegrityDialogKind = 'incomplete_installation'
): Promise<SubmitFeedbackReportResult> {
  const result = await submitFeedbackReport({
    collectLogs: true,
    description:
      diagnostics.description ??
      (diagnosticsKind === 'startup_failure'
        ? getBackendStartupFailureDescription(t)
        : getBackendStartupInstallationDescription(t)),
    module: 'installation-integrity',
    moduleLabel: getInstallationIntegrityTitle(t, diagnosticsKind),
    tags: buildInstallationIntegrityTags(diagnostics),
  });

  if (result.status === 'saved' && typeof window !== 'undefined' && window.__aionuiE2ETest) {
    window.__installationIntegrityReportCount = (window.__installationIntegrityReportCount ?? 0) + 1;
    window.__lastInstallationIntegrityReportMessage = 'installation-integrity-user-report';
  }

  return result;
}

export function getInstallationIntegrityModalActions(
  t: TFunction,
  options: {
    diagnosticsKind?: InstallationIntegrityDialogKind;
    onQuit?: () => void;
    onRecoverCorruptedDatabase?: () => Promise<unknown> | void;
    onReportDiagnostics?: () => Promise<SubmitFeedbackReportResult> | SubmitFeedbackReportResult;
  } = {}
): {
  onRecoverCorruptedDatabase: () => Promise<unknown> | void;
  onReportDiagnostics: () => Promise<SubmitFeedbackReportResult> | SubmitFeedbackReportResult;
  onQuit: () => void;
  quitText?: string;
  recoverText?: string;
  reportText: string;
} {
  const diagnosticsKind = options.diagnosticsKind ?? 'incomplete_installation';
  return {
    onRecoverCorruptedDatabase: options.onRecoverCorruptedDatabase ?? (() => Promise.resolve()),
    onReportDiagnostics: options.onReportDiagnostics ?? (() => ({ status: 'failed' })),
    onQuit:
      options.onQuit ??
      (() => {
        void ipcBridge.application.quit.invoke();
      }),
    quitText:
      diagnosticsKind === 'database_lineage' ? t('common.backendStartup.databaseLineage.quitApplication') : undefined,
    recoverText:
      diagnosticsKind === 'recoverable_database_corruption'
        ? t('common.backendStartup.recoverableDatabaseCorruption.confirmRebuild')
        : undefined,
    reportText:
      diagnosticsKind === 'recoverable_database_corruption'
        ? t('common.backendStartup.recoverableDatabaseCorruption.sendDiagnostics')
        : diagnosticsKind === 'transient_concurrent_startup'
          ? t('common.backendStartup.transientConcurrentStartup.sendDiagnostics')
          : diagnosticsKind === 'startup_directory'
            ? t('common.backendStartup.startupDirectory.sendDiagnostics')
            : diagnosticsKind === 'startup_failure'
              ? t('common.backendStartup.genericFailure.sendDiagnostics')
              : diagnosticsKind === 'local_data_repair'
                ? t('common.backendStartup.localDataRepair.sendDiagnostics')
                : diagnosticsKind === 'database_lineage'
                  ? t('common.backendStartup.databaseLineage.sendDiagnostics')
                  : diagnosticsKind === 'data_migration'
                    ? t('common.backendStartup.dataMigration.sendDiagnostics')
                    : getInstallationIntegritySendDiagnosticsText(t),
  };
}

export const InstallationIntegrityContent: React.FC<{ description: string; diagnosticsHint?: string }> = ({
  description,
  diagnosticsHint,
}) => (
  <div className='text-t-1' data-testid='installation-integrity-dialog'>
    <Typography.Paragraph className='mb-0 text-t-secondary' data-testid='installation-integrity-description'>
      {description}
    </Typography.Paragraph>
    {diagnosticsHint ? (
      <Typography.Paragraph className='mt-12px mb-0 text-12px text-t-tertiary'>{diagnosticsHint}</Typography.Paragraph>
    ) : null}
  </div>
);

export const PackageArchitectureMismatchFooter: React.FC<{ onClose?: () => void }> = ({
  onClose = () => window.close(),
}) => {
  const { t } = useTranslation();

  return (
    <Button data-testid='package-architecture-mismatch-close' type='primary' onClick={onClose}>
      {t('common.backendStartup.packageArchitectureMismatch.closeApplication')}
    </Button>
  );
};

export const InstallationIntegrityFooter: React.FC<{
  diagnostics?: InstallationIntegrityDiagnostics;
  diagnosticsKind?: InstallationIntegrityDialogKind;
}> = ({ diagnostics, diagnosticsKind = 'incomplete_installation' }) => {
  const { t } = useTranslation();
  const isDiagnosticsExportAvailable = Boolean(window.electronAPI?.exportLocalFeedbackDiagnostics);
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const actions = getInstallationIntegrityModalActions(t, {
    diagnosticsKind,
    onRecoverCorruptedDatabase: () => window.electronAPI?.recoverCorruptedDatabase?.(),
    onReportDiagnostics: diagnostics
      ? () => reportInstallationIntegrityDiagnostics(diagnostics, t, diagnosticsKind)
      : undefined,
  });

  const handleReportDiagnostics = async () => {
    if (!diagnostics || reporting || reported) return;
    setReporting(true);
    try {
      const result = await actions.onReportDiagnostics();
      if (result.status === 'saved') {
        setReported(true);
        Message.success(
          diagnosticsKind === 'recoverable_database_corruption'
            ? t('common.backendStartup.recoverableDatabaseCorruption.diagnosticsReportSuccess')
            : diagnosticsKind === 'transient_concurrent_startup'
              ? t('common.backendStartup.transientConcurrentStartup.diagnosticsReportSuccess')
              : diagnosticsKind === 'startup_failure'
                ? t('common.backendStartup.genericFailure.diagnosticsReportSuccess')
                : diagnosticsKind === 'local_data_repair'
                  ? t('common.backendStartup.localDataRepair.diagnosticsReportSuccess')
                  : diagnosticsKind === 'database_lineage'
                    ? t('common.backendStartup.databaseLineage.diagnosticsReportSuccess')
                    : diagnosticsKind === 'data_migration'
                      ? t('common.backendStartup.dataMigration.diagnosticsReportSuccess')
                      : t('common.backendStartup.incompleteInstallation.diagnosticsReportSuccess')
        );
      } else if (result.status === 'cancelled') {
        Message.info(t('settings.bugReportCancelled'));
      } else if (result.status === 'failed') {
        throw new Error('Local diagnostics export failed');
      }
    } catch {
      Message.error(
        diagnosticsKind === 'recoverable_database_corruption'
          ? t('common.backendStartup.recoverableDatabaseCorruption.diagnosticsReportFailed')
          : diagnosticsKind === 'transient_concurrent_startup'
            ? t('common.backendStartup.transientConcurrentStartup.diagnosticsReportFailed')
            : diagnosticsKind === 'startup_failure'
              ? t('common.backendStartup.genericFailure.diagnosticsReportFailed')
              : diagnosticsKind === 'local_data_repair'
                ? t('common.backendStartup.localDataRepair.diagnosticsReportFailed')
                : diagnosticsKind === 'database_lineage'
                  ? t('common.backendStartup.databaseLineage.diagnosticsReportFailed')
                  : diagnosticsKind === 'data_migration'
                    ? t('common.backendStartup.dataMigration.diagnosticsReportFailed')
                    : t('common.backendStartup.incompleteInstallation.diagnosticsReportFailed')
      );
    } finally {
      setReporting(false);
    }
  };

  const handleRecoverCorruptedDatabase = async () => {
    if (recovering) return;
    setRecovering(true);
    try {
      await actions.onRecoverCorruptedDatabase();
    } catch {
      Message.error(t('common.backendStartup.recoverableDatabaseCorruption.rebuildFailed'));
      setRecovering(false);
    }
  };

  return (
    <Space>
      {isDiagnosticsExportAvailable ? (
        <Button
          data-testid='installation-integrity-report'
          disabled={!diagnostics || reported}
          loading={reporting}
          onClick={handleReportDiagnostics}
        >
          {reported ? getInstallationIntegrityDiagnosticsSentText(t, diagnosticsKind) : actions.reportText}
        </Button>
      ) : null}
      {actions.recoverText ? (
        <Button
          data-testid='recoverable-database-corruption-rebuild'
          loading={recovering}
          type='primary'
          onClick={handleRecoverCorruptedDatabase}
        >
          {actions.recoverText}
        </Button>
      ) : null}
      {actions.quitText ? (
        <Button data-testid='database-lineage-quit' type='primary' onClick={actions.onQuit}>
          {actions.quitText}
        </Button>
      ) : null}
    </Space>
  );
};

type InstallationIntegrityModalController = ReturnType<typeof Modal.useModal>[0];

export function showInstallationIntegrityModal(
  modal: InstallationIntegrityModalController,
  t: TFunction,
  description: string,
  diagnostics?: InstallationIntegrityDiagnostics,
  diagnosticsKind: InstallationIntegrityDialogKind = 'incomplete_installation'
): void {
  const diagnosticsHint =
    diagnosticsKind === 'recoverable_database_corruption'
      ? t('common.backendStartup.recoverableDatabaseCorruption.diagnosticsHint')
      : diagnosticsKind === 'transient_concurrent_startup'
        ? t('common.backendStartup.transientConcurrentStartup.diagnosticsHint')
        : undefined;

  modal.error({
    title: getInstallationIntegrityTitle(t, diagnosticsKind),
    content: <InstallationIntegrityContent description={description} diagnosticsHint={diagnosticsHint} />,
    footer: <InstallationIntegrityFooter diagnostics={diagnostics} diagnosticsKind={diagnosticsKind} />,
    closable: false,
    maskClosable: false,
  });
}

export const InstallationIntegrityModalHost: React.FC<{
  description: string;
  diagnostics?: InstallationIntegrityDiagnostics;
  diagnosticsKind?: InstallationIntegrityDialogKind;
}> = ({ description, diagnostics, diagnosticsKind = 'incomplete_installation' }) => {
  const [modal, modalContextHolder] = Modal.useModal();
  const { t } = useTranslation();
  const shownRef = useRef(false);

  useEffect(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    showInstallationIntegrityModal(modal, t, description, diagnostics, diagnosticsKind);
  }, [description, diagnostics, diagnosticsKind, modal, t]);

  return <>{modalContextHolder}</>;
};
