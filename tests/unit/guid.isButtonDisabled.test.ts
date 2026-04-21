/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the isButtonDisabled calculation in useGuidSend.ts
 *
 * The formula (from source):
 *
 *   isButtonDisabled =
 *     loading
 *     || !input.trim()
 *     || (
 *          (
 *            ((!selectedAgent || selectedAgent === 'gemini') && !isPresetAgent)
 *            || (isPresetAgent && currentEffectiveAgentInfo.agentType === 'gemini' && currentEffectiveAgentInfo.isAvailable)
 *          )
 *          && !currentModel
 *          && isGoogleAuth
 *        )
 *
 * Readable summary:
 *   Disabled if loading, OR empty input, OR
 *   (is a gemini-based flow AND no currentModel AND google-auth mode is active)
 *
 * The "gemini-based flow" condition covers:
 *   A) direct gemini selection (selectedAgent unset or 'gemini') while NOT a preset agent, OR
 *   B) preset agent whose effective type is gemini AND that gemini is available
 */

import { describe, it, expect } from 'vitest';
import type { EffectiveAgentInfo } from '@/renderer/pages/guid/types';
import type { TProviderWithModel } from '@/common/config/storage';

// ---------------------------------------------------------------------------
// Pure replica of the isButtonDisabled calculation — no React needed
// ---------------------------------------------------------------------------

type ButtonDisabledParams = {
  loading: boolean;
  input: string;
  selectedAgent: string | null | undefined;
  isPresetAgent: boolean;
  currentEffectiveAgentInfo: EffectiveAgentInfo;
  currentModel: TProviderWithModel | undefined;
  isGoogleAuth: boolean;
};

