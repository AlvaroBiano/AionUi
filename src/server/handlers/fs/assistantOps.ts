/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Assistant rule/skill operations handler.
 * Extracted from fsBridge.ts.
 */

import type { WsRouter } from '../../router/WsRouter';
import fs from 'fs/promises';
import path from 'path';
import { getAssistantsDir } from '@process/utils/initStorage';
import { findBuiltinResourceDirNode, type ResourceType } from './skillOps';

/**
 * Read assistant resource file with locale fallback.
 */
async function readAssistantResource(
  resourceType: ResourceType,
  assistantId: string,
  locale: string,
  fileNamePattern: (id: string, loc: string) => string,
): Promise<string> {
  const assistantsDir = getAssistantsDir();
  const locales = [locale, 'en-US', 'zh-CN'].filter((l, i, arr) => arr.indexOf(l) === i);

  // 1. Try user data directory first
  for (const loc of locales) {
    const fileName = fileNamePattern(assistantId, loc);
    try {
      return await fs.readFile(path.join(assistantsDir, fileName), 'utf-8');
    } catch {
      // Try next locale
    }
  }

  // 2. Fallback to builtin directory
  const builtinDir = await findBuiltinResourceDirNode(resourceType);
  for (const loc of locales) {
    const fileName = fileNamePattern(assistantId, loc);
    try {
      const content = await fs.readFile(path.join(builtinDir, fileName), 'utf-8');
      console.log(`[FsHandler] Read builtin ${resourceType} for ${assistantId}: ${fileName}`);
      return content;
    } catch {
      // Try next locale
    }
  }

  return '';
}

/**
 * Write assistant resource file to user directory.
 */
async function writeAssistantResource(
  resourceType: ResourceType,
  assistantId: string,
  content: string,
  locale: string,
  fileNamePattern: (id: string, loc: string) => string,
): Promise<boolean> {
  try {
    const assistantsDir = getAssistantsDir();
    await fs.mkdir(assistantsDir, { recursive: true });
    const fileName = fileNamePattern(assistantId, locale);
    await fs.writeFile(path.join(assistantsDir, fileName), content, 'utf-8');
    console.log(`[FsHandler] Wrote assistant ${resourceType}: ${fileName}`);
    return true;
  } catch (error) {
    console.error(`Failed to write assistant ${resourceType}:`, error);
    return false;
  }
}

/**
 * Delete assistant resource files (all locale versions).
 */
async function deleteAssistantResource(resourceType: ResourceType, filePattern: RegExp): Promise<boolean> {
  try {
    const assistantsDir = getAssistantsDir();
    const files = await fs.readdir(assistantsDir);
    for (const file of files) {
      if (filePattern.test(file)) {
        await fs.unlink(path.join(assistantsDir, file));
        console.log(`[FsHandler] Deleted assistant ${resourceType}: ${file}`);
      }
    }
    return true;
  } catch (error) {
    console.error(`Failed to delete assistant ${resourceType}:`, error);
    return false;
  }
}

// File name patterns for rules and skills
const ruleFilePattern = (id: string, loc: string) => `${id}.${loc}.md`;
const skillFilePattern = (id: string, loc: string) => `${id}-skills.${loc}.md`;

export function registerAssistantOpsHandlers(router: WsRouter): void {
  router.handle('read-assistant-rule', async ({ assistantId, locale = 'en-US' }) => {
    try {
      return await readAssistantResource('rules', assistantId, locale, ruleFilePattern);
    } catch (error) {
      console.error('Failed to read assistant rule:', error);
      throw error;
    }
  });

  router.handle('write-assistant-rule', ({ assistantId, content, locale = 'en-US' }) => {
    return writeAssistantResource('rules', assistantId, content, locale, ruleFilePattern);
  });

  router.handle('delete-assistant-rule', ({ assistantId }) => {
    return deleteAssistantResource('rules', new RegExp(`^${assistantId}\\..*\\.md$`));
  });

  router.handle('read-assistant-skill', async ({ assistantId, locale = 'en-US' }) => {
    try {
      return await readAssistantResource('skills', assistantId, locale, skillFilePattern);
    } catch (error) {
      console.error('Failed to read assistant skill:', error);
      throw error;
    }
  });

  router.handle('write-assistant-skill', ({ assistantId, content, locale = 'en-US' }) => {
    return writeAssistantResource('skills', assistantId, content, locale, skillFilePattern);
  });

  router.handle('delete-assistant-skill', ({ assistantId }) => {
    return deleteAssistantResource('skills', new RegExp(`^${assistantId}-skills\\..*\\.md$`));
  });
}
