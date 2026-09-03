# r11-061-no-regression-candidate｜固定 1.1 无回归候选

- Release / Dependencies: 1.1 / r11-060-zero-gate
- Write locks: `generated-index`
- Inventory access: read
- Preservation: PM-01–PM-28

## Outcome / current evidence

在一个固定 product candidate 上，零遗留、不可降级、现有源码验证与固定离线 HTML 检查全部通过，并形成 `artifacts/release-evidence/v1.1/<candidate>/candidate.json`；不调用要求 Portable/win-unpacked/app.asar 的 installer release verifier。同一候选同一命令不重复执行。

## Integrator brief（2026-09-03）

product closure 必须固定且除本规格允许的 evidence report 外工作树干净。只写 `artifacts/release-evidence/v1.1/<candidate>/candidate.json` 与 001/060 已定义的同候选报告。产品/测试/lockfile 任一变化 → 候选作废。

固定门（同一 candidate，每门最多跑一次）：

1. 复用 r11-060 的 `legacy-zero.json`（product identity、scanner、scope、inventory schema/canonical digest 与 record/expectation identity 完全相同才复用；否则退回 060，本节点不重扫）
2. `npm run check:contracts`
3. `npm run check:development-roadmap`
4. `npm run check:preservation -- --require-clean --report artifacts/release-evidence/v1.1/<candidate>/preservation.json`
5. `npm run verify`（已含 typecheck、`test`、`test:e2e` 与 `check:ai-capabilities`；经 `pretest:e2e` 含 `check:examples`）。**禁止** `verify:release` / 安装包
6. `git diff --check`

固定 suite 必须已存在且 check 一致，本节点不 refresh HTML：`tests/fixtures/architecture-baseline/{slide-heavy,flow-heavy,mixed-spatial}.h5lesson`，`examples/render-host-benchmark/render-host-benchmark-v9.h5lesson` 与 `render-host-benchmark-v2.html`。

product identity 由排除 inventory 与 `artifacts/release-evidence/v1.1/**` 的 product closure digest、scope 和工具版本定义；写同候选 release evidence 不会使它自失效。只授予 **engineering candidate**。不打 `v1.1.0`、不写 accepted、不自动开 r11-062。

## Read first

- `docs/development-plan/baselines/V1_1_PRESERVATION_BASELINE.md`
- `docs/development-plan/roadmap/PRESERVATION_MATRIX.md`
- r11-060 的零检查摘要
- r11-054 最终 post-delete closure 上重新通过的 r11-055 gate evidence
- `package.json`
- `docs/development-plan/WORKING_PROTOCOL.md`
- `tests/fixtures/architecture-baseline/slide-heavy.h5lesson`
- `tests/fixtures/architecture-baseline/flow-heavy.h5lesson`
- `tests/fixtures/architecture-baseline/mixed-spatial.h5lesson`
- `examples/render-host-benchmark/render-host-benchmark-v9.h5lesson`
- `examples/render-host-benchmark/render-host-benchmark-v2.html`

## Write scope

只允许写 `artifacts/release-evidence/v1.1/<candidate>/candidate.json` 与 r11-001/060 已定义的同候选报告；固定 `.h5lesson`/HTML 必须已由现有 generator 生成且 check 一致，本任务不刷新它们。产品代码、测试、合同、fixture、lockfile 发生任何变化都使候选失效并返回前置任务。禁止修改断言、retry、timeout、排除项或从失败候选挑选部分结果。

## Execution

1. 固定 candidate commit 与工作树依赖闭包；产品依赖 dirty 时不能宣称固定候选。确认 r11-055 gate evidence 绑定 r11-054 最终 post-delete closure，而非复用 pre-delete pass。
2. 先核对 r11-060 的 zero report 是否绑定同一 candidate、scanner、scope/exclusions、product tree closure、当前 inventory schema/canonical digest 与 record/expectation identity；完全相同则直接复用，不重跑 `check:legacy-zero`。product 未变但 inventory 变化也会使报告失效并退回 r11-060，本节点不现场重复扫描或修裁判。
3. 依次运行 `check:contracts`、`check:development-roadmap`、r11-001/052 共同维护的 `check:preservation -- --require-clean --report artifacts/release-evidence/v1.1/<candidate>/preservation.json` 与现有 `verify`，最后运行 `git diff --check`；任一命令不存在或失败即停止并退回创建它的任务。`verify` 已包含 `check:ai-capabilities`，并通过 `pretest:e2e` 执行 `check:examples`、准备固定 HTML和跑真实浏览器互动，同一输入不再重复运行这些检查。禁止运行 `verify:release`，它验证本版本不交付的 installer artifacts。
4. 每个实际执行命令在同一候选/环境只运行一次；flaky 只原样重跑一次并如实隔离。
5. 报告记录复用的 zero report identity、inventory schema/canonical digest 与 record/expectation identity、post-delete 055 evidence identity、实际执行门、版本、退出码、环境、固定 suite 与 V9/HTML carrier identity、自动/人工边界及证据失效条件；candidate path 与 report 内 identity 必须一致。
6. 只授予 engineering candidate；不创建标签、不宣称 accepted。

## Stop conditions

- candidate 不是固定、产品依赖工作树仍变化或前置证据已失效。
- 任一门失败、命令缺失或依赖过去不同候选的结果。
- 需要安装包验证；1.1 不交付安装包。

## Acceptance

- post-delete architecture gate、zero、contracts、roadmap、preservation、verify（含 capabilities/examples）与 diff hygiene 在同一固定候选全部通过并有持久证据。
- 源码与固定课例离线 HTML 的身份可追溯；不引用历史 release 二进制。
- 报告明确 automation 不是 Owner accepted。

## Focused validation

- `npm run check:development-roadmap`
- `npm run check:contracts`
- `npm run check:preservation -- --require-clean --report artifacts/release-evidence/v1.1/<candidate>/preservation.json`
- `npm run verify`
- `git diff --check`

## Rollback / handoff

候选失败不修改产品以外的证据事实；删除错误的候选声明并退回首个失败节点。交接仅解锁 r11-062，不自动执行。
