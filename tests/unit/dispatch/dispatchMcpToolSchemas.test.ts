/**
 * Unit tests for MCP tool schema sync (F-5.1).
 * Test IDs: MCP-TS-001 through MCP-TS-006.
 *
 * Verifies that TOOL_SCHEMAS in dispatchMcpServerScript.ts includes all 4 tools
 * with correct names, required parameters, and descriptions.
 *
 * Since dispatchMcpServerScript.ts is a standalone script (reads stdin, writes stdout),
 * we extract and verify the TOOL_SCHEMAS constant by reading the source file and
 * evaluating the schema definitions.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Extract TOOL_SCHEMAS from the source file by parsing the const declaration.
 * This avoids importing the script (which attaches stdin/stdout listeners).
 */
function extractToolSchemas(): Array<{
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
}> {
  const scriptPath = path.resolve(__dirname, '../../../src/process/task/dispatch/dispatchMcpServerScript.ts');
  const content = fs.readFileSync(scriptPath, 'utf8');

  // Extract the TOOL_SCHEMAS array between its opening and closing bracket
  const startMarker = 'const TOOL_SCHEMAS = [';
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) throw new Error('TOOL_SCHEMAS not found in source');

  // Find the matching closing bracket
  let depth = 0;
  let endIdx = startIdx + startMarker.length - 1; // position of '['
  for (let i = endIdx; i < content.length; i++) {
    if (content[i] === '[') depth++;
    if (content[i] === ']') depth--;
    if (depth === 0) {
      endIdx = i + 1;
      break;
    }
  }

  const schemasStr = content.slice(startIdx + 'const TOOL_SCHEMAS = '.length, endIdx);

  // Replace TypeScript type assertions with plain values for eval
  const cleaned = schemasStr.replace(/as const/g, '').replace(/as string\[\]/g, '');

  // eslint-disable-next-line no-eval
  const schemas = eval(`(${cleaned})`);
  return schemas;
}

describe('F-5.1: MCP Tool Schema Sync', () => {
  const schemas = extractToolSchemas();
  const schemaByName = new Map(schemas.map((s) => [s.name, s]));

  // MCP-TS-001: All 8 tools are present (4 original + 2 G2: ask_user, stop_child + 2 G4: generate_plan, save_memory)
  describe('MCP-TS-001: TOOL_SCHEMAS has all 8 tools', () => {
    it('contains exactly ask_user, generate_plan, list_sessions, read_transcript, save_memory, send_message, start_task, stop_child', () => {
      const names = schemas.map((s) => s.name).toSorted();
      expect(names).toEqual([
        'ask_user',
        'generate_plan',
        'list_sessions',
        'read_transcript',
        'save_memory',
        'send_message',
        'start_task',
        'stop_child',
      ]);
    });
  });

  // MCP-TS-002: start_task schema
  describe('MCP-TS-002: start_task schema', () => {
    it('requires prompt and title', () => {
      const schema = schemaByName.get('start_task')!;
      expect(schema.inputSchema.required).toContain('prompt');
      expect(schema.inputSchema.required).toContain('title');
    });

    it('has optional model parameter', () => {
      const schema = schemaByName.get('start_task')!;
      expect(schema.inputSchema.properties).toHaveProperty('model');
    });
  });

  // MCP-TS-003: read_transcript schema
  describe('MCP-TS-003: read_transcript schema', () => {
    it('requires session_id', () => {
      const schema = schemaByName.get('read_transcript')!;
      expect(schema.inputSchema.required).toContain('session_id');
    });

    it('has optional limit and max_wait_seconds', () => {
      const schema = schemaByName.get('read_transcript')!;
      expect(schema.inputSchema.properties).toHaveProperty('limit');
      expect(schema.inputSchema.properties).toHaveProperty('max_wait_seconds');
    });
  });

  // MCP-TS-004: list_sessions schema
  describe('MCP-TS-004: list_sessions schema', () => {
    it('has no required parameters', () => {
      const schema = schemaByName.get('list_sessions')!;
      expect(schema.inputSchema.required).toEqual([]);
    });

    it('has optional limit parameter', () => {
      const schema = schemaByName.get('list_sessions')!;
      expect(schema.inputSchema.properties).toHaveProperty('limit');
    });

    it('description mentions session ID', () => {
      const schema = schemaByName.get('list_sessions')!;
      expect(schema.description).toContain('session');
    });
  });

  // MCP-TS-005: send_message schema
  describe('MCP-TS-005: send_message schema', () => {
    it('requires session_id and message', () => {
      const schema = schemaByName.get('send_message')!;
      expect(schema.inputSchema.required).toContain('session_id');
      expect(schema.inputSchema.required).toContain('message');
    });

    it('description mentions idle task resume', () => {
      const schema = schemaByName.get('send_message')!;
      expect(schema.description).toContain('idle');
      expect(schema.description).toContain('resume');
    });
  });

  // MCP-TS-006: All schemas have descriptions
  describe('MCP-TS-006: all schemas have descriptions', () => {
    it('every tool has a non-empty description', () => {
      for (const schema of schemas) {
        expect(schema.description.length).toBeGreaterThan(0);
      }
    });
  });
});
