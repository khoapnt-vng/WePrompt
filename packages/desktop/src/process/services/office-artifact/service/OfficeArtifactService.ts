/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';

import type {
  OfficeArtifactApplyRequest,
  OfficeArtifactFailure,
  OfficeArtifactGetStateRequest,
  OfficeArtifactInspectRequest,
  OfficeArtifactInspectResult,
  OfficeArtifactInspection,
  OfficeArtifactMutationResult,
  OfficeArtifactPreparePreviewRequest,
  OfficeArtifactPreparePreviewResult,
  OfficeArtifactReleasePreviewRequest,
  OfficeArtifactReleasePreviewResult,
  OfficeArtifactSelection,
  OfficeArtifactStateResult,
  OfficeArtifactStartPreviewRequest,
  OfficeArtifactStartPreviewResult,
  OfficeArtifactUndoRequest,
} from '@/common/types/office/artifactEditor';

import { inspectDocxSelection, mutateDocxSelection } from '../docxArtifactStrategy';
import type { hashOfficeArtifact, resolveOfficeArtifactPath, ResolvedOfficeArtifact } from '../officeArtifactPath';
import type { OfficeArtifactSnapshotStore } from '../officeArtifactSnapshots';
import type { OfficeArtifactWorkingFilesApi } from '../officeArtifactWorkingFiles';
import { OfficeArtifactError } from '../officeCliJson';
import type { OfficeCliPreviewSession, OfficeCliRunner } from '../officeCliRunner';
import type { RetainedOfficePreviewOrigin } from '../officePreviewSession';
import { inspectXlsxSelection, mutateXlsxSelection } from '../xlsxArtifactStrategy';

export type OfficeArtifactSnapshotStoreApi = Pick<
  OfficeArtifactSnapshotStore,
  'prepare' | 'commit' | 'rollbackPending' | 'discardPending' | 'undo' | 'getUndoDepth' | 'dispose'
>;

export type OfficeArtifactServiceDependencies = {
  runner: OfficeCliRunner;
  snapshots: OfficeArtifactSnapshotStoreApi;
  resolveArtifact: typeof resolveOfficeArtifactPath;
  hashArtifact: typeof hashOfficeArtifact;
  workingFiles: OfficeArtifactWorkingFilesApi;
  retainPreviewOrigin: (url: string) => RetainedOfficePreviewOrigin;
};

function toOfficeArtifactFailure(error: unknown): OfficeArtifactFailure {
  return {
    ok: false,
    code: error instanceof OfficeArtifactError ? error.code : 'OFFICECLI_FAILED',
  };
}

function createMutationGate(): { promise: Promise<void>; release: () => void } {
  let releaseGate: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  return { promise, release: () => releaseGate?.() };
}

export class OfficeArtifactService {
  private readonly runner: OfficeCliRunner;
  private readonly snapshots: OfficeArtifactSnapshotStoreApi;
  private readonly resolveArtifact: typeof resolveOfficeArtifactPath;
  private readonly hashArtifact: typeof hashOfficeArtifact;
  private readonly workingFiles: OfficeArtifactWorkingFilesApi;
  private readonly retainPreviewOrigin: OfficeArtifactServiceDependencies['retainPreviewOrigin'];
  private readonly mutationTails = new Map<string, Promise<void>>();
  private readonly previewPreparationTails = new Set<Promise<void>>();
  private readonly previewStartTails = new Set<Promise<void>>();
  private readonly previewLeases = new Map<
    string,
    {
      filePath: string;
      origin?: RetainedOfficePreviewOrigin;
      session?: OfficeCliPreviewSession;
    }
  >();
  private disposing = false;
  private disposePromise: Promise<void> | undefined;

  constructor(dependencies: OfficeArtifactServiceDependencies) {
    this.runner = dependencies.runner;
    this.snapshots = dependencies.snapshots;
    this.resolveArtifact = dependencies.resolveArtifact;
    this.hashArtifact = dependencies.hashArtifact;
    this.workingFiles = dependencies.workingFiles;
    this.retainPreviewOrigin = dependencies.retainPreviewOrigin;
  }

