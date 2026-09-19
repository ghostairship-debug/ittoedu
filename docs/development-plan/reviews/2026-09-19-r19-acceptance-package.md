# 1.9 签收包（engineering candidate → Owner 签收）【修订版 v2】

日期：2026-09-19（07:0x 修订）。基线：`main` @ `bc2072f777a2ca36e545979e3b67d782d105fce6` + 未提交工作树。**本包为非终稿：DoD 未达标**（付费三链留档未完成、IME 人工验收未执行——见 §⑧），**Owner 请勿据此直接勾 accepted**。未签 accepted、无 `v1.9.0-rc.N`、无安装器、PM-01 正文未改。

修订说明（v2）：经独立交叉审查（3 镜头 + 批评 + 裁决，判 UNTRUSTWORTHY）后逐条修订：R4b 结论改写（claude 未达模型）、误派发「原文在册」撤回、17 张历史证据 PNG 覆盖披露、V04/V07/V12/V14 行订正、19 条红的归因降级、27 条 did-not-run 登记、门控补齐、check:examples 数字订正、第三次全量补记、DoD 对照新增。原文与修订轨迹见配套记录。

## ① V01–V15 逐条闭环（状态三态：本轮实跑 / 复用旧证据 / 缺口）

| ID | 要求（缩写） | 状态 | 证据（文件+用例+日志，含时点） | 本轮重跑 |
|---|---|---|---|---|
| V01 | 同名项目独立会话；未生成课件可重开；准确选旧历史 | **实跑（09-19）** | `r19DirectoryConversationReopen` 13.5s（`f-v-specs.log`）+ `directoryConversationIdentity`(4)/`LessonWorkspaceShell`(11)/`r19WorkspaceNavHierarchy` 22.7s | 是 |
| V02 | 首存连续；Save As 不复用；失败/切根不丢稿 | **实跑（09-19，部分）** | `r19DraftSurvival` 冲突 19.6s + 切根 25.6s（8 例组 `f-v-specs.log`；冲突根因＝活 Map 迭代 + ref 抖动，已修 + 承重自检）；`r19LessonWorkspace` 首存/Save As 片段 56.9s | 是 |
| V03 | 四向停靠／收展／全屏；草稿/目标/任务连续 | **实跑（部分，09-19）** | `r19FrontendSpecialPathA` 27.9s、`U06-real-layout` 3.4s、`contentDockResizeSign` 单测；全屏单实例未逐项单列（缺口） | 是 |
| V04 | 当前页→选择→清除；@ 参考；切页不改投 | **单测实跑（09-19）；e2e 复用 09-18** | `courseChatPanel`(58)/`chatComposerMenus`(2) 全量 vitest（09-19）；`r19CourseChatScopeContinuity` 33.2s 为 **09-18 22:28** 日志（`r19-v-rerun-courschatscope.log`），本轮未重跑 | 部分 |
| V05 | 消息可选择、复制、**实际粘贴**；/、@、输入法 | **复制/选择/粘贴实跑（09-19）；输入法与 / 菜单＝缺口** | 复制：09-18 三次绿 + 改坏必红自检；09-19 拖选/代码块 1.2m、真实 Ctrl+V 10.7s（`r19ChatSelectionPaste`，`f-v-specs.log`）；权限 `chatClipboardPermission`(2)。**IME＝人工验收单待执行**；聊天输入框的组合/回车/斜杠路径无自动化（画布文本侧已有 composition 合成用例，所在 spec 当前红/级联未跑——见 §②A）；`/`、`@` 菜单真实生效无自动化 | 是（复制/选择/粘贴） |
| V06 | 新建/管理项目会话；最近列表；＋新建；标签关闭 | **实跑（09-19）** | `r19WorkspaceQuickCreate`：＋新建 25.6s + 最近列表 11.0s（跨启动真值，产品修复后）；`r19WorkspaceNavHierarchy` 22.7s | 是 |
| V07 | 普通 MD AI 编辑、冲突、恢复、撤回、保存状态 | **实跑（09-19，部分）+ 门控缺口** | 单测 `lessonDocumentAiTask`(7)/`documentAiTaskController`(6) 全绿；e2e `r19DocumentCoauthoring` **1 passed 33.6s**（09-18 曾确定性红，锚点修复后复绿）；三条真实 AI 门控用例（`R19_FILE_AI_UNDO_RUN` 等）未跑＝缺口 | 是（部分） |
| V08 | 路径/附件/粘贴材料；PDF/DOCX/PPTX 真实读取 | **实跑（09-19）** | `r19LessonWorkspace`（三格式+冲突重开+首存/另存）56.9s；`pptxMediaImport` 系列 | 是 |
| V09 | 默认创作与先审稿两条路径，可编辑/保存/重开/预览/导出 | **复用旧证据（本轮未重跑）** | `r19-050.log`（09-18 20:38）：`2 passed (4.3m)`，task-driven 2.2m / review-first 2.1m，marker 与 Luna Fast 路由在册（禁止重跑） | 否 |
| V10 | 两种编辑位置；场景状态；选区历史连续 | **实跑（09-19，部分）** | `r19EditorFocusProjection` 14.6s（焦点投影修复后，含同一聊天实例断言）；`r19FrontendSpecialPathC` 56.0s。编辑器模式 `data-editor-focus` 唯一断言仍在受门控 `r19LessonDelivery`（未跑）＝记录缺口 | 是 |
| V11 | 长任务恢复边界；目录会话+冻结文件接续 | **复用旧证据；接续子项＝缺口** | 043 复用声明 + `r19DraftSurvival` 守卫类（09-19）；专项接续用例未新增 | 部分 |
| V12 | Flow 新正文/源文/数学/Word/预览/HTML/三 Surface 保全 | **复用旧证据（本轮未重跑）；入口类部分实跑** | 046–049 证据链 + Word 复用 2026-09-15 COM（**保持未新测**）；R2 修复 25 个老 spec 入口后 R3 扫描 56 passed 覆盖其中大量（09-19） | 部分（入口类） |
| V13 | PPTX 媒体播放/编辑/效果/离线资源；失败不半写 | **实跑（09-19，媒体片段）** | `pptxMediaImport.spec.ts` 2 passed 5.8s（离线 HTML 播放）+ `pptxMediaImport.test.ts`(9) | 是 |
| V14 | 原电路 revision27 或其等价复现被关闭 | **等价反例实跑（09-19）；原样本缺口** | `courseProjectHealth`(27，含 Flow ID 写入 scene.go 必须失败可见) 全绿；**revision 27 原始样本**证据目录 09-18 22:36 实测缺失（`gap-commands.log` EXIT:2）；`output/r19-current-teacher-luna/` 现含 **09-19 06:28 起 R4b 整课链的新证据**（非 revision 27 原件）。**不声称旧课例已修** | 是（等价） |
| V15 | 同一候选的全体必选结果、源码与证据一致 | **本包 + 三记录（修订版）** | 全部证据绑日志名；无越界声明（§④–⑧） | 是 |

