/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioProjectV4 } from '@/common/types/project/creativeStudioTypes';

/** Complete durable identity namespace against which Main-issued schema-7 IDs are checked. */
export const studioPersistentIdentitiesV4 = (project: StudioProjectV4): Set<string> => {
  const identities = new Set<string>([
    project.id,
    ...project.rules.map((rule) => rule.id),
    ...Object.keys(project.pieces),
    ...Object.keys(project.assets),
    ...Object.values(project.pieces).flatMap((piece) =>
      piece.assetHistory.flatMap((entry) =>
        entry.state === 'evicted'
          ? [
              entry.assetsByRole.primary.id,
              ...(entry.assetsByRole.poster === null ? [] : [entry.assetsByRole.poster.id]),
            ]
          : []
      )
    ),
    ...Object.keys(project.jobs),
    ...Object.keys(project.frameExtractions),
    ...Object.keys(project.derivedFrames),
    ...project.undoHistory.map((entry) => entry.id),
    ...project.bin.map((entry) => entry.id),
  ]);
  for (const authorization of project.spendAuthorizations) {
    identities.add(authorization.id);
    identities.add(authorization.quote.id);
    identities.add(authorization.quote.reservationId);
    identities.add(authorization.quote.item.id);
    identities.add(authorization.idempotencyKey.key);
  }
  for (const board of Object.values(project.boards)) {
    identities.add(board.id);
    Object.keys(board.beats).forEach((id) => identities.add(id));
    Object.keys(board.shots).forEach((id) => identities.add(id));
  }
  for (const assembly of Object.values(project.assemblies)) {
    identities.add(assembly.id);
    Object.keys(assembly.soundBindings).forEach((id) => identities.add(id));
  }
  return identities;
};

/** Handles and prior aliases share one project-wide namespace across all canvas subjects. */
export const studioCanvasHandleIsTakenV4 = (project: StudioProjectV4, handle: string): boolean =>
  [...Object.values(project.pieces), ...Object.values(project.boards), ...Object.values(project.assemblies)].some(
    (subject) => subject.handle === handle || subject.priorHandles.includes(handle)
  );
