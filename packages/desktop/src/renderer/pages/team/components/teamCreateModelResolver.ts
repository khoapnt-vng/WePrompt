/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { TeamMemberModelUnresolvedError } from '@/common/adapter/teamMapper';
import type { IProvider } from '@/common/config/storage';
import { assistantRuntimeKey, type AssistantDetail } from '@/common/types/agent/assistantTypes';
import { getAvailableModels } from '@renderer/pages/guid/utils/modelUtils';

/**
 * Resolve the `model` value a team agent should send to `POST /api/teams`.
 *
 * Backend `service.rs` consumes `input.model` verbatim with no default, so an
 * empty or backend-name-only value (e.g. "gemini") ends up persisted as
 * `use_model: null`. Downstream, GeminiSendBox / AionrsSendBox gate the
 * textarea on `current_model?.useModel` and render disabled. See mnemo #297.
 *
 * This resolver reads assistant-owned defaults first and then falls back to
 * backend-safe defaults when the selected assistant has no explicit model.
 * That fallback is the load-bearing path, not an edge case: every builtin
 * aionrs assistant is seeded `mode:'auto'` with no `default_model_value`, and
 * `last_model_id` stays empty until someone chats with it once — so picking a
 * never-used assistant as lead lands here.
 *
 * For ACP backends (claude, codex, acp) the model is resolved from the
 * agent's handshake data or cached model info so the backend receives a
 * valid model ID (e.g. "claude-sonnet-4-5-20250514") instead of the bare
 * backend name.
 *
 * Every branch returns a value the backend can resolve, or throws
 * `TeamMemberModelUnresolvedError`. Returning a placeholder is not an option:
 * see that class for what an unresolvable model does to a slot runtime.
 */
export async function resolveDefaultTeamAgentModel(params: {
  assistant_id?: string;
  assistant_backend?: string;
}): Promise<string> {
  const { assistant_id, assistant_backend } = params;

  const assistantDetail = await resolveAssistantDetail(assistant_id);
  if (assistantDetail) {
    const assistantModel = resolveAssistantModel(assistantDetail);
    if (assistantModel) {
      return assistantModel;
    }

    return resolveBackendDefaultModel(assistantRuntimeKey({ agent: assistantDetail.engine.agent }));
  }

  return resolveBackendDefaultModel(assistant_backend);
}

async function resolveAssistantDetail(assistant_id?: string): Promise<AssistantDetail | undefined> {
  if (!assistant_id) return undefined;

  try {
    const detail = (await ipcBridge.assistants.get.invoke({ id: assistant_id })) as AssistantDetail | null;
    return detail ?? undefined;
  } catch {
    return undefined;
  }
}

function resolveAssistantModel(detail: AssistantDetail): string | undefined {
  if (detail.defaults.model.mode === 'fixed' && detail.defaults.model.value) {
    return detail.defaults.model.value;
  }

  if (detail.defaults.model.mode === 'auto' && detail.preferences.last_model_id) {
    return detail.preferences.last_model_id;
  }

  return undefined;
}

function resolveBackendDefaultModel(assistant_backend?: string): Promise<string> {
  if (assistant_backend === 'gemini') {
    return resolveGeminiDefaultModel();
  }

  if (assistant_backend === 'aionrs') {
    return resolveAionrsDefaultModel();
  }

  return resolveAcpDefaultModel(assistant_backend ?? 'acp');
}

async function resolveAcpDefaultModel(_assistant_backend: string): Promise<string> {
  return 'default';
}

async function resolveGeminiDefaultModel(): Promise<string> {
  // The legacy 'gemini.defaultModel' config key has been removed after the
  // Gemini → ACP consolidation. Always fall back to the 'auto' alias.
  return 'auto';
}

/**
 * aionrs has no usable model sentinel — a slot needs a concrete model id that
 * some configured provider actually offers. This mirrors what the single-chat
 * flow already does for the very same assistants: `useGuidModelSelection`
 * falls back to the first available model of the first provider that has one.
 *
 * The filters are the intersection of both working paths — `enabled !== false`
 * (as `useModelProviderList`, which backs the team column-header model selector)
 * and `getAvailableModels` (as the Guid default). That keeps the auto-picked
 * model one the user can also see and switch away from in that selector.
 *
 * Throws rather than returning a placeholder when nothing is configured: no
 * value we could invent here would start a runtime.
 */
async function resolveAionrsDefaultModel(): Promise<string> {
  let providers: IProvider[];
  try {
    providers = (await ipcBridge.mode.listProviders.invoke()) ?? [];
  } catch (error) {
    throw new TeamMemberModelUnresolvedError('aionrs', { cause: error });
  }

  for (const provider of providers) {
    if (provider.enabled === false) continue;
    const [model] = getAvailableModels(provider);
    if (model) return model;
  }

  throw new TeamMemberModelUnresolvedError('aionrs');
}
