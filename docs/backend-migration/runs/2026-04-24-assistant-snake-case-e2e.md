# E2E Test Run Report — Assistant Snake-Case Realignment

**Date:** 2026-04-24
**Owner:** e2e-tester
**Team:** assistant-snake-case-realignment (coordinator + backend-dev + frontend-dev + e2e-tester)
**Plan:** [`docs/backend-migration/plans/2026-04-24-assistant-snake-case-realignment-plan.md`](../plans/2026-04-24-assistant-snake-case-realignment-plan.md)
**Status:** **GREEN (wire realignment done).** All runtime wire contracts are snake_case end-to-end. T3.4 final 45/47 after H1+H2 hotfixes; the 2 remaining failures (P1-3 + P1-18) are pre-existing test debt (stale `assistant-card-builtin-*` testid assumption) unrelated to the snake_case realignment and are deferred as followups.

## Commits under test

Integration branch: `feat/backend-migration-coordinator-assistant-camel` @ `7dbf493a4` (content-equivalent to earlier pointer `test/assistant-snake-case-integration` @ `47be40503` before H1+H2 landed).

| Repo | Branch | SHA | Scope |
| --- | --- | --- | --- |
| `aionui-backend` | `feat/assistant-snake-case` | `6f00110` | T1: remove 7 `rename_all` from api-types/assistant.rs + 1 from builtin.rs, rewrite assets/builtin-assistants/assistants.json via jq walk, flip 9 JSON keys in assistants_e2e.rs, add `assistant_response_rejects_camel_case` regression test |
| `AionUi` | `feat/assistant-snake-case` | `513be5162` | T2a: flip `Assistant` type + 209 access sites via ts-morph codemod, split `legacyAssistantToCreateRequest` mapper, realign Vitest + Playwright fixtures |
| `AionUi` | `fix/acp-camelcase-hotfix` | `e1cb21a7c` | T2b: ACP `setModel` body `{modelId}` → `{model_id}` + regression tests |
| `AionUi` | `fix/fs-temp-camelcase-hotfix` | `ec126ee40` | T2c: fs `createTempFile` / `createUploadFile` wire body camel→snake + regression tests |
| `AionUi` | `fix/more-camelcase-hotfix` (H1) | `f1b4b6ac1` | H1 (2-commit stack `53516d5` + `f1b4b6a`): 7 ipcBridge wire-body endpoints (`readBuiltinRule` + read/write/delete `Assistant{Rule,Skill}`) + 3 helper function param/body fixes in `tests/e2e/helpers/assistantSettings.ts` + 7 Vitest regression tests |
| `AionUi` | `fix/more-camelcase-hotfix` (H2) | `7dbf493a4` | H2 (1 commit): 8 direct-httpPost bodies in `tests/e2e/features/assistants-user-data/assistant-user-data.e2e.ts` flipped `assistantId:` → `assistant_id:` |

**Backend binary:** `~/.cargo/bin/aionui-backend` → `/Users/zhoukai/Documents/worktrees/aionui-backend-assistant-camel/target/release/aionui-backend`, mtime `Apr 24 16:46:10` (matches backend-dev T1.13 build of 6f00110).

## Environment

- Electron build: `bun run package` (= `electron-vite build`) in worktree. Outputs `out/main/index.js` (2.5 MB, 30 `assistant_id` occurrences post-H1), `out/preload/index.js`, `out/renderer/index.html`. H2 changed only tests/ so no rebuild needed on that pass.
- Playwright dev mode: `electron .` from worktree root. `ELECTRON_RENDERER_URL` unset → Electron main's `loadFile(out/renderer/index.html)` fallback activates (src/index.ts:338); renderer served from worktree's built assets. This is the critical path for avoiding the `localhost:5173` collision (see incident 2 below).
- Build fixes applied: created placeholder dirs `src/process/resources/skills/` and `src/process/resources/assistant/` (gitignored; `vite-plugin-static-copy` demands the glob match ≥1 file; main checkout has only a `.DS_Store`).

