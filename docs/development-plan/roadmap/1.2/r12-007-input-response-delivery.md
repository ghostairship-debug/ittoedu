# r12-007-input-response-delivery｜交付 Slide 填空题作者、运行、PPTX、诊断与能力索引闭环

- Release / Dependencies: 1.2 / r12-006-input-response-contract, r12-008-native-authoring-transport
- Write locks: `store-slide`, `props-slide`, `props-shared`, `workspace-shell`, `authoring-slide`, `authoring-interaction`, `published-slide`, `published-interaction`, `published-dynamic`, `export-pptx`, `diagnostics`, `generated-index`
- Inventory access: none

## Outcome / current evidence

`r12-006-input-response-contract` 只让协议可解析并显式 unsupported。本节点按 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §5 把创建/配置、canonical rule family、原子 session 写入、Published DOM、PPTX、诊断和能力索引交付为一个 Slide-only 纵切。

[本地复审 F1 / P1](../../reviews/1.2-local-review-2026-09-05.md) 确认 Controller 跳过提交、真实 Slide port 的 describe/bind 返回 null、Store 缺少 `setMany`，作者工厂/简洁配置/规则族链也未完整交付。只删除 warning、接一个 mock port 或让 Schema fixture 通过均不能关闭本项；这些缺口仍属 1.2，不推到 1.3/S1。

共同 Native 作者态接线先由 `r12-008-native-authoring-transport` 闭合。本节点再验证 input 从可见 UI 创建、修改与保存重开都能完成真实宿主同步，不能只证明运行态 submit 或独立 painter 成功。

## Read first

- `src/renderer/course/v9SlideContentCommands.ts`
- `src/renderer/project/nativeNodeFactories.ts`
- `src/renderer/course/v9SlideClipboard.ts`
- `src/renderer/store/slices/slideAuthoringSlice.ts`
- `src/renderer/ui/properties/SlideNativePropertiesPanel.tsx`
- `src/renderer/ui/ElementsTab.tsx`
- `src/renderer/composition/properties/usePropertiesAuthoringBinding.tsx`
- `src/renderer/ui/InteractionEditor.tsx`
- `src/renderer/interactions/interactionAuthoringCommands.ts`
- `src/player/CourseStateStore.ts`
- `src/player/interactions/PublishedInteractionSurfacePort.ts`
- `src/player/interactions/PublishedInteractionController.ts`
- `src/player/interactions/PublishedDomInteractionSurfacePort.ts`
- `src/player/surfaces/slide/publishedSlideInteractionSurfacePort.ts`
- `src/player/surfaces/slide/publishedNativeRendering.ts`
- `src/player/surfaces/publishedCourseState.ts`
- `src/player/surfaces/publishedDynamicHosts.ts`
- `src/player/surfaces/slide/SlidePublishedAdapter.ts`
- `src/renderer/export/course/buildCoursePptx.ts`
- `src/shared/courseProjectHealth/interaction.ts`
- `tests/unit/publishedInteractionController.test.ts`
- `tests/unit/publishedDomInteractionSurfacePort.test.ts`
- `tests/unit/courseStateStore.test.ts`
- `tests/integration/publishedInteractionSlideHostIntegration.test.ts`
- `tests/e2e/stabilizationCoreUsability.spec.ts`

## Write scope

只写 metadata 锁覆盖的 Slide/input factory-command-clipboard-properties、ElementsTab 的 input 可见入口、composition/properties 窄接线、interaction authoring、Player session/真实 Slide port/host、PPTX、health 与能力生成器/制品，以及现有目标测试。新 rule-family helper 仅在实施合同规定的 `src/renderer/interactions/inputRuleFamily.ts` 落地。禁止修改 `r12-006-input-response-contract` 的 wire、公共 Runtime CourseStateStore API、Flow/Spatial host 语义或 `InteractionEngine`。

## Execution

1. 先实现 input factory 与一个 composite authoring command：创建节点、两个 state declarations 和完整 family；为答案/容差修改、切型、复制、删除分别实现先验证后提交的单事务 command。
2. 简洁 Properties 只读写 family IDs 内规则，严格实现冲突检测、“保留手改”和“按当前配置重建”；专业规则不在列表内时永不覆盖。删除 key 使用实施合同的全工程静态引用判定，不确定就保留并报 info。
3. 在作者画布和 Published Slide 渲染真实 input；接通 `publishedSlideInteractionSurfacePort` 的 descriptor/bind，编辑态 inert、try-run/Player 才提交。处理 composition、Enter、button、Esc、Tab、冒泡和卸载解绑；不能仅修改通用 DOM port 或测试替身。
4. `CourseStateStore.setMany` 先全量 clone/validate 后一次 commit/callback；Frozen store 零写入。whole-course session 暴露 batch port，Controller 在任何条件前写两个 key，失败时零规则执行。
5. 对 text、number 合法/非法/空值及所有 rule branch 做 table-driven controller 测试，断言一次提交恰好命中一支；异步动作不回读 DOM。
6. PPTX 输出可编辑 text box + outline + placeholder/label，preflight 明示 static-input；不输出可交互伪承诺。
7. health 定位 key/类型/target/family 问题；能力 source evidence 纳入 shared contracts。实现完成后运行一次生成命令并提交 generated output。

## Stop conditions

- 无法用一个作者事务同时维护节点、声明和 family，或运行提交需要两次可观察 state change。
- 必须让编辑态 frozen session 可变、修改 Runtime/Component store 接口或在 DOM 保存业务 descriptor。
- 文本答案超过 15、多个分支可能同时命中，或教师手改只能靠静默覆盖处理。

## Acceptance

- 可见 Slide UI 完成 text/number input 的创建、配置、复制、切型、删除；Undo/Redo 与保存重开无半成品。
- 作者 try-run、Player、单 HTML 使用同一 Published controller；IME 不误提交，每次事件先原子写值/有效性再恰好执行一支。
- `setMany` 任一键非法或 frozen 时零写入/零回调/零规则执行；有效提交只通知一次且订阅者观察到完整双键，无效输入重置值为声明默认值并写 validity=false，不保留旧有效答案。真实 input 创建后初始及后续作者同步正常。
- PPTX 对象可编辑且有明确静态语义；诊断精确；能力索引可重复生成并通过检查。

## Focused validation

- `npm run test:product -- tests/unit/v9SlideContentCommands.test.ts tests/unit/interactionAuthoringCommands.test.ts tests/unit/courseStateStore.test.ts tests/unit/publishedInteractionController.test.ts tests/unit/publishedCourseState.test.ts`
- `npm run test:product -- tests/unit/publishedDomInteractionSurfacePort.test.ts tests/unit/courseProjectHealth.test.ts tests/unit/coursePptxExport.test.ts tests/unit/aiCapabilities.test.ts tests/integration/publishedInteractionSlideHostIntegration.test.ts`
- `npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts`

## Rollback / handoff

按 authoring composite command、Published session、renderer、PPTX、diagnostics/index 的完整纵切回滚；不能保留可创建但不能运行的 input。交接 `r12-050-native-closure` 时附固定 text/number fixture、每个分支 trace、PPTX preflight 与生成索引检查结果。
