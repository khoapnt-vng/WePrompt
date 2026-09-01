/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { StudioPilotCommandResultV3 } from '@/common/types/project/creativeStudioTypes';
import type { StudioPilotClientV3, StudioPilotLibraryClientV3 } from '@/renderer/pages/studio/components/Pilot';

const unwrap = <T>(result: StudioPilotCommandResultV3<T>): T => {
  if (result.ok === true) return result.data;
  throw result.error;
};

/** Renderer adapter for the exact schema-6 IPC surface; no storage or route internals cross it. */
export const studioPilotClientV3: StudioPilotClientV3 & StudioPilotLibraryClientV3 = {
  listProjectsV3: () => ipcBridge.creativeStudioPilot.listProjects.invoke().then(unwrap),
  createProjectV3: (input) => ipcBridge.creativeStudioPilot.createProject.invoke(input).then(unwrap),
  loadProjectV3: (projectId) => ipcBridge.creativeStudioPilot.loadProject.invoke({ projectId }).then(unwrap),
  preparePhotoV3: (input) => ipcBridge.creativeStudioPilot.preparePhoto.invoke(input).then(unwrap),
  confirmPreparedPhotoV3: (input) => ipcBridge.creativeStudioPilot.confirmPreparedPhoto.invoke(input).then(unwrap),
  discardPreparedPhotoV3: (input) => ipcBridge.creativeStudioPilot.discardPreparedPhoto.invoke(input).then(unwrap),
  importPhotoV3: (input) => ipcBridge.creativeStudioPilot.importPhoto.invoke(input).then(unwrap),
  applyMutationBatchV3: (input) => ipcBridge.creativeStudioPilot.applyMutationBatch.invoke(input).then(unwrap),
  cancelJobV3: (input) => ipcBridge.creativeStudioPilot.cancelJob.invoke(input).then(unwrap),
  resumeJobV3: (input) => ipcBridge.creativeStudioPilot.resumeJob.invoke(input).then(unwrap),
  retryDownloadV3: (input) => ipcBridge.creativeStudioPilot.retryDownload.invoke(input).then(unwrap),
  listPieceExportsV3: (projectId) => ipcBridge.creativeStudioPilot.listPieceExports.invoke({ projectId }).then(unwrap),
  exportPieceV3: (input) => ipcBridge.creativeStudioPilot.exportPiece.invoke(input).then(unwrap),
  revealPieceExportV3: (input) => ipcBridge.creativeStudioPilot.revealPieceExport.invoke(input).then(unwrap),
  deleteProjectV3: (input) => ipcBridge.creativeStudioPilot.deleteProject.invoke(input).then(unwrap),
  watchProjectUpdatesV3: (listener) => ipcBridge.creativeStudioPilot.projectUpdated.on(listener),
};
