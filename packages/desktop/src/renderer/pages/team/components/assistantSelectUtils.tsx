import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Robot } from '@icon-park/react';
import { resolveAssistantAvatar } from '@renderer/utils/model/assistantAvatar';
import {
  getForgeAssistantBrandKey,
  resolveAssistantName,
  type ForgeAssistantBrandKey,
} from '@renderer/utils/model/assistantDisplay';
import { assistantRuntimeKey, type Assistant } from '@/common/types/agent/assistantTypes';

/** Team leader selector entry derived from the unified assistant catalog. */
export type TeamAssistantOption = {
  id: string;
  name: string;
  /** Execution backend (claude, gemini, qwen, …). */
  backend?: string;
  /** Avatar token — a backend-resolved URL or an emoji. */
  icon?: string;
  /** Whether this assistant can currently be used in team mode. */
  team_selectable?: boolean;
  /** Why this assistant cannot currently be used in team mode. */
  team_block_reason?: string;
  /**
   * Forge brand i18n key when this is one of the rebranded built-in agents.
   * Display-only: `name` keeps the real catalog name so persisted team records
   * stay stable; the selector label renders the brand name from this key.
   */
  brandKey?: ForgeAssistantBrandKey | null;
};

export function assistantToOption(assistant: Assistant, localeKey = 'en-US'): TeamAssistantOption {
  return {
    id: assistant.id,
    name: resolveAssistantName(assistant, localeKey, assistant.name),
    backend: assistantRuntimeKey(assistant),
    icon: assistant.avatar,
    team_selectable: assistant.team_selectable,
    team_block_reason: assistant.team_block_reason,
    brandKey: getForgeAssistantBrandKey(assistant),
  };
}

export function assistantKey(assistant: TeamAssistantOption): string {
  return assistant.id;
}

/**
 * The name to show the user for a team assistant option.
 *
 * `option.name` is the raw catalog name, kept as-is so persisted team records
 * stay stable — for the Forge-rebranded built-ins that is NOT what the picker
 * row says. Every user-facing string built from an option (labels, error
 * messages, confirmations) must go through here, otherwise it names an
 * assistant by a name that appears nowhere on screen.
 */
export function resolveTeamAssistantLabel(
  assistant: Pick<TeamAssistantOption, 'name' | 'brandKey'>,
  t: TFunction
): string {
  return assistant.brandKey ? t(assistant.brandKey) : assistant.name;
}

export function assistantFromId(
  assistantId: string,
  allAssistants: TeamAssistantOption[]
): TeamAssistantOption | undefined {
  return allAssistants.find((assistant) => assistantKey(assistant) === assistantId);
}

/** Filter assistants to only those supported in team mode. */
export function filterTeamSupportedAssistants(assistants: TeamAssistantOption[]): TeamAssistantOption[] {
  return assistants;
}

type AssistantOptionLabelProps = {
  assistant: TeamAssistantOption;
  size?: 'compact' | 'large';
  muted?: boolean;
};

export const AssistantOptionLabel: React.FC<AssistantOptionLabelProps> = ({
  assistant,
  size = 'compact',
  muted = false,
}) => {
  const { t } = useTranslation();
  const avatar = resolveAssistantAvatar(assistant.icon);
  const label = resolveTeamAssistantLabel(assistant, t);
  const isLarge = size === 'large';
  const iconSize = isLarge ? 18 : 16;
  const avatarToneClass = muted ? 'bg-fill-1 text-t-tertiary opacity-75' : 'bg-fill-2 text-t-primary';
  const avatarClass = isLarge
    ? `flex h-30px w-30px shrink-0 items-center justify-center rounded-8px ${avatarToneClass}`
    : `flex h-32px w-32px shrink-0 items-center justify-center rounded-8px ${avatarToneClass}`;
  const nameClass = muted ? 'text-t-tertiary' : 'text-t-primary';
  const avatarNode =
    avatar.kind === 'image' ? (
      <img src={avatar.value} alt={label} style={{ width: iconSize, height: iconSize, objectFit: 'contain' }} />
    ) : avatar.kind === 'emoji' ? (
      <span style={{ fontSize: isLarge ? 18 : 14, lineHeight: `${iconSize}px` }}>{avatar.value}</span>
    ) : (
      <Robot size={String(iconSize)} />
    );

  return (
    <div className={isLarge ? 'flex min-w-0 items-center gap-12px' : 'flex min-w-0 items-center gap-8px'}>
      <span className={avatarClass} data-testid='assistant-avatar'>
        {avatarNode}
      </span>
      <span
        data-testid='assistant-option-name'
        className={
          isLarge ? `min-w-0 truncate text-14px font-500 leading-21px ${nameClass}` : `min-w-0 truncate ${nameClass}`
        }
      >
        {label}
      </span>
    </div>
  );
};
