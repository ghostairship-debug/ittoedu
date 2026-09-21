# R20 上下文共编与 2.0 分项验收记录（2026-09-21）

候选身份：`e39052fc`（`wip(r20): contextual authoring + 2.0 gates (pre-review snapshot)`）。已签收基线为 `v1.9.0-rc.1`（`b4751145`）。本记录不重开 1.9 签署。**（订正：本行原写"工作树干净（`git status --porcelain` 0 项）"，该结论不成立，详见文末第八节第 1 条；本文件其余原有行号未改动。）**

**本记录的四态约定**：已跑绿（有命令与制品可复现）、已跑红（有失败原文与复现命令）、未跑（本轮没有运行，不得读作通过）、环境阻塞（本机不具备所需条件，非工程质量问题）。

**证据存放边界（必须连同结论一起读）**：`output/` 被 `.gitignore:10` 忽略，所有原始运行制品（`result.json`、`.last-run.json`、日志、截图）都在本机未跟踪目录中，**不在候选提交内**。因此本记录只能作为"当时的运行记录"，不能作为随候选自证的制品。按 `WORKING_PROTOCOL.md:69`，只有 45 字节的 `.last-run.json`（`{"status":"passed"}`）无法区分"通过/跳过/零匹配"，凡属此类均已在下文标注为**不可追溯**。

---

## 一、已跑绿（可复现）

