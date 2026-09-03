# r11-026-slide-properties-modules｜Slide 与全局属性形成真实模块边界

- Release / Dependencies: 1.1 / r11-021-slide-properties-editors, r11-027-flow-authoring-modules, r11-028-spatial-authoring-modules
- Write locks: `workspace-properties`
- Inventory access: `read`
- Preservation: PM-01, PM-03, PM-07–PM-09, PM-12, PM-14–PM-15

## Outcome / current evidence

`PropertiesTab.tsx` 当前同时承担 Surface 判断、目标解析、Native/Global/Runtime/Component 属性规则和提交接线。本节点把它收敛为 discriminated context router；Slide Native、Course Global、Runtime 与共享原子控件成为真实模块，叶子面板只接收 effective view、canonical target、typed command 和反馈 port。

## Integrator audit / reopened（2026-09-03）

`SlideNativePropertiesPanel`、`CourseGlobalPropertiesPanel`、`RuntimePropertiesPanel`、`FlowPropertiesPanel` 等叶子是真实成果，应保留；但 `PropertiesTab.tsx` 仍直接执行 `applyPropertiesPatch`、`useEditorStore.getState/setState`、Slide/Flow/Spatial command 组合、Runtime writer 与 target/context 构造，尚未满足“只路由”的退出条件。本次返工只收口 root 与窄 context composition，不重写已成立叶子，不改变属性语义、Schema、canonical command 或 History。

## Read first

- `src/renderer/ui/PropertiesTab.tsx`
- `src/renderer/ui/ComponentPropertiesEditor.tsx`
- `src/renderer/ui/DeveloperTab.tsx`
- `src/renderer/ui/properties/FlowPropertiesPanel.tsx`
- `src/renderer/ui/properties/SpatialPropertiesPanel.tsx`
- `src/renderer/authoring/v9SlideContentEdit.ts`
- `src/renderer/course/v9SlideContentCommands.ts`
- `tests/unit/readModelBoundary.test.ts`

## Exact targets

| Target | Required responsibility | Forbidden dependency |
|---|---|---|
| `src/renderer/ui/properties/PropertyControls.tsx` | 只放无领域状态的 label/input/color/number 等原子控件 | Store、document、Surface command |
| `src/renderer/ui/properties/SlideNativePropertiesPanel.tsx` | Text/Formula/Image/Video/Shape 的 typed view/command | Flow/Spatial command、旧 Scene projection |
| `src/renderer/ui/properties/CourseGlobalPropertiesPanel.tsx` | global/surface owner、plane/order/visibility 与控制器属性 | 本地 Surface selection 镜像 |
| `src/renderer/ui/properties/RuntimePropertiesPanel.tsx` | Runtime target/source/props 的现有正式 command 接线 | raw Store mutation、Component registry 实现 |
| `src/renderer/ui/properties/FlowPropertiesPanel.tsx` | Flow 选中项的窄 view/typed command 接线 | Slide/Spatial command、完整 Store |
| `src/renderer/ui/properties/SpatialPropertiesPanel.tsx` | Spatial 选中项的窄 view/typed command 接线 | Slide/Flow command、完整 Store |
| `src/renderer/ui/properties/PropertiesContextAdapter.ts`（planned） | 组合命名 selector、单一 owner view 与 typed command port | 完整 State/document、raw Store、跨 owner mutation/persist |
| `PropertiesTab.tsx` | 根据 `selectPropertiesContext` 的判别联合选择一个面板 | 属性业务规则、document mutation、完整 `EditorState` |

不得新建 generic property DSL、JSON field schema 或第二套 `GlobalLayerSettings`。现有 Component editor 保持独立；本节点只把它接到明确 context，不复制其实现。合法窄 adapter 可以消费命名 selector、单一 owner view 与 typed command port；不得读取完整 `State` / document、调用 raw `getState/setState`、组合跨 owner mutation/persist、持有 module-global mutable bind，或返回可替代 Store 的宽对象。

## Write scope

