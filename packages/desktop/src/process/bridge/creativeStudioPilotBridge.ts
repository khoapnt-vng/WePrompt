/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { CREATIVE_STUDIO_ENABLED } from '@/common/config/constants';
import type {
  StudioDeliverPieceExportRequestV3,
  StudioExportPieceDeliveryResultV3,
  StudioPilotCommandResultV3,
  StudioRendererPieceExportArtifactV3,
  StudioRendererPieceExportCatalogV3,
  StudioRevealPieceExportResultV3,
} from '@/common/types/project/creativeStudioTypes';
import { BrowserWindow, dialog, shell } from 'electron';
import {
  getCreativeStudioPilotProductionRuntimeV3,
  type CreativeStudioPilotProductionRuntimeV3,
} from '@process/services/creative-studio/pilotProductionRuntime';
import { CreativeStudioPilotServiceErrorV3 } from '@process/services/creative-studio/service/pilot/errors';

const MESSAGE_KEY = 'conversation.creativeStudio.pilot.common.actionFailed';

export type CreativeStudioPilotBridgeDependenciesV3 = {
  isFeatureEnabled?: () => boolean;
  getRuntime: () => Pick<
    CreativeStudioPilotProductionRuntimeV3,
    'entryPoint' | 'pilot' | 'getDirectorSessionServer' | 'getDirectorSessionAuthority'
  >;
  getParentWindow?: () => BrowserWindow | undefined;
  chooseExportDestination?: (
    window: BrowserWindow | undefined,
    input: { suggestedName: string; isDirectory: true }
  ) => Promise<string | null>;
  revealExportPath?: (filePath: string) => void;
};

const defaultDependencies: CreativeStudioPilotBridgeDependenciesV3 = {
  getRuntime: getCreativeStudioPilotProductionRuntimeV3,
  getParentWindow: () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0],
  chooseExportDestination: async (window, input) => {
    const result = await dialog.showSaveDialog(
      window ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0],
      { defaultPath: input.suggestedName }
    );
    return result.canceled || result.filePath === undefined ? null : result.filePath;
  },
  revealExportPath: (filePath) => shell.showItemInFolder(filePath),
};

const toRendererExportArtifact = (
  artifact: StudioRendererPieceExportArtifactV3
): StudioRendererPieceExportArtifactV3 => ({
  id: artifact.id,
  pieceId: artifact.pieceId,
  sourceRevision: artifact.sourceRevision,
  handleAtExport: artifact.handleAtExport,
  byteSize: artifact.byteSize,
  payloadFileCount: artifact.payloadFileCount,
  createdAt: artifact.createdAt,
  folderName: artifact.folderName,
});

const toRendererExportCatalog = (catalog: StudioRendererPieceExportCatalogV3): StudioRendererPieceExportCatalogV3 => ({
  revision: catalog.revision,
  artifacts: catalog.artifacts.map(toRendererExportArtifact),
});

const deliverPieceExport = async (
  dependencies: CreativeStudioPilotBridgeDependenciesV3,
  input: StudioDeliverPieceExportRequestV3
): Promise<StudioExportPieceDeliveryResultV3> => {
  const runtime = dependencies.getRuntime();
  const description = await runtime.pilot.pieceExports.describe(input);
  const parentWindow = (dependencies.getParentWindow ?? defaultDependencies.getParentWindow!)();
  const destination = await (dependencies.chooseExportDestination ?? defaultDependencies.chooseExportDestination!)(
    parentWindow,
    { suggestedName: description.suggestedName, isDirectory: true }
  );
  if (destination === null) return { status: 'cancelled' };

  const before = await runtime.entryPoint.listPieceExportsV3(input.projectId);
  const beforeIds = new Set(before.artifacts.map(({ id }) => id));
  const result = await runtime.entryPoint.exportPieceV3({
    ...input,
    expectedCatalogRevision: before.revision,
  });
  const created = result.catalog.artifacts.filter(
    (artifact) =>
      artifact.pieceId === input.pieceId &&
      artifact.sourceRevision === input.expectedRevision &&
      !beforeIds.has(artifact.id)
  );
  if (created.length !== 1) throw new CreativeStudioPilotServiceErrorV3('storage_error');
  const artifact = created[0]!;
  await runtime.pilot.pieceExports.copy(
    {
      projectId: input.projectId,
      expectedCatalogRevision: result.catalog.revision,
      artifactId: artifact.id,
    },
    destination
  );
  return {
    status: 'copied',
    artifact: toRendererExportArtifact(artifact),
    catalog: toRendererExportCatalog(result.catalog),
  };
};