## ② 残余与缺口清单

**A. 未决红（19 条确定性失败 + 27 条 serial 级联未跑 + 1 skip）**

- 扫描 10 条（`r3-sweep.log`；56 passed / 10 failed / 27 did not run / 1 skipped，94 tests，25.4m）：`editor:1041`（`getByRole('tab',{name:'互动与动画'})` 期望 0 实得 1）、`imageReplacementVerticalSlice:615`（「当前位置试运行」被 `#embedded-editor-properties` 的 sidebar-tab 拦截指针）、`r18-089-flow-viewport:677/678`（工作台填充 691px>1 / 滚动 150 实得 0）、`:780`（scrollTop 未变）、`r19CrossPageObservation:12`（canvas hidden）、`spatialGlobalRuntimeAuthoring:297`（`global-layer-entry` 定位成功但不可见）、`stabilizationFlowAuthoring:509`（同一「互动与动画」拦截）、`stabilizationOwnershipController:696`（`新增其他类型页面` 不可见）、`v9PreviewNetwork:245`（Ctrl+O 后标题未切换）。
- stabilization 非付费 9 条（`r3-stabilization-nonpaid.log`；15 passed / 9 failed；`--last-failed` 9/9 确定性）：PPTX SmartArt「比较」vs「观察」、PPTX 旧公式输入框缺失、PPTX 普通映射/原生收口场景树 label 不可见、活动文字草稿与 Wave A 的 `新增其他类型页面` 不可见、组件代码 tab、三表面整合、Flow 所见即所得。
- **27 条 did not run（逐条登记）**：`editor.spec.ts` 26 条（`test.describe.serial` 于 :797 级联；该文件 27 例仅 :1041 一失败例、0 例通过；含 :1126 专业模式、:1195 当前位置试运行、:1962 IME 相关）+ `imageReplacementVerticalSlice:829`（:526 serial 级联）。**1 条 skip 身份**：`r18-089-flow-viewport.spec.ts:841/843` 的真实 AI 门（`FLOW_REAL_AI`/`FLOW_AI_VERIFY_EXISTING`）。
- **归因（降级版）**：这些用例**自 R19 改版起从未运行过**（入口即崩），本轮修复入口后首跑暴露；失败点均在入口之后，**但未做逐条隔离实验**，因此不能排除候选自身改动的影响——例：`editor:1041/1045` 断言的「简洁/专业」正是 bc2072f7 有意移除的模式（PM-01 变更本体）；`image:615` 的拦截元素 `#embedded-editor-properties` 由本线 R19 引入。**有限尝试（A/B 前缀实验）仅覆盖 image:615 与 spatial:297 两条**（`ab-prefix-*.log`），其余 17 条零尝试。建议按簇修：①面板/树/按钮不可见与遮挡族（约 12 条）；②PPTX 内容断言族（4）；③零散 3。
- **原文存放**：19 条逐条失败原文现存于 `{SCRATCH}/r19-red-cleanup/`（f-samples.log / r3-sweep.log / r3-stabilization-nonpaid.log）与 `test-results/`（会被下次运行覆盖）；关键 3 段已抄入本包（见 §④ 与注释）。

**B. 门控/未跑（不得读成已验证）**
`R19_DELIVERY_*`（8 变量；含 V10 的 `data-editor-focus`）、`R19_FILE_AI_UNDO_RUN`、`R19_RECOVERY_LUNA_RUN`、`R19_MANUAL_APPLY`、`R19_MANUAL_LUNA_*`、`R19_MANUAL_BUILDER_REPAIR*`、`R19_MANUAL_CONTRAST_*`、`R19_DIRECTORY_CLI_RUN`（r19DirectoryConversationCli:12）、`R19_AUTOMATIC_LUNA_RUN`、`R19_CONTINUATION_LUNA_RUN`、`R19_TEACHER_DEEPSEEK_RUN` / `R19_TEACHER_HIGH_RUN` / `R19_TEACHER_MEDIUM_RUN`、`R19_050_EVIDENCE`、`FLOW_REAL_AI` / `FLOW_AI_VERIFY_EXISTING`（r18-089:841/843）、`R18_*` 全家族（**按变量逐条对待，不统一归因**：r18NativeParity 等为「未跑」而非「零模型」）。stabilization 的 11 条 `S3 真实*` 中：R4b 覆盖「真实聊天」3 条（结果见 §④），其余 8 条未跑。

**C. 产品缺口（只记录不修，供排期）**
1. 聊天区 Ctrl+C 被 App 级键盘路由吞掉（`.chat-message` 为 div tabIndex=0）→ 拖选正文无法快捷键复制。
2. 最近工作空间列表同会话内不刷新（`controller:65-77`；跨启动真值正确，V06 已证）。
3. 新建入口仅 Ctrl+N（无可见入口）；`newStandaloneProject` 死代码保留待重设计。
4. **「新建」重设计（Owner 已给方向）**：新建→选类型（MD/Office 后续/演示 HTML/流式 HTML/无限画布）→对应编辑器。
5. 代码块无独立复制按钮（以「真实拖选+复制原文」等价证据）。
6. IME：聊天输入框的组合/回车/斜杠路径无自动化（画布文本侧有 composition 合成用例）；人工验收单已备（`2026-09-19-ime-manual-acceptance.md`）。
7. **遮挡/指针拦截族（本轮新发现，测试侧只做了入口修复）**：「当前位置试运行」被属性面板 sidebar-tab 拦截、`global-layer-entry` 不可见、「互动与动画」tab 拦截、`新增其他类型页面` 不可见——属产品面板布局问题还是 spec 断言漂移**未定位**，入排期。
8. `stabilizationCoreUsability:906` 材料折叠区嵌在任务设置 details 内（spec 已修，产品结构可优化）；`scripts/verify-release.ts:526` 与 `scripts/verify-w3-windows-portability.ts:415` 仍含可执行 `getByRole('button',{name:'专业'})`（**不在本轮清理面**，挂 verify:release 链，属待办）。
9. `preserveAll()` 与内联 ref 抖动（V02 调试残留建议：同改一行快照 + ref 稳定化）。