| 验证 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck`（3 个 project） | exit 0 |
| 合同制品 | `npm run check:contracts` | exit 0，4 个合同制品均为最新 |
| 能力索引 | `npm run check:ai-capabilities` | exit 0，`索引 16275 / 16384 字节` |
| 冻结基准 HTML 未重生成 | `npm run check:render-benchmark:fixture` | exit 0，8 个制品全部 `OK`，含 `render-host-benchmark-v2.html 3798509 bytes` |
| 渲染器字体 | `npm run check:renderer-fonts` | exit 0 |
| 任务板一致 | `npm run check:task-board` | exit 0，`任务板已是最新状态。` |
| 架构 §8 棘轮 | `npm run check:legacy-inventory` | exit 0，`confirmedEndpointCount:0`、`unknownCount:0`、`tokenHits:0` |
| 保全矩阵 | `npm run check:preservation` | exit 0，`1.1 保全检查通过：candidate e39052fc5bf9515419ff2b7b83b7ea57a7fc8a11，27 个 automated pass；Owner 观察未签署：PM-01。自动化结果不是 Owner accepted。` |
| 上下文创作单元链 | `npx vitest run tests/unit/flowContextSelection.test.ts tests/unit/courseChatObservation.test.ts tests/unit/courseChatPanel.test.tsx tests/unit/flowSharedAuthoringAdapters.test.tsx --maxWorkers=1` | **2026-09-21 16:02 +08:00 复测**：`Test Files 4 passed (4)`、`Tests 124 passed (124)`、exit 0。本行原先写的 `4 files / 121 tests passed` **已不可复现**（用例随批次增长）；**计数只以届时命令输出为准，不得当常量引用** |
| Markdown 映射作者测试 | `npx vitest run tests/unit/markdownSourceMap.test.ts tests/unit/documentEditPreview.test.ts tests/unit/documentAiTaskController.test.ts tests/unit/lessonDocumentAiTask.test.ts tests/unit/sharedDocumentMarkdown.test.ts --maxWorkers=1` | **2026-09-21 16:05 +08:00 复测**：`Test Files 5 passed (5)`、`Tests 79 passed (79)`、exit 0。本行原先写的 `5 files / 61 tests passed` **已不可复现** |
| 说明/诊断/记录管理单元 | `npx vitest run tests/unit/externalAiNoticeRepository.test.ts tests/unit/useExternalAiNotice.test.tsx tests/unit/nativeAgentDiagnostics.test.tsx tests/unit/nativeAgentHelp.test.tsx tests/unit/nativeAgentQuestion.test.tsx tests/unit/lessonConversationChat.test.tsx --maxWorkers=1` | **2026-09-21 16:06 +08:00 复测**：`Test Files 6 passed (6)`、`Tests 42 passed (42)`、exit 0。本行原先写的 `6 files / 33 tests passed` **已不可复现** |
| 第三轮修复的定点回归（见第九节 9.7） | `npx vitest run tests/unit/markdownSourceMap.test.ts tests/unit/chatTranscriptAccessibility.test.tsx tests/unit/courseChatObservation.test.ts tests/unit/externalAiReferences.test.ts tests/unit/externalReferencesOperation.test.ts tests/unit/courseChatPanel.test.tsx tests/unit/flowContextSelection.test.ts --maxWorkers=1` | `Test Files 7 passed (7)`、`Tests 157 passed (157)`、exit 0；单文件计数 `markdownSourceMap 37`（35→37）、`chatTranscriptAccessibility 9`（6→9）、`flowWorkspace 18`（17→18），三项新回归用例**均经变异验证**（退回旧实现即变红）。`npx tsc --noEmit` exit 0 |
| 第四轮定点回归（见第十节 10.2、10.4） | `npx vitest run tests/unit/useExternalAiNotice.test.tsx tests/unit/externalAiNoticeRepository.test.ts tests/unit/externalReferencesOperation.test.ts --maxWorkers=1` | `Test Files 3 passed (3)`、`Tests 20 passed (20)`、exit 0；`useExternalAiNotice.test.tsx` 单文件 11 项（10→11），新增的不穷举守卫**经变异验证**。`npx tsc --noEmit` exit 0；`git diff --check HEAD` exit 0 |

**测试规模口径（2026-09-21 16:06:30 +08:00 实测，只认命令输出）**：vitest 文件 `(Get-ChildItem tests/unit,tests/integration -Recurse -File | Where-Object { $_.Name -match '\.test\.' }).Count` → `461`；e2e spec 文件 `(Get-ChildItem tests/e2e -Recurse -File -Filter *.spec.ts).Count` → `93`。二者都随批次变化，**任何总数都必须在引用时重跑该命令，不得从本行转抄**。（此前流传的「vitest 124 / e2e 78 / 总数 202」一组数字在本机**无法复现**；其中 `124` 与 `42` 分别是上表第一条与第三条链的**用例数**，不是文件数，属口径混淆。）

**冻结 HTML 的字节同一性**已由 `exampleGenerationBoundary.ts:37` 的真实 `equalBytes` 比较证明：该 HTML 从当前源码与当前 `dist-player/player.iife.js` 重新生成会得到逐字节相同结果，SHA256 `3A4AD02C24AC785B24FA9199A782AAC7953CFAC6D0AF8116718739EF0E5E2777`。**因此本轮不得运行 `npm run refresh:examples` 或 `refresh:render-benchmark:fixture`**——那才会改写已冻结制品。

## 二、已跑红（有失败原文）

### 2.1 `npm test` 全量在候选上为红，且失败集随负载浮动

| 运行 | 机器条件 | 结果 |
|---|---|---|
| `output/r20-vitest-oncommit.log`（本记录作者，2026-09-21 12:56:53，294.39s） | 安静（无并发 vitest/playwright） | `Test Files 9 failed \| 447 passed (456)`；`Tests 14 failed \| 4332 passed \| 17 skipped (4363)` |
| 独立评审者重跑（2026-09-21，249.98s） | 并发 | `Test Files 11 failed \| 445 passed (456)`；`Tests 15 failed \| 4331 passed \| 17 skipped (4363)` |

**两次失败集不同**（后者多出 `generatedImagePreparationBrowser`、`candidateMediaStaging`、`generationCapabilityWorkspace`、`generationFailureFeedback` 等），证明超时类失败是**负载相关**而非确定性回归。

安静机器上 14 条失败的**逐字归因**：

- **4 条 = 本记录此前缺失导致的真实根因**，原文：
  `Error: Markdown link target does not exist: COURSEWARE_DEVELOPMENT_PLAN.md -> docs/development-plan/reviews/2026-09-21-r20-contextual-acceptance.md`
  命中 `repoIndexGenerator.test.ts:205`、`:370`、`repoIndexSemantic.test.ts:483`、`repoIndexQuery.test.ts`（该文件 14 项全部 skip 并整文件报错）。即 **repo-index 生成器会校验 Markdown 链接**（校验实现位于 `scripts/repo-index/generator.ts:673-720`，会拒绝反斜杠路径、越出仓库的路径、不存在的目标与缺失的锚点），缺失的验收记录直接打红了 4 个测试文件。**该 4 条已修复**（本记录文件补入仓库后链接成立），复核命令与结果见文末第八节第 2 条。
- **9 条 = 超时**：6 条 `Test timed out in 5000ms.` + 3 条 `Test timed out in 20000ms.`。
- **1 条 = 非超时性能断言**：`repoIndexTypeScriptAdapter.test.ts:183` `AssertionError: expected 11077.381500000001 to be less than 10000`（另一次运行该值为 `22311.5156`，超限 2.2 倍）。
- 另有 `Error: ENOTEMPTY: directory not empty, rmdir '…\Temp\failed-evidence-…'` 属临时目录清理抖动。

**不得声称"失败都是并发超时"**——`repoIndexTypeScriptAdapter` 的性能断言与 4 条链接失败都不是超时。（订正：4 条链接失败已修复、性能断言仍未修复，复核命令见文末第八节第 2、3 条。）

**（2026-09-21 复核更新：当前工作树上 `npm test` 全量已转绿）**

| 运行 | 机器条件 | 结果 |
|---|---|---|
| 上表两次（记录作者与独立评审者） | 安静 / 并发 | `9 failed` / `11 failed`（见上） |
| 本轮复核 `npx vitest run --maxWorkers=2` | 复核批（含本批新增用例） | **`Test Files 461 passed (461)`；`Tests 4438 passed \| 3 skipped (4441)`；exit 0** |
| 第四轮复核 `npx vitest run --maxWorkers=2`（第一遍） | 负载 55%，449.71s | `Test Files 1 failed \| 460 passed (461)`；`Tests 1 failed \| 4444 passed \| 3 skipped (4448)`；exit 1。唯一失败 = `tests/unit/repoIndexQuery.test.ts > distinguishes fresh, partially-stale, stale, and relevant dirty inputs` |
| 第四轮复核 `npx vitest run --maxWorkers=2`（第二遍） | 负载 55%，449.19s | **`Test Files 461 passed (461)`；`Tests 4445 passed \| 3 skipped (4448)`；exit 0** |

- **第四轮两遍的差异本身就是"负载抖动"的直接证据**：第一遍唯一失败的那条用例**单独运行 14/14 全过**（`npx vitest run tests/unit/repoIndexQuery.test.ts --maxWorkers=1` → `Test Files 1 passed (1)`、`Tests 14 passed (14)`、exit 0，耗时 8.98s），第二遍全量即转绿。**两遍耗时均为 ~449s，远高于本记录早前记录的 238–295s**，说明当时机器负载显著更高。**因此"全量绿"这一结论必须以最后一次运行输出为准，且不得据此声称自动化门全绿。**
- 文件数 `461` 与第一节"测试规模口径"实测的 `tests/unit` + `tests/integration` 文件数**完全一致，无文件被跳过**；用例数由 `4363` 增至 `4448` 是本批新增守卫用例（打包守卫 4→6、发布边界 13→24、映射 35→37、转录 6→9、说明 10→11、Flow 17→18 等）所致，**不得当常量引用**。
- 归因：上表的红是**并发负载下的抖动**（其自身的"两次失败集不同"已证明这一点）加上 4 条由本记录缺失导致的真实链接失败；后者随本文件补入仓库而消失，其余超时类失败在 `--maxWorkers=2` 下不再出现。**`repoIndexTypeScriptAdapter.test.ts:183` 的性能断言**（`expected 11077.38… to be less than 10000`）属负载敏感的绝对值阈值，本轮未复现但**未修复**，仍按原记录保留为已知脆弱断言。
- **仍不得**据此声称"自动化门已全绿"：`check:legacy-ready`／`check:legacy-zero` 仍硬失败（见 2.4），`npm run verify` 本体未跑（见 9.6）。

### 2.2 开发路线校验门在候选上 exit 1（订正：补入本记录后现已 exit 0，见文末第八节第 4 条）

`npm run check:development-roadmap` → `开发路线校验失败（1 项）：docs/development-plan/roadmap/2.0/README.md 含失效本地链接：../../reviews/2026-09-21-r20-contextual-acceptance.md。`**（订正：该失效链接已随本记录文件补入仓库而成立，复核 exit 0；见文末第八节第 4 条。）**

该检查的根为 `scripts/check-development-roadmap.ts:8 ROADMAP_RELATIVE_ROOT='docs/development-plan/roadmap'`，故三处失效引用中只报出 roadmap 内的一处；`COURSEWARE_DEVELOPMENT_PLAN.md:112` 与 `R19_1_TO_R20_CONTEXTUAL_AUTHORING_PLAN.md:3` 的同类引用同样失效。**（订正：本记录文件补入仓库后，上述三处引用现均成立；复核命令与结果见文末第八节第 4 条。）**

### 2.3 `git diff --check` exit 2

`git diff --check 036e1df8 HEAD` 把 `src/renderer/ui/chat/contextualCourseCommand.ts` 全部 20 行标为 trailing whitespace——该文件整文件为 CRLF，与仓库 LF 约定不符。其余 7 个含 CRLF 的文件为基线既有的混合行尾，非本批引入。

### 2.4 legacy 账本过期

`check:legacy-ready` / `check:legacy-zero` 硬失败：`scripts/check-legacy-consumers.ts:557` 会按当前产品树重算摘要，与账本 `docs/development-plan/inventories/legacy-consumers.json` 记录的 `reconciledProductTreeDigest` 不符时，`:854-856` 在 `mode!=='ratchet'` 时抛 `stale-inventory`。`check:legacy-inventory`（ratchet 模式）仍 exit 0。**不得手改摘要**，须由唯一锁持有者以独立提交重新对齐。**（订正，见第九节第 10 条）摘要值与文件数都不得写进文档**：同一候选、同一会话内 15 分钟就实测到两个不同值（2026-09-21 16:06 +08:00 → `97d8cf6e…`；16:21 +08:00 连续三次均 → `f7cca29c…`），本节原先记录的第三个值（`560644…`）连同"1529 个文件"同样不可复现——因为它不是提交的函数，输入集包含被 gitignore 的 `artifacts/*`。只保留命令与结论：`npm run check:legacy-ready` → **exit 1**、`legacy:stale-inventory: product digest 已偏离台账`。

### 2.5 独立对抗性评审发现的产品缺陷

四项评审各自独立复现，其中三项为候选引入的回归：

- **[P0] Flow 光标阻断全部发送（本批引入的回归）**：`courseChatObservation.ts` 的 `freezeTarget()` 在 scope 决定**之前**无条件解析 Flow 选区，而 `CourseChatPanel` 在 freeze 之后才决定 scope。正文里留下光标（零长选区）即让每一次发送——**含整课件与当前页**——都以「请先选择要修改的内容。」失败。基线无此校验。已修复：删除该盲校验，由 `generationSnapshot.ts:81-89` 这个唯一 scope 感知点负责 fail-closed（它只在 `scope==='selection'` 时消费 Flow 选区，并保留 receipt carve-out）。修复后 121 项相关测试通过、typecheck exit 0。**（订正，见第九节第 3 条）** 该 `121` 已不可复现：同一命令 2026-09-21 16:02 +08:00 复测为 `Tests 124 passed (124)`；引用时请重跑第一节第一条链的命令。
- **[P0] 首次外部处理说明的引用清单不完整**：说明由渲染端在 Main 补全**之前**生成，Main 随后注入的课例文档全文、材料片段与材料原件（base64）不在清单中。教师据以确认的载荷描述与真实载荷不符。**未修复**。
- **[P0] 引用块软换行映射错位**：`markdownSourceMap.ts` 把行间 `\n` 纳入允许范围、却把下一行的 `> ` 标记排除在外，`> 引用中文\n> 下一行\n` 的整槽选区映射为 `[{from:2,to:7,before:"引用中文\n"},{from:9,to:12,before:"下一行"}]`，改写后得到 `> 【改】> 【改】\n`——写入教师未选择的 `> ` 并丢失段落分隔，且改动落在允许范围内，下游守卫全部放行。**未修复**。
- **[P1] 映射内核破坏 fail-closed**：列表中间槽位未映射时被静默跳过（跨三项选区只返回两端范围）；裸 URL/自动链接因无终止条件的递归导致整个槽位 UNMAPPED；缩进续行、首行缩进、行尾空格的块整体 UNMAPPED。
- **[P1] 32 MiB 导入上限与 12 MiB 传输上限矛盾**：单张 >9 MiB 的图片材料必然在 AI 轮次失败，且报英文 zod 原文。
- **[P1] 课例作用域的应用记录用量/删除在真实界面不可达**，而本轮新增的 `docs/USER_GUIDE.md:86` 承诺可用。**订正（2026-09-21）**：`docs/USER_GUIDE.md` 4.6 节已改写为"已知边界"，明确只承诺当前对话与工作空间作用域的入口、课例作用域以界面实际显示为准；**界面缺陷本身未修复**。
- **[P1] 说明确认记录不含 CLI**：按工作空间记录，一个 CLI 的确认静默覆盖另外两个，与 `docs/USER_GUIDE.md` 4.5 节（原 `:80`）"之后同一作用域不会每次重复弹出"的措辞矛盾。**未修复**。**（订正，见第九节第 4 条：该项已在当前工作树修复）** `src/main/localAgent/repository.ts:23-25` 现在按 adapter 分文件（`external-ai-notice.<adapter>.json`），`:117` 拒绝 adapter 不匹配的记录，`:146` 写入 `adapter` 字段；回归测试 `tests/unit/externalAiNoticeRepository.test.ts:81`（"keys the confirmation by CLI so one confirmed adapter never sends through another"）、`:96`、`:107`，单文件复跑 `Test Files 1 passed (1)`、`Tests 6 passed (6)`。**注意：该修复在工作树内、尚未提交**，且 `src/shared/externalAiNotice.ts:7-12` 的共享确认 schema 仍只有 `scope` + `noticeVersion`（adapter 维度由 Main 侧记录 schema `repository.ts:28-30` 承载）。
- **[P1] 040 最终门 9 条命名真实用例中 6 条未固定授权模型路由**：`stabilizationCoreUsability.spec.ts:1081/1157/1248/2632` 只 `selectOption(CLI)`，不配模型/强度/服务档，整个 spec 除 import 外零 `luna`/`deepseek` 断言。这 6 条即便通过也**不能证明**走的是 Luna / Claude-DeepSeek 路由。

## 三、未跑（不得读作通过）

- `r20MarkdownSelectionAiLuna.spec.ts`（`R20_MARKDOWN_SELECTION_LUNA_RUN=1`）与 `r20FlowSelectionAiLuna.spec.ts`（`R20_FLOW_SELECTION_LUNA_RUN=1`）**在本候选上未运行**。两者默认 skip；未设环境变量时的"绿"是假绿。
- **041 PPTX 7 项未在本候选上运行**。`output/playwright/r20-pptx/` 目录里只有一个 45 字节的 `.last-run.json`（`{"status":"passed","failedTests":[]}`），全仓无任何脚本以字面量引用该目录名，命令、过滤条件、用例数与耗时均未留存——**7 项与 6.2m 不可追溯**。`r20-fixed-html`（1 项 / 24.1s）与 `r20-native-matrix`（3 项 / 12.8m）同样是单文件 45 字节状态文件，**均不可追溯**；`r20-coauthor-preservation`（跨文档共编 3 项）的 `.last-run.json` 也是 45 字节，但同目录另有 2 张共 844660 字节截图（`cross-owner-pasted.png`、`markdown-saved-image-object.png`），**仍不可追溯**（无 result.json、无断言对应）。**（订正，见第九节第 5 条）** 本节原先把这条结论写成 `output/playwright/r20-*` 通配，**不成立**：该通配下共 19 个目录，口径不一——`r20-flow-selection` 有 168 个文件 / 14235613 字节、`r20-real-other-cli` 有 88 个文件 / 3701947 字节，二者 `.last-run.json` 均为 96 字节 `{"status":"failed"}`；`r20-native-codex`、`r20-native-claude`、`r20-native-opencode` 各 4 个文件 / 约 2.35 MB 且**没有** `.last-run.json`。这三个目录由 `tests/e2e/stabilizationCoreUsability.spec.ts:945` 与 `:1010` 以模板 `` `output/playwright/r20-native-${adapter}` `` 生成，因此字面量搜索找不到，**不是"无脚本引用"**。实测命令：`Get-ChildItem output/playwright -Directory -Filter 'r20-*' | ForEach-Object { $f = Get-ChildItem $_.FullName -Recurse -File; "$($_.Name) files=$($f.Count) bytes=$(($f | Measure-Object Length -Sum).Sum)" }`（2026-09-21 16:06 +08:00）。
- **020 的标准整课 ≤30 分钟目标未验证**。唯一整课实测为 **57.4 分钟，超过目标**（`R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md:100`）；且计时目前只有埋点没有消费者（`src/renderer/**` 与 `scripts/**` 对 `summarizeAiTaskTiming` 零命中），无总时长聚合、无报告、无 UI。`2026-09-10-latency-completion.md` 引用的 `latency-audit.json` 全仓无生产者。
- **上下文卡片只覆盖 2 个表面**：唯一实现挂在 `documentFiles/LessonDocumentEditor.tsx`（Markdown 文件）与 `ui/FlowWorkspace.tsx`（Flow）；`src/renderer/ui/workspaces/**` 内 `contextual` 零命中。Slide/Spatial 未接。
- **021 完整方法未迁入**：选择只按 purpose 二分（`single-page` 与 `local-edit` 完全相同），`skillRoots` 声明零消费者。**（订正，见第九节第 6 条）** 原写"`.agents/**` 不在 `electron-builder.yml` 的打包列表内，而 `lessonAuthoringPrompt.ts` 从 `app.getAppPath()` 读它"——该打包缺口**已在当前工作树修复**：`electron-builder.yml:19-22` 已加入运行时真正读取的 4 个文件（`:16-18` 有对应说明，**不是**整目录 `.agents/**`，理由见 9.1(a)），守卫测试为 `tests/unit/packagedRuntimeBoundary.test.ts`。**该修复在工作树内、尚未提交**；打包产物本身未构建验证（本轮硬禁令禁止 `npm run build`）。
- **022/060 的发布物数据边界无自动化检查**：没有任何测试或脚本证明消息/trace/凭据不进入 `.h5lesson`、Published 或导出物。
- **025 的 G01–G12 原先在任何文档或代码中都未定义**（此前全仓仅 `r20-025-plugin-workflow-parity.md:7` 一行编号），因此"关闭 G01–G12"无法判定。**订正（2026-09-21）**：G01–G12 已在 `r20-025-plugin-workflow-parity.md` 的"差距清单（G01–G12）"一节逐项定义（编号／缺口与要求／当前证据／状态），状态只用"关闭／部分关闭／未关闭／环境阻塞"四态。**定义不等于通过**：该表 12 项中没有任何一项可记为"关闭"，因为受 `R20_MARKDOWN_SELECTION_LUNA_RUN`／`R20_FLOW_SELECTION_LUNA_RUN` 门控的真实选区用例在本候选上仍未运行。
- **040 的 opencode 通道探测为 `unknown-auth`**，登录状态不可确认。

## 四、环境阻塞

- **025 真实 VS Code 插件对照——不是环境阻塞，是未执行。** **（2026-09-21 独立复核订正，原判据不成立）** 本节原写"`code` 在 PATH 上指向 Cursor 3.20.21，非 VS Code；已装扩展只有 `anysphere.*` 四个。**无 VS Code 即无法做指定插件对照**"。该结论**错误**，已实测推翻：
  - `where.exe code` 返回 **4** 条：前两条为 Cursor 的 `codeBin\code(.cmd)`，**第 3、4 条是真实 VS Code** `D:\Users\74755\AppData\Local\Programs\Microsoft VS Code\bin\code(.cmd)`；`Test-Path 'D:\Users\74755\AppData\Local\Programs\Microsoft VS Code\Code.exe'` → **True**。
  - 用**绝对路径**调用真实 VS Code CLI：`code --version` → **1.133.0**（`a5b500951314efd502d07465bd138dfbd714a960`，x64）、exit 0；`code --list-extensions` → exit 0，列出 **`anthropic.claude-code`** 与 **`openai.chatgpt`**，即 025 对照所需的**两家插件都已安装**（`~\.vscode\extensions` 内为 `anthropic.claude-code-2.1.235-win32-x64`、`openai.chatgpt-26.814.41407-win32-x64`）。
  - 原判据的成因是把**默认 PATH 首项**当成了"本机唯一的 `code`"，并把 `~\.cursor\extensions` 的 4 个扩展当成了"已装扩展"的全部。`anysphere.*` 四个确在 `~\.cursor\extensions`（该目录实测确为这 4 个），但那是 Cursor 的扩展目录，与 VS Code 无关。
  - **订正后的准确状态**：025 对照**本轮未执行**，原因是它需要交互式 GUI 会话与跨多个课例任务的付费模型运行，超出本批范围；**不是因为缺 VS Code**。仍未知的是两个扩展的**登录状态**：`%APPDATA%\Code\User\globalStorage` 下**没有** anthropic/openai 的状态目录（实测为空），与"从未登录"一致，但登录凭据存放于加密秘密存储，**据此不能断定未登录**。故本项按"未执行且登录状态未知"登记，不按"环境阻塞"登记。
  - **影响**：这是一次**反向过度断言**——把"本机具备条件但本轮没做"写成了"本机不具备条件"，会让必选对照在具备条件的机器上被误判为不可达。同类措辞在 `r20-025-plugin-workflow-parity.md:41`、`S4-ai-product.md:13`、任务卡第 4 行一并订正。
- **030 真实读屏流程**：本机只有 Narrator 10.0.26100.8972 与 SDK Inspect/AccEvent，无 NVDA、无 JAWS。`r20-030-docs-accessibility.md:32` 要求"实际窗口/读屏工具复核"，不可自动化。**（订正，见第九节第 7 条）** 原写"聊天转写区 `ui/chat/CourseChatTranscript.tsx:43` 是无 live region 的普通容器，`src/renderer` 内 `role="log"` 零命中，`tests/**` 内 `读屏|屏幕阅读器|a11y` 零命中"**不成立**：`src/renderer/ui/chat/CourseChatTranscript.tsx:92` 就是 `role="log"` 的 live region，策略见同文件 `:45-55`；`tests/**` 现有 1 处 `屏幕阅读器` 命中（`tests/unit/nativeAgentDiagnostics.test.tsx:64`）。**读屏仍是环境阻塞**——该 live region 只经单元测试（`tests/unit/chatTranscriptAccessibility.test.tsx`）验证，**未经任何真实读屏工具验证**。
- **050 Owner S4 签署**：只能由 Owner 本人复核并签署，非自动化可代。
- **060 发布**：依赖 050 与 041 收口。**未创建任何 `v2.0.0` 标签**；最新标签仍是 `v1.9.0-rc.1`（`git tag --list` 实测共 15 个标签，最早 `v1.6.0-rc.1`）。**（订正，见第九节第 11 条：原写"唯一标签"不准确）**

## 五、不可追溯与需返工的证据（本轮审计新增）

- **Markdown 三 CLI 不是一条干净链路**：合并运行 `output/playwright/r20-real-other-cli/.last-run.json` 为 `failed`，其中 opencode 无 `result.json`，`error-context.md` 记 `TimeoutError: locator.fill: Timeout 30000ms exceeded … waiting for getByRole('textbox', { name: '发送给创作助手', exact: true })`；opencode 是在改过 spec 定位符（`发送给创作助手` → `给创作助手的消息`）并重跑多次后才通过（`r20-real-opencode-fixture-permission`，route `openai/gpt-5.6-luna-fast`）。**该返工过程与原因没有任何记录**，按 `WORKING_PROTOCOL.md:73` 属过程不可查。三个适配器各有真实 route 证据，但不构成"一条链一次通过"。
- **证据运行在时间上重叠**：`r20-pptx` 的旧证据窗口（00:07:06–00:10:20）落在 `r20-real-codex-final` 与 `r20-real-other-cli` 之内；`r20-native-matrix`（约 00:12:02–00:24:18）与 `r20-real-other-cli` 重叠约 2m20s。至少两组真实模型运行同时进行，相关墙钟数字取自竞争负载。
- **隔离实例的 4 张截图不可复现**：`output/r20-live.cjs` 只做启动与两次点击，不含截图或测量代码；4 张 PNG 与任何断言之间没有脚本或数据可对应，且 `records-cleared.png` 之后的 profile 中仍留有 1 条 276B 会话记录。**截图内容本轮无法核实**（当前模型无图像输入能力），因此公式 `$E=mc^2$` 渲染、焦点位置、清理后的条数/字节数均未被本记录确认。
- **全量记录的覆盖已过期**：此前记录运行覆盖 454 文件，候选为 456；`tests/unit/nativeAgentQuestion.test.tsx` 与 `tests/unit/nativeAgentHelp.test.tsx` 在记录之后才新增，从未被任何全量记录覆盖。
- **首次 Flow 失败的成因未隔离**：失败运行结束与通过运行开始之间还发生过一次完整渲染器重建（`output/r20-final-renderer-build.log`，`✓ built in 5.37s`），无法把修复唯一归因于夹具改动。

## 六、明确不得声称的结论

1. 不得声称 2.0 已 accepted，或"2.0 分项已通过"。S4 未签署，025/030 环境阻塞，020/040 整课完整生产链与 041 未在本候选上收口。
2. 不得声称"自动化门已全绿"——`npm test` 在候选上为红，`npm run verify`（`check:ai-capabilities && typecheck && test && test:e2e`）因此不可能通过。
3. 不得声称"失败都是并发超时"——原文含 4 条链接失败与 1 条非超时性能断言。**订正**：4 条链接失败已修复（见 2.1 末尾），但 `repoIndexTypeScriptAdapter.test.ts:183` 的性能断言仍非超时，且两次全量运行的失败集不同，证明失败集随负载浮动；在安静机器上重跑全量之前，不得把失败一律归因于并发。
4. 不得声称 PPTX 7 项 / 固定 HTML 1 项 / 原生矩阵 3 项有可追溯记录——`r20-pptx`／`r20-fixed-html`／`r20-native-matrix` 三个目录里只有 45 字节状态文件。**（订正，见第九节第 8 条）不得把这条禁令扩大成 `output/playwright/r20-*` 通配结论**：该通配下 19 个目录口径不一，`r20-native-{codex,claude,opencode}` 各约 2.35 MB 真实制品且没有 `.last-run.json`，见第三节第一条的实测与命令。
5. 不得声称"证据已随候选保存"——`output/` 被忽略，所有原始制品不在提交内。
6. 不得声称 Markdown 三 CLI 链无返工，或 040 的 6 条未固定路由用例证明了授权路由。
7. 不得把本轮自动化读作 `art candidate` 或 `accepted`；自动化最多证明 `engineering candidate`。
8. 不得声称 1.9 签署被重开或受影响——`v1.9.0-rc.1` 保持有效。

## 七、继承的已签收基线

1.9 内部 RC（`v1.9.0-rc.1`，`b4751145`）的目录会话/文件目标与按任务创作继续有效；本轮不恢复固定四稿或简洁/专业分档。明确审稿才暂停。本轮只新增上下文共编与 2.0 分项工程候选，不改变已签收行为。

## 八、订正记录（2026-09-21 复核，仅补充事实）

本节不删除、不软化第一至七节的任何"未跑／环境阻塞／不得声称"结论。本节最初是**追加**内容，第一至七节行号不动；**2026-09-21 第二轮对抗性文档评审后，以下各处已在原处就地改正**（下述行号为**改正前**的行号；改正后因新增"测试规模口径"段而整体下移 2 行）：第一节三条单元链结果（原 `:23-25`）、第二节 Flow 光标回归条目末尾的"121 项"（原 `:69`）、第二节"说明确认记录不含 CLI"（原 `:75`）、第三节 041 条目（原 `:81`）、第三节"021 完整方法未迁入"（原 `:84`）、第四节 030 读屏条目里的 `role="log"` 断言（原 `:92`）、第六节第 4 条（原 `:109`）、本小节第 5 条。其余行未改动。每处就地改正都留有指向第九节的指针。**第九节记录本轮实际修复、申报与写域，不改变第六节的任何禁令。**

**行号换算规则（本节及第九节通用）**：本节内所有行号（含对第一至七节的交叉引用）一律指**改正前**的行号；改正后第一至七节中**原 `:N`（N ≥ 27）现为 `:N+2`**，`:1-26` 不变。例：本节第 3 条说的"第 108 行的禁令"现位于 `:110`；第 7 条说的"第 106–113 行的禁止结论"现位于 `:108-115`（`:106` 现为第六节标题）。

1. **第 3 行"工作树干净"不成立**。证据（本机实跑）：`git rev-parse HEAD` → `e39052fc5bf9515419ff2b7b83b7ea57a7fc8a11`（`wip(r20): contextual authoring + 2.0 gates (pre-review snapshot)`）；`git status --porcelain` → **33 项**（`24` 项已修改 + `9` 项未跟踪），其中含本记录文件自身（`?? docs/development-plan/reviews/2026-09-21-r20-contextual-acceptance.md`）与 `?? docs/development-plan/acceptance/S3-ai-core.md`、`?? docs/development-plan/acceptance/S4-ai-product.md`。项数随并行任务继续变化，但"干净树"在任何时点都不成立。**第二次实测（2026-09-21 16:25:06 +08:00，HEAD 仍为 `e39052fc`）**：`git status --porcelain` → **47 项**（`36` 已修改 + `1` 已删除 + `10` 未跟踪），与首次的 `33`（`24`+`9`）不同，**同一提交、同一天内两次测量就不同**——因此项数不得当常量引用，只保留命令与结论。**结论**：本记录只绑定 `e39052fc` 这一提交，不得声称全部证据产生于干净树。
2. **第 42–44 行的 4 条 Markdown 链接失败已修复**（本记录文件补入仓库后链接目标成立）。复核（本机实跑，均 exit 0）：`npx --no-install vitest run tests/unit/repoIndexGenerator.test.ts --maxWorkers=1` → `Test Files 1 passed (1)`、`Tests 7 passed (7)`；`npx --no-install vitest run tests/unit/repoIndexSemantic.test.ts tests/unit/repoIndexQuery.test.ts --maxWorkers=1` → `Test Files 2 passed (2)`、`Tests 19 passed (19)`。校验实现位于 `scripts/repo-index/generator.ts:673-720`：会拒绝反斜杠路径、越出仓库的目标、不存在的目标与缺失的锚点——因此本记录文件**不得改名或删除**，否则这 4 个文件会再次变红。
3. **第 46 行的非超时性能断言未修复，且本轮未单独复核**（本轮未单独运行 `repoIndexTypeScriptAdapter.test.ts`）。**第 108 行的禁令继续有效**：4 条链接失败已修复，但性能断言仍非超时，两次全量运行的失败集不同（第 35／36 行）证明失败集随负载浮动。**（2026-09-21 复核订正：本句原写"`npm test` 全量本轮未重跑，第 35／36 行的两次红仍是本记录关于全量的唯一证据"——该结论已被推翻。全量已在当前工作树重跑并转绿，见 2.1 的"复核更新"段（`Test Files 461 passed (461)`；`Tests 4438 passed | 3 skipped (4441)`；exit 0）。因此第 35／36 行的两次红**不再是**关于全量的唯一证据，其"失败集随负载浮动"的诊断由该复核独立支持；但性能断言本身**未被修复**，只是在 `--maxWorkers=2` 下未复现，仍按 2.1 末条保留为已知脆弱断言。）**
4. **第 53 行的路线门 exit 1 已消失**。复核（本机实跑）：`npm run check:development-roadmap` → `开发路线校验通过：176 个节点，22 份规格，归档旧任务映射 98 行；首个并行 frontier：r12-000-native-contract + r12-005-flow-native-authoring-parity。`，**exit 0**。第 55 行所指三处引用（`docs/development-plan/roadmap/2.0/README.md`、`COURSEWARE_DEVELOPMENT_PLAN.md:112`、`R19_1_TO_R20_CONTEXTUAL_AUTHORING_PLAN.md:3`）现均成立。**门变绿只说明链接成立，不代表 2.0 通过任何签署点**。
5. **第 74 行的"USER_GUIDE 承诺可用"已不成立**：`docs/USER_GUIDE.md` 4.6 节已改写为"已知边界"，只承诺当前对话与工作空间作用域的清理入口，课例作用域以界面实际显示为准；**界面缺陷本身未修复**（唯一渲染点仍是 `src/renderer/lessonWorkspace/view/LessonWorkspaceView.tsx:1534`）。第 75 行所指 `docs/USER_GUIDE.md:80` 现位于 4.5 节；**（2026-09-21 第二轮订正）** 4.5 节已在原处改写为与当前实现一致的口径（确认按工作空间身份 + CLI + 说明版本记录），且第 75 行的"确认记录不含 CLI"缺陷已在工作树修复——见第九节第 4 条。
6. **第 86 行的"G01–G12 未定义"已不成立**：`docs/development-plan/roadmap/2.0/r20-025-plugin-workflow-parity.md` 已新增"差距清单（G01–G12）"一节，逐项给出编号／缺口与要求／当前证据／状态（关闭／部分关闭／未关闭／环境阻塞）。**定义不等于通过**：12 项中没有任何一项可记为"关闭"，受 `R20_MARKDOWN_SELECTION_LUNA_RUN`／`R20_FLOW_SELECTION_LUNA_RUN` 门控的真实选区用例在本候选上仍未运行；025 的真实 VS Code 插件对照**本轮未执行**（第 91 行所指"环境阻塞"判据已被独立复核推翻，见第九节第 12 条与第四节）。
7. **登记（不属于本记录原有结论的改动，仅供追溯）**：文档中三处超出证据的表述已订正为四态事实——`docs/development-plan/roadmap/2.0/README.md:5`、`docs/development-plan/R19_1_TO_R20_CONTEXTUAL_AUTHORING_PLAN.md:3`、`COURSEWARE_DEVELOPMENT_PLAN.md:111-112`。第 106–113 行的禁止结论全部保留。

## 九、本批修复、申报与写域（2026-09-21 第二轮对抗性文档评审）

本节只登记**工程事实**与**写域申报**。**自动化最多证明 `engineering candidate`**：本节任何一条都不构成教师验收，也不构成 `art candidate` 或 `accepted`；第六节的禁令全部继续有效。下列命令均为本机实跑，退出码为实测。

### 9.1 本批修复的三处真实缺陷

**(a) 打包缺 `.agents/**`（打包后必然 ENOENT）**

- 问题：`src/main/lessonAuthoringPrompt.ts:13-19` 把 5 个创作阶段映射到 `.agents/skills/**/references/*.md`，`:22-23` 用 `path.join(editorRoot, …)` 读取；`editorRoot` 由 `src/main/lessonAuthoringDesktopService.ts:320` 传入 `app.getAppPath()`。而 `electron-builder.yml` 的 `files:` 未包含 `.agents/**`，**打包产物里读不到这些方法文件**。
- 修复：`electron-builder.yml` 的 `files:` 加入运行时真正读取的 4 个文件（`LESSON_AUTHORING_METHOD_PATHS` 的 4 个唯一值）。守卫：`tests/unit/packagedRuntimeBoundary.test.ts`。
- **订正（2026-09-21 独立对抗性复核）**：第一版修复写的是整目录 `- .agents/**`，**属过度打包**——它会把被 gitignore 的本机状态文件 `.agents/skills/build-courseware-project/editor-root.local.json`（84 字节，内容含 `D:\果铃工作台` 与写入时间戳）打进 `app.asar`。后果是双向的：本机构建时发布边界扫描必然报 `personal-path.repository-root` 并 `throw`（`npm run verify:release` 必然失败），而换一台构建机（仓库根不同）该规则匹配不到文件里写死的路径，**本机绝对路径会静默随包发布**。整目录还会带上仅供外部 Builder 阅读的说明文档（如 `external-case-build.md`）。
- 实测证据（真实 `@electron/asar` 打包 + 真实 `scanReleaseArtifactAsar`，`output/r20-p1-mut/asar-e2e.mts`）：收窄后的清单 `coverage {"files":0,"archives":1,"entries":4,"bytes":25009}`、**`findings: 0`**；同一脚本的过度打包对照 `findings: 1`，命中 `[personal-path.repository-root] entry=.agents/skills/build-courseware-project/editor-root.local.json`。
- 同批修掉一个**规则误报源**：`personal-path.documents-directory` 原为裸 `/Documents[\\/]{1,2}/gu`，不要求任何路径上下文，会命中 `external-case-build.md:17` 正文「用户 Documents/Desktop 的直接子项目」；现要求盘符或前导分隔符，仍能抓 `C:\Users\…\Documents\…`、`/home/…/Documents/…` 与 UNC 形态。误报会诱使后来者放宽规则，属真实风险而非洁癖。
- 守卫强度补强（原守卫对 `!` 负向模式无效）：`uncovered` 改为按 electron-builder 的「后匹配者胜」语义处理负向模式，并新增「不得打包本机状态文件」用例。变异验证（真跑）：删掉一个运行时文件 → `2 failed | 4 passed`；重新写宽为 `.agents/**` 再加 `- "!.agents/skills/build-courseware-project/**"` → `2 failed | 4 passed`（**修复前该变异 4 passed 全绿**）；重新写宽为裸 `.agents/**` → `1 failed | 5 passed`。`electron-builder.yml` 变异后 SHA256 与基线一致（`8D02D00F…53ECF6`）。
- 同批补掉一个**编码盲区**：`decodeArtifactText` 只按 UTF-8 解码，UTF-16 产物里 ASCII 明文是「字符 + 0x00」交错字节，任何凭据规则都不匹配（按原始字节扫描同样无效）。现改为 UTF-8 与 UTF-16LE 双向解码并按规则取命中数较大的一侧（`mergeReleaseArtifactBoundaryFindings`，避免同一处计两次）。变异验证：把 `decodeArtifactTexts` 退回只解 UTF-8 → `1 failed | 22 passed`；还原后 SHA256 与基线一致（`C0863195…5C4B7A`）。
- 同批补强**单一来源守卫**：原守卫只禁 `path.join(…, '<文件名>')`，因此「就地数组清单 + `relative.split('/')` + 一行只为满足 `toContain` 的伪派生调用」这种平行清单能全绿通过（复核 M6b 实测 `21 passed`）。现增加「带目录的仓库相对路径不得作为字符串字面量出现」判据（合法内容断言用裸文件名，不含目录，不会被误伤；常量用 `path.join` 拼，Windows 为反斜杠，故正斜杠与原生两种形式都查）。变异验证：注入平行清单 → `1 failed | 23 passed`（**修复前全绿**）。
- 复跑：`npx vitest run tests/unit/packagedRuntimeBoundary.test.ts --maxWorkers=1` → `Tests 6 passed (6)`、exit 0；`npx vitest run tests/unit/releaseArtifactBoundary.test.ts --maxWorkers=1` → `Tests 24 passed (24)`、exit 0（13 → 21 → 24）；`npx tsc --noEmit` → exit 0。
- **仍未关闭（复核发现，非本批引入）**：打包产物边界实际只覆盖 `release/win-unpacked/resources/**`，`release/*.exe` 与 `win-unpacked` 根下的 Electron 运行时文件不在扫描范围。注释已说明取舍理由（整树扫会在 `electron.exe` 命中 Chromium 自带的 AWS 规则），**收窄范围而不放宽规则是正确的**，但名字宽于实际覆盖，属登记项。
- **未验证**：未构建打包产物（本批硬禁令禁止 `npm run build`），"打包后确实能读到"目前只有静态守卫证据 + 上述 asar 等价模拟，**没有真实打包产物证据**。

**(b) 列表项续行映射损坏（改写后凭空多出硬换行）**

- 问题：`listItemBody` 按列截断续行，被截掉的缩进留在两个区间之间的**空洞**里；改写行间换行会把缩进留成可见正文（源文 `- 甲` + 换行 + 两空格 + 换行 + 两空格 + `乙` 会多出一个正文里没有的硬换行）。
- 修复：把该换行标成 `barrier`，跨它的选区**整体拒绝**（与引用块同一机制）——收集 `src/shared/document/markdownSourceMap.ts:124-127`、落到承载单元 `:153-157`、拒绝 `:233` 与 `:259`。
- 守卫：`tests/unit/markdownSourceMap.test.ts:186`（定点拒绝）与 `:195`（穷举不变量"mapped 结果区间之间不得有未覆盖空洞"）。复跑：`npx vitest run tests/unit/markdownSourceMap.test.ts --maxWorkers=1` → `Test Files 1 passed (1)`、`Tests 35 passed (35)`、exit 0。
- **变异验证（真跑，非推断）**：在 `output/r20-wf-docs/mut/` 生成只删掉两处 fail-closed 拒绝行的变异副本，用**仓库里那份真实测试文件**去跑变异实现：
  - `npx vitest run --config output/r20-wf-docs/mut/vitest.mutation.config.ts tests/unit/markdownSourceMap.test.ts --maxWorkers=1` → `Test Files 1 failed (1)`、**`Tests 3 failed | 32 passed (35)`、exit 1**；失败项正是 `refuses a quote selection that spans a soft line break`、`maps an indented list continuation inside one line and refuses a selection across its break`、`a mapped selection never leaves an uncovered hole between its ranges`。
  - 同一断言逻辑的独立复算（`npx tsx output/r20-wf-docs/mut/check.ts`，exit 0）给出 **17 条反例**，首条：`"- 甲\n  乙\n- 丙\n"` 0..3 → `[{"from":2,"to":4},{"from":6,"to":7}]`，空洞正是 4..6 的两格缩进。
  - 真实实现下同一文件 35 项全过（见上）。**结论：这些守卫确有鉴别力，不是空跑通过。**
  - 注意：变异配置只存在于 `output/` 下，仓库 `vitest.config.ts` 未被修改。

**(c) e2e 真实付费回合未固定授权路由**

- 问题：`tests/e2e/stabilizationCoreUsability.spec.ts` 的「S3 真实载体」用例只 `selectOption(CLI)` 就发送，既没有 `configureR18AiTestModel` 也没有 `expectAuthorizedR18Route`，模型与推理强度取自用户当前配置，可能落在授权之外。
- 修复：`:1045-1046` 等处补上 `configureR18AiTestModel(page, …)` + `expectAuthorizedR18Route(…)`（断言实现 `:89`，import `:23`）；S3 真实聊天循环 `:933-936` 原先只 `console.log` 路由，现补断言（`:935` 注释："只打印不断言等于没有约束"）。
- **未跑**：这些都是真实付费模型 e2e，本批硬禁令禁止运行，**本候选上没有任何新证据**。此条只登记代码改动，**不得读作"已修好并通过"**。

### 9.2 未申报改动的补申报

1. **`src/renderer/ui/chat/CourseChatTranscript.tsx` 与 `tests/unit/chatTranscriptAccessibility.test.tsx`**（此前未申报）：修复 `aria-busy` 在流式追加中途回落——原实现只看最后一个事件，正文分片与工具/用量事件交错时被误判为已结束，导致 `aria-busy` 提前回落、流式内容被反复播报；现改为倒序扫描全部事件并按会话跟踪 settled（计算 `CourseChatTranscript.tsx:22-40`，渲染 `:90-93`，播报策略 `:45-55`）。复跑：`npx vitest run tests/unit/chatTranscriptAccessibility.test.tsx --maxWorkers=1` → `Test Files 1 passed (1)`、`Tests 6 passed (6)`、exit 0。**未验证**：本机无 NVDA／JAWS，未经任何真实读屏工具验证；本条也**未做变异验证**（变异需改 `src/**`，超出本轮写域）。
2. **`scripts/releaseArtifactBoundary.ts` 与 `scripts/verify-release.ts`**：本批发布边界修复的实际接入点，此前落在 8 把写锁之外、未申报；现已写入任务卡 Write scope（`docs/development-plan/tasks/r20/r20-contextual-authoring.md` 第 5 行）。配套 `tests/unit/releaseArtifactBoundary.test.ts` 同批申报。

### 9.3 本轮就地改正的文档断言（与第八节互为指针）

1. 第一节三条单元链结果（原 `:23-25`）：`121／61／33` → 命令 + 2026-09-21 复测值 `124／79／42`，并声明**计数不得当常量引用**。
2. 第一节表后新增"测试规模口径"段：vitest 文件 `461`、e2e spec `93`（2026-09-21 16:06:30 +08:00 实测），并说明流传的 `124 / 78 / 202` 一组数字**在本机无法复现**。
3. 第二节 Flow 回归条目末尾的"121 项"（原 `:69`）。
4. 第二节"说明确认记录不含 CLI"（原 `:75`）：该项**已在当前工作树修复**（按 adapter 分文件，`src/main/localAgent/repository.ts:23-25`），并注明该修复尚未提交。
5. 第三节 041 条目（原 `:81`）：把 `output/playwright/r20-*` 通配结论改为 19 个目录的逐项实测口径。
6. 第三节"021 完整方法未迁入"（原 `:84`）：`.agents` 运行时读取的 4 个方法文件已进打包列表（**不是**整目录 `.agents/**`，见 9.1(a) 订正）。
7. 第四节 030 读屏条目（原 `:92`）：`role="log"` 零命中与"无 live region"的断言被推翻，改为真实策略描述。
8. 第六节第 4 条（原 `:109`）：不得把"45 字节状态文件"扩大成 `r20-*` 通配结论。
9. `docs/USER_GUIDE.md`：4.3 节 `liveProjectTools` 出处改为 `src/main/localAgent/profile.ts:316`；4.5 节确认口径改为"按作用域 + CLI + 说明版本"（与 `src/renderer/ui/chat/useExternalAiNotice.tsx:291` 的界面文案一致）；4.6 节对验收记录的引用行号 `:74` → `:76`。
10. 第二节 2.4 节（原 `:65`）：删掉不可复现的第三个产品树摘要值与"1529 个文件"，改为命令 + 结论。同批删掉的还有任务卡第 4 行的两个摘要值（见 9.1 前的任务卡改动）——**同一类缺陷共四处，全部只留命令与结论**。
11. 第四节 060 发布条目（原 `:110`）：原写"**唯一**标签是 `v1.9.0-rc.1`"不准确。实测 `git tag --list` 共 **15** 个标签，最早 `v1.6.0-rc.1`；准确表述是"**最新**标签仍是 `v1.9.0-rc.1`，且未创建任何 `v2.0.0`"。同批订正的还有 `docs/development-plan/acceptance/S4-ai-product.md:3` 的同一措辞。
12. 第四节 025 真实 VS Code 插件对照条目（原 `:104-109`）：原按"环境阻塞"登记，**判据被独立复核推翻**（本机确有 VS Code 1.133.0 与两家插件），已改为"未执行、非环境阻塞、登录状态未知"。同批订正 `r20-025-plugin-workflow-parity.md:41`、`S4-ai-product.md:13`、任务卡第 4 行。
13. 第八节第 6 条末句"025 的真实 VS Code 插件对照仍属环境阻塞"：**与第 12 条同因，已不成立**，就地改为"未执行"。**该条其余结论（G01–G12 定义不等于通过）不变。**

### 9.4 本轮未验证 / 无法验证

1. **未构建打包产物**、**未跑真实读屏**、**未跑任何真实付费模型 e2e**、**未跑 `npm run verify` 本体**——均为本批硬禁令或环境阻塞。（订正：本条原与"未跑 `npm test` 全量"并列，该并列已不成立——全量已在当前工作树重跑并转绿，见 2.1 的"复核更新"段与第八节第 3 条的订正。）
2. 9.1(a) 只有静态守卫证据，9.1(c) 只有代码改动，**两者都没有运行时证据**。
3. 9.2 第 1 条的 `aria-busy` 修复**未做变异验证**（变异需改 `src/**`，超出本轮写域）。本记录初版时"唯一做成的变异验证是 9.1(b)"的表述**已过期**：2026-09-21 独立复核批另做成 5 项变异验证（9.1(a) 的打包守卫 M4／M5／M9 与 UTF-16 解码退化、9.1 单一来源守卫的平行清单注入），全部真跑且每次变异后都校验被改文件 SHA256 与基线一致。仍未做变异验证的是 `src/**` 下的改动。
4. 本记录只绑定 `e39052fc` 这一提交；`git status --porcelain` 的项数随并行任务继续变化，本节的"工作树修复"均**尚未提交**。

### 9.5 独立复核发现但**经核实无实际影响**、故不改动的项

- **`repository.ts:108-110` / `:133-135` 声明 `Promise<…>` 却在返回前同步 `parse`**：若 `adapter` 非法或 `scope` 畸形，函数会**同步抛出**而不是返回 rejected promise，属真实的签名不一致。**核实结论：当前唯一调用点无影响**——`src/main/localAgent/service.ts:63-64` 位于 `async function operate()` 内，且 `:52` 是 `await operate(request)` 包在 `try` 中，同步抛出同样会被 `:53` 捕获（`ZodError` 按 `:54` 原样重抛，与异步路径行为一致）。`grep` 全仓库确认只有这一个调用点。**处置：登记不改**——改成 `async` 是纯风格收敛，无行为收益，不应为它引入未验证改动。

### 9.6 `npm run verify` 的校验门缺口（**结构性，不是漏加**）

2026-09-21 逐门核实 `package.json` 的 13 个 `check:*` 与 `verify` 的关系。`verify` 现有 4 门（`check:ai-capabilities`、`check:contracts`、`check:development-roadmap`，本批新增 `check:task-board`），其余 9 门**不能简单补入**，原因是结构性的：

| 门 | 为何未入 `verify` |
| --- | --- |
| `check:examples`（含 `check:sample-examples` / `check:lesson-demo:fixture` / `check:render-benchmark:fixture`） | 依赖**未纳入版本控制**的构建产物：`git ls-files runtimes` → **0 个文件**；`scripts/build-render-host-benchmark.ts:629` 缺 `dist-player/player.iife.js` 直接抛「请先运行 npm run build:player」，`scripts/build-interactive-lesson.ts:382` 同样读 `dist-player`。而 `verify` 的 `test:e2e` 只是裸 `playwright test`（`package.json`），**全链不构建**，故补入会让 `verify` 在干净检出上必然失败。 |
| `check:renderer-fonts` | 同类：`scripts/check-renderer-font-assets.ts:28` 读 `dist-renderer`，`:51-53` 缺目录时抛「找不到 renderer 构建产物……请先运行 npm run build:renderer」。 |
| `check:preservation` | **与 `test` 重复**：它跑的 `tests/unit/preservationChecker.test.ts` 等已在 `vitest.config.ts:15` 的 `include: ['tests/unit/**/*.test.{ts,tsx}', …]` 内，而 `verify` 已含 `test`（`vitest run`）。补入只是把同一批用例跑第二遍。 |
| `check:legacy-ready` / `check:legacy-zero` | **当前硬失败**：`legacy:stale-inventory: product digest 已偏离台账`（见 2.4）。补入会让 `verify` 立刻红，且正确处置是由唯一锁持有者以独立提交重新对齐账本，**不得为凑绿而手改摘要**。 |

