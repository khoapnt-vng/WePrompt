/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { ipcBridge } from '@/common';
import {
  STUDIO_MAX_DIRTY_DRAFTS_REPORTED,
  type StudioRendererProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import { countStoredStudioRuleDrafts, countStoredWorkspaceDrafts } from '../components/Workspace';

export type StudioCloseContract = {
  dirtyDraftCount: number;
  saveAll: () => Promise<boolean>;
};

export const StudioCloseResponse: React.FC<{ resolve: () => StudioCloseContract }> = ({ resolve }) => {
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  useEffect(() => {
    const disposeHasUnsavedWork = ipcBridge.creativeStudio.hasUnsavedWork.provider(() => ({
      dirtyDraftCount: Math.min(resolveRef.current().dirtyDraftCount, STUDIO_MAX_DIRTY_DRAFTS_REPORTED),
    }));
    const disposeFlushUnsavedWork = ipcBridge.creativeStudio.flushUnsavedWork.provider(async () => ({
      saved: await resolveRef.current().saveAll(),
    }));
    return () => {
      disposeHasUnsavedWork();
      disposeFlushUnsavedWork();
    };
  }, []);
  return null;
};

export const useStudioCloseContractOwner = () => {
  const projectCloseContractRef = useRef<StudioCloseContract | null>(null);
  const updateProjectCloseContract = useCallback((contract: StudioCloseContract | null): void => {
    projectCloseContractRef.current = contract;
  }, []);
  const resolveCloseContract = useCallback(
    (): StudioCloseContract =>
      projectCloseContractRef.current ?? {
        dirtyDraftCount: countStoredStudioRuleDrafts() + countStoredWorkspaceDrafts(),
        saveAll: async () => countStoredStudioRuleDrafts() + countStoredWorkspaceDrafts() === 0,
      },
    []
  );
  return { updateProjectCloseContract, resolveCloseContract };
};

type StudioCloseContractPublicationInput = {
  project: StudioRendererProjectV2 | null;
  closeDirtyDraftCount: number;
  flushAllWorkspaceDrafts: () => Promise<boolean>;
  onCloseContractChange: (contract: StudioCloseContract | null) => void;
};

export const useStudioCloseContractPublication = ({
  project,
  closeDirtyDraftCount,
  flushAllWorkspaceDrafts,
  onCloseContractChange,
}: StudioCloseContractPublicationInput): void => {
  useLayoutEffect(() => {
    if (project === null) {
      onCloseContractChange(null);
      return;
    }
    onCloseContractChange({ dirtyDraftCount: closeDirtyDraftCount, saveAll: flushAllWorkspaceDrafts });
    return () => onCloseContractChange(null);
  }, [closeDirtyDraftCount, flushAllWorkspaceDrafts, onCloseContractChange, project]);
};
