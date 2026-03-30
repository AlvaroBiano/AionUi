/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * G3.6: Add member modal.
 * Uses Arco Modal with Select for agent selection.
 * Shows agents from useAgentRegistry, disables already-added ones.
 * Search/filter support via showSearch.
 */

import { ipcBridge } from '@/common';
import { useAgentRegistry } from '@/renderer/hooks/useAgentRegistry';
import { Message, Modal, Select } from '@arco-design/web-react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type AddMemberModalProps = {
  visible: boolean;
  onClose: () => void;
  conversationId: string;
  existingMemberIds: string[];
  onMemberAdded: () => void;
};

const AddMemberModal: React.FC<AddMemberModalProps> = ({
  visible,
  onClose,
  conversationId,
  existingMemberIds,
  onMemberAdded,
}) => {
  const { t } = useTranslation();
  const agentRegistry = useAgentRegistry();
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);

  // Convert registry Map to array for Select options
  const availableAgents = useMemo(() => {
    const agents: Array<{
      id: string;
      name: string;
      avatar?: string;
      description?: string;
      isDisabled: boolean;
    }> = [];

    for (const [id, agent] of agentRegistry) {
      agents.push({
        id,
        name: agent.name,
        avatar: agent.avatar,
        description: agent.description,
        isDisabled: existingMemberIds.includes(id),
      });
    }

    return agents;
  }, [agentRegistry, existingMemberIds]);

  const handleAdd = useCallback(async () => {
    if (!selectedAgentId) return;
    setAdding(true);
    try {
      const result = await ipcBridge.dispatch.addMember.invoke({
        conversationId,
        agentId: selectedAgentId,
      });

      if (result.success) {
        Message.success(t('dispatch.addMember.success'));
        setSelectedAgentId(undefined);
        onMemberAdded();
      } else {
        Message.error(result.msg || t('dispatch.addMember.error'));
      }
    } catch (_err) {
      Message.error(t('dispatch.addMember.error'));
    } finally {
      setAdding(false);
    }
  }, [selectedAgentId, conversationId, onMemberAdded, t]);

  const handleClose = useCallback(() => {
    setSelectedAgentId(undefined);
    onClose();
  }, [onClose]);

  return (
    <Modal
      title={t('dispatch.addMember.title')}
      visible={visible}
      onOk={handleAdd}
      onCancel={handleClose}
      okText={t('dispatch.addMember.confirm')}
      okButtonProps={{ disabled: !selectedAgentId, loading: adding }}
      unmountOnExit
    >
      <Select
        value={selectedAgentId}
        onChange={setSelectedAgentId}
        placeholder={t('dispatch.addMember.placeholder')}
        showSearch
        filterOption={(input, option) => {
          const props = option?.props as { value?: string } | undefined;
          const optionValue = props?.value;
          if (typeof optionValue === 'string') {
            const agent = availableAgents.find((a) => a.id === optionValue);
            if (agent) {
              return agent.name.toLowerCase().includes(input.toLowerCase());
            }
          }
          return false;
        }}
        className='w-full'
      >
        {availableAgents.map((agent) => (
          <Select.Option key={agent.id} value={agent.id} disabled={agent.isDisabled}>
            <span className='flex items-center gap-6px'>
              {agent.avatar && <span className='text-16px leading-none'>{agent.avatar}</span>}
              <span>{agent.name}</span>
              {agent.description && (
                <span className='text-12px text-t-secondary ml-4px truncate'>{agent.description}</span>
              )}
              {agent.isDisabled && (
                <span className='text-11px text-t-secondary ml-auto'>{t('dispatch.addMember.alreadyAdded')}</span>
              )}
            </span>
          </Select.Option>
        ))}
      </Select>
    </Modal>
  );
};

export default AddMemberModal;
