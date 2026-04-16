/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ACP_BACKENDS_ALL, ACP_ENABLED_BACKENDS } from '@/common/types/acpTypes';
import type { AcpModelInfo } from '@/common/types/acpTypes';
import { ConfigStorage } from '@/common/config/storage';
import AgentAvatar from '@/renderer/components/AgentAvatar';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import { useAgentUserConfig } from '@/renderer/hooks/agent/useAgentUserConfig';
import { useNavigateToAgent } from '@/renderer/hooks/agent/useNavigateToAgent';
import { useMcpServers } from '@/renderer/hooks/mcp';
import { getAgentModes } from '@/renderer/utils/model/agentModes';
import { useModelProviderList } from '@/renderer/hooks/agent/useModelProviderList';
import { useGeminiModelSelection } from '@/renderer/pages/conversation/platforms/gemini/useGeminiModelSelection';
import { useAionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';
import GeminiModelSelector from '@/renderer/pages/conversation/platforms/gemini/GeminiModelSelector';
import AionrsModelSelector from '@/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector';
import GeminiModalContent from '@/renderer/components/settings/SettingsModal/contents/GeminiModalContent';
import AgentDetailLayout from '@/renderer/components/agent/AgentDetailLayout';
import { AgentConfigSection as Section, AgentConfigRow as Row } from '@/renderer/components/agent/AgentConfigLayout';
import { ipcBridge } from '@/common';
import type { TProviderWithModel } from '@/common/config/storage';
import { Button, Checkbox, Message, Select, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

// ── Main page ────────────────────────────────────────────────────────────────

const REASONING_EFFORT_OPTIONS = ['minimal', 'low', 'medium', 'high'] as const;

const LocalAgentDetailPage: React.FC = () => {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const navigateToAgent = useNavigateToAgent();
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en-US';

  const backendConfig = key
    ? (ACP_ENABLED_BACKENDS[key] ??
      (ACP_BACKENDS_ALL as Record<string, (typeof ACP_BACKENDS_ALL)[keyof typeof ACP_BACKENDS_ALL]>)[key])
    : undefined;
  const { config, loading, save } = useAgentUserConfig(key ?? '');
  const { allMcpServers } = useMcpServers();
  const { providers: allProviders } = useModelProviderList();

  // Gemini: all providers; Aion CLI: exclude Google Auth (unsupported)
  const providers =
    key === 'aionrs'
      ? allProviders.filter((p) => !p.platform?.toLowerCase().includes('gemini-with-google-auth'))
      : allProviders;

  const [cachedModels, setCachedModels] = useState<AcpModelInfo | null>(null);
  // null = loading, undefined = not found, string = path
  const [detectedPath, setDetectedPath] = useState<string | null | undefined>(null);

  // Gemini-specific config (stored in gemini.config, not acp.config)
  const [geminiPreferredModel, setGeminiPreferredModel] = useState<string | undefined>();
  const [geminiPreferredMode, setGeminiPreferredMode] = useState<string | undefined>();

  // Load cached model list for non-Gemini backends
  useEffect(() => {
    if (!key || key === 'gemini') return;
    setCachedModels(null); // clear stale data from previous agent immediately
    void ConfigStorage.get('acp.cachedModels').then((all) => {
      setCachedModels(all && key in all ? (all[key] ?? null) : null);
    });
  }, [key]);

  // Load gemini.config for Gemini-specific preferences
  useEffect(() => {
    if (key !== 'gemini') return;
    void ConfigStorage.get('gemini.config').then((c) => {
      setGeminiPreferredModel(c?.preferredModelId);
      setGeminiPreferredMode(c?.preferredMode);
    });
  }, [key]);

  // Detect runtime status for this backend
  useEffect(() => {
    if (!key) return;
    setDetectedPath(null);
    void ipcBridge.acpConversation.getAvailableAgents.invoke().then((result) => {
      if (result.success) {
        const found = result.data.find((a) => a.backend === key);
        setDetectedPath(found ? (found.cliPath ?? '') : undefined);
      }
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

  type GeminiConfig = Parameters<typeof ConfigStorage.set<'gemini.config'>>[1];

  const handleSaveGeminiConfig = useCallback(
    async (patch: { preferredModelId?: string; preferredMode?: string }) => {
      try {
        const existing = ((await ConfigStorage.get('gemini.config')) ?? {}) as GeminiConfig;
        await ConfigStorage.set('gemini.config', { ...existing, ...patch } as GeminiConfig);
        if ('preferredModelId' in patch) {
          setGeminiPreferredModel(patch.preferredModelId);
          // Keep gemini.defaultModel in sync so the homepage model selector reflects this preference
          if (patch.preferredModelId) {
            const sepIdx = patch.preferredModelId.indexOf('::');
            if (sepIdx > 0) {
              const id = patch.preferredModelId.slice(0, sepIdx);
              const useModel = patch.preferredModelId.slice(sepIdx + 2);
              await ConfigStorage.set('gemini.defaultModel', { id, useModel }).catch(console.error);
            }
          }
        }
        if ('preferredMode' in patch) setGeminiPreferredMode(patch.preferredMode);
        Message.success(t('common.saveSuccess', { defaultValue: 'Saved successfully' }));
      } catch {
        Message.error(t('common.saveFailed', { defaultValue: 'Failed to save' }));
      }
    },
    [t]
  );

  const isGemini = key === 'gemini';
  const isAionrs = key === 'aionrs';
  const isCodex = key === 'codex';

  // Build initialModel for Gemini/Aionrs from stored preferredModelId string
  const geminiInitialModel = useMemo((): TProviderWithModel | undefined => {
    if (!isGemini || !geminiPreferredModel) return undefined;
    const [providerId, modelName] = geminiPreferredModel.split('::');
    const provider = allProviders.find((p) => p.id === providerId);
    return provider
      ? ({ ...(provider as unknown as TProviderWithModel), useModel: modelName } as TProviderWithModel)
      : undefined;
  }, [isGemini, geminiPreferredModel, allProviders]);

  const aionrsInitialModel = useMemo((): TProviderWithModel | undefined => {
    if (!isAionrs || !config.preferredModelId) return undefined;
    const [providerId, modelName] = config.preferredModelId.split('::');
    const provider = providers.find((p) => p.id === providerId);
    return provider
      ? ({ ...(provider as unknown as TProviderWithModel), useModel: modelName } as TProviderWithModel)
      : undefined;
  }, [isAionrs, config.preferredModelId, providers]);

  const geminiSelection = useGeminiModelSelection({
    initialModel: geminiInitialModel,
    onSelectModel: async (provider, modelName) => {
      try {
        await handleSaveGeminiConfig({ preferredModelId: `${provider.id}::${modelName}` });
        return true;
      } catch {
        return false;
      }
    },
  });

  const aionrsSelection = useAionrsModelSelection({
    initialModel: aionrsInitialModel,
    onSelectModel: async (provider, modelName) => {
      try {
        await save({ preferredModelId: `${provider.id}::${modelName}` });
        return true;
      } catch {
        return false;
      }
    },
  });

  if (!backendConfig) {
    return (
      <div className='size-full flex items-center justify-center text-t-secondary'>
        {t('common.notFound', { defaultValue: 'Not found' })}
      </div>
    );
  }

  const avatarSrc = resolveAgentLogo({ backend: key! }) ?? null;
  const modelOptions = cachedModels?.availableModels ?? [];

  return (
    <AgentDetailLayout>
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
        <Button type='primary' size='small' className='!rounded-[100px] shrink-0' onClick={() => navigateToAgent(key!)}>
          {t('common.agents.talkToAgent')}
        </Button>
      </div>

      {/* ── Gemini Auth — shown first for Gemini (built-in, auth is the primary config) ── */}
      {isGemini && (
        <Section title={t('common.agents.auth', { defaultValue: 'Authentication' })}>
          <div className='-mx-16px -my-4px'>
            <GeminiModalContent />
          </div>
        </Section>
      )}

      {/* ── Connection / Status — hidden for built-in agents (Gemini, Aion CLI) ── */}
      {!isGemini && !isAionrs && (
        <Section title={t('common.agents.connection', { defaultValue: 'Connection' })}>
          {/* Status */}
          <Row
            label={t('common.status', { defaultValue: 'Status' })}
            children={
              <Tag color={detectedPath === null ? 'gray' : detectedPath !== undefined ? 'green' : 'red'} size='small'>
                {detectedPath === null
                  ? '...'
                  : detectedPath !== undefined
                    ? t('settings.aionrs.available', { defaultValue: 'Available' })
                    : t('settings.aionrs.notFound', { defaultValue: 'Not Found' })}
              </Tag>
            }
          />
          {/* CLI Command (static config) */}
          {backendConfig.cliCommand && (
            <Row
              label={t('settings.agentManagement.cliCommand', { defaultValue: 'CLI Command' })}
              mono
              children={backendConfig.cliCommand}
            />
          )}
          {/* Detected path — only show when it's a full absolute path (contains '/'), not just the command name */}
          {detectedPath && detectedPath.includes('/') && (
            <Row label={t('settings.aionrs.path', { defaultValue: 'Path' })} mono children={detectedPath} />
          )}
          {/* Default CLI path (fallback invocation, e.g. npx package) */}
          {backendConfig.defaultCliPath && (
            <Row
              label={t('settings.agentManagement.defaultPath', { defaultValue: 'Default Path' })}
              mono
              children={backendConfig.defaultCliPath}
            />
          )}
          {/* Aion CLI: LLM provider is configured in Models page */}
          {key === 'aionrs' && (
            <Row
              label={t('common.agents.llmProvider', { defaultValue: 'LLM Provider' })}
              hint={t('settings.aionrs.providerNote', {
                defaultValue: 'Provider and API key settings are managed in the Models page.',
              })}
              children={
                <Button size='mini' onClick={() => void navigate('/settings/models')}>
                  {t('common.goToSettings', { defaultValue: 'Go to Settings' })}
                </Button>
              }
            />
          )}
        </Section>
      )}

      {/* ── Default Model ── */}
      {isGemini || isAionrs ? (
        // Gemini + Aion CLI: use live provider list from LLM config
        <Section title={t('common.defaultModel', { defaultValue: 'Default Model' })}>
          <Row
            label={t('common.defaultModel', { defaultValue: 'Default Model' })}
            hint={t('common.agents.defaultModelHint', {
              defaultValue: 'Applied when starting new conversations with this agent.',
            })}
            children={
              isGemini ? (
                <GeminiModelSelector selection={geminiSelection} variant='settings' />
              ) : (
                <AionrsModelSelector selection={aionrsSelection} variant='settings' />
              )
            }
          />
        </Section>
      ) : (
        // Other ACP agents: use cached model list populated after first conversation
        !loading && (
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
        )
      )}

      {/* ── Permissions ── */}
      <Section title={t('common.agents.permissions', { defaultValue: 'Permissions' })}>
        <Row
          label={t('common.agents.defaultPermission', { defaultValue: 'Default Permission Mode' })}
          hint={t('common.agents.defaultPermissionHint', {
            defaultValue: 'Default permission mode applied when starting new conversations.',
          })}
          children={
            getAgentModes(key!).length > 0 ? (
              <Select
                size='small'
                style={{ width: 180 }}
                value={isGemini ? (geminiPreferredMode ?? '') : (config.preferredMode ?? '')}
                placeholder={t('common.default', { defaultValue: 'Default' })}
                allowClear
                onChange={(v: string) => {
                  if (isGemini) {
                    void handleSaveGeminiConfig({ preferredMode: v || undefined });
                  } else {
                    void handleSave({ preferredMode: v || undefined });
                  }
                }}
              >
                {getAgentModes(key!).map((m) => (
                  <Select.Option key={m.value} value={m.value}>
                    {t(`agentMode.${m.value}`, { defaultValue: m.label })}
                  </Select.Option>
                ))}
              </Select>
            ) : (
              <span className='text-13px text-t-secondary'>{t('agentMode.default', { defaultValue: 'Default' })}</span>
            )
          }
        />
      </Section>

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
    </AgentDetailLayout>
  );
};

export default LocalAgentDetailPage;
