# S2 Task Card — ARCH-2 Cross-surface Features Phase Gate

> 本门按 Policy v2 复用仍有效证据，只补 ARCH-2 实际改动与已登记风险；完整 V4 只在 ARCH-5 运行一次。

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: phase-gate
- Necessity / skip condition: 本阶段已有 Media/Components/Runtime/Interactions、global controls、Diagnostics 与 Mixed Player 产品提交，且 W2-B1 性能为 amber；若所有门禁证据已绑定当前产品提交、性能风险已有一次同协议最终判定且 generated truth fresh，可直接记录结论而不重复验证。
- Complexity delta: neutral
- Validation ceiling: V3
- Validation budget: 30 minutes
- Reviewer budget: 2
- Evidence reuse: 复用各 implementation/wave gate 绑定的 focused/full/Electron/fixture 证据；产品、相关测试、性能 harness/fixture、ratchet、生成器或 gate report 路径变化时，仅使对应证据失效。
- Invalidating paths: ARCH-2 product/test paths; `scripts/measure-architecture-baseline.ts`; `tests/fixtures/architecture-baseline/**`; `tests/unit/architectureDependencyRatchet.test.ts`; repo-index/task-board/capability generators; this gate report/card
- Task ID: `arch-2-gate-00-cross-surface-features`
- Phase / wave: `ARCH-2 / phase gate`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Validation Worker + Coordinator / independent gate-process and performance reviewers / Coordinator`
- Claimed at / released at: `2026-08-24T18:08:26+08:00 / —`
- Worktree / branch: `C:/Users/74755/Documents/HTML课件编辑器-worktrees/arch2-phase-gate / codex/arch2-phase-gate`
- Baseline HEAD: `3fd845b`
- Context: manual phase-gate audit against current source and `ARCH_2_W2B1_GATE_REPORT.md`; repo-index refresh intentionally occurs once after final gate inputs.
- Freshness / relevant dirty inputs: clean root worktree; no product writer; validation output is ignored and may be regenerated once
- Depends on: all ARCH-2 W2-A, W2-B1 and W2-B2 implementation/admission cards done
- Blocks: ARCH-3 admission and implementation
- Risk statement: the gate must not call automation success “accepted”, hide retained Published Runtime/large-world unknowns, or rerun broad suites merely because they exist.
- Retry count / last failure class: `0 / none`

## Product outcome

ARCH-2 closes as an engineering candidate only if every admitted cross-Surface behavior uses the canonical V9 transaction/history or read-only Published path, failed Mixed navigation restores visible Player truth, removed fallbacks stay removed, and performance/retained risks are reported without overclaiming.

## Evidence reuse decision

- Reuse W2-B1 at `ce72775`: Runtime `24 files / 301`, Interaction/Published `17 / 182`, fixtures `3/3`, full unit/integration `247 / 1720`, Electron `30/30`; no later change touched those invalidating paths except the separately tested Mixed Navigator.
- Reuse Flow React-key focused `12/12`, Spatial PPTX SVG `3/3`, Diagnostics `1/1`, Global Controls `14/14 + tsc`, and Mixed failure atomicity `13/13 + one Published V2 Mixed integration + tsc` at their recorded product commits.
- Do not rerun full unit, full E2E, desktop build, `verify`, all representative flows, Runtime/Interaction suites or focused tests already bound above.

## Scope and locks

### Allowed write

- new `docs/development-plan/baselines/ARCH_2_PHASE_GATE_REPORT.md`
- this task card and generated `docs/development-plan/TASK_BOARD.md`
- one targeted addition to `tests/unit/architectureDependencyRatchet.test.ts` only if current ratchets do not prevent the two removed Store fallbacks from returning
- one final `repo-index/generated/**` refresh

### Required read

- all ARCH-2 gate/task result sections, W2-A/W2-B1 reports and performance threshold source
- exact current `LEG-002` ledger/count and Spatial large-world evidence boundary
- current product diffs since W2-B1 to prove evidence reuse validity

### Forbidden write

- product source, contracts/Schema, fixtures, performance harness/thresholds, semantic/golden corpus, AI capability source, dependencies/lockfile, other task cards or inventories

### Hotspot locks

- gate report, architecture ratchet, generated repo-index and task-board: Coordinator single writer

## Minimal validation

1. Run the architecture dependency ratchet once on the combined product HEAD; add only the smallest source sentinel if the removed `updatePlayback` / `ensureTeacherController` legacy fallback is not protected.
2. Static-check `LEG-002` exact `buildExportPayload` count and confirm no new Published host → Legacy execution path.
3. Run exactly one same-protocol performance sequence, without rerunning to select a better sample:
   - `npm run build:player`
   - `npx tsx scripts/measure-architecture-baseline.ts --samples=21 --warmup=5`
4. Classify performance against the registered threshold/control rows. A broad environmental shift may remain `investigation amber`; a stable isolated Mixed/B1 breach creates a separate investigation card rather than an assumed optimization.
5. At the final gate commit only: `npm run repo:index`, `npm run repo:index:check`, `npm run check:task-board`, `npm run check:ai-capabilities`, and `git diff --check`.

## Acceptance

- [ ] All ARCH-2 tasks are terminal and their exact product commits/reviews are recorded.
- [ ] Mixed failure compensation and normal Published V2 navigation are green.
- [ ] Removed Store fallback targets are protected or precisely evidenced at zero.
- [ ] Performance has one final same-protocol classification; no cherry-picked rerun.
- [ ] Spatial large-world remains an explicit unknown with a re-entry trigger, not a fabricated pass.
- [ ] `LEG-002` remains nonzero with owner/ARCH-5 target and no false Runtime execution claim.
- [ ] Generated repo-index/task-board and AI capability checks are fresh after final inputs.
- [ ] Pipeline, engineering, outcome and teacher/product accepted statuses are separate.

## Stop and escalation

- Create a product/investigation card before passing if a gate check reproduces a functional failure, stable isolated performance regression, new Legacy execution bypass, contract/schema change or user-data risk.
- Do not expand into a full suite unless focused evidence shows a cross-system regression outside its confidence boundary.

## Rollback

- Start point: `3fd845b` plus this claim commit
- Gate report/ratchet/generated integration remains independently revertible; every product task retains its own rollback commit
- Performance output is ignored evidence and does not migrate user data

## Result evidence

- Gate decision/report commit: pending
- Ratchet/static consumer evidence: pending
- Performance classification: pending
- Generated/check results: pending
- Pipeline / engineering / outcome / accepted: pending
- Remaining risks and next phase: pending

## Ready checklist（Coordinator）

- [x] all product dependencies terminal
- [x] evidence reuse and invalidation paths explicitly decided
- [x] V3 scope excludes fixed V4 work
- [x] report/ratchet/generated locks available
- [x] no contract, dependency, user-data or release escalation pending
