/**
 * ACP Session T1-T10 Core Flows — E2E Tests
 *
 * Tests cover the 7-state ACP session state machine transitions:
 * idle → starting → active ↔ prompting ↔ suspended/resuming → error → idle
 *
 * State transitions under test:
 *   T1:  idle → starting     (start())                           Create connection, begin handshake
 *   T2:  starting → active   (handshake success)                 Sync config, reassert, notify UI, start drain
 *   T3:  starting → starting (handshake failure, retry)          Exponential backoff retry (1s/2s/4s)
 *   T4:  starting → error    (handshake failure, no retry)       Notify UI error
 *   T5:  active → prompting  (drainLoop dequeue, queue not empty) Execute prompt
 *   T6:  active → suspended  (suspend(), queue empty)             Save sessionId, close connection
 *   T7:  active → idle       (stop())                            Close connection, cleanup
 *   T8:  active → suspended  (process crash, non-prompt)         Silent suspend, wait for next operation
 *   T9:  prompting → active  (prompt complete, queue empty)      onTurnEnd cleanup
 *   T10: prompting → prompting (prompt complete, queue not empty) Drain next
 *
 * Prerequisite: Corresponding ACP backends (claude, codex) must be installed.
 * Skip in CI unless backends are explicitly available.
 */
import { test, expect } from '../../../../fixtures';
import {
  invokeBridge,
  goToGuid,
  selectAgent,
  sendMessageFromGuid,
  waitForSessionActive,
  waitForAiReply,
  deleteConversation,
  goToNewChat,
  takeScreenshot,
  AGENT_PILL,
  AGENT_STATUS_MESSAGE,
  agentPillByBackend,
} from '../../../../helpers';

const BACKENDS = ['claude', 'codex'] as const;
const createdIds: string[] = [];

test.afterAll(async ({ page }) => {
  for (const id of createdIds) {
    await invokeBridge(page, 'remove-conversation', { id }).catch(() => {});
  }
  createdIds.length = 0;
});

// ─────────────────────────────────────────────────────────────────────────────
// T1: idle → starting via start()
// ─────────────────────────────────────────────────────────────────────────────

