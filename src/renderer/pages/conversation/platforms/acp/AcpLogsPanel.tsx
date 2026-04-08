import { Button, Space, Tag, Typography } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatAcpLogEntry } from './acpLogFormatter';
import type { AcpLogEntry } from './acpRuntimeDiagnostics';

const { Text } = Typography;

const formatTimestamp = (timestamp: number): string => {
  return new Date(timestamp).toISOString().slice(11, 19);
};

const AcpLogsPanel: React.FC<{
  entries: AcpLogEntry[];
  className?: string;
}> = ({ entries, className }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = React.useState(false);

  if (entries.length === 0) {
    return null;
  }

  const latestEntry = entries[0];
  const latestSummary = formatAcpLogEntry(latestEntry, t);
  const tagColor =
    latestEntry.level === 'error'
      ? 'red'
      : latestEntry.level === 'success'
        ? 'green'
        : latestEntry.level === 'warning'
          ? 'orange'
          : undefined;

  return (
    <div
      data-testid='acp-logs-panel'
      className={`rounded-12px border border-[color:var(--color-border-2)] bg-1 px-12px py-10px ${className ?? 'mb-12px'}`}
    >
      <div className='flex items-start gap-8px'>
        <Tag color={tagColor}>{t('acp.logs.title')}</Tag>
        <div className='min-w-0 flex-1'>
          <div className='text-13px text-t-primary leading-20px'>{latestSummary.summary}</div>
          {latestSummary.detail && (
            <div className='text-12px text-t-secondary leading-18px'>{latestSummary.detail}</div>
          )}
        </div>
        <Button
          type='text'
          size='mini'
          data-testid='acp-logs-toggle'
          onClick={() => {
            setExpanded((currentExpanded) => !currentExpanded);
          }}
        >
          {expanded ? t('common.hide') : t('common.show')}
        </Button>
      </div>

      {expanded && (
        <div
          data-testid='acp-logs-list'
          className='mt-10px flex flex-col gap-8px border-t border-[color:var(--color-border-2)] pt-8px'
        >
          {entries.map((entry) => {
            const formattedEntry = formatAcpLogEntry(entry, t);

            return (
              <div key={entry.id} className='flex items-start gap-8px'>
                <Text className='w-64px flex-shrink-0 text-11px text-t-tertiary'>
                  {formatTimestamp(entry.timestamp)}
                </Text>
                <Space direction='vertical' size={2} className='min-w-0 flex-1'>
                  <Text className='text-12px leading-18px'>{formattedEntry.summary}</Text>
                  {formattedEntry.detail && <Text type='secondary'>{formattedEntry.detail}</Text>}
                </Space>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AcpLogsPanel;