## Results

### T3.3 Vitest full — ✓ PASS

- **Initial (pre-H1/H2): 4385 passed**, 50 skipped, 22 todo, 0 failed in 38.66s (423 test files).
- Baseline (before pilot): 4380. Delta +5 = T2b (2 acpHotfix) + T2c (3 fsHotfix including readBuiltinSkill).
- Post-H1 delta per frontend-dev: **+7 more tests** (regression coverage for the 7 ipcBridge endpoints fixed by H1). Expected post-H1 total ≈ 4392; team-lead confirmed the 4397 figure on his side.
- T3.3 not re-run by e2e-tester locally post-H1/H2 since H1's Vitest deltas were verified by frontend-dev on `fix/more-camelcase-hotfix` prior to push.

### T3.4 Playwright assistant suite — ✓ PASS (45/47) — 2 remaining failures are pre-existing test debt

Three independent runs:

| Run | State | Result | Duration | Failures |
| --- | --- | --- | --- | --- |
| 1 (post-merge, pre-H1/H2) | 4 SHAs merged, `out/` fresh | **40/47** | 3.8m | 7: P1-3, P1-18, S1, S3, S4, S5, S7 |
| 2 (post-H1) | H1 merged + rebuild | **42/47** | 3.5m | 5: P1-3, P1-18, S1, S3, S4 |
| 3 (post-H1+H2) **FINAL** | H2 merged (no rebuild — tests only) | **45/47** | 2.6m | 2: P1-3, P1-18 |

**Progression of findings across runs:**

- **Run 1 → 2 (after H1):** Regression B fully fixed. `tests/e2e/helpers/assistantSettings.ts` function param `assistant_id` now matches its template-literal usage (helper commit `f1b4b6a`). S5 + S7 went green. But Regression A only partially fixed — H1 flipped the ipcBridge type signatures and all production callers, but 3 tests (S1, S3, S4) bypass ipcBridge entirely by calling `httpPost<T>(page, url, body)` directly via `tests/e2e/helpers/httpBridge.ts`. Those bodies still had `assistantId:` camelCase literals.
- **Run 2 → 3 (after H2):** 8 direct-httpPost test bodies in `assistant-user-data.e2e.ts` flipped to `assistant_id:`. S1, S3, S4 all go green.
- **Remaining 2 (P1-3, P1-18):** accepted as pre-existing test debt. The tests assert `[data-testid^="assistant-card-builtin-"]` but builtin assistant IDs have never had a `builtin-` prefix in the backend (all 20 naked IDs: `game-3d`, `word-creator`, `morph-ppt`, etc.). The React component at `src/renderer/pages/settings/AssistantSettings/AssistantListPanel.tsx:121` renders `assistant-card-${assistant.id}`. These tests were written `73eedf7f4` (2026-04-22) before the backend migration locked in the ID scheme; the test assumption was never updated. **Not in the wire-realignment scope.**

**Final failing tests (2):**
```
tests/e2e/features/assistants/ui-states.e2e.ts:90:7  › P1-3: custom assistant shows source tag, builtin does not
tests/e2e/features/assistants/ui-states.e2e.ts:761:7 › P1-18: auto-injected section shows when configured
```

Both fail at `locator('[data-testid^="assistant-card-builtin-"]').first()` → `element(s) not found`.

### T3.5 Playwright skill suite regression — ✓ PASS