  async getState(request: OfficeArtifactGetStateRequest): Promise<OfficeArtifactStateResult> {
    try {
      const artifact = await this.resolveArtifact(request.workspace, request.filePath);
      const version = await this.hashArtifact(artifact.filePath);
      return {
        ok: true,
        version,
        undoDepth: this.snapshots.getUndoDepth(artifact.filePath, version),
      };
    } catch (error) {
      return toOfficeArtifactFailure(error);
    }
  }

  async preparePreview(request: OfficeArtifactPreparePreviewRequest): Promise<OfficeArtifactPreparePreviewResult> {
    if (this.disposing) return toOfficeArtifactFailure(new OfficeArtifactError('PREVIEW_FAILED'));
    const preparationGate = createMutationGate();
    this.previewPreparationTails.add(preparationGate.promise);
    let preview: Awaited<ReturnType<OfficeArtifactWorkingFilesApi['createPreview']>> | undefined;

    try {
      const artifact = await this.resolveArtifact(request.workspace, request.filePath);
      const version = await this.hashArtifact(artifact.filePath);
      preview = await this.workingFiles.createPreview(artifact.filePath);
      try {
        await this.runner.validate(preview.filePath);
      } catch (error) {
        // A missing officecli must surface its real "not installed" code so the
        // viewer can prompt to install it — not be masked as "corrupted or
        // invalid", which wrongly blames the file (WP #24097). Only a validate
        // that actually ran and rejected the file maps to INVALID_OFFICE_ARTIFACT.
        if (error instanceof OfficeArtifactError && error.code === 'OFFICECLI_NOT_FOUND') throw error;
        throw new OfficeArtifactError('INVALID_OFFICE_ARTIFACT');
      }
      if (
        (await this.hashArtifact(preview.filePath)) !== version ||
        (await this.hashArtifact(artifact.filePath)) !== version
      ) {
        throw new OfficeArtifactError('FILE_CHANGED');
      }
      if (this.disposing) throw new OfficeArtifactError('PREVIEW_FAILED');

      const leaseId = randomUUID();
      this.previewLeases.set(leaseId, { filePath: preview.filePath });
      return { ok: true, leaseId, filePath: preview.filePath, workspace: preview.workspace };
    } catch (error) {
      if (preview) await this.workingFiles.remove(preview.filePath);
      return toOfficeArtifactFailure(error);
    } finally {
      preparationGate.release();
      this.previewPreparationTails.delete(preparationGate.promise);
    }
  }

  async startPreview(request: OfficeArtifactStartPreviewRequest): Promise<OfficeArtifactStartPreviewResult> {
    const lease = this.previewLeases.get(request.leaseId);
    if (!lease || this.disposing) return toOfficeArtifactFailure(new OfficeArtifactError('PREVIEW_FAILED'));
    if (lease.origin) return { ok: true, url: lease.origin.url };

    const startGate = createMutationGate();
    this.previewStartTails.add(startGate.promise);
    let session: OfficeCliPreviewSession | undefined;
    let origin: RetainedOfficePreviewOrigin | undefined;
    try {
      session = request.url ? undefined : await this.runner.watch(lease.filePath);
      origin = this.retainPreviewOrigin(request.url ?? session?.url ?? '');
      if (this.disposing || this.previewLeases.get(request.leaseId) !== lease) {
        throw new OfficeArtifactError('PREVIEW_FAILED');
      }
      lease.session = session;
      lease.origin = origin;
      return { ok: true, url: origin.url };
    } catch (error) {
      origin?.release();
      await session?.stop().catch((): undefined => undefined);
      return toOfficeArtifactFailure(error);
    } finally {
      startGate.release();
      this.previewStartTails.delete(startGate.promise);
    }
  }

