/**
 * Sanitize a skill name for use as a directory name.
 * Replaces characters that are invalid in file paths (Windows: /\:*?"<>|)
 * with hyphens and strips leading/trailing hyphens.
 */
export function sanitizeSkillName(name: string): string {
  return name.replace(/[/\\:*?"<>|]+/g, '-').replace(/^-+|-+$/g, '');
}
