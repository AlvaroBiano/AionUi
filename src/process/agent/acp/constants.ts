/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Session mode constants for different ACP backends
// These are used with session/set_mode to enable YOLO (auto-approve) mode

/** Claude Code: bypass all permission checks */
export const CLAUDE_YOLO_SESSION_MODE = 'bypassPermissions' as const;

/** Qwen Code: auto-approve all operations */
export const QWEN_YOLO_SESSION_MODE = 'yolo' as const;

/** iFlow CLI: auto-approve all operations (verified via ACP test) */
export const IFLOW_YOLO_SESSION_MODE = 'yolo' as const;

/** CodeBuddy: bypass all permission checks (same as Claude's mode name) */
export const CODEBUDDY_YOLO_SESSION_MODE = 'bypassPermissions' as const;

/** Goose: environment variable for auto mode (set before process spawn) */
export const GOOSE_YOLO_ENV_VAR = 'GOOSE_MODE' as const;
export const GOOSE_YOLO_ENV_VALUE = 'auto' as const;

/**
 * OpenCode: AionUi integrates with the TypeScript version (anomalyco/opencode)
 * which has full ACP protocol support via `opencode acp` command.
 *
 * Note: There are two OpenCode projects:
 * - TypeScript version: https://github.com/anomalyco/opencode (actively maintained, recommended)
 * - Go version: https://github.com/opencode-ai/opencode (archived, migrated to Crush by Charm team)
 *
 * Both versions support `opencode acp` command, so the integration is compatible with either.
 * Currently, OpenCode does not support --yolo flag for auto-approve mode.
 *
 * @see https://github.com/iOfficeAI/AionUi/issues/788
 */

// --- YOLO mode fallback map (hardcoded, used when configOptions unavailable) ---

import type { AcpSessionConfigOption } from '@/common/types/acpTypes';

/** Hardcoded YOLO mode values per backend, used as fallback when configOptions is unavailable. */
export const YOLO_MODE_FALLBACK: Record<string, string> = {
  claude: CLAUDE_YOLO_SESSION_MODE,
  codebuddy: CODEBUDDY_YOLO_SESSION_MODE,
  qwen: QWEN_YOLO_SESSION_MODE,
  iflow: IFLOW_YOLO_SESSION_MODE,
};

/** Mode values recognized as YOLO / auto-approve behavior. */
const YOLO_MODE_VALUES = new Set(['bypassPermissions', 'yolo']);

/**
 * Detect the YOLO (auto-approve) session mode for a backend.
 * Prefers dynamic detection from configOptions; falls back to YOLO_MODE_FALLBACK.
 *
 * Strategy:
 * 1. If configOptions has a mode-category option, look for an option whose value is in YOLO_MODE_VALUES.
 * 2. Otherwise fall back to the hardcoded YOLO_MODE_FALLBACK map.
 *
 * @returns The YOLO mode value string, or undefined if the backend doesn't support YOLO.
 */
export function resolveYoloMode(backend: string, configOptions?: AcpSessionConfigOption[] | null): string | undefined {
  if (configOptions && configOptions.length > 0) {
    const modeOption = configOptions.find((opt) => opt.category === 'mode' && opt.type === 'select');
    if (modeOption?.options) {
      const yoloOpt = modeOption.options.find((opt) => YOLO_MODE_VALUES.has(opt.value));
      if (yoloOpt) return yoloOpt.value;
    }
  }
  return YOLO_MODE_FALLBACK[backend];
}
