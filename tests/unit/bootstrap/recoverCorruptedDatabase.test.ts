import { describe, expect, it, vi } from 'vitest';
import type { BackendStartupFailureInfo } from '@/common/types/platform/electron';
import { recoverCorruptedDatabaseAfterUserConfirmation } from '@/process/startup/recoverCorruptedDatabase';

function makeDeps(failure: BackendStartupFailureInfo | null) {
  return {
    getFailure: vi.fn(() => failure),
    stopBackend: vi.fn().mockResolvedValue(undefined),
    startBackendWithRecovery: vi.fn().mockResolvedValue(25808),
    markReady: vi.fn(),
    reloadMainWindow: vi.fn(),
    logInfo: vi.fn(),
    logWarn: vi.fn(),
  };
}

describe('recoverCorruptedDatabaseAfterUserConfirmation', () => {
  it('rejects when no recoverable startup failure is active', async () => {
    const deps = makeDeps(null);

    await expect(recoverCorruptedDatabaseAfterUserConfirmation(deps)).rejects.toThrow(
      'backend_corrupted_database_recovery_not_available'
    );

    expect(deps.stopBackend).not.toHaveBeenCalled();
    expect(deps.startBackendWithRecovery).not.toHaveBeenCalled();
    expect(deps.logWarn).toHaveBeenCalledOnce();
  });

  it('rejects data migration failures that are not recoverable corruption', async () => {
    const deps = makeDeps({
      reason: 'backend_data_migration_failed',
      backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
      backendBoundaryStage: 'database.migration',
    });

    await expect(recoverCorruptedDatabaseAfterUserConfirmation(deps)).rejects.toThrow(
      'backend_corrupted_database_recovery_not_available'
    );

    expect(deps.stopBackend).not.toHaveBeenCalled();
    expect(deps.startBackendWithRecovery).not.toHaveBeenCalled();
  });

  it('restarts the backend with recovery and reloads the main window after confirmation', async () => {
    const deps = makeDeps({
      reason: 'backend_recoverable_database_corruption',
      backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
      backendBoundaryStage: 'database.recoverable_corruption',
    });

    await recoverCorruptedDatabaseAfterUserConfirmation(deps);

    expect(deps.stopBackend).toHaveBeenCalledOnce();
    expect(deps.startBackendWithRecovery).toHaveBeenCalledOnce();
    expect(deps.markReady).toHaveBeenCalledWith(25808, 'backendManager.recoverCorruptedDatabase');
    expect(deps.reloadMainWindow).toHaveBeenCalledOnce();
    expect(deps.logInfo).toHaveBeenCalledOnce();
  });

  it('does not mark ready or reload when restart fails', async () => {
    const failure: BackendStartupFailureInfo = {
      reason: 'backend_recoverable_database_corruption',
      backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
      backendBoundaryStage: 'database.recoverable_corruption',
    };
    const deps = makeDeps(failure);
    deps.startBackendWithRecovery.mockRejectedValue(new Error('restart failed'));

    await expect(recoverCorruptedDatabaseAfterUserConfirmation(deps)).rejects.toThrow('restart failed');

    expect(deps.markReady).not.toHaveBeenCalled();
    expect(deps.reloadMainWindow).not.toHaveBeenCalled();
    expect(deps.getFailure()).toBe(failure);
  });
});

// BUG-017. A real incident returned SQLite code 14 (SQLITE_CANTOPEN) across
// providers, assistants, conversations, App Operations and Health Check.
// `PRAGMA integrity_check` passed and a restart restored service.
//
// Code 14 means the file could not be opened. It is NOT corruption, and the
// reproduction in docs/design/bug017-runtime-data-access-loss.md confirms both
// halves of that: a sealed directory yields code 14 on every fresh open, while
// integrity_check on an already-open handle still answers "ok". A database that
// is intact but unreachable must never be backed up and rebuilt — that is data
// loss in response to a permission or mount problem that a restart would clear.
//
// `recoverCorruptedDatabaseAfterUserConfirmation` is the only route to the
// destructive rebuild, so this is the boundary worth pinning. Access loss has no
// classifier rung of its own today, so it lands in `backend_startup_failed`;
// these cases assert the refusal for that reason and for every other non-corruption
// reason, so a future rung added for code 14 cannot quietly reach the rebuild.
describe('recoverCorruptedDatabaseAfterUserConfirmation — BUG-017 access loss', () => {
  const nonCorruptionReasons: BackendStartupFailureInfo['reason'][] = [
    'backend_startup_failed',
    'backend_startup_directory_unavailable',
    'backend_local_data_repair_failed',
    'backend_database_lineage_incompatible',
    'backend_transient_concurrent_startup',
    'backend_incompatible_runtime',
    'backend_incomplete_installation',
    'backend_package_architecture_mismatch',
  ];

  it.each(nonCorruptionReasons)('refuses to rebuild the database for %s', async (reason) => {
    const deps = makeDeps({ reason });

    await expect(recoverCorruptedDatabaseAfterUserConfirmation(deps)).rejects.toThrow(
      'backend_corrupted_database_recovery_not_available'
    );

    expect(deps.stopBackend).not.toHaveBeenCalled();
    expect(deps.startBackendWithRecovery).not.toHaveBeenCalled();
    expect(deps.markReady).not.toHaveBeenCalled();
    expect(deps.reloadMainWindow).not.toHaveBeenCalled();
  });

  it('refuses to rebuild when the failure carries SQLITE_CANTOPEN evidence', async () => {
    // The boundary fields are constructed, not observed: no AionCore build
    // reachable from here emits a runtime access-loss boundary, so the exact
    // wire shape is unconfirmed. The reason field is what the guard reads, and
    // that is what this pins.
    const deps = makeDeps({
      reason: 'backend_startup_failed',
      backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
      backendBoundaryStage: 'database.open',
    });

    await expect(recoverCorruptedDatabaseAfterUserConfirmation(deps)).rejects.toThrow(
      'backend_corrupted_database_recovery_not_available'
    );

    expect(deps.stopBackend).not.toHaveBeenCalled();
    expect(deps.startBackendWithRecovery).not.toHaveBeenCalled();
  });

  it('still allows the rebuild for confirmed recoverable corruption', async () => {
    // The negative cases above are only meaningful if the positive path is live:
    // a guard that refuses everything would pass them vacuously.
    const deps = makeDeps({
      reason: 'backend_recoverable_database_corruption',
      backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
      backendBoundaryStage: 'database.recoverable_corruption',
    });

    await recoverCorruptedDatabaseAfterUserConfirmation(deps);

    expect(deps.startBackendWithRecovery).toHaveBeenCalledOnce();
  });
});
