# 1.9 独立只读评审 · 第二轮增量（2026-09-19 15:2x）

评审人：Claude（只读，不改产品代码、测试或历史记录）。本文件是新增记录，不改写任何既有记录；不放入 `docs/development-plan/tasks/`。

**增量范围**：第一轮评审（`2026-09-19-r19-independent-code-review.md`，08:26）之后开发方推进的全部工作 —— 签收包 §⑨ 附六～附十三（08:40–13:34），**以及签收包截止之后、无任何记录的 13:34–14:23 一轮**。

---

## 0. 结论摘要

- **最重要的一条**：签收包 `2026-09-19-r19-acceptance-package.md` 的最后写入时间是 **13:34**，而工作树与测试日志的最后活动是 **14:23**。这中间有**一整轮未入册的工作**，且其实测结论与签收包写下的结论**方向相反**（详见 §1）。任何据签收包 13:34 版做出的判断，都不适用于当前工作树。
- **当前工作树处于"落地态"而非签收包声称的"回退态"**：`LessonWorkspaceView.tsx` 14:02 写入的 standalone 内联宽度源头修复**仍在文件里**，而附十三写的是"已回退全部临时修改（JS 与 CSS 逐字还原）"。
- **当前工作树的非付费子集实测为 22 passed / 2 failed**（`landed-subset.log`，14:23，20.7m），两条确定性红：`:2256 活动文字草稿`、`:2956 S3 Flow 所见即所得`。其中 `:2956` 是**落地这次修复新引入的回归**（12:21 单跑还是绿的）。
- **新增声明本身经核对基本属实**：整课链 Luna·max 全绿（30.2m、5 个原生会话全 `gpt-5.6-luna`/`max`）、付费四链证据齐备、治理-2（Codex 路由）已按要求修为显式 Luna、B1–B4 历史 PNG 已逐字节还原。开发方在取证与自我更正上的质量依然高。
- **问题出在"收尾这一段"**：不是取证不实，而是**最后一轮工作跑在了记录前面**，加上附十三那句台账结论本身自相矛盾（"22 passed / 2 failed"与"仅剩 0 条持续红"同段并存）。
- **签收判断不变**：仍不建议签 accepted。第一轮的 P1-2（`scripts/` 两处失效 locator）**至今未动**；P1-1、P1-3 只做了局部。

---

## 1. 未入册的一轮：13:34 → 14:23

这是本轮评审的核心发现。证据全部来自 `{SCRATCH}/r19-red-cleanup/`（实际路径 `C:\Users\74755\AppData\Local\Temp\grok-goal-cae8406681b7\implementer\r19-red-cleanup`）与工作树文件 mtime：

| 时刻 | 事件 | 证据 |
|---|---|---|
| 13:30 | `revert-js-final.mjs` 写入（回退脚本） | 文件 mtime |
| 13:32 | `final-2256-restored.log`：回退后 `:2256` 单跑绿 | 该日志 |
| **13:34** | **签收包更新，写下「已回退全部临时修改（JS 与 CSS 逐字还原）」+「漂移台账终值 22 passed / 2 failed……两红均已在本轮转绿……仅剩 0 条持续红」** | 签收包 mtime + §⑨附十三 |
| 13:59 | `final-subset.log`：**回退态**全子集实测 **18 passed / 6 failed** | 该日志尾部 |
| **14:02** | **`LessonWorkspaceView.tsx` 写入 `state.standalone ? undefined : …`（落地 standalone 源头修复）** | 文件 mtime + `git diff HEAD` |
| **14:23** | `landed-subset.log`：**落地态**全子集实测 **22 passed / 2 failed** | 该日志尾部 |
| 14:23–15:2x | 无任何新活动（SCRATCH 与工作树均无更新） | `find -newermt` |

**由此产生三处记录与事实不符：**

**1-A．「已逐字还原」不成立。** 工作树中 `src/renderer/lessonWorkspace/view/LessonWorkspaceView.tsx:838-851` 现为：

