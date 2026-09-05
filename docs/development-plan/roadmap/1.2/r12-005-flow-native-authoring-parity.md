# r12-005-flow-native-authoring-parity｜补齐 Flow 原生文字/图片浮层作者能力，同时保留正文图文的文档流语义

- Release / Dependencies: 1.2 / none
- Write locks: `store-flow`, `props-flow`, `props-shared`, `props-slide`, `authoring-flow`
- Inventory access: none

## Outcome / current evidence

Flow 已能通过共享插入路径创建部分浮层，但 Properties 对 shape 会落到空分支，Slide 的完整 Shape editor 仍是私有实现。按 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §8 交付可见的 Flow text/image/shape 浮层创建与属性闭环，同时严格保护 FlowBlock 正文排版；DOCX 结果留给 `r12-045-flow-docx-fidelity`。

## Read first

- `src/renderer/ui/properties/FlowPropertiesPanel.tsx`
- `src/renderer/ui/properties/FlowPropertiesContextBuilder.ts`
- `src/renderer/ui/properties/SlideNativePropertiesPanel.tsx`
- `src/renderer/ui/properties/PropertyControls.tsx`
- `src/renderer/course/flowSharedAuthoringAdapters.ts`
- `src/renderer/authoring/flowOverlayAuthoring.ts`
- `src/renderer/ui/flow/FlowOverlayAuthoringLayer.tsx`
- `src/shared/canvasShapeRenderer.ts`
- `tests/unit/flowSharedAuthoringAdapters.test.tsx`
- `tests/unit/flowUnifiedLayers.test.tsx`
- `tests/e2e/stabilizationFlowAuthoring.spec.ts`

## Write scope

允许修改 Read first 中的 Flow/共享 Properties、Flow adapter/authoring/overlay renderer 及对应现有测试。可在 `src/renderer/ui/properties/` 新建一个共享 Shape 属性组件。禁止修改 FlowBlock schema、正文 layout/wrap、Slide command 语义、DOCX/PDF 或新增 Flow 专属 shape style。

## Execution

1. 复现从 Flow 可见 UI 插入 text、image、rectangle、line，记录当前选中 address、command owner 与 shape 属性空面板证据；已有闭环不重写。
2. 把 Slide `ShapeProperties` 提升为无 Store 依赖的共享控件，输入只含 view value/能力，输出 typed patch；Slide adapter 保持现有行为，Flow adapter 接入同一控件。
3. Flow 的 text/image/shape 创建、选择和属性 patch 全部走现有 canonical Flow command。draft/颜色拖动在明确提交时形成一条事务，stale/locked/invalid 零写入。
4. rectangle 与 line 至少覆盖实施合同 §8 的全部属性；不适用字段禁用并解释，不写隐藏默认值。
5. 用作者画布实际呈现验证 fill/stroke/opacity/line style/arrow；若写入正确但画布错误，修共享 view/renderer 转换并让 Player/单 HTML消费同一数据。
6. 明确回归正文 paragraph/heading 和正文 image：仍在 blocks 中、仍按文档流重排与环绕，浮层操作不改变 block 数据。

## Stop conditions

- 需要给 FlowBlock 增加绝对坐标或普通 z-order 才能完成。
- 需要复制第二套 Shape 控件、默认样式或直接 mutate Store。
- 发现当前 strict V9 不能表达目标属性；此时先升级 Owner，不在 UI 私藏字段。
- 必须改变 DOCX/PDF 才能让作者画布成立。

## Acceptance

- 只用 Flow 可见 UI 可创建、选择并编辑 text/image/shape 浮层，画布即时显示。
- 每次提交一条历史，Undo/Redo、保存重开、Player、单 HTML 精确保持。
- Slide 与 Flow 使用同一 Shape 属性控件和样式真相；正文 blocks 的结构与排版行为不变。

## Focused validation

- `npm run test:product -- tests/unit/flowSharedAuthoringAdapters.test.tsx tests/unit/flowOverlayTransform.test.ts tests/unit/flowUnifiedLayers.test.tsx`
- `npm run test:product -- tests/unit/editorTransaction.test.ts tests/unit/flowProductIntegration.test.tsx`
- `npm run test:e2e -- tests/e2e/stabilizationFlowAuthoring.spec.ts`

## Rollback / handoff

按共享控件→Flow adapter→Flow UI 纵切回滚，不保留 Slide/Flow 双实现。交接 `r12-045-flow-docx-fidelity` 时给出 text/image/shape 的固定 Flow fixture、layerItemId 与 Player/HTML 证据。