结论：`verify` 的缺口是「校验门与构建产物／账本状态的耦合」问题，不是清单遗漏。**本批只补入 `check:task-board`**（纯仓库一致性、无构建依赖、且本轮它真的抓到了一次任务板过期）。**未跑 `npm run verify`**（本批硬禁令），故上述补入只经「各门单独复跑 exit 0」验证，组合后的 `verify` 未验证。

**操作发现（改 `package.json` 必须重生成能力清单）**：`package.json` 是 `artifacts/ai-capabilities/generation-evidence.json` 的 `inputs.sourceFiles[0]`（该清单共记录 323 个源文件哈希）。因此**任何 `package.json` 改动都会让 `check:ai-capabilities` 立刻失败**，报「来源溯源证据过期 generation-evidence.json」——`scripts/generate-ai-capabilities.ts:1842-1843` 在其余生成物都新鲜、只有该证据文件过期时给出这条消息。本批实测：改 `verify` 一行 → `check:ai-capabilities` exit 1；`npm run generate:ai-capabilities` → 78 个文件、索引 16275 / 16384 字节、exit 0；重生成后连跑两次 `check:ai-capabilities` 均 exit 0（幂等）。差异逐字段比对确认**只有 `.inputs.sourceFiles[0].sha256` 一处变化**（`90a4f7a3…` → `f3c90dfb…`），且重生成后的值等于工作树 `package.json` 的 sha256（HEAD 的值为 `1b16a365…`）。

