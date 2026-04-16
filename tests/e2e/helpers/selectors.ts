/**
 * Reusable selectors for E2E tests.
 *
 * Prefer `data-testid` attributes where available; fall back to stable CSS
 * class names or Arco-Design component classes.
 *
 * Keep every selector in this one file so test specs stay DRY and updates
 * only need to happen here.
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
export const ARCO_MODAL = '.arco-modal';
export const ARCO_MODAL_CONFIRM = '.arco-modal-confirm';
export const ARCO_SELECT_DROPDOWN = '.arco-select-dropdown';
export const ARCO_SELECT_OPTION = '.arco-select-option';

// ── Guid page ───────────────────────────────────────────────────────────────

/** Guid page chat input textarea. */
export const GUID_INPUT = '.guid-input-card-shell textarea';

// ── Conversation page ───────────────────────────────────────────────────────

/** Agent status message badge (connecting / session_active / error). */
export const AGENT_STATUS_MESSAGE = '.agent-status-message';

// ── Sidebar ─────────────────────────────────────────────────────────────────

/** New chat trigger button in sidebar. */
export const NEW_CHAT_TRIGGER = 'div.newChatTrigger';

/** Sidebar tab: Messages (chat icon). */
export const SIDER_TAB_MESSAGES = '[data-testid="sider-tab-messages"]';

/** Sidebar tab: Agents (people icon). */
export const SIDER_TAB_AGENTS = '[data-testid="sider-tab-agents"]';

// ── Sidebar – Agent sections ──────────────────────────────────────────────────

/** All collapsible agent section headers in the agents tab. */
export const AGENT_SECTION_HEADER = '[data-agent-section]';

/** Collapsible section header by section key ('local' | 'remote' | 'assistants' | 'people'). */
export function agentSectionHeader(section: 'local' | 'remote' | 'assistants' | 'people'): string {
  return `[data-agent-section="${section}"]`;
}

/** + button inside an agent section header (create new agent / assistant). */
export const AGENT_SECTION_ADD_BTN = `${AGENT_SECTION_HEADER} .h-20px.w-20px`;

// ── Sidebar – Conversation history ───────────────────────────────────────────

/** Individual conversation row in the grouped history list. */
export const CONVERSATION_ITEM = '.conversation-item';

/**
 * 3-dot menu container inside a conversation row.
 * Becomes flex on parent hover (group-hover:flex).
 */
export const CONVERSATION_ITEM_MENU_WRAP = `${CONVERSATION_ITEM} .absolute.right-0px.top-0px`;

// ── Conversation search ───────────────────────────────────────────────────────

/** Full-width search trigger button in the sidebar. */
export const CONVERSATION_SEARCH_TRIGGER = '.conversation-search-trigger-full';

/** Search overlay modal panel. */
export const CONVERSATION_SEARCH_MODAL = '.conversation-search-modal';

/** Search input inside the modal. */
export const CONVERSATION_SEARCH_INPUT = '.conversation-search-modal__search-input';

/** Individual search result item. */
export const CONVERSATION_SEARCH_RESULT = '.conversation-search-modal__result';

// ── Agent pill bar (guid page) ───────────────────────────────────────────────

/** Match an agent logo by its alt text (e.g. "claude logo"). */
export function agentLogoByBackend(backend: string): string {
  return `img[alt="${backend} logo"]`;
}

/**
 * Guid page agent selector trigger — the name + chevron row that opens the agent dropdown.
 * Click to open the agent selection panel.
 */
export const AGENT_PILL = '[data-testid="guid-agent-selector"]';

/** @deprecated Use AGENT_PILL directly — agent pills are not rendered as individual items */
export function agentPillByBackend(_backend: string): string {
  return AGENT_PILL;
}

/** @deprecated Use AGENT_PILL directly */
export const AGENT_PILL_SELECTED = AGENT_PILL;

/**
 * Model selector button — exists in conversation sendbox (not on guid page).
 * On the guid page the model is selected inside the agent selector dropdown.
 */