**D. 基础设施与边界披露**
- **17 张历史证据 PNG 被覆盖（必须知悉）**：`docs/development-plan/reviews/2026-09-17-frontend-special-evidence/` 下 A1–A6、B1–B4、C1–C5、V31×3 于 09-19 05:17–05:21 被 R3 扫描中 Path A/B/C 与 NavHierarchy 的**截图副作用**刷新（B1–B4 为本次首度覆盖；A/C/V31 系 09-18 轮已刷新、本轮再刷新）。旧字节仅存于 git HEAD；**「历史记录只追加未改写」就这 17 张 PNG 不成立**，其余 .md 记录未改写。
- 三次全量 vitest：01:51（5 failed）→ **03:41（1 failed：localAgentInputMetrics EBUSY，未加 win32 重试、单跑即绿）** → 04:44（440/440、0 failed；该 flake 未复现前提下取得）。
- `r3-sweep.log` 的 `EXIT:0` 为采集 bug（wrapper 未透传 playwright 退出码，实际 1）；该日志与 `r3-stabilization-nonpaid.log` 头部自述为部分重建件（live 输出被工具误截，9 条失败由 error-context 反抄、15/9 计数源自 `test-results/.last-run.json` 且该文件现已不存在）——引用处按「重建件、计数不可独立复核」理解。
- vite 提示 `Re-optimizing dependencies because vite config has changed`（05:20）出现在扫描期 dev-server 路线；未定位原因，仅登记。

## ③ verify 等价拆分（累计口径）

| verify 段 | 覆盖 | 结果 |
|---|---|---|
| check:ai-capabilities | 多次（红→生成→绿；09-19 门批次再验） | 全绿 |
| typecheck | 多次；**07:0x 以 `echo EXIT:$?` 重跑** | 三 project 全 0（`r3-typecheck-exit.log: TYPECHECK_ALL_EXIT:0`） |
| test（vitest 全量） | **三次**（见 §②D） | 04:44 达成 440/440 文件、4256 passed / 3 skipped、0 failed |
| test:e2e | 命名规格 + 43 spec 零模型扫描 + stabilization 非付费子集 + 终验 8 例组 | 部分（19 条红见 §②A；门控见 §②B） |
| 其余门 | task-board / preservation(27) / legacy-inventory / examples(**11 项 OK**) / contracts(4) / development-roadmap(176) | 全绿（`r3-gates.log` 7×EXIT:0） |

未跑 `npm run verify` 与全量 `npm run test:e2e` 本体。

## ④ 模型路由与额度实况（含 R4b 修订）

**R4（09-19 06:12–06:16，首次）**：0 付费调用、0 费用——三通道卡在 spec:906 UI 漂移（材料折叠区；**测试侧已修**：补 `openChatTaskSettings(chat)`，spec sha 已变、`git diff` 可见，非产品修复）；整课链被授权门 skip。无 402/额度报错。

**R4b（06:22 起）：三通道真实聊天（`r4b-chat-adapters.log`，3 failed）+ 整课链（06:28 起运行）**
一手证据：`output/playwright/r18-cli-<adapter>/failure-records.json`（逐条）——

| 通道 | 实况（failure-records.json 原文） | 费用 |
|---|---|---|
| codex | **status=completed / task=completed / hostResult=committed**——真实 Luna 回合完成并**自动提交**（revision 0→1）；spec 失败于 `:885` 等待「应用候选」按钮 245s 谓词超时——**该用例未设「应用方式=先看预览」**（同文件 :635/:766 均设），与产品默认 `auto` 漂移，属 spec 问题 | 真实回合 1 次（4.5m） |
| claude | **status=failed，2.658s，事件原文「Not logged in · Please run /login」——从未到达模型**（Claude CLI 本机未登录/未配置） | 0 |
| opencode | **status=cancelled / hostResult=rejected**（用例超时中断，有流式 text 到达） | 真实回合 1 次（3.0m，被中断） |

**整课链（进行中，06:28 起）**：证据目录 `output/r19-current-teacher-luna/2026-09-18T22-28-08-643Z/`（注意目录名为 UTC 时间戳）；已落 `actual-native-route.json`——**route 原文：`configuration={"model":"gpt-5.6-luna","effort":"medium","serviceTier":"priority"}`（Luna Fast）**；`current-stage.json` 06:57 仍在更新（运行中，用例上限 70 分钟）。结束后由集成人把逐阶段结果追加于此。

**额度台账**：R3 误派发 codex×1（150s 超时失败）；R4b codex×1（4.5m 完成）、opencode×1（3.0m 中断）、claude 0（未登录）；整课链 Luna 运行 ≥30 分钟。**无可用余额/额度读数**（未查询）；未出现 402/限流报错。

**事故披露（撤回「原文在册」）**：R3 期 `--grep-invert "真实聊天"` 排除不完整（该文件实有 11 条付费例），推进到 `S3 真实载体：recipe` 时**误派发 1 次真实 codex 请求**（150s 轮询超时失败），随后中止并以全排重跑。**但：`r3-stabilization-attempt1-incomplete-exclusion.log` 实测仅 1,328B/13 行，止于 `ok 7`，不含派发与超时的原始记录**——该情节目前**只有当时智能体的过程自述**，无原始日志支撑（原文随进程终止丢失）；后续命令口径已修正。此为披露缺口，如实登记。

**警示**：`r19-050-claude.log` 与 `r19-050.log` 逐字节相同（均 Luna 路由）——不得作 Claude/DeepSeek 通道证据。总口径：**未为追绿换模型**；Claude 通道（DeepSeek）本轮**未能验证**（登录缺失）。

## ⑤ PM-01 晋升草案（**不落盘正文**，仅供 Owner 决定）

> 拟将保全矩阵 PM-01 晋升为：「**工作台轻改 + 编辑器模式**：工作台突出高频轻改与按选择出现的属性；编辑器模式整理专业工具、场景/状态与空间；取消简洁/专业二档（`editor-mode-switch` 与 `editorMode` 已在 bc2072f7 移除）；DeveloperTab 能力仍可达。」

依据：25 个同源 spec 的「专业/简洁」locator 在 tests/e2e 内全部移除（**注意：scripts/verify-release.ts 与 verify-w3 端口脚本仍各有一处，属待办**）；`stabilizationCoreUsability` 模式切换段按产品事实改写；全量 vitest 0 failed。落盘需 Owner 明示。

## ⑥ 签收清单（Owner 勾选；**当前 DoD 未达标，不建议直接勾 accepted**）