### 9.7 第三轮：评审发现的产品缺陷与本批引入的回归（2026-09-21，全部真跑 + 变异验证）

本节登记**新修的三处产品缺陷**，其中第一处是**本批自己在第二轮引入的回归**。三处都做了变异验证（改 `src/**` → 跑定点测试确认变红 → 还原并核对 SHA256 与基线逐字节一致）。

**(a) 标题映射回归（本批第二轮引入，[P1]）**

- **症状**：源文里任何**后面还有内容**的标题，选区一律无法定位，教师看到 fail-closed 拒绝「当前选区无法精确定位，请在源文中选择范围。」；而"整篇只有一个标题"时却正常。**不是错误写入，是拒绝服务**。
- **成因**：第二轮把非引用块分支的 `add('content', body)` 改成了 `add('content', trim(body))`，以修标题多出的换行；但同一批的 `blockBody` 只剥**一个**尾部换行。marked 对不同 token 留下的尾部换行数不同——段落是 `"段落\n"`（一个），而**后面跟空行的标题是 `"# a\n\n"`（两个）**。于是 `trim` 之外还残留 `\n`，单元文本变成 `"a "` 而解析文本是 `"a"`，`markdownSourceMap.ts:152` 的 `expected !== units.map(u => u.text).join('')` 判等失败 → **槽位被静默丢弃**，而 `keys` 仍列出它，`:253` 遂把整个键判为 `unmapped`。
- **独立复现**（`npx tsx output/r20-heading-probe.mts`，本轮新写的探针）：标题独占全文 `"# a\n"` → mapped；而 `"# a\n\n段落\n"`、`"# 标题\n\n正文\n"`、`"# a\n\n- x\n  y\n"`、`"# a\n\n# b\n"`、`"段落\n\n# a\n\n段落\n"` 五种情形的标题槽位**全部 `slots=[]` → unmapped**；标题在文末（`"- x\n  y\n\n# a\n"`）又恢复正常。
- **正确的修法**：不是 `trim`（会连**可见的**首尾空格一起删掉），而是让 `blockBody` 剥掉**全部**尾部换行。尾部换行永远是块分隔，永远不是可见文本；而块自身的首尾空格是可见文本，解析文本也带着它（`"  甲  \n"` 解析为 `"  甲  "`）。改为 `cut(p, 0, p.text.replace(/\n+$/, '').length)`，并把 `trim(body)` 还原为 `body`，同时在 `blockBody` 上写明这一区分。
- **为什么原有 35 项测试抓不到**：既有标题用例全是"标题即全文"，而空格用例（`tests/unit/markdownSourceMap.test.ts:216`）恰好要求保留首尾空格——**两者都对，缺陷只在两者的交叉处**。本轮新增 2 项定点用例（`:226` 标题后接其他块、`:232` 标题后接多个空行）。
- **实测**：`npx tsx output/r20-heading-probe.mts` → 7 组用例全部 `mapped`；`npx vitest run tests/unit/markdownSourceMap.test.ts --maxWorkers=1` → `Tests 37 passed (37)`、exit 0（35 → 37）。
- **变异验证（真跑）**：把 `blockBody` 退回只剥一个换行 → `Tests 2 failed | 35 passed (37)`、exit 1，失败的正是新增的 2 项；还原后 `src/shared/document/markdownSourceMap.ts` SHA256 = `9D90967C5321AE26E90FCDDAB976FCD5899FA228FF11C234C2F089CD043E8486`，与变异前一致。

