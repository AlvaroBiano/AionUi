// tests/unit/process/events/subscribers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventDispatcher } from '@process/events/EventDispatcher';
import type { AgentEventMap } from '@process/events/AgentEvents';
import {
  registerBridgeSubscriber,
  registerTeamSubscriber,
  registerChannelSubscriber,
  registerCronSubscriber,
  registerSkillSuggestSubscriber,
} from '@process/events/subscribers';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';

describe('Event Subscribers', () => {
  let dispatcher: EventDispatcher<AgentEventMap>;

  beforeEach(() => {
    dispatcher = new EventDispatcher<AgentEventMap>();
  });

  const msg: IResponseMessage = {
    type: 'content',
    conversation_id: 'conv-1',
    msg_id: 'msg-1',
    data: 'hello',
  };

  const baseCtx = { conversationId: 'conv-1', agentType: 'acp' as const };

  // ── BridgeSubscriber ──

  describe('BridgeSubscriber', () => {
    it('forwards stream, finish, error to ipcStream', () => {
      const ipcStream = { emit: vi.fn() };
      registerBridgeSubscriber(dispatcher, ipcStream);

      dispatcher.emit('agent:stream', { ...baseCtx, message: msg });
      dispatcher.emit('agent:finish', { ...baseCtx, message: { ...msg, type: 'finish' } });
      dispatcher.emit('agent:error', { ...baseCtx, message: { ...msg, type: 'error' } });

      expect(ipcStream.emit).toHaveBeenCalledTimes(3);
      expect(ipcStream.emit.mock.calls[0][0].type).toBe('content');
      expect(ipcStream.emit.mock.calls[1][0].type).toBe('finish');
      expect(ipcStream.emit.mock.calls[2][0].type).toBe('error');
    });
  });

  // ── TeamSubscriber ──

  describe('TeamSubscriber', () => {
    it('forwards only finish and error, not stream', () => {
      const teamBus = { emit: vi.fn() };
      registerTeamSubscriber(dispatcher, teamBus);

      dispatcher.emit('agent:stream', { ...baseCtx, message: msg });
      dispatcher.emit('agent:finish', { ...baseCtx, message: { ...msg, type: 'finish' } });
      dispatcher.emit('agent:error', { ...baseCtx, message: { ...msg, type: 'error' } });

      expect(teamBus.emit).toHaveBeenCalledTimes(2);
      expect(teamBus.emit.mock.calls[0][1].type).toBe('finish');
      expect(teamBus.emit.mock.calls[1][1].type).toBe('error');
    });
  });

  // ── ChannelSubscriber ──

  describe('ChannelSubscriber', () => {
    it('forwards all events with conversationId', () => {
      const channelBus = { emitAgentMessage: vi.fn() };
      registerChannelSubscriber(dispatcher, channelBus);

      dispatcher.emit('agent:stream', { ...baseCtx, message: msg });
      dispatcher.emit('agent:finish', { ...baseCtx, message: { ...msg, type: 'finish' } });
      dispatcher.emit('agent:error', { ...baseCtx, message: { ...msg, type: 'error' } });

      expect(channelBus.emitAgentMessage).toHaveBeenCalledTimes(3);
      expect(channelBus.emitAgentMessage.mock.calls[0][0]).toBe('conv-1');
    });
  });

  // ── CronSubscriber ──

  describe('CronSubscriber', () => {
    it('sets processing true on turn:started, false on turn:completed', () => {
      const cronGuard = { setProcessing: vi.fn() };
      registerCronSubscriber(dispatcher, cronGuard);

      dispatcher.emit('turn:started', { ...baseCtx });
      expect(cronGuard.setProcessing).toHaveBeenCalledWith('conv-1', true);

      dispatcher.emit('turn:completed', { ...baseCtx });
      expect(cronGuard.setProcessing).toHaveBeenCalledWith('conv-1', false);
    });
  });

  // ── SkillSuggestSubscriber ──

  describe('SkillSuggestSubscriber', () => {
    it('calls onFinish on turn:completed', () => {
      const skillWatcher = { onFinish: vi.fn() };
      registerSkillSuggestSubscriber(dispatcher, skillWatcher);

      dispatcher.emit('turn:completed', { ...baseCtx });
      expect(skillWatcher.onFinish).toHaveBeenCalledWith('conv-1');
    });

    it('does not trigger on turn:started', () => {
      const skillWatcher = { onFinish: vi.fn() };
      registerSkillSuggestSubscriber(dispatcher, skillWatcher);

      dispatcher.emit('turn:started', { ...baseCtx });
      expect(skillWatcher.onFinish).not.toHaveBeenCalled();
    });
  });

  // ── All together ──

  describe('All subscribers combined', () => {
    it('fan-out works correctly with all subscribers registered', () => {
      const ipcStream = { emit: vi.fn() };
      const teamBus = { emit: vi.fn() };
      const channelBus = { emitAgentMessage: vi.fn() };
      const cronGuard = { setProcessing: vi.fn() };
      const skillWatcher = { onFinish: vi.fn() };

      registerBridgeSubscriber(dispatcher, ipcStream);
      registerTeamSubscriber(dispatcher, teamBus);
      registerChannelSubscriber(dispatcher, channelBus);
      registerCronSubscriber(dispatcher, cronGuard);
      registerSkillSuggestSubscriber(dispatcher, skillWatcher);

      // Emit finish — should hit Bridge + Team + Channel
      const finishMsg = { ...msg, type: 'finish' };
      dispatcher.emit('agent:finish', { ...baseCtx, message: finishMsg });

      expect(ipcStream.emit).toHaveBeenCalledOnce();
      expect(teamBus.emit).toHaveBeenCalledOnce();
      expect(channelBus.emitAgentMessage).toHaveBeenCalledOnce();

      // Emit turn:completed — should hit Cron + SkillSuggest
      dispatcher.emit('turn:completed', { ...baseCtx });

      expect(cronGuard.setProcessing).toHaveBeenCalledWith('conv-1', false);
      expect(skillWatcher.onFinish).toHaveBeenCalledWith('conv-1');
    });
  });
});
