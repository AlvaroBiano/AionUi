/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAuthenticate, mockGetInitializeResponse, mockDisconnect, mockConnect } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn().mockResolvedValue({}),
  mockGetInitializeResponse: vi.fn().mockReturnValue({
    authMethods: [{ id: 'device-login', type: 'device-login' }],
  }),
  mockDisconnect: vi.fn().mockResolvedValue(undefined),
  mockConnect: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/process/agent/acp/AcpConnection', () => ({
  AcpConnection: class {
    hasActiveSession = false;
    isConnected = true;
    connect = mockConnect;
    disconnect = mockDisconnect;
    authenticate = mockAuthenticate;
    getInitializeResponse = mockGetInitializeResponse;
    getConfigOptions = vi.fn().mockReturnValue(null);
    getModels = vi.fn().mockReturnValue(null);
    setPromptTimeout = vi.fn();
    onSessionUpdate: unknown = undefined;
    onPermissionRequest: unknown = undefined;
    onEndTurn: unknown = undefined;
    onPromptUsage: unknown = undefined;
    onFileOperation: unknown = undefined;
    onDisconnect: unknown = undefined;
  },
}));

vi.mock('../../src/process/agent/acp/AcpAdapter', () => ({
  AcpAdapter: vi.fn(
    class MockAcpAdapter {
      ready = true;
    }
  ),
}));

vi.mock('../../src/process/agent/acp/ApprovalStore', () => ({
  AcpApprovalStore: vi.fn(
    class MockAcpApprovalStore {
      ready = true;
    }
  ),
  createAcpApprovalKey: vi.fn(),
}));

