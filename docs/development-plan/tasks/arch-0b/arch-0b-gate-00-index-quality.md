# S1 Task Card — ARCH-0B Index Quality Gate

## State and assignment

- Task ID: `arch-0b-gate-00-index-quality`
- Phase / wave: `ARCH-0B / phase gate`
- Status: `done`
- Owner / Reviewer / Integrator: `Coordinator / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 03:05 Asia/Shanghai / done 2026-08-24 03:08 Asia/Shanghai`
- Worktree / branch: `primary workspace / codex/architecture-stabilization`
- Baseline HEAD: `bae965274b3d88f70ef94b28d87ad7fd18007d78`
- Claim commit: `108d9136ecdc61256676e88c1f20947c55e5ef2c`
- Context: `fresh repo:index + golden-task evidence`
- Freshness / relevant dirty inputs: all IDX dependencies done; final generated refresh owned by this gate
- Depends on: `arch-0b-idx-00, idx-01, idx-01b, idx-02, idx-03 all done`
- Blocks: ARCH-1 context safety gate; ARCH-2 broad multi-agent gate
- Retry count: `0`

## Product outcome

Repo-index becomes the default development-navigation entry only after deterministic freshness and the 25-task quality gate pass, while low confidence and stale input continue to fall back explicitly to manual Bootstrap.

## Current fact and evidence

The deterministic index, semantic query/Context Pack, fixed 25-task quality gate, cognition entry, CI freshness checks and final generated refresh are complete. Repo-index is the default navigation entry, while confidence/freshness/dirty/external-source rules retain manual Bootstrap as an explicit safety fallback.

## Non-goals

- No product runtime/index integration, daemon, database, or removal of manual Bootstrap.
- No claim that repo-index is an AI capability catalog.
- No broad product migration before the gate passes.

## Scope and locks

### Allowed write

- `docs/development-plan/baselines/ARCH_0B_GATE_REPORT.md`
- `PROJECT_COGNITION_INDEX.md` current repo-index status and commands only
- `.github/workflows/check-contracts.yml` development freshness checks only
- `artifacts/ai-capabilities/generation-evidence.json` provenance-only refresh required by the existing capability check
- This task card and generated task board
- Coordinator-generated `repo-index/generated/**` refresh

### Required read

- All completed ARCH-0B task evidence
- 15/25 golden quality report and strict manifest
- Current task/validation/reading protocols

### Forbidden write

- Product source/contracts/lockfile
- semantic/query/golden implementation except generated refresh
- product AI capability semantics or generated capability payloads; only deterministic provenance refresh is allowed

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

- [x] Deterministic generation/check and task board checks pass from clean tree
- [x] 25-task Hit@5/Recall@15/confidence/performance gates pass with zero high-confidence errors
- [x] Context Pack sections/budgets and stale/dirty fallback are verified
- [x] Cognition index truthfully switches default navigation while retaining Bootstrap fallback
- [x] CI checks task board and repo-index freshness without duplicating full verify
- [x] Pipeline/engineering/outcome/accepted status reported separately

## Minimal validation

- `npm run repo:index:check`, `npm run check:task-board`, golden quality command
- Focused adapter/generator/query/semantic/golden tests
- contracts/capabilities/typecheck and Markdown/path checks
- `git diff --check`

## Rollback

- Start point: final IDX-03 implementation commit
- Generated integration commit: `c0f8ba3d034cfe96f692e69ebb6d4891120c1f2e`
- Status/CI commit: `6de6939991cce6c0e332955bcf8c16fae77f310d`
- Old path remains: revert to cognition manual Bootstrap wording and previous generated index.

## Consumers and index

- Consumer delta: broad coding agents may consume Context Packs only after this gate
- Legacy record IDs: none
- indexImpact: final strict regenerate

## Result evidence

- Final committed index: `666` strict inputs/files, `5,627` symbols, `13,984` edges, `1,515` tests, `26` contracts, `82` scripts, `81` docs; project membership is `546` root, `90` Electron and `115` E2E files. Check mode rebuilt `10,734,270` output bytes and passed byte comparison.
- The unchanged golden gate passed three final observations (two before integration and one after final docs/generated refresh) with signature `946bd025c438e57d55f3c5558d45ede4b75bed1a6591966eb7789846fd0d9a38`: Hit@5 `100%`, controlled Recall@15 `95%`, broad Recall@15 `85.38%`, wrong-high/forbidden/expectation mismatch `0/0/0`, fallback `4/4`.
- Focused index validation passed `5 files / 32 tests`, including the TS7 adapter, deterministic generator/rollback, semantic budgets/path validation, Context Pack/freshness/output safety and real golden corpus. Root, Electron and E2E TypeScript checks all passed.
- Contracts passed `4` generated artifact checks. AI capability semantics were unchanged; its existing provenance evidence was deterministically refreshed for the package-script input and `check:ai-capabilities` passed with the component Catalog available.
- CLI smoke verified: normal Components query is `fresh/high/no Bootstrap`; a dirty query-relevant cognition file is `stale/high/Bootstrap`; an unavailable external component-source query remains `fresh/low/Bootstrap` with no invented external path.
- `PROJECT_COGNITION_INDEX.md` now documents exact query priority, Context Pack output boundaries, S2 freshness rules and manual Bootstrap fallback. CI adds only task-board, repo-index freshness and fixed index-quality checks; it does not duplicate E2E, packaging or product `verify`.
- `ARCH_0B_GATE_REPORT.md` separates pipeline `pass`, engineering `accepted for ARCH-0B`, internal outcome `engineering candidate`, and product/teacher accepted `not applicable / not claimed`.
- Final `repo:index:check`, `check:task-board`, `repo:index:quality`, `check:contracts`, `check:ai-capabilities`, typecheck and `git diff --check` passed. Full E2E/package/product review remain assigned to later stage gates because ARCH-0B has no product-runtime change.

## Ready checklist (Coordinator)

- [x] all dependencies done
- [x] final source/semantic/config/tool inputs stable
- [x] generated lock available
- [x] no relevant user dirty changes
- [x] no product escalation
