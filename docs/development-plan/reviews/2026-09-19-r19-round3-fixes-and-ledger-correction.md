# 1.9 第三轮修复与台账订正（2026-09-19 15:2x–17:xx）

执行者：Claude（本轮为**开发会话**，Owner 明确授权改代码；前两轮为只读评审）。基线：`main` @ `ddb1e057`。

本轮由 Owner 就第二轮评审的三项待决给出决定：① 两条红按"修②号 bug、保留 standalone 修复"处理；② CopyMove 退役确认为 Owner 决定；③ legacy-inventory reconciliation 授权执行。其余按第二轮评审 §5 的建议顺序推进。

---

## ① 时间线订正：13:34–14:23 那一轮已入册

签收包 `2026-09-19-r19-acceptance-package.md` 最后写入于 13:34，工作树与日志的最后活动在 14:23，中间一轮未入册。事实（证据：`{SCRATCH}/r19-red-cleanup/` 日志 mtime + 工作树 mtime，第二轮评审 §1 已详列）：

| 时刻 | 事件 | 证据 |
|---|---|---|
| 13:34 | 签收包写下"已回退全部临时修改（JS 与 CSS 逐字还原）"+"台账终值 22 passed / 2 failed……两红均已转绿……仅剩 0 条持续红" | 签收包 §⑨附十三 |
| 13:59 | **回退态**全子集实测 **18 passed / 6 failed** | `final-subset.log` |
| 14:02 | `LessonWorkspaceView.tsx` 落地 standalone 源头修复（与"已逐字还原"冲突） | 文件 mtime |
| 14:23 | **落地态**全子集实测 **22 passed / 2 failed**（`:2256`、`:2956`） | `landed-subset.log` |

**订正三点**：
1. 附十三"已回退全部临时修改、JS 与 CSS 逐字还原"**不成立**——CSS 侧确已还原，JS 侧于 14:02 重新落地并保留至今。
2. 附十三"22 passed / 2 failed……仅剩 0 条持续红"**自相矛盾且与三次实测都不符**（24 = 22 + 2）。回退态真实为 18/6，落地态才是 22/2。
3. 选择落地是**正确**的工程判断（22/2 优于 18/6），但判断与依据都未入册。本条补齐。

---

## ② 核心结论：所谓"联动 bug 对"不存在，是两个独立的条件错误

签收包附十三判定 `:678`（standalone 死区）与 `:2256`（面板按钮 detach）为"互为掣肘的两个真实 bug，只能二选一"，并据此回退、把联动修复推给下一批次。**该判定不成立**：两者各有独立根因，都已修复，三条用例同时为绿。

### 根因 1：`data-layout` 与内联宽度用了两个不同的条件

- `LessonWorkspaceView.tsx:1367` 判 standalone 布局用 `!state.workspace`
- 14:02 落地的那行跳过内联宽度用 `state.standalone`
- 而 `useLessonWorkspaceController.ts:83,87`（`detachLesson()` / `showProject()`）**只置 `setStandalone(true)`，不清 `workspace`**

于是存在 `workspace !== null && standalone === true` 的组合：CSS 仍按 workspace 布局渲染（splitter 与布局条都在，列宽必须由内联尺寸定），JS 却不写宽度 → 工作台列宽失控。

**修复**：判定改用与 `data-layout` 同一个条件（`state.workspace`），两者不再分叉。

### 根因 2：零宽度被当成"窄"，紧凑布局误判后翻转

`EditorPanelLayout.tsx:13` 原为 `setCompact(container.getBoundingClientRect().width < 1000)`，观察 `.lesson-course-tab`。而 `.lesson-course-tab[hidden]{display:none}`——课件 tab 未激活时宽度为 **0**，`0 < 1000` 判为紧凑，于是：

1. 挂载时先渲染紧凑控件条（含「页面与图层」「属性与素材」两个开关按钮）
2. tab 显示后 ResizeObserver 触发，宽度变为真实值 → 宽布局 → 控件条卸载
3. 正在点那个按钮的人（含 e2e）点到一个正在消失的按钮：`element is not stable` → `element was detached from the DOM`

HEAD 时工作台被内联宽度锁在 ~600px（仍 < 1000），compact 恒为真，掩盖了这次翻转；死区修复让工作台填满后翻转才显形。**真实用户同样会看到控件条闪一下**——零宽度做尺寸判定本身就是缺陷。

**修复**：宽度为 0 时布局尚未成立，不做判定。

### 验证（逐条实跑，非推断）