```tsx
style={
  // standalone 布局里工作台是唯一一列，也隐藏了 splitter 与布局条（无任何尺寸控件），
  // 内联内容尺寸只会留下死区（r18-089 :678 的 691px 断言即此）；与 editor-focus 的
  // CSS 复位同义，从源头不再写入。
  state.standalone ? undefined : stacked ? { height: … } : { width: … }
}
```

这正是附十三矩阵里"移除内联宽（JS 源头修复，一行）"那一行。CSS 侧确已还原（`lessonWorkspaceShell.css` 无 standalone 复位规则），但 JS 侧没有。13:30–14:23 之间 `src/`、`tests/`、`scripts/` 下**只有这一个文件**被改动，没有任何配套的第二处修复。

**1-B．台账数字与三次实测都对不上。** 附十三写的"22 passed / 2 failed……两红均已在本轮转绿……本子集仅剩 0 条持续红"在同一段内自相矛盾（24 = 22 + 2）。三次实测的真实分布是：

| 状态 | 时刻 | 结果 | 失败项 |
|---|---|---|---|
| 回退态 | 13:59 `final-subset.log` | **18 / 6** | PPTX SmartArt:1661、PPTX 旧公式:1735、PPTX 普通映射:1817、Wave A:2348、三表面整合:2840、Flow 所见即所得:2956 |
| 落地态 | 14:23 `landed-subset.log` | **22 / 2** | 活动文字草稿:2256、Flow 所见即所得:2956 |

即：**回退态实测比签收包写的差**（18/6 而非 22/2），落地态才是 22/2。从工程判断看"选择落地"是对的（22/2 优于 18/6），但这个判断与它的依据都没有进入任何记录。

**1-C．`:2956` 是落地引入的新回归，且形态变了。** `micro-2956.log`（12:21）该用例单跑 `1 passed (48.1s)`；落地后（14:23）红在新位置：

```
:3008  TypeError: Cannot read properties of null (reading 'height')
       (await paper.locator('[data-flow-block-id="spacing-chart"]').boundingBox())!.height
```

不是附十三修掉的"内层 details 收起"，而是 `boundingBox()` 返回 null（元素测不到几何）—— 与"取消内联宽度导致编辑器进入宽布局"高度吻合。**这条回归无人记录。**

`:2256` 的红则与附十三的预测完全一致（不是新问题）：

```
:2256 → r18NativeAuthoringFixture.ts:678
  locator.click: Timeout 30000ms exceeded — getByRole('button', {name:'属性与素材'})
  element is not stable / element was detached from the DOM, retrying
```

即附十三所说的②号 bug（宽布局下"属性与素材"切换的 detach/重渲染循环）。**落地①而未修②，等于主动把 `:2256` 置于确定性红 —— 这一步没有写进任何记录。**

---

## 2. 我核实为真的新增声明

| 声明 | 出处 | 我的核对 | 判定 |
|---|---|---|---|
| 整课链 `1 passed (30.2m)`、EXIT:0 | 附八 | `whole-course-r4h/spec.log` 尾部原文一致；证据目录 09:08–09:38 完整（driver.log 61KB、7 个 stage 快照、actual-saved.png、课件 zip 49KB） | **属实** |
| 整课链路由 = Luna·max | 附八 | `actual-native-tasks.json` 中 `"model"` 全量统计：`{"gpt-5.6-luna": 5}`，`"effort"`：`{"max": 5}` —— 5 个原生会话无一例外 | **属实** |
| 课件 revision=73、5 surfaces | 附八 | `course.h5lesson` 为 zip（非 JSON），**我未解压核对**；文件存在、大小与时点吻合 | 未独立复核 |
| 付费四链 4/4 | 附九、附十 | `output/playwright/r18-cli-{codex,claude,opencode}/result.json` 三份齐备，mtime 09:49 / 09:54 / 10:09 与声明时点吻合；`elapsedMs` 分别 203045 / 176969 / 240270；committed 与 undone 回执逐条可见（`beforeRevision`/`afterRevision`/`semanticChanges`） | **属实**（一处细节见下） |
| 治理-2：codex/opencode 改为显式 Luna | 附八 | `stabilizationCoreUsability.spec.ts:911-919`：显式 `configure`，`/luna/i && /openai/i` 优先选取，effort 取 max、serviceTier 取 fast/priority，并 `console.log('S3 route', …)`；注释明写"不得静默沿用机器 config.toml 的默认（gpt-6-astra）" | **已修复** |
| B1–B4 历史 PNG 逐字节还原 | 附七 | `git status` 中该证据目录仅剩 13 张 `M`（A1–A6、C1–C5、V31×3），B1–B4 已不在改动列表 | **属实** |
| A 簇 editor 两条转绿 | 附十一 | `cluster-editor.log`：`:1041` 47.1s、`:1126` 1.1m，`2 passed (1.9m)` | **属实** |