只允许修改 `src/renderer/ui/PropertiesTab.tsx`、`src/renderer/ui/properties/**` 中现有叶子与 `PropertiesContextAdapter.ts`、现有直接属性 editor/selector；只有为了让现存 root 逻辑回到正式 typed owner command/use case，才允许精确修改 `src/renderer/course/effectiveLayerCommands.ts`、`src/renderer/course/v9SlideContentCommands.ts`、`src/renderer/course/globalLayerCommands.ts`、`src/renderer/course/flowEditorCommands.ts`、`src/renderer/course/spatialEditorCommands.ts`、`src/renderer/runtime/runtimeContentTextAuthoringCommands.ts` 与 `src/renderer/authoring/v9TeacherControllerAuthoring.ts`，不得改变语义、wire 或 History。只允许更新 `tests/unit/readModelBoundary.test.ts`、`tests/unit/v9SlideTextTransaction.test.ts`、`tests/unit/interactionEditor.test.tsx`、`tests/unit/componentPropertiesEditor.test.tsx`、`tests/unit/v9GlobalLayerUiAdapter.test.tsx`、`tests/unit/flowProductIntegration.test.tsx`、`tests/unit/flowFormulaProperties.test.tsx`、`tests/unit/spatialProductIntegration.test.tsx` 的直接断言。`DeveloperTab.tsx` 只允许在本节点处理既有整文件 CRLF 噪声，不得夹带语义修改。禁止修改 Schema、Store writer、Flow/Spatial 语义、共享 inventory 或隐藏任何专业能力。

## Execution

1. 在目标测试固定 Text/Formula/Image/Video/Shape/Component/Runtime/Controller、命名状态、global/surface owner 与简洁/专业模式的可见和写入结果。
2. 定义 `PropertiesContext` 判别联合；每个分支只包含该面板需要的 readonly view、canonical target、command callbacks、disabled reason 和 feedback callback，不包含 Store、raw `get/set` 或整个 document。
3. 先抽 `PropertyControls`，替换一处后运行属性测试；它不得知道 target 或提交。
4. 按 Slide Native → Course Global → Runtime → Flow → Spatial 的顺序迁移 root 接线。每迁一组，就在同一提交删除 `PropertiesTab.tsx` 中对应 state/effect/handler/import；不保留代理分支。Flow/Spatial 只迁窄 context wiring，叶子语义仍由 r11-027/028 的正式 owner 持有。
5. `PropertiesTab.tsx` 最终只通过一个窄 selector/hook 取得 `PropertiesContext` 并执行单一分支渲染；root 不得调用 raw Store、解析 canonical target、组合 patch/coalesce/persist 或 import Surface command。所有提交继续走 r11-021 已验证的 typed command/history，stale/locked/invalid 零写入。
6. 在 read-model ratchet 同时增加正反两类证据：允许 root 只 import context/router 与叶子；直接 Store 调用、Surface command import、mutation helper、完整 document/State port 任一出现都必须失败。不得只检查叶子 import 已存在。

## Stop conditions

- 某属性没有现成 V9 view/command，需要新增直接 document mutation 或完整 Store Facade。
- 拆分会隐藏 DeveloperTab、Component、Runtime、互动或媒体入口。
- 需要修改 V9/Published wire、建立通用属性 DSL 或同时改变 Flow/Spatial 语义。

## Acceptance

- `PropertiesTab.tsx` 不保留属性业务规则或直接 mutation；叶子面板不 import `editorStore`、旧 Project/Scene projection 或其他 Surface command。
- `PropertiesTab.tsx` 无 `useEditorStore.getState/setState`、Surface command import、target 解析或 patch/coalesce/persist 实现；窄 adapter 只返回 readonly view、canonical target、typed callbacks、disabled reason 与 feedback。
- 原文件实际删除迁出 imports/state/effects/handlers，不以 re-export、wrapper 或同文件 helper 冒充拆分。
- 全部既有属性入口可见、可保存、可撤销；一次提交只有一个 document/resource History，失败零写入。
- `selectPropertiesContext` 对无 selection、stale target 与每个正式 owner 都有确定分支，不把完整 document 复制给叶子。
- adapter 只消费命名 selector、单 owner view 与 typed port；无完整 State/document、raw Store、跨 owner mutation/persist、module-global bind 或宽对象返回。
- `PropertiesTab.tsx` 与本节点实际触及的 `DeveloperTab.tsx` 无 CRLF/trailing-whitespace 噪声。

## Focused validation

- `npx vitest run tests/unit/readModelBoundary.test.ts tests/unit/v9SlideTextTransaction.test.ts tests/unit/componentPropertiesEditor.test.tsx tests/unit/v9GlobalLayerUiAdapter.test.tsx tests/unit/flowProductIntegration.test.tsx tests/unit/flowFormulaProperties.test.tsx tests/unit/spatialProductIntegration.test.tsx`
- `npm run typecheck`

## Rollback / handoff

按一个完整面板纵切回滚，不能恢复已经迁出的双实现。交接列出仍留在 `PropertiesTab.tsx` 的业务 owner、原因、直接 consumer 和下一明确 target。
