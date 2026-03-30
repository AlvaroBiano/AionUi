/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Collapse, Spin, Table, Tag, Typography } from '@arco-design/web-react';
import { ChartLine } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type SessionCostEntry = {
  sessionId: string;
  displayName: string;
  role: 'admin' | 'child';
  totalTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  modelName?: string;
  estimatedCost?: number;
};

type GroupCostSummary = {
  totalTokens: number;
  totalEstimatedCost: number;
  sessions: SessionCostEntry[];
  updatedAt: number;
};

type CostPanelProps = {
  conversationId: string;
};

/** Format token count for display (e.g., 1234 -> "1.2K") */
function formatTokens(tokens: number): string {
  if (tokens === 0) return '0';
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

/** Format USD cost for display */
function formatCost(cost: number | undefined): string {
  if (cost === undefined || cost === 0) return 'N/A';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

const REFRESH_INTERVAL_MS = 10_000;

const CostPanel: React.FC<CostPanelProps> = ({ conversationId }) => {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<GroupCostSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCost = useCallback(async () => {
    try {
      const result = await ipcBridge.dispatch.getGroupCostSummary.invoke({ conversationId });
      if (result.success && result.data) {
        setSummary(result.data);
      }
    } catch {
      // Silently ignore errors — cost panel is non-critical
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  // Only fetch when expanded; auto-refresh every 10s while expanded
  useEffect(() => {
    if (!expanded) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    setLoading(true);
    void fetchCost();

    intervalRef.current = setInterval(() => {
      void fetchCost();
    }, REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchCost, expanded]);

  const columns = [
    {
      title: t('dispatch.cost.memberColumn'),
      dataIndex: 'displayName',
      key: 'displayName',
      render: (name: string, record: SessionCostEntry) => (
        <span className='flex items-center gap-4px'>
          <span>{name}</span>
          {record.role === 'admin' && (
            <Tag size='small' color='arcoblue'>
              {t('dispatch.cost.adminTag')}
            </Tag>
          )}
        </span>
      ),
    },
    {
      title: t('dispatch.cost.tokensColumn'),
      dataIndex: 'totalTokens',
      key: 'totalTokens',
      render: (tokens: number) => (tokens > 0 ? formatTokens(tokens) : t('dispatch.cost.notAvailable')),
    },
    {
      title: t('dispatch.cost.modelColumn'),
      dataIndex: 'modelName',
      key: 'modelName',
      render: (model: string | undefined) => model || '-',
    },
    {
      title: t('dispatch.cost.estimatedCostColumn'),
      dataIndex: 'estimatedCost',
      key: 'estimatedCost',
      render: (cost: number | undefined) => formatCost(cost),
    },
  ];

  return (
    <Collapse
      bordered={false}
      style={{ background: 'transparent' }}
      activeKey={expanded ? ['cost'] : []}
      onChange={(_, keys) => setExpanded(Array.isArray(keys) ? keys.includes('cost') : keys === 'cost')}
    >
      <Collapse.Item
        name='cost'
        header={
          <span className='flex items-center gap-6px text-13px'>
            <ChartLine theme='outline' size='14' />
            <span>{t('dispatch.cost.title')}</span>
            {summary && (
              <Typography.Text type='secondary' className='text-12px'>
                {formatTokens(summary.totalTokens)} {t('dispatch.cost.tokens')} / {formatCost(summary.totalEstimatedCost)}
              </Typography.Text>
            )}
          </span>
        }
      >
        {loading && !summary ? (
          <div className='flex-center py-16px'>
            <Spin size={16} />
          </div>
        ) : summary ? (
          <div>
            <div className='flex items-center gap-16px mb-8px text-12px text-t-secondary'>
              <span>
                {t('dispatch.cost.totalTokens')}: {formatTokens(summary.totalTokens)}
              </span>
              <span>
                {t('dispatch.cost.totalCost')}: {formatCost(summary.totalEstimatedCost)}
              </span>
            </div>
            <Table
              columns={columns}
              data={summary.sessions}
              rowKey='sessionId'
              size='mini'
              pagination={false}
              border={false}
              noDataElement={<span className='text-12px text-t-secondary'>{t('dispatch.cost.noData')}</span>}
            />
            <div className='mt-4px text-11px text-t-tertiary'>{t('dispatch.cost.disclaimer')}</div>
          </div>
        ) : (
          <div className='text-12px text-t-secondary py-8px'>{t('dispatch.cost.noData')}</div>
        )}
      </Collapse.Item>
    </Collapse>
  );
};

export default CostPanel;
