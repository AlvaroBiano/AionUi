import { resolveAcpDisplayName } from '@/renderer/pages/conversation/utils/resolveConversationBackend';
import { Alert, Button, Space, Typography } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

type AcpAuthBannerProps = {
  agentName?: string;
  backend: string;
  authenticating?: boolean;
  checkingSupport?: boolean;
  showAuthenticateAction?: boolean;
  onAuthenticate: () => void;
};

const AcpAuthBanner: React.FC<AcpAuthBannerProps> = ({
  agentName,
  backend,
  authenticating = false,
  checkingSupport = false,
  showAuthenticateAction = true,
  onAuthenticate,
}) => {
  const { t } = useTranslation();

  const displayName = resolveAcpDisplayName(backend, agentName);

  return (
    <Alert
      type='warning'
      closable={false}
      data-testid='acp-auth-banner'
      title={t('acp.status.auth_required', { agent: displayName })}
      content={
        <Space direction='vertical' size='small' style={{ width: '100%' }}>
          <Text>
            {authenticating
              ? t('acp.auth.authenticatingHint', { agent: displayName })
              : checkingSupport
                ? t('acp.auth.checkingHint', { agent: displayName })
                : showAuthenticateAction
                  ? t('acp.auth.requiredHint', { agent: displayName })
                  : t('acp.auth.manualHint', { agent: displayName })}
          </Text>
          {showAuthenticateAction && (
            <Space>
              <Button type='primary' size='mini' loading={authenticating} onClick={onAuthenticate}>
                {authenticating ? t('acp.auth.authenticating') : t('acp.auth.authenticate')}
              </Button>
            </Space>
          )}
        </Space>
      }
      className='mb-12px'
    />
  );
};

export default AcpAuthBanner;
