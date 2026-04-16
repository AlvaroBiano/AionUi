/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation, TProviderWithModel } from '../../../../src/common/config/storage';
import type { IConversationService } from '../../../../src/process/services/IConversationService';
import { ExternalCliSessionService } from '../../../../src/process/bridge/services/ExternalCliSessionService';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const makeConversation = (overrides: Partial<TChatConversation> = {}): TChatConversation => ({
  id: 'conv-1',
  name: 'Imported Session',
  type: 'acp',
  extra: {
    backend: 'codex',
    workspace: '/tmp/workspace',
    customWorkspace: true,
    acpSessionId: 'session-codex-1',
    acpSessionConversationId: 'conv-1',
  },
  createTime: Date.now(),
  modifyTime: Date.now(),
  ...overrides,
});

describe('ExternalCliSessionService', () => {
  let tempRoot: string;
  let codexRoot: string;
  let claudeRoot: string;
  let conversations: TChatConversation[];
  let conversationService: IConversationService;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aionui-cli-sessions-'));
    codexRoot = path.join(tempRoot, 'codex', 'sessions');
    claudeRoot = path.join(tempRoot, 'claude', 'projects');
    await fs.mkdir(path.join(codexRoot, '2026', '04', '16'), { recursive: true });
    await fs.mkdir(path.join(claudeRoot, 'demo-workspace'), { recursive: true });

    const codexFile = path.join(codexRoot, '2026', '04', '16', 'rollout-codex.jsonl');
    await fs.writeFile(
      codexFile,
      [
        JSON.stringify({
          type: 'session_meta',
          payload: {
            id: 'session-codex-1',
            cwd: '/tmp/codex-workspace',
            timestamp: '2026-04-16T10:00:00.000Z',
          },
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'Fix flaky sidebar jitter when creating a new chat',
          },
        }),
      ].join('\n')
    );

    const claudeFile = path.join(claudeRoot, 'demo-workspace', 'session-claude-1.jsonl');
    await fs.writeFile(
      claudeFile,
      [
        JSON.stringify({
          type: 'user',
          sessionId: 'session-claude-1',
          cwd: '/tmp/claude-workspace',
          timestamp: '2026-04-16T09:00:00.000Z',
          message: {
            role: 'user',
            content: 'Continue the CLI session inside AionUi',
          },
        }),
      ].join('\n')
    );

    conversations = [makeConversation()];

    const createConversation = vi.fn(async (params) =>
      makeConversation({
        id: 'conv-created',
        name: params.name || 'Imported',
        extra: {
          backend: params.extra.backend || 'codex',
          workspace: params.extra.workspace,
          customWorkspace: params.extra.customWorkspace,
          acpSessionId: params.extra.acpSessionId as string | undefined,
        },
      })
    );
    const updateConversation = vi.fn(async () => {});
    const getConversation = vi.fn(async (id: string) =>
      id === 'conv-created'
        ? makeConversation({
            id,
            name: 'Continue the CLI session inside AionUi',
            extra: {
              backend: 'claude',
              workspace: '/tmp/claude-workspace',
              customWorkspace: true,
              acpSessionId: 'session-claude-1',
              acpSessionConversationId: id,
            },
          })
        : undefined
    );

    conversationService = {
      createConversation,
      deleteConversation: vi.fn(async () => {}),
      updateConversation,
      getConversation,
      createWithMigration: vi.fn(async () => makeConversation()),
      listAllConversations: vi.fn(async () => conversations),
      getConversationsByCronJob: vi.fn(async () => []),
    } satisfies IConversationService;
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('lists codex and claude sessions and marks already imported conversations', async () => {
    const service = new ExternalCliSessionService(conversationService, {
      codexRoot,
      claudeProjectsRoot: claudeRoot,
      maxResultsPerProvider: 5,
    });

    const sessions = await service.listSessions();

    expect(sessions).toHaveLength(2);

    const codexSession = sessions.find((session) => session.provider === 'codex');
    const claudeSession = sessions.find((session) => session.provider === 'claude');

    expect(codexSession).toMatchObject({
      provider: 'codex',
      sessionId: 'session-codex-1',
      importedConversationId: 'conv-1',
      workspace: '/tmp/codex-workspace',
    });
    expect(claudeSession).toMatchObject({
      provider: 'claude',
      sessionId: 'session-claude-1',
      workspace: '/tmp/claude-workspace',
    });
  });

  it('reuses an existing imported conversation when the session is already linked', async () => {
    const service = new ExternalCliSessionService(conversationService, {
      codexRoot,
      claudeProjectsRoot: claudeRoot,
      maxResultsPerProvider: 5,
    });

    const result = await service.importSession({
      provider: 'codex',
      sessionId: 'session-codex-1',
    });

    expect(result.created).toBe(false);
    expect(result.conversation.id).toBe('conv-1');
    expect(vi.mocked(conversationService.createConversation)).not.toHaveBeenCalled();
  });

  it('creates and links a new AionUi conversation for an unimported CLI session', async () => {
    conversations = [];
    vi.mocked(conversationService.listAllConversations).mockImplementation(async () => conversations);

    const service = new ExternalCliSessionService(conversationService, {
      codexRoot,
      claudeProjectsRoot: claudeRoot,
      maxResultsPerProvider: 5,
    });

    const result = await service.importSession({
      provider: 'claude',
      sessionId: 'session-claude-1',
    });

    expect(result.created).toBe(true);
    expect(vi.mocked(conversationService.createConversation)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'acp',
        name: 'Continue the CLI session inside AionUi',
        model: expect.any(Object) as unknown as TProviderWithModel,
        extra: expect.objectContaining({
          backend: 'claude',
          workspace: '/tmp/claude-workspace',
          customWorkspace: true,
          acpSessionId: 'session-claude-1',
        }),
      })
    );
    expect(vi.mocked(conversationService.updateConversation)).toHaveBeenCalledWith(
      'conv-created',
      expect.objectContaining({
        extra: expect.objectContaining({
          acpSessionConversationId: 'conv-created',
          acpSessionId: 'session-claude-1',
        }),
      }),
      true
    );
    expect(result.conversation.id).toBe('conv-created');
  });
});