export const MODEL_SELECTOR_BTN = 'button.sendbox-model-btn';

// ── SendBox ───────────────────────────────────────────────────────────────────

/** Main sendbox container panel. */
export const SENDBOX_PANEL = '.sendbox-panel';

/** Send (arrow-up) button. Disabled when input is empty. */
export const SENDBOX_SEND_BTN = '.send-button-custom';

/** Stop (square) button — visible only while the agent is processing. */
export const SENDBOX_STOP_BTN = '.sendbox-stop-button';

/** Tools strip inside the sendbox (contains model selector, gear, etc.). */
export const SENDBOX_TOOLS = '.sendbox-tools';

/** Gear / settings button that opens the sendbox settings popup. */
export const SENDBOX_SETTINGS_BTN = '[data-testid="sendbox-settings-btn"]';

/**
 * Settings popup opened by the gear button.
 * Positioned absolute bottom-full — used to verify it isn't clipped by overflow.
 */
export const SENDBOX_SETTINGS_POPUP = '[data-testid="sendbox-settings-popup"]';

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

// ── Chat layout ───────────────────────────────────────────────────────────────

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

// ── Workspace panel ───────────────────────────────────────────────────────────

/** Right-side workspace panel in the chat layout. */
export const WORKSPACE_RIGHT_PANEL = '.chat-layout-right-sider';

/** Toggle button to show/hide the workspace panel (Windows only). */
export const WORKSPACE_HEADER_TOGGLE = '.workspace-header__toggle';

/** Workspace collapse/expand component inside the workspace panel. */
export const WORKSPACE_COLLAPSE = '.workspace-collapse';

// ── Messages ─────────────────────────────────────────────────────────────────

/** Message item in the Virtuoso list. */
export const MESSAGE_ITEM = '.message-item';

/** Message avatar + name header row (shown on first message in a sequence). */
export const MESSAGE_AUTHOR_HEADER = `${MESSAGE_ITEM} .flex.items-center.gap-6px:has(span.text-14px.font-medium)`;

/** Avatar image inside a message author header. */
export const MESSAGE_AVATAR_IMG = `${MESSAGE_ITEM} .w-24px.h-24px img`;

/** Time divider label between messages. */
export const TIME_DIVIDER = `${MESSAGE_ITEM} .text-t-tertiary.select-none, .text-13px.text-t-tertiary.select-none`;

/** Thinking message container. */
export const THINKING_MESSAGE = `${MESSAGE_ITEM}.thinking`;

/** Thinking message expand/collapse header. */
export const THINKING_HEADER = `${THINKING_MESSAGE} [class*="header"]`;

/** Thinking message body text (collapsible). */
export const THINKING_BODY = `${THINKING_MESSAGE} [class*="body"]`;

// ── Assistants page ───────────────────────────────────────────────────────────

/** Agent card on the /assistants page. */
export const AGENT_CARD = '.rounded-12px.border-border-1';

/** "Chat" primary button on an agent card. */
export const AGENT_CARD_CHAT_BTN = '[data-testid="agent-chat-btn"]';

/** "Edit" secondary button on an agent card (only for editable agents). */
export const AGENT_CARD_EDIT_BTN = '[data-testid="agent-edit-btn"]';

// ── Agent detail pages ────────────────────────────────────────────────────────

/** Local agent detail page model selector (size=small, width=200). */
export const LOCAL_AGENT_MODEL_SELECT = '.arco-select';

/** Remote agent edit form name input. */
export const REMOTE_AGENT_NAME_INPUT = 'input[placeholder]';

/** Remote agent URL input (placeholder 'https://'). */
export const REMOTE_AGENT_URL_INPUT = 'input[placeholder="https://"]';

/** Assistant detail page name input. */
export const ASSISTANT_NAME_INPUT = 'input[placeholder]';

/** Assistant detail page system prompt textarea. */
export const ASSISTANT_SYSTEM_PROMPT = 'textarea[class*="resize-none"]';
