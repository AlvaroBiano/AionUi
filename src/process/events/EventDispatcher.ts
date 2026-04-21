// src/process/events/EventDispatcher.ts

/**
 * Typed event dispatcher with emit (notification) and waterfall (sequential mutation).
 *
 * Generic over an EventMap that maps event names to payload types.
 * Shared across all agent types — not ACP-specific.
 *
 * Usage:
 *   type MyEvents = {
 *     'agent:finish': { conversationId: string; message: TMessage };
 *     'model:changed': { conversationId: string; modelId: string };
 *   };
 *   const dispatcher = new EventDispatcher<MyEvents>();
 *   dispatcher.on('agent:finish', (payload) => { ... });
 *   dispatcher.emit('agent:finish', { conversationId: '...', message: ... });
 */

// ─── Types ──────────────────────────────────────────────────────

/** Constrains event maps: keys are event names, values are payload types. */
export type EventMap = Record<string, unknown>;

/** A handler for a notification event. Return value is ignored. */
export type EventHandler<T> = (payload: T) => void;

/** A handler for a waterfall event. Receives and returns the payload (may mutate). */
export type WaterfallHandler<T> = (payload: T) => T | Promise<T>;

type HandlerEntry<T> = {
  handler: EventHandler<T> | WaterfallHandler<T>;
  label?: string;
};

// ─── EventDispatcher ────────────────────────────────────────────

export class EventDispatcher<E extends EventMap> {
  private handlers = new Map<keyof E, HandlerEntry<unknown>[]>();
  private waterfallHandlers = new Map<keyof E, HandlerEntry<unknown>[]>();

  /**
   * Register a notification handler. Called on `emit()`.
   * Handlers run in registration order but independently (no chaining).
   *
   * @param label Optional label for debugging (visible in Composition Root).
   */
  on<K extends keyof E>(event: K, handler: EventHandler<E[K]>, label?: string): void {
    const list = this.handlers.get(event) ?? [];
    list.push({ handler: handler as EventHandler<unknown>, label });
    this.handlers.set(event, list);
  }

  /**
   * Unregister a notification handler.
   */
  off<K extends keyof E>(event: K, handler: EventHandler<E[K]>): void {
    const list = this.handlers.get(event);
    if (!list) return;
    const idx = list.findIndex((e) => e.handler === handler);
    if (idx !== -1) list.splice(idx, 1);
  }

  /**
   * Register a waterfall handler. Called on `waterfall()`.
   * Handlers run in registration order, each receiving the previous handler's output.
   *
   * @param label Optional label for debugging.
   */
  onWaterfall<K extends keyof E>(event: K, handler: WaterfallHandler<E[K]>, label?: string): void {
    const list = this.waterfallHandlers.get(event) ?? [];
    list.push({ handler: handler as WaterfallHandler<unknown>, label });
    this.waterfallHandlers.set(event, list);
  }

  /**
   * Emit a notification event. Handlers are called synchronously in registration order.
   *
   * - Sync handlers: run to completion before the next handler (and before emit returns)
   * - Async handlers: execute up to the first await, then detach (emit does NOT await them)
   * - Errors (sync throw or async reject) are caught and logged per handler,
   *   do not propagate to the caller or affect other handlers.
   */
  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const list = this.handlers.get(event);
    if (!list || list.length === 0) return;

    for (const entry of list) {
      try {
        // Handler might be async even though type says void — detect and catch rejections
        const result = (entry.handler as (p: E[K]) => unknown)(payload);
        if (result instanceof Promise) {
          (result as Promise<unknown>).catch((err) => {
            console.error(
              `[EventDispatcher] ${String(event)} handler${entry.label ? ` (${entry.label})` : ''} rejected:`,
              err
            );
          });
        }
      } catch (err) {
        console.error(
          `[EventDispatcher] ${String(event)} handler${entry.label ? ` (${entry.label})` : ''} threw:`,
          err
        );
      }
    }
  }

  /**
   * Run a waterfall event. Each handler receives the payload, may modify it,
   * and returns the (possibly modified) payload for the next handler.
   * Returns the final payload after all handlers have run.
   */
  async waterfall<K extends keyof E>(event: K, payload: E[K]): Promise<E[K]> {
    const list = this.waterfallHandlers.get(event);
    if (!list || list.length === 0) return payload;

    let current = payload;
    for (const entry of list) {
      try {
        current = await (entry.handler as WaterfallHandler<E[K]>)(current);
      } catch (err) {
        console.error(
          `[EventDispatcher] waterfall ${String(event)}${entry.label ? ` (${entry.label})` : ''} threw:`,
          err
        );
        // Continue with current payload — don't let one handler break the chain
      }
    }
    return current;
  }

  /**
   * Get handler count for a given event (for testing/debugging).
   */
  listenerCount<K extends keyof E>(event: K): number {
    return (this.handlers.get(event)?.length ?? 0) + (this.waterfallHandlers.get(event)?.length ?? 0);
  }

  /**
   * List all registered event names and their handler labels (for debugging).
   */
  inspect(): Array<{ event: string; type: 'emit' | 'waterfall'; label?: string }> {
    const result: Array<{ event: string; type: 'emit' | 'waterfall'; label?: string }> = [];
    for (const [event, list] of this.handlers) {
      for (const entry of list) {
        result.push({ event: String(event), type: 'emit', label: entry.label });
      }
    }
    for (const [event, list] of this.waterfallHandlers) {
      for (const entry of list) {
        result.push({ event: String(event), type: 'waterfall', label: entry.label });
      }
    }
    return result;
  }

  /**
   * Remove all handlers. Call on shutdown.
   */
  clear(): void {
    this.handlers.clear();
    this.waterfallHandlers.clear();
  }
}
