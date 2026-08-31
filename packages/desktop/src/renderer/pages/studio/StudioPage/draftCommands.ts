/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';
import { ipcBridge } from '@/common';
import {
  STUDIO_MAX_MUTATION_OPERATIONS,
  type StudioCommandResult,
  type StudioRendererAuthoringOperationV2,
  type StudioRendererProjectCommitResultV2,
  type StudioRendererProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  majorUnitsToMinorUnits,
  type UseWorkspaceDraftsResult,
  type WorkspaceDraftValue,
  type WorkspaceMutationCallbacks,
} from '../components/Workspace';

type MutableValueRef<Value> = { current: Value };

type StudioRunWorkspaceCommitAtRevision = (
  expectedRevision: number,
  invoke: (current: StudioRendererProjectV2) => Promise<StudioCommandResult<StudioRendererProjectCommitResultV2>>,
  onCommitted?: () => void
) => Promise<number | null>;

const minorUnitsDraft = (minorUnits: number): string => {
  const whole = Math.trunc(minorUnits / 100);
  return `${whole}.${String(minorUnits % 100).padStart(2, '0')}`;
};

export const beatDraftKey = (beatId: string): string => `beat.${beatId}.story`;

export const shotDraftKey = (shotId: string, field: 'shootingScript' | 'durationSeconds'): string =>
  `shot.${shotId}.${field}`;

export const projectDraftValues = (project: StudioRendererProjectV2): Record<string, WorkspaceDraftValue> => {
  const values: Record<string, WorkspaceDraftValue> = {
    'settings.aspectRatio': project.aspectRatio,
    'settings.resolution': project.resolution,
    'brief.text': project.brief,
    'brief.imageRouteId': project.imageRouteId ?? '',
    'brief.videoRouteId': project.videoRouteId ?? '',
    'brief.spendCurrency': project.spendPolicy?.currency ?? '',
    'brief.spendMajorUnits':
      project.spendPolicy === null ? '' : minorUnitsDraft(project.spendPolicy.maxPerBatchMinorUnits),
    'gate.choices': '{}',
  };
  for (const beatId of project.beatOrder) {
    const beat = Object.hasOwn(project.beats, beatId) ? project.beats[beatId] : undefined;
    if (beat?.id !== beatId) continue;
    values[beatDraftKey(beatId)] = beat.story;
    for (const shotId of beat.shotOrder) {
      const shot = Object.hasOwn(project.shots, shotId) ? project.shots[shotId] : undefined;
      if (shot?.id !== shotId) continue;
      values[shotDraftKey(shotId, 'shootingScript')] = shot.shootingScript;
      values[shotDraftKey(shotId, 'durationSeconds')] = shot.durationSeconds;
    }
  }
  return values;
};

type StudioDraftCommandCoordinatorInput = {
  drafts: UseWorkspaceDraftsResult;
  requestShapeLocked: boolean | undefined;
  projectRef: MutableValueRef<StudioRendererProjectV2 | null>;
  workspacePendingRef: MutableValueRef<boolean>;
  runWorkspaceCommitAtRevision: StudioRunWorkspaceCommitAtRevision;
  ruleDraftDirtyCount: number;
  inactiveWorkspaceDraftDirtyCount: number;
};

