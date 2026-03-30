/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * toolExecutor — shared tool definitions and execution for direct-API agents.
 *
 * Gives anthropic/openai/gemini provider agents the ability to read files,
 * list directories, run tests, and execute arbitrary shell commands in the
 * workspace — bridging the gap vs CLI agents that get tool execution for free.
 */
import { execSync } from 'node:child_process';
import { Type } from '@google/genai';

const BASH_DESCRIPTION =
  'Execute a bash command in the workspace directory. Use this to read files ' +
  '(cat, head), list directories (ls, find), run tests, check git state, grep ' +
  'for patterns, etc. Output is capped at 512 KB.';

/** Anthropic SDK tool definition */
export const ANTHROPIC_BASH_TOOL = {
  name: 'bash',
  description: BASH_DESCRIPTION,
  input_schema: {
    type: 'object' as const,
    properties: {
      command: { type: 'string', description: 'The bash command to execute' },
    },
    required: ['command'],
  },
};

/** OpenAI SDK function tool definition */
export const OPENAI_BASH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'bash',
    description: BASH_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to execute' },
      },
      required: ['command'],
    },
  },
};

/** Gemini SDK function declaration */
export const GEMINI_BASH_DECLARATION = {
  name: 'bash',
  description: BASH_DESCRIPTION,
  parameters: {
    type: Type.OBJECT,
    properties: {
      command: { type: Type.STRING, description: 'The bash command to execute' },
    },
    required: ['command'],
  },
};

/**
 * Execute a tool call synchronously. Returns string output.
 * Only supports 'bash' for now.
 */
export function executeToolCall(
  name: string,
  input: Record<string, unknown>,
  workspace: string,
): string {
  if (name === 'bash') {
    const command = String(input.command ?? '').trim();
    if (!command) return 'Error: empty command';
    try {
      return (
        execSync(command, {
          cwd: workspace,
          timeout: 30_000,
          maxBuffer: 512 * 1024,
          encoding: 'utf8',
        }) || '(no output)'
      );
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return (e.stderr || e.stdout || e.message || String(err)).slice(0, 4096);
    }
  }
  return `Unknown tool: ${name}`;
}
