/**
 * Reusable selectors for E2E tests.
 *
 * Because the app currently has **no** `data-testid` attributes, we rely on
 * CSS class names, Arco-Design component classes, and text-content matching.
 *
 * When the app adds `data-testid` later, update these selectors in one place.
 */
import { CLOSE_LABELS, COLLAPSE_SIDEBAR_LABELS, EXPAND_SIDEBAR_LABELS } from './localizedLabels';

// ── Generic ──────────────────────────────────────────────────────────────────

/** Chat text input (textarea / contenteditable / textbox). */
export const CHAT_INPUT = 'textarea, [contenteditable="true"], [role="textbox"]';

// ── Settings sidebar (route-based page) ──────────────────────────────────────

export const SETTINGS_SIDER = '.settings-sider';
export const SETTINGS_SIDER_ITEM = '.settings-sider__item';
export const SETTINGS_SIDER_ITEM_LABEL = '.settings-sider__item-label';

/** Match a settings sider item by logical tab ID (builtin/extension global id). */
export function settingsSiderItemById(id: string): string {
  return `${SETTINGS_SIDER_ITEM}[data-settings-id="${id}"]`;
}

// ── Settings modal ───────────────────────────────────────────────────────────

export const SETTINGS_MODAL = '.settings-modal';

// ── Modal chrome ─────────────────────────────────────────────────────────────

/** Class on each titlebar window control (WindowControls.tsx). */
const WINDOW_CONTROL_CLASS = 'app-window-controls__button';

/**
 * Build a CSS selector list matching a button under any of `labels`.
 *
 * `scope` and `exclude` are distributed over every alternative rather than
 * concatenated once: a CSS selector list binds looser than anything else, so
 * `'.arco-modal ' + 'button[…A], button[…B]'` would scope only the first
 * alternative and leave the rest matching page-wide.
 */
function buttonByAnyLabel(labels: string[], scope = '', exclude = ''): string {
  const prefix = scope ? `${scope} ` : '';
  const suffix = exclude ? `:not(.${exclude})` : '';
  return labels.map((label) => `${prefix}button[aria-label="${label}"]${suffix}`).join(', ');
}

/**
 * A `<button>` whose visible **text** is any of `labels`, for the controls that
 * carry no `aria-label` (Arco Buttons render their label as text).
 *
 * `:has-text()` is a case-insensitive substring match — the same semantics as the
 * hand-written English/Chinese pairs this replaces. `scope` is distributed for
 * the reason given on {@link buttonByAnyLabel}.
 */
export function buttonWithText(labels: string[], scope = ''): string {
  const prefix = scope ? `${scope} ` : '';
  return labels.map((label) => `${prefix}button:has-text("${label}")`).join(', ');
}

/**
 * AionModal's header close button, in whatever language the app is running.
 *
 * Both header variants label the button `aria-label={t('common.close')}`, so a
 * selector pinned to the literal `"Close"` stops matching the moment the app
 * runs in a locale that translates the key (see {@link CLOSE_LABELS}). This
 * accepts every locale's spelling.
 *
 * Still anchor the result to a modal — either via `scope` or by chaining — so a
 * sweep cannot reach a different modal than the one under test. The window
 * chrome is excluded structurally as well: WindowControls labels the titlebar
 * close button from this same `common.close` key, giving it an accessible name
 * identical to the modal's in every locale, and an unanchored match on it would
 * quit the app mid-suite rather than close a dialog.
 *
 * @param scope Optional CSS ancestor to scope the button to (`'.arco-modal'`,
 *   `'.arco-modal-wrapper:visible'`, …). Pass it here rather than
 *   concatenating — see {@link buttonByAnyLabel} for why. Omit it when chaining
 *   off an existing locator, which scopes the whole list.
 */
export function modalCloseButton(scope = ''): string {
  return buttonByAnyLabel(CLOSE_LABELS, scope, WINDOW_CONTROL_CLASS);
}

// ── Arco Design components ───────────────────────────────────────────────────

