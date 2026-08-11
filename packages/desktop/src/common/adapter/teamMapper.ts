/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BackendTeammateStatus,
  ITeamRunAck,
  ITeamRunEvent,
  ITeamRunStateResponse,
  ITeamSlotWork,
  TeamAssistant,
  TeammateRole,
  TeammateStatus,
  TTeam,
  WorkspaceMode,
} from '../types/team/teamTypes';

// ── Parameter types for team API calls ─────────────────────────────────

/**
 * Fields the backend actually consumes when creating a team member. The
 * runtime backend / conversation type are derived server-side from the
 * assistant, so callers only supply assistant identity, role, and model.
 */
export type TeamAssistantInput = Pick<TeamAssistant, 'role' | 'assistant_name' | 'assistant_id' | 'model'>;

export type ICreateTeamParams = {
  user_id: string;
  name: string;
  workspace: string;
  workspace_mode: WorkspaceMode;
  agents: TeamAssistantInput[];
};

export type IAddTeamAssistantParams = {
  team_id: string;
  assistant: TeamAssistantInput;
};

// ── Backend → Frontend ─────────────────────────────────────────────────

const VALID_ROLES = new Set<TeammateRole>(['leader', 'teammate']);
const VALID_WORKSPACE_MODES = new Set<WorkspaceMode>(['shared', 'isolated']);

function toRole(raw: string | undefined): TeammateRole {
  if (raw === 'lead') return 'leader';
  return VALID_ROLES.has(raw as TeammateRole) ? (raw as TeammateRole) : 'teammate';
}

export function normalizeTeamStatus(raw: BackendTeammateStatus | undefined): TeammateStatus {
  const statusMap: Record<string, TeammateStatus> = {
    pending: 'pending',
    idle: 'idle',
    working: 'active',
    thinking: 'active',
    tool_use: 'active',
    completed: 'completed',
    error: 'failed',
  };
  return statusMap[raw ?? ''] ?? 'idle';
}

function toWorkspaceMode(raw: string | undefined): WorkspaceMode {
  return VALID_WORKSPACE_MODES.has(raw as WorkspaceMode) ? (raw as WorkspaceMode) : 'shared';
}

export function fromBackendAssistant(raw: unknown): TeamAssistant {
  const r = (raw ?? {}) as Record<string, unknown>;
  const agentType = (r.agent_type as string | undefined) ?? (r.backend as string | undefined) ?? '';
  const backend = (r.assistant_backend as string | undefined) ?? (r.backend as string | undefined) ?? agentType;
  return {
    slot_id: (r.slot_id as string | undefined) ?? '',
    conversation_id: (r.conversation_id as string | undefined) ?? '',
    role: toRole(r.role as string | undefined),
    assistant_backend: backend,
    icon: r.icon as string | undefined,
    assistant_name:
      (r.assistant_name as string | undefined) ??
      (r.agent_name as string | undefined) ??
      (r.name as string | undefined) ??
      '',
    status: normalizeTeamStatus(r.status as BackendTeammateStatus | undefined),
    cli_path: r.cli_path as string | undefined,
    assistant_id: r.assistant_id as string | undefined,
    model: r.model as string | undefined,
    pending_confirmations: (r.pending_confirmations ?? r.pendingConfirmations ?? 0) as number,
  };
}

export function fromBackendTeam(raw: unknown): TTeam {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawAssistants = Array.isArray(r.assistants)
    ? (r.assistants as unknown[])
    : Array.isArray(r.agents)
      ? (r.agents as unknown[])
      : [];
  const assistants = rawAssistants.map(fromBackendAssistant);
  const leaderAssistantId =
    (r.leader_assistant_id as string | undefined) ?? (r.leader_agent_id as string | undefined) ?? '';
  return {
    id: (r.id as string | undefined) ?? '',
    user_id: (r.user_id as string | undefined) ?? '',
    name: (r.name as string | undefined) ?? '',
    workspace: (r.workspace as string | undefined) ?? '',
    workspace_mode: toWorkspaceMode(r.workspace_mode as string | undefined),
    leader_assistant_id: leaderAssistantId,
    assistants,
    leader_agent_id: leaderAssistantId,
    agents: assistants,
    session_mode: r.session_mode as string | undefined,
    created_at: (r.created_at as number | undefined) ?? 0,
    updated_at: (r.updated_at as number | undefined) ?? 0,
  };
}