**一处不完整披露（轻微）**：codex 的 `result.json` 中 `run0` 的 `status` 是 **`failed`**（hostResult 仍为 committed 0→1，summary 原文"上一轮未保存，原因是当前页面不接受该显示空间设置。本候选移除该设置……"——模型自我修正了一轮）。附九记作"runs=3（含 committed 0→1 与 undone 1→1）"，没有提 run0 是 failed 状态。不影响"通道可用"的结论，但"一次通过"的读感与一手数据略有出入。

---

## 3. 第一轮 P1/P2/治理项的处置状态

| 编号 | 第一轮问题 | 现状 | 判定 |
|---|---|---|---|
| **P1-1** | 「本轮引用」被移进默认折叠的 `details.chat-target-more`，约 21 个 e2e 会在 `selectOption` 失败 | 只有 2 处做了展开（`r19TaskDrivenTeacherChain.spec.ts:73` 既有、`stabilizationCoreUsability.spec.ts:3062` 附十三新增）。其余仍直接 `getByLabel('本轮引用').selectOption(…)`：`r18-089-flow-viewport:864`、`r18ClaudeRuntimeContinuation:220`、`r18NativeAuthoring:78`、`r18NativeAuthoringRemaining`（7 处）、`r18NativeAuthoringRemainingFixture`（2 处）、`r18NativeFailedCorrection:167`、`r18OpenCode2CanvasTail:79`、`r18LocalPerformance:150` 等 | **未闭合**（仍无共享 helper） |
| **P1-2** | `scripts/verify-release.ts:526`、`scripts/verify-w3-windows-portability.ts:415` 点击已删除的「专业」按钮，`verify:release` 链已断 | 两行原样存在，**未动** | **未处理** |
| **P1-3** | `editor.spec.ts` 27 条 0 通过、26 条 did-not-run 未归因 | 解锁并验证了 2 条（:1041/:1126）；**无全文件复跑日志**，26 条仍未定论（附十一自己也标注为"需一次全文件运行定论"） | **部分** |
| **P2-1** | `preserveAll` 与内联 ref 抖动 | 无改动痕迹 | 未处理 |
| **P2-2** | 17 张历史证据 PNG 被覆盖 | B1–B4 已还原（4/17）；其余 13 张仍为覆盖态 | **部分** |
| **P2-3** | 编辑器焦点下「返回工作台」被对话投影遮挡、不可点 | `lessonWorkspaceShell.css` 已加 `.workbench-layout-bar{padding-right:calc(min(400px,40%) + 8px)}`，注释写明几何根因 | **已修复** |
| 治理-1 | CopyMove 两测试文件删除依据仅为 AI 任务书中「Owner 已拍板」 | 仍待 Owner 亲自确认 | 待 Owner |
| 治理-2 | Codex 通道跑在未授权的 `gpt-6-astra` | 已改为显式 Luna·max（见 §2） | **已修复** |
| 治理-3 | `check:legacy-ready` / `zero` 红（stale-inventory） | 未变（Owner 持写锁） | 待 Owner |
| 治理-4 | 165 条变更长期未提交 | **仍未提交**，且又累积了 14:02 这次改动；距 `bc2072f7` 已超 39 小时 | **风险升高** |

