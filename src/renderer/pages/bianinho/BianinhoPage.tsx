/**
 * BianinhoPage — Dashboard do assistente Bianinho
 * @license Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  Badge,
  Button,
  Card,
  Divider,
  Input,
  List,
  Progress,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
  Message,
} from '@arco-design/web-react';
import {
  HardDisk,
  Block,
  Timer,
  Cpu,
  MindMapping,
  Gear,
  Lightning,
  Plus,
  Refresh,
  Robot,
  Shield,
  Sync,
  Terminal,
} from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './index.module.css';

const { Text, Title } = Typography;

// ── Types ──────────────────────────────────────────────────

interface BridgeStatus {
  uptime: number;
  messagesProcessed: number;
  errors: number;
  lastError?: string;
  platform?: string;
  hermesPath?: string;
}

interface HermesCheck {
  ok: boolean;
  checks?: Record<string, boolean>;
}

interface SkillsInfo {
  count: number;
  skills: Array<{ name: string; size?: number }>;
}

interface SyncState {
  lastSync: number;
  pendingChanges: number;
  direction: string;
  errors: string[];
}

// ── Helpers ───────────────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatTimestamp(ts: number): string {
  if (!ts) return 'Nunca';
  return new Date(ts).toLocaleString('pt-BR');
}

// ── StatusCard ────────────────────────────────────────────

const StatusCard: React.FC<{
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  sub?: string;
}> = ({ title, value, icon, color, sub }) => (
  <Card className={styles.statusCard} bordered={false}>
    <div className={styles.statusCardInner}>
      <div className={styles.statusIcon} style={{ color }}>
        {icon}
      </div>
      <div className={styles.statusInfo}>
        <Text type='secondary' className={styles.statusTitle}>{title}</Text>
        <Title heading={4} className={styles.statusValue}>{value}</Title>
        {sub && <Text type='secondary' className={styles.statusSub}>{sub}</Text>}
      </div>
    </div>
  </Card>
);

// ── Main Component ────────────────────────────────────────

const BianinhoPage: React.FC = () => {
  const { t } = useTranslation();

  // Bridge state
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [bridgeLoading, setBridgeLoading] = useState(true);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  // Hermes state
  const [hermesCheck, setHermesCheck] = useState<HermesCheck | null>(null);
  const [hermesLoading, setHermesLoading] = useState(true);

  // Skills state
  const [skillsInfo, setSkillsInfo] = useState<SkillsInfo | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(true);

  // Sync state
  const [syncState, setSyncState] = useState<SyncState>({ lastSync: 0, pendingChanges: 0, direction: 'idle', errors: [] });

  // Platform info
  const [platformInfo, setPlatformInfo] = useState<Record<string, string>>({});

  // ── Data fetchers ───────────────────────────────────────

  const fetchBridgeStatus = useCallback(async () => {
    setBridgeLoading(true);
    setBridgeError(null);
    try {
      const result = await ipcBridge.bianinho.status.invoke();
      if (result?.ok !== false) {
        setBridgeStatus(result);
      } else {
        setBridgeError(result?.error || 'Bridge offline');
      }
    } catch (err) {
      setBridgeError('Bridge offline');
    } finally {
      setBridgeLoading(false);
    }
  }, []);

  const fetchHermesCheck = useCallback(async () => {
    setHermesLoading(true);
    try {
      const result = await ipcBridge.bianinho.checkHermes.invoke();
      setHermesCheck(result);
    } catch {
      setHermesCheck({ ok: false });
    } finally {
      setHermesLoading(false);
    }
  }, []);

  const fetchSkills = useCallback(async () => {
    setSkillsLoading(true);
    try {
      const result = await ipcBridge.bianinho.listSkills.invoke();
      setSkillsInfo(result);
    } catch {
      setSkillsInfo({ count: 0, skills: [] });
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  const fetchPlatformInfo = useCallback(async () => {
    try {
      const result = await ipcBridge.bianinho.platformInfo.invoke();
      setPlatformInfo(result || {});
    } catch { /* ignore */ }
  }, []);

  const fetchSyncState = useCallback(async () => {
    try {
      const result = await ipcBridge.bianinho.syncStatus.invoke();
      setSyncState(result || { lastSync: 0, pendingChanges: 0, direction: 'idle', errors: [] });
    } catch { /* ignore */ }
  }, []);

  // ── Actions ────────────────────────────────────────────

  const handlePing = useCallback(async () => {
    try {
      const result = await ipcBridge.bianinho.ping.invoke({ echo: 'pong' });
      if (result?.pong === 'pong') {
        Message.success('Bianinho responde! ✓');
      } else {
        Message.error('Sem resposta');
      }
    } catch {
      Message.error('Bridge offline');
    }
  }, []);

  const handleRefreshAll = useCallback(async () => {
    Message.info('A atualizar...');
    await Promise.all([fetchBridgeStatus(), fetchHermesCheck(), fetchSkills(), fetchPlatformInfo(), fetchSyncState()]);
    Message.success('Actualizado');
  }, [fetchBridgeStatus, fetchHermesCheck, fetchSkills, fetchPlatformInfo, fetchSyncState]);

  // ── Effects ─────────────────────────────────────────────

  useEffect(() => {
    void fetchBridgeStatus();
    void fetchHermesCheck();
    void fetchSkills();
    void fetchPlatformInfo();
    void fetchSyncState();
  }, [fetchBridgeStatus, fetchHermesCheck, fetchSkills, fetchPlatformInfo, fetchSyncState]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchBridgeStatus();
      void fetchSyncState();
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchBridgeStatus, fetchSyncState]);

  // ── Render ──────────────────────────────────────────────

  const isBridgeUp = bridgeStatus && !bridgeError;

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Robot theme='outline' size='28' fill='currentColor' />
          <Title heading={3} className={styles.headerTitle}>Bianinho</Title>
          <Tag color={isBridgeUp ? 'green' : 'red'} className={styles.headerTag}>
            {isBridgeUp ? 'Online' : 'Offline'}
          </Tag>
        </div>
        <Space>
          <Button icon={<Refresh theme='outline' size='16' />} onClick={handleRefreshAll}>
            Actualizar
          </Button>
          <Button icon={<Lightning theme='outline' size='16' />} type='primary' onClick={handlePing}>
            Testar
          </Button>
        </Space>
      </div>

      {/* Status Cards */}
      <div className={styles.cards}>
        <StatusCard
          title='Uptime'
          value={bridgeStatus ? formatUptime(bridgeStatus.uptime) : '—'}
          icon={<Timer theme='outline' size='24' />}
          color={isBridgeUp ? '#00b42a' : '#f53f3f'}
          sub={isBridgeUp ? 'Bridge activa' : 'Bridge offline'}
        />
        <StatusCard
          title='Mensagens'
          value={bridgeStatus?.messagesProcessed ?? '—'}
          icon={<Plus theme='outline' size='24' />}
          color='#165dff'
          sub={`${bridgeStatus?.errors ?? 0} erros`}
        />
        <StatusCard
          title='Skills'
          value={skillsInfo?.count ?? '—'}
          icon={<HardDisk theme='outline' size='24' />}
          color='#722ed1'
          sub='Skills do Hermes'
        />
        <StatusCard
          title='Sync'
          value={syncState.direction === 'idle' ? 'Sincronizado' : syncState.direction}
          icon={<Sync theme='outline' size='24' />}
          color={syncState.errors.length > 0 ? '#ff7d00' : '#00b42a'}
          sub={`Última: ${formatTimestamp(syncState.lastSync)}`}
        />
      </div>

      {/* Main Content */}
      <div className={styles.main}>
        {/* Left: Hermes Check */}
        <Card className={styles.section} bordered={false}>
          <div className={styles.sectionHeader}>
            <MindMapping theme='outline' size='20' />
            <Title heading={5}>Hermes Agent</Title>
          </div>
          <Skeleton loading={hermesLoading} text={{ rows: 4, width: ['100%', '80%', '60%', '40%'] }}>
            {hermesCheck?.checks ? (
              <List
                size='small'
                dataSource={Object.entries(hermesCheck.checks)}
                renderItem={([key, value]) => (
                  <List.Item key={key}>
                    <div className={styles.checkItem}>
                      {value
                        ? <Check theme='filled' size='16' fill='#00b42a' />
                        : <Block theme='outline' size='16' fill='#f53f3f' />}
                      <Text>{key.replace(/_/g, ' ')}</Text>
                    </div>
                  </List.Item>
                )}
              />
            ) : (
              <Text type='secondary'>A verificar Hermes...</Text>
            )}
          </Skeleton>
        </Card>

        {/* Right: Platform Info */}
        <Card className={styles.section} bordered={false}>
          <div className={styles.sectionHeader}>
            <Cpu theme='outline' size='20' />
            <Title heading={5}>Plataforma</Title>
          </div>
          <div className={styles.platformGrid}>
            {Object.entries(platformInfo).map(([key, value]) => (
              <div key={key} className={styles.platformItem}>
                <Text type='secondary' className={styles.platformKey}>{key}</Text>
                <Text className={styles.platformValue}>{value}</Text>
              </div>
            ))}
          </div>
          {hermesCheck?.checks?.hermes_path && (
            <>
              <Divider />
              <div className={styles.hermesPath}>
                <Text type='secondary'>Hermes Path:</Text>
                <Text code>{hermesCheck.checks.hermes_path}</Text>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Skills List */}
      <Card className={styles.section} bordered={false}>
        <div className={styles.sectionHeader}>
          <HardDisk theme='outline' size='20' />
          <Title heading={5}>Skills do Hermes ({skillsInfo?.count ?? 0})</Title>
        </div>
        <Skeleton loading={skillsLoading} text={{ rows: 3 }}>
          {skillsInfo?.skills && skillsInfo.skills.length > 0 ? (
            <div className={styles.skillsGrid}>
              {skillsInfo.skills.slice(0, 20).map((skill) => (
                <Tag key={skill.name} className={styles.skillTag}>
                  {skill.name}
                </Tag>
              ))}
              {skillsInfo.skills.length > 20 && (
                <Tag>+{skillsInfo.skills.length - 20} mais</Tag>
              )}
            </div>
          ) : (
            <Text type='secondary'>Nenhuma skill encontrada</Text>
          )}
        </Skeleton>
      </Card>

      {/* Quick Actions */}
      <Card className={styles.section} bordered={false}>
        <div className={styles.sectionHeader}>
          <Terminal theme='outline' size='20' />
          <Title heading={5}>Ações Rápidas</Title>
        </div>
        <Space wrap>
          <Button onClick={handlePing}>Ping</Button>
          <Button onClick={fetchBridgeStatus}>Status</Button>
          <Button onClick={fetchHermesCheck}>Verificar Hermes</Button>
          <Button onClick={fetchSkills}>Listar Skills</Button>
          <Button onClick={fetchSyncState}>Estado Sync</Button>
        </Space>
      </Card>
    </div>
  );
};

export default BianinhoPage;
