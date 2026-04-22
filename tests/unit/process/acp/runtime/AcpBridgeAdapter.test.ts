// tests/unit/process/acp/runtime/AcpBridgeAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AcpBridgeAdapter } from '@process/acp/runtime/AcpBridgeAdapter';

describe('AcpBridgeAdapter', () => {
  let mockRuntime: {
    getModelSnapshot: ReturnType<typeof vi.fn>;
    getModeSnapshot: ReturnType<typeof vi.fn>;
    getConfigSnapshot: ReturnType<typeof vi.fn>;
    getSessionStatus: ReturnType<typeof vi.fn>;
    getAvailableCommands: ReturnType<typeof vi.fn>;
    setModel: ReturnType<typeof vi.fn>;
    setMode: ReturnType<typeof vi.fn>;
    setConfigOption: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  };
  let compat: AcpBridgeAdapter;

  beforeEach(() => {
    mockRuntime = {
      getModelSnapshot: vi.fn().mockReturnValue({
        currentModelId: 'claude-4-sonnet',
        availableModels: [
          { modelId: 'claude-4-sonnet', name: 'Claude 4 Sonnet' },
          { modelId: 'claude-4-opus', name: 'Claude 4 Opus' },
        ],
      }),
      getModeSnapshot: vi.fn().mockReturnValue({
        currentModeId: 'normal',
        availableModes: [],
      }),
      getConfigSnapshot: vi.fn().mockReturnValue({
        configOptions: [
          {
            id: 'reasoning',
            name: 'Reasoning Effort',
            type: 'select',
            currentValue: 'medium',
            options: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }],
          },
        ],
        availableCommands: [],
        cwd: '/workspace',
      }),
      getSessionStatus: vi.fn().mockReturnValue('active'),
      getAvailableCommands: vi.fn().mockReturnValue([{ name: '/help', description: 'Show help' }]),
      setModel: vi.fn(),
      setMode: vi.fn(),
      setConfigOption: vi.fn(),
      start: vi.fn(),
    };
    compat = new AcpBridgeAdapter(mockRuntime as never);
  });

  // ── Getters ──

  describe('getModelInfo', () => {
    it('returns AcpModelInfo from model snapshot', () => {
      const info = compat.getModelInfo();
      expect(info).not.toBeNull();
      expect(info!.currentModelId).toBe('claude-4-sonnet');
      expect(info!.currentModelLabel).toBe('Claude 4 Sonnet');
      expect(info!.availableModels).toHaveLength(2);
      expect(info!.canSwitch).toBe(true);
    });

    it('returns null when no model info available', () => {
      mockRuntime.getModelSnapshot.mockReturnValue({
        currentModelId: null,
        availableModels: [],
      });
      expect(compat.getModelInfo()).toBeNull();
    });
  });

  describe('getMode', () => {
    it('returns current mode and initialized state', () => {
      const result = compat.getMode();
      expect(result.mode).toBe('normal');
      expect(result.initialized).toBe(true);
    });

    it('initialized is false when session is idle', () => {
      mockRuntime.getSessionStatus.mockReturnValue('idle');
      expect(compat.getMode().initialized).toBe(false);
    });

    it('defaults to "default" when mode is null', () => {
      mockRuntime.getModeSnapshot.mockReturnValue({
        currentModeId: null,
        availableModes: [],
      });
      expect(compat.getMode().mode).toBe('default');
    });
  });

  describe('getConfigOptions', () => {
    it('returns AcpSessionConfigOption format', () => {
      const options = compat.getConfigOptions();
      expect(options).toHaveLength(1);
      expect(options[0].id).toBe('reasoning');
      expect(options[0].type).toBe('select');
    });
  });

  // ── Setters ──

  describe('setModel', () => {
    it('calls runtime.setModel and returns model info', async () => {
      const result = await compat.setModel('claude-4-opus');
      expect(mockRuntime.setModel).toHaveBeenCalledWith('claude-4-opus');
      expect(result).not.toBeNull();
    });
  });

  describe('setMode', () => {
    it('calls runtime.setMode and returns success', async () => {
      const result = await compat.setMode('bypassPermissions');
      expect(mockRuntime.setMode).toHaveBeenCalledWith('bypassPermissions');
      expect(result.success).toBe(true);
      expect(result.data?.mode).toBe('normal'); // snapshot hasn't changed yet
    });
  });

  describe('setConfigOption', () => {
    it('calls runtime.setConfigOption and returns options', async () => {
      const result = await compat.setConfigOption('reasoning', 'high');
      expect(mockRuntime.setConfigOption).toHaveBeenCalledWith('reasoning', 'high');
      expect(result).toHaveLength(1);
    });
  });

  // ── Other compat ──

  describe('initAgent', () => {
    it('delegates to runtime.start', () => {
      compat.initAgent();
      expect(mockRuntime.start).toHaveBeenCalled();
    });
  });

  describe('loadAcpSlashCommands', () => {
    it('returns available commands', () => {
      const cmds = compat.loadAcpSlashCommands();
      expect(cmds).toHaveLength(1);
      expect(cmds[0].name).toBe('/help');
    });
  });
});
