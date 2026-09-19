# R19 签收推进任务书（goal 模式总任务）

写于 2026-09-19 凌晨。本文件是交给 goal 会话的**总任务书**，从属于主方案（`R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md`）与基础合同（`R19_050_051_060_HANDOFF_EXECUTION_GUIDE.md`），不替代二者；冲突时以本文件的具体指令为准（它是为「签收推进」这一阶段写的）。

## 0. 身份、目标与铁律

你是 1.9 的唯一集成人（Integrator），以多子智能体工作流自主推进到「可签收」。总目标：**把所有不需要 Owner 当场决策的工作做完，产出签收包**；签署（accepted）、发布标签、安装器留给 Owner，不越权。

铁律：**夜间无人值守，绝不阻塞提问**。任何必须 Owner 决策的新问题 → 写入 `{SCRATCH}/goal-decisions.md` 并跳过该项继续做其它；不要停摆、不要替 Owner 决定。

`{SCRATCH}` = `C:\Users\74755\AppData\Local\Temp\grok-goal-cae8406681b7\implementer`（可能被系统清理；**关键 stdout 必须抄进记录正文**）。

## 1. 开工第一步：并发闸门（必须先做，否则会撞车）

上一轮「遗留红清理」的 dynamic workflow（**runId `wf_759c0dd1-ee2`**，属于另一个会话）可能仍在后台跑。**在确认它停止之前，只做只读工作：绝不写仓库、绝不跑构建/测试。**

