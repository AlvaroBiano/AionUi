/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ACP_ENABLED_BACKENDS } from '@/common/types/acpTypes';
import type { AcpModelInfo } from '@/common/types/acpTypes';
import { ConfigStorage } from '@/common/config/storage';
import AgentAvatar from '@/renderer/components/AgentAvatar';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import { useAgentUserConfig } from '@/renderer/hooks/agent/useAgentUserConfig';
import { useMcpServers } from '@/renderer/hooks/mcp';
import { getAgentModes } from '@/renderer/utils/model/agentModes';
import GeminiModalContent from '@/renderer/components/settings/SettingsModal/contents/GeminiModalContent';
import { ipcBridge } from '@/common';
import { Button, Checkbox, Message, Select, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

// ── Section wrapper ──────────────────────────────────────────────────────────

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className='mb-20px'>
    <h3 className='text-13px font-semibold text-t-secondary uppercase tracking-wider mb-8px px-4px'>{title}</h3>
    <div className='bg-fill-2 rd-12px px-16px py-4px'>{children}</div>
  </div>
);

const Row: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
  mono?: boolean;
}> = ({ label, hint, children, mono }) => (
  <div className='flex items-center justify-between gap-16px py-12px border-b border-border-2 last:border-b-0'>
    <div className='flex flex-col gap-2px min-w-0'>
      <span className={`text-14px text-t-primary${mono ? ' font-mono' : ''}`}>{label}</span>
      {hint && <span className='text-12px text-t-secondary'>{hint}</span>}
    </div>
    <div className='shrink-0'>{children}</div>
  </div>
);

// ── Runtime status (Aion CLI only) ───────────────────────────────────────────

type AionrsInfo = { available: boolean; version?: string; path?: string };

const AionrsRuntimeSection: React.FC<{ t: ReturnType<typeof useTranslation>['t'] }> = ({ t }) => {
  const [info, setInfo] = useState<AionrsInfo | null>(null);

  useEffect(() => {
    void ipcBridge.acpConversation.getAvailableAgents.invoke().then((result) => {
      if (result.success) {
        const agent = result.data.find((a) => a.backend === 'aionrs');
        setInfo(agent ? { available: true, path: agent.cliPath } : { available: false });
      }
    });
  }, []);

  return (
    <Section title={t('common.status', { defaultValue: 'Status' })}>
      <Row
        label={t('common.status', { defaultValue: 'Status' })}
        children={
          <Tag color={info?.available ? 'green' : info === null ? 'gray' : 'red'} size='small'>
            {info === null
              ? '...'
              : info.available
                ? t('settings.aionrs.available', { defaultValue: 'Available' })
                : t('settings.aionrs.notFound', { defaultValue: 'Not Found' })}
          </Tag>
        }
      />
      {info?.path && <Row label={t('settings.aionrs.path', { defaultValue: 'Path' })} mono children={info.path} />}
    </Section>
  );
};

// ── Main page ────────────────────────────────────────────────────────────────

const REASONING_EFFORT_OPTIONS = ['minimal', 'low', 'medium', 'high'] as const;

