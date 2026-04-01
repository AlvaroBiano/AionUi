/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Skill CRUD operations handler.
 * Extracted from fsBridge.ts.
 */

import type { WsRouter } from '../../router/WsRouter';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getSystemDir, getSkillsDir, getBuiltinSkillsCopyDir } from '@process/utils/initStorage';

export type ResourceType = 'rules' | 'skills' | 'assistant';

/**
 * Resolve builtin resource directory without Electron.
 * In development and standalone server mode: searches relative to process.cwd().
 * Returns first existing candidate, falling back to first candidate path.
 */
export async function findBuiltinResourceDirNode(resourceType: ResourceType): Promise<string> {
  const base = process.cwd();
  const devDir =
    resourceType === 'skills' || resourceType === 'assistant' ? `src/process/resources/${resourceType}` : resourceType;
  const candidates = [path.join(base, devDir), path.join(base, '..', devDir), path.join(base, resourceType)];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next
    }
  }
  return candidates[0];
}

/**
 * Read a builtin resource file (.md only).
 */
async function readBuiltinResource(resourceType: ResourceType, fileName: string): Promise<string> {
  const safeFileName = path.basename(fileName);
  if (!safeFileName.endsWith('.md')) {
    throw new Error('Only .md files are allowed');
  }
  const dir = await findBuiltinResourceDirNode(resourceType);
  return fs.readFile(path.join(dir, safeFileName), 'utf-8');
}

/**
 * Copy directory recursively.
 */
