# 1.9 执行记录：遗留红清理与零模型缺口补齐（清理轮）

日期：2026-09-19（凌晨）。执行：集成人 + 多子智能体工作流（14 智能体，编辑并发、运行串行）。状态：**清理轮完成；残余 9 条已登记；签收推进继续。** 未签 accepted、无 `v1.9.0-rc.N`、无安装器、PM-01 正文未改。

工作树：`main` @ `bc2072f777a2ca36e545979e3b67d782d105fce6`，未 reset/clean。开工快照 `preflight.txt`：`git status --short` = **109**（89 ` M` + 20 `??`）；closeout 时 128 条 = 109 + 本轮声明面 18 + 1 条外部并发写入（见 §6 R-9）。本记录为**新增**，历史记录一字未改。

## 1. 源码 / 未提交范围

本轮改动面（六路，全部有 preflight sha256 基线，逐字还原已核对）：

- **A** `tests/e2e/stabilizationCoreUsability.spec.ts`（launchEditor 三态探测 + App 级 Ctrl+N + 无条件产品态断言 `<main aria-label="课件画布">`）、`scripts/run-courseware-authoring.ts`（同源替换；修后补了就绪等待）
- **B** `tests/e2e/r19DocumentCoauthoring.spec.ts`（课件 tab 锚点改为 tablist 作用域 + `aria-selected`）
- **C** `tests/unit/courseProjectValidationDiagnostics.test.ts` + 产品 `src/renderer/lessonWorkspace/controller/useLessonWorkspaceController.ts`、`src/renderer/lessonWorkspace/view/LessonWorkspaceView.tsx`（4 处 `createProject` 改名到非 legacy API；**产品源码改动，原子批次**）
- **D** `scripts/courseware-builder-v2-host.ts`（D3：V2 host 懒加载）、`scripts/build-courseware-case.ts`、`tests/unit/{localAgentHarnessV2,lessonAuthoring,lessonAuthoringDesktop,diagnosticLog}.test.ts`（win32 清理重试 + 显式超时）、`examples/render-host-benchmark/render-host-benchmark-v2.html`（`refresh:examples` 产物）
- **E** `tests/e2e/chatFailureFixture.ts`（纯增量）、`tests/e2e/r19FrontendSpecialPathA.spec.ts`、**5 个新 V 缺口 spec**：`r19ChatSelectionPaste` / `r19EditorFocusProjection` / `r19DraftSurvival` / `r19DirectoryConversationReopen` / `r19WorkspaceQuickCreate`
- **F** `tests/unit/generationCapabilityWorkspace.test.ts`（期望漂移对齐，附 `git log -S` 证据）
- 生成物：`artifacts/ai-capabilities/*`（R1 真实重生成，内容变化集合仅 `generation-evidence.json`）、`src/shared/generated/courseAgentCapabilities.json`

未触碰（可证）：`lessonWorkspaceCopyOpen.test.tsx`（09-17 mtime）、`r19LessonCopyMove.spec.ts`、PM-01 正文、`docs/development-plan/tasks/` 下无新增 .md。

## 2. 当前包与下一动作

当前包：遗留红从 11 文件/28 例收到 **3 文件/5 例**（其中 2 条为负载抖动、1 文件为 Owner 已决定退役的 CopyMove）；`check:preservation` 由红转绿（27 automated pass）。
下一动作：R1 收尾（3 条新 spec 有界修复，进行中）→ R2 CopyMove 退役 + 25 个同源 e2e 抽共享 helper → R3 零模型全面验证 → R4 三条付费验证 → R5 签收包。

## 3. 通过 / 失败原文（关键行）