vi.mock('../../src/process/agent/acp/utils', () => ({
  getClaudeModel: vi.fn().mockReturnValue(null),
  killChild: vi.fn(),
  readTextFile: vi.fn(),
  writeJsonRpcMessage: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock('../../src/process/agent/acp/modelInfo', () => ({
  buildAcpModelInfo: vi.fn().mockReturnValue(null),
  summarizeAcpModelInfo: vi.fn(),
}));

vi.mock('../../src/process/agent/acp/mcpSessionConfig', () => ({
  buildBuiltinAcpSessionMcpServers: vi.fn().mockResolvedValue([]),
  parseAcpMcpCapabilities: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
}));

vi.mock('../../src/common/utils', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/common/utils')>();
  return { ...original, uuid: vi.fn().mockReturnValue('test-uuid') };
});

vi.mock('../../src/process/utils/shellEnv', () => ({
  getEnhancedEnv: vi.fn().mockReturnValue({}),
  resolveNpxPath: vi.fn().mockReturnValue('npx'),
  getNpxCacheDir: vi.fn().mockReturnValue('/tmp/.npx-cache'),
  getWindowsShellExecutionOptions: vi.fn().mockReturnValue({}),
}));

vi.mock('../../src/process/utils/initStorage', () => ({
  ProcessConfig: { get: vi.fn().mockResolvedValue(null) },
}));

import { AcpAgent } from '../../src/process/agent/acp/index';

type AcpAgentWithPerformAuthentication = AcpAgent & {
  performAuthentication: () => Promise<void>;
};

function makeAgent(
  backend: 'codex' | 'custom' | 'claude',
  options: {
    acpSessionId?: string;
  } = {}
): AcpAgent {
  return new AcpAgent({
    id: `agent-${backend}`,
    backend,
    workingDir: '/tmp',
    extra: {
      backend,
      workspace: '/tmp',
      acpSessionId: options.acpSessionId,
    },
    onStreamEvent: vi.fn(),
  });
}

function performAuthentication(agent: AcpAgent): Promise<void> {
  return (agent as unknown as AcpAgentWithPerformAuthentication).performAuthentication();
}

describe('AcpAgent.performAuthentication() codex passive ACP authenticate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({});
    mockGetInitializeResponse.mockReturnValue({
      authMethods: [{ id: 'device-login', type: 'device-login' }],
    });
  });

  it('auto-authenticates codex only when reopening a stored session', async () => {
    const agent = makeAgent('codex', { acpSessionId: 'resume-session-1' });
    const createOrResumeSession = vi
      .spyOn(agent as never, 'createOrResumeSession' as never)
      .mockRejectedValueOnce(new Error('Authentication required'))
      .mockResolvedValueOnce(undefined);
    const emitStatusMessage = vi.spyOn(agent as never, 'emitStatusMessage' as never).mockImplementation(() => {});

    await expect(performAuthentication(agent)).resolves.toBeUndefined();

    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    expect(mockAuthenticate).toHaveBeenCalledWith('device-login');
    expect(createOrResumeSession).toHaveBeenCalledTimes(2);
    expect(emitStatusMessage).toHaveBeenCalledWith('authenticated');
    expect(emitStatusMessage).not.toHaveBeenCalledWith('auth_required');
  });

  it('does not auto-authenticate first-time codex sessions without a stored session', async () => {
    const agent = makeAgent('codex');
    const createOrResumeSession = vi
      .spyOn(agent as never, 'createOrResumeSession' as never)
      .mockRejectedValue(new Error('Authentication required'));
    const emitStatusMessage = vi.spyOn(agent as never, 'emitStatusMessage' as never).mockImplementation(() => {});

    await expect(performAuthentication(agent)).rejects.toThrow('Authentication required');

    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(createOrResumeSession).toHaveBeenCalledTimes(2);
    expect(emitStatusMessage).toHaveBeenCalledWith('auth_required');
  });

  it('surfaces codex passive authenticate RPC failures instead of flattening them to auth_required', async () => {
    const agent = makeAgent('codex', { acpSessionId: 'resume-session-2' });
    const createOrResumeSession = vi
      .spyOn(agent as never, 'createOrResumeSession' as never)
      .mockRejectedValueOnce(new Error('Authentication required'));
    const emitStatusMessage = vi.spyOn(agent as never, 'emitStatusMessage' as never).mockImplementation(() => {});

    mockAuthenticate.mockRejectedValueOnce(new Error('authenticate RPC unavailable'));

    await expect(performAuthentication(agent)).rejects.toThrow('authenticate RPC unavailable');

    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    expect(createOrResumeSession).toHaveBeenCalledTimes(1);
    expect(emitStatusMessage).not.toHaveBeenCalledWith('auth_required');
  });

  it('keeps custom ACP auth on the explicit Authenticate CTA path', async () => {
    const agent = makeAgent('custom');
    const createOrResumeSession = vi
      .spyOn(agent as never, 'createOrResumeSession' as never)
      .mockRejectedValue(new Error('Authentication required'));
    const emitStatusMessage = vi.spyOn(agent as never, 'emitStatusMessage' as never).mockImplementation(() => {});

    await expect(performAuthentication(agent)).rejects.toThrow('Authentication required');

    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(createOrResumeSession).toHaveBeenCalledTimes(2);
    expect(emitStatusMessage).toHaveBeenCalledWith('auth_required');
  });

  it('keeps manual Authenticate on error when post-auth session bootstrap fails for non-auth reasons', async () => {
    const agent = makeAgent('custom');
    const createOrResumeSession = vi
      .spyOn(agent as never, 'createOrResumeSession' as never)
      .mockRejectedValue(new Error('Session load failed'));
    const emitStatusMessage = vi.spyOn(agent as never, 'emitStatusMessage' as never).mockImplementation(() => {});
    const emitModelInfo = vi.spyOn(agent as never, 'emitModelInfo' as never).mockImplementation(() => {});

    await expect(agent.authenticate()).rejects.toThrow('Session load failed');

    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    expect(createOrResumeSession).toHaveBeenCalledTimes(1);
    expect(emitModelInfo).not.toHaveBeenCalled();
    expect(emitStatusMessage).toHaveBeenCalledWith('authenticated');
    expect(emitStatusMessage).toHaveBeenCalledWith('error');
    expect(emitStatusMessage).not.toHaveBeenCalledWith('auth_required');
  });

  it('reports explicit authenticate support when ACP auth methods are available', () => {
    const agent = makeAgent('custom');

    expect(agent.getAuthSupport()).toEqual({ canAuthenticate: true });
  });

  it('reports explicit authenticate support for Claude fallback login even without ACP auth methods', () => {
    mockGetInitializeResponse.mockReturnValueOnce(null);

    const agent = makeAgent('claude');

    expect(agent.getAuthSupport()).toEqual({ canAuthenticate: true });
  });

  it('reports no authenticate support when neither ACP auth methods nor backend fallback login exist', () => {
    mockGetInitializeResponse.mockReturnValueOnce(null);

    const agent = makeAgent('custom');

    expect(agent.getAuthSupport()).toEqual({ canAuthenticate: false });
  });
});
