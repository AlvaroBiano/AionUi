/**
 * MemoryVisualizerPage — Visualizador de memória sobre Álvaro por tópico
 * Suporta: listar por tópico, adicionar, editar, eliminar, exportar
 * @license Apache-2.0
 */

import {
  Badge,
  Button,
  Card,
  Dropdown,
  Empty,
  Input,
  Menu,
  Message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography,
} from '@arco-design/web-react';
import {
  Brain,
  Check,
  Delete,
  Download,
  Edit,
  Plus,
  Refresh,
  Search,
  Tag as TagIcon,
} from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './index.module.css';

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

// ── Arco Design Notification ──────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-var-requires
const $notify = require('@arco-design/web-react').Notification;

// ── Types ──────────────────────────────────────────────────

interface MemoryEntry {
  id: string;
  topic: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface MemoryTopic {
  name: string;
  count: number;
  color: string;
}

// ── Constants ──────────────────────────────────────────────

const TOPIC_COLORS: Record<string, string> = {
  pessoal: 'arcoblue',
  profissional: 'green',
  projetos: 'orange',
  preferências: 'pink',
  histórico: 'purple',
  contactos: 'red',
  notas: 'teal',
  default: 'gray',
};

const DEFAULT_TOPICS = [
  { name: 'pessoal', label: 'Pessoal' },
  { name: 'profissional', label: 'Profissional' },
  { name: 'projetos', label: 'Projetos' },
  { name: 'preferências', label: 'Preferências' },
  { name: 'histórico', label: 'Histórico' },
  { name: 'contactos', label: 'Contactos' },
  { name: 'notas', label: 'Notas' },
];

const STORAGE_KEY = 'alvaro_memory_entries';

// ── Helpers ────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return dateStr;
  }
}

function topicColor(topic: string): string {
  return TOPIC_COLORS[topic] || TOPIC_COLORS.default;
}

function topicLabel(topic: string): string {
  const found = DEFAULT_TOPICS.find((t) => t.name === topic);
  return found ? found.label : topic.charAt(0).toUpperCase() + topic.slice(1);
}

function loadEntries(): MemoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch { /* ignore */ }
  return [];
}

function saveEntries(entries: MemoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch { /* ignore */ }
}

// ── Main Component ────────────────────────────────────────