- **V1（C 原子批次）全绿**：`npm run typecheck` EXIT:0；`check:legacy-inventory` EXIT:0（`grep -c "legacy:new-consumer"` = 0）；`courseProjectValidationDiagnostics` `Test Files 1 passed (1) / Tests 5 passed (5)`；`editor10ForbiddenTokens` `1 passed (1)`；`refresh:examples` EXIT:0。
- **A 的 S3 三例（closeout S4）**：`3 passed (3.2m)`（修复前 `3 failed`，根因链两层：歧义选择器 + `:175` 的「专业」按钮在 bc2072f7 被删）。
- **B**：`r19DocumentCoauthoring.spec.ts` `1 passed (33.6s)`，无 TimeoutError。
- **夹具回归**：`r19ChatCopyPaste` `1 passed (20.1s)`（`V05 copy readback equals message body {"length":152}`）；`r19ChatApplyRetry` `1 passed (41.7s)`（`050 retry step 6: archive 正文包含 "平均分的含义"`）。
- **破例自检（三段式证据见 §8）**：**8 项 RED_CONFIRMED**（A 选择器、E-V05 正文全等、E-V01、E-V06、E-⑤ 产品侧改坏、B 锚点、F 期望）、**2 项 PARTIAL**（V10/V02 基线本红、改坏后红点前移证明断言承重）、1 项 SKIPPED（D，按指令，可证伪性由基线红原文承载）。
- **closeout 门**：`check:preservation` EXIT:0（`1.1 保全检查通过：…27 个 automated pass；Owner 观察未签署：PM-01`）；`check:legacy-inventory` EXIT:0；`check:examples` EXIT:0（全 OK 行）；`check:ai-capabilities` 曾红（`来源溯源证据过期 generation-evidence.json`）→ **R1 真实重生成后 EXIT:0**。
- **全量 `npm test`（01:51）**：`Test Files 3 failed | 438 passed (441)`；`Tests 5 failed | 4254 passed | 3 skipped (4262)`。失败三类：`lessonWorkspaceCopyOpen`（CopyMove，Owner 持单）、`claudeProcessTransport` 与 `electronLaunchEnvironment`（均 `EBUSY: resource busy or locked, rmdir …`，**单独复跑 2 文件 51/51 绿（9.97s）→ 负载/清理竞态**）。
- **EBUSY/超时归因**：D 修的 4 文件已不在失败清单；`coursewareCaseAssetReader` 单跑 31.6s 绿（懒加载后转快）。
- **E 的 5 spec（closeout S3 复跑）**：`5 passed / 3 failed` —— 余红：`r19DraftSurvival.spec.ts:30`（V02 冲突）、`r19EditorFocusProjection.spec.ts`（V10）、`r19WorkspaceQuickCreate.spec.ts:17`（V06 快速新建）。

## 4. verify 等价拆分（本轮实际覆盖）

| verify 段 | 本轮执行 | 结果 |
|---|---|---|
| check:ai-capabilities | check（红）→ generate（77 文件）→ check | **EXIT:0**（变更集合仅 generation-evidence.json，前后 sha256 清单留档） |
| typecheck | 组合命令 + 三 project 分跑 | 全 0 |
| test（vitest 全量） | `npm test`（含 pretest build:player） | 3 failed / 438 passed（文件），5 failed / 4254 passed / 3 skipped（用例） |
| test:e2e | 未跑全量；命名规格：stabilization S3 子集（3 passed）、A 回归 5（1 红，见 R-6）、B（passed）、E 5 spec（5/8）、夹具回归 ×2（passed） | 部分覆盖；付费门控规格未跑（见 §6 门控清单） |
| 其余门 | check:preservation 0、check:legacy-inventory 0、check:examples 0 | 见 §3 |

## 5. V 表增量（本轮新增实跑）

- **V05**：新增 `r19ChatSelectionPaste` 拖选 + 真实 Ctrl+V 粘贴用例（`1.2m` / `10.7s` passed）；加前次复制实证，V05 的「复制」闭环、「选择/粘贴」从缺口转为实跑。
- **V01**：新增 `r19DirectoryConversationReopen`（未生成课件即可重开）`13.5s` passed。
- **V02**：新增 `r19DraftSurvival` 切根用例 `25.7s` passed；同文件冲突用例仍红（见 R-5）。
- **V06**：新增 `r19WorkspaceQuickCreate` 最近列表用例 `10.2s` passed；同文件「＋新建 MD/课件入口与标签关闭」仍红（见 R-5）。
- **V10**：新增 `r19EditorFocusProjection` 设计完成但用例仍红（见 R-5）。
- **V03**：`U06-real-layout` `1 passed (3.4s)`（dev-server 路线）。
- 其余 V 条目本轮无新增实跑（复用/缺口口径见 2026-09-18 记录）。

## 6. 残余与缺口（R-1..R-9）与两张清单

