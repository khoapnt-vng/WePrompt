/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useEffect, useMemo, useState } from 'react';

import { ipcBridge } from '@/common';
import {
  STUDIO_SHOT_AUDIO_ANALYSIS_PROFILE_V1,
  type StudioShotAudioAnalysisV2,
  type StudioShotAudioAnalysisResultV2,
} from '@/common/types/project/creativeStudioTypes';

export type StudioShotAudioDisplayAnalysis =
  | StudioShotAudioAnalysisV2
  | { shotId: string; assetId: string; status: 'analyzing'; meanVolumeDbfs: null; peakVolumeDbfs: null };

type StudioShotAudioAnalysisContextValue = ReadonlyMap<string, StudioShotAudioDisplayAnalysis>;
const StudioShotAudioAnalysisContext = createContext<StudioShotAudioAnalysisContextValue>(new Map());

const itemKey = (shotId: string, assetId: string): string => `${shotId}\0${assetId}`;
const pendingAnalysis = (shotId: string, assetId: string): StudioShotAudioDisplayAnalysis => ({
  shotId,
  assetId,
  status: 'analyzing',
  meanVolumeDbfs: null,
  peakVolumeDbfs: null,
});
const unavailableAnalysis = (shotId: string, assetId: string): StudioShotAudioDisplayAnalysis => ({
  shotId,
  assetId,
  status: 'unavailable',
  meanVolumeDbfs: null,
  peakVolumeDbfs: null,
});
const supportedStatus = (status: unknown): status is StudioShotAudioAnalysisV2['status'] =>
  status === 'audible' || status === 'effectively_silent' || status === 'no_audio_stream' || status === 'unavailable';

const validAnalysisShape = (analysis: StudioShotAudioAnalysisV2): boolean => {
  const meanIsValid = analysis.meanVolumeDbfs === null || Number.isFinite(analysis.meanVolumeDbfs);
  const peakIsValid = analysis.peakVolumeDbfs === null || Number.isFinite(analysis.peakVolumeDbfs);
  if (!meanIsValid || !peakIsValid) return false;
  if (analysis.status === 'no_audio_stream' || analysis.status === 'unavailable') {
    return analysis.meanVolumeDbfs === null && analysis.peakVolumeDbfs === null;
  }
  return (
    analysis.status === 'effectively_silent' || analysis.meanVolumeDbfs !== null || analysis.peakVolumeDbfs !== null
  );
};

const exactResult = (
  value: StudioShotAudioAnalysisResultV2,
  projectId: string,
  projectRevision: number,
  shots: readonly { shotId: string; assetId: string }[]
): StudioShotAudioAnalysisV2[] | null => {
  if (
    value.projectId !== projectId ||
    value.projectRevision !== projectRevision ||
    value.profile !== STUDIO_SHOT_AUDIO_ANALYSIS_PROFILE_V1 ||
    value.shots.length !== shots.length
  ) {
    return null;
  }
  return value.shots.every((analysis, index) => {
    const expected = shots[index];
    return (
      expected !== undefined &&
      analysis.shotId === expected.shotId &&
      analysis.assetId === expected.assetId &&
      supportedStatus(analysis.status) &&
      validAnalysisShape(analysis)
    );
  })
    ? value.shots
    : null;
};

export type StudioShotAudioAnalysisProviderProps = {
  children: React.ReactNode;
  projectId: string;
  projectRevision: number;
  shots: readonly { shotId: string; assetId: string }[];
};

/** Loads ephemeral, revision-correlated loudness facts for the current active Shot takes. */
export const StudioShotAudioAnalysisProvider: React.FC<StudioShotAudioAnalysisProviderProps> = ({
  children,
  projectId,
  projectRevision,
  shots,
}) => {
  const signature = JSON.stringify({ projectId, projectRevision, shots });
  const requestShots = useMemo(
    () => shots.map(({ shotId, assetId }) => ({ shotId, assetId })),
    // `signature` is the exact ordered request authority and intentionally replaces array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature]
  );
  const pending = useMemo(
    () =>
      new Map(requestShots.map(({ shotId, assetId }) => [itemKey(shotId, assetId), pendingAnalysis(shotId, assetId)])),
    [requestShots]
  );
  const [stored, setStored] = useState<{ signature: string; analyses: StudioShotAudioAnalysisContextValue }>(() => ({
    signature,
    analyses: pending,
  }));
  const analyses = stored.signature === signature ? stored.analyses : pending;

  useEffect(() => {
    let cancelled = false;
    if (requestShots.length === 0) {
      setStored({ signature, analyses: new Map() });
      return () => {
        cancelled = true;
      };
    }
    setStored({ signature, analyses: pending });
    void ipcBridge.creativeStudio.analyzeShotAudio
      .invoke({ projectId, expectedRevision: projectRevision, shots: requestShots.map((shot) => ({ ...shot })) })
      .then((result) => {
        if (cancelled) return;
        const exact = result.ok ? exactResult(result.data, projectId, projectRevision, requestShots) : null;
        const resolved = exact ?? requestShots.map(({ shotId, assetId }) => unavailableAnalysis(shotId, assetId));
        setStored({
          signature,
          analyses: new Map(resolved.map((analysis) => [itemKey(analysis.shotId, analysis.assetId), analysis])),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setStored({
          signature,
          analyses: new Map(
            requestShots.map(({ shotId, assetId }) => [itemKey(shotId, assetId), unavailableAnalysis(shotId, assetId)])
          ),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [pending, projectId, projectRevision, requestShots, signature]);

  return <StudioShotAudioAnalysisContext.Provider value={analyses}>{children}</StudioShotAudioAnalysisContext.Provider>;
};

export const useStudioShotAudioAnalysis = (
  shotId: string,
  assetId: string | null
): StudioShotAudioDisplayAnalysis | null => {
  const analyses = React.useContext(StudioShotAudioAnalysisContext);
  return assetId === null ? null : (analyses.get(itemKey(shotId, assetId)) ?? null);
};
