/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/teamConfigLoader.ts

import fs from 'node:fs';
import path from 'node:path';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

/** Maximum characters for the generated prompt section */
const MAX_PROMPT_CHARS = 3000;

/**
 * Parsed team config data suitable for prompt injection.
 */
export type TeamConfigPromptData = {
  /** Human-readable summary for prompt injection */
  promptSection: string;
  /** Available role names (for admin to reference in start_task) */
  availableRoles: string[];
  /** Task grading rules (S/M/L) if defined */
  taskGrading?: string;
  /** Quality gates (lint, test, type check commands) */
  qualityGates?: string[];
};

/**
 * Load and parse a team config from .claude/teams/{teamName}.json.
 * Extracts prompt-injectable sections: roles, workflow, grading, quality gates.
 *
 * Returns null if the file does not exist or is malformed (graceful degradation).
 */
export async function loadTeamConfig(
  workspace: string,
  teamName: string,
): Promise<TeamConfigPromptData | null> {
  const configPath = path.join(workspace, '.claude', 'teams', `${teamName}.json`);

  try {
    const raw = await fs.promises.readFile(configPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null) {
      mainWarn('[TeamConfigLoader]', `Invalid team config (not an object): ${configPath}`);
      return null;
    }

    const config = parsed as Record<string, unknown>;

    // Extract roles
    const roles: Array<{ name: string; description?: string; prompt?: string }> = [];
    if (Array.isArray(config.roles)) {
      for (const role of config.roles) {
        if (typeof role === 'object' && role !== null && typeof (role as Record<string, unknown>).name === 'string') {
          const r = role as Record<string, unknown>;
          roles.push({
            name: String(r.name),
            description: typeof r.description === 'string' ? r.description : undefined,
            prompt: typeof r.prompt === 'string' ? r.prompt : undefined,
          });
        }
      }
    }

    // Extract workflow (S/M/L grading)
    let taskGrading: string | undefined;
    if (typeof config.workflow === 'object' && config.workflow !== null) {
      const wf = config.workflow as Record<string, unknown>;
      const parts: string[] = [];
      for (const [size, desc] of Object.entries(wf)) {
        if (typeof desc === 'string') {
          parts.push(`- ${size}: ${desc}`);
        }
      }
      if (parts.length > 0) {
        taskGrading = parts.join('\n');
      }
    }

    // Extract quality gates
    let qualityGates: string[] | undefined;
    if (Array.isArray(config.qualityGates)) {
      qualityGates = config.qualityGates.filter((g): g is string => typeof g === 'string');
      if (qualityGates.length === 0) qualityGates = undefined;
    }

    // Build prompt section
    const sections: string[] = [];

    if (roles.length > 0) {
      sections.push('### Roles');
      for (const role of roles) {
        const desc = role.description ? `: ${role.description}` : '';
        sections.push(`- **${role.name}**${desc}`);
        if (role.prompt) {
          sections.push(`  Prompt: ${role.prompt.slice(0, 200)}`);
        }
      }
    }

    if (taskGrading) {
      sections.push('\n### Task Grading');
      sections.push(taskGrading);
    }

    if (qualityGates && qualityGates.length > 0) {
      sections.push('\n### Quality Gates');
      for (const gate of qualityGates) {
        sections.push(`- \`${gate}\``);
      }
    }

    // Extract cost limits if present
    if (typeof config.costLimits === 'object' && config.costLimits !== null) {
      const cl = config.costLimits as Record<string, unknown>;
      const limitParts: string[] = [];
      if (typeof cl.maxToolCalls === 'number') {
        limitParts.push(`Max tool calls per task: ${cl.maxToolCalls}`);
      }
      if (limitParts.length > 0) {
        sections.push('\n### Cost Limits');
        for (const part of limitParts) {
          sections.push(`- ${part}`);
        }
      }
    }

    let promptSection = sections.join('\n');

    // Enforce character budget
    if (promptSection.length > MAX_PROMPT_CHARS) {
      promptSection = promptSection.slice(0, MAX_PROMPT_CHARS - 3) + '...';
    }

    if (promptSection.length === 0) {
      mainWarn('[TeamConfigLoader]', `Team config has no extractable content: ${configPath}`);
      return null;
    }

    mainLog('[TeamConfigLoader]', `Loaded team config: ${teamName} (${promptSection.length} chars, ${roles.length} roles)`);

    return {
      promptSection,
      availableRoles: roles.map((r) => r.name),
      taskGrading,
      qualityGates,
    };
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      mainLog('[TeamConfigLoader]', `Team config not found: ${configPath}`);
    } else {
      mainWarn('[TeamConfigLoader]', `Failed to load team config: ${configPath}`, err);
    }
    return null;
  }
}

/**
 * Enumerate available team config files from .claude/teams/*.json.
 * Returns an array of { name, path } entries, or empty array if directory does not exist.
 */
export async function listAvailableTeamConfigs(
  workspace: string,
): Promise<Array<{ name: string; path: string }>> {
  const teamsDir = path.join(workspace, '.claude', 'teams');

  try {
    const entries = await fs.promises.readdir(teamsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => ({
        name: e.name.replace(/\.json$/, ''),
        path: path.join(teamsDir, e.name),
      }));
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Directory does not exist — normal case
      return [];
    }
    mainWarn('[TeamConfigLoader]', `Failed to list team configs: ${teamsDir}`, err);
    return [];
  }
}