export const ARCO_SWITCH = '.arco-switch';
export const ARCO_SWITCH_CHECKED = '.arco-switch-checked';
export const ARCO_COLLAPSE_ITEM = '.arco-collapse-item';
export const ARCO_COLLAPSE_HEADER = '.arco-collapse-item-header';
export const ARCO_TABS_HEADER_TITLE = '.arco-tabs-header-title';
export const ARCO_MESSAGE_SUCCESS = '.arco-message-success';

// ── Guid page ───────────────────────────────────────────────────────────────

/** Guid page chat input textarea. */
export const GUID_INPUT = '.guid-input-card-shell textarea';

// ── Mode selector ──────────────────────────────────────────────────────────

/** Mode selector pill (AgentModeSelector compact mode). */
export const MODE_SELECTOR = '[data-testid="mode-selector"]';

/** Match mode dropdown menu item by mode value. */
export function modeMenuItemByValue(value: string): string {
  return `[data-mode-value="${value}"]`;
}

// ── Conversation page ───────────────────────────────────────────────────────

/** Agent status message badge (connecting / session_active / error). */
export const AGENT_STATUS_MESSAGE = '.agent-status-message';

/** AI (left-aligned) text message container. */
export const AI_TEXT_MESSAGE = '[data-testid="message-text-left"]';

/** User (right-aligned) text message container. */
export const USER_TEXT_MESSAGE = '[data-testid="message-text-right"]';

/** Text content element inside a message (works for both user/AI). */
export const MESSAGE_TEXT_CONTENT = '[data-testid="message-text-content"]';

// ── Sidebar ─────────────────────────────────────────────────────────────────

/** New chat trigger button in sidebar (CSS module hash varies). */
export const NEW_CHAT_TRIGGER = 'div[class*="newChatTrigger"]';

/**
 * The sidebar toggle while the sidebar is open, in whatever language the app is
 * running (see {@link COLLAPSE_SIDEBAR_LABELS}).
 *
 * The control lives in the titlebar (Titlebar/index.tsx), which renders it at
 * every viewport width; Layout.tsx adds a second button carrying the same
 * `common.chrome.collapseSidebar` name below the mobile breakpoint
 * (`window.innerWidth < 768`). Both collapse the sidebar, so either is a valid
 * target — but two can be on screen at once, which trips Playwright's strict
 * mode. Take `.first()` or pass a `scope`.
 */
export function collapseSidebarButton(scope = ''): string {
  return buttonByAnyLabel(COLLAPSE_SIDEBAR_LABELS, scope);
}

/**
 * The same toggle once the sidebar is collapsed. Only the titlebar renders this
 * state, so it is unambiguous at any width.
 */
export function expandSidebarButton(scope = ''): string {
  return buttonByAnyLabel(EXPAND_SIDEBAR_LABELS, scope);
}

// ── Agent pill bar ───────────────────────────────────────────────────────────

/** Match an agent logo by its alt text (e.g. "claude logo"). */
export function agentLogoByBackend(backend: string): string {
  return `img[alt="${backend} logo"]`;
}

/** Stable selector for all agent pills on guid page. */
export const AGENT_PILL = '[data-agent-pill="true"]';

/** Match currently selected agent pill. */
export const AGENT_PILL_SELECTED = `${AGENT_PILL}[data-agent-selected="true"]`;

/** Model selector button on the guid page. */
export const MODEL_SELECTOR_BTN = 'button.sendbox-model-btn.guid-config-btn';

// ── Channel list ─────────────────────────────────────────────────────────────

export const CHANNEL_IDS = ['telegram', 'lark', 'dingtalk', 'slack', 'discord'] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

/** Match a channel row by channel id. */
export function channelItemById(id: string): string {
  return `[data-channel-id="${id}"]`;
}

/** Match a channel switch by channel id. */
export function channelSwitchById(id: string): string {
  return `[data-channel-switch-for="${id}"]`;
}

/** Match WebUI page tabs by key (`webui` / `channels`). */
export function webuiTabByKey(key: 'webui' | 'channels'): string {
  return `[data-webui-tab="${key}"]`;
}

// ── Agent Settings ──────────────────────────────────────────────────────────