| 用例 | 修复前 | 修复后 |
|---|---|---|
| `stabilizationCoreUsability:2256` 活动文字草稿 | 30s click 超时（detach） | **1 passed (57.2s)** |
| `stabilizationCoreUsability:2956` S3 Flow 所见即所得 | `boundingBox()` 返回 null | **1 passed**（根因 1 修复后即绿） |
| `r18-089-flow-viewport:678` standalone 填满 | 691px 死区 | **1 passed (9.2m)** |

三条同时为绿，`:678` 的死区修复不必回退。附十三的三行矩阵在"只改一个条件"的前提下是准确的，结论错在把症状当成了第二个独立 bug。

---

## ③ 第一/二轮评审待办的处置

| 编号 | 问题 | 本轮处置 |
|---|---|---|
| **P1-2** | `scripts/verify-release.ts:526`、`verify-w3-windows-portability.ts:415` 点击 bc2072f7 已删除的「专业」按钮，`verify:release` 链已断 | 两处点击删除（简洁/专业合并后六个 tab 常驻，组件 tab 直接可达）。全仓 `专业`/`简洁` 按钮 locator **清零** |
| **P1-1** | 「本轮引用」被移进两层默认收起的 `<details>`，约 20 个 e2e 直接 `selectOption` 必失败 | 新增 `tests/e2e/chatReferenceTarget.ts`（`openReferenceSelect` / `selectReferenceScope`，零重依赖），**26 处调用点收敛到一处**：18 个文件批量替换 23 处 + 手工改 `r18LocalPerformance`、`r19TaskDrivenTeacherChain`、`stabilizationCoreUsability` 三处自定义实现。helper 对两层 details 都按需展开（已展开则不动，修掉了原 `choosePageTarget` 无条件点 summary 会误收起的隐患）。**验证覆盖的限定**：26 处里只有 `stabilizationCoreUsability` 那处落在本轮实跑的非付费子集内（`:2956`），其余 25 处都在付费或门控用例（如 `r18-089:865` 受 `FLOW_REAL_AI` / `FLOW_AI_VERIFY_EXISTING` 门控）里，**只有 typecheck 保证，无运行时验证** |
| **P2-1** | `preserveAll` 仍遍历活 Map；根因是内联 ref 每次重渲染先 delete 再 set 同键 | 两处都修：`preserveAll` 补快照遍历；新增 `editorRef(path)` 返回按 path 缓存的稳定回调，`LessonWorkspaceView` 两处内联 ref 改用它——**消除抖动本身**，快照不再只是止血 |
| **P2-2** | 四个 spec 把截图写进已跟踪的 docs 证据目录，17 张 09-17 原件被覆盖 | 13 张从 `bc2072f7` 逐字节恢复（B1–B4 开发方已还原，共 17/17 复原）；四个 spec 的 `evidence` 默认改为未跟踪的 `output/playwright/frontend-special-evidence`，归档需显式给 `R19_FRONTEND_EVIDENCE_DIR`——**历史证据不会再被重跑覆盖** |
| **P2-3** | `CourseChatPanel.tsx:441`「当前编辑目标」按钮无 `onClick`，设计说明 §5.1 要求它可点开 | 按钮改为切换「其它目标」details（`aria-expanded` / `aria-controls` 补齐），details 受控并用 `onToggle` 同步用户直接点 summary 的情况。**未删重复摘要**：`本轮引用摘要` 是 5 处以上 e2e 的断言契约，视觉重复的代价小于破坏契约 |
| **P2-4** | `/` 命令正则 `(?:^|\s)\/([^\s]*)$` 把「参考 /workspace/a.md」当命令查询，弹「没有匹配的命令」挡住输入 | 改为 `^\/([^\s/]*)$`：命令只在输入开头、且 token 内不含路径分隔符（命令 id 与 label 从不含 `/`）。**补回归单测**一条（空格后绝对路径、整条绝对路径都不触发；`/` 仍列全部命令） |
| **P2-4 余项** | 键盘导航（方向键 / Enter / Esc）、aria 语义、IME 期间无守卫 | **Owner 决定「按 VS Code 实现」后完成**，见 §⑧ |
| **P2-5** | 路径比较有三套实现 | **Owner 决定后完成**，见 §⑧ |
| 治理-1 | CopyMove 退役依据 | Owner 本轮**已确认为自己的决定** |
| 治理-2 | Codex 通道曾跑在 `gpt-6-astra` | 开发方已于附八改为显式 Luna·max（`stabilizationCoreUsability.spec.ts:911-919`），本轮复核属实 |
| 治理-3 | `check:legacy-ready` / `zero` 红 | 本轮执行 reconciliation，见 §⑤ |
| 治理-4 | 165 条变更 39 小时未提交 | 已提交并推送 `ddb1e057`（`bc2072f7..ddb1e057`） |