const MemoryVisualizerPage: React.FC = () => {
  const { t } = useTranslation();

  // ── State ───────────────────────────────────────────────
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTopic, setSelectedTopic] = useState<string>('all');
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<MemoryEntry | null>(null);
  const [editForm, setEditForm] = useState({ topic: 'pessoal', content: '', tags: '' });
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm, setAddForm] = useState({ topic: 'pessoal', content: '', tags: '' });

  // ── Data fetching ───────────────────────────────────────

  const fetchEntries = useCallback(() => {
    setLoading(true);
    try {
      const data = loadEntries();
      setEntries(data);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  // ── Computed ────────────────────────────────────────────

  const topics: MemoryTopic[] = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of entries) {
      counts[entry.topic] = (counts[entry.topic] || 0) + 1;
    }
    return DEFAULT_TOPICS.filter((tp) => counts[tp.name] > 0)
      .map((tp) => ({ name: tp.name, count: counts[tp.name], color: TOPIC_COLORS[tp.name] }))
      .sort((a, b) => b.count - a.count);
  }, [entries]);

  const filteredEntries = React.useMemo(() => {
    let result = entries;
    if (selectedTopic !== 'all') {
      result = result.filter((e) => e.topic === selectedTopic);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.content.toLowerCase().includes(q) ||
          e.tags.some((tag) => tag.toLowerCase().includes(q)) ||
          e.topic.toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [entries, selectedTopic, searchQuery]);

  // ── Actions ─────────────────────────────────────────────

  const handleAdd = useCallback(() => {
    if (!addForm.content.trim()) {
      $notify.error({ title: 'Erro', content: 'Conteúdo não pode estar vazio' });
      return;
    }
    const now = new Date().toISOString();
    const newEntry: MemoryEntry = {
      id: generateId(),
      topic: addForm.topic,
      content: addForm.content.trim(),
      tags: addForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
      createdAt: now,
      updatedAt: now,
    };
    const updated = [newEntry, ...entries];
    saveEntries(updated);
    setEntries(updated);
    setAddModalOpen(false);
    setAddForm({ topic: 'pessoal', content: '', tags: '' });
    $notify.success({ title: 'Sucesso', content: 'Entrada adicionada' });
  }, [addForm, entries]);

  const handleEdit = useCallback(() => {
    if (!editEntry) return;
    if (!editForm.content.trim()) {
      $notify.error({ title: 'Erro', content: 'Conteúdo não pode estar vazio' });
      return;
    }
    const updated: MemoryEntry = {
      ...editEntry,
      topic: editForm.topic,
      content: editForm.content.trim(),
      tags: editForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
      updatedAt: new Date().toISOString(),
    };
    const newEntries = entries.map((e) => (e.id === editEntry.id ? updated : e));
    saveEntries(newEntries);
    setEntries(newEntries);
    setEditModalOpen(false);
    setEditEntry(null);
    $notify.success({ title: 'Sucesso', content: 'Entrada atualizada' });
  }, [editEntry, editForm, entries]);

  const handleDelete = useCallback(
    (id: string) => {
      const newEntries = entries.filter((e) => e.id !== id);
      saveEntries(newEntries);
      setEntries(newEntries);
      $notify.success({ title: 'Sucesso', content: 'Entrada eliminada' });
    },
    [entries]
  );

  const handleExportTopic = useCallback(
    (topic: string) => {
      const topicEntries = entries.filter((e) => e.topic === topic);
      const json = JSON.stringify(topicEntries, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `alvaro_memory_${topic}_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      $notify.success({ title: 'Exportado', content: `Tópico "${topicLabel(topic)}" exportado` });
    },
    [entries]
  );

  const handleExportAll = useCallback(() => {
    const json = JSON.stringify(entries, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alvaro_memory_full_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    $notify.success({ title: 'Exportado', content: 'Todas as memórias exportadas' });
  }, [entries]);

  const openEditModal = useCallback((entry: MemoryEntry) => {
    setEditEntry(entry);
    setEditForm({
      topic: entry.topic,
      content: entry.content,
      tags: entry.tags.join(', '),
    });
    setEditModalOpen(true);
  }, []);

  // ── Render helpers ───────────────────────────────────────

  const renderTopicBadge = (topic: string, count?: number) => (
    <Tag color={topicColor(topic)} className={styles.topicTag}>
      {topicLabel(topic)} {count != null ? `(${count})` : ''}
    </Tag>
  );

  const renderEntryCard = (entry: MemoryEntry) => (
    <Card
      key={entry.id}
      className={styles.entryCard}
      bordered={false}
      hoverable
      actions={[
        <Button key='edit' icon={<Edit theme='outline' size={14} />} size='mini' type='text' onClick={() => openEditModal(entry)}>
          Editar
        </Button>,
        <Popconfirm
          key='delete'
          title='Eliminar entrada?'
          onOk={() => handleDelete(entry.id)}
          cancelText='Cancelar'
          okText='Eliminar'
        >
          <Button icon={<Delete theme='outline' size={14} />} size='mini' type='text' status='danger'>
            Eliminar
          </Button>
        </Popconfirm>,
      ]}
    >
      <div className={styles.entryHeader}>
        {renderTopicBadge(entry.topic)}
        <Text type='secondary' className={styles.entryDate}>
          {formatDate(entry.updatedAt)}
        </Text>
      </div>
      <Paragraph className={styles.entryContent}>{entry.content}</Paragraph>
      {entry.tags.length > 0 && (
        <div className={styles.entryTags}>
          <TagIcon theme='outline' size={12} />
          {entry.tags.map((tag) => (
            <Tag key={tag} size='small'>
              {tag}
            </Tag>
          ))}
        </div>
      )}
    </Card>
  );

  // ── Render ─────────────────────────────────────────────

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Brain theme='outline' size='28' fill='currentColor' />
          <Title heading={3} className={styles.headerTitle}>
            Memória — Álvaro
          </Title>
          <Badge count={entries.length} maxCount={999} />
        </div>
        <Space>
          <Button icon={<Refresh theme='outline' size={16} />} onClick={() => void fetchEntries()}>
            Atualizar
          </Button>
          <Button icon={<Download theme='outline' size={16} />} onClick={() => void handleExportAll()}>
            Exportar Tudo
          </Button>
          <Button icon={<Plus theme='outline' size={16} />} type='primary' onClick={() => setAddModalOpen(true)}>
            Adicionar
          </Button>
        </Space>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <Input
          prefix={<Search theme='outline' size={16} />}
          placeholder='Pesquisar memórias...'
          value={searchQuery}
          onChange={setSearchQuery}
          className={styles.searchInput}
          allowClear
        />
        <Select
          placeholder='Filtrar por tópico'
          value={selectedTopic}
          onChange={setSelectedTopic}
          className={styles.topicFilter}
          allowClear
        >
          <Select.Option value='all'>Todos os tópicos</Select.Option>
          {DEFAULT_TOPICS.map((tp) => (
            <Select.Option key={tp.name} value={tp.name}>
              {tp.label}
            </Select.Option>
          ))}
        </Select>
      </div>

      {/* Topics summary */}
      {topics.length > 0 && (
        <div className={styles.topicsRow}>
          {topics.map((topic) => (
            <Dropdown
              key={topic.name}
              trigger='hover'
              droplist={
                <Menu>
                  <Menu.Item key='export' onClick={() => handleExportTopic(topic.name)}>
                    Exportar {topicLabel(topic.name)}
                  </Menu.Item>
                </Menu>
              }
            >
              <Tag color={topic.color} className={styles.topicBadge} style={{ cursor: 'pointer' }}>
                {topicLabel(topic.name)} ({topic.count})
              </Tag>
            </Dropdown>
          ))}
        </div>
      )}

      {/* Entries list */}
      <div className={styles.entries}>
        {loading ? (
          <Empty description='A carregar...' />
        ) : filteredEntries.length === 0 ? (
          <Empty
            description={
              searchQuery || selectedTopic !== 'all'
                ? 'Nenhuma memória encontrada'
                : 'Nenhuma memória registrada. Clique em "Adicionar" para criar a primeira.'
            }
          />
        ) : (
          <div className={styles.entriesGrid}>{filteredEntries.map(renderEntryCard)}</div>
        )}
      </div>

      {/* Add Modal */}
      <Modal title='Adicionar Memória' visible={addModalOpen} onCancel={() => setAddModalOpen(false)} footer={null} unmountOnExit>
        <div className={styles.modalForm}>
          <div className={styles.formGroup}>
            <Text type='secondary'>Tópico</Text>
            <Select value={addForm.topic} onChange={(v) => setAddForm((f) => ({ ...f, topic: v }))} style={{ width: '100%' }}>
              {DEFAULT_TOPICS.map((tp) => (
                <Select.Option key={tp.name} value={tp.name}>
                  {tp.label}
                </Select.Option>
              ))}
            </Select>
          </div>
          <div className={styles.formGroup}>
            <Text type='secondary'>Conteúdo</Text>
            <TextArea rows={4} value={addForm.content} onChange={(v) => setAddForm((f) => ({ ...f, content: v }))} placeholder='Descreva a memória...' />
          </div>
          <div className={styles.formGroup}>
            <Text type='secondary'>Tags (separadas por vírgula)</Text>
            <Input
              value={addForm.tags}
              onChange={(v) => setAddForm((f) => ({ ...f, tags: v }))}
              placeholder='ex: importante, trabalho, ideia'
            />
          </div>
          <div className={styles.modalActions}>
            <Button onClick={() => setAddModalOpen(false)}>Cancelar</Button>
            <Button type='primary' icon={<Check theme='outline' size={14} />} onClick={() => void handleAdd()}>
              Guardar
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal
        title='Editar Memória'
        visible={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        footer={null}
        unmountOnExit
      >
        <div className={styles.modalForm}>
          <div className={styles.formGroup}>
            <Text type='secondary'>Tópico</Text>
            <Select
              value={editForm.topic}
              onChange={(v) => setEditForm((f) => ({ ...f, topic: v }))}
              style={{ width: '100%' }}
            >
              {DEFAULT_TOPICS.map((tp) => (
                <Select.Option key={tp.name} value={tp.name}>
                  {tp.label}
                </Select.Option>
              ))}
            </Select>
          </div>
          <div className={styles.formGroup}>
            <Text type='secondary'>Conteúdo</Text>
            <TextArea
              rows={4}
              value={editForm.content}
              onChange={(v) => setEditForm((f) => ({ ...f, content: v }))}
              placeholder='Descreva a memória...'
            />
          </div>
          <div className={styles.formGroup}>
            <Text type='secondary'>Tags (separadas por vírgula)</Text>
            <Input
              value={editForm.tags}
              onChange={(v) => setEditForm((f) => ({ ...f, tags: v }))}
              placeholder='ex: importante, trabalho, ideia'
            />
          </div>
          <div className={styles.modalActions}>
            <Button onClick={() => setEditModalOpen(false)}>Cancelar</Button>
            <Button type='primary' icon={<Check theme='outline' size={14} />} onClick={() => void handleEdit()}>
              Guardar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default MemoryVisualizerPage;