export function fromBackendTeamList(raw: unknown): TTeam[] {
  return Array.isArray(raw) ? (raw as unknown[]).map(fromBackendTeam) : [];
}

export function fromBackendTeamOptional(raw: unknown): TTeam | null {
  return raw == null ? null : fromBackendTeam(raw);
}

// ── Team run state (backend → frontend) ────────────────────────────────

/**
 * `slot_work` and `session_generation` only exist in newer aioncore builds.
 * Older backends answer `GET /api/teams/:id/run-state` with a bare
 * `{"active_run":null}` and ship run events without `slot_work` at all, so the
 * fields are absent — not null — on the wire whenever the installed backend
 * predates the repo's `aioncoreVersion` pin.
 *
 * The renderer treats both as guaranteed (`ITeamRunStateResponse`,
 * `ITeamRunEvent`), so normalization happens once here, at every ingress point,
 * rather than at each consumer: `strictNullChecks` is off in this project, so
 * declaring the fields optional would document the hazard without making
 * TypeScript enforce a single guard.
 */
export function fromBackendSlotWork(raw: unknown): ITeamSlotWork[] {
  return Array.isArray(raw) ? (raw as ITeamSlotWork[]) : [];
}

export function fromBackendTeamRunEvent(raw: unknown): ITeamRunEvent {
  const r = (raw ?? {}) as ITeamRunEvent;
  return { ...r, slot_work: fromBackendSlotWork(r.slot_work) };
}

export function fromBackendTeamRunEventOptional(raw: unknown): ITeamRunEvent | null {
  return raw == null ? null : fromBackendTeamRunEvent(raw);
}

export function fromBackendTeamRunState(raw: unknown): ITeamRunStateResponse {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    session_generation: (r.session_generation as string | undefined) ?? null,
    active_run: fromBackendTeamRunEventOptional(r.active_run),
    slot_work: fromBackendSlotWork(r.slot_work),
  };
}

export function fromBackendTeamRunAck(raw: unknown): ITeamRunAck {
  const r = (raw ?? {}) as ITeamRunAck;
  return { ...r, run: fromBackendTeamRunEvent(r.run) };
}

// ── Frontend → Backend ─────────────────────────────────────────────────

/**
 * A team slot was about to be created with no usable model.
 *
 * `aionrs` slots need a real model id. The literal 'default' is not one: the
 * backend stores it as `{provider_id:'aionrs', model:'default', use_model:null}`
 * — the *backend name* lands in `provider_id` and resolves to no provider —
 * then kills the half-initialized task slot during the `TeamMcpRebuild` warmup
 * and answers `POST /api/teams/:id/session` with `TEAM_MEMBER_RUNTIME_FAILED`
 * and an empty error, ~13ms after create. None of that names the model.
 *
 * So the model is resolved (and this is thrown) on the way *in*, where the
 * cause is still visible and the user can act on it. `'default'` stays legal
 * when a caller passes it deliberately — ACP backends pick their own model.
 */
export class TeamMemberModelUnresolvedError extends Error {
  /** Consumed by `getConversationCreateErrorMessage` to localize the message. */
  readonly code = 'TEAM_MEMBER_MODEL_UNRESOLVED' as const;
  readonly backend?: string;

  constructor(backend?: string, options?: { cause?: unknown }) {
    super(
      backend ? `no model resolved for this ${backend} team slot` : 'no model resolved for this team slot',
      options as ErrorOptions
    );
    this.name = 'TeamMemberModelUnresolvedError';
    this.backend = backend;
  }
}

export function toBackendAssistant(a: TeamAssistantInput): Record<string, unknown> {
  if (!a.assistant_id) {
    throw new Error('assistant_id is required');
  }

  // Deliberately not defaulting: a silent placeholder here is what turned a
  // missing model into an unattributable runtime death. See the class docs.
  if (!a.model) {
    throw new TeamMemberModelUnresolvedError();
  }

  return {
    name: a.assistant_name,
    role: a.role === 'leader' ? 'lead' : a.role,
    model: a.model,
    assistant_id: a.assistant_id,
  };
}