**(b) `aria-busy` 永久挂起（[P2]）**

- **症状**：一轮对话结束后转写区仍停在 `aria-busy="true"`，后续新增消息不再被播报。
- **成因**：`appendingMessageId` 只把 `completed / failed / cancelled` 当收尾，但 `src/shared/localAgentProjection.ts:94-101` 会把**除最后一个原生事件以外**的所有 `turn-ended` 降级成普通 `kind: 'session'` 事件（保留 `payload.status: 'turn-ended'`）。这种收尾不被识别，倒序扫描便越过本回合末尾继续往回找到更早的分片，把该消息报成"仍在追加"。
- **修复**：`src/renderer/ui/chat/CourseChatTranscript.tsx` 新增 `isTurnEnded(event)`，同时识别降级形态；原 `TURN_ENDED_KINDS` 保持不变。
- **实测**：`npx vitest run tests/unit/chatTranscriptAccessibility.test.tsx --maxWorkers=1` → `Tests 9 passed (9)`、exit 0（6 → 9）。新增 3 项：`failed`/`cancelled` 同样收尾（补上原实现**零 `failed` 覆盖**的缺口）、历史回合收尾后 busy 回落、历史回合收尾之后的新分片仍受 busy 保护。
- **变异验证（真跑，两个变异各自被杀）**：从 `TURN_ENDED_KINDS` 去掉 `'failed'` → `1 failed | 8 passed (9)`；把 `isTurnEnded` 主体换成 `return false` → `3 failed | 6 passed (9)`。两次还原后 `CourseChatTranscript.tsx` SHA256 = `5DE485A3C219964F6FA5F2A9FBF0F3F68524E236964CB1D8607277B86E4A625A`，与基线一致。
- **仍未验证**：本机无 NVDA／JAWS，**未经任何真实读屏工具验证**，本条只证明状态机正确。

