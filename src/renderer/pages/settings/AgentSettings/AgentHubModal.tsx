import React from 'react';
import { List, Button, Typography, Tooltip } from '@arco-design/web-react';
import { IconDownload, IconRefresh } from '@arco-design/web-react/icon';
import ModalWrapper from '@/renderer/components/base/ModalWrapper';
import { useHubAgents } from '@/renderer/hooks/agent/useHubAgents';
import type { IHubAgentItem } from '@/common/types/hub';
import { resolveAgentLogo } from '@renderer/utils/model/agentLogo';

interface AgentHubModalProps {
  visible: boolean;
  onCancel: () => void;
}

export const AgentHubModal: React.FC<AgentHubModalProps> = ({ visible, onCancel }) => {
  const { agents, loading, install, retryInstall, update } = useHubAgents();

  const renderActionBtn = (agent: IHubAgentItem) => {
    switch (agent.status) {
      case 'not_installed':
        return (
          <Button type='primary' size='small' icon={<IconDownload />} onClick={() => install(agent.name)}>
            Install
          </Button>
        );
      case 'installing':
      case 'uninstalling':
        return (
          <Button type='primary' size='small' loading disabled>
            Installing...
          </Button>
        );
      case 'installed':
        return (
          <Button size='small' type='secondary' disabled>
            Installed
          </Button>
        );
      case 'install_failed':
        return (
          <Tooltip content={agent.installError || 'Installation failed'}>
            <Button status='danger' size='small' icon={<IconRefresh />} onClick={() => retryInstall(agent.name)}>
              Retry
            </Button>
          </Tooltip>
        );
      case 'update_available':
        return (
          <Button type='primary' size='small' icon={<IconDownload />} onClick={() => update(agent.name)}>
            Update
          </Button>
        );
      default:
        return null;
    }
  };

  return (
    <ModalWrapper
      title='Agent Hub'
      visible={visible}
      onCancel={onCancel}
      footer={null}
      autoFocus={false}
      focusLock={true}
      className='w-500px'
    >
      <List
        size='small'
        loading={loading}
        dataSource={agents}
        render={(agent: IHubAgentItem) => (
          <List.Item
            key={agent.name}
            className='flex items-center justify-between py-12px'
            extra={renderActionBtn(agent)}
          >
            <List.Item.Meta
              avatar={(() => {
                const logo = resolveAgentLogo({
                  icon: agent.icon,
                  backend: agent.contributes?.acpAdapters?.[0],
                });
                return logo ? (
                  <img src={logo} alt={agent.displayName} className='w-32px h-32px rounded-md' />
                ) : (
                  <div className='w-32px h-32px rounded-md bg-fill-2 flex items-center justify-center text-t-secondary font-bold'>
                    {agent.displayName.charAt(0)}
                  </div>
                );
              })()}
              title={<Typography.Text bold>{agent.displayName}</Typography.Text>}
              description={
                <Typography.Text className='text-12px text-t-secondary'>{agent.description}</Typography.Text>
              }
            />
          </List.Item>
        )}
      />
    </ModalWrapper>
  );
};