---

## ④ 验证

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 三 project EXIT 0（每次产品改动后重跑） |
| `vitest` 工作台 + 聊天相关 | `LessonWorkspaceShell`/`contentDockResizeSign` 13 passed；`chatComposerMenus`/`courseChatPanel` 61 passed（含新增 POSIX 路径回归） |
| `check:task-board` / `check:contracts` / `check:development-roadmap` | 全绿（176 节点 / 22 规格 / 4 产物） |
| `check:legacy-inventory`（ratchet） | 绿，且七项实质判据全零：unknown 0 / tokenHits 0 / targetReferenceHits 0 / confirmedEndpoint 0 / matchedConfirmedRelation 0 / file-absent 仍存在 0 / symbol-absent 仍有定义 0 |
| `:2256` / `:2956` / `:678` | 逐条实跑转绿（见 §②） |
| `check:ai-capabilities` / `check:examples` | 绿（索引 16275/16384；11 项 OK） |
| 非付费子集（`--grep-invert "S3 真实"`） | **24 passed / 0 failed（22.9m）**，见 §⑥ |
| `editor.spec.ts` 全文件 | **27 passed / 0 failed（21.4m）**，见 §⑥之二 |
| `check:preservation` | **27 个 automated pass**（candidate `05718893`；"Owner 观察未签署：PM-01"属设计内，非失败）。**订正本轮早先的判断**：曾以"会执行 27 条 evidence 命令"为由跳过，但那 26 条去重命令**全部是 `npx vitest run`**，不写证据图、不碰 dist，跳过属过度保守 |
| 全量 `npm test`（= `vitest run`，不含 e2e） | 三跑对照 1 failed / 1 failed / **440 passed、4257 tests、0 failed**。失败条恒为 `generationCapabilityWorkspace.test.ts:472`（建 36 层目录 + 写 18 万字节 + 启两个 Node 子进程，默认 5s 在 440 文件并发下不够），**单文件复跑 28/28（10.5s）**——坑 5 明列的负载抖动，非产品问题 |
| P2-4 / P2-5 单测 | `chatComposerMenus` 8 passed（新增 5 条含 IME 守卫）、`workspacePathNormalize` + `courseChatPanel` 合计 68 passed |
| 未跑 | 任何付费模型——**DoD 第 6 项已于 09-19 10:10 达成 4/4**（codex / claude / opencode / 整课链，见签收包 §⑥ 表与附八~附十；本轮早先误读 §④ 的 R4b 快照而判其未做，已更正）；`verify:release` 本体（需打包产物，P1-2 以全仓 locator 清零 + typecheck 做静态确认） |

每次 e2e 前都重建了 `dist`（附十二吃过"未重建 dist 致 CSS 修复未被验证"的亏，本轮不重复）。

---

## ⑤ legacy-inventory reconciliation（Owner 授权）

**红的性质**：不是缺陷，是设计。台账 `docs/development-plan/inventories/legacy-consumers.json` 的 `baseline.reconciledProductTreeDigest` 记录上次人工核对时的产品树 sha256；`ratchet` 模式不比对它（故绿），`ready` / `zero` 要求一致（故红）。本轮改了产品代码，digest 自然偏离。脚本**没有** `--write` / `--reconcile` 开关，台账只能手工编辑——刻意如此，否则门等于自己发免检证（`scripts/check-legacy-consumers.ts:91` 注释：`Fixed queries cannot be narrowed by editing the inventory`）。

**核对依据（不是刷新数字）**：`ratchet` 模式的七项实质判据全为零（见 §④），即 `ready` 的全部实质断言已满足，11 条记录的 `removed` 结论在当前代码下仍然成立，本轮改动未引入任何新的遗留消费点。

**执行**：`reconciledProductCommit` 与 `reconciledProductTreeDigest` 更新为本轮代码提交及其产品树 digest；`baselineCommit` / `claimCommit`（原始基线）不动。台账文件在 `productDigestExclusions` 内，改它不会反过来改变 digest。为使语义自洽，**分两个提交**：先提交代码修复，再由台账提交指向它。

---

## ⑥ 非付费子集台账（权威替代）

以修复后的 `stabilizationCoreUsability.spec.ts`（sha `00c64c44410c6afd99cc485b18887f543b03da48`）重跑 `--grep-invert "S3 真实"`，**重建 dist 之后**：

> **Running 24 tests / 24 passed / 0 failed（22.9m，EXIT:0）**
> 无 did-not-run、无 skip、无 flaky——计数自洽（24 = 24）。