const command = async <T>(
  isFeatureEnabled: () => boolean,
  operation: () => Promise<T>
): Promise<StudioPilotCommandResultV3<T>> => {
  if (!isFeatureEnabled()) {
    return { ok: false, error: { code: 'runtime_inactive', messageKey: MESSAGE_KEY } };
  }
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    console.error('[CreativeStudioPilotBridge] command failed:', error);
    return {
      ok: false,
      error: {
        code: error instanceof CreativeStudioPilotServiceErrorV3 ? error.code : 'storage_error',
        messageKey: MESSAGE_KEY,
      },
    };
  }
};

/** Registers only the exact schema-6 Pilot project surface. */
export const initCreativeStudioPilotBridgeV3 = (
  dependencies: CreativeStudioPilotBridgeDependenciesV3 = defaultDependencies
): void => {
  const isFeatureEnabled = dependencies.isFeatureEnabled ?? (() => CREATIVE_STUDIO_ENABLED);
  const run = <T>(operation: () => Promise<T>): Promise<StudioPilotCommandResultV3<T>> =>
    command(isFeatureEnabled, operation);
  const entryPoint = () => dependencies.getRuntime().entryPoint;

  ipcBridge.creativeStudioPilot.listProjects.provider(() => run(() => entryPoint().listProjectsV3()));
  ipcBridge.creativeStudioPilot.createProject.provider((input) => run(() => entryPoint().createProjectV3(input)));
  ipcBridge.creativeStudioPilot.loadProject.provider(({ projectId }) =>
    run(() => entryPoint().loadProjectV3(projectId))
  );
  ipcBridge.creativeStudioPilot.getDirectorSessionServer.provider(({ projectId }) =>
    run(() => dependencies.getRuntime().getDirectorSessionServer(projectId))
  );
  ipcBridge.creativeStudioPilot.getDirectorSessionAuthority.provider(({ projectId }) =>
    run(() => dependencies.getRuntime().getDirectorSessionAuthority(projectId))
  );
  ipcBridge.creativeStudioPilot.bindDirectorConversation.provider((input) =>
    run(() => entryPoint().bindDirectorConversationV3(input))
  );
  ipcBridge.creativeStudioPilot.preparePhoto.provider((input) => run(() => entryPoint().preparePhotoV3(input)));
  ipcBridge.creativeStudioPilot.confirmPreparedPhoto.provider((input) =>
    run(() => entryPoint().confirmPreparedPhotoV3(input))
  );
  ipcBridge.creativeStudioPilot.discardPreparedPhoto.provider((input) =>
    run(() => entryPoint().discardPreparedPhotoV3(input))
  );
  ipcBridge.creativeStudioPilot.importPhoto.provider((input) => run(() => entryPoint().importPhotoV3(input)));
  ipcBridge.creativeStudioPilot.applyMutationBatch.provider((input) =>
    run(() => entryPoint().applyMutationBatchV3(input))
  );
  ipcBridge.creativeStudioPilot.cancelJob.provider((input) => run(() => entryPoint().cancelJobV3(input)));
  ipcBridge.creativeStudioPilot.resumeJob.provider((input) => run(() => entryPoint().resumeJobV3(input)));
  ipcBridge.creativeStudioPilot.retryDownload.provider((input) => run(() => entryPoint().retryDownloadV3(input)));
  ipcBridge.creativeStudioPilot.listPieceExports.provider(({ projectId }) =>
    run(() => entryPoint().listPieceExportsV3(projectId))
  );
  ipcBridge.creativeStudioPilot.exportPiece.provider((input) => run(() => deliverPieceExport(dependencies, input)));
  ipcBridge.creativeStudioPilot.revealPieceExport.provider((input) =>
    run(async (): Promise<StudioRevealPieceExportResultV3> => {
      const runtime = dependencies.getRuntime();
      const filePath = await runtime.pilot.pieceExports.resolveRevealPath(input);
      (dependencies.revealExportPath ?? defaultDependencies.revealExportPath!)(filePath);
      return { status: 'revealed' };
    })
  );
  ipcBridge.creativeStudioPilot.deleteProject.provider((input) => run(() => entryPoint().deleteProjectV3(input)));
};