- [ ] **accepted**（1.9 签署；前置：§⑧ DoD 之未达项清零或 Owner 明确豁免）
- [ ] `v1.9.0-rc.N` 标签（发布授权成立时创建）
- [ ] 安装器（未建）
- [ ] PM-01 晋升落盘（§⑤ 草案；含 scripts 两处 `专业` locator 的处置决策）
- [ ] IME 人工验收执行并回填（`2026-09-19-ime-manual-acceptance.md`）
- [ ] 后续版本项：新建「先选文件类型」重设计；19 条老 spec 三簇批量修复；遮挡族定位（§②C-7）；`preserveAll`/ref 抖动根治；`R18_*` 与 8 条 `S3 真实*` 付费矩阵排期；Claude CLI 登录/DeepSeek 路由配置（本机未登录）

## ⑦ 待决策清单

1. 老 spec 三簇修复批次安排（建议与下一次 UI 布局收敛同批）。
2. `R18_*` 门控矩阵与 8 条 `S3 真实*` 付费排期（额度预算）。
3. `preserveAll`/ref 抖动是否本批一并修。
4. Claude CLI 未登录：修复环境后是否重跑 claude 通道（codex 已证链路可用，claude/opencode 待复）。
5. `scripts/verify-release.ts` / `verify-w3` 的 `专业` locator：改脚本 or 接受为发布链待办。

## ⑧ DoD 对照（任务书 §8，逐条）

| # | 判据 | 状态 | 证据/缺口 |
|---|---|---|---|
| 1 | 全量 npm test 0 failed | **达成** | 04:44 440/440（f-npm-test.log）；03:41 的 EBUSY flake 未复现 |
| 2 | 四条 check 全绿 | **达成** | r3-gates.log 7×EXIT:0（含 examples 11 项 OK） |
| 3 | typecheck 三 0 | **达成** | `TYPECHECK_ALL_EXIT:0`（07:0x 重跑，带退出码） |
| 4 | 25 文件修完 + 抽样复跑 | **达成** | r2-archival/preflight/r2-greps；抽样 navigationLevels/flowComponent/bundledFont 等绿 |
| 5 | V05 选择/粘贴与 V10 焦点 已补或明标缺口 | **达成（前者实跑、后者明标缺口）** | §① V05/V10 行 |
| 6 | 三条付费验证完成留档 | **达成（4/4）** | **codex ✓ 3.9m（Luna·max·priority）、claude ✓ 3.6m（DeepSeek env）、opencode ✓ 4.5m（openai/gpt-5.6-luna·max）、整课链 ✓ 30.2m（Luna·max，rev=73 真实课件）**——全部含提交/撤销回执与路由原文。见 §⑨ 附八/附九/附十 |
| 7 | IME 人工验收留档 | **未达（待人工）** | 验收单已备 |
| 8 | 签收包落盘 | **达成** | 本文件 |
| 9 | 历史记录逐字未改 | **部分未达** | 17 张 PNG 被覆盖（§②D）；.md 记录未改写 |
| 10 | 未签 accepted / 未打标签 / 未建安装器 | **达成** | git tag 无 v1.9.0*；无 release 产物 |

**结论**：1.9 已达「工程候选 + 红面基本清零（仅老 spec 既有漂移 19 条、按簇入册）」，但 **DoD 未达标**（第 6、7、9 项）。建议 Owner 优先处置：Claude CLI 登录环境（解锁付费三链）→ IME 人工验收 → 再签。

## ⑨ R4b/R4c 结果补记（2026-09-19 07:45 追加；取代 §④ 中「运行中」的占位）

**codex（4.5m，x → R4c 重跑中）**：UI 漂移已解（材料勾选与发送全过），卡点前移到候选回执——**候选在 245s 轮询期内被宿主自动提交**（会话记录原文：task=completed、committedStages=1、hostResult={status:"committed", beforeRevision:0, afterRevision:1, candidateId:"8620f7e1-…"}），故「应用候选」按钮始终未进入 enabled。根因＝该用例未设「应用方式=先看预览」而产品默认自动应用（`CourseChatPanel.tsx:72 ':auto'`）；**已于 07:03 修复该 spec**（补 `openChatTaskSettings` 返回值的 `selectOption('preview')`，与同文件 :635/:766 一致；typecheck 0），并启动 R4c 单通道重跑验证。证据：`output/playwright/r18-cli-codex/failure-records.json`。

**claude（54.6s，x，0 计费）**：**未登录**——面板 alert「本次处理未完成，原因尚未确定」；会话事件原文 `"Not logged in · Please run /login"`（sequence 4/6，task=failed，usage 0/0）。环境只读观察：本 shell 有 `ANTHROPIC_BASE_URL` 但无 `ANTHROPIC_API_KEY/AUTH_TOKEN`（nativeProxy 直透传）；claude CLI 2.1.276；凭据 `~/.claude/.credentials.json` 为 2026-06-11。**与「Claude 通道=DeepSeek」授权路由不符：既未按 DeepSeek 跑通，也不在已登录态**——转 Owner 环境项（§⑥）。

**opencode（3.0m，x）**：真实 Luna 路由（`capabilities.current={model:"openai/gpt-5.6-luna"}`，12 次 tool-call，usage 输入 20868 / 输出 30），产出候选**格式修复后仍不正确**（面板 alert 原文）→ 产品/模型行为问题，非 UI 漂移；保留原文待定位。

**整课链（1.2h，x；门已开、真实跑过半）**：无 skip；**真实产出 4 份文稿**（teaching-brief / 01-teaching-plan / presentation-brief / 02-presentation-script + 材料原样复制），推进到 build 阶段后被产品「保留失败」闸拦下：`run.status="ready-to-build"`、`failure.committedStepCount=0`、failure 原文「创作阶段未完成：当前文档或材料还不能用于下一阶段。请查看当前稿、材料与确认状态后继续。」，**自 06:36 起 63 分钟零变化**直至用例 70 分钟自超时（+worker teardown 60s）。**关键限定**：该用例协议要求外部驱动器写 `output/r19-current-teacher-luna/<run>/teacher-action.json`（spec:83-97），本任务书未授权驱动 UI → 该失败**含「缺驱动」成分，不能单独读成产品构建能力失败**。推进格式已定位：动作键 `continue-build`（对应 `LessonAuthoringPanel.tsx:114` 的「修正模块后继续当前构建」；主进程 `lessonAuthoringDesktopService.ts:251/271/278/284/293`）。证据：`output/r19-current-teacher-luna/2026-09-18T22-28-08-643Z/`（7 份 stage-*.json、current-stage.json、actual-native-route.json）。

**路由原文（整课链）**：`configuration={"model":"gpt-5.6-luna","effort":"medium","serviceTier":"priority"}`；catalog 中 gpt-5.6-luna 的 Fast=`priority`(1.5x)；configure 前机器 `~/.codex/config.toml` 为 gpt-6-astra/default。逐会话确认值需 `actual-native-tasks.json`（未 done 未生成）。

