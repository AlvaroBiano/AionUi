/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from '@office-ai/platform';
import { initAllBridges } from '../bridge';
import { SqliteChannelRepository } from '@process/services/database/SqliteChannelRepository';
import { SqliteConversationRepository } from '@process/services/database/SqliteConversationRepository';
import { ConversationServiceImpl } from '@process/services/ConversationServiceImpl';
import { cronService } from '@process/services/cron/cronServiceSingleton';
import { workerTaskManager } from '@process/task/workerTaskManagerSingleton';
import { TeamSessionService, SqliteTeamRepository } from '@process/team';
import { initTeamGuideService } from '@process/team/mcp/guide/teamGuideSingleton';

logger.config({ print: true });

const repo = new SqliteConversationRepository();
const conversationServiceImpl = new ConversationServiceImpl(repo);
const channelRepo = new SqliteChannelRepository();
const teamRepo = new SqliteTeamRepository();
const teamSessionService = new TeamSessionService(teamRepo, workerTaskManager, conversationServiceImpl);

// 初始化所有IPC桥接
initAllBridges({
  conversationService: conversationServiceImpl,
  conversationRepo: repo,
  workerTaskManager,
  channelRepo,
  teamSessionService,
});

// Initialize cron service (load jobs from database and start timers)
void cronService.init().catch((error) => {
  console.error('[initBridge] Failed to initialize CronService:', error);
});

// Clean up stale preheat conversations left over from a previous process.
// After a restart the preheat agent processes are gone and the sessions cannot
// be recovered, so remove DB rows that still carry the preheat marker AND were
// created before this process started (i.e. older than PREHEAT_STALE_THRESHOLD_MS).
// Conversations created after app startup are live preheats from the current session
// and must not be deleted.
// Runs with a 5-second delay so it never blocks application startup.
const PROCESS_START_TIME = Date.now();
// Preheat conversations created more than 60 s before now are from a previous process.
const PREHEAT_STALE_THRESHOLD_MS = 60_000;

setTimeout(() => {
  void (async () => {
    try {
      const allConversations = await conversationServiceImpl.listAllConversations();
      const stalePreheats = allConversations.filter((c) => {
        if ((c.extra as Record<string, unknown> | undefined)?.preheat !== true) return false;
        // Keep preheats created within the current process lifetime
        const createTime = typeof c.createTime === 'number' ? c.createTime : 0;
        return PROCESS_START_TIME - createTime > PREHEAT_STALE_THRESHOLD_MS;
      });
      await Promise.all(stalePreheats.map((conv) => conversationServiceImpl.deleteConversation(conv.id)));
      if (stalePreheats.length > 0) {
        console.log(`[initBridge] Cleaned up ${stalePreheats.length} stale preheat conversation(s)`);
      }
    } catch (err) {
      console.warn('[initBridge] Failed to clean up stale preheat conversations', err);
    }
  })();
}, 5000);

// Start in-process Aion MCP server for team-guide tools (aion_create_team)
void initTeamGuideService(teamSessionService).catch((error) => {
  console.error('[initBridge] Failed to initialize TeamGuideMcpServer:', error);
});