**(c) 源文模式守卫跨会话代次卡死（[P2]）**

- **症状**：在源文模式里折叠光标（守卫按设计保留）之后按 **Ctrl+Z**，守卫永久留在 `flowSession.selection.documentSelectionIssue` 上，此后**每一次**选择作用域发送都被「Flow 源文选区暂不支持 AI 局部修改，请切回排版选择内容。」拒绝——而用户早已不在源文模式。
- **成因**：`FlowWorkspace.tsx` 的编辑器带 `key={…/${sessionToken.generation}}`（`:146`），代次递增会**重挂载**编辑器，重挂载不会回调 `onContextualTargetChange`，于是 `sourceRetirement` 永不递增；而退役 effect 的依赖数组只有 `[selection?.documentSelectionIssue, sourceRetirement]`，effect 不重跑。代次递增的真实路径是 Flow 撤销/重做：`flowAuthoringSlice.ts:931/:941`（撤销）与 `:952/:960`（重做）**总是**带上 `resourceTransition` 或 `sidecarDirection`，经 `editorStoreKernel.ts:179-202` 把 `token.generation + 1`。
- **修复**：把 `sessionToken.generation` 加入该 effect 的依赖数组。effect 在提交后运行，重挂载后的编辑器已在 DOM 中，因此 `sourceEditorMounted()` 的探针仍能正确区分"重挂载回源文模式"（保留守卫）与"回到排版"（清除守卫）。
- **实测（真跑）**：新增用例 `retires the source guard when a Flow history undo bumps the generation and remounts the editor`（`tests/unit/flowWorkspace.test.tsx:743-797`，位于 `describe('Flow source-mode guard lifetime')`）。它先经真实 Store 路径做一次 Flow 正文编辑（**必须在进入源文模式之前**做：在源文模式内编辑会递增 revision，触发 `SharedDocumentEditor` 的 revision effect 发布 `null`，从而走成"正常退役"路径，重挂载路径就永远不被覆盖），再进源文模式、折叠光标、然后发真实 `{ kind: 'document-history', direction: 'undo' }`——该意图经 `flowAuthoringSlice.ts:931-941` 带上 `sidecarDirection: 'undo'`，断言 `token.generation` 恰好 +1。`npx vitest run tests/unit/flowWorkspace.test.tsx --maxWorkers=1` → `Tests 18 passed (18)`、exit 0（17 → 18）。
- **变异验证（真跑）**：把依赖数组退回 `[selection?.documentSelectionIssue, sourceRetirement]` → `Tests 1 failed | 17 passed (18)`、exit 1，失败项正是新增用例（`expected 'Flow 源文选区暂不支持 AI 局部修改，请切回排版选择内容。' to be undefined`，`:795`），其余 17 项（含两条既有守卫用例）仍全过；还原后 `src/renderer/ui/FlowWorkspace.tsx` SHA256 = `6667F5988C84F94FD6840BE3D96C2555B97D647EB42AE3FEC97BB864DC82CEAD`，与变异前一致。
- **实测到的关键事实**：重挂载后编辑器**回到排版模式**，因此守卫**确实应当**退役——变异运行时"源文编辑器已消失"与"排版按钮在屏"两条断言**仍然通过**，只有守卫断言失败，这从两侧证明缺陷是"编辑器已回排版而守卫仍卡住"，而不是"重挂载后仍应保留守卫"。机制：测试 harness 不传 `documentDraft`，故 `SharedDocumentEditor.tsx:72` 的 `useState` 初值取 `'layout'`，且新实例的 `contextualTargetRef` 为空、永不回调 `onContextualTargetChange`。
- **仍未验证**：撤销是经 Store 意图触发的，**不是**在 CodeMirror DOM 上发真实 `Mod-z` 键事件（源文 keymap 把 `Mod-z` 路由到同一个 `onUndo` → `document-history` 意图，生成路径一致，但键事件本身未覆盖）；本机无法在无头环境里做真实 Electron 交互，**没有真实窗口证据**。该用例**刻意固定**了"今天重挂载回排版"这一事实，用例内已写中文注释说明：若将来重挂载带回 `sourceDraft`（恢复源文模式），正确行为会反转，届时须**有意重写期望**而不是把它"修绿"。