  async releasePreview(request: OfficeArtifactReleasePreviewRequest): Promise<OfficeArtifactReleasePreviewResult> {
    const lease = this.previewLeases.get(request.leaseId);
    if (!lease) return toOfficeArtifactFailure(new OfficeArtifactError('PREVIEW_FAILED'));

    try {
      await lease.session?.stop();
      lease.origin?.release();
      await this.workingFiles.remove(lease.filePath);
      this.previewLeases.delete(request.leaseId);
      return { ok: true };
    } catch (error) {
      return toOfficeArtifactFailure(error);
    }
  }

  async inspect(request: OfficeArtifactInspectRequest): Promise<OfficeArtifactInspectResult> {
    try {
      const artifact = await this.resolveArtifact(request.workspace, request.filePath);
      const version = await this.hashArtifact(artifact.filePath);
      if (version !== request.expectedVersion) throw new OfficeArtifactError('FILE_CHANGED');

      return {
        ok: true,
        version,
        inspection: await this.inspectResolved(artifact, request.selection),
      };
    } catch (error) {
      return toOfficeArtifactFailure(error);
    }
  }

  async apply(request: OfficeArtifactApplyRequest): Promise<OfficeArtifactMutationResult> {
    try {
      const artifact = await this.resolveArtifact(request.workspace, request.filePath);
      return await this.withMutationLock(artifact.filePath, () => this.applyResolved(request, artifact));
    } catch (error) {
      return toOfficeArtifactFailure(error);
    }
  }

  private async applyResolved(
    request: OfficeArtifactApplyRequest,
    artifact: ResolvedOfficeArtifact
  ): Promise<OfficeArtifactMutationResult> {
    let pending: Awaited<ReturnType<OfficeArtifactSnapshotStoreApi['prepare']>> | undefined;
    let stagedPath: string | undefined;
    let stagedVersion: string | undefined;
    let stagedResidentClosed = false;
    let installAttempted = false;

    try {
      const currentVersion = await this.hashArtifact(artifact.filePath);
      if (currentVersion !== request.expectedVersion) throw new OfficeArtifactError('FILE_CHANGED');

      const inspection = await this.inspectResolved(artifact, request.selection);
      pending = await this.snapshots.prepare(artifact.filePath, currentVersion);
      stagedPath = await this.workingFiles.create(artifact.filePath);
      if ((await this.hashArtifact(stagedPath)) !== currentVersion) throw new OfficeArtifactError('FILE_CHANGED');

      const stagedArtifact = { ...artifact, filePath: stagedPath };
      await this.mutateResolved(stagedArtifact, inspection, request.edit);
      await this.runner.validate(stagedPath);
      await this.runner.close(stagedPath);
      stagedResidentClosed = true;

      stagedVersion = await this.hashArtifact(stagedPath);
      if (stagedVersion === currentVersion) throw new OfficeArtifactError('OFFICECLI_FAILED');
      if ((await this.hashArtifact(artifact.filePath)) !== currentVersion)
        throw new OfficeArtifactError('FILE_CHANGED');

      installAttempted = true;
      await this.workingFiles.install(stagedPath, artifact.filePath, currentVersion, stagedVersion);
      if ((await this.hashArtifact(artifact.filePath)) !== stagedVersion) {
        throw new OfficeArtifactError('FILE_CHANGED');
      }

      const undoDepth = await this.snapshots.commit(pending, stagedVersion);
      return { ok: true, version: stagedVersion, snapshotId: pending.id, undoDepth };
    } catch (error) {
      if (pending) {
        try {
          if (await this.ownsInstalledVersion(artifact.filePath, stagedVersion, installAttempted)) {
            await this.snapshots.rollbackPending(pending, stagedVersion);
          } else {
            await this.snapshots.discardPending(pending);
          }
        } catch (rollbackError) {
          return toOfficeArtifactFailure(rollbackError);
        }
      }
      return toOfficeArtifactFailure(error);
    } finally {
      if (stagedPath) {
        if (!stagedResidentClosed) await this.runner.close(stagedPath).catch((): undefined => undefined);
        await this.workingFiles.remove(stagedPath);
      }
    }
  }