**台账演进（同一子集口径）**：

| 时点 | 结果 | 说明 |
|---|---|---|
| 09-19 08:40 权威重绑 | 15 / 9 | 开发方 `rebind-stabilization-nonpaid.log` |
| 09-19 12:17 | 22 / 2 | B/C 簇修复后 `verify-subset.log` |
| 09-19 13:59 | **18 / 6** | 回退态 `final-subset.log`（签收包未记） |
| 09-19 14:23 | 22 / 2 | 落地态 `landed-subset.log`（签收包未记） |
| **本轮 16:56** | **24 / 0** | 两个根因修复后 |

**§②③ 的修复由本次运行覆盖到的部分**：`:2257` 活动文字草稿（根因 2）、`:2957` S3 Flow 所见即所得（根因 1，且该用例使用新的 `selectReferenceScope` helper，是 26 处替换里唯一有运行时验证的一处）、`:2349` Wave A、PPTX 家族四条、`:2841` 三表面整合、`:2720` 共享组件源码。**签收包 §②A 所列的非付费漂移红在本子集内归零。**

---

## ⑥之二 `editor.spec.ts` 全文件定论（P1-3 关闭）

第一轮评审 §3 P1-3 的关切是：该文件 27 条用例 0 通过（`:1041` 失败 + `test.describe.serial` 于 :797 级联使 26 条 did-not-run），"核心编辑器回归覆盖实际处于失效状态，且未做逐条归因，**不能排除产品回归**"。

本轮全文件复跑（本轮全部产品改动落地之后）：

> **Running 27 tests / 27 passed / 0 failed（21.4m，EXIT:0）**

**结论：那 26 条 did-not-run 全部为绿，不存在被级联掩盖的产品回归。**它们此前从未运行只是因为入口用例失败导致 serial 级联，失败点本身（`:1045/:1046` 的「简洁模式下 tab 不存在」）是 bc2072f7 有意合并简洁/专业模式后的断言过期，已由 A 簇修正。

逐条含此前被点名的用例：`:1126` 专业模式（48.0s）、`:1195` 当前位置试运行（21.8s）、`:1962` 文字编辑事务（含 IME 与撤销，54.0s）、`:2055` 画布双击持续输入与 Escape 取消（25.0s）、`:3861` 未保存课件自动恢复（24.9s）。其中 `:1962` 的 composition 断言通过，为 V05「画布文本侧有 IME 合成用例」提供了本轮实跑证据（**但聊天输入框的 IME 路径仍无自动化，人工验收单仍为必做项**）。

---

## ⑦ 残余缺口（如实登记）

1. **P2-4 余项与 P2-5**：见 §③，属登记项（需产品决策）。
2. **`r18-089:677`** `expectStableController` maximumShift 36（浮层控制器 playback 位移）：附十二登记的独立新问题，本轮未动。
3. **`r19CrossPageObservation:12`**（canvas hidden）、**`v9PreviewNetwork:245`**（Ctrl+O 后标题未切换）、**`spatialGlobalRuntimeAuthoring:297`**（`global-layer-entry` 不可见，开发方有界尝试已耗尽）：三条零散漂移未定位。
4. **付费门控**：`R19_DELIVERY_*` 等变量族仍未跑；IME 人工验收单仍待执行。
5. **`:780`**：本轮 `file:line` 定位只匹配到 `:678` 一条（Playwright 报 `Running 1 test`），`:780` 未单独复跑。

---

## ⑧ P2-4 键盘导航与 P2-5 路径统一（Owner 决定后执行）

### P2-4：`/`、`@` 候选菜单按 VS Code 对齐

**改前的实况**：`ChatComposerMenus.tsx` 只有 71 行，`role="listbox"` / `role="option"` 其实已经就位，缺的是交互本身——选中项只能用鼠标 `onMouseDown` 触发，没有任何 `onKeyDown`；而且 `.chat-composer-menu` **在全仓没有任何 CSS**，是一排浏览器默认按钮。

**改动**：组件改为 `forwardRef` 暴露 `handleKeyDown(event): boolean`，两个使用点（`CourseChatPanel.tsx:476`、`LessonConversationChat.tsx:195`）的 `<textarea>` 把按键转发给它。行为对齐 VS Code 候选列表：打开即选中首项、`↑`/`↓` 循环、`Enter` 与 `Tab` 接受、`Escape` 只关本次候选（不清输入，继续输入重新打开）、鼠标悬停同步选中项；`aria-activedescendant` 与每项 `id` / `aria-selected` 补齐。CSS 补一段，其中选中态必须自身可见（`[aria-selected=true]`）而不能只靠 `:hover`——键盘导航时鼠标不在菜单上。

