/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks --- //

const getAvailableAgentsInvoke = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      getAvailableAgents: {
        invoke: (...args: unknown[]) => getAvailableAgentsInvoke(...args),
      },
    },
  },
}));

import { useIsSavedTeammate } from '@/renderer/pages/conversation/dispatch/hooks/useIsSavedTeammate';

// --- Tests --- //

describe('useIsSavedTeammate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAvailableAgentsInvoke.mockResolvedValue({
      success: true,
      data: [
        { name: 'Existing Agent', id: 'agent-1' },
        { name: 'Another Agent', id: 'agent-2' },
      ],
    });
  });

  // IST-001: Returns true when teammate name exists in saved agents
  it('IST-001: returns isSaved=true when name exists', async () => {
    const { result } = renderHook(() => useIsSavedTeammate('Existing Agent'));

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isSaved).toBe(true);
  });

  // IST-002: Returns false when teammate name does not exist
  it('IST-002: returns isSaved=false when name does not exist', async () => {
    const { result } = renderHook(() => useIsSavedTeammate('Unknown Agent'));

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isSaved).toBe(false);
  });

  // IST-003: Handles IPC error gracefully (defaults to not saved)
  it('IST-003: handles IPC error, defaults to isSaved=false', async () => {
    getAvailableAgentsInvoke.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useIsSavedTeammate('Existing Agent'));

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isSaved).toBe(false);
  });

  // IST-004: Returns false when teammateName is undefined
  it('IST-004: returns isSaved=false when teammateName is undefined', async () => {
    const { result } = renderHook(() => useIsSavedTeammate(undefined));

    // Should not invoke IPC at all
    expect(getAvailableAgentsInvoke).not.toHaveBeenCalled();
    expect(result.current.isSaved).toBe(false);
    expect(result.current.isChecking).toBe(false);
  });

  // IST-005: Recheck function triggers a new check
  it('IST-005: recheck triggers a new IPC call', async () => {
    const { result } = renderHook(() => useIsSavedTeammate('Existing Agent'));

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(getAvailableAgentsInvoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.recheck();
    });

    await waitFor(() => {
      expect(getAvailableAgentsInvoke).toHaveBeenCalledTimes(2);
    });
  });

  // IST-006: Handles empty agent list
  it('IST-006: returns false for empty agent list', async () => {
    getAvailableAgentsInvoke.mockResolvedValue({
      success: true,
      data: [],
    });

    const { result } = renderHook(() => useIsSavedTeammate('Any Name'));

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isSaved).toBe(false);
  });

  // IST-007: Handles unsuccessful IPC response
  it('IST-007: handles unsuccessful response (success=false)', async () => {
    getAvailableAgentsInvoke.mockResolvedValue({
      success: false,
      msg: 'Some error',
    });

    const { result } = renderHook(() => useIsSavedTeammate('Existing Agent'));

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    // When success is false, data is not checked, so isSaved stays false
    expect(result.current.isSaved).toBe(false);
  });
});