  async dispose(): Promise<void> {
    if (!this.disposePromise) {
      this.disposing = true;
      this.disposePromise = (async () => {
        await Promise.all([
          ...[...this.mutationTails.values()].map((tail) => tail.catch((): void => {})),
          ...[...this.previewPreparationTails].map((tail) => tail.catch((): void => {})),
          ...[...this.previewStartTails].map((tail) => tail.catch((): void => {})),
        ]);
        await Promise.all(
          [...this.previewLeases.values()].map(async (lease) => {
            await lease.session?.stop().catch((): undefined => undefined);
            lease.origin?.release();
          })
        );
        this.previewLeases.clear();
        await Promise.all([this.snapshots.dispose(), this.workingFiles.dispose()]);
      })();
    }
    await this.disposePromise;
  }

  async undo(request: OfficeArtifactUndoRequest): Promise<OfficeArtifactMutationResult> {
    try {
      const artifact = await this.resolveArtifact(request.workspace, request.filePath);
      return await this.withMutationLock(artifact.filePath, async () => {
        const currentVersion = await this.hashArtifact(artifact.filePath);
        if (currentVersion !== request.expectedVersion) throw new OfficeArtifactError('FILE_CHANGED');

        const result = await this.snapshots.undo(artifact.filePath, currentVersion);
        return {
          ok: true,
          version: result.version,
          snapshotId: request.expectedVersion,
          undoDepth: result.undoDepth,
        };
      });
    } catch (error) {
      return toOfficeArtifactFailure(error);
    }
  }

  private async inspectResolved(
    artifact: ResolvedOfficeArtifact,
    selection: OfficeArtifactSelection
  ): Promise<OfficeArtifactInspection> {
    try {
      if (artifact.kind === 'word') {
        if (selection.kind !== 'word') throw new OfficeArtifactError('UNSUPPORTED_CONTENT');
        return await inspectDocxSelection(this.runner, artifact.filePath, selection);
      }

      if (artifact.kind === 'presentation') throw new OfficeArtifactError('UNSUPPORTED_CONTENT');

      if (selection.kind !== 'excel') throw new OfficeArtifactError('UNSUPPORTED_CONTENT');
      return await inspectXlsxSelection(this.runner, artifact.filePath, selection);
    } finally {
      await this.runner.close(artifact.filePath);
    }
  }

  private mutateResolved(
    artifact: ResolvedOfficeArtifact,
    inspection: OfficeArtifactInspection,
    edit: OfficeArtifactApplyRequest['edit']
  ): Promise<void> {
    if (artifact.kind === 'presentation') throw new OfficeArtifactError('UNSUPPORTED_CONTENT');
    return artifact.kind === 'word'
      ? mutateDocxSelection(this.runner, artifact.filePath, inspection, edit)
      : mutateXlsxSelection(this.runner, artifact.filePath, inspection, edit);
  }

  private async withMutationLock<T>(filePath: string, action: () => Promise<T>): Promise<T> {
    if (this.disposing) throw new OfficeArtifactError('OFFICECLI_FAILED');

    const previous = this.mutationTails.get(filePath) ?? Promise.resolve();
    const gate = createMutationGate();
    const tail = previous.catch((): void => {}).then(() => gate.promise);
    this.mutationTails.set(filePath, tail);

    await previous.catch((): void => {});
    try {
      return await action();
    } finally {
      gate.release();
      if (this.mutationTails.get(filePath) === tail) this.mutationTails.delete(filePath);
    }
  }

  private async ownsInstalledVersion(
    filePath: string,
    stagedVersion: string | undefined,
    installAttempted: boolean
  ): Promise<boolean> {
    if (!stagedVersion || !installAttempted) return false;

    try {
      return (await this.hashArtifact(filePath)) === stagedVersion;
    } catch {
      return false;
    }
  }
}
