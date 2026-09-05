# r12-060-release｜形成 1.2 engineering candidate 并发布 v1.2.0-rc.N 源码标签

- Release / Dependencies: 1.2 / r12-050-native-closure
- Write locks: `none`
- Inventory access: none

## Outcome / current evidence

本节点不修产品。它在所有 1.2 节点的实质 diff 与 focused evidence 已完成后，证明同一工作树满足路线、合同、产品验证和候选边界；只有当前任务明确包含创建候选标签时才写 `v1.2.0-rc.N`。

本轮启动门同时包含 [本地复审基线](../../reviews/1.2-local-review-2026-09-05.md) 的全部确认缺口。实现提交的标题、局部测试通过或路线文档更新均不证明 1.2 已完成；上游修复未通过时不实例化本发布节点。

## Read first

- `COURSEWARE_DEVELOPMENT_PLAN.md`
- `docs/development-plan/WORKING_PROTOCOL.md`
- `docs/development-plan/roadmap/1.2/README.md`
- `docs/development-plan/roadmap/1.2/IMPLEMENTATION_CONTRACT.md`
- `package.json`
- `tests/integration/architectureBaselineFlows.test.tsx`
- `tests/integration/mixedCrossSurfaceHistory.test.tsx`
- `tests/e2e/stabilizationCoreUsability.spec.ts`
- `tests/e2e/stabilizationFlowAuthoring.spec.ts`

## Write scope

产品、测试、路线、生成制品全部只读。验证失败时返回精确责任节点，不在 release gate 修复。若明确授权创建标签，只允许对已验证的当前 commit 创建下一个不存在的 annotated `v1.2.0-rc.N`；不得移动、覆盖或删除既有标签，不创建无后缀 `v1.2.0`。

## Execution

1. 确认 manifest 的 1.2 依赖均有可审阅实现/证据，工作树没有未解释的冲突、半成品或手改 generated output；未授权提交时可在 dirty tree 验证，但不得给它打标签。
2. 运行路线/任务板检查和一次完整 `npm run verify`；同一输入已有有效结果时按工作协议复用，不重复刷命令。
3. 汇总固定 fixture 覆盖：Flow 浮层+连续 DOCX、text/number input 全分支、Table、五 Chart、straight/elbow、六 background owner、保存重开、Undo/Redo、Player、单 HTML、PPTX/DOCX。
   必含可见入口插入 Table/五 Chart/input 后真实初始及内容/几何/Undo 增量；base/两个 named state/surface 写入隔离与保存重开；input 文本/数值归一化、双键原子写入、规则唯一命中与 IME；表格末格 Tab 原子追加及透明度；图表单非零圆/环、样式开关/四向图例及轴范围裁切；合法 HEX Esc→blur 取消、真实连续调色/切目标/一次 Undo 与 Chart 草稿。现有常用色和统一入口不退化。按钮存在、单次 change、独立 painter 或 Published 构建不足以替代真实操作；缺任一项不得报告 1.2 candidate-ready，也不得延至 S1。
4. 检查报告只声称 engineering candidate；Word 可编辑实操、真实视觉/互动和教师复核留给 S1，不更新 Preservation Matrix。
5. 若任务明确授权 commit/tag：先确保所有变更已形成目标 commit，再查找最大 rc 编号并创建下一个 annotated tag；若标签已存在或 HEAD/证据不匹配，停止而不覆盖。

## Stop conditions

- 任一依赖 Acceptance 或本轮 F/L 退出证据缺失、`verify` 失败、工作树含无法归属的实现或 generated output 与来源不一致。
- 需要在 gate 修改代码/测试/断言，或需要弱化验证才能通过。
- 没有明确 commit/tag 授权、HEAD 未含已验证变更、目标 tag 已存在，或有人要求创建 accepted `v1.2.0`。

## Acceptance

- 路线、任务板与完整 verify 在同一候选上通过，fixture 覆盖清单可追溯到测试/产物。
- 报告明确 remaining S1 人工验收，不把自动化写成 accepted。
- 有授权时创建新的 annotated rc tag；无授权时准确报告 candidate-ready 且零 Git 状态写入。

## Focused validation

- `npm run check:development-roadmap`
- `npm run check:task-board`
- `npm run verify`

## Rollback / handoff

本门默认不写文件。若新建标签后发现证据与 HEAD 不匹配，停止并由明确授权者决定是否删除；不得自行移动标签。失败交接只给首个失败命令、fixture/assertion、责任节点和当前 HEAD/工作树状态。
