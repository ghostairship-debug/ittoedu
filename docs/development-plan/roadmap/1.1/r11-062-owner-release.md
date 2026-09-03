# r11-062-owner-release｜Owner 验收并发布 1.1

- Release / Dependencies: 1.1 / r11-061-no-regression-candidate
- Write locks: `none`
- Inventory access: read
- Preservation: PM-01–PM-28

## Outcome / current evidence

Owner 在 r11-061 的固定候选上使用三份 architecture-baseline 工程与 render-host benchmark 组成的固定 suite 完成全部适用产品检查，明确签署 `accepted` 后，发布 `v1.1.0` 源码标签与同候选的 `render-host-benchmark-v2.html`；不生成或承诺安装包。纯 Slide 的 benchmark 不被虚构为 Flow/Spatial/Mixed 载体。

## Integrator brief (2026-09-02)

工程会话在 r11-061 停止。本节点 **不要自动执行**：不打标签、不改产品、不把 engineering candidate 写成 accepted。解锁后只交给产品 Owner 按 PRESERVATION_MATRIX 做固定课例检查并签字。origin 仅 `https://github.com/ghostairship-debug/ittoedu.git`。

## Read first

- r11-061 engineering candidate 报告
- r11-055 Owner 模块化与依赖方向证据
- `docs/development-plan/roadmap/PRESERVATION_MATRIX.md`
- `docs/USER_GUIDE.md`
- `tests/fixtures/architecture-baseline/slide-heavy.h5lesson`
- `tests/fixtures/architecture-baseline/flow-heavy.h5lesson`
- `tests/fixtures/architecture-baseline/mixed-spatial.h5lesson`
- `examples/render-host-benchmark/render-host-benchmark-v9.h5lesson`
- `examples/render-host-benchmark/render-host-benchmark-v2.html`
- `examples/render-host-benchmark/README.md`
- `COURSEWARE_DEVELOPMENT_PLAN.md`

## Write scope

Owner 可写 `docs/development-plan/releases/V1_1_ACCEPTANCE.md`、必要的发布说明和经批准的版本/标签元数据。禁止修改产品代码/测试来适配验收、生成安装包、跳过矩阵行或把未通过项标成 accepted。

## Execution

1. 确认 candidate identity 与 r11-061 完全一致；任何产品相关 diff 都退回候选门。
2. Owner 按固定 suite 分工检查：`slide-heavy.h5lesson` 覆盖 Slide 密集编辑与静态导出，`flow-heavy.h5lesson` 覆盖 Flow 与 DOCX，`mixed-spatial.h5lesson` 覆盖 Spatial/Mixed 与跨 Surface 行为，render-host benchmark 覆盖 Component/Runtime、作者试运行、整课 Player 和冻结离线 HTML。各 carrier 均检查适用的保存重开、Undo/Redo、诊断与可见失败；导出只从该固定 suite 生成，不临时换入其他课例。
3. 对每个 PM ID 记录 pass/block 与实际产物/观察，不以自动测试代替视觉和互动判断；同时确认 r11-055 的 root-only-wiring、无第二 writer/Facade、依赖环清零和 raw Store consumer 收紧仍绑定同一候选。
4. 全部适用项通过后由 Owner 明确签署 `accepted`；未签署则保持 candidate，不发布。
5. 确认 tracked 离线 HTML 已由 `refresh:render-benchmark:fixture` 的现行 generator 产生，且 r11-061 的 `verify` 内含的 `check:examples` 已通过；记录固定 suite、V9/HTML 候选身份、生成命令和已知限制后创建源码标签。不得在签署后重生成或生成安装包。

## Stop conditions

- Owner 未明确签署，或任一适用 PM 行失败。
- 固定 suite/候选与 r11-061 不一致。
- 需要删功能、隐藏失败或改变导出语义才能通过。

## Acceptance

- Owner acceptance 记录逐项覆盖 PM-01–PM-28 的适用行。
- 1.1 模块化门在同一候选通过：组合根只接线、Owner 边界和依赖方向已收口，没有以 re-export/双写/删功能制造完成。
- `v1.1.0` 源码标签和固定课例离线 HTML 指向同一 accepted 候选。
- 发布说明明确 V8 不受支持、无安装包，并诚实列出非适用/已知限制。

## Focused validation

- Owner 按 `docs/development-plan/roadmap/PRESERVATION_MATRIX.md` 完成固定课例检查并签字。
- `git diff --check`

## Rollback / handoff

签署前只需撤销候选声明；标签/制品发布后按发布 runbook 撤回并保留审计记录，不静默重指同名标签。交接只解锁 1.2/1.3/1.6 路线，不自动开始。