**IME 守卫是这次改动的必要组成，不是附带**：改之前 Enter 在聊天输入框没有任何绑定（`<textarea>` 无 `onKeyDown`，发送只在按钮的 `onClick`），所以「组合中按 Enter 误发」在结构上不可能发生；**一旦给 Enter 赋予「接受候选」的语义，这个风险就真实存在了**。因此 `handleKeyDown` 首行即检查 `event.nativeEvent.isComposing || event.keyCode === 229`，组合期间一律不消费按键。这同时关闭了 P2-4 登记的第四个子项。

**连带影响**：IME 人工验收单的第 2 步（组合中回车不误发）由「结构性不可达」**恢复为必验项**——代码里防住了，但要真人确认防住了。

**测试**：`chatComposerMenus.test.tsx` 新增 5 条（循环导航、Enter/Tab 接受并回报按键已消费、@ 插入、**组合期间全部按键不响应**、Escape 不清输入且可重开），连原有 3 条 **8 passed**。

**未做**：`@` 仍只列当前目录、不递归子目录——这是能力范围问题（递归要定深度上限与忽略规则，且会放大 `list-directory` 的开销），与键盘导航无关，仍登记。

### P2-5：三处内联路径比较统一

评审列的四处里 `useDocumentTabsController.ts` 已不存在，实际剩三处内联 `.replace(/\/g,'/').toLowerCase()`（`LessonWorkspaceHost.tsx:67`、`LessonConversationChat.tsx:22`、`:32`）。`shared/workspaceIdentity.ts` 新增 `sameWorkspacePath(left, right)`，内部走 `normalizeWorkspacePath`（**内联版都漏了尾斜杠规则**），空值与不可规范化的输入一律不相等。三处改用它，全仓 `normalizedPath.replace` 清零。`workspacePathNormalize.test.ts` 补一条，锁住「同目录不同写法相等」与「null/空串/含 `\0` 不得意外相等」。

---

## ⑨ DoD 现状（`R19_SIGNOFF_PUSH_BRIEF.md:88` 十条，本轮代码下逐条复核）

| # | 判据 | 状态 | 依据 |
|---|---|---|---|
| 1 | 全量 `npm test` 0 failed | 达成 | 本轮第三跑 440 files / 4257 tests / 0 failed；前两跑各 1 条负载抖动，单文件复跑 28/28（见 §④） |
| 2 | 四条 check 全绿 | 达成 | 含 `check:preservation` 27 automated pass（candidate `05718893`），本轮代码下重跑 |
| 3 | typecheck 三 0 | 达成 | 每次产品改动后重跑 |
| 4 | 25 文件修完 + 抽样复跑 | 达成 | R2 既有 |
| 5 | V05 选择/粘贴与 V10 焦点 | 达成 | 前者实跑、后者明标缺口 |
| 6 | 三条付费验证留档 | 达成（4/4） | 09-19 10:10（R4j）；**非本轮执行，本轮仅复核** |
| 7 | **IME 人工验收留档** | **未达** | **唯一剩余项**；验收单见 `2026-09-19-ime-manual-acceptance.md` |
| 8 | 签收包落盘 | 达成 | 并于本轮追加 §⑩ 勘误 |
| 9 | 历史记录逐字未改 | **本轮转为达成** | 17/17 PNG 复原，证据目录改为未跟踪的 `output/`，`.md` 历史只追加不改写 |
| 10 | 未签 accepted / 未打标签 / 未建安装器 | 达成 | `git tag` 无 `v1.9.0*` |

**结论：DoD 十条中九条达成，仅剩第 7 项（IME 人工验收）。** 该项只能由人执行——自动化只能伪造组合事件，与真实输入法的行为不等价（本轮 CDP 探针的限定同此）。

**验收单的范围修订**：原单 6 步。经代码核查，第 3 步（组合中输入 `/` 误弹菜单）在当前实现下不可达——`/` 触发条件已收紧为 `^\/([^\s/]*)$`，先打拼音再打 `/` 得到的 `zf/` 不匹配。第 2 步（组合中 Enter 误发送）在 §⑧ 之前同样不可达（`<textarea>` 无 `onKeyDown`，发送只在按钮 `onClick`），但 **§⑧ 给 Enter 赋予了「接受候选」语义后恢复为必验项**。建议执行范围：第 1 步（中文输入不丢字/重字/错位——受控 `<textarea>` + IME 是真实风险）、第 2 步、第 6 步（发送后清空）。
