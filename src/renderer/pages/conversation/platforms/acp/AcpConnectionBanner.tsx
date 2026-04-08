import { resolveAcpDisplayName } from '@/renderer/pages/conversation/utils/resolveConversationBackend';
import { Alert, Button, Space, Typography } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

type AcpConnectionBannerProps = {
  agentName?: string;
  backend: string;
  retrying?: boolean;
  onRetry: () => void;
};

const AcpConnectionBanner: React.FC<AcpConnectionBannerProps> = ({ agentName, backend, retrying = false, onRetry }) => {
  const { t } = useTranslation();

  const displayName = resolveAcpDisplayName(backend, agentName);

  return (
    <Alert
      type='error'
      closable={false}
      data-testid='acp-disconnected-banner'
      title={t('acp.status.disconnected', { agent: displayName })}
      content={
        <Space direction='vertical' size='small' style={{ width: '100%' }}>
          <Text>{t('acp.connection.disconnectedHint', { agent: displayName })}</Text>
          <Space>
            <Button type='primary' size='mini' loading={retrying} onClick={onRetry}>
              {t('common.retry')}
            </Button>
          </Space>
        </Space>
      }
      className='mb-12px'
    />
  );
};

export default AcpConnectionBanner;