async function copyDirectory(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Parse SKILL.md YAML front matter to extract name and description.
 */
function parseSkillFrontMatter(content: string): { name?: string; description?: string } {
  const frontMatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontMatterMatch) return {};
  const yaml = frontMatterMatch[1];
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const descMatch = yaml.match(/^description:\s*['"]?(.+?)['"]?$/m);
  return {
    name: nameMatch ? nameMatch[1].trim() : undefined,
    description: descMatch ? descMatch[1].trim() : undefined,
  };
}

// ===== Custom external skill paths helpers =====
const getCustomExternalPathsFile = () => path.join(getSystemDir().workDir, 'custom_external_skill_paths.json');

const loadCustomExternalPaths = async (): Promise<Array<{ name: string; path: string }>> => {
  try {
    const filePath = getCustomExternalPathsFile();
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as Array<{ name: string; path: string }>;
  } catch {
    return [];
  }
};

const saveCustomExternalPaths = async (paths: Array<{ name: string; path: string }>) => {
  const filePath = getCustomExternalPathsFile();
  await fs.writeFile(filePath, JSON.stringify(paths, null, 2), 'utf-8');
};

/**
 * Read the bundled SKILL.md for aionui-skills from app resources.
 */
async function readBundledSkillsMarketMd(): Promise<string> {
  try {
    const fallbackPath = path.join(getBuiltinSkillsCopyDir(), 'aionui-skills', 'SKILL.md');
    return await fs.readFile(fallbackPath, 'utf-8');
  } catch (error) {
    console.warn('[FsHandler] Failed to read bundled aionui-skills SKILL.md:', error);
    return `---\nname: aionui-skills\ndescription: "Access the AionUI Skills registry — discover and download AI agent skills."\n---\n\n# AionUI Skills Registry\n\nFetch full instructions:\n\n\`\`\`bash\nmkdir -p ~/.config/aionui-skills\ncurl -s https://skills.aionui.com/SKILL.md > ~/.config/aionui-skills/SKILL.md\n\`\`\`\n\nThen read and follow the instructions in that file.\n`;
  }
}

export function registerSkillOpsHandlers(router: WsRouter): void {
  router.handle('read-builtin-rule', async ({ fileName }) => {
    try {
      return await readBuiltinResource('rules', fileName);
    } catch (error) {
      console.error('Failed to read builtin rule:', error);
      return '';
    }
  });

  router.handle('read-builtin-skill', async ({ fileName }) => {
    try {
      return await readBuiltinResource('skills', fileName);
    } catch (error) {
      console.error('Failed to read builtin skill:', error);
      return '';
    }
  });

  router.handle('list-available-skills', async () => {
    try {
      const skills: Array<{
        name: string;
        description: string;
        location: string;
        isCustom: boolean;
      }> = [];

      const readSkillsFromDir = async (skillsDir: string, isCustomDir: boolean) => {
        try {
          await fs.access(skillsDir);
          const entries = await fs.readdir(skillsDir, { withFileTypes: true });

          for (const entry of entries) {
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            if (entry.name === '_builtin') continue;

            const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');

            try {
              const content = await fs.readFile(skillMdPath, 'utf-8');
              const parsed = parseSkillFrontMatter(content);
              if (parsed.name) {
                skills.push({
                  name: parsed.name,
                  description: parsed.description || '',
                  location: skillMdPath,
                  isCustom: isCustomDir,
                });
              }
            } catch {
              // Skill directory without SKILL.md, skip
            }
          }
        } catch {
          // Directory doesn't exist, skip
        }
      };

      const builtinSkillsDir = getBuiltinSkillsCopyDir();
      const builtinCountBefore = skills.length;
      await readSkillsFromDir(builtinSkillsDir, false);
      const builtinCount = skills.length - builtinCountBefore;

      const userSkillsDir = getSkillsDir();
      const userCountBefore = skills.length;
      await readSkillsFromDir(userSkillsDir, true);
      const userCount = skills.length - userCountBefore;

      // Deduplicate: if a custom skill has the same name as a builtin, keep builtin
      const skillMap = new Map<string, (typeof skills)[number]>();
      for (const skill of skills) {
        const existing = skillMap.get(skill.name);
        if (!existing || !skill.isCustom) {
          skillMap.set(skill.name, skill);
        }
      }
      const result = Array.from(skillMap.values());

      console.log(`[FsHandler] Listed ${result.length} available skills: builtin=${builtinCount}, custom=${userCount}`);

      return result;
    } catch (error) {
      console.error('[FsHandler] Failed to list available skills:', error);
      return [];
    }
  });

  router.handle('read-skill-info', async ({ skillPath }) => {
    try {
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      try {
        await fs.access(skillMdPath);
      } catch {
        return {
          success: false,
          msg: 'SKILL.md file not found in the selected directory',
        };
      }

      const content = await fs.readFile(skillMdPath, 'utf-8');
      const parsed = parseSkillFrontMatter(content);
      const skillName = parsed.name || path.basename(skillPath);

      return {
        success: true,
        data: {
          name: skillName,
          description: parsed.description || '',
        },
        msg: 'Skill info loaded successfully',
      };
    } catch (error) {
      console.error('[FsHandler] Failed to read skill info:', error);
      return {
        success: false,
        msg: `Failed to read skill info: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  router.handle('import-skill', async ({ skillPath }) => {
    try {
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      try {
        await fs.access(skillMdPath);
      } catch {
        return {
          success: false,
          msg: 'SKILL.md file not found in the selected directory',
        };
      }

      const content = await fs.readFile(skillMdPath, 'utf-8');
      const parsed = parseSkillFrontMatter(content);
      const skillName = parsed.name || path.basename(skillPath);

      const userSkillsDir = getSkillsDir();
      const targetDir = path.join(userSkillsDir, skillName);
      const builtinTargetDir = path.join(getBuiltinSkillsCopyDir(), skillName);

      try {
        await fs.access(targetDir);
        console.log(`[FsHandler] Skill "${skillName}" already exists in user skills, skipping import`);
        return {
          success: true,
          data: { skillName },
          msg: `Skill "${skillName}" already exists`,
        };
      } catch {
        // User skill doesn't exist
      }

      try {
        await fs.access(builtinTargetDir);
        return {
          success: false,
          msg: `Skill "${skillName}" already exists in builtin skills`,
        };
      } catch {
        // Builtin skill doesn't exist, proceed with copy
      }

      await copyDirectory(skillPath, targetDir);

      console.log(`[FsHandler] Successfully imported skill "${skillName}" to ${targetDir}`);

      return {
        success: true,
        data: { skillName },
        msg: `Skill "${skillName}" imported successfully`,
      };
    } catch (error) {
      console.error('[FsHandler] Failed to import skill:', error);
      return {
        success: false,
        msg: `Failed to import skill: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  router.handle('scan-for-skills', async ({ folderPath }) => {
    console.log(`[FsHandler] scanForSkills called with path: ${folderPath}`);
    try {
      const skills: Array<{ name: string; description: string; path: string }> = [];

      await fs.access(folderPath);
      const entries = await fs.readdir(folderPath, { withFileTypes: true });
      console.log(`[FsHandler] Found ${entries.length} entries in ${folderPath}`);

      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

        const skillDir = path.join(folderPath, entry.name);
        const skillMdPath = path.join(skillDir, 'SKILL.md');

        try {
          const content = await fs.readFile(skillMdPath, 'utf-8');
          const parsed = parseSkillFrontMatter(content);
          if (parsed.name) {
            skills.push({
              name: parsed.name,
              description: parsed.description || '',
              path: skillDir,
            });
            console.log(`[FsHandler] Found skill in subdirectory: ${parsed.name}`);
          }
        } catch {
          // Skill directory without SKILL.md, skip
        }
      }

      // If no skills in subdirectories, check if the folder itself is a skill
      if (skills.length === 0) {
        console.log(`[FsHandler] No skills in subdirectories, checking if ${folderPath} is a skill itself`);
        const skillMdPath = path.join(folderPath, 'SKILL.md');
        try {
          const content = await fs.readFile(skillMdPath, 'utf-8');
          const parsed = parseSkillFrontMatter(content);
          if (parsed.name) {
            skills.push({
              name: parsed.name,
              description: parsed.description || '',
              path: folderPath,
            });
            console.log(`[FsHandler] Found skill in the folder itself: ${parsed.name}`);
          }
        } catch {
          // Not a skill directory
        }
      }

      console.log(`[FsHandler] scanForSkills finished. Found ${skills.length} skills.`);
      return {
        success: true,
        data: skills,
        msg: `Found ${skills.length} skills`,
      };
    } catch (error) {
      console.error('[FsHandler] Failed to scan skills:', error);
      return {
        success: false,
        msg: `Failed to scan skills: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  router.handle('detect-common-skill-paths', async () => {
    try {
      const homedir = os.homedir();
      const candidates = [
        { name: 'Global Agents', path: path.join(homedir, '.agents', 'skills') },
        { name: 'Gemini CLI', path: path.join(homedir, '.gemini', 'skills') },
        { name: 'Claude Code', path: path.join(homedir, '.claude', 'skills') },
        { name: 'OpenCode', path: path.join(homedir, '.config', 'opencode', 'skills') },
        { name: 'OpenCode (Alt)', path: path.join(homedir, '.opencode', 'skills') },
      ];

      const detected: Array<{ name: string; path: string }> = [];
      for (const candidate of candidates) {
        try {
          await fs.access(candidate.path);
          detected.push(candidate);
        } catch {
          // Path doesn't exist
        }
      }

      return {
        success: true,
        data: detected,
        msg: `Detected ${detected.length} common paths`,
      };
    } catch (error) {
      console.error('[FsHandler] Failed to detect common paths:', error);
      return {
        success: false,
        msg: 'Failed to detect common paths',
      };
    }
  });

  router.handle('get-custom-external-paths', async () => {
    return loadCustomExternalPaths();
  });

  router.handle('add-custom-external-path', async ({ name, path: skillPath }) => {
    try {
      const existing = await loadCustomExternalPaths();
      if (existing.some((p) => p.path === skillPath)) {
        return { success: false, msg: 'Path already exists' };
      }
      existing.push({ name, path: skillPath });
      await saveCustomExternalPaths(existing);
      return { success: true, msg: 'Custom path added' };
    } catch (error) {
      return {
        success: false,
        msg: `Failed to add path: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  router.handle('remove-custom-external-path', async ({ path: skillPath }) => {
    try {
      const existing = await loadCustomExternalPaths();
      const filtered = existing.filter((p) => p.path !== skillPath);
      await saveCustomExternalPaths(filtered);
      return { success: true, msg: 'Custom path removed' };
    } catch (error) {
      return {
        success: false,
        msg: `Failed to remove path: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  router.handle('detect-and-count-external-skills', async () => {
    try {
      const homedir = os.homedir();
      const builtinCandidates = [
        { name: 'Global Agents', path: path.join(homedir, '.agents', 'skills'), source: 'global-agents' },
        { name: 'Gemini CLI', path: path.join(homedir, '.gemini', 'skills'), source: 'gemini' },
        { name: 'Claude Code', path: path.join(homedir, '.claude', 'skills'), source: 'claude' },
        { name: 'OpenCode', path: path.join(homedir, '.config', 'opencode', 'skills'), source: 'opencode' },
        { name: 'OpenCode (Alt)', path: path.join(homedir, '.opencode', 'skills'), source: 'opencode-alt' },
      ];

      const customPaths = await loadCustomExternalPaths();
      const candidates = [
        ...builtinCandidates,
        ...customPaths.map((cp) => ({
          name: cp.name,
          path: cp.path,
          source: `custom-${cp.path}`,
        })),
      ];

      const results: Array<{
        name: string;
        path: string;
        source: string;
        skills: Array<{ name: string; description: string; path: string }>;
      }> = [];

      for (const candidate of candidates) {
        try {
          await fs.access(candidate.path);
          const entries = await fs.readdir(candidate.path, { withFileTypes: true });
          const skills: Array<{ name: string; description: string; path: string }> = [];

          for (const entry of entries) {
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            const skillDir = path.join(candidate.path, entry.name);

            const tryParseSkill = async (dir: string, fallbackName: string) => {
              const skillMdPath = path.join(dir, 'SKILL.md');
              try {
                const content = await fs.readFile(skillMdPath, 'utf-8');
                const parsed = parseSkillFrontMatter(content);
                if (parsed.name || fallbackName) {
                  return {
                    name: parsed.name || fallbackName,
                    description: parsed.description || '',
                    path: dir,
                  };
                }
              } catch {
                // No SKILL.md or parse error
              }
              return null;
            };

            // Case 1: Direct skill — has SKILL.md at the root
            const directSkill = await tryParseSkill(skillDir, entry.name);
            if (directSkill) {
              skills.push(directSkill);
              continue;
            }

            // Case 2: Skill pack — nested skills/ subdirectory
            const nestedSkillsDir = path.join(skillDir, 'skills');
            try {
              await fs.access(nestedSkillsDir);
              const nestedEntries = await fs.readdir(nestedSkillsDir, { withFileTypes: true });
              for (const nestedEntry of nestedEntries) {
                if (!nestedEntry.isDirectory() && !nestedEntry.isSymbolicLink()) continue;
                const nestedDir = path.join(nestedSkillsDir, nestedEntry.name);
                const nestedSkill = await tryParseSkill(nestedDir, nestedEntry.name);
                if (nestedSkill) {
                  skills.push(nestedSkill);
                }
              }
            } catch {
              // No nested skills/ dir
            }
          }

          if (skills.length > 0) {
            results.push({
              name: candidate.name,
              path: candidate.path,
              source: candidate.source,
              skills,
            });
          }
        } catch {
          // Path doesn't exist
        }
      }

      return {
        success: true,
        data: results,
        msg: `Found ${results.reduce((sum, r) => sum + r.skills.length, 0)} unimported external skills`,
      };
    } catch (error) {
      console.error('[FsHandler] Failed to detect external skills:', error);
      return {
        success: false,
        msg: 'Failed to detect external skills',
      };
    }
  });

  router.handle('import-skill-with-symlink', async ({ skillPath }) => {
    try {
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      try {
        await fs.access(skillMdPath);
      } catch {
        return {
          success: false,
          msg: 'SKILL.md file not found in the selected directory',
        };
      }

      const content = await fs.readFile(skillMdPath, 'utf-8');
      const parsed = parseSkillFrontMatter(content);
      const skillName = parsed.name || path.basename(skillPath);

      const userSkillsDir = getSkillsDir();
      const targetDir = path.join(userSkillsDir, skillName);

      await fs.mkdir(userSkillsDir, { recursive: true });

      try {
        await fs.access(targetDir);
        return { success: false, msg: `Skill "${skillName}" already exists` };
      } catch {
        // Does not exist, proceed
      }

      await fs.symlink(skillPath, targetDir, 'junction');
      console.log(`[FsHandler] Created symlink for skill "${skillName}" at ${targetDir}`);
      return {
        success: true,
        data: { skillName },
        msg: `Skill "${skillName}" imported successfully`,
      };
    } catch (error) {
      console.error('[FsHandler] Failed to import skill with symlink:', error);
      return {
        success: false,
        msg: `Failed to import skill: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  router.handle('delete-skill', async ({ skillName }) => {
    try {
      const userSkillsDir = getSkillsDir();
      const skillDir = path.join(userSkillsDir, skillName);

      const resolvedSkillDir = path.resolve(skillDir);
      const resolvedSkillsDir = path.resolve(userSkillsDir);
      if (!resolvedSkillDir.startsWith(resolvedSkillsDir + path.sep)) {
        return {
          success: false,
          msg: 'Invalid skill path (security check failed)',
        };
      }

      try {
        await fs.access(resolvedSkillDir);
      } catch {
        return { success: false, msg: `Skill "${skillName}" not found` };
      }

      const stat = await fs.lstat(resolvedSkillDir);
      if (stat.isSymbolicLink()) {
        await fs.unlink(resolvedSkillDir);
      } else {
        await fs.rm(resolvedSkillDir, { recursive: true, force: true });
      }

      console.log(`[FsHandler] Deleted skill "${skillName}" from ${resolvedSkillDir}`);
      return { success: true, msg: `Skill "${skillName}" deleted` };
    } catch (error) {
      console.error('[FsHandler] Failed to delete skill:', error);
      return {
        success: false,
        msg: `Failed to delete skill: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  router.handle('get-skill-paths', async () => ({
    userSkillsDir: getSkillsDir(),
    builtinSkillsDir: getBuiltinSkillsCopyDir(),
  }));

  router.handle('export-skill-with-symlink', async ({ skillPath, targetDir }) => {
    try {
      const skillName = path.basename(skillPath);
      const targetPath = path.join(targetDir, skillName);

      await fs.mkdir(targetDir, { recursive: true });

      try {
        await fs.access(targetPath);
        return {
          success: false,
          msg: `Target already exists: ${targetPath}`,
        };
      } catch {
        // Path does not exist, proceed
      }

      await fs.symlink(skillPath, targetPath, 'junction');
      console.log(`[FsHandler] Exported skill "${skillName}" to ${targetPath} via symlink`);

      return { success: true, msg: `Successfully exported to ${targetPath}` };
    } catch (error) {
      console.error('[FsHandler] Failed to export skill with symlink:', error);
      return {
        success: false,
        msg: `Failed to export skill: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  router.handle('enable-skills-market', async () => {
    try {
      const { getAutoSkillsDir } = await import('@process/utils/initStorage');
      const skillDir = path.join(getAutoSkillsDir(), 'aionui-skills');
      await fs.mkdir(skillDir, { recursive: true });

      const content = await readBundledSkillsMarketMd();
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8');

      const { AcpSkillManager } = await import('@process/task/AcpSkillManager');
      AcpSkillManager.resetInstance();

      return { success: true, msg: 'Skills Market skill enabled' };
    } catch (error) {
      console.error('[FsHandler] Failed to enable Skills Market:', error);
      return {
        success: false,
        msg: `Failed to enable Skills Market: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  router.handle('disable-skills-market', async () => {
    try {
      const { getAutoSkillsDir } = await import('@process/utils/initStorage');
      const skillDir = path.join(getAutoSkillsDir(), 'aionui-skills');
      await fs.rm(skillDir, { recursive: true, force: true });

      const { AcpSkillManager } = await import('@process/task/AcpSkillManager');
      AcpSkillManager.resetInstance();

      return { success: true, msg: 'Skills Market skill disabled' };
    } catch (error) {
      console.error('[FsHandler] Failed to disable Skills Market:', error);
      return {
        success: false,
        msg: `Failed to disable Skills Market: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });
}
