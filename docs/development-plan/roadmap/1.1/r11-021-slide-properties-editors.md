# r11-021-slide-properties-editors｜属性与高级编辑器使用 V9 view/command

- Release / Dependencies: 1.1 / r11-020-slide-effective-read-model
- Write locks: `workspace-properties`
- Inventory access: read
- Preservation: PM-01, PM-03, PM-07–PM-09, PM-12, PM-14–PM-15

## Outcome / current evidence

Slide 的 Properties、动画、互动、文本/公式、组件与 Runtime 开发面板从 canonical V9 session/effective view 读取，并通过既有产品 command 原子写入；不再以旧 Scene 投影或 `EditorState.project` 为读取真相。

## Read first

- `src/renderer/ui/PropertiesTab.tsx`
- `src/renderer/ui/DeveloperTab.tsx`
- `src/renderer/ui/InteractionEditor.tsx`
- `src/renderer/ui/SimpleEntranceAnimationEditor.tsx`
- `src/renderer/authoring/v9SlideContentEdit.ts`
- `src/renderer/course/v9SlideContentCommands.ts`

## Exact targets

| UI vertical | Read target | Existing write owner | Direct test |
|---|---|---|---|
| Native Text/Formula/Image/Video/Shape | `PropertiesTab` + r11-020 effective item/address | `v9SlideContentEdit` / `v9SlideContentCommands` | `v9SlideTextTransaction.test.ts` |
| Entrance animation | `SimpleEntranceAnimationEditor` + effective content | existing slide content command/history | `v9SlideProductIntegration.test.tsx` |
| Interaction | `InteractionEditor` + `slideInteractionView` | existing interaction command | `interactionEditor.test.tsx` |
| Component props/source | `ComponentPropertiesEditor` + canonical component target | existing component authoring transaction | `componentPropertiesEditor.test.tsx` |
| Runtime props/source/template | `DeveloperTab` + canonical Runtime target | existing Runtime authoring commands | `developerMode.test.tsx` |

每行是一个不可拆半的 UI→read→command 纵切；按表顺序完成，不允许执行者新增 generic property DSL。

## Write scope

只允许修改 Exact targets 所列 UI/read/write 文件与五个 direct tests；不存在的 test 名称必须先由 Integrator 更新规格，执行者不得新建或替换检查。禁止删除/隐藏专业模式、代码、组件、Runtime、媒体或互动能力；禁止直接 mutate document、增加 Store 镜像、改变 Flow/Spatial UI 或 Schema。

## Execution

1. 按 Exact targets 五行确认当前控件、read 与 command symbol；任何一行不存在或 owner 不符即停止更新规格，不现场选架构。
2. 每个控件从 r11-020 的稳定 target/effective view 取得显示值；draft/IME 保持局部，提交时捕获 canonical target。
3. 写入调用现有 typed command / `EditorTransactionStep`；stale、locked、invalid 返回可识别失败且零写入。
4. 一次用户提交只形成一条 document+resource 历史；切 Tab/模式不提交。
5. 移除对应旧 projection/Store read，保留当前错误反馈和可发现入口；交接列出预期减少的 LEG endpoint 与精确查询，不修改共享 inventory。

## Stop conditions

- 某控件没有等价 V9 command，需要私自直接写 Store。
- 必须删除功能、隐藏入口或丢弃当前字段才能迁移。
- draft/IME、resource transaction 或 stale target 语义无法保持。

## Acceptance

- 简洁/专业模式与 DeveloperTab 的现有能力均可发现、可保存、可撤销。
- 目标 UI 不读取 `EditorState.project`/旧 Scene projection。
- 跨页、切工程、revision 变化后的迟到提交 fail-stale 且不写当前页。

## Focused validation

- `npx vitest run tests/unit/v9SlideTextTransaction.test.ts tests/unit/interactionEditor.test.tsx tests/unit/componentPropertiesEditor.test.tsx`
- `npm run typecheck`

## Rollback / handoff

按控件纵切回滚 selector/command 接线，不能保留双写。交接列出缺少正式 command 的控件及其当前行为证据。
