/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const DEFAULT_JS_FILTER_SCRIPT = `function jsFilter(input) {
  const combined = [
    input.sessionId ?? '',
    input.workspace ?? '',
    JSON.stringify(input.model ?? null),
    JSON.stringify(input.lastMessage ?? null),
    JSON.stringify(input.conversationHistory ?? []),
  ].join('\\n');

  return {
    content: combined.slice(-1024),
    textLimit: -1,
  };
}`;

export const DEFAULT_CALLBACK_BODY = `{
  "sessionId": "{{sessionId}}",
  "workspace": "{{workspace}}",
  "model": {{model}},
  "lastMessage": {{lastMessage}},
  "conversationHistory": {{conversationHistory}},
  "jsFitterStr": "{{jsFitterStr}}"
}`;
