# ARCH-0A Phase Gate Report

> Gate status: `done / focused ARCH-0A gate passed`
>
> Validation baseline: `c4e7cfcf808c1a3e9aa7c9e19c980806058c10fd`
>
> Task: `arch-0a-gate-00-phase-validation`
>
> Claim commit: `32429c7d123335e761c24e931c60a8405aa411d3`
>
> Date: `2026-08-24`

ARCH-0A 的目标是建立可回退、可重现的治理、合法 V9 fixture、writer/consumer/owner 和功能/性能基线，而不是在本阶段修复产品或作发布结论。本阶段没有修改 `src/**`；按 V3 策略只运行相关确定性、类型、focused tests、路径、fixture 和 consumer 检查，没有运行全量 `verify`、完整 E2E 或打包。

## 1. Gate inputs

以下文件仍是各自事实的权威落点；本报告不复制任务或 consumer 实时状态：

- 治理/环境/预算：`ARCH_0_BASELINE.md`；
- 代表工程：`ARCH_0_REPRESENTATIVE_PROJECTS.md` 和 `tests/fixtures/architecture-baseline/manifest.json`；
- 功能/性能/可见证据：`ARCH_0_PERFORMANCE.md`；
- Feature/writer/consumer/owner：`docs/development-plan/inventories/FEATURE_CONSUMER_OWNER_LEDGER.md`；
- Legacy 精确关系与删除门：`docs/development-plan/inventories/legacy-consumers.json`；
- 实时任务状态：任务卡；`TASK_BOARD.md` 只是生成视图。

五张 ARCH-0A 前置卡 `bsl-00 / task-00 / rep-00 / map-00 / perf-00` 在 gate 开始时均为 `done`。

## 2. Focused gate results

| Gate | Reproduced command/evidence | Result | Classification |
|---|---|---|---|
| Task board freshness | `npm run check:task-board` | pass at the claimed validation snapshot | focused pipeline green; Coordinator regenerates after this card state changes |
| Contracts | `npm run check:contracts` | pass; 4 generated contract artifacts current | focused pipeline green |
| AI capabilities | `npm run check:ai-capabilities` | initial provenance-only failure after package-script additions; Coordinator refresh `c4e7cfc` then rerun pass; index remains 7,235 bytes and no downstream capability content drift | repaired pipeline green; one bounded retry |
| Three TypeScript projects | `npm run typecheck` | pass | focused pipeline green |
| Representative determinism | `npx tsx scripts/build-architecture-baseline-fixtures.ts --check` | 4/4 outputs byte-identical; all three archive hashes unchanged | engineering fixture green |
| Focused fixture/flow behavior | `npx vitest run tests/unit/architectureBaselineFixtures.test.ts tests/integration/architectureBaselineFlows.test.tsx` | 2 files / 9 tests pass | focused pipeline green |
| V9 validators | three `validate:course-project` commands | 3/3 `valid`, Schema 9, 0 errors, 0 warnings; all four preflight targets `canExport=true` | engineering fixture green; preflight is not actual-export outcome |
| Legacy JSON/count/path | read-only Node assertion over `legacy-consumers.json` | 10 records; 116 confirmed relations; 104 unique endpoints; 87 unique evidence paths; category/status counts exact; all paths exist | engineering inventory green |
| Legacy zero queries | 11 exact `git grep` counts for `LEG-001`–`LEG-010` | all equal recorded observations: 13, 23, 9, 12, 6, 21, 32, 47, 56, 17, 1 | engineering inventory green; Legacy remains intentionally nonzero |
| Raw Store coupling | exact tracked import query | 23 renderer files, equal to baseline | no ARCH-0A product-code drift |
| Markdown | tracked Markdown H1 + relative-link checker | 216 tracked Markdown, 343 relative links, 0 failures | documentation path green |
| Rollback/environment | tag, lockfile, Node/npm/OS checks | rollback tag resolves to `6c7616f`; lock hash unchanged; Node 24/npm 11; expected Windows build | governance green |
| Product source scope | `git diff --name-only 690411d..c4e7cfc -- src` | 0 files | engineering firewall green |
| Performance evidence freshness | compare raw local report against representative manifest | 21/5 protocol and all three SHA-256 values match; Mixed PPTX remains recorded red | evidence reusable; no raw report rewrite in gate |
| Diff hygiene | `git diff --check` | pass before gate-report integration | V0 green |

当前工作树在验证期间只有并发 ARCH-0B IDX-02 的一个未跟踪 `scripts/repo-index/query.ts`。本 gate 未读取、修改或暂存它，并将其按 `known-unrelated` 排除在 ARCH-0A 证据之外。

