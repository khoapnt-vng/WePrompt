/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioMediaKind } from './creativeStudioTypes';

/**
 * A Studio route needs a connection binding, not just a configured provider. Until one exists the
 * route catalogue is empty, so a project has nothing to bind, a finished script has nothing to
 * render with, and the only way through is a visit to Settings.
 *
 * This plans which connections are worth trying. It does not make them: each attempt is a live
 * validation probe against the provider, so the caller runs them, in order, and stops as soon as a
 * kind is satisfied.
 */

const HEALTH_ORDER = { available: 0, unknown: 1 } as const;

/** Attempts per kind. Each one is a network round trip, so this is a budget, not a limit to raise. */
export const STUDIO_CONNECTION_ATTEMPT_BUDGET = 3;

type CandidateModel = { model: string; health: 'available' | 'unknown' | 'unavailable' };

type Candidate = {
  providerId: string;
  integrationModels: readonly { integrationLabelKey: string; models: readonly CandidateModel[] }[];
};

type Integration = { integrationId: string; kind: StudioMediaKind; labelKey: string };

export type StudioConnectionAttempt = {
  providerId: string;
  integrationId: string;
  model: string;
  kind: StudioMediaKind;
};

/**
 * The connections worth attempting, in the order to attempt them.
 *
 * A kind that already has a connection is skipped entirely — a binding someone chose is never
 * reconsidered. `unavailable` models are never attempted, and `available` is tried before `unknown`,
 * which means unprobed rather than broken.
 */
export const planStudioConnections = (input: {
  candidates: readonly Candidate[];
  integrations: readonly Integration[];
  existing: readonly { integrationId: string }[];
  maxAttemptsPerKind?: number;
}): StudioConnectionAttempt[] => {
  const budget = input.maxAttemptsPerKind ?? STUDIO_CONNECTION_ATTEMPT_BUDGET;
  const connectedKinds = new Set(
    input.existing
      .map((connection) => input.integrations.find((one) => one.integrationId === connection.integrationId)?.kind)
      .filter((kind): kind is StudioMediaKind => kind !== undefined)
  );

  const attempts: StudioConnectionAttempt[] = [];
  for (const kind of ['image', 'video'] as const) {
    if (connectedKinds.has(kind)) continue;
    const forKind: (StudioConnectionAttempt & { health: 'available' | 'unknown' })[] = [];
    for (const candidate of input.candidates) {
      for (const group of candidate.integrationModels) {
        // The label key is the only join between a candidate group and an integration id. A group
        // this build does not recognise has no id to send, so it cannot become an attempt.
        const integration = input.integrations.find((one) => one.labelKey === group.integrationLabelKey);
        if (integration === undefined || integration.kind !== kind) continue;
        for (const model of group.models) {
          if (model.health === 'unavailable') continue;
          forKind.push({
            providerId: candidate.providerId,
            integrationId: integration.integrationId,
            model: model.model,
            kind,
            health: model.health,
          });
        }
      }
    }
    forKind.sort((left, right) => HEALTH_ORDER[left.health] - HEALTH_ORDER[right.health]);
    for (const { health: _health, ...attempt } of forKind.slice(0, budget)) attempts.push(attempt);
  }
  return attempts;
};