export const useStudioDraftCommandCoordinator = ({
  drafts,
  requestShapeLocked,
  projectRef,
  workspacePendingRef,
  runWorkspaceCommitAtRevision,
  ruleDraftDirtyCount,
  inactiveWorkspaceDraftDirtyCount,
}: StudioDraftCommandCoordinatorInput) => {
  const saveAllDrafts = useCallback(async (): Promise<boolean> => {
    if (drafts.staleRevision) return false;
    const startingProject = projectRef.current;
    if (startingProject === null || workspacePendingRef.current) return false;
    let expectedRevision = startingProject.revision;
    const currentForChain = (): StudioRendererProjectV2 | null => {
      const current = projectRef.current;
      return current?.revision === expectedRevision ? current : null;
    };
    const runChainedCommit = async (
      invoke: (current: StudioRendererProjectV2) => Promise<StudioCommandResult<StudioRendererProjectCommitResultV2>>
    ): Promise<boolean> => {
      const committedRevision = await runWorkspaceCommitAtRevision(expectedRevision, invoke);
      if (committedRevision === null) return false;
      expectedRevision = committedRevision;
      return true;
    };
    const dirty = new Set(drafts.dirtyKeys);
    const hasBlockedShapeDraft =
      requestShapeLocked === true && (dirty.has('settings.aspectRatio') || dirty.has('settings.resolution'));
    const settingsKeys = ['settings.aspectRatio', 'settings.resolution'];
    if (settingsKeys.some((key) => dirty.has(key))) {
      const current = currentForChain();
      if (current === null) return false;
      const submittedSettings = Object.fromEntries(settingsKeys.map((key) => [key, drafts.value(key)]));
      const requestShape = requestShapeLocked
        ? {}
        : {
            aspectRatio: drafts.value('settings.aspectRatio') as StudioRendererProjectV2['aspectRatio'],
            resolution: drafts.value('settings.resolution') as StudioRendererProjectV2['resolution'],
          };
      const aspectRatioChanged =
        requestShape.aspectRatio !== undefined && requestShape.aspectRatio !== current.aspectRatio;
      const resolutionChanged = requestShape.resolution !== undefined && requestShape.resolution !== current.resolution;
      const changes: Parameters<WorkspaceMutationCallbacks['editProject']>[0] | null =
        aspectRatioChanged && resolutionChanged
          ? {
              aspectRatio: requestShape.aspectRatio!,
              resolution: requestShape.resolution!,
            }
          : aspectRatioChanged
            ? { aspectRatio: requestShape.aspectRatio! }
            : resolutionChanged
              ? { resolution: requestShape.resolution! }
              : null;
      if (
        changes !== null &&
        !(await runChainedCommit((authority) =>
          ipcBridge.creativeStudio.editProject.invoke({
            projectId: authority.id,
            expectedRevision: authority.revision,
            changes,
          })
        ))
      ) {
        return false;
      }
      if (requestShapeLocked !== true) {
        ['settings.aspectRatio', 'settings.resolution'].forEach((key) =>
          drafts.resetIfValue(key, submittedSettings[key] as WorkspaceDraftValue)
        );
      }
    }

    const authoringKeys = [
      'brief.text',
      'brief.imageRouteId',
      'brief.videoRouteId',
      'brief.spendCurrency',
      'brief.spendMajorUnits',
    ];
    if (authoringKeys.some((key) => dirty.has(key))) {
      const current = currentForChain();
      if (current === null) return false;
      const submittedAuthoring = Object.fromEntries(authoringKeys.map((key) => [key, drafts.value(key)]));
      const operations: StudioRendererAuthoringOperationV2[] = [];
      const brief = String(drafts.value('brief.text') ?? '');
      const imageRouteId = String(drafts.value('brief.imageRouteId') ?? '') || null;
      const videoRouteId = String(drafts.value('brief.videoRouteId') ?? '') || null;
      if (brief !== current.brief) operations.push({ kind: 'set_brief', brief });
      if (imageRouteId !== current.imageRouteId || videoRouteId !== current.videoRouteId) {
        operations.push({ kind: 'set_routes', imageRouteId, videoRouteId });
      }
      const currency = String(drafts.value('brief.spendCurrency') ?? '')
        .trim()
        .toUpperCase();
      const major = String(drafts.value('brief.spendMajorUnits') ?? '').trim();
      const minorUnits = major.length === 0 ? null : majorUnitsToMinorUnits(major);
      if (minorUnits === null && major.length > 0) return false;
      const policy = major.length === 0 ? null : { currency, maxPerBatchMinorUnits: minorUnits as number };
      if (policy !== null && !/^[A-Z]{3}$/.test(policy.currency)) return false;
      if (JSON.stringify(policy) !== JSON.stringify(current.spendPolicy)) {
        operations.push({ kind: 'set_spend_policy', policy });
      }
      if (
        operations.length > 0 &&
        !(await runChainedCommit((authority) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: authority.id,
            expectedRevision: authority.revision,
            operations,
          })
        ))
      ) {
        return false;
      }
      authoringKeys.forEach((key) => drafts.resetIfValue(key, submittedAuthoring[key] as WorkspaceDraftValue));
    }

    type SubmittedOperation = {
      operation: StudioRendererAuthoringOperationV2;
      values: [key: string, value: WorkspaceDraftValue][];
    };
    const submittedOperations: SubmittedOperation[] = [];
    const current = currentForChain();
    if (current === null) return false;
    for (const beatId of current.beatOrder) {
      const beat = Object.hasOwn(current.beats, beatId) ? current.beats[beatId] : undefined;
      if (beat?.id !== beatId) continue;
      const values: SubmittedOperation['values'] = [];
      const changes: Partial<Pick<typeof beat, 'story'>> = {};
      const storyKey = beatDraftKey(beatId);
      if (dirty.has(storyKey)) {
        const value = drafts.value(storyKey);
        if (typeof value !== 'string') return false;
        values.push([storyKey, value]);
        if (value !== beat.story) changes.story = value;
      }
      if (values.length > 0) {
        if (Object.keys(changes).length === 0) {
          values.forEach(([submittedKey, value]) => drafts.resetIfValue(submittedKey, value));
        } else {
          submittedOperations.push({
            operation: { kind: 'edit_beat', beatId, changes } as StudioRendererAuthoringOperationV2,
            values,
          });
        }
      }
      for (const shotId of beat.shotOrder) {
        const shot = Object.hasOwn(current.shots, shotId) ? current.shots[shotId] : undefined;
        if (shot?.id !== shotId) continue;
        const shotValues: SubmittedOperation['values'] = [];
        const shotChanges: Partial<Pick<typeof shot, 'shootingScript' | 'durationSeconds'>> = {};
        for (const field of ['shootingScript', 'durationSeconds'] as const) {
          const draftKey = shotDraftKey(shotId, field);
          if (!dirty.has(draftKey)) continue;
          const value = drafts.value(draftKey);
          if (
            (field === 'durationSeconds' && !Number.isSafeInteger(value)) ||
            (field !== 'durationSeconds' && typeof value !== 'string')
          ) {
            return false;
          }
          shotValues.push([draftKey, value as WorkspaceDraftValue]);
          if (value !== shot[field]) Object.assign(shotChanges, { [field]: value });
        }
        if (shotValues.length === 0) continue;
        if (Object.keys(shotChanges).length === 0) {
          shotValues.forEach(([submittedKey, value]) => drafts.resetIfValue(submittedKey, value));
          continue;
        }
        submittedOperations.push({
          operation: { kind: 'edit_shot', shotId, changes: shotChanges } as StudioRendererAuthoringOperationV2,
          values: shotValues,
        });
      }
    }
    for (let offset = 0; offset < submittedOperations.length; offset += STUDIO_MAX_MUTATION_OPERATIONS) {
      const batch = submittedOperations.slice(offset, offset + STUDIO_MAX_MUTATION_OPERATIONS);
      if (
        // The next batch is revision-dependent on the prior batch and must remain sequential.
        // eslint-disable-next-line no-await-in-loop
        !(await runChainedCommit((authority) =>
          ipcBridge.creativeStudio.applyAuthoringBatch.invoke({
            projectId: authority.id,
            expectedRevision: authority.revision,
            operations: batch.map(({ operation }) => operation),
          })
        ))
      ) {
        return false;
      }
      for (const { values } of batch) {
        values.forEach(([key, value]) => drafts.resetIfValue(key, value));
      }
    }
    return !hasBlockedShapeDraft;
  }, [drafts, requestShapeLocked, runWorkspaceCommitAtRevision]);

  const flushAllWorkspaceDrafts = useCallback(
    async (): Promise<boolean> =>
      ruleDraftDirtyCount === 0 && inactiveWorkspaceDraftDirtyCount === 0 && saveAllDrafts(),
    [inactiveWorkspaceDraftDirtyCount, ruleDraftDirtyCount, saveAllDrafts]
  );

  return {
    saveAllDrafts,
    flushAllWorkspaceDrafts,
    closeDirtyDraftCount: drafts.dirtyCount + ruleDraftDirtyCount + inactiveWorkspaceDraftDirtyCount,
  };
};