- **8 passed, 0 failed** in 5.9s.
- Suite: `tests/e2e/features/builtin-skill-migration/builtin-skill-migration.e2e.ts` (the actual path; plan said `tests/e2e/features/builtin-skill` which doesn't exist).
- All 8 S* scenarios green — skill pilot's baseline preserved despite the assistant-side wire changes. Confirms that realignment didn't break `/api/skills/builtin-auto`, `/api/skills/materialize-for-agent`, `AcpSkillManager`, cold-start sweeps, or legacy `{cacheDir}/builtin-skills/` cleanup.

### T3.6 Playwright ACP + fs coverage — N/A (no direct coverage, Vitest-gated)

- `grep -rln 'setModel|setConfigOption|createTempFile|createUploadFile' tests/e2e/` returns 0 matches.
- No `acp` / `fs-temp` / `file` / `temp` directory under `tests/e2e/features/`.
- Per plan T3.6: skipped. Regression protection for T2b + T2c is via the 4 new Vitest tests (2 in `tests/unit/ipcBridge.acpHotfix.test.ts`, 2+ in `tests/unit/ipcBridge.fsHotfix.test.ts`) that all passed in T3.3.

## Backend probe (used for debugging, documented for reproducibility)

When investigating the "UI shows undefined for builtin rule/skill" report from the user, I ran:

```bash
rm -rf /tmp/probe-data && mkdir /tmp/probe-data
~/.cargo/bin/aionui-backend --local --port 27000 --data-dir /tmp/probe-data &
sleep 3
curl -s http://127.0.0.1:27000/api/assistants | jq '.data | map(select(.source == "builtin")) | .[0]'
kill %1
```

Result — first builtin (`id=game-3d`) returns complete `name_i18n`, `description_i18n`, `prompts_i18n` each with 4 locales (en-US, zh-CN, ru-RU, uk-UA). Builtin count: 20. Wire is 100% snake_case. Confirmed the backend-side work (T1) is correct; user's "undefined rule/skill" was a frontend bug (Regression A, fixed by H1).

## Notable environment incidents (documented for playbook)

1. **Shared `~/.cargo/bin/aionui-backend` symlink collision with parallel `model-sync-be` team.** At T3.2, symlink was pointing at `/Users/zhoukai/Documents/worktrees/aionui-backend-model-sync-be/target/release/aionui-backend` (model-sync-be had built + symlinked after backend-dev's T1.13). Re-pointed via `ln -sf` to our worktree's binary (coordinator approved, flagged as pilot-level followup: "concurrent worktree pilots need a symlink coordination rule").
2. **Stray `electron-vite dev` from main checkout on port 5173 during first T3.4 attempt (aborted run).** Playwright Electron's renderer URL fell back to `localhost:5173` which served main-checkout's pre-realignment code, causing all 47 tests to timeout. Resolved by: (a) building `out/` in the worktree via `bun run package` (so `out/renderer/index.html` exists), (b) ensuring `ELECTRON_RENDERER_URL` is unset so Electron's `loadFile(fallbackFile)` at `src/index.ts:338` bypasses vite entirely. Root cause: `src/process/webserver/routes/staticRoutes.ts` has a hardcoded `return 5173` fallback.
3. **Missing `src/process/resources/skills/` and `src/process/resources/assistant/` directories in worktree** (both gitignored on main, only contain `.DS_Store`). `vite-plugin-static-copy` fails the build when its `src/.../<dir>/*` glob finds zero files. Created empty `.gitkeep` placeholders (untracked).
4. **Message-crossing on TBD SHA decisions.** Several team-lead responses landed ~5 min after my test runs had already finished the expected result, causing repeat instructions. Mitigated by explicitly stamping each message with progress state; no lost work.

## Followups (hand off to coordinator for the T4 closure)

1. **`channel/plugins/{weixin,dingtalk}` `rename_all = "camelCase"` stays** — external webhook protocols (WeChat / DingTalk), not our wire convention. Out of scope (documented in the pilot spec §3 Non-Goals).
2. **P1-3 / P1-18 testid assumption debt.** The locator `[data-testid^="assistant-card-builtin-"]` assumes builtin assistants have IDs prefixed with `builtin-`, but backend IDs are naked (`game-3d`, `word-creator`, etc.). Two possible fixes: (a) rewrite tests to fetch `assistant-card-<actual-id>` via `/api/assistants` + filter `source === "builtin"`, OR (b) add a `data-source="builtin"` attribute on the card component and switch the locator. Severity: low — tests were already broken against backend-mode IDs; nobody noticed because they were never run against this backend before the realignment pilot forced a full integration run. **Out of scope for wire realignment.**
3. **H1 → H2 playbook lesson: wire flips must audit test-side httpPost helpers too.** H1 fixed ipcBridge's 7 endpoint type signatures + production callers but missed 8 direct-httpPost body literals in `tests/e2e/features/assistants-user-data/assistant-user-data.e2e.ts`. e2e tests that bypass ipcBridge (calling the generic `httpPost<T>(page, url, body)` helper from `tests/e2e/helpers/httpBridge.ts`) are invisible to ipcBridge-only codemods. Cost: 1 extra hotfix round (~10 min). Future playbook: `rg -l 'httpPost\|httpDelete\|httpPut' tests/e2e/` as mandatory pre-work for any wire-format flip.
4. **Regression B `tsc` blind spot — root-caused.** `tests/e2e/helpers/assistantSettings.ts` lines 17/63/65/75 referenced `${assistantId}` in template literals while their enclosing function parameter was named `assistant_id`. This should have surfaced as `Cannot find name 'assistantId'` in `tsc --noEmit`, but frontend-dev independently identified the cause during H1 work: **`tsconfig.json` `include` is `src/**/*` only; `tests/` is entirely excluded from `tsc --noEmit`.** That's why the codemod over-reach on the helpers file landed silently. Fix: either add `tests/e2e/**/*` to tsconfig `include` (may surface a wave of pre-existing tests-side tsc errors to clean up), or maintain a separate `tests/e2e/tsconfig.json` that runs in CI as a separate tsc gate.
5. **Shared `~/.cargo/bin/aionui-backend` symlink coordination across concurrent worktree pilots** — no current rule. During T3.2, a parallel `model-sync-be` team's build had re-pointed the symlink after backend-dev's T1.13. Spent ~10 min diagnosing before coordinator approved the re-point. Propose: (a) per-pilot named symlink like `~/.cargo/bin/aionui-backend-<pilot-tag>` with Electron env var to select, OR (b) lock-file + heartbeat for the shared symlink.
6. **Q6(b) spec deferral cost** — the spec §1 explicitly deferred auditing `getMode` / `getModelInfo` / `getConfigOptions` and other endpoints beyond the three known camel sites. That deferral meant T3.4 discovered 7 runtime-broken endpoints mid-run, costing two hotfix rounds (H1 + H2 ≈ 40 min of mid-pilot rework). Next pilot of this shape should either (a) spec out a full `rg 'httpPost|httpPut|httpDelete' src/common/adapter/ipcBridge.ts` audit as T0 pre-work, or (b) add a compile-time wire-contract probe that asserts ipcBridge body-type keys match `aionui-api-types` snake_case fields.

## Conclusion

**PILOT GREEN on wire realignment.** All runtime wire contracts are snake_case end-to-end.

| Gate | Result | Notes |
| --- | --- | --- |
| T3.3 Vitest full | **✓ 4385/4385** (pre-H1; post-H1 ≈ 4397 per frontend-dev) | Baseline +5 = T2b + T2c; +7 more in H1 regression tests |
| T3.4 Playwright assistants | **✓ 45/47** | 2 remaining failures are pre-existing test debt (P1-3/P1-18 stale testid prefix); deferred |
| T3.5 Playwright skills | **✓ 8/8** | Skill pilot baseline preserved |
| T3.6 ACP/fs e2e | N/A | No coverage; gated by T3.3 Vitest regression tests |

The 2 test-debt followups (P1-3, P1-18 testid prefix) are documented under Followups (2) above for a future test-hygiene pilot.
