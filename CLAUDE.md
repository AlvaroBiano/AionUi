@AGENTS.md

## Behavioral Rules

1. **Language**: Always respond in Chinese (中文) unless explicitly asked for another language. Never switch to Korean or English mid-conversation.

2. **Repository-wide changes**: When modifying shared files (README, images, links, configs), always search for ALL affected files across ALL language versions before making any change. Use `Glob` or `Grep` to find every reference. Do not commit until all versions are updated.

3. **Git branching**: Always create a separate branch for each feature or fix. Never mix unrelated changes in a single branch or PR.

4. **Multi-agent roles**: When working as part of a multi-agent team, strictly follow your assigned role boundaries. If you are a moderator/judge, do NOT produce content that other agents should produce. If you are a debater, stay on your assigned side only.

5. **Before pushing**: Before pushing conflict resolutions or large changes, always check remote state first with `git fetch && git status` to avoid duplicating work someone else already completed.

6. **Release notes**: When writing release notes or changelogs, only include changes from the specific version being released. Verify each item against the actual commits/PRs for that version — never carry forward content from previous releases.

7. **Multi-file tasks**: When a task involves 3 or more files, always state the plan first (list of files to be changed and what will change in each) and wait for confirmation before executing.

8. **Commit granularity**: After completing each feature or fix, commit immediately with a focused commit message. Never batch multiple unrelated features into one commit. One logical change = one commit.

9. **No design assets in commits**: Never commit design drafts, mockup images, or other non-production files (e.g. `docs/design/`, `*.sketch`, temp images). Keep them local only.
