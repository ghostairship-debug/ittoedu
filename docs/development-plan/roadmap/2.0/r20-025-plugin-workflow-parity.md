# r20-025-plugin-workflow-parity：实测原生能力与课件质量对等并关闭GUI引入的差距

- Release: 2.0
- Dependencies: `r20-020-public-authoring`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls`
- Optional: 否
- Write locks: `chat-ui`, `cli-adapters`, `workspace-shell`
- Gaps: G01–G12（定义与当前证据见下方“差距清单（G01–G12）”；原始诊断基线见[缺口记录](../../reviews/1.8-ai-assistant-gap-register.md)）

## 结果与现状

通过已有有效外部基线与有限新增实测，核对软件中的原生CLI能力和课件成品质量没有因GUI包装下降，并关闭实际差距。Codex/Claude的真实VS Code插件比较保留，OpenCode按自身原生CLI能力比较，不把三家压成最小交集。

外部CLI/插件是开发对照，不进入教师创作路径。2.0的材料、设计、生成、检查修复和导出都须通过软件完成，不能由外部Agent先做成品或追加检查补齐内部流程。官方文档/协议可行性和按钮相似不能代替真实能力与质量结果。

## 差距清单（G01–G12）

本表是 G01–G12 的唯一正式定义：编号沿用[缺口记录](../../reviews/1.8-ai-assistant-gap-register.md) `:17-28` 的 2026-09-07 诊断基线（“缺口与用户影响”列即该表原意），状态按**当前源码与实跑证据**给出。关闭状态只用下列四态，不得含糊：

- **关闭**：缺口要求的行为在本候选上有可复现证据（含真实模型/真实课例部分）。
- **部分关闭**：宿主侧实现与命名用例已存在，但缺本候选上的真实运行证据，或只在部分适配器/表面成立。
- **未关闭**：无证据，或已知缺陷仍在。
- **环境阻塞**：本机不具备所需条件，非工程质量问题。

2026-09-21 本机重跑（`npx --no-install vitest run` 12 个命名文件 `--maxWorkers=1`，8 文件/68 项 + 4 文件/75 项，两次均 exit 0）只覆盖宿主侧；**受 `R20_MARKDOWN_SELECTION_LUNA_RUN`／`R20_FLOW_SELECTION_LUNA_RUN` 门控的真实选区用例在本候选上未运行**，因此本表没有任何一项可以记为“关闭”。

| ID | 缺口与用户影响 | 当前证据 | 状态 |
| --- | --- | --- | --- |
| G01 | 图片只提供元数据，AI 看不到当前图像，反过来要求教师提供工程内已有原图 | 观察保留可解码原图字节并以派生 PNG 作为视觉附件（`src/renderer/authoring/generation/observationImageResources.ts:4-26`，含 6 个诊断码）；Codex `input.image:'supported'`（`src/main/localAgent/codexAppServer.ts:240-246`）、Claude 能力表（`src/main/localAgent/claudeProcessTransport.ts:79-99`）；`tests/unit/observationImageResources.test.ts` 4 项、`tests/unit/generationSnapshotImageDiagnostics.test.ts` 4 项、`tests/unit/generationSnapshotCanvas.test.ts` 8 项（含“preserves canvas through strict IPC, actual Main storage, candidate request and codex prompt”）通过 | 部分关闭：宿主侧已实现并有命名用例；真实模型是否据此识别颜色未在本候选运行 |
| G02 | 图片改色没有从读取、处理、导入到替换的完整路径 | 正式工具 `asset.image.transform` 只替换 update 目标实例、保留未选共享实例与源资产，静态 8 位 PNG／JPEG／WebP、容差 32、最近邻且 ≤16M 像素（`src/renderer/authoring/tools/imageTransformTool.ts:13-15`）；`tests/unit/imageTransform.test.ts` 16 项、`tests/unit/imageTransformTool.test.ts` 14 项（`describe('image transform single-instance resource transaction')`）通过 | 部分关闭：撤销／保存重开／运行／导出的真实流程证据未在本候选取得 |
| G03 | 选区替换缺少创建目标，无法完成依赖新资源/新载体的修改 | 选区范围提供正式创建目的地（`src/renderer/authoring/generation/generationSnapshot.ts:121-126`），范围解析 fail-closed 且只在 `scope==='selection'` 消费 Flow 选区（同文件 `:81-89`）；`selectionActions` 含 `insert-image-after`（同文件 `:159-160`）；`tests/unit/courseChatObservation.test.ts` 36 项、`tests/unit/generationSnapshotFocus.test.ts` 8 项、`tests/unit/generationSnapshotPreflight.test.ts` 3 项通过 | 部分关闭：真实“选区→创建→单一事务替换”模型链未在本候选运行 |
| G04 | 模型发现、选择、推理强度没有完整接入 | 三个适配器各自返回真实模型/强度，UI 由能力生成（`src/renderer/ui/chat/NativeAgentConfiguration.tsx`，`tests/unit/nativeAgentConfiguration.test.tsx` 13 项通过）；OpenCode 对图像与强度仍报 `unknown`，且只对当前选中模型暴露 effort（`src/main/localAgent/openCodeAcp.ts:86-145`、`:121-125`） | 部分关闭：Codex／Claude 选项来自实际能力；OpenCode 的 `unknown-auth` 与未报告强度按“未知”显示，缺口要求中的“保留有效选择”未在真实会话复核 |
| G05 | 可读进度被过滤，原生事件以 JSON 展示，完成与修改成功混淆 | 中文原因映射与可见文本分层（`src/shared/localAgentText.ts:15-31`、`:49-67`、`:70-96`）；`tests/unit/courseChatObservation.test.ts` 36 项覆盖宿主事件到可读消息 | 未关闭：没有本候选上的真实会话证据证明流式正文/摘要/工具进度/失败原因清楚，也没有证据证明“只有提交成功显示已修改”在真实 CLI 上成立 |
| G06 | 讨论和修改只有内部 auto 分流，用户无明确模式 | 发送时按范围与意图分流 `expectedResult`（`src/renderer/ui/chat/CourseChatPanel.tsx:376`）；命名 E2E `tests/e2e/stabilizationCoreUsability.spec.ts:855`“S3 默认可见与普通讨论：安全消息、完整历史及零工程写入” | 未关闭：该命名用例属 `S3 真实*` 组，本候选未运行；“模式始终可见”的界面证据未取得 |
| G07 | 能力说明过量且不支持真正按需发现 | 能力按需发现与分片暂存已有实现（`src/main/localAgent/capabilityWorkspace.ts`、`capabilityCache.ts`）；`tests/unit/generationCapabilityWorkspace.test.ts` 28 项通过，含“discovers a compact file transport while keeping the strict document schema available on demand”“reads exact staged image, source, skill and query paths from one request anchor without changing the native cwd”；能力索引 16275 字节（上限 16384，`npm run check:ai-capabilities` exit 0） | 部分关闭：按需读取路径有命名用例；缺口要求的“记录等待各阶段和 token”未落地——计时只有埋点没有消费者（[验收记录](../../reviews/2026-09-21-r20-contextual-acceptance.md) 第三节“020 的标准整课 ≤30 分钟目标未验证”条目） |
| G08 | 候选格式、范围失败导致多轮完成但零修改 | 只允许一次修复预算且失败零写：`tests/e2e/stabilizationCoreUsability.spec.ts:809`“S3 候选格式：非法JSON与缺通道共用一次修复预算”、`:835` 提示原文；错误原因映射 `src/shared/localAgentText.ts:15-31` | 未关闭：命名用例本候选未运行；原始失败（OpenCode stale／candidateId 缺失或非 UUID）无当前复测 |
| G09 | 缺乏基于当前视觉/运行结果的编辑自检闭环 | 观察含实际画面与运行状态入口：`observationImageResources.ts`（含 `image-rasterization-failed` 诊断码）、`runtimeDomControlObservation.ts`、`currentHostMotionObservation.ts`；`tests/unit/generationCapabilityWorkspace.test.ts` 中“returns continuous host frames as immutable files with timing and source identity, without claiming semantic success”通过 | 部分关闭：宿主提供画面/运行观察且明确不冒充语义成功；缺口要求的“提交后验证真实目标达成”无真实模型证据 |
| G10 | 现有测试不能证明自然语言产品能力 | 真实自然语言用例存在但受门控：`tests/e2e/r20MarkdownSelectionAiLuna.spec.ts`、`r20FlowSelectionAiLuna.spec.ts`（`R20_*_LUNA_RUN`）；040 的 9 条命名真实用例中 6 条未固定授权模型路由（[验收记录](../../reviews/2026-09-21-r20-contextual-acceptance.md) 第二节“040 最终门 9 条命名真实用例中 6 条未固定授权模型路由”条目） | 未关闭：本候选未运行任何真实自然语言选区用例；未固定路由的通过也不能证明授权路由 |
| G11 | Flow 编辑/试运行/预览及教师控制器仍有可见问题，影响 AI 对结果的判断 | `tests/e2e/r18-089-flow-viewport.spec.ts:214-225` 的 `expectStableController` 断言 `maximumShift < 0.5`；旧 `:677 maximumShift 36` 登记已由[第三轮订正](../../reviews/2026-09-19-r19-round3-fixes-and-ledger-correction.md) `:216-242` 关闭（行号偏移误读，当前对应非付费用例为绿） | 未关闭：最近证据属 1.9 候选，本候选未重跑该文件；真实 AI 门 `:841/843` 默认 skip |
| G12 | 外部Build Skill没有与创作助手共用可查询、可分片的发现机制，冷启动与引用材料读取过重 | 单一能力源同时服务助手与 Builder：`src/shared/courseAgentSkills.ts:37-43` 的 10 个方法经 `src/shared/generated/courseAgentCapabilities.json`（`skills/` 前缀 20 个文件、semanticVersion 为 64 位 sha256）暂存到 `<userData>/local-agent/directory-conversation-skills/<sha256>/`（`src/main/localAgent/directoryConversationSkillResources.ts:14-30`），入口只列绝对路径按需读取；`tests/unit/directoryConversationSkillResources.test.ts` 2 项、`tests/unit/coursewareSkillsContract.test.ts` 7 项通过 | 部分关闭：同源与按需读取已实现；缺口要求的“真实外部课例构建验证”未在本候选运行；`.agents` 运行时读取的 4 个方法文件已进打包清单（`electron-builder.yml`，守卫 `tests/unit/packagedRuntimeBoundary.test.ts`），但打包产物本身未构建验证（[验收记录](../../reviews/2026-09-21-r20-contextual-acceptance.md) 第三节“021 完整方法未迁入”条目订正段、第九节 9.1(a)） |

**本机对照条件与执行状态（2026-09-21 复核订正）**：原写"`code` 在 PATH 上指向 Cursor 3.20.21，已装扩展只有 `anysphere.*` 四个，真实 VS Code 插件对照无法执行"——**该判据不成立**。实测：`where.exe code` 有 4 条，第 3/4 条即真实 VS Code `D:\Users\74755\AppData\Local\Programs\Microsoft VS Code\bin\code(.cmd)`；以绝对路径调用其 CLI，`code --version` → **1.133.0**，`code --list-extensions` → exit 0 且列出 **`anthropic.claude-code`** 与 **`openai.chatgpt`**，即对照所需的**两家插件都已安装**。原判据误把默认 PATH 首项当成"本机唯一的 `code`"，并把 `~\.cursor\extensions` 当成了 VS Code 的扩展目录。**订正后的准确状态：025 对照本轮未执行**（需交互式 GUI 会话与跨多个课例任务的付费模型运行，超出本批范围），**不是缺 VS Code**；两个扩展的**登录状态未知**（`%APPDATA%\Code\User\globalStorage` 下无 anthropic/openai 状态目录，但凭据在加密存储中，不能据此断定未登录）。按"停止条件"一节，此处只记录未完成的对照，**不得把无证据写成通过**。OpenCode 通道探测为 `unknown-auth`（[验收记录](../../reviews/2026-09-21-r20-contextual-acceptance.md) 第三节“040 的 opencode 通道探测为 `unknown-auth`”条目），其登录状态不可确认。

## 开始前与阅读入口

核对[产品方案第3/8节](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)、[开发计划第6节](../../AI_ASSISTANT_DELIVERY_PLAN.md)、[对标评估T01–T12](../../AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md)、[工作协议](../../WORKING_PROTOCOL.md)与[共同实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)。088/103/1.9和020–022未失效的实际证据先复用。

- [adapter.ts](../../../../src/main/localAgent/adapter.ts)、[process.ts](../../../../src/main/localAgent/process.ts)、[profile.ts](../../../../src/main/localAgent/profile.ts)：有效配置、工作目录/环境与产品Skill组合。
- [codexAppServer.ts](../../../../src/main/localAgent/codexAppServer.ts)、[claudeProcessTransport.ts](../../../../src/main/localAgent/claudeProcessTransport.ts)、[openCodeAcp.ts](../../../../src/main/localAgent/openCodeAcp.ts)：原生能力与授权/工具/子任务事件。
- [harness.ts](../../../../src/main/localAgent/harness.ts)、[CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)：GUI请求/回答、连续任务与真实结果。
- [generationSnapshot.ts](../../../../src/renderer/authoring/generation/generationSnapshot.ts)、[courseAgentSkills.ts](../../../../src/shared/courseAgentSkills.ts)：当前工程观察与实际加载方法。

## 允许写域与旧路径退出

有限对照驱动、实际证据及Chat/adapter/workspace内已定位缺口修复；材料、Skill内容、事务/宿主缺陷回020–022或相应Owner取得锁。不建立评分平台、不增加全量重复矩阵、不修改样本或成功标准消除失败。

## 执行步骤

1. 按[AI编辑最短路径统一方案](../../../../AI编辑最短路径产品决策报告.md)冻结可比CLI/插件版本、原生已确认模型/强度、实际服务档与有效配置、材料/目标、工作上下文、预算和计时起终点；auto/preview、冷启动/连续会话分开。先列哪些既有外部结果仍有效，仅对配置/能力/工作流变化补真实对照；没有可比历史证据时取得有限新样本，不能假定同模型自然等质。
2. 分开核对能力与成品质量。能力检查实际文件/终端/网络、用户已有工具连接、原生Skills/子任务、问题与授权允许/拒绝/取消、纠正/停止及原生上下文恢复；GUI保留其有效授权，不默默提权。空配置数组或本地对象字段不能证明真实原生能力。
3. 质量检查使用020的代表性Native、动态机制或整课课例，精确修改与复杂编辑分别比较，不以一类成功代替另一类。采用相同允许范围与必要检查，核对材料准确、知识获得路径、教学推进、视觉/图示可读、实际互动、可编辑、保存重开及导出。查明内置是否因少给材料、方法、工具或修正机会而变差；不要求随机模型产物逐字/逐像素一致。
4. Codex与Claude实际对应插件的适用工作流保留双方结果；OpenCode使用其原生CLI。GUI不必复制IDE专有Git/worktree/云面板，但不能据此裁剪CLI已配置的工具或MCP连接。当前工程观察的结构/画面/运行优势须有实际输入和结果，不能仅靠文档宣称。
5. 记录双方真实步骤、有效配置、首次正确可用结果、全任务终态、失败与已知阶段耗时，明确用户等待单列。只分离实际可观测的宿主/原生边界，不能进一步分离的服务、网络和推理区间保持未知；不由token计数换算耗时，不累加并行跨度。小样本报告原始值与中位数，不以未经批准的百分比阈值推断瓶颈或对等。外部操作只用于开发对照；内部课例完全从软件入口开始并在软件内检查、修复、交付。
6. 差距按当前可用性与实际成品影响排序，回原Owner修复后只复核受影响项。不能平均总分掩盖核心失败，也不能换模型、加外部人工补救或删除失败样本冒充对等。

## 验收与可信反例

- 适用于课件的既定基线有真实可比证据，GUI不产生原生能力/控制缺口；同等条件下没有因内置工作流造成的系统性成品质量下降。
- 020内部全流程独立完成，外部Agent不是教师的生成、检查或修复前置。三家供应商本身的差异和未提供能力准确显示。
- 仅比按钮/提示长度、只引用官方资料、拿其他产品代替指定插件、未确认实际配置、外部AI预制成品、平均分遮盖失败，均不能称对等达标。

## 停止条件

缺少真实插件或可比配置时明确未完成的对照，其他内部功能继续验证；不能把无证据写成通过。有限对照已足以定位或证明结果时停止，未经相关变化不继续重复付费调用。

## 聚焦验证

准备与证据复用统一遵循[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)。相关产物准备一次后，按发生差异的adapter直接选择目标测试，UI路由变化再补命名E2E；测试模拟不替代真实原生行为和课例质量。下列明确列出当前聊天/源码的三CLI用例组，仅在该组受影响或缺证据时运行；其他主题按实际名称选择，禁止无选择地整文件执行。新增用例先随实现创建，再列入FILE与--grep，零匹配不得通过。

```text
npx --no-install vitest run tests/unit/codexAppServer.test.ts tests/unit/claudeProcessTransport.test.ts tests/unit/openCodeAcp.test.ts tests/unit/coursewareSkillsContract.test.ts
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep "S3 (真实聊天：(codex|claude|opencode) 生成候选、继续修改、单次撤销与保存|真实组件源码：(codex|claude|opencode) 读取既有包并连续修订)$"
```

实际Codex/Claude插件与本产品的适用比较保留为开发门，未变项复用已有证据；OpenCode实际差异按其原生支持记录。上述命名自动化不替代既定T01–T12、真实插件比较与课例质量范围；只有受影响项按原成功标准补证，不给每项新功能重建三CLI完整矩阵。040直接消费这里未失效的结果，不因进入最终门重复付费对照。

## 回退与交接

交付有效外部基线、内部独立完成证据、配置差异和已关闭/未关闭缺口，供030/040/S4使用。不得把开发对照步骤写进教师日常操作说明。