**残余**：
- **R-1** CopyMove 3 例（Owner 已决策：退役 → R2 执行）
- **R-2/R-3** `claudeProcessTransport` / `electronLaunchEnvironment` 的 EBUSY（负载抖动；候选：D2 同款 win32 清理重试，纳入 R1 有限尝试）
- **R-4** ~~capabilities 红~~ → **已解**（R1 重生成后 EXIT:0）
- **R-5** E 3 例红（V02 冲突 / V10 焦点 / V06 快速新建）→ R1 有界修复（进行中）
- **R-6** `S3 独立动态准入 :559`（`add-content-primary` 3s 内不可见；A 判据「不再在 launchEditor 处失败」已满足；既有次级红，待归因）
- **R-7** `check:legacy-ready` / `check:legacy-zero` 仍红（需 Owner 持 legacy-inventory 写锁 reconciliation；本轮只声明 ratchet）
- **R-8** 25 个同源 e2e 文件旧选择器未清 → R2
- **R-9** 外部并发写入登记：`docs/development-plan/R19_SIGNOFF_PUSH_BRIEF.md`（01:55:45，另一会话，即本任务书；不属 A–G 清单）

**门控清单（未实跑，不得读成已验证）**：`R19_DELIVERY_LESSON/PROFILE/PROJECT/EXPECTATIONS/PRIOR_EVIDENCE/PREVIEW_START/CHECK_NARROW/ONLY_WORKSPACE`（r19LessonDelivery）、`R19_MANUAL_APPLY`、`R19_MANUAL_LUNA_RUN/ROOT/ADAPTER`、`R19_MANUAL_BUILDER_REPAIR*`、`R19_MANUAL_CONTRAST_*`、`R19_FILE_AI_UNDO_RUN`。

**产品缺口清单（只记录不修）**：① 聊天区 Ctrl+C 被 App 级 `useEditorKeyboardRouter` preventDefault 走 `copySelectedNodes()` 吞掉（`.chat-message` 为 div tabIndex=0，不满足豁免）→ 用户拖选正文后无法快捷键复制；② 最近工作空间列表同会话内不刷新（`controller:65-77`）；③ 产品已无可见入口创建空白独立课件（仅 Ctrl+N；`newStandaloneProject` 死代码）；④ 中文 IME 无自动化证据（建议人工验收，见任务书决策 7）；⑤ 代码块无独立复制按钮；⑥ 本轮实测新增待归因三条：V10 焦点态「收起内容」遮挡「返回工作台」、V06 第二标签 region 内无「源文」按钮、V02 冲突后切根未渲染 `.lesson-workspace-error`（均两次同点位复现）。

## 7. 模型路由

本轮**全零模型**：`grep 'adapter='` 全部日志 = 0；A 主判据只用 `--grep` 命名子集，未触发文件内 6 条付费适配器用例（845/955/1027/1103/1194/2560）；两处夹具链沿用 `fixture-model`，未调 `configureLuna()`。未为追绿换模型。

## 8. 未跑命令 + 边界自证

**未跑**：`npm run verify`、全量 `npm run test:e2e`、`npm run verify:release`、三条付费验证（Claude DeepSeek / OpenCode / `r19CurrentTeacherAutomaticLuna`）、IME 人工验收（待做）。

**未越界自证**：mtime ≥ 2026-09-19 00:00 的仓库文件 31 项全部落在 A–F 清单（+ refresh:examples 授权产物 10 项，git 仅认 1 处内容变化 + 1 条外部文件）；无新增 `test.skip/fixme/only`（16 文件逐个 grep 0）；无 mock clipboard；无零匹配/放宽/删除断言；未签 accepted、未打标签、未建安装器。

**破例自检三件套索引**：`{SCRATCH}/r19-red-cleanup/selfcheck-{A,B,C,D,F,E,...}.log` 与 `selfcheck-bak/*.orig`（closeout 复核：5 spec + `useLessonWorkspaceController.ts` + 3 个被改测试文件与 .orig 的 sha256 **全部 MATCH**，逐字还原成立；全仓 grep「破坏自检」= 0、无冲突标记）。

## 9. 勘误（同日交叉审查后）

- §3 的「**8 项 RED_CONFIRMED**」实为 **7 项**（A、E-V05、E-V01、E-V06、E-⑤、B、F）；另 2 项 PARTIAL、1 项 SKIPPED，合计 10。
- §3 引 `closeout-attrib-ebusy.log` 的「9.97s」与 `v-ebusy.log` 的 10.08s 系同型两跑（均 2 files/51 passed），非同一次运行；两处均真绿。
- §8「未越界自证」中「mtime ≥ 09-19 00:00 的仓库文件 31 项全部落在 A–F 清单」在 00:xx 时点成立；其后 R3 扫描（05:17–05:21）的截图副作用刷新了 `reviews/2026-09-17-frontend-special-evidence/` 下 17 张 PNG——该事实在后续记录（`2026-09-19-r19-followup-fixes.md` §8 与签收包 §②D）登记，本条补充指向。