**(d) 本轮新增的回归测试**

| 文件 | 新增用例 | 鉴别力证据 |
| --- | --- | --- |
| `tests/unit/markdownSourceMap.test.ts` | 标题后接其他块 / 标题后接多个空行（2 项） | 退回"只剥一个换行"→ `2 failed \| 35 passed` |
| `tests/unit/chatTranscriptAccessibility.test.tsx` | `failed`·`cancelled` 收尾 / 历史回合收尾 / 收尾后新分片（3 项） | 去掉 `'failed'` → `1 failed \| 8 passed`；`isTurnEnded` 恒假 → `3 failed \| 6 passed` |
| `tests/unit/flowWorkspace.test.tsx` | 会话代次递增后守卫退役（1 项，`:743-797`） | 依赖数组退回旧值 → `1 failed \| 17 passed (18)`，仅新增用例失败 |

**(e) 本轮订正的文档指针**

第二轮新增的第九节 9.3 条目使正文交叉引用整体错位，本轮逐一核对并改正：`:82` 第 2 条→**第 3 条**、`:97` 第 5 条→**第 6 条**、`:110` 第 3 条→**第 7 条**、`:127` 第 6 条→**第 8 条**；`:112` 原指"第 11 条"而 9.3 只有 10 条，现补齐 9.3 第 11–13 条。第八节第 6 条末句"025 仍属环境阻塞"与第四节订正冲突，已就地改为"本轮未执行"。**改后 9.3 共 13 条，正文 10 处指针全部落在 1–13 内（逐处核对）。**

**(f) 仍未关闭**

- **[P0] 首次外部处理说明的引用清单不完整**（第二节第 2 条）：**结构性缺口本轮仍未修复**；调查已完成，结论与已就地改正的部分见**第十节**。第六节"不得声称载荷描述与真实载荷一致"的禁令继续有效。
- **[P0] 引用块软换行映射错位**（第二节第 3 条）：**本轮仍未修复**。
- **[P1] 32 MiB 导入上限与 12 MiB 传输上限矛盾**、**[P1] 课例作用域用量/删除在真实界面不可达**、**[P1] 040 六条用例未固定授权路由**：均**未修复**，禁令继续有效。

