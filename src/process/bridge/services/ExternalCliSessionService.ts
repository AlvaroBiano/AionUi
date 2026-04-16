/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IExternalCliSession,
  IExternalCliSessionImportResult,
  IExternalCliSessionProvider,
  IImportExternalCliSessionParams,
} from '@/common/adapter/ipcBridge';
import type { TChatConversation, TProviderWithModel } from '@/common/config/storage';
import type { IConversationService } from '@process/services/IConversationService';
import fs from 'fs';
import fsp from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import readline from 'readline';

const DEFAULT_MAX_RESULTS_PER_PROVIDER = 20;
const MAX_PREVIEW_LINES = 24;

const normalizeTitle = (value: string | undefined, fallback: string): string => {
  const normalized = (value || '')
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.length > 96 ? `${normalized.slice(0, 93).trimEnd()}...` : normalized;
};

const getProviderFallbackTitle = (provider: IExternalCliSessionProvider, sessionId: string): string => {
  const name = provider === 'codex' ? 'Codex' : 'Claude';
  return `${name} ${sessionId.slice(0, 8)}`;
};

const toTimestamp = (value: string | number | undefined, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

const extractUserTextFromCodexRecord = (record: Record<string, unknown>): string | undefined => {
  if (record.type === 'event_msg') {
    const payload = record.payload as { type?: string; message?: string } | undefined;
    if (payload?.type === 'user_message' && typeof payload.message === 'string') {
      return payload.message;
    }
  }

  if (record.type === 'response_item') {
    const payload = record.payload as
      | {
          type?: string;
          role?: string;
          content?: Array<{ type?: string; text?: string }>;
        }
      | undefined;
    if (payload?.type === 'message' && payload.role === 'user' && Array.isArray(payload.content)) {
      const firstText = payload.content.find((item) => typeof item?.text === 'string')?.text;
      if (typeof firstText === 'string') {
        return firstText;
      }
    }
  }

  return undefined;
};

const extractUserTextFromClaudeRecord = (record: Record<string, unknown>): string | undefined => {
  if (record.type !== 'user') {
    return undefined;
  }

  const message = record.message as { role?: string; content?: string } | undefined;
  if (message?.role === 'user' && typeof message.content === 'string') {
    return message.content;
  }

  return undefined;
};

const isConversationMatchingSession = (
  conversation: TChatConversation,
  provider: IExternalCliSessionProvider,
  sessionId: string
): boolean => {
  if (conversation.type !== 'acp') {
    return false;
  }

  const extra = conversation.extra as { backend?: string; acpSessionId?: string } | undefined;
  return extra?.backend === provider && extra?.acpSessionId === sessionId;
};

type ExternalCliSessionServiceOptions = {
  codexRoot?: string;
  claudeProjectsRoot?: string;
  maxResultsPerProvider?: number;
};

export class ExternalCliSessionService {
  private readonly codexRoot: string;
  private readonly claudeProjectsRoot: string;
  private readonly maxResultsPerProvider: number;

  constructor(
    private readonly conversationService: IConversationService,
    options: ExternalCliSessionServiceOptions = {}
  ) {
    const home = homedir();
    this.codexRoot = options.codexRoot || path.join(home, '.codex', 'sessions');
    this.claudeProjectsRoot = options.claudeProjectsRoot || path.join(home, '.claude', 'projects');
    this.maxResultsPerProvider = options.maxResultsPerProvider || DEFAULT_MAX_RESULTS_PER_PROVIDER;
  }

  async listSessions(): Promise<IExternalCliSession[]> {
    const conversations = await this.conversationService.listAllConversations();
    const importedConversationIds = new Map<string, string>();

    conversations.forEach((conversation) => {
      if (conversation.type !== 'acp') {
        return;
      }

      const extra = conversation.extra as { backend?: string; acpSessionId?: string } | undefined;
      if (!extra?.backend || !extra.acpSessionId) {
        return;
      }

      if (extra.backend === 'codex' || extra.backend === 'claude') {
        importedConversationIds.set(`${extra.backend}:${extra.acpSessionId}`, conversation.id);
      }
    });

    const [codexSessions, claudeSessions] = await Promise.all([
      this.collectCodexSessions(importedConversationIds),
      this.collectClaudeSessions(importedConversationIds),
    ]);

    return [...codexSessions, ...claudeSessions]
      .toSorted((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, this.maxResultsPerProvider * 2);
  }

  async importSession(params: IImportExternalCliSessionParams): Promise<IExternalCliSessionImportResult> {
    const existing = await this.findExistingConversation(params.provider, params.sessionId);
    if (existing) {
      return { conversation: existing, created: false };
    }

    const sessions = await this.listSessions();
    const matchedSession = sessions.find(
      (session) => session.provider === params.provider && session.sessionId === params.sessionId
    );

    if (!matchedSession) {
      throw new Error(`CLI session not found: ${params.provider}:${params.sessionId}`);
    }

    const conversation = await this.conversationService.createConversation({
      type: 'acp',
      name: matchedSession.title,
      model: {} as TProviderWithModel,
      source: 'aionui',
      extra: {
        backend: matchedSession.provider,
        workspace: matchedSession.workspace || undefined,
        customWorkspace: Boolean(matchedSession.workspace),
        acpSessionId: matchedSession.sessionId,
        acpSessionUpdatedAt: matchedSession.updatedAt,
      },
    });

    const mergedExtra = {
      ...conversation.extra,
      backend: matchedSession.provider,
      workspace: matchedSession.workspace || conversation.extra?.workspace,
      customWorkspace: Boolean(matchedSession.workspace || conversation.extra?.workspace),
      acpSessionId: matchedSession.sessionId,
      acpSessionConversationId: conversation.id,
      acpSessionUpdatedAt: matchedSession.updatedAt,
    };

    await this.conversationService.updateConversation(
      conversation.id,
      {
        name: matchedSession.title,
        extra: mergedExtra,
      },
      true
    );

    const updatedConversation = await this.conversationService.getConversation(conversation.id);
    return {
      conversation:
        updatedConversation ||
        ({
          ...conversation,
          name: matchedSession.title,
          extra: mergedExtra,
        } as TChatConversation),
      created: true,
    };
  }

  private async findExistingConversation(
    provider: IExternalCliSessionProvider,
    sessionId: string
  ): Promise<TChatConversation | undefined> {
    const conversations = await this.conversationService.listAllConversations();
    return conversations.find((conversation) => isConversationMatchingSession(conversation, provider, sessionId));
  }

  private async collectCodexSessions(importedConversationIds: Map<string, string>): Promise<IExternalCliSession[]> {
    const files = await this.collectTranscriptFiles(this.codexRoot);
    const sessions = await Promise.all(
      files.slice(0, this.maxResultsPerProvider).map((file) => this.parseCodexSession(file, importedConversationIds))
    );
    return sessions.filter((session): session is IExternalCliSession => session !== null);
  }

  private async collectClaudeSessions(importedConversationIds: Map<string, string>): Promise<IExternalCliSession[]> {
    const files = await this.collectTranscriptFiles(this.claudeProjectsRoot);
    const sessions = await Promise.all(
      files.slice(0, this.maxResultsPerProvider).map((file) => this.parseClaudeSession(file, importedConversationIds))
    );
    return sessions.filter((session): session is IExternalCliSession => session !== null);
  }

  private async collectTranscriptFiles(root: string): Promise<string[]> {
    const foundFiles: Array<{ filePath: string; updatedAt: number }> = [];
    await this.walkDirectory(root, async (filePath) => {
      if (!filePath.endsWith('.jsonl')) {
        return;
      }

      try {
        const stat = await fsp.stat(filePath);
        foundFiles.push({ filePath, updatedAt: stat.mtimeMs });
      } catch {
        // Ignore race conditions while scanning active session directories.
      }
    });

    return foundFiles.toSorted((left, right) => right.updatedAt - left.updatedAt).map((item) => item.filePath);
  }

  private async walkDirectory(dirPath: string, onFile: (filePath: string) => Promise<void>): Promise<void> {
    let entries: Array<fs.Dirent>;
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await this.walkDirectory(fullPath, onFile);
          return;
        }

        if (entry.isFile()) {
          await onFile(fullPath);
        }
      })
    );
  }

  private async readPreviewLines(filePath: string): Promise<Record<string, unknown>[]> {
    const records: Record<string, unknown>[] = [];
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });

    try {
      for await (const line of reader) {
        if (!line.trim()) {
          continue;
        }

        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          records.push(parsed);
        } catch {
          // Ignore malformed lines from partially written active transcripts.
        }

        if (records.length >= MAX_PREVIEW_LINES) {
          break;
        }
      }
    } finally {
      reader.close();
      stream.close();
    }

    return records;
  }

  private async parseCodexSession(
    filePath: string,
    importedConversationIds: Map<string, string>
  ): Promise<IExternalCliSession | null> {
    const stat = await fsp.stat(filePath);
    const records = await this.readPreviewLines(filePath);
    const sessionMeta = records.find((record) => record.type === 'session_meta')?.payload as
      | {
          id?: string;
          cwd?: string;
          timestamp?: string;
        }
      | undefined;
    const sessionId = sessionMeta?.id;

    if (!sessionId) {
      return null;
    }

    const firstUserMessage = records.map(extractUserTextFromCodexRecord).find((value) => typeof value === 'string');
    const updatedAt = stat.mtimeMs;
    const createdAt = toTimestamp(sessionMeta?.timestamp, stat.birthtimeMs || updatedAt);
    const title = normalizeTitle(firstUserMessage, getProviderFallbackTitle('codex', sessionId));
    const importedConversationId = importedConversationIds.get(`codex:${sessionId}`);

    return {
      id: `codex:${sessionId}`,
      provider: 'codex',
      sessionId,
      title,
      workspace: sessionMeta?.cwd || '',
      transcriptPath: filePath,
      createdAt,
      updatedAt,
      importedConversationId,
    };
  }

  private async parseClaudeSession(
    filePath: string,
    importedConversationIds: Map<string, string>
  ): Promise<IExternalCliSession | null> {
    const stat = await fsp.stat(filePath);
    const records = await this.readPreviewLines(filePath);
    const firstMessageRecord = records.find((record) => typeof record.sessionId === 'string');
    const sessionId = (firstMessageRecord?.sessionId as string | undefined) || path.basename(filePath, '.jsonl');

    if (!sessionId) {
      return null;
    }

    const firstUserMessage = records.map(extractUserTextFromClaudeRecord).find((value) => typeof value === 'string');
    const workspace = (firstMessageRecord?.cwd as string | undefined) || '';
    const createdAt = toTimestamp(
      firstMessageRecord?.timestamp as string | undefined,
      stat.birthtimeMs || stat.mtimeMs
    );
    const updatedAt = stat.mtimeMs;
    const title = normalizeTitle(firstUserMessage, getProviderFallbackTitle('claude', sessionId));
    const importedConversationId = importedConversationIds.get(`claude:${sessionId}`);

    return {
      id: `claude:${sessionId}`,
      provider: 'claude',
      sessionId,
      title,
      workspace,
      transcriptPath: filePath,
      createdAt,
      updatedAt,
      importedConversationId,
    };
  }
}
