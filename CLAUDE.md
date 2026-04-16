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

10. **Never open a PR without explicit instruction**: Do NOT create a pull request unless the user explicitly asks for one (e.g. "open a PR", "create PR", "/oss-pr"). Completing a task or committing code is NOT a signal to open a PR.

11. **Commit by feature, not by session**: Each commit must cover exactly one logical change (one feature, one fix, one refactor). Never batch unrelated changes — even if they were completed in the same session — into a single commit. Split them into separate, focused commits.

12. **Test-driven development — maintain E2E coverage**: When a bug is reported, FIRST check whether the E2E tests cover it and whether existing tests have errors. Fix or add tests before (or alongside) fixing the bug. Every bug fix must be accompanied by a test that would have caught it. Keep `tests/e2e/` healthy and up-to-date as the primary quality gate.