判定方法与采样点（间隔 ≥120 秒采两次）：
1. `{SCRATCH}\r19-red-cleanup\` 下全部文件（v2-*.log / v3-*.log / selfcheck-*.log / closeout-*.log 等）
2. `C:\Users\74755\.claude\projects\D-------\044c8843-3fd6-4dc9-b410-49964c7e0028\subagents\workflows\wf_759c0dd1-ee2\journal.jsonl`（该 run 的 journal）
3. `D:\果铃工作台\test-results\` 的 mtime

规则：连续两次采样无变化且距最后一次写入 ≥5 分钟 → 判定结束，进入 §2；仍在变化 → 每 3–5 分钟重采一次，最多等 60 分钟（等待期间可做只读侦察与方案草拟）；超 60 分钟仍活跃 → 记入待决策清单并**只做只读工作**，不得强行开工。

## 2. 上一轮（清理轮）做了什么（接管所需的全部背景）

清理轮目标：把 2026-09-18 全量 `npm test` 首次暴露的遗留红与 V 表缺口清掉。其整合方案与执行日志在 `{SCRATCH}\r19-red-cleanup\`：

- `plan-integrated.json`（终稿：7 工作流 A–G、order、acceptance、rejected）、`area-A..E.json`（领域细节）、`cross-reviews.json`（3 镜头交叉验证）、`preflight.txt`（开工身份快照）、`d3-experiment.log`（D3 判定实验）
- 六路编辑：**A** `stabilizationCoreUsability.spec.ts` + `scripts/run-courseware-authoring.ts` 选择器/启动路线（改用 App 级 Ctrl+N）；**B** `r19DocumentCoauthoring.spec.ts` 课件 tab 锚点；**C** 治理注册（诊断码表单测 + 4 处 `createProject` 改名为非 legacy API，改动 `useLessonWorkspaceController.ts`/`LessonWorkspaceView.tsx`）；**F** `generationCapabilityWorkspace.test.ts` 期望漂移；**D** `refresh:examples` + 4 个测试文件的超时/清理竞态；**E** 夹具 `chatFailureFixture.ts` + 5 个新 V 缺口 spec（`r19ChatSelectionPaste` / `r19EditorFocusProjection` / `r19DraftSurvival` / `r19DirectoryConversationReopen` / `r19WorkspaceQuickCreate`，共 8 例）
- 验证与收口：`v1-*.log`（C 原子批次：typecheck/legacy/diagnostics/forbidden/refresh）、`v2-*.log`（构建 + stabilization grep + 5 新 spec + doccoauthoring + 两条夹具回归 + 2 单测）、`v3-*.log`（修复器复验）、`selfcheck-*.log`（破例自检三段证据）、`closeout-*.log`（全量 npm test + 四门 + git status）

**已知的进行时事实**：截至 2026-09-19 01:40，v2 阶段曾出现 stabilization 3 例失败、5 个新 spec 4 passed / 4 failed（失败表现为弹层遮罩/可见性等待），随后修复器重写了公共 helper `tests/e2e/r19ChatSpecSupport.ts` 的 `dismissOverlays`（按产品路径关弹层、连续两次观测为终态）并补了 `v3-*` 复验；selfcheck 已开始（V05 改坏自检）。**以上以你实测的日志为准，不要照抄本文的转述。**

## 3. 接管步骤（闸门放行后）

1. **读全部日志**（§2 清单），提取：六路编辑最终落盘与验证结果、v2/v3 复验结论、selfcheck 每条 outcome、closeout 的 npm test 汇总与四条门原文、残余清单与门控清单。写成 `{SCRATCH}/goal-inputs.md`。
2. **补写/追加记录**：若 `docs/development-plan/reviews/2026-09-19-r19-red-cleanup.md` 不存在 → 补写（8 节：源码/未提交范围；当前包与下一动作；通过/失败原文；verify 等价拆分；V 表增量；残余与缺口；模型路由；未跑命令 + 边界自证）。已存在则只追加缺漏。**历史记录（2026-09-18 系列）一律只追加、逐字不改。**
3. **复验未复验项**（串行、逐条留日志）：`npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --workers=1 --grep "S3 聊天失败注入|S3 候选格式|S3 默认可见"`；5 个新 spec 一次跑（判据 8 passed / 0 failed / 0 skipped）；两条夹具回归（`r19ChatCopyPaste` / `r19ChatApplyRetry`）不得回退。任何仍红 → 有限尝试（≤2 轮）→ 不成如实记缺口（附失败原文；**禁止放宽断言 / 加 skip / 零匹配凑绿**）。
4. **追加主方案第 3 行**状态行（只追加本轮事实，既有字面逐字保留）。

## 4. 已定决策（Owner 已拍板，不要再问）

1. **CopyMove → 退役（B）**：删除过期的 `lessonWorkspaceCopyOpen.test.tsx` 3 个单测或改写为对现存底层能力的测试；`r19LessonCopyMove.spec.ts` 的 skip 明确处置（删除或标注）；保留下层 asCopy 能力但不再承诺 UI 入口；**不得恢复 UI**。
2. **付费验证 → 红清干净后执行**（见 §7 R4）：Codex=Luna Fast(priority) 已授权、Claude 通道=DeepSeek、OpenCode=Luna；**禁止为追绿换模型**。
3. **25 个同源 e2e 文件 → 一次性修（A）**：先抽共享「Ctrl+N 启动独立编辑器」helper（以 `r19FrontendSpecialPathA.spec.ts` 的路线为基准），26 个文件各改一行；`imageReplacementVerticalSlice.spec.ts` 先修（它现在不能作为"绿先例"被引用）。
4. **发布三件套先不定**：不改 PM-01 正文、不打 `v1.9.0-rc.N`、不建安装器；只在签收包里给 PM-01 晋升**草案文本**（不落盘正文）。
5. **修复有限尝试**：同一问题最多 2 轮修复投入；仍不成就记缺口（附失败原文与已尝试路径）。
6. **「新建」设计**：正确语义是「新建 → 选文件类型（Markdown / Office 文档（后续版本）/ 演示 HTML / 流式 HTML / 无限画布）→ 进对应编辑器」；现按钮用的是"新建项目"逻辑，属设计问题。本轮**只记录**为后续版本输入；`newStandaloneProject` 死代码暂不删。
7. **中文输入法**：应用本就用系统输入法，产品无需改动；做一次**人工验收**（真输入法打中文；打拼音未选字时按回车与斜杠，确认不误发、不误开菜单），自动化留缺口并写明原因（OS 级组件无法在 CI 复现；如需自动化可后续用 CDP `Input.imeSetComposition` 模拟组合事件）。

## 5. 方法论：五拍多子智能体循环（每一轮都走）

**第 1 拍 独立探索规划**：为每个工作域派 1 个只读子智能体（并发），各自产出完整方案：根因（file:line 证据）、精确 edit、验证命令与判据、证伪方法、风险、明确不做、**文件所有权清单**（用于互斥分区）。

**第 2 拍 交叉验证**：3 个镜头各审**全部**方案并到仓库核实——① 技术可行与仓库事实（路径/行号/命令真实存在、文件所有权互斥、不引入新风险）② 诚实性（禁止洗绿：放宽断言 / 加 skip / 把超时当修复 / 把红写绿 / mock）③ 范围与收口（是否越界、是否规划了收口复验）。整合者合成唯一方案（含 rejected 与理由、**参数化验收**——期望值必须可被实际分支修正，不能写不可能成立的数字）；完备性批评者补缺口出终稿。

**第 3 拍 dynamic workflow 执行**：用 Workflow 工具。脚本为纯 JS：`export const meta = { name, description, phases: [...] }`（**纯字面量**；模板字符串内**禁止反引号**）。骨架：

```js
const edits = await parallel(WORKSTREAMS.map(w => () => agent(promptOf(w), { label: 'edit:' + w.id, phase: 'Edit', schema: EDIT_SCHEMA })))  // 编辑并发，文件互斥
const v = await agent(runnerPrompt, { label: 'verify', phase: 'Verify', schema: VERIFY_SCHEMA })   // 单一串行执行道跑全部命令
for (let r = 0; r < 2 && v && v.failed.length; r++) { await parallel(fixersFor(v.failed)); v = await agent(runnerPrompt, { ... }) }
```

要点：结构化返回用 `schema`（JSON Schema，root 为 object）；跨 agent 数据放 `{SCRATCH}\<轮次>\` 文件让下游自读（编排器只传路径）；`parallel`/`pipeline` 返回可能含 null（`.filter(Boolean)`）；失败有界回修（≤2 轮）；脚本先落盘再执行，迭代用 `Workflow({ scriptPath, resumeFromRunId })` 只重跑改动项；journal.jsonl 可用来核对每个 agent 的真实返回。

**第 4 拍 对抗交叉审查**：3 镜头（证据链可证伪 / 与仓库数字事实一致 / 诚实与边界）并行审全部产出与日志 + 完备性批评者 + 裁决者（verdict + 按优先级修订项）；集成人落实修订后记录。

**第 5 拍 落盘**：新增本轮 `reviews/` 记录 + 主方案状态行追加 + 签收包更新。

## 6. 子智能体通信协议

1. **无直接对话**。三条通道：a) 结构化返回 → 编排器 → 下一环提示词；b) `{SCRATCH}\<轮次>\` 共享文件当信箱（方案 JSON、日志；编排器只传路径）；c) 集成人中转——Agent 工具派的子智能体可用 SendMessage 续聊同一 agent；跨轮次事实一律进记录与 `{SCRATCH}`，不靠记忆。
2. **文件所有权**：并行编辑的 agent 各自只准改自己清单内的文件；同一文件只归一个工作流；冲突在整合阶段消解。
3. **状态可见性**：每条命令输出落 `{SCRATCH}` 日志并在返回里给「日志路径 + 关键行原文」；下游 agent 以上游日志为准，不转述。

## 7. 工作分解（R1 → R5，逐轮 DoD 达标才进下一轮）

- **R1 接管与收尾**：§3 全部做完；全量 `npm test` 复核红面。
- **R2 CopyMove 退役 + 25 文件修复**：执行决策 1、3；抽 helper 后**抽样复跑** 2–3 条被修规格；全量 `npm test` 目标 **0 failed**。
- **R3 零模型全面验证**：`check:task-board` / `check:preservation` / `check:legacy-inventory` / `check:ai-capabilities` / `check:examples` / `check:contracts`（存在则跑）；`typecheck` 三 project；全量 vitest；**零模型 e2e**（先出成本清单：specs 分类 fixture/付费/skip；付费不进本轮，只列待办）；IME 人工验收留档。
- **R4 付费验证**（前置：R1–R3 全绿）：Claude DeepSeek generate、OpenCode generate、`r19CurrentTeacherAutomaticLuna` 整课链；逐条留路由 JSON / 耗时 / 日志；额度受阻如实记录并排队重试。
- **R5 签收包**：`docs/development-plan/reviews/2026-09-19-r19-acceptance-package.md`：① V01–V15 逐条闭环（实跑/复用/缺口三态 + 证据路径 + 本轮是否重跑）② 残余与缺口清单（现象/原文/归因/建议）③ 门控清单（`R19_DELIVERY_*`、`R19_FILE_AI_*`、`R19_MANUAL_*`、`R19_050_EVIDENCE` 等）④ 模型路由与额度实况 ⑤ PM-01 晋升草案（不落盘正文）⑥ 签收清单（Owner 勾选：accepted / rc 标签 / 安装器 / 后续版本项）⑦ 待决策清单。

## 8. 完成定义（DoD）

全量 `npm test` 0 failed；四条 check 全绿；typecheck 三 0；25 文件修完且有抽样复跑；V05 选择/粘贴与 V10 焦点已补或明标缺口；三条付费验证完成留档（或记录额度受阻）；IME 人工验收留档；签收包落盘；历史记录逐字未改；未签 accepted、未打标签、未建安装器。达标后输出 **≤30 行**的最终总结（完成项 / 缺口项 / 待决策项 / 证据位置）。

## 9. 硬约束与已知坑

**约束**：零匹配 / `test.skip` / mock clipboard / 聊天正文当应用成功 / 放宽或删除断言 = 都不算通过；只有集成人写 `docs/**`（子智能体对 docs 只读）；`.md` 不进 `docs/development-plan/tasks/`；**剪贴板、dist 构建、仓库写入一律串行**，任何 playwright 运行期间禁止 `build:renderer`（会替换 dist）；同一时刻只跑一个 playwright/vitest；证据绑身份（git blob + sha256 + 日志名）；破坏性自检留三段（改坏原文 / 必红输出 / 还原后 sha256 与基准一致）。

**坑（上一轮踩过，直接照做）**：
1. 冷启动落着陆页、内容区默认收起——进独立编辑器用 App 级 **Ctrl+N**（旧「更多 → 新建独立课件」已从产品移除）。
2. `.lesson-workspace-more` 是**共享样式类**（3 处 details：切换工作空间 / 布局 / ＋新建标签页），locator 必须语义 scoping 或产品态断言。
3. `.lesson-popover-backdrop` 会遮挡点击且不自愈——按产品路径关闭（点 backdrop / 点开着的 summary），并以「连续两次无弹层且无 backdrop」为终态。
4. Windows 剪贴板读回是 CRLF：断言前 `\r\n → \n` 归一。
5. 并发全量下 5s 超时 / ENOTEMPTY 是**负载抖动**：单文件复跑对照判类，不为一次挂死改全局配置。
6. vitest 默认 reporter 不列通过/skipped 明细：要逐文件计数就 `--reporter=verbose` 单存日志。
7. `generate:*` / `refresh:*` 会**无条件重写产物**（含 `src/shared/generated/courseAgentCapabilities.json`）：前后做 sha256 清单对比，记录里只写「内容变化集合」并逐文件披露。
8. DeepSeek 免费额度可能 402：付费前先确认额度，受限就如实记录并顺延。
9. 夹具 CLI（`tests/e2e/chatFailureFixture.ts`）路径**禁止 `configureLuna()`**（只报 fixture-model）；夹具链只证明宿主门与流程，不声称真实模型回合。
10. Workflow 脚本：纯 JS、meta 纯字面量、模板串内禁反引号、`args` 传 JSON 值、单 `parallel` ≤4096、失败 agent 返回 null。

## 10. 开工顺序

① 并发闸门（§1）→ ② 读 §2 全部日志 + `R19_050_051_060_HANDOFF_EXECUTION_GUIDE.md` + `docs/development-plan/reviews/` 最新记录 + 主方案 → ③ 写 `{SCRATCH}/goal-inputs.md`（残余红 / 缺口 / 门控 / 待决策）→ ④ R1 → ⑤ R2…R5（每轮按 §5 五拍执行、§6 协议通信、§7 DoD 收口，每轮落盘记录后再进下一轮）。

全程不要停下来问问题。