const LocalAgentDetailPage: React.FC = () => {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en-US';

  const backendConfig = key ? ACP_ENABLED_BACKENDS[key] : undefined;
  const { config, loading, save } = useAgentUserConfig(key ?? '');
  const { allMcpServers } = useMcpServers();

  const [cachedModels, setCachedModels] = useState<AcpModelInfo | null>(null);

  // Load cached model list for this backend
  useEffect(() => {
    if (!key) return;
    void ConfigStorage.get('acp.cachedModels').then((all) => {
      if (all && key in all) setCachedModels(all[key] ?? null);
    });
  }, [key]);

  const handleSave = useCallback(
    async (patch: Parameters<typeof save>[0]) => {
      try {
        await save(patch);
        Message.success(t('common.saveSuccess', { defaultValue: 'Saved successfully' }));
      } catch {
        Message.error(t('common.saveFailed', { defaultValue: 'Failed to save' }));
      }
    },
    [save, t]
  );

  if (!backendConfig) {
    return (
      <div className='size-full flex items-center justify-center text-t-secondary'>
        {t('common.notFound', { defaultValue: 'Not found' })}
      </div>
    );
  }

  const isAionrs = key === 'aionrs';
  const isGemini = key === 'gemini';
  const isCodex = key === 'codex';

  const avatarSrc = resolveAgentLogo({ backend: key! }) ?? null;
  const modelOptions = cachedModels?.availableModels ?? [];

  return (
    <div className='size-full overflow-y-auto'>
      <div className='px-12px md:px-40px py-32px mx-auto w-full md:max-w-800px'>
        {/* ── Header ── */}
        <div className='flex items-start gap-16px mb-32px'>
          <AgentAvatar
            size={56}
            avatarSrc={avatarSrc}
            avatarBgColor={(backendConfig as { avatarBgColor?: string }).avatarBgColor}
            className='shrink-0'
          />
          <div className='flex-1 min-w-0'>
            <span className='text-18px font-semibold text-t-primary'>
              {backendConfig.nameI18n?.[locale] ?? backendConfig.name}
            </span>
            {backendConfig.description && (
              <p className='text-13px text-t-secondary mt-4px'>
                {backendConfig.descriptionI18n?.[locale] ?? backendConfig.description}
              </p>
            )}
          </div>
        </div>

        {/* ── Runtime status (Aion CLI only) ── */}
        {isAionrs && <AionrsRuntimeSection t={t} />}

        {/* ── Connection info ── */}
        {(backendConfig.cliCommand ?? backendConfig.defaultCliPath) && (
          <Section title={t('settings.agentManagement.cliCommand', { defaultValue: 'Connection' })}>
            {backendConfig.cliCommand && (
              <Row
                label={t('settings.agentManagement.cliCommand', { defaultValue: 'CLI Command' })}
                mono
                children={backendConfig.cliCommand}
              />
            )}
            {backendConfig.defaultCliPath && (
              <Row
                label={t('settings.agentManagement.defaultPath', { defaultValue: 'Default Path' })}
                mono
                children={backendConfig.defaultCliPath}
              />
            )}
          </Section>
        )}

        {/* ── Default Model ── */}
        {!loading && (
          <Section title={t('common.defaultModel', { defaultValue: 'Default Model' })}>
            {modelOptions.length > 0 ? (
              <Row
                label={t('common.defaultModel', { defaultValue: 'Default Model' })}
                hint={t('common.agents.defaultModelHint', {
                  defaultValue: 'Applied when starting new conversations with this agent.',
                })}
                children={
                  <Select
                    size='small'
                    style={{ width: 200 }}
                    value={config.preferredModelId ?? ''}
                    placeholder={t('common.default', { defaultValue: 'Default' })}
                    allowClear
                    onChange={(v: string) => void handleSave({ preferredModelId: v || undefined })}
                  >
                    {modelOptions.map((m) => (
                      <Select.Option key={m.id} value={m.id}>
                        {m.label}
                      </Select.Option>
                    ))}
                  </Select>
                }
              />
            ) : (
              <Row
                label={t('common.defaultModel', { defaultValue: 'Default Model' })}
                hint={t('common.agents.noModelCache', {
                  defaultValue: 'Start a conversation to populate the model list.',
                })}
                children={<span className='text-12px text-t-secondary'>—</span>}
              />
            )}
          </Section>
        )}

        {/* ── Permissions ── */}
        {getAgentModes(key!).length > 0 && (
          <Section title={t('common.agents.permissions', { defaultValue: 'Permissions' })}>
            <Row
              label={t('common.agents.defaultPermission', { defaultValue: 'Default Permission Mode' })}
              hint={t('common.agents.defaultPermissionHint', {
                defaultValue: 'Default permission mode applied when starting new conversations.',
              })}
              children={
                <Select
                  size='small'
                  style={{ width: 180 }}
                  value={config.preferredMode ?? ''}
                  placeholder={t('common.default', { defaultValue: 'Default' })}
                  allowClear
                  onChange={(v: string) => void handleSave({ preferredMode: v || undefined })}
                >
                  {getAgentModes(key!).map((m) => (
                    <Select.Option key={m.value} value={m.value}>
                      {m.label}
                    </Select.Option>
                  ))}
                </Select>
              }
            />
          </Section>
        )}

        {/* ── Thinking Depth (Codex only) ── */}
        {isCodex && (
          <Section title={t('acp.config.reasoning_effort', { defaultValue: 'Thinking Depth' })}>
            <Row
              label={t('acp.config.reasoning_effort', { defaultValue: 'Reasoning Effort' })}
              hint={t('common.agents.reasoningEffortHint', {
                defaultValue: 'Default reasoning effort for new conversations.',
              })}
              children={
                <Select
                  size='small'
                  style={{ width: 160 }}
                  value={config.reasoningEffort ?? 'medium'}
                  onChange={(v: string) => void handleSave({ reasoningEffort: v as typeof config.reasoningEffort })}
                >
                  {REASONING_EFFORT_OPTIONS.map((opt) => (
                    <Select.Option key={opt} value={opt}>
                      {opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </Select.Option>
                  ))}
                </Select>
              }
            />
          </Section>
        )}

        {/* ── Default MCP Servers ── */}
        {allMcpServers.length > 0 && (
          <Section title={t('common.agents.defaultMcp', { defaultValue: 'Default MCP Servers' })}>
            {allMcpServers.map((server) => {
              const enabled = config.defaultMcpServers?.includes(server.id) ?? false;
              return (
                <Row
                  key={server.id}
                  label={server.name}
                  hint={server.description}
                  children={
                    <Checkbox
                      checked={enabled}
                      onChange={(v) => {
                        const current = config.defaultMcpServers ?? [];
                        const next = v ? [...current, server.id] : current.filter((id) => id !== server.id);
                        void handleSave({ defaultMcpServers: next.length ? next : undefined });
                      }}
                    />
                  }
                />
              );
            })}
          </Section>
        )}

        {/* ── Gemini Auth (Gemini only) ── */}
        {isGemini && (
          <Section title={t('common.agents.auth', { defaultValue: 'Authentication' })}>
            <div className='-mx-16px -my-4px'>
              <GeminiModalContent />
            </div>
          </Section>
        )}

        {/* ── Backend info ── */}
        <Section title={t('settings.agentManagement.backendKey', { defaultValue: 'Backend Info' })}>
          <Row label={t('settings.agentManagement.backendKey', { defaultValue: 'Backend ID' })} mono children={key} />
          {backendConfig.presetAgentType && (
            <Row
              label={t('settings.agentManagement.agentType', { defaultValue: 'Agent Type' })}
              children={backendConfig.presetAgentType}
            />
          )}
        </Section>
      </div>
    </div>
  );
};

export default LocalAgentDetailPage;