**额度台账（更新）**：codex 2 次真实回合（4.5m + R4c）、opencode 1 次（3.0m，in 20868/out 30）、claude 0（未登录）、整课链 Luna ≥1.2h（4 阶段文稿产出）；无 402/限流；**无余额读数**。

**下一步（R4c 之外）**：① Owner 配好 Claude CLI 登录/DeepSeek 路由后重跑 claude 通道；② 整课链加 teacher-action 驱动重跑（按上述动作键与文件格式）；③ opencode 候选格式问题定位。

### ⑨ 附：R4c（codex 单通道复跑）结果（07:47）

`npx playwright test … --grep "S3 真实聊天：codex"` → **1 failed**，但**失败原因与 spec 无关**：codex CLI 启动失败，原文：

```
CLI 未完成（打开原生 CLI）：Codex initialize: …/@openai/codex/bin/codex.js:107
Error: Missing optional dependency @openai/codex-win32-x64. Reinstall Codex: npm install -g @openai/codex@latest
```

即 **本机 Codex CLI 全局安装已损坏**（R4b 06:23 尚可跑通真实回合，07:47 已无法启动；期间无我方对全局安装的任何操作）。**preview 漂移修复未被本次运行检验**（未到候选断言即失败）。修复命令（Owner 环境项）：`npm install -g @openai/codex@latest`；修复后重跑 `--grep "S3 真实聊天：codex"` 即可验证预览流程。证据：`output/playwright/r18-cli-codex/failure-records.json`（61KB，failed payload 含上述原文）。

### ⑨ 附二：R4c 双跑复核与更正（08:0x）

**更正：Codex CLI 并未「损坏」**——R4c run1（55s）失败原文（`Missing optional dependency @openai/codex-win32-x64`）的原因是**撞上了全局重装窗口**：`@openai/codex` 的平台二进制于 07:42:26–07:42:29 落盘（npm staging 目录 07:37 起存在），测试恰在二进制就位前的约 30 秒窗口内启动；重装非测试触发。**现已健康：`codex.exe --version` = `codex-cli 0.155.1`；无需再执行修复命令。**（上条 §⑨ 附中的「需 npm install -g …」就此撤回。）

**R4c run2（2.1m）证明 preview 修复已生效**：`generationRequest` 原文 `applyPolicy:"preview"`（请求层可观测）；页面快照出现 region「待应用说明」、`revision===0` 通过、「应用候选」被找到并成功点击、post-apply 会话标签「codex · 对话 1 · 已完成」、region「实际应用结果」= 已应用课件修改 + 「撤销最近一次 AI 修改」按钮存在。run2 失败于 **spec:918 的陈旧字符串断言**「宿主已提交，可一次撤销」——该串在 src 中已被 c839c205 移除（现文案：求助面板 `修改已应用，实际结果已保存`（generationTaskController.ts:364）；工作台状态栏 `已应用 AI 候选，可一次撤销`（authoringToolActions.ts:134））。**已修**：:918 与 :2622 两处改为规范回执口径 `[aria-label="实际应用结果"] strong` 含「已应用课件修改」（typecheck 0），并由 **R4d**（08:0x 起）复跑验证。

**路由更正（重要）**：S3 真实聊天用例**不自配模型**——机器 `~/.codex/config.toml` 为 `model="gpt-6-astra" / model_reasoning_effort="xhigh" / service_tier="default"`，故该用例实际跑的是 **gpt-6-astra · xhigh · 标准速度**（error-context 的 group 原文），**非 Luna**；整课链（spec 自配）才是 **gpt-5.6-luna · medium · priority(Fast)**。**未为追绿更换任何模型/配置**；若 Owner 要求 Codex 通道统一走 Luna，应改机器 config 或在 spec 内显式配置（待决）。

### ⑨ 附三：codex 通道转绿（R4d/R4e，08:0x）

- **R4d（3.0m）**：修复后链路推进到 :916–:926 **全部通过**——两轮真实 codex 修改经 preview 提交（revision 0→1→2，第二次含「分数知识讲解」）；失败于 :927 **陈旧按钮名**「撤销本次 AI 修改」（产品现名「撤销最近一次 AI 修改」，c839c205 重命名；spec 共 6 处：:927/:1005/:1083/:1158/:1248/:2632）。
- **修复**：6 处撤销按钮名 + :933 讨论完成文案（改「讨论完成，尚未修改课件」，与 `generationTaskController.ts:244` 逐字一致）；typecheck 0。
- **R4e（3.4m）：`1 passed`——codex 通道全链通过**（生成候选 → 预览应用 → 继续修改 → 二次应用 → 撤销本次 AI 修改 → 保存 → 讨论轮无候选断言）。成功路径证据齐备：`output/playwright/r18-cli-codex/{result.json, generated.h5lesson, generated.html, player.png}`；`result.json`：`elapsedMs=177800`，runs 含 `completed` 与 `hostResult.status="undone"`（撤销回执）及真实 semanticChanges（revision 1→2 等）。
- **路由（照实）**：本用例不自配模型，实际为机器 `~/.codex/config.toml` 的 `gpt-6-astra · xhigh · 标准速度`（非 Luna；未换模型/未改配置）。整课链才是 `gpt-5.6-luna · medium · priority(Fast)`。
- **DoD #6 更新**：codex ✓ 通过；claude 阻断于未登录（0 计费，待环境）；opencode 复跑中（R4f）；整课链需 teacher-action 驱动（配方见 §⑨附）。

### ⑨ 附四：opencode 复跑（R4f）与路由补证（08:10）

- **R4f（opencode，约 4.5m）仍失败，但形态与首轮不同**：本次不是坏候选——失败于首个 `waitCandidate` 的 **245s 谓词超时**，失败瞬间会话记录 `status="running"`（26 个事件：session/user-message/tool-call/tool-result；末段仍在 `todowrite` 与 `bash execute` 工具工作）。即 **opencode 对该任务的回合时延超出用例的 245s 候选窗口**；候选是否合规未被检验。两次尝试均为有界投入，**转缺口**（建议：增大窗口重跑，或按「时延超窗」单独登记）。
- **codex 路由补证（一手）**：`result.json` 不含路由字段（该 spec 的 result.json 只有 adapter/elapsedMs/runs）；路由取自 codex CLI rollout 原文（`~/.codex/sessions/2026/09/19/rollout-…jsonl`，cwd=本次 e2e 临时目录，时间线与两次提交吻合）：**`{"model":"gpt-6-astra","effort":"xhigh","approval":"never","sandbox":"danger-full-access"}`**；机器 `~/.codex/config.toml` 同为 gpt-6-astra/xhigh/default。**按主方案「Codex/OpenCode 只用实际 Luna」的口径：S3 真实聊天（:855）用例的通道基准应登记为 gpt-6-astra·xhigh（非 Luna 通道证据）**；R4c/R4d/R4e 三轮一致，本回合零配置变更。整课链才是 Luna Fast（见上）。
- **DoD #6 终态**：codex ✓（1 passed 3.4m，附 revoked 回执与离线 Player 断言）；claude ✗ 阻断（未登录，0 计费，待环境）；opencode ✗（两次有界尝试：坏候选 → 时延超窗；转缺口）；整课链 ✗（缺 teacher-action 驱动，配方已备）。

