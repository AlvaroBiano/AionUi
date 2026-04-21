// tests/unit/process/events/EventDispatcher.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventDispatcher } from '@process/events/EventDispatcher';

type TestEvents = {
  'agent:finish': { conversationId: string; data: string };
  'agent:stream': { conversationId: string; text: string };
  'agent:configuring': { config: { mcpServers: string[] } };
  'model:changed': { modelId: string };
};

describe('EventDispatcher', () => {
  let dispatcher: EventDispatcher<TestEvents>;

  beforeEach(() => {
    dispatcher = new EventDispatcher<TestEvents>();
  });

  // ── emit (notification) ──

  it('calls registered handler on emit', () => {
    const handler = vi.fn();
    dispatcher.on('agent:finish', handler);
    dispatcher.emit('agent:finish', { conversationId: 'c1', data: 'done' });
    expect(handler).toHaveBeenCalledWith({ conversationId: 'c1', data: 'done' });
  });

  it('calls multiple handlers in registration order', () => {
    const order: number[] = [];
    dispatcher.on('agent:finish', () => order.push(1));
    dispatcher.on('agent:finish', () => order.push(2));
    dispatcher.on('agent:finish', () => order.push(3));
    dispatcher.emit('agent:finish', { conversationId: 'c1', data: '' });
    expect(order).toEqual([1, 2, 3]);
  });

  it('does not call handlers for other events', () => {
    const handler = vi.fn();
    dispatcher.on('agent:finish', handler);
    dispatcher.emit('agent:stream', { conversationId: 'c1', text: 'hi' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('catches and logs handler errors without affecting others', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    dispatcher.on('agent:finish', () => {
      throw new Error('boom');
    });
    dispatcher.on('agent:finish', good);
    dispatcher.emit('agent:finish', { conversationId: 'c1', data: '' });
    expect(good).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('catches async handler rejections', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dispatcher.on('agent:finish', async () => {
      throw new Error('async boom');
    });
    dispatcher.emit('agent:finish', { conversationId: 'c1', data: '' });
    // Wait a tick for the async rejection to be caught
    await new Promise((r) => setTimeout(r, 10));
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('does nothing when emitting event with no handlers', () => {
    // Should not throw
    dispatcher.emit('agent:finish', { conversationId: 'c1', data: '' });
  });

  // ── off (unregister) ──

  it('removes handler with off', () => {
    const handler = vi.fn();
    dispatcher.on('agent:finish', handler);
    dispatcher.off('agent:finish', handler);
    dispatcher.emit('agent:finish', { conversationId: 'c1', data: '' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('off with non-registered handler is a no-op', () => {
    dispatcher.off('agent:finish', vi.fn());
    // Should not throw
  });

  // ── waterfall ──

  it('runs waterfall handlers sequentially, passing modified payload', async () => {
    dispatcher.onWaterfall('agent:configuring', (payload) => {
      payload.config.mcpServers.push('team-guide');
      return payload;
    });
    dispatcher.onWaterfall('agent:configuring', (payload) => {
      payload.config.mcpServers.push('user-mcp');
      return payload;
    });

    const result = await dispatcher.waterfall('agent:configuring', {
      config: { mcpServers: [] },
    });

    expect(result.config.mcpServers).toEqual(['team-guide', 'user-mcp']);
  });

  it('waterfall returns original payload when no handlers', async () => {
    const payload = { config: { mcpServers: ['original'] } };
    const result = await dispatcher.waterfall('agent:configuring', payload);
    expect(result).toBe(payload);
  });

  it('waterfall supports async handlers', async () => {
    dispatcher.onWaterfall('agent:configuring', async (payload) => {
      await new Promise((r) => setTimeout(r, 5));
      payload.config.mcpServers.push('async-mcp');
      return payload;
    });

    const result = await dispatcher.waterfall('agent:configuring', {
      config: { mcpServers: [] },
    });
    expect(result.config.mcpServers).toEqual(['async-mcp']);
  });

  it('waterfall catches handler error and continues with current payload', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dispatcher.onWaterfall('agent:configuring', () => {
      throw new Error('fail');
    });
    dispatcher.onWaterfall('agent:configuring', (payload) => {
      payload.config.mcpServers.push('after-error');
      return payload;
    });

    const result = await dispatcher.waterfall('agent:configuring', {
      config: { mcpServers: [] },
    });
    expect(result.config.mcpServers).toEqual(['after-error']);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // ── listenerCount + inspect ──

  it('listenerCount returns total for event', () => {
    dispatcher.on('agent:finish', vi.fn());
    dispatcher.on('agent:finish', vi.fn());
    dispatcher.onWaterfall('agent:finish', vi.fn());
    expect(dispatcher.listenerCount('agent:finish')).toBe(3);
  });

  it('inspect returns all registrations with labels', () => {
    dispatcher.on('agent:finish', vi.fn(), 'BridgeAdapter');
    dispatcher.on('agent:finish', vi.fn(), 'TeamConsumer');
    dispatcher.onWaterfall('agent:configuring', vi.fn(), 'TeamMcpInjector');

    const info = dispatcher.inspect();
    expect(info).toEqual([
      { event: 'agent:finish', type: 'emit', label: 'BridgeAdapter' },
      { event: 'agent:finish', type: 'emit', label: 'TeamConsumer' },
      { event: 'agent:configuring', type: 'waterfall', label: 'TeamMcpInjector' },
    ]);
  });

  // ── clear ──

  it('clear removes all handlers', () => {
    dispatcher.on('agent:finish', vi.fn());
    dispatcher.onWaterfall('agent:configuring', vi.fn());
    dispatcher.clear();
    expect(dispatcher.listenerCount('agent:finish')).toBe(0);
    expect(dispatcher.listenerCount('agent:configuring')).toBe(0);
  });

  // ── type safety (compile-time) ──

  it('enforces correct payload type per event', () => {
    // This test verifies the type system works — if it compiles, it passes.
    dispatcher.on('model:changed', (payload) => {
      // TypeScript knows payload.modelId is string
      expect(typeof payload.modelId).toBe('string');
    });
    dispatcher.emit('model:changed', { modelId: 'gpt-4' });
  });
});
