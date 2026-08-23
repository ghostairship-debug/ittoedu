# S1 Task Card — ARCH-0B Index Quality Gate

## State and assignment

- Task ID: `arch-0b-gate-00-index-quality`
- Phase / wave: `ARCH-0B / phase gate`
- Status: `draft`
- Owner / Reviewer / Integrator: `Coordinator / Coordinator / Coordinator`
- Claimed at / released at: `— / —`
- Worktree / branch: `primary workspace / codex/architecture-stabilization`
- Baseline HEAD: `639aa11`
- Claim commit: `pending`
- Context: `fresh repo:index + golden-task evidence`
- Freshness / relevant dirty inputs: wait for IDX-01B/02/03 completion and final generated refresh
- Depends on: `arch-0b-idx-00, idx-01, idx-01b, idx-02, idx-03 all done`
- Blocks: ARCH-1 context safety gate; ARCH-2 broad multi-agent gate
- Retry count: `0`

## Product outcome

Repo-index becomes the default development-navigation entry only after deterministic freshness and the 25-task quality gate pass, while low confidence and stale input continue to fall back explicitly to manual Bootstrap.

## Current fact and evidence

Adapter and deterministic generator are implemented, but semantic/query/golden quality is not complete and `PROJECT_COGNITION_INDEX.md` must therefore still describe manual Bootstrap as authoritative.

## Non-goals

- No product runtime/index integration, daemon, database, or removal of manual Bootstrap.
- No claim that repo-index is an AI capability catalog.
- No broad product migration before the gate passes.

## Scope and locks

### Allowed write

- `docs/development-plan/baselines/ARCH_0B_GATE_REPORT.md`
- `PROJECT_COGNITION_INDEX.md` current repo-index status and commands only
- `.github/workflows/check-contracts.yml` development freshness checks only
- This task card and generated task board
- Coordinator-generated `repo-index/generated/**` refresh

### Required read

- All completed ARCH-0B task evidence
- 15/25 golden quality report and strict manifest
- Current task/validation/reading protocols

### Forbidden write

- Product source/contracts/lockfile
- semantic/query/golden implementation except generated refresh
- product AI capability artifacts

### Hotspot locks

- Generated repo-index and knowledge-entry integration; Coordinator only.

## Change budget

- Task timebox: `half Coordinator day`
- Main files: `one report + cognition status + CI checks + generated refresh`
- Product/dependency/UI/Schema changes: `no`
- Validation / expected time: `all index/task-board/contract/type focused gates; under 30 minutes`
- Max implementation retries: `1`

## Characterization

- 15 tasks permit controlled use; only 25 tasks permit broad dispatch.
- A fresh global manifest does not override relevant dirty-file warnings.
- External Catalog source queries must remain low-confidence.

## Acceptance

- [ ] Deterministic generation/check and task board checks pass from clean tree
- [ ] 25-task Hit@5/Recall@15/confidence/performance gates pass with zero high-confidence errors
- [ ] Context Pack sections/budgets and stale/dirty fallback are verified
- [ ] Cognition index truthfully switches default navigation while retaining Bootstrap fallback
- [ ] CI checks task board and repo-index freshness without duplicating full verify
- [ ] Pipeline/engineering/outcome/accepted status reported separately

## Minimal validation

- `npm run repo:index:check`, `npm run check:task-board`, golden quality command
- Focused adapter/generator/query/semantic/golden tests
- contracts/capabilities/typecheck and Markdown/path checks
- `git diff --check`

## Rollback

- Start point: final IDX-03 implementation commit
- Generated integration commit: pending
- Status/CI commit: pending
- Old path remains: revert to cognition manual Bootstrap wording and previous generated index.

## Consumers and index

- Consumer delta: broad coding agents may consume Context Packs only after this gate
- Legacy record IDs: none
- indexImpact: final strict regenerate

## Result evidence

- Pending.

## Ready checklist (Coordinator)

- [ ] all dependencies done
- [ ] final source/semantic/config/tool inputs stable
- [ ] generated lock available
- [ ] no relevant user dirty changes
- [ ] no product escalation