## 3. Registered red / warning / unknown

| Finding | State | ARCH-1 decision | Later gate |
|---|---|---|---|
| Mixed/Spatial PPTX 的 2 个 Spatial SVG 被 PptxGenJS 拒绝（`Image data lacks a base64 header`） | `red` | **non-blocking for the controlled ARCH-1 image-replacement slice**: it predates ARCH-1, ARCH-1 uses HTML/Web as its required export proof, and no PPTX product code changed in ARCH-0A. It blocks any claim that Mixed PPTX outcome is green. | Export-owner characterization/fix before ARCH-4 delivery closure; ARCH-1 must not worsen it. |
| Flow focused integration has emitted the existing React `key`-prop spread warning | `known warning`; current 9-test rerun passed | non-blocking for the Slide-first ARCH-1 slice; do not suppress or fix in a gate card | Flow/UI owner task before the affected Flow modularization gate |
| Native Save As | `unknown` | non-blocking for ARCH-1 characterization; archive save/reopen is green, but native workflow remains unclaimed | bounded desktop save evidence when App/save hotspot is in scope |
| Real OS IME | `unknown`; synthetic composition protocol green | non-blocking for Slide-first ARCH-1; not equivalent to Flow outcome pass | Flow Surface/input gate |
| Trusted pointer drag | `unknown`; transform command/history green | non-blocking for image-replacement characterization, which must not claim pointer outcome from synthetic events | Slide pointer/gesture gate when affected |
| OS `printToPDF` | `unknown`; print HTML/Spatial PDF HTML exist | non-blocking when ARCH-1 uses HTML/Web; no PDF outcome claim allowed | ARCH-4 PDF/main-process gate |
| Full E2E / fresh desktop build / package | `unknown by V3 policy` | non-blocking because ARCH-0A changed no product code; affected product stages must run their own V2/V3 evidence | relevant product-code integration and final candidate |
| Fixture visual quality | `engineering fixture only` | non-blocking for structural/transaction work; screenshots prove mount/reachability only | product outcome review; not `art candidate` |

The red and unknown items are explicit baseline facts, not hidden failures. They may proceed past ARCH-0A only because the first ARCH-1 slice has a narrower stated behavior and can select a known-green HTML/Web export endpoint. If ARCH-1 changes any listed subsystem, the corresponding item becomes in-scope and must be revalidated rather than inherited as non-blocking.

## 4. Static manifest wording finding

`docs/development-plan/PACKAGE_MANIFEST.md` declares “56 Markdown” and “全部文件”. The numeric data is internally consistent **for the static plan package**:

- 56 static-plan Markdown files;
- 56 manifest table entries;
- 18 additional execution-time task/board/baseline/inventory Markdown files;
- 74 Markdown files under `docs/development-plan/` in total.

Tasks and the generated board are already explicitly excluded from the static Manifest protocol; baselines/inventories are execution evidence but the current wording does not say so. This is a non-product, non-ARCH-1 technical blocker, but a real governance wording ambiguity. Coordinator should separately change the wording to “56 份静态计划包，执行期状态/证据目录另管”. This gate does not edit the Manifest and does not add dynamic evidence to its static table.

## 5. Layered status

### Pipeline status

`focused ARCH-0A gate pass` after the bounded capability-provenance refresh. Contracts, capabilities, task board at the validation snapshot, three TypeScript projects, fixture check, focused tests, Markdown links and diff hygiene are green. Full verify/E2E/desktop build/package remain intentionally unrun and therefore unknown, not green.

### Engineering status

`pass for ARCH-0A baseline purpose`. Governance, rollback, fixture hashes, carrier coverage, 19-module/7-journey ledger, Legacy starting counts, zero-query observations and performance comparison protocol are reproducible. No product source, Schema, dependency or persisted format changed.

### Outcome status

`partial / engineering fixture evidence`. Three fixtures open and current-location previews mounted in the prior bounded Electron evidence, but Mixed PPTX is red and multiple native/manual workflows remain unknown. Visual fixture quality is not an art candidate.

### Accepted status

`not evaluated`. Automated evidence cannot produce teacher/product `accepted` or a release decision.

## 6. Gate decision

ARCH-0A has no hidden blocker for the **controlled ARCH-1 characterization and first vertical slice**. Coordinator review/state integration and the static Manifest wording correction are complete. The separate ARCH-0B context-safety gate remains required by the roadmap before broad multi-agent product migration.

ARCH-1 must use this baseline rather than interpreting existing red/unknown items as green, must preserve all V9 contracts and capabilities, and must stop if its image-replacement slice introduces wrong-target writes, multiple logical histories, save/reopen regression, or HTML/Web regression.
