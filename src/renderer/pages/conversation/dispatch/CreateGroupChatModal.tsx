/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/config/storage';
import { ACP_BACKENDS_ALL } from '@/common/types/acpTypes';
import type { AcpBackendConfig } from '@/common/types/acpTypes';
import { Button, Input, Message, Modal, Select, Tooltip } from '@arco-design/web-react';
import { FolderOpen } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { emitter } from '@/renderer/utils/emitter';
import { iconColors } from '@/renderer/styles/colors';

import type { GroupChatCreationModalProps } from './types';

const CreateGroupChatModal: React.FC<GroupChatCreationModalProps> = ({ visible, onClose, onCreated }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [loading, setLoading] = useState(false);
  const [leaderAgentId, setLeaderAgentId] = useState<string | undefined>();

  // G4.2: Team config selector
  const [teamConfigs, setTeamConfigs] = useState<Array<{ name: string }>>([]);
  const [teamConfigName, setTeamConfigName] = useState<string | undefined>();

  // CLI agents (通用 Agent: Gemini, Claude Code, etc.)
  const cliAgents = useMemo(() => {
    const agents: Array<{ id: string; name: string }> = [];
    // Add Gemini as first CLI agent
    agents.push({ id: 'gemini', name: 'Gemini' });
    // Add other enabled CLI backends
    for (const [key, config] of Object.entries(ACP_BACKENDS_ALL)) {
      if (config.enabled) {
        agents.push({ id: key, name: config.name });
      }
    }
    return agents;
  }, []);

  // Admin Agent list (custom assistants)
  const [customAgents, setCustomAgents] = useState<AcpBackendConfig[]>([]);
  useEffect(() => {
    void ConfigStorage.get('acp.customAgents')
      .then((agents) => {
        setCustomAgents((agents || []).filter((a) => a.enabled !== false));
      })
      .catch(() => setCustomAgents([]));
  }, []);

  // G4.2: Fetch team configs when workspace changes
  useEffect(() => {
    if (!workspace) {
      setTeamConfigs([]);
      setTeamConfigName(undefined);
      return;
    }
    void ipcBridge.dispatch.listTeamConfigs
      .invoke({ workspace })
      .then((result) => {
        if (result.success && result.data) {
          setTeamConfigs(result.data.configs);
        } else {
          setTeamConfigs([]);
        }
      })
      .catch(() => setTeamConfigs([]));
  }, [workspace]);

  const handleBrowseWorkspace = useCallback(async () => {
    try {
      const files = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory'] });
      const selected = files?.[0];
      if (selected) {
        setWorkspace(selected);
      }
    } catch (err) {
      console.error('[CreateGroupChatModal] directory picker error:', err);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    if (!leaderAgentId) return;
    setLoading(true);
    try {
      const response = await ipcBridge.dispatch.createGroupChat.invoke({
        name: name.trim() || undefined,
        workspace: workspace || undefined,
        leaderAgentId,
        teamConfigName,
      });
      if (response.success && response.data?.conversationId) {
        const conversationId = response.data.conversationId;
        emitter.emit('chat.history.refresh');
        Promise.resolve(navigate(`/conversation/${conversationId}`)).catch((error) => {
          console.error('Navigation failed:', error);
        });
        onCreated(conversationId);
        setName('');
        setWorkspace('');
        setLeaderAgentId(undefined);
        setTeamConfigName(undefined);
      } else {
        Message.error(response.msg || t('dispatch.create.error'));
      }
    } catch (err) {
      console.error('[CreateGroupChatModal] invoke error:', err);
      Message.error(t('dispatch.create.error'));
    } finally {
      setLoading(false);
    }
  }, [name, workspace, leaderAgentId, teamConfigName, navigate, onCreated, t]);

  const handleCancel = useCallback(() => {
    setName('');
    setWorkspace('');
    setLeaderAgentId(undefined);
    setTeamConfigName(undefined);
    onClose();
  }, [onClose]);

  return (
    <Modal
      title={t('dispatch.create.title')}
      visible={visible}
      onOk={() => {
        void handleCreate();
      }}
      onCancel={handleCancel}
      okText={t('dispatch.create.confirm')}
      cancelText={t('common.cancel')}
      confirmLoading={loading}
      okButtonProps={{ disabled: !leaderAgentId }}
      style={{ borderRadius: '12px' }}
      alignCenter
      getPopupContainer={() => document.body}
    >
      {/* Name */}
      <div className='py-8px'>
        <div className='text-14px mb-8px text-t-secondary'>{t('dispatch.create.titleLabel')}</div>
        <Input
          autoFocus
          value={name}
          onChange={setName}
          onPressEnter={() => {
            void handleCreate();
          }}
          placeholder={t('dispatch.create.titlePlaceholder')}
          allowClear
        />
      </div>

      {/* Admin Agent Selector (required) */}
      <div className='py-8px'>
        <div className='text-14px mb-8px text-t-secondary'>{t('dispatch.create.adminLabel')}</div>
        <Select
          value={leaderAgentId}
          onChange={setLeaderAgentId}
          placeholder={t('dispatch.create.adminPlaceholder')}
          showSearch
        >
          {/* CLI agents (通用 Agent) */}
          {cliAgents.map((agent) => (
            <Select.Option key={agent.id} value={agent.id}>
              <span className='flex items-center gap-6px'>
                <span>{agent.name}</span>
                <span className='text-12px text-t-secondary'>CLI</span>
              </span>
            </Select.Option>
          ))}
          {/* Custom assistants (助手) */}
          {customAgents.map((agent) => (
            <Select.Option key={agent.id} value={agent.id}>
              <span className='flex items-center gap-6px'>
                {agent.avatar && <span className='text-16px leading-none'>{agent.avatar}</span>}
                <span>{agent.name}</span>
              </span>
            </Select.Option>
          ))}
        </Select>
      </div>

      {/* Workspace */}
      <div className='py-8px'>
        <div className='text-14px mb-8px text-t-secondary'>{t('dispatch.create.workspaceLabel')}</div>
        <div className='flex items-center gap-8px'>
          <Tooltip content={workspace || t('dispatch.create.workspacePlaceholder')} position='top'>
            <Input
              readOnly
              value={workspace}
              placeholder={t('dispatch.create.workspacePlaceholder')}
              className='flex-1'
              onClick={() => {
                void handleBrowseWorkspace();
              }}
            />
          </Tooltip>
          <Button
            type='secondary'
            icon={<FolderOpen theme='outline' size='16' fill={iconColors.primary} />}
            onClick={() => {
              void handleBrowseWorkspace();
            }}
          >
            {t('dispatch.create.workspaceBrowse')}
          </Button>
        </div>
      </div>

      {/* G4.2: Team Config Selector (optional, shown when workspace has team configs) */}
      {teamConfigs.length > 0 && (
        <div className='py-8px'>
          <div className='text-14px mb-8px text-t-secondary'>{t('dispatch.create.teamConfigLabel')}</div>
          <Select
            value={teamConfigName}
            onChange={setTeamConfigName}
            placeholder={t('dispatch.create.teamConfigPlaceholder')}
            allowClear
            showSearch
          >
            {teamConfigs.map((config) => (
              <Select.Option key={config.name} value={config.name}>
                {config.name}
              </Select.Option>
            ))}
          </Select>
        </div>
      )}
    </Modal>
  );
};

export default CreateGroupChatModal;
