# r11-063-flow-text-format-hotfix｜修复 Flow 选区字体/字号操作与折叠光标待输入样式

- Release / Dependencies: 1.1 / r11-062-owner-release
- Write locks: `editor-store-history`, `workspace-properties`
- Inventory access: read
- Preservation: PM-04, PM-10, PM-12, PM-18, PM-19, PM-24

## Outcome / current evidence

在真实 Electron 作者界面中用鼠标选择 paragraph 的非空文字后，字体下拉和字号输入虽然已启用，但点击仍把焦点留在 inline editor，原生控件无法展开或接收键盘输入。现有单测直接触发 change，加粗按钮 E2E 又不需要控件取得焦点，因此都未证伪这个失败。折叠光标处当前也没有待输入样式，教师不能先选择字体/字号再输入。

本节点修复两个属于同一 Flow 文字格式会话的缺口：非空选区可通过真实控件改字体/字号；折叠光标可设置待输入样式并只作用于随后输入的文字。它不扩张 Flow 为自由画布，不改变 V9 / Published V2 wire。

## Read first

- `COURSEWARE_DEVELOPMENT_PLAN.md`
- `docs/development-plan/ARCHITECTURE_CONTRACT.md`
- `docs/development-plan/roadmap/PRESERVATION_MATRIX.md`
- `src/renderer/ui/FlowBlockContextToolbar.tsx`
- `tests/unit/flowBlockContextToolbar.test.tsx`
- `tests/unit/flowInlineTextEditor.test.tsx`
- `tests/unit/flowEditorCommands.test.ts`
- `tests/e2e/stabilizationFlowAuthoring.spec.ts`

## Execution

1. 移除或收窄阻止原生 font-family select 与 font-size input 取得焦点的事件拦截；用明确的 selection snapshot / restore 或同等窄机制保留目标 range，不让控件点击把命令目标折叠、漂移到别处或变成 no-op。
2. 为折叠光标建立仅属于当前 inline edit session 的 pending text style。字体、字号以及同一工具栏已公开的 inline style 采用一致语义；用户输入文字时才物化为普通非空 text run，移动光标、切块、取消编辑或切 Surface 时按清晰规则清理。
3. range 格式变更和一次连续输入分别只提交一个可解释的 canonical history 事务；Undo / Redo 精确恢复文字、runs 与选择后的可继续编辑状态。
4. 增加能使用真实 focus、pointer 和 keyboard 路径失败的回归测试；禁止只用 `fireEvent.change` 或直接调用 command 冒充原生控件可用。

## Write scope

只修改 Flow inline text toolbar/editor/controller 的正式 owner、相邻样式归一化 helper、为保全已承诺 delivery 而必需的 Flow 语义 HTML / DOCX 富文本投影，以及对应测试。不得修改 V9 / Published V2 Schema，不得新增持久化 pending-style 字段、零长度 run、第二 editor state/history/writer，也不得借此补做 1.2 的 Flow 浮层属性扩展。

## Acceptance

- 鼠标选择 paragraph 中真实非空文字后，字体下拉能展开并选择字体，字号输入能取得焦点、接收键盘值并提交；两次操作都作用于原选区而不是整段或错误 range。
- 折叠光标处选择字体/字号后输入，新字符取得待输入样式；光标前后的既有文字不被误改，空操作不产生零长度 run 或脏历史。
- 每个用户确认动作只有一个历史事务；Undo / Redo 后文字和 runs 精确恢复。
- 保存、重开后样式不丢失，当前页试运行、整课 Player、单 HTML 与适用 Flow DOCX 读取同一持久化结果。
- 加粗等已有 range 格式、IME/普通输入、块切换和 Surface 切换无回归；未引入 V9 / Published V2 wire 变化。

## Focused validation

```text
npm run test:product -- tests/unit/flowBlockContextToolbar.test.tsx tests/unit/flowInlineTextEditor.test.tsx tests/unit/flowEditorCommands.test.ts tests/unit/coursePrintArtifacts.test.ts
npm run typecheck
npm run test:e2e -- tests/e2e/stabilizationFlowAuthoring.spec.ts
git diff --check
```

最后一条 E2E 必须包含物理鼠标选择、点击/键盘操作原生字体与字号控件、折叠光标设置样式后输入，以及保存重开；不得只断言控件 enabled 或直接派发 change。

## Rollback / handoff

若无法在不改变 wire、不生成零长度 run 且保持一个 history owner 的前提下同时满足 range 与 caret 语义，回滚到 `v1.1.0` 行为并把失败点交回 Flow text owner；不得把失效控件继续留在 UI 或将缺陷静默推迟到 1.2。

## Completion record（2026-09-04）

- 状态：`completed`。原生字体下拉与字号输入允许真实 focus/pointer/keyboard 事件，同时保留并恢复命令目标选区；Enter 提交字号不会向正文插入换行。
- 折叠光标样式只存在于当前 Flow inline edit session，移动光标、切块或退出会话时按规则清理；只有随后输入的非空字符写入普通 runs，pending style 本身不写工程、不置 dirty、不产生历史。
- Flow Workspace 在命令提交后采用 canonical receipt，避免 contenteditable 的迟到草稿覆盖格式结果；Player 的 run 合并同时比较 `fontFamily` / `fontSize`，语义 HTML 与 DOCX 均保留同一富文本 runs。
- 实施期间全量桌面回归另发现并闭合 Slide 画布局部格式入口、画布草稿到属性栏的实时投影与焦点事务转接；它们继续使用唯一 `v9ContentEdit` owner，没有新增镜像状态。
- 证据：相关 104 项 Store / Properties / read-model 单测、Flow 聚焦单测与 `stabilizationFlowAuthoring.spec.ts` 均通过；最终候选再由 r11-064 的全量发布门覆盖。