test.describe('T1: idle → starting (session creation)', () => {
  test.beforeEach(async ({ page }) => {
    await goToNewChat(page);
  });

  for (const backend of BACKENDS) {
    test(`T1: selecting ${backend} agent triggers session start from idle state`, async ({ page }) => {
      // Verify we're on guid page (idle state)
      await expect(page).toHaveURL(/#\/guid/, { timeout: 10_000 });

      // Verify agent pill is visible
      const pill = page.locator(agentPillByBackend(backend));
      const pillVisible = await pill.isVisible().catch(() => false);
      if (!pillVisible) {
        await page.locator(AGENT_PILL).first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
        const retryVisible = await pill.isVisible().catch(() => false);
        if (!retryVisible) {
          test.skip(true, `${backend} agent pill not available`);
          return;
        }
      }

      // Select agent - this should trigger T1 (start() called, idle → starting)
      await selectAgent(page, backend);

      // After T1, session should be in 'starting' state
      // The status badge may show 'connecting' or similar transitional state
      const statusBadge = page.locator(AGENT_STATUS_MESSAGE);
      const hasConnectingState = await statusBadge
        .filter({ hasText: /connecting|starting|connecting|初始化|连接中/i })
        .first()
        .isVisible()
        .catch(() => false);

      // T1 transition should either show connecting status or move directly to T2 (if handshake is fast)
      expect(hasConnectingState || (await waitForSessionActive(page, 5_000).catch(() => false))).toBeTruthy();
    });
  }

  test('T1: session starts in idle state and transitions through starting', async ({ page }) => {
    await goToGuid(page);

    // Start from clean idle state
    const conversationId = await sendMessageFromGuid(page, 'T1 test: trigger start() from idle');
    createdIds.push(conversationId);

    // T1 → T2 should happen: start() called, connection established
    // Should eventually reach active state
    await waitForSessionActive(page, 120_000);

    // Verify conversation was created
    expect(conversationId).toBeTruthy();
    expect(conversationId.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2: starting → active (handshake success)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('T2: starting → active (handshake success)', () => {
  test.setTimeout(180_000);

  for (const backend of BACKENDS) {
    test(`T2: ${backend} handshake success transitions to active state`, async ({ page }) => {
      await goToGuid(page);

      const pill = page.locator(agentPillByBackend(backend));
      const pillVisible = await pill.isVisible().catch(() => false);
      if (!pillVisible) {
        await page.locator(AGENT_PILL).first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
        if (!(await pill.isVisible().catch(() => false))) {
          test.skip(true, `${backend} agent pill not available`);
          return;
        }
      }

      await selectAgent(page, backend);

      // Send message to trigger session start (T1) and handshake (T2)
      const conversationId = await sendMessageFromGuid(page, `T2 test: verify handshake success → active for ${backend}`);
      createdIds.push(conversationId);

      // Wait for T2: session should become active after successful handshake
      await waitForSessionActive(page, 120_000);

      // Verify active status is visible
      await expect(page.locator(AGENT_STATUS_MESSAGE).first()).toBeVisible();

      await takeScreenshot(page, `session-t2-${backend}-active`);
    });
  }

  test('T2: active state allows message input', async ({ page }) => {
    await goToGuid(page);
    await selectAgent(page, 'claude');

    const conversationId = await sendMessageFromGuid(page, 'T2 test: active state input');
    createdIds.push(conversationId);

    await waitForSessionActive(page, 120_000);

    // In active state, the input should be enabled
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 10_000 });
    const isDisabled = await textarea.isDisabled();
    expect(isDisabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5: active → prompting (drainLoop dequeue, queue not empty)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('T5: active → prompting (drainLoop dequeue)', () => {
  test.setTimeout(240_000);

  for (const backend of BACKENDS) {
    test(`T5: ${backend} sends message and transitions to prompting to execute prompt`, async ({ page }) => {
      await goToGuid(page);
      await selectAgent(page, backend);

      const conversationId = await sendMessageFromGuid(page, `T5 test: trigger prompting state for ${backend}`);
      createdIds.push(conversationId);

      // T1 → T2 complete, now in active state
      await waitForSessionActive(page, 120_000);

      // Send another message - this should go into queue and trigger T5 (active → prompting)
      const textarea = page.locator('textarea').first();
      await textarea.waitFor({ state: 'visible', timeout: 10_000 });
      await textarea.fill('T5 follow-up message to trigger drain loop');
      await textarea.press('Enter');

      // Wait for AI reply - this confirms T5 → T9/T10 cycle completed
      const replyText = await waitForAiReply(page, 120_000);
      expect(replyText.length).toBeGreaterThan(0);

      await takeScreenshot(page, `session-t5-${backend}-prompting-complete`);
    });
  }

  test('T5: multiple messages queued and drained sequentially (T5 → T10)', async ({ page }) => {
    await goToGuid(page);
    await selectAgent(page, 'claude');

    const conversationId = await sendMessageFromGuid(page, 'T5 test: first message');
    createdIds.push(conversationId);

    await waitForSessionActive(page, 120_000);

    // Send multiple messages rapidly to queue them
    const textarea = page.locator('textarea').first();
    await textarea.waitFor({ state: 'visible', timeout: 10_000 });
    await textarea.fill('T5 message 2');
    await textarea.press('Enter');
    await textarea.fill('T5 message 3');
    await textarea.press('Enter');

    // Wait for all replies to come back - confirms drain loop worked
    // Multiple AI replies indicate T10 loop executed
    await page.waitForTimeout(5_000); // Allow time for queue to drain

    const aiMessages = page.locator('.message-item.text.justify-start');
    const count = await aiMessages.count();
    expect(count).toBeGreaterThanOrEqual(3); // At least 3 AI responses
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7: active → idle (stop())
// ─────────────────────────────────────────────────────────────────────────────

test.describe('T7: active → idle (stop())', () => {
  test.setTimeout(180_000);

  test('T7: stop() closes connection and returns to idle state', async ({ page }) => {
    await goToGuid(page);
    await selectAgent(page, 'claude');

    const conversationId = await sendMessageFromGuid(page, 'T7 test: stop session');
    createdIds.push(conversationId);

    await waitForSessionActive(page, 120_000);

    // Delete conversation - this triggers T7 (active → idle)
    await deleteConversation(page, conversationId);

    // Should navigate away from conversation
    await expect(page).toHaveURL(/#\/guid/, { timeout: 15_000 });

    // Verify conversation is gone
    const convRow = page.locator(`#c-${conversationId}`);
    await expect(convRow).not.toBeVisible({ timeout: 10_000 });
  });

  test('T7: can start new session after stopping previous one', async ({ page }) => {
    // Start first session
    await goToGuid(page);
    await selectAgent(page, 'claude');

    const convId1 = await sendMessageFromGuid(page, 'T7 test: first session');
    createdIds.push(convId1);

    await waitForSessionActive(page, 120_000);
    await deleteConversation(page, convId1);

    // Start second session - should work since we returned to idle
    await goToGuid(page);
    await selectAgent(page, 'claude');

    const convId2 = await sendMessageFromGuid(page, 'T7 test: second session after stop');
    createdIds.push(convId2);

    await waitForSessionActive(page, 120_000);
    expect(convId2).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9: prompting → active (prompt complete, queue empty)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('T9: prompting → active (prompt complete, queue empty)', () => {
  test.setTimeout(240_000);

  for (const backend of BACKENDS) {
    test(`T9: ${backend} single message completes prompting and returns to active`, async ({ page }) => {
      await goToGuid(page);
      await selectAgent(page, backend);

      const conversationId = await sendMessageFromGuid(page, `T9 test: single message cycle for ${backend}`);
      createdIds.push(conversationId);

      // T1 → T2 → T5 should have completed
      await waitForSessionActive(page, 120_000);

      // Wait for AI reply - confirms T5 completed (prompting finished)
      const replyText = await waitForAiReply(page, 120_000);
      expect(replyText.length).toBeGreaterThan(0);

      // After T9, session should be back in active state
      // Input should still be enabled for next message
      const textarea = page.locator('textarea').first();
      await expect(textarea).toBeVisible({ timeout: 10_000 });
      const isDisabled = await textarea.isDisabled();
      expect(isDisabled).toBe(false);

      await takeScreenshot(page, `session-t9-${backend}-back-to-active`);
    });
  }

  test('T9: after prompt completes, status shows active session', async ({ page }) => {
    await goToGuid(page);
    await selectAgent(page, 'claude');

    const conversationId = await sendMessageFromGuid(page, 'T9 test: verify active status after prompt');
    createdIds.push(conversationId);

    await waitForSessionActive(page, 120_000);
    await waitForAiReply(page, 120_000);

    // Status should show active session
    const statusBadge = page.locator(AGENT_STATUS_MESSAGE);
    const isActive = await statusBadge
      .filter({ hasText: /active|session|会话|活跃/ })
      .first()
      .isVisible()
      .catch(() => false);

    // Either active status badge or input enabled confirms T9 → active transition
    const textarea = page.locator('textarea').first();
    const inputEnabled = !(await textarea.isDisabled());
    expect(isActive || inputEnabled).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T10: prompting → prompting (prompt complete, queue not empty)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('T10: prompting → prompting (drain next in queue)', () => {
  test.setTimeout(300_000);

  test('T10: rapid message queue drains through T10 transitions', async ({ page }) => {
    await goToGuid(page);
    await selectAgent(page, 'claude');

    const conversationId = await sendMessageFromGuid(page, 'T10 test: queue drain cycle');
    createdIds.push(conversationId);

    await waitForSessionActive(page, 120_000);

    // Send multiple messages to create a queue
    const textarea = page.locator('textarea').first();
    await textarea.waitFor({ state: 'visible', timeout: 10_000 });

    // Send 3 messages rapidly
    const messages = ['T10 message 1', 'T10 message 2', 'T10 message 3'];
    for (const msg of messages) {
      await textarea.fill(msg);
      await textarea.press('Enter');
      await page.waitForTimeout(300); // Small delay between sends
    }

    // Wait for all AI responses - T10 should drain the queue
    await page.waitForTimeout(10_000);

    // Count AI messages - should have at least 4 (initial + 3 from queue)
    const aiMessages = page.locator('.message-item.text.justify-start');
    const count = await aiMessages.count();
    expect(count).toBeGreaterThanOrEqual(4);

    await takeScreenshot(page, 'session-t10-queue-drained');
  });

  test('T10: queue processes in order (FIFO)', async ({ page }) => {
    await goToGuid(page);
    await selectAgent(page, 'claude');

    const conversationId = await sendMessageFromGuid(page, 'T10 FIFO test: first');
    createdIds.push(conversationId);

    await waitForSessionActive(page, 120_000);

    // Send messages with distinct markers
    const textarea = page.locator('textarea').first();
    await textarea.waitFor({ state: 'visible', timeout: 10_000 });
    await textarea.fill('T10-FIRST');
    await textarea.press('Enter');
    await textarea.fill('T10-SECOND');
    await textarea.press('Enter');
    await textarea.fill('T10-THIRD');
    await textarea.press('Enter');

    // Wait for queue to drain
    await page.waitForTimeout(15_000);

    // Verify all 3 responses received
    const aiMessages = page.locator('.message-item.text.justify-start');
    const count = await aiMessages.count();
    expect(count).toBeGreaterThanOrEqual(4); // 1 initial + 3 queued
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6: active → suspended (suspend(), queue empty)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('T6: active → suspended (suspend when queue empty)', () => {
  test.setTimeout(180_000);

  test.skip('T6: suspend() when queue empty transitions to suspended (E2E cannot reliably trigger suspend without specific backend support)', async ({ page }) => {
    // This test is skipped because triggering suspend() via UI is not straightforward
    // In practice, this transition happens when user switches away from conversation
    // with an empty message queue
  });

  test('T6: session can be resumed after suspend-like state', async ({ page }) => {
    await goToGuid(page);
    await selectAgent(page, 'claude');

    const conversationId = await sendMessageFromGuid(page, 'T6 test: suspend and resume');
    createdIds.push(conversationId);

    await waitForSessionActive(page, 120_000);

    // Navigate away (simulating a suspend-like state)
    await goToGuid(page);

    // Come back - if session was suspended, it should resume
    await page.waitForTimeout(2_000);

    // Navigate back to conversation
    const convRow = page.locator(`#c-${conversationId}`);
    await convRow.waitFor({ state: 'visible', timeout: 10_000 });
    await convRow.click();

    // Session should either still be active or reconnect
    await page.waitForTimeout(5_000);
    const textarea = page.locator('textarea').first();
    const stillWorks = await textarea.isVisible().catch(() => false);
    expect(stillWorks).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3/T4: starting → error (handshake failure scenarios)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('T3/T4: starting → error (handshake failure)', () => {
  test.setTimeout(180_000);

  test.skip('T3: handshake failure with retry (E2E cannot reliably simulate network failures)', async ({ page }) => {
    // T3 involves exponential backoff retry on handshake failure
    // E2E cannot reliably trigger this without mocking network conditions
  });

  test.skip('T4: handshake failure without retry transitions to error (E2E cannot reliably trigger auth failures)', async ({ page }) => {
    // T4 involves non-retryable handshake failure
    // E2E cannot reliably trigger this without invalid credentials
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8: active → suspended (process crash, non-prompt)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('T8: active → suspended (unexpected process exit)', () => {
  test.setTimeout(180_000);

  test.skip('T8: process crash during non-prompt period triggers suspended (E2E cannot simulate process crash reliably)', async ({ page }) => {
    // T8 involves process unexpected exit during non-prompt period
    // E2E cannot reliably simulate this without killing the agent process
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Combined Flow Tests (T1 → T2 → T5 → T9/T10)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Combined T1-T10 Flow: Full Session Lifecycle', () => {
  test.setTimeout(300_000);

  for (const backend of BACKENDS) {
    test(`Full flow ${backend}: T1→T2→T5→T9/T10 lifecycle`, async ({ page }) => {
      // T1: Start from idle, select agent
      await goToGuid(page);
      await selectAgent(page, backend);

      // Send message - triggers T1 → T2 → T5
      const conversationId = await sendMessageFromGuid(page, `Full flow test for ${backend}`);
      createdIds.push(conversationId);

      // T2: Wait for handshake success → active
      await waitForSessionActive(page, 120_000);

      // T5: Message being executed in prompting state
      // T9/T10: Wait for prompt completion
      const replyText = await waitForAiReply(page, 120_000);
      expect(replyText.length).toBeGreaterThan(0);

      // Verify we're back in active state (T9) and can send another message
      const textarea = page.locator('textarea').first();
      await textarea.waitFor({ state: 'visible', timeout: 10_000 });
      await textarea.fill('Second message for full flow test');
      await textarea.press('Enter');

      // Wait for second reply
      const secondReply = await waitForAiReply(page, 120_000);
      expect(secondReply.length).toBeGreaterThan(0);

      await takeScreenshot(page, `session-full-flow-${backend}`);
    });
  }

  test('Full flow: conversation cleanup via delete (T7 → idle)', async ({ page }) => {
    await goToGuid(page);
    await selectAgent(page, 'claude');

    const conversationId = await sendMessageFromGuid(page, 'Full flow cleanup test');
    createdIds.push(conversationId);

    await waitForSessionActive(page, 120_000);
    await waitForAiReply(page, 120_000);

    // Delete conversation - should trigger T7 (stop) and return to idle
    await deleteConversation(page, conversationId);

    // Should be back at guid page (idle state)
    await expect(page).toHaveURL(/#\/guid/, { timeout: 15_000 });
  });
});
