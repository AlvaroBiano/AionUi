/**
 * BianinhoPage — Dashboard completo do assistente Bianinho
 * Fase 2: Inbox Manager, RAG Search, Ciclo Autónomo, Monitoring, Notifications
 * @license Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  Badge,
  Button,
  Card,
  Col,
  Divider,
  Input,
  List,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Textarea,
  Tooltip,
  Typography,
  Message,
  Notification,
} from '@arco-design/web-react';
import {
  Block,
  Book,
  Check,
  Flashlamp,
  HardDisk,
  Lightning,
  ManualGear,
  MindMapping,
  Mute,
  Plus,
  Power,
  Refresh,
  Robot,
  Signal,
  Sound,
  Sync,
  Terminal,
  Timer,
} from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './index.module.css';

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

// ── Types ──────────────────────────────────────────────────

interface BridgeStatus {
  uptime: number;
  messages_processed: number;
  errors: number;
  last_error?: string;
  rate_limit_hits: number;
  auth_failures: number;
  platform?: string;
  hermes_path?: string;
  rag_path?: string;
  backup_dir?: string;
}

interface HermesCheck {
  ok: boolean;
  checks?: Record<string, boolean>;
}

interface SkillsInfo {
  count: number;
  skills: Array<{ name: string; size?: number; type?: string }>;
}

interface SyncState {
  lastSync: number;
  pendingChanges: number;
  direction: string;
  errors: string[];
}

interface RAGStats {
  path: string;
  exists: boolean;
  categories: Array<{ name: string; count: number }>;
  total_chunks: number;
}

interface InboxItem {
  id: string;
  content: string;
  priority: string;
  tags: string[];
  source: string;
  done: boolean;
  created_at: string;
  done_at?: string;
}

interface CycleStatus {
  exists: boolean;
  state: Record<string, unknown>;
}

interface RAGSearchResult {
  text: string;
  category: string;
  score?: number;
}

// ── Helpers ───────────────────────────────────────────────

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTimestamp(ts: number | string): string {
  if (!ts) return 'Nunca';
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts * 1000);
  if (isNaN(d.getTime())) return 'Nunca';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function priorityColor(p: string): string {
  const map: Record<string, string> = { '1': 'red', '2': 'orange', '3': 'blue', '4': 'gray' };
  return map[p] || 'gray';
}

function priorityLabel(p: string): string {
  const map: Record<string, string> = { '1': 'Crítica', '2': 'Alta', '3': 'Normal', '4': 'Baixa' };
  return map[p] || p;
}

// ── StatusCard ────────────────────────────────────────────

const StatusCard: React.FC<{
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  sub?: string;
  loading?: boolean;
}> = ({ title, value, icon, color, sub, loading }) => (
  <Card className={styles.statusCard} bordered={false}>
    <Skeleton loading={loading} text={{ rows: 1, width: '100%' }}>
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
    </Skeleton>
  </Card>
);

// ── Main Component ────────────────────────────────────────

const BianinhoPage: React.FC = () => {
  const { t } = useTranslation();

  // ── Bridge state ─────────────────────────────────────
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [bridgeLoading, setBridgeLoading] = useState(true);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  // ── Hermes state ──────────────────────────────────────
  const [hermesCheck, setHermesCheck] = useState<HermesCheck | null>(null);
  const [hermesLoading, setHermesLoading] = useState(true);

  // ── Skills state ──────────────────────────────────────
  const [skillsInfo, setSkillsInfo] = useState<SkillsInfo | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(true);

  // ── Sync state ────────────────────────────────────────
  const [syncState, setSyncState] = useState<SyncState>({
    lastSync: 0, pendingChanges: 0, direction: 'idle', errors: []
  });

  // ── RAG state ────────────────────────────────────────
  const [ragStats, setRagStats] = useState<RAGStats | null>(null);
  const [ragLoading, setRagLoading] = useState(true);
  const [ragQuery, setRagQuery] = useState('');
  const [ragCategory, setRagCategory] = useState('all');
  const [ragResults, setRagResults] = useState<RAGSearchResult[]>([]);
  const [ragSearching, setRagSearching] = useState(false);

  // ── Inbox state ───────────────────────────────────────
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [inboxModalOpen, setInboxModalOpen] = useState(false);
  const [inboxForm, setInboxForm] = useState({ content: '', priority: '3', tags: '', source: 'alvaro' });

  // ── Cycle state ───────────────────────────────────────
  const [cycleStatus, setCycleStatus] = useState<CycleStatus | null>(null);
  const [cycleLoading, setCycleLoading] = useState(true);

  // ── Platform info ─────────────────────────────────────
  const [platformInfo, setPlatformInfo] = useState<Record<string, string>>({});

  // ── Active tab ────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('overview');

  // ── Bridge latency measurement ─────────────────────────
  const [bridgeLatency, setBridgeLatency] = useState<number | null>(null);
  const latencyIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Data fetchers ─────────────────────────────────────

  const fetchBridgeStatus = useCallback(async () => {
    setBridgeLoading(true);
    setBridgeError(null);
    try {
      const result = await ipcBridge.bianinho.status.invoke();
      if (result?.ok !== false) {
        setBridgeStatus(result);
        setBridgeError(null);
      } else {
        setBridgeError(result?.error || 'Bridge offline');
      }
    } catch {
      setBridgeError('Bridge offline');
    } finally {
      setBridgeLoading(false);
    }
  }, []);

  const measureLatency = useCallback(async () => {
    const start = Date.now();
    try {
      await ipcBridge.bianinho.ping.invoke({ echo: 'latency' });
      setBridgeLatency(Date.now() - start);
    } catch { /* ignore */ }
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

  const fetchRAGStats = useCallback(async () => {
    setRagLoading(true);
    try {
      const result = await ipcBridge.bianinho.ragStats.invoke();
      setRagStats(result?.stats || null);
    } catch {
      setRagStats(null);
    } finally {
      setRagLoading(false);
    }
  }, []);

  const fetchInbox = useCallback(async () => {
    setInboxLoading(true);
    try {
      const result = await ipcBridge.bianinho.inboxList.invoke();
      setInboxItems(result?.items || []);
    } catch {
      setInboxItems([]);
    } finally {
      setInboxLoading(false);
    }
  }, []);

  const fetchCycleStatus = useCallback(async () => {
    setCycleLoading(true);
    try {
      const result = await ipcBridge.bianinho.cycleStatus.invoke();
      setCycleStatus(result);
    } catch {
      setCycleStatus(null);
    } finally {
      setCycleLoading(false);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    await Promise.all([
      fetchBridgeStatus(),
      fetchHermesCheck(),
      fetchSkills(),
      fetchPlatformInfo(),
      fetchSyncState(),
      fetchRAGStats(),
      fetchInbox(),
      fetchCycleStatus(),
    ]);
  }, [fetchBridgeStatus, fetchHermesCheck, fetchSkills, fetchPlatformInfo, fetchSyncState, fetchRAGStats, fetchInbox, fetchCycleStatus]);

  // ── Actions ───────────────────────────────────────────

  const handlePing = useCallback(async () => {
    try {
      const result = await ipcBridge.bianinho.ping.invoke({ echo: 'pong' });
      if (result?.pong === 'pong') {
        Notification.success({ title: 'Bianinho', content: 'Responde correctamente ✓' });
      } else {
        Notification.error({ title: 'Bianinho', content: 'Sem resposta' });
      }
    } catch {
      Notification.error({ title: 'Bianinho', content: 'Bridge offline' });
    }
  }, []);

  const handleForceCycle = useCallback(async () => {
    try {
      const result = await ipcBridge.bianinho.cycleTrigger.invoke();
      if (result?.ok) {
        Notification.success({ title: 'Ciclo Autónomo', content: 'Ciclo forçado com sucesso' });
        setTimeout(fetchCycleStatus, 1000);
      }
    } catch {
      Notification.error({ title: 'Ciclo Autónomo', content: 'Erro ao forçar ciclo' });
    }
  }, [fetchCycleStatus]);

  const handleRAGSearch = useCallback(async () => {
    if (!ragQuery.trim()) return;
    setRagSearching(true);
    try {
      const category = ragCategory !== 'all' ? ragCategory : undefined;
      const result = await ipcBridge.bianinho.ragSearch.invoke({
        query: ragQuery,
        category,
        topK: 10,
        accessLevel: 'full',
      });
      setRagResults(result?.results || []);
    } catch {
      setRagResults([]);
    } finally {
      setRagSearching(false);
    }
  }, [ragQuery, ragCategory]);

  const handleInboxAdd = useCallback(async () => {
    if (!inboxForm.content.trim()) return;
    try {
      const result = await ipcBridge.bianinho.inboxAdd.invoke({
        content: inboxForm.content,
        priority: inboxForm.priority,
        tags: inboxForm.tags.split(',').map(t => t.trim()).filter(Boolean),
        source: inboxForm.source,
      });
      if (result?.ok) {
        setInboxForm({ content: '', priority: '3', tags: '', source: 'alvaro' });
        setInboxModalOpen(false);
        fetchInbox();
        Notification.success({ title: 'Inbox', content: 'Tarefa adicionada' });
      }
    } catch {
      Notification.error({ title: 'Inbox', content: 'Erro ao adicionar tarefa' });
    }
  }, [inboxForm, fetchInbox]);

  const handleInboxDone = useCallback(async (id: string) => {
    try {
      const result = await ipcBridge.bianinho.inboxDone.invoke({ id });
      if (result?.ok) {
        fetchInbox();
        Notification.success({ title: 'Inbox', content: 'Tarefa concluída' });
      }
    } catch {
      Notification.error({ title: 'Inbox', content: 'Erro ao marcar tarefa' });
    }
  }, [fetchInbox]);

  const handleInboxDelete = useCallback(async (id: string) => {
    try {
      const result = await ipcBridge.bianinho.inboxDelete.invoke({ id });
      if (result?.ok) {
        fetchInbox();
      }
    } catch { /* ignore */ }
  }, [fetchInbox]);

  // ── Effects ─────────────────────────────────────────────

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Latency measurement every 60s
  useEffect(() => {
    void measureLatency();
    latencyIntervalRef.current = setInterval(() => {
      void measureLatency();
    }, 60_000);
    return () => {
      if (latencyIntervalRef.current) clearInterval(latencyIntervalRef.current);
    };
  }, [measureLatency]);

  // ── Render ─────────────────────────────────────────────

  const isBridgeUp = bridgeStatus && !bridgeError;
  const pendingTasks = inboxItems.filter(i => !i.done).length;
  const doneTasks = inboxItems.filter(i => i.done).length;

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
          {bridgeLatency != null && (
            <Tag color={bridgeLatency < 50 ? 'green' : bridgeLatency < 200 ? 'orange' : 'red'}>
              {bridgeLatency}ms
            </Tag>
          )}
        </div>
        <Space>
          <Button icon={<Refresh theme='outline' size='16' />} onClick={() => void fetchAll()}>
            Actualizar
          </Button>
          <Button icon={<Lightning theme='outline' size='16' />} type='primary' onClick={() => void handlePing()}>
            Testar
          </Button>
        </Space>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {[
          { key: 'overview', label: 'Visão Geral' },
          { key: 'inbox', label: `Inbox (${pendingTasks})` },
          { key: 'rag', label: 'RAG Search' },
          { key: 'cycle', label: 'Ciclo Autónomo' },
        ].map(tab => (
          <button
            key={tab.key}
            className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Overview ─────────────────────────────── */}
      {activeTab === 'overview' && (
        <>
          {/* Status Cards */}
          <div className={styles.cards}>
            <StatusCard
              title='Uptime'
              value={bridgeStatus ? formatUptime(bridgeStatus.uptime) : '—'}
              icon={<Timer theme='outline' size='24' />}
              color={isBridgeUp ? '#00b42a' : '#f53f3f'}
              sub={isBridgeUp ? 'Bridge activa' : 'Bridge offline'}
              loading={bridgeLoading}
            />
            <StatusCard
              title='RAG Chunks'
              value={ragStats?.total_chunks ?? '—'}
              icon={<HardDisk theme='outline' size='24' />}
              color='#165dff'
              sub={ragStats ? `${ragStats.categories.length} categorias` : 'A carregar...'}
              loading={ragLoading}
            />
            <StatusCard
              title='Skills'
              value={skillsInfo?.count ?? '—'}
              icon={<HardDisk theme='outline' size='24' />}
              color='#722ed1'
              sub='do Hermes'
              loading={skillsLoading}
            />
            <StatusCard
              title='Tarefas'
              value={pendingTasks}
              icon={<Check theme='outline' size='24' />}
              color={pendingTasks > 0 ? '#ff7d00' : '#00b42a'}
              sub={`${doneTasks} concluídas`}
              loading={inboxLoading}
            />
          </div>

          {/* Main Content */}
          <div className={styles.main}>
            {/* Hermes Check */}
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

            {/* Bridge Metrics */}
            <Card className={styles.section} bordered={false}>
              <div className={styles.sectionHeader}>
                <ManualGear theme='outline' size='20' />
                <Title heading={5}>Bridge Metrics</Title>
              </div>
              <div className={styles.metricsGrid}>
                <div className={styles.metricItem}>
                  <Text type='secondary'>Mensagens</Text>
                  <Text>{bridgeStatus?.messages_processed ?? 0}</Text>
                </div>
                <div className={styles.metricItem}>
                  <Text type='secondary'>Erros</Text>
                  <Text type={bridgeStatus?.errors ? 'error' : 'secondary'}>{bridgeStatus?.errors ?? 0}</Text>
                </div>
                <div className={styles.metricItem}>
                  <Text type='secondary'>Rate Limit Hits</Text>
                  <Text>{bridgeStatus?.rate_limit_hits ?? 0}</Text>
                </div>
                <div className={styles.metricItem}>
                  <Text type='secondary'>Auth Failures</Text>
                  <Text>{bridgeStatus?.auth_failures ?? 0}</Text>
                </div>
                <div className={styles.metricItem}>
                  <Text type='secondary'>Latência</Text>
                  <Text type={bridgeLatency && bridgeLatency < 50 ? 'success' : 'secondary'}>
                    {bridgeLatency != null ? `${bridgeLatency}ms` : '—'}
                  </Text>
                </div>
                <div className={styles.metricItem}>
                  <Text type='secondary'>Plataforma</Text>
                  <Text>{bridgeStatus?.platform ?? '—'}</Text>
                </div>
              </div>
              {bridgeStatus?.last_error && (
                <div className={styles.errorBox}>
                  <Text type='error'>Último erro: {bridgeStatus.last_error}</Text>
                </div>
              )}
            </Card>
          </div>

          {/* RAG Categories */}
          {ragStats && ragStats.categories.length > 0 && (
            <Card className={styles.section} bordered={false}>
              <div className={styles.sectionHeader}>
                <HardDisk theme='outline' size='20' />
                <Title heading={5}>RAG — Categorias</Title>
              </div>
              <div className={styles.categoriesGrid}>
                {ragStats.categories.map(cat => (
                  <Tag key={cat.name} color='arcoblue' className={styles.categoryTag}>
                    {cat.name} ({cat.count})
                  </Tag>
                ))}
              </div>
            </Card>
          )}

          {/* Skills */}
          <Card className={styles.section} bordered={false}>
            <div className={styles.sectionHeader}>
              <HardDisk theme='outline' size='20' />
              <Title heading={5}>Skills do Hermes ({skillsInfo?.count ?? 0})</Title>
            </div>
            <Skeleton loading={skillsLoading} text={{ rows: 3 }}>
              {skillsInfo?.skills && skillsInfo.skills.length > 0 ? (
                <div className={styles.skillsGrid}>
                  {skillsInfo.skills.slice(0, 30).map((skill) => (
                    <Tag key={skill.name} className={styles.skillTag}>
                      {skill.name}
                    </Tag>
                  ))}
                  {skillsInfo.skills.length > 30 && (
                    <Tag>+{skillsInfo.skills.length - 30} mais</Tag>
                  )}
                </div>
              ) : (
                <Text type='secondary'>Nenhuma skill encontrada</Text>
              )}
            </Skeleton>
          </Card>
        </>
      )}

      {/* ── Tab: Inbox ──────────────────────────────────── */}
      {activeTab === 'inbox' && (
        <>
          <Card className={styles.section} bordered={false}>
            <div className={styles.sectionHeader}>
              <Check theme='outline' size='20' />
              <Title heading={5}>Inbox — {pendingTasks} pendentes</Title>
              <Button
                icon={<Plus theme='outline' size='16' />}
                type='primary'
                size='small'
                onClick={() => setInboxModalOpen(true)}
              >
                Nova Tarefa
              </Button>
            </div>

            <Divider />

            <Skeleton loading={inboxLoading} text={{ rows: 5 }}>
              {inboxItems.length === 0 ? (
                <Text type='secondary'>Nenhuma tarefa. Clique em "Nova Tarefa" para adicionar.</Text>
              ) : (
                <List
                  dataSource={inboxItems}
                  renderItem={(item: InboxItem) => (
                    <List.Item
                      key={item.id}
                      className={`${styles.inboxItem} ${item.done ? styles.inboxItemDone : ''}`}
                    >
                      <div className={styles.inboxItemContent}>
                        <div className={styles.inboxItemLeft}>
                          <Tag color={priorityColor(item.priority)} size='small'>
                            {priorityLabel(item.priority)}
                          </Tag>
                          {item.done && (
                            <Check theme='filled' size='16' fill='#00b42a' />
                          )}
                          <Text delete={item.done}>{item.content}</Text>
                        </div>
                        <div className={styles.inboxItemRight}>
                          <Text type='secondary' className={styles.inboxMeta}>
                            {formatTimestamp(item.created_at)} · {item.source}
                          </Text>
                          {!item.done && (
                            <Button
                              size='mini'
                              icon={<Check theme='outline' size='14' />}
                              onClick={() => void handleInboxDone(item.id)}
                            >
                              Done
                            </Button>
                          )}
                          <Popconfirm
                            title='Eliminar tarefa?'
                            onOk={() => void handleInboxDelete(item.id)}
                          >
                            <Button
                              size='mini'
                              icon={<Block theme='outline' size='14' />}
                              status='danger'
                            />
                          </Popconfirm>
                        </div>
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </Skeleton>
          </Card>

          {/* Inbox Modal */}
          <Modal
            title='Nova Tarefa'
            visible={inboxModalOpen}
            onOk={() => void handleInboxAdd()}
            onCancel={() => setInboxModalOpen(false)}
            okText='Adicionar'
          >
            <Space direction='vertical' size='medium' style={{ width: '100%' }}>
              <div>
                <Text type='secondary'>Descrição</Text>
                <TextArea
                  value={inboxForm.content}
                  onChange={v => setInboxForm(f => ({ ...f, content: v }))}
                  placeholder='O que precisa ser feito?'
                  rows={3}
                  style={{ marginTop: 4 }}
                />
              </div>
              <div>
                <Text type='secondary'>Prioridade</Text>
                <Select
                  value={inboxForm.priority}
                  onChange={v => setInboxForm(f => ({ ...f, priority: v }))}
                  style={{ width: '100%', marginTop: 4 }}
                >
                  <Select.Option value='1'>🔴 Crítica</Select.Option>
                  <Select.Option value='2'>🟠 Alta</Select.Option>
                  <Select.Option value='3'>🔵 Normal</Select.Option>
                  <Select.Option value='4'>⚪ Baixa</Select.Option>
                </Select>
              </div>
              <div>
                <Text type='secondary'>Tags (separadas por vírgula)</Text>
                <Input
                  value={inboxForm.tags}
                  onChange={v => setInboxForm(f => ({ ...f, tags: v }))}
                  placeholder='trabalho, pessoal, urgente'
                  style={{ marginTop: 4 }}
                />
              </div>
            </Space>
          </Modal>
        </>
      )}

      {/* ── Tab: RAG Search ─────────────────────────────── */}
      {activeTab === 'rag' && (
        <>
          <Card className={styles.section} bordered={false}>
            <div className={styles.sectionHeader}>
              <Search theme='outline' size='20' />
              <Title heading={5}>Pesquisa RAG</Title>
            </div>
            <Space direction='vertical' size='medium' style={{ width: '100%' }}>
              <div className={styles.ragSearchRow}>
                <Input
                  value={ragQuery}
                  onChange={setRagQuery}
                  placeholder='Pergunta para a knowledge base...'
                  onPressEnter={() => void handleRAGSearch()}
                  style={{ flex: 1 }}
                />
                <Select
                  value={ragCategory}
                  onChange={setRagCategory}
                  style={{ width: 160 }}
                >
                  <Select.Option value='all'>Todas</Select.Option>
                  <Select.Option value='metodoten'>Método TEN</Select.Option>
                  <Select.Option value='livros'>Livros</Select.Option>
                  <Select.Option value='memoria'>Memória</Select.Option>
                  <Select.Option value='sac_leads'>SAC Leads</Select.Option>
                  <Select.Option value='default'>Default</Select.Option>
                </Select>
                <Button
                  type='primary'
                  icon={<Search theme='outline' size='16' />}
                  loading={ragSearching}
                  onClick={() => void handleRAGSearch()}
                >
                  Pesquisar
                </Button>
              </div>
            </Space>
          </Card>

          {/* RAG Results */}
          {ragResults.length > 0 && (
            <Card className={styles.section} bordered={false}>
              <div className={styles.sectionHeader}>
                <HardDisk theme='outline' size='20' />
                <Title heading={5}>Resultados ({ragResults.length})</Title>
              </div>
              <List
                dataSource={ragResults}
                renderItem={(result: RAGSearchResult, idx: number) => (
                  <List.Item key={idx}>
                    <div className={styles.ragResult}>
                      <Tag color='arcoblue' size='small'>{result.category}</Tag>
                      {result.score != null && (
                        <Text type='secondary' style={{ fontSize: 12 }}>
                          Score: {result.score.toFixed(3)}
                        </Text>
                      )}
                      <Paragraph
                        className={styles.ragResultText}
                        type='secondary'
                        ellipsis={{ rows: 3, expandable: true }}
                      >
                        {result.text}
                      </Paragraph>
                    </div>
                  </List.Item>
                )}
              />
            </Card>
          )}

          {ragQuery && ragResults.length === 0 && !ragSearching && (
            <Card className={styles.section} bordered={false}>
              <Text type='secondary'>Nenhum resultado para "{ragQuery}"</Text>
            </Card>
          )}
        </>
      )}

      {/* ── Tab: Ciclo Autónomo ────────────────────────── */}
      {activeTab === 'cycle' && (
        <>
          <Card className={styles.section} bordered={false}>
            <div className={styles.sectionHeader}>
              <Lightning theme='outline' size='20' />
              <Title heading={5}>Ciclo Autónomo</Title>
            </div>
            <Skeleton loading={cycleLoading} text={{ rows: 3 }}>
              <Space direction='vertical' size='medium' style={{ width: '100%' }}>
                <div className={styles.cycleInfo}>
                  <div className={styles.cycleItem}>
                    <AlarmClock theme='outline' size='20' />
                    <div>
                      <Text type='secondary'>Estado do Ciclo</Text>
                      <Title heading={5}>
                        {cycleStatus?.exists ? 'Configurado' : 'Não encontrado'}
                      </Title>
                    </div>
                  </div>
                  <div className={styles.cycleItem}>
                    <Timer theme='outline' size='20' />
                    <div>
                      <Text type='secondary'>Intervalo</Text>
                      <Title heading={5}>15 minutos</Title>
                    </div>
                  </div>
                </div>

                <Divider />

                <Button
                  icon={<Flashlamp theme='outline' size='16' />}
                  type='primary'
                  onClick={() => void handleForceCycle()}
                >
                  Forçar Ciclo Agora
                </Button>

                {cycleStatus?.state && Object.keys(cycleStatus.state).length > 0 && (
                  <>
                    <Divider />
                    <Text type='secondary'>Estado actual:</Text>
                    <pre className={styles.codeBlock}>
                      {JSON.stringify(cycleStatus.state, null, 2)}
                    </pre>
                  </>
                )}
              </Space>
            </Skeleton>
          </Card>

          {/* Bridge Controls */}
          <Card className={styles.section} bordered={false}>
            <div className={styles.sectionHeader}>
              <ManualGear theme='outline' size='20' />
              <Title heading={5}>Configurações</Title>
            </div>
            <Space direction='vertical' size='small' style={{ width: '100%' }}>
              <div className={styles.configRow}>
                <Text>Hermes Path</Text>
                <Text code>{bridgeStatus?.hermes_path || '—'}</Text>
              </div>
              <div className={styles.configRow}>
                <Text>RAG Path</Text>
                <Text code>{bridgeStatus?.rag_path || '—'}</Text>
              </div>
              <div className={styles.configRow}>
                <Text>Backup Dir</Text>
                <Text code>{bridgeStatus?.backup_dir || '—'}</Text>
              </div>
            </Space>
          </Card>
        </>
      )}
    </div>
  );
};

export default BianinhoPage;