### ⑨ 附五：opencode 通道定论（R4f 双跑，08:16）

上条「时延超窗」结论按双跑完整证据修正为**通道级缺口（非偶发）**——同命令连跑 2 次（每次 4.5m）均失败在**同一断言**（spec:915 → `waitCandidate` 于 :885 的 245s 谓词超时），且三次尝试三种不同形态：

| 尝试 | 形态 | 证据 |
|---|---|---|
| R4b（06:26） | 宿主侧拒绝：`missing-candidate-delivery`（candidate-parse 阶段） | failure-records 备份 |
| R4f run1 | 模型草稿被 candidate-helper 判 `invalid-input`（`native.content` 的 input 缺 `operation`、把 `nativeType/frame` 放到 input 根——cards 正例为 `{"operation":"insert","template":{...}}`，cards 已原样进 wire context）；随后 **opencode LLM 流卡死**：最后一个事件为 bash tool-call pending，`opencode.log` 停在 `llm runtime selected`，`opencode.db` 末条 part 为 `{"status":"pending","input":{},"raw":""}`，host 静默 ~180s | `r4f-opencode.log`、`output/playwright/r18-cli-opencode/failure-records.json`（08:07） |
| R4f run2 | **245s 预算全部耗在探测 schema**：37 次 tool-call（反复 `node -e` 打印 `inputSchema`/`template.oneOf`/`placement`，4 次 read 自拼路径报 File not found），**从未调用 candidate-helper.mjs**，零候选交付；超时前 2.5s 仍在 bash | `r4f-opencode-run2.log`、failure-records.json（08:16） |

两轮 host 侧一致：`status=running`、`task.committedStages=0`、无 hostResult——**失败不是宿主拒绝，而是通道未在预算内产出候选**。路由：opencode 侧 `providerID=openai / modelID=gpt-5.6-luna`，agent=orchestrator；全程未换模型、未改配置。**结论：opencode 通道当前不具备稳定交付候选的能力，转缺口（建议单列跟进：合同探测行为与流卡死分别定位）。**

### ⑨ 附六：零模型子集权威重绑（08:40，关闭「重建件日志」缺口）

`stabilizationCoreUsability.spec.ts` 在 R4c–R4e 后（付费用例区文案修复）以**当前文件 sha `181416ce49872d6c…`** 重跑非付费子集：`--grep-invert "S3 真实"` → **Running 24 tests / 15 passed / 9 failed（17.1m，EXIT:1）**，无 did-not-run、无 skip、无 flaky——计数自洽（15+9=24）。日志：`{SCRATCH}/r19-red-cleanup/rebind-stabilization-nonpaid.log`（sha 记录 `rebind-spec-sha.txt`）。**9 条失败与 §②A 既有漂移清单逐条一致**（PPTX 家族 4 + 面板/按钮不可见族 5，含 :2288 完整标题「default Slide adds Spatial and two distinct world kinds」）。§②D 中「该日志为部分重建件、计数不可独立复核」的限定**就此关闭**（本条为权威替代）；r3-sweep.log 的重建件限定仍适用。

### ⑨ 附七：IME 自动化侧补充证据（模拟组合事件）+ B1–B4 还原（08:5x）

- **CDP 组合事件探针**（临时 spec，跑完即删；日志 `{SCRATCH}/r19-red-cleanup/ime-probe.log`，`1 passed (10.7s)`，零模型）：对照组普通输入 `/` → 命令菜单可见（机制可用）；`Input.imeSetComposition('/ping')` 组合期间 → **菜单不弹出**、**组合中按 Enter 不发送**（transcript 0→0）；提交/清理后输入框为空。**限定**：CDP 模拟组合 ≠ 真输入法（无候选窗；组合期 DOM value 为 `/ping` 而 React 侧未开菜单，真 IME 行为可能不同）——**人工验收单仍为必做项**，本条仅把「聊天输入框组合/回车/斜杠」的自动化缺口从零证据变为有模拟证据。探针设计已在此记录，可随时重建。
- **B1–B4 历史 PNG 逐字节还原**：`git checkout --` 四个 09-17 原件（此前被 09-19 扫描副作用覆盖且无既有披露）；现该目录 diff 余 13 张（A1–A6、C1–C5、V31×3），均为 09-18/19 各轮**已在记录中披露**的重跑刷新。§②D 的披露据此更新。

### ⑨ 附八：整课链在 Luna·max 下全程通过（R4h，2026-09-19 09:38）

**结论：`1 passed (30.2m)`（EXIT:0）**——这是整课链的首次真实全绿。

- **决定性与 R4g（medium）对照**：R4g 四个文档阶段全部产出后，build 阶段提交 0 步（空工程保留、`failure.committedStepCount=0`），被驱动 stop 收尾；**R4h 在 max 下 build 自行走完**：终态 `run.status="completed"`、`message="课件已保存，可继续编辑和运行检查"`、`failure=null`、`view.issues=[]`。
- **产物（真实课件）**：`course.h5lesson` **revision=73**，`project.json` 标题「闭合电路探究：从断点到共路」；5 surfaces（演示页 / 片段二｜先预测再操作开关 / 片段三｜可回看的探究记录(flow) / 片段四｜串联电路两个断点(spatial) / 终结卡｜用证据说出结论）+ 8 locations + 2 组件包（含 local.lesson.circuit-explorer）+ 6 assets——与「三种学习空间」教学目标逐一对应。
- **驱动动作序列＝空**：阶梯锁在 running/applying 期间凭真实按钮可见性闸门，`teacher-action.json` 从未生成（written=[]）——**通过靠模型能力，不是靠点按钮**；这也解释了 medium 失败即能力不足。
- **路由（逐会话）**：`actual-native-route.json` → `{"model":"gpt-5.6-luna","effort":"max","serviceTier":"priority"}`；`actual-native-tasks.json` 5 个原生会话 `payload.current` 全部 `gpt-5.6-luna / max / priority`（spec 的 /luna/i 断言通过）。
- **耗时**：spec 30.2 分钟（09:07:45 启动 → 09:38:30 结束）；无残留进程。证据目录：`{SCRATCH}/r19-red-cleanup/whole-course-r4h/`（spec.log、driver.log、current-stage.json、actual-native-*.json、saved-project-path.txt、course.h5lesson 等）。
- **配套修正（Owner 指令）**：adapter 用例对 codex/opencode 显式配置 **Luna·max**（打印 `S3 route` 行）；整课链 spec `effort` 同步升为 `max` 并断言 max 可用。**R4c/R4d/R4e 曾按机器默认跑 gpt-6-astra（非本意）——已纠正为显式 Luna；此前的 astra 消耗已如实入册。**
- **DoD #6 更新**：整课链 ✓（`1 passed 30.2m`，Luna·max）；codex 聊天（max 复验中 R4i）；claude（DeepSeek env 复验中 R4i）；opencode（max 有界复验中 R4i）。