/**
 * "Add custom Agent" dropdown trigger, and its "Add manually" menu item.
 *
 * TalkToButlerButton forwards its `data-testid` to the Arco Button and derives
 * `${testId}-manual` for the manual Menu.Item, so neither needs a translated
 * label. Arco strips only `popup`/`triggerProps`/`selectable` from a Menu.Item,
 * so `data-*` reaches the DOM — two unit tests already select the `-manual` node
 * that way.
 */
export const BTN_ADD_CUSTOM_AGENT = '[data-testid="btn-add-custom-agent"]';
export const BTN_ADD_CUSTOM_AGENT_MANUAL = '[data-testid="btn-add-custom-agent-manual"]';

// ── Assistant Settings ──────────────────────────────────────────────────────

/** Assistant card by ID. */
export function assistantCardById(id: string): string {
  return `[data-testid="assistant-card-${id}"]`;
}

/** Assistant enabled switch by ID. */
export function assistantSwitchById(id: string): string {
  return `[data-testid="switch-enabled-${id}"]`;
}

/** Preset assistant pill by ID on guid page. */
export function presetPillById(id: string): string {
  return `[data-testid="preset-pill-${id}"]`;
}

/** Overflow assistant pill by ID on guid page. */
export function assistantOverflowPillById(id: string): string {
  return `[data-testid="assistant-overflow-${id}"]`;
}

/** Stable selector for all assistant pills on guid page. */
export const ASSISTANT_PILL = '[data-testid^="preset-pill-"], [data-testid^="assistant-overflow-"]';

/** Match currently selected assistant pill. */
export const ASSISTANT_PILL_SELECTED =
  '[data-testid^="preset-pill-"][data-assistant-selected="true"], [data-testid^="assistant-overflow-"][data-assistant-selected="true"]';

/** Assistant editor surface: full-page editor or legacy drawer wrapper. */
export const ASSISTANT_EDITOR_SURFACE = '[data-testid="assistant-editor-page"], [data-testid="assistant-edit-drawer"]';

/** Create assistant button. */
export const BTN_CREATE_ASSISTANT = '[data-testid="btn-create-assistant"]';

/** Save assistant button. */
export const BTN_SAVE_ASSISTANT = '[data-testid="btn-save-assistant"]';

/** Delete assistant button. */
export const BTN_DELETE_ASSISTANT = '[data-testid="btn-delete-assistant"]';

/** Skills section in the assistant editor. */
export const SKILLS_SECTION = '[data-testid="skills-section"]';

/** Skills indicator on conversation page. */
export const SKILLS_INDICATOR = '[data-testid="skills-indicator"]';

/** Skills indicator count. */
export const SKILLS_INDICATOR_COUNT = '[data-testid="skills-indicator-count"]';

/** Agent badge on conversation page. */
export const AGENT_BADGE = '[data-testid="agent-badge"]';

/** Search toggle button. */
export const BTN_SEARCH_ASSISTANT = '[data-testid="btn-search-toggle"]';

/** Search input field. */
export const INPUT_SEARCH_ASSISTANT = '[data-testid="input-search-assistant"]';

/** Match the duplicate button for an assistant. */
export function assistantDuplicateById(id: string): string {
  return `[data-testid="btn-duplicate-${id}"]`;
}

/** Match the edit button for an assistant. */
export function assistantEditById(id: string): string {
  return `[data-testid="btn-edit-${id}"]`;
}

/** Name input in the assistant editor. */
export const INPUT_ASSISTANT_NAME = '[data-testid="input-assistant-name"]';

/** Description input in the assistant editor. */
export const INPUT_ASSISTANT_DESC = '[data-testid="input-assistant-desc"]';

/** Main Agent select in the assistant editor. */
export const SELECT_ASSISTANT_AGENT = '[data-testid="select-assistant-agent"]';

/** Add Skills button in the assistant editor. */
export const BTN_ADD_SKILLS = '[data-testid="btn-add-skills"]';

/** Skills collapse container. */
export const SKILLS_COLLAPSE = '[data-testid="skills-collapse"]';

/** Confirm delete button inside modal. */
export const BTN_CONFIRM_DELETE = '.delete-assistant-modal .arco-btn-status-danger';
