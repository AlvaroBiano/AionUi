/**
 * Reusable selectors for E2E tests.
 *
 * Because the app currently has **no** `data-testid` attributes, we rely on
 * CSS class names, Arco-Design component classes, and text-content matching.
 *
 * When the app adds `data-testid` later, update these selectors in one place.
 */

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

// ── Conversation page ───────────────────────────────────────────────────────

/** Agent status message badge (connecting / session_active / error). */
export const AGENT_STATUS_MESSAGE = '.agent-status-message';

// ── Sidebar ─────────────────────────────────────────────────────────────────

/** New chat trigger button in sidebar. */
export const NEW_CHAT_TRIGGER = 'div.newChatTrigger';

// ── Agent pill bar ───────────────────────────────────────────────────────────

/** Match an agent logo by its alt text (e.g. "claude logo"). */
export function agentLogoByBackend(backend: string): string {
  return `img[alt="${backend} logo"]`;
}

/** Stable selector for all agent pills on guid page. */
export const AGENT_PILL = '[data-agent-pill="true"]';

/** Match an agent pill by backend (claude/gemini/...). */
export function agentPillByBackend(backend: string): string {
  return `${AGENT_PILL}[data-agent-backend="${backend}"]`;
}

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

// ── Chat layout (digital-human-redesign) ─────────────────────────────────────

/**
 * Sidebar DM contact row (AgentContactRow → SiderRow level={2}).
 * Level-2 SiderRows have the unique UnoCSS class `pl-48px` for their left-indent.
 * Used by goToFirstConversation to navigate to an existing conversation.
 */
export const SIDER_CONTACT_ROW = 'div[class*="pl-48px"][class*="cursor-pointer"]';

/** Chat layout header bar. */
export const CHAT_LAYOUT_HEADER = '.chat-layout-header';

/** Conversation history panel button (clock icon, top-right of chat header). */
export const HISTORY_PANEL_BTN = `${CHAT_LAYOUT_HEADER} button[title]`;

/** Arco Design dropdown popup menu (rendered in portal). */
export const ARCO_DROPDOWN_MENU = '.arco-dropdown-menu';
export const ARCO_DROPDOWN_MENU_ITEM = '.arco-dropdown-menu-item';

/** Conversation history panel dropdown (uses custom droplist, not Arco Menu). */
export const HISTORY_PANEL_DROPDOWN = '[data-history-dropdown="true"]';

/** Message item in the Virtuoso list. */
export const MESSAGE_ITEM = '.message-item';

/** Message avatar + name header row (shown on first message in a sequence). */
export const MESSAGE_AUTHOR_HEADER = `${MESSAGE_ITEM} .flex.items-center.gap-6px:has(span.text-14px.font-medium)`;

/** Time divider label between messages. */
export const TIME_DIVIDER = `${MESSAGE_ITEM} .text-t-tertiary.select-none, .text-13px.text-t-tertiary.select-none`;

/** Thinking message container. */
export const THINKING_MESSAGE = `${MESSAGE_ITEM}.thinking`;

/** Thinking message expand/collapse header. */
export const THINKING_HEADER = `${THINKING_MESSAGE} [class*="header"]`;

/** Thinking message body text (collapsible). */
export const THINKING_BODY = `${THINKING_MESSAGE} [class*="body"]`;
