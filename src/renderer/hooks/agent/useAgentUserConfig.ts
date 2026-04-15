/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigStorage } from '@/common/config/storage';
import type { AcpBackend } from '@/common/types/acpTypes';
import { useCallback, useEffect, useState } from 'react';

export type AgentUserConfig = {
  /** Preferred model ID for new conversations */
  preferredModelId?: string;
  /** CLI binary path override */
  cliPath?: string;
  /** Auto-approve all tool calls (yolo mode) */
  yoloMode?: boolean;
  /** Preferred session mode */
  preferredMode?: string;
  /** Default reasoning effort (Codex only) */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  /** Default skill IDs to enable for new conversations */
  defaultSkills?: string[];
  /** Default MCP server IDs to enable for new conversations */
  defaultMcpServers?: string[];
};

/**
 * Reads and writes the per-agent user configuration stored in `acp.config[backend]`.
 */
export const useAgentUserConfig = (backend: string) => {
  const [config, setConfig] = useState<AgentUserConfig>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = (await ConfigStorage.get('acp.config')) ?? ({} as Record<string, AgentUserConfig>);
      const entry = (all as Record<string, AgentUserConfig>)[backend] ?? {};
      setConfig(entry);
    } finally {
      setLoading(false);
    }
  }, [backend]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (patch: Partial<AgentUserConfig>) => {
      const all = ((await ConfigStorage.get('acp.config')) ?? {}) as Record<string, AgentUserConfig>;
      const updated = { ...all, [backend]: { ...(all[backend] ?? {}), ...patch } };
      await ConfigStorage.set('acp.config', updated as Parameters<typeof ConfigStorage.set<'acp.config'>>[1]);
      setConfig((prev) => ({ ...prev, ...patch }));
    },
    [backend]
  );

  return { config, loading, save, reload: load };
};