### ⑨ 附九：三通道复验终局（R4i，2026-09-19 10:03）

| 通道 | 结果 | 证据 |
|---|---|---|
| **codex（Luna·max）** | ✅ **`1 passed (3.9m)`** | 路由行 `S3 route codex {"id":"gpt-5.6-luna","effort":"max","serviceTier":"priority"}`；`result.json` runs=3（含 committed 0→1 与 undone 1→1） |
| **claude（DeepSeek）** | ✅ **`1 passed (3.6m)`** | DeepSeek env（从 `settings.json` 读取、未回显）注入后一次通过；`result.json` runs=2（committed 0→1 + undone 1→1）。**「Claude 通道=DeepSeek」就此实证可跑**；无路由行属 spec 设计（`if (adapter !== 'claude')`） |
| **opencode** | ✗ 凭证阻断 | **上游原文**：`Internal error: Bad Request: checking third-party user token: bad request: Personal Access Tokens are not supported for this endpoint`（`failure="rate-limited"`，committedStages=0，无候选产生）——**环境/凭证问题，非代码或能力缺陷**；另本次路由行 `github-copilot/gpt-5.6-luna`（effort=null）暴露选取偏好问题，**已修**：luna 选取改为优先含 `openai` 的变体（与既有行为一致），并保留 fallback |
| **整课链（Luna·max）** | ✅ `1 passed (30.2m)` | 见附八 |

**DoD #6 终态：4 条中 3 绿**（codex / claude / 整课链）；opencode 的阻断在 opencode 自身的 provider 凭证（PAT 不被该端点支持），属 Owner 环境项——修好后用同一命令即可复验（spec 已修正选取偏好与 max 支持判定）。

### ⑨ 附十：opencode 转绿 —— 付费链 4/4 全绿（R4j，2026-09-19 10:10）

**`1 passed (4.5m)`**，路由行 `S3 route opencode {"id":"openai/gpt-5.6-luna","effort":"max","serviceTier":null}`——完整链（生成候选 → 继续修改 → 单次撤销 → 保存）通过，`EXIT:0`。

**更正附九的「凭证阻断」结论**：R4i 的 opencode 失败**是我方选取偏好缺陷**——当时的 spec 补丁用 `.find(/luna/i)` 命中了 `github-copilot/gpt-5.6-luna`（该端点拒斥 PAT），并非 opencode 本身不可用。修正（优先含 `openai` 的 luna 变体）后一次通过；且 `openai/` 变体支持 max（`github-copilot/` 变体不支持）。**该缺陷由本轮引入、由本轮修复，全过程与两句原文（R4i 失败 / R4j 通过）均留档。**

**DoD #6 终态：4/4 达成**——codex ✓ 3.9m / claude ✓ 3.6m / opencode ✓ 4.5m / 整课链 ✓ 30.2m（全部含真实提交与撤销回执证据；路由逐一在册：三处 Luna（codex max·priority、opencode max、整课链 max·priority）+ DeepSeek）。

**⑨附十·补（R4j 取证细节）**：① opencode 目录 luna 变体顺序实证（events[2] capabilities, cliVersion 1.18.26）：`github-copilot/gpt-5.6-luna` → `opencode/` → `openai/gpt-5.6-luna` → `openai/gpt-5.6-luna-fast` → `teamorouter/`——旧 `.find(/luna/i)` 命中第一个（PAT 被拒），修正后 `&& /openai/i` 命中 `openai/gpt-5.6-luna`（该变体本轮报告 effort 支持且含 max）。② `result.json`（mtime 10:09:17）：`elapsedMs=240270`，runs 两条均为真实中文输出且精确对上 prompt 约束（committed 0→1；undone 1→1，semanticChanges=3 / omitted=0 / comparison=complete）。③ **产物独立核对**：`generated.h5lesson` revision=1、文本层 label 回到「文本」（证明单次撤销只回退第二次 AI 修改、`undone===first`）、正文取自引用材料；`player.png` 生成、离线播放器断言通过、`pageErrors=[]`。④ 旧 `failure-records.json`（09:58）为 R4i 遗留、projectId 与本轮不同——引用时勿混淆。

### ⑨ 附十一：老 spec 漂移首轮按簇修复（A 簇，2026-09-19 10:34）——4 条转绿

按决策 5「有限尝试」对 19 条漂移做**按簇修复**首轮（探索→交叉判断→最小编辑→串行复跑），A 簇（过期断言 + 面板覆盖层遮挡）**4/4 转绿**：

| 原红 | 修复 | 复跑原文 |
|---|---|---|
| `editor.spec.ts:1045/1046`「简洁模式下 互动与动画/开发 tab 不存在」 | bc2072f7 已合并 simple/professional tabs（`RightSidebar.tsx:31-38/72-85` 无条件渲染 6 tab；`editorMode` 全仓 0 命中）→ 两行断言改为**常驻可见**（`toBeVisible()`，与 :1044 同形；不删断言、不改强度） | `里程碑闭环` 两条 **2 passed (1.9m)**（简洁 47.1s + 专业 1.1m——后者此前也在级联里被吞） |
| `imageReplacementVerticalSlice:615`「当前位置试运行」被拦截 | 根因＝**紧凑布局覆盖层**（`globals.css:6089` 属性面板 `position:absolute;z-index:40`，首行 44px 恰好压住画布右上开关）；修复＝`enterTryRun` 点击前**先关面板**（沿用 `editor.spec.ts:250-255`、`r18-089:460-470` 既有先例） | **1 passed (1.9m)** |
| `stabilizationFlowAuthoring:509` 同型拦截 | 同上（插入关闭面板 3 行） | **1 passed (1.4m)** |