---

## 4. 我这一轮独立复核的结果

| 检查 | 结果 | 说明 |
|---|---|---|
| `npm run typecheck` | **三 project EXIT 0** | 15:2x 本机重跑，对含 14:02 改动的当前工作树有效 |
| `vitest` 工作台相关 4 文件 | **73 passed / 0 failed** | `LessonWorkspaceShell`、`contentDockResizeSign`、`courseChatPanel`、`chatComposerMenus` |
| `check:task-board` | 绿（任务板已是最新） | |
| `check:contracts` | 绿（4 产物） | |
| `landed-subset.log`（14:23） | 22 passed / 2 failed，20.7m | 逐条读取失败原文，非计数摘要 |
| `final-subset.log`（13:59） | 18 passed / 6 failed，24.8m | 同上 |
| 三通道 `result.json` | 逐字段核对（status / hostResult / revision / semanticChanges） | |
| `actual-native-tasks.json` | 模型与 effort 全量频次统计 | |
| 工作树 diff | `git diff HEAD` 逐段读 `LessonWorkspaceView.tsx`、`lessonWorkspaceShell.css` | |
| 我没跑 | 任何 Playwright e2e、任何付费模型、`check:preservation` | 与第一轮同口径：避免覆盖 `docs/` 证据图与 `test-results/` |

---

## 5. 建议的下一步（按顺序）

1. **先补记录，再谈签收**：把 13:34–14:23 这一轮（回退态 18/6 实测 → 落地 standalone 修复 → 落地态 22/2）补进签收包，并订正附十三那句自相矛盾的台账结论。**在此之前，签收包不能作为签收依据**。
2. **就 `:2256` 与 `:2956` 两条确定性红做一次明确取舍**，三个选项都可接受，但必须选一个并写进记录：
   - 修②号 bug（`r18NativeAuthoringFixture.ts:678` 路径下宽布局面板切换的 detach 循环）后保留落地 —— 附十三已有完整配方；
   - 回退落地，接受 18/6 与 `:678` 死区；
   - 保留落地，把两条红登记为已知缺口并说明理由。
   附带修 `:2956` 的 `boundingBox()` null（落地引入的新回归）。
3. **P1-2 两行 locator**（`verify-release.ts:526`、`verify-w3-windows-portability.ts:415`），改动量两行，挡着整条 `verify:release`，无理由继续挂着。
4. **P1-1 收口**：抽一个 `openReferenceSelect(chat)` helper（照 `stabilizationCoreUsability.spec.ts:3059-3062` 的写法），替换约 20 处直接 `selectOption`，否则这些 spec 一旦解除门控就会集体红。
5. **P1-3 定论**：`editor.spec.ts` 跑一次全文件，把 26 条 did-not-run 变成确定结论。
6. **治理-4 先做一次 WIP 提交**。39 小时未提交、期间反复做"应用/回退/再应用"的源码实验，工作树已是唯一副本。这一条我第一轮就提过，现在风险更高。
7. 其余环境项（Claude CLI 登录、IME 人工验收单、13 张 PNG 还原）沿用第一轮结论。

---

## 附：我对开发方这一轮的整体评价

取证质量依然是高的 —— 一手日志、逐条失败原文、路由从 CLI rollout 反查、自我更正（附九的"凭证阻断"被附十自我推翻、附二的"CLI 损坏"被附三撤回）都做得比多数人工流程更严谨。

这一轮的问题不在诚实度，而在**节奏**：最后 50 分钟的工作跑到了记录前面，签收包在一个"尚未成为终态"的时点被定稿，于是一份本来准确的记录变成了描述不存在状态的记录。对一个明确以"记录可信"为交付物的流程来说，这比一条测试红更需要立刻修正。