function calcIsButtonDisabled(p: ButtonDisabledParams): boolean {
  const { loading, input, selectedAgent, isPresetAgent, currentEffectiveAgentInfo, currentModel, isGoogleAuth } = p;

  return (
    loading ||
    !input.trim() ||
    ((((!selectedAgent || selectedAgent === 'gemini') && !isPresetAgent) ||
      (isPresetAgent && currentEffectiveAgentInfo.agentType === 'gemini' && currentEffectiveAgentInfo.isAvailable)) &&
      !currentModel &&
      isGoogleAuth)
  );
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const defaultEffectiveInfo: EffectiveAgentInfo = {
  agentType: 'gemini',
  isFallback: false,
  originalType: 'gemini',
  isAvailable: true,
};

const nonGeminiEffectiveInfo: EffectiveAgentInfo = {
  agentType: 'claude',
  isFallback: false,
  originalType: 'claude',
  isAvailable: true,
};

const mockModel: TProviderWithModel = {
  id: 'model-1',
  name: 'Test Model',
  useModel: 'gemini-pro',
  platform: 'gemini-with-google-auth' as const,
  baseUrl: '',
  apiKey: '',
};

// ---------------------------------------------------------------------------
// loading guard
// ---------------------------------------------------------------------------

describe('isButtonDisabled — loading guard', () => {
  it('is disabled when loading=true regardless of other conditions', () => {
    expect(
      calcIsButtonDisabled({
        loading: true,
        input: 'hello world',
        selectedAgent: 'claude',
        isPresetAgent: false,
        currentEffectiveAgentInfo: nonGeminiEffectiveInfo,
        currentModel: mockModel,
        isGoogleAuth: false,
      })
    ).toBe(true);
  });

  it('is NOT disabled by loading when loading=false (other conditions allow)', () => {
    expect(
      calcIsButtonDisabled({
        loading: false,
        input: 'hello',
        selectedAgent: 'claude',
        isPresetAgent: false,
        currentEffectiveAgentInfo: nonGeminiEffectiveInfo,
        currentModel: mockModel,
        isGoogleAuth: false,
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// empty input guard
// ---------------------------------------------------------------------------

describe('isButtonDisabled — input guard', () => {
  const baseParams: ButtonDisabledParams = {
    loading: false,
    input: '',
    selectedAgent: 'claude',
    isPresetAgent: false,
    currentEffectiveAgentInfo: nonGeminiEffectiveInfo,
    currentModel: mockModel,
    isGoogleAuth: false,
  };

  it('is disabled when input is empty string', () => {
    expect(calcIsButtonDisabled({ ...baseParams, input: '' })).toBe(true);
  });

  it('is disabled when input is whitespace-only', () => {
    expect(calcIsButtonDisabled({ ...baseParams, input: '   ' })).toBe(true);
    expect(calcIsButtonDisabled({ ...baseParams, input: '\t\n' })).toBe(true);
  });

  it('is NOT disabled when input has non-whitespace content', () => {
    expect(calcIsButtonDisabled({ ...baseParams, input: 'hello' })).toBe(false);
    expect(calcIsButtonDisabled({ ...baseParams, input: '  hi  ' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gemini condition — direct selection (no preset)
// ---------------------------------------------------------------------------

describe('isButtonDisabled — gemini direct selection', () => {
  // Case: selectedAgent unset or "gemini", isPresetAgent=false, isGoogleAuth=true, no currentModel
  const geminiBase: ButtonDisabledParams = {
    loading: false,
    input: 'hello',
    selectedAgent: 'gemini',
    isPresetAgent: false,
    currentEffectiveAgentInfo: defaultEffectiveInfo,
    currentModel: undefined,
    isGoogleAuth: true,
  };

  it('is disabled: selectedAgent=gemini, no model, google auth active', () => {
    expect(calcIsButtonDisabled(geminiBase)).toBe(true);
  });

  it('is disabled: selectedAgent=null (falsy), no model, google auth active', () => {
    expect(calcIsButtonDisabled({ ...geminiBase, selectedAgent: null })).toBe(true);
  });

  it('is disabled: selectedAgent=undefined (falsy), no model, google auth active', () => {
    expect(calcIsButtonDisabled({ ...geminiBase, selectedAgent: undefined })).toBe(true);
  });

  it('is NOT disabled when currentModel is provided', () => {
    expect(calcIsButtonDisabled({ ...geminiBase, currentModel: mockModel })).toBe(false);
  });

  it('is NOT disabled when isGoogleAuth=false (non-auth gemini)', () => {
    expect(calcIsButtonDisabled({ ...geminiBase, isGoogleAuth: false })).toBe(false);
  });

  it('is NOT disabled when selectedAgent is non-gemini (e.g. claude)', () => {
    expect(
      calcIsButtonDisabled({
        ...geminiBase,
        selectedAgent: 'claude',
        currentEffectiveAgentInfo: nonGeminiEffectiveInfo,
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gemini condition — preset agent with effective gemini type
// ---------------------------------------------------------------------------

describe('isButtonDisabled — preset agent with gemini effective type', () => {
  const presetGeminiBase: ButtonDisabledParams = {
    loading: false,
    input: 'hello',
    selectedAgent: 'custom',
    isPresetAgent: true,
    currentEffectiveAgentInfo: defaultEffectiveInfo, // agentType='gemini', isAvailable=true
    currentModel: undefined,
    isGoogleAuth: true,
  };

  it('is disabled: preset + effective=gemini + available + no model + google auth', () => {
    expect(calcIsButtonDisabled(presetGeminiBase)).toBe(true);
  });

  it('is NOT disabled when effective gemini is NOT available (isAvailable=false)', () => {
    expect(
      calcIsButtonDisabled({
        ...presetGeminiBase,
        currentEffectiveAgentInfo: { ...defaultEffectiveInfo, isAvailable: false },
      })
    ).toBe(false);
  });

  it('is NOT disabled when effective type is NOT gemini (e.g. claude)', () => {
    expect(
      calcIsButtonDisabled({
        ...presetGeminiBase,
        currentEffectiveAgentInfo: nonGeminiEffectiveInfo,
      })
    ).toBe(false);
  });

  it('is NOT disabled when currentModel is present', () => {
    expect(calcIsButtonDisabled({ ...presetGeminiBase, currentModel: mockModel })).toBe(false);
  });

  it('is NOT disabled when isGoogleAuth=false', () => {
    expect(calcIsButtonDisabled({ ...presetGeminiBase, isGoogleAuth: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Non-gemini agents (claude, codex, aionrs, etc.) — should never be disabled by model check
// ---------------------------------------------------------------------------

describe('isButtonDisabled — non-gemini agents bypass model check', () => {
  const agents = ['claude', 'codex', 'aionrs', 'qwen', 'openclaw-gateway', 'nanobot'];

  for (const agent of agents) {
    it(`is NOT disabled for agent=${agent} with input and no loading`, () => {
      expect(
        calcIsButtonDisabled({
          loading: false,
          input: 'test message',
          selectedAgent: agent,
          isPresetAgent: false,
          currentEffectiveAgentInfo: { agentType: agent, isFallback: false, originalType: agent, isAvailable: true },
          currentModel: undefined, // no model
          isGoogleAuth: true, // google auth active
        })
      ).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Combined edge cases
// ---------------------------------------------------------------------------

describe('isButtonDisabled — combined edge cases', () => {
  it('loading=true overrides valid input and model', () => {
    expect(
      calcIsButtonDisabled({
        loading: true,
        input: 'valid input',
        selectedAgent: 'gemini',
        isPresetAgent: false,
        currentEffectiveAgentInfo: defaultEffectiveInfo,
        currentModel: mockModel,
        isGoogleAuth: true,
      })
    ).toBe(true);
  });

  it('empty input overrides model and auth conditions', () => {
    expect(
      calcIsButtonDisabled({
        loading: false,
        input: '  ',
        selectedAgent: 'gemini',
        isPresetAgent: false,
        currentEffectiveAgentInfo: defaultEffectiveInfo,
        currentModel: mockModel,
        isGoogleAuth: true,
      })
    ).toBe(true);
  });

  it('all conditions disabled simultaneously is still disabled', () => {
    expect(
      calcIsButtonDisabled({
        loading: true,
        input: '',
        selectedAgent: 'gemini',
        isPresetAgent: false,
        currentEffectiveAgentInfo: defaultEffectiveInfo,
        currentModel: undefined,
        isGoogleAuth: true,
      })
    ).toBe(true);
  });

  it('all conditions satisfied — button enabled', () => {
    expect(
      calcIsButtonDisabled({
        loading: false,
        input: 'let us go',
        selectedAgent: 'claude',
        isPresetAgent: false,
        currentEffectiveAgentInfo: nonGeminiEffectiveInfo,
        currentModel: undefined,
        isGoogleAuth: false,
      })
    ).toBe(false);
  });
});