**判定口径**：两处均为 **spec 侧漂移**（非产品层级缺陷，几何根因已取证）；修复模式「覆盖抽屉下先关面板再点画布模式」已验证，可推广至同族。**19 条残余 → 15 条**（本轮同时解锁 editor 级联区 :1047+ 的 26 条「did-not-run」，其自身漂移属登记项，需一次全文件运行定论）。B/C 簇（新增其他类型页面不可见 ×3 + r18-089 视口 ×3）第二轮进行中。

### ⑨ 附十二：老 spec 漂移按簇修复第 2 轮（B/C 簇）+ 子集台账刷新（2026-09-19 12:17）

**B 簇（紧凑工作台面板互斥）根因**：独立课件编辑器挂在 `.lesson-course-tab` 内（宽度 <1000px 判 compact），`EditorPanelLayout.tsx:8/30/32` 使结构槽（页面树 ScenePanel）默认 `hidden`（`globals.css:6079`），且展开后是覆盖画布左 312px 的 `z-index:40` 浮层（`globals.css:6089-6091`）——老 spec 假设页面树常驻可见。修法＝新增 `withCourseTree(page, run)` helper（未开则开、跑完即关；同 `r18-089:500-509`、`editor.spec.ts:250-255` 先例），套在 openSlide/openSpatial/openFlow/addSurface/global-layer-entry/删除页面等 10+ 点（stabilizationCoreUsability + stabilizationOwnershipController 两文件）。

**C 簇（r18-089）**：`expectStandaloneWorkbenchFillsWorkspace` 691px 死区根因＝standalone 布局残留内联 `contentWidth%`（无任何尺寸控件）；修复＝CSS 复位 `width/height:auto!important`（注释含理由，与 :71 editor-focus 先例同款）。注意：**首跑未重建 dist 致 CSS 修复未被验证**——重建后 :678（9.2m）与 :780（5.6m）转绿；:677 推进到更深的新问题（`expectStableController` maximumShift 36，浮层控制器 playback 位移），登记待修。

**子集台账刷新（`verify-subset.log`，绑定 spec sha，21.7m）**：**22 passed / 2 failed**（上轮 15/9）——净转绿 7 条：PPTX 家族 4（SmartArt/旧公式/普通映射/原生收口——同属页面树可见性根因）、Wave A、共享组件源码 :2721、三表面整合 :2840。剩余 2 红：`活动文字草稿:2256`（疑 CSS 变更回归——"element not stable/detached"，A/B 甄别中）与 `S3 Flow 所见即所得:2956`（`本轮引用` 在收起 details 内——与 :906 同款修复，进行中）。

**两轮累计（今夜）**：A 簇 4 条 + B/C 簇 9 条（Wave B/活动文字草稿定向/PPTX×4/Wave A/组件源码/三表面/+r18-089×2 中已含）→ **漂移红从 19 条收敛至 ~6 条**（剩余：活动文字草稿[CSS 甄别中]、Flow所见即所得[修复中]、r18-089:677[新深层问题]、r19CrossPageObservation:12、v9PreviewNetwork:245、spatial:297[有界耗尽]）。

### ⑨ 附十三：B/C 簇终局与「联动 bug 对」定论（2026-09-19 13:34）

**转绿净额**：B 簇修复（`withCourseTree`，两文件 10+ 点位）与 :2956 修复合计使 stabilization 非付费子集从上轮 15/9 到 **22/2**，另 r18-089 :678/:780 曾在 CSS 修复下转绿（见下文的取舍回退）。**今夜老 spec 漂移累计转绿：4（A 簇）+ 8（B 簇含 PPTX 家族 4、Wave A、组件源码、三表面、活动文字草稿定向、Wave B）+ 1（:2956）= 13 条**。

**`S3 Flow 所见即所得 :2956` 修复（根因修正）**：非「外层 details 收起」——外层 `openChatTaskSettings` 早已存在且断言为开；真因是 `本轮引用` select 被**内层 `details.chat-target-more`**（`CourseChatPanel.tsx:445-451`）包裹且默认收起。修复＝按 `r19TaskDrivenTeacherChain:68-77` 先例条件式展开内层 details。**1 passed (49.2s)**。

**C 簇（r18-089 死区）终局——联动 bug 对（determinstic）**：

| 状态 | :2256 活动文字草稿 | :678 fluid Flow |
|---|---|---|
| 保留内联宽（HEAD 现状） | ✅ 1.5m | ❌ 691px 死区 |
| 移除内联宽（CSS override） | ❌ 面板切换 30s「not stable/detached」 | ✅ 9.2m |
| 移除内联宽（JS 源头修复，一行） | ❌ 同型 | ✅ 9.3m |

结论：**两个真实 bug 互为掣肘**——① standalone 工作台残留内联 `contentWidth:46%`（死区，修复配方已验证：`LessonWorkspaceView.tsx:845` 的 style 在 `state.standalone` 时不写；等价 CSS 方案亦可）；② 一旦消除死区，编辑器进入**宽布局**，`r18NativeAuthoringFixture.ts:678` 的「属性与素材」切换出现**持续约 30s 的 detach/重渲染循环**（另一真 bug，入口在宽布局面板切换路径）。按**无回归原则**：已回退全部临时修改（JS 与 CSS 逐字还原，`:2256` 复跑 **1 passed (1.5m)** 确认复原），**联动修复留作下一批次**（先修②再落①，配方与证据链已完整在册）。

**过程诚实披露（我方两处失误）**：① 我第一版 JS 补丁因按 CRLF 拼模式而目标文件是 LF 未落盘，且命令用 `;` 分隔使失败被掩盖，产生过一轮「JS 修复下仍红」的**无效结论**；修正脚本（EOL 自适应 + 先验数量后写入）后重验，**结论不变**（真 JS 修复下 :2256 仍红）。② 中途「CSS 是回归源」的表述按完整矩阵修订为「**任何**移除内联宽度的方式都会触发该循环」。相关日志：`final-2256*.log`、`final-678.log`、`micro-cssA/B*.log`。

**漂移台账终值（24 条非付费子集）**：**22 passed / 2 failed**——余 `活动文字草稿`（本次为回退后复原态，绿）与 `S3 Flow 所见即所得`（已修，绿）之外：本子集仅剩 0 条持续红（两红均已在本轮转绿；r18-089 :677 的 `expectStableController` maximumShift 36 为独立新问题，见扫描台账）。全局残余：r18-089 :677、r19CrossPageObservation:12、v9PreviewNetwork:245、spatial:297（有界耗尽）、以及 editor 级联区 :1047+ 未全文件复跑（登记）。