---

## 十、第四轮：外部处理说明引用清单的独立调查结论（2026-09-21）

调查产物 `output/r20-p0/report.md`（gitignored，不在候选内），本节的每条结构结论**均由本记录作者在源码上独立复核**，不转抄结论。

### 10.1 指控成立：清单在冻结之后仍被追加

**原始形态（HEAD `e39052fc` 上存在，当前工作树已修但未提交）**：渲染端 `src/renderer/ui/chat/externalAiReferences.ts`（现为已暂存删除 `D`）单方面从渲染端冻结的 `GenerationRequest` 推导清单，Main 之后注入的课例文档、材料片段与 `lesson-materials/...` base64 原件均不在清单内。当前工作树把计算搬到 Main（`service.ts:237-243`，共用 `withLessonGenerationContext`），渲染端改为向 Main 索取（`useExternalAiNotice.tsx:157`）并在空清单时 fail closed（`:159`）。定向测试 `npx vitest run tests/unit/externalAiReferences.test.ts tests/unit/externalReferencesOperation.test.ts --maxWorkers=1` → `Test Files 2 passed`、`Tests 6 passed`。

**收窄形态（当前工作树仍然存在，本轮未修复）**：harness 在清单算完之后**继续修改同一个请求**，追加四类资源，全部不在清单内。本节作者已在源码逐处复核：

| 追加内容 | 追加点（已复核） | 生成函数 |
|---|---|---|
| `pending-host-results.json` | `harness.ts:313`（首发）、`:381`（续轮） | `generationHostFeedback.ts:114-125` |
| `host-result.json` | `harness.ts:382`、`:401` | `generationHostFeedback.ts:129-137` |
| `observation/host-feedback.json` | `harness.ts:374` | `generationHostFeedback.ts:181-189` |
| `repair/component-changes-<requestId>/…` | `harness.ts:378`（`request = repairInputs.request`） | `generationRepairInputs.ts:26,45-46,55-59` |

**顺序（已复核）**：渲染端冻结请求 → `CourseChatPanel.tsx:123-124` 索取清单 → `service.ts:242` 经 `refreshLessonRequest`（`:229-233`）→ `withLessonGenerationContext` **清单定格** → 教师确认 → `service.ts:146`（首发）或 `:156`（续轮）**第二次独立展开** → `harness.ts:313`／`:374`／`:378`／`:381-382` **再次修改该请求** → `harness.ts:324` 提示词内联 resourceIndex、`:326` → `adapter.startTurn`。

**量化**：`pending-host-results.json` 装的是**原始** `AiHostResult[]`（`harness.ts:312` → `generationHostFeedback.ts:121`），其 `failure.behaviorEvidence` 走 `dynamicBehaviorEvidenceSchema`（`generationContract.ts:248` ← `authoringToolContract.ts:102`），帧 `dataUrl` 必须匹配 `^data:image/png;base64,`，单帧上限 24,000,000 字符、聚合上限 48,000,000（`dynamicBehaviorObservation.ts:9,43`），故该文件理论上可携带约 48 MB base64 PNG 帧。**未实测典型大小**（本轮未运行应用）。

**可达性**：`continue` 在**默认路径**上（`generationTaskController.ts:335-336` 置 `continuation = true` 回到 `:197-198`），且 `continue` 完全不经过对话框；`pending-host-results.json` 需 `receiptDelivery === 'pending'`（`harness.ts:311-312`），而回执只在 `startTurn` 成功后确认（`harness.ts:1103-1104`），故停止/崩溃/启动失败即留下 pending。

### 10.2 本轮就地改正（两处，均为真跑 + 变异验证）

1. **`service.ts:231` 的注释是假不变式**。原文写"so it can never describe a payload other than this one"——上表已证该断言为假。已改为如实描述：该展开描述的是**这个**载荷，但**不是最终载荷**，并逐条列出 harness 之后的四处追加点与"不要声称清单穷举"的告诫。**这是注释订正，不改变任何行为。**
2. **对话框不再断言穷举**。`useExternalAiNotice.tsx:278-279` 的区块标题与 `aria-label` 由「本轮实际引用」改为「**本轮显式引用**」，并在清单下新增一句："这份清单只列显式引用。为让任务连续执行，应用还会自动把上一阶段的宿主结果、组件修复输入等任务上下文文件放进 CLI 的工作目录，这些不逐条列出。"错误文案 `:107` 同步改为「没有读到本轮显式引用清单」（测试断言 `tests/unit/useExternalAiNotice.test.tsx:178` 同步）。
   - 新增守卫用例 `never presents the reference list as everything that is sent`（`tests/unit/useExternalAiNotice.test.tsx:184-195`）：`npx vitest run tests/unit/useExternalAiNotice.test.tsx --maxWorkers=1` → `Tests 11 passed (11)`（10→11）、exit 0。
   - **变异验证**：把 `aria-label` 与 `<h3>` 改回「本轮实际引用」→ `Tests 1 failed | 10 passed (11)`、exit 1，失败项正是该新用例（`Unable to find an accessible element with the role "region" and name "本轮显式引用"`，`:193`）；还原后 SHA256 = `20FDEEA300AB3AAF6A43CF2648CDBA2CFAB19D026BFDC1F566DD764ABC9E7548`，与变异前逐字节一致。
   - `npx tsc --noEmit` exit 0。

### 10.3 未修复的结构性缺陷（本轮**明确不做**，理由如下）

推荐的完整修复（调查产物 §5）是把 `withLessonGenerationContext`（`externalAiReferences.ts:21`）变成**唯一**最终请求冻结点：把上述四处追加从 harness 折进 service 的展开步骤，harness 端改为"已有则断言、缺失则抛错"的 fail closed；`external-references` 的 `conversation` 作用域补上续接身份以读到 pending 回执；`continue` 时对比最终请求资源清单与确认时清单，出现未见过的类别即拒绝该回合。

**本轮不做**，理由是它**无法在本批约束下被验证**：`pendingReceipts` 依赖 session，而 session 在 `startTurn` 内部才创建（`harness.ts:309`），因此冻结点前移需要重构 Main 的会话生命周期；本批硬禁 `npm run build`、禁 `npm run verify`，且本机无法做真实窗口/真实 CLI 交互，改完只有单元测试证据。在无法验证的情况下改动这段代码，**风险高于收益**，且可能把"清单不完整"换成更难发现的"发送被误拒"。

**因此本批的诚实边界是**：文案不再断言穷举（10.2），结构性缺口**如实登记为本轮未修复**。第六节"不得声称载荷描述与真实载荷一致"的禁令**继续有效**；在 10.3 完成前，**不得**声称外部处理说明的引用清单已完整。

**置信度分档**：10.1 的结构、顺序、调用链、字符串、删除状态均为**读代码确证**（含本节作者的独立复核）；执行验证只有 10.2 的两条 vitest 输出与一次 `tsc`。**未验证**：未运行应用或任何真实 CLI，未观察真实对话框与真实发送（可达性为静态推导）；未测量 `pending-host-results.json` 的实际大小；未验证 CLI 实践上是否真读该文件（但无论读不读，文件都落在 CLI 拥有的会话工作目录里，且其路径被写进提示词 `harness.ts:384`）。

### 10.4 附：本批在 `service.ts` 引入的换行符漂移（**已修**，并订正一条此前证据）

**事实**：改注释时发现 `git diff --check HEAD` **exit 2**，83 行被报为 trailing whitespace，全部在 `src/main/localAgent/service.ts`。逐字节测量（Node 读 `git cat-file blob HEAD:<path>` 与工作树，避免 PowerShell 重定向的换行改写）：

| 版本 | 字节 | CRLF | 裸 LF |
|---|---|---|---|
| HEAD `service.ts` | 21380 | 240 | 47 |
| 修复前工作树 | 23553 | 314 | 0 |
| 对照 `harness.ts`（本批未触碰） | 99676 | 0 | 1271 |

即 **HEAD 的 `service.ts` 本身是混合换行（240 CRLF + 47 裸 LF）**，仓库其余文件（如 `harness.ts`）是纯 LF；本批把这 47 行也变成了 CRLF。由于 `core.autocrlf=false` 且 `.gitattributes` 未覆盖该文件，git 按字节比较，新增的 CRLF 行即被 `--check` 判为 trailing whitespace。

**修复**：按"内容未变的行沿用 HEAD 的换行、本批新增/改动的行写 LF"重建该文件（LCS 对齐，只比内容不比换行）。结果：沿用 HEAD 换行 276 行、写为 LF 38 行，字节 23553 → 23470；**内容与修复前逐字节相同（除换行）已核验为 `True`**；`npx tsc --noEmit` exit 0；`npx vitest run tests/unit/externalReferencesOperation.test.ts tests/unit/externalAiNoticeRepository.test.ts tests/unit/useExternalAiNotice.test.tsx --maxWorkers=1` → `Test Files 3 passed`、`Tests 20 passed`、exit 0；**`git diff --check HEAD` → exit 0**；`git diff --ignore-cr-at-eol --stat HEAD -- src/main/localAgent/service.ts` → `1 file changed, 38 insertions(+), 11 deletions(-)`，与真实改动量一致。

**为什么这样修而不是全文件转 LF**：全文件转 LF 会让 240 行仅因换行而进入 diff，掩盖真实改动；沿用 HEAD 换行可让 diff 只显示真实改动，同时让 `--check` 通过。

**订正一条此前证据**：本节第九节与任务卡此前引用的"`git diff --check HEAD` exit 0"是在 `service.ts` 漂移**之前**取得的，**不能**用于描述漂移期间的工作树。现已修复并重新取得 exit 0。
