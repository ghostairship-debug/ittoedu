# S3 可用 AI 创作与 Builder 验收

状态：**未签署**。签署点为 1.8 后的 [`r18-060-release`](../roadmap/1.8/r18-060-release.md)（该规格 `:1` 标题即“Owner验收S3可用AI创作与Builder并发布v1.8.0 accepted源码标签”）；按[工作协议](../WORKING_PROTOCOL.md) `:75`，无后缀 `vX.Y.Z` 只在 1.3 后 S1、1.5 后 S2、1.8 后 S3、2.0 的 S4 四个签署点写入。截至 2026-09-21，本清单未在签署点按步执行，[S3 复核入口](../reviews/1.8-S3-review.md) `:64` 记录“Owner 结论：**尚未提供**”，`git tag --list` 中也没有 `v1.8.0`／`v1.8.0-rc.1`（该区间只有 `v1.6.0-rc.1` 与 `v1.9.0-rc.1`）。[开发计划](../AI_ASSISTANT_DELIVERY_PLAN.md) `:7` 另记录 2026-09-15 Owner 明确“1.8 S3 可以通过，主线转入 1.9–2.0”，并同时声明“本次不变更正式 DAG 或发布标签，以下有日期的 S3 待验描述保留为历史时点记录”。本清单据此只作签署点待执行清单，**不预填通过**。

真实自动化最多证明 `engineering candidate`；本清单的“通过”只能来自 Owner 在真实应用内对固定课例的视觉、互动与课件质量复核（[工作协议](../WORKING_PROTOCOL.md) `:75`）。下表“判据”栏只写可判定的条件，其中带 `file:line` 的条目是工程侧可复现依据，不等于该步已在本候选上运行。

## 可直接检查的文件

固定产物见 [S3 复核入口](../reviews/1.8-S3-review.md) `:50` 起的表格：三页分数课、分数探索组件、连续振动 Runtime、配方页、目录朗读组件各自的 `.h5lesson` 与离线 `.html`。这些是本机工程验证样例，不是对外发布物，也不代替教师确认教学文档；其原始制品在 `output/` 下（被 `.gitignore:10` 忽略），不在提交内。

## 教师复核

| 步骤 | 操作与预期结果 | 通过／不通过判据 | 签署 |
| --- | --- | --- | --- |
| 1 | 打开设置中的原生 CLI 区，分别查看 Codex／Claude／OpenCode 的实际可执行路径、版本与认证状态。缺失或未登录时应给出下一步动作，且人工编辑、保存、Player 与导出不受影响。 | 探测结果与 `src/shared/localAgentContract.ts:57-61` 的状态枚举一致：Codex 要求 `major===0 && minor>=153`（`src/main/localAgent/codexAppServer.ts:476-486`）、Claude 要求主版本 2 且 `auth status` JSON `loggedIn===true`（`src/main/localAgent/claudeProcessTransport.ts:261-288`）、OpenCode 要求主版本 1 且认证可为 `unknown-auth`（`src/main/localAgent/openCodeAcp.ts:214-230`）。不通过：把 `unknown-auth` 写成已登录，或 CLI 缺失导致人工功能不可用。 | 未执行 |
| 2 | 在同一会话先问一个不涉及修改的问题，再发一条明确的修改指令。讨论不得产生工程修改、候选或历史；修改请求必须以已应用、待应用或明确失败结束。 | 发送时的目标分流与 `expectedResult` 一致（`src/renderer/ui/chat/CourseChatPanel.tsx:376`）；可见文本不把“准备”说成“已修改”（`src/shared/localAgentText.ts:49-67`）。`tests/e2e/stabilizationCoreUsability.spec.ts:855` 的“S3 默认可见与普通讨论：安全消息、完整历史及零工程写入”是命名用例。不通过：讨论被当成修改，或失败后工程仍被写入。 | 未执行 |
| 3 | 选中工程内已有图片，要求“把颜色改成绿色”一类修改。AI 应直接看到原图内容，不要求教师重新上传或另存副本。 | 观察保留可解码原图字节、SVG 以派生 PNG 作为视觉附件（`src/renderer/authoring/generation/observationImageResources.ts:4-26`）；Codex 能力表 `input.image:'supported'`（`src/main/localAgent/codexAppServer.ts:240-246`）、Claude 能力表（`src/main/localAgent/claudeProcessTransport.ts:79-99`）与实际一致。不通过：只给 assetId／尺寸／路径等元数据就要求教师补图。 | 未执行 |
| 4 | 对第 3 步的图片执行改色／裁剪／缩放。结果应实际应用，一次 Undo 恢复，保存重开与离线 HTML 呈现一致。 | 变换只替换 update 目标实例、保留未选共享实例与源资产（`src/renderer/authoring/tools/imageTransformTool.ts:13-15`，静态 8 位 PNG／JPEG／WebP，容差 32，最近邻且 ≤16M 像素）；`tests/unit/imageTransform.test.ts`、`tests/unit/imageTransformTool.test.ts:75` 覆盖容差、区域、非法输入与单实例资源事务。不通过：以纯色遮盖或替换 base64 冒充图片编辑。 | 未执行 |
| 5 | 对当前选择发起一次需要新素材或替代载体的修改。应在明确范围内创建并一次事务替换，教师无需先手工建资源。 | 选区范围提供正式创建目的地（`src/renderer/authoring/generation/generationSnapshot.ts:121-126`），范围解析 fail-closed（同文件 `:81-89`，仅在 `scope==='selection'` 时消费 Flow 选区）；`tests/unit/flowContextSelection.test.ts`、`tests/unit/courseChatObservation.test.ts` 为命名用例。不通过：模型猜测 ID，或要求教师手工先建目标。 | 未执行 |
| 6 | 构造一次非法候选（格式错误或缺结果通道）。应给出可读中文诊断、只允许一次修复预算，失败后工程零写入。 | `tests/e2e/stabilizationCoreUsability.spec.ts:809` 的“S3 候选格式：非法JSON与缺通道共用一次修复预算”与同文件 `:835` 的提示原文；错误原因映射见 `src/shared/localAgentText.ts:15-31`。不通过：重复无进展失败，或失败后留下部分写入。 | 未执行 |
| 7 | 在设置中查看模型与推理强度选项。选项应由适配器实际返回生成，未报告的能力保持“未知”，不得伪造不支持项。 | OpenCode 对图像与强度报 `unknown`，且只对当前选中模型暴露 effort（`src/main/localAgent/openCodeAcp.ts:86-145`）；能力 schema 见 `src/shared/localAgentContract.ts:66-90`。不通过：界面把 `unknown` 显示为支持，或展示适配器未返回的模型。 | 未执行 |
| 8 | 触发一次课件任务，确认三个适配器收到同一套内置方法，且候选仍经宿主事务提交。 | `tests/unit/coursewareSkillsContract.test.ts:11-39`：三适配器 Skill 一致、结果通道为 `app-server-json-schema`／`session-staging-file`、`courseAgentSkills` 7 项、路径为绝对路径、`liveProjectTools === false`，`createGenerationProfile('claude', request, 'live-mcp')` 抛“未开放”。不通过：按适配器裁剪方法集，或把候选通道说成可直接写工程。 | 未执行 |
| 9 | 在外部课例目录用 Builder 构建一次（教师不提供编辑器仓库）。应自主定位产品与能力索引，冷启动只读入口，参考资料按需读取。 | 仓库 Skill 为权威源：`.agents/skills/**` 16 个文件（`orchestrate-courseware`、`build-courseware-project` 及其引用）；`artifacts/ai-capabilities/index.json` 16275 字节（`npm run check:ai-capabilities` 上限 16384）。不通过：把外部 Builder 写成教师日常必经步骤，或要求教师切换到编辑器仓库。 | 未执行 |
| 10 | 在 Flow 的编辑、试运行与预览中检查教师控制器：三种模式下应可达且稳定，正文与浮层尺度语义一致。 | `tests/e2e/r18-089-flow-viewport.spec.ts:214-225` 的 `expectStableController` 断言 `maximumShift < 0.5`；同文件 `:841/843` 的真实 AI 门（`FLOW_REAL_AI`／`FLOW_AI_VERIFY_EXISTING`）默认 skip，未跑不得读作通过。不通过：控制器被祖先裁剪，或只在单一窗口宽度下可达。 | 未执行 |
| 11 | 在真实应用内完成一次“聊天 → 候选预览 → 应用 → Stop → 继续修改 → 人工并发提示”，再在编辑器内改一段文字或一个参数、撤销/重做、保存重开、播放与适用导出。 | 只用 [S3 复核入口](../reviews/1.8-S3-review.md) `:52` 起列出的五个可检查产物；通过与否只能由 Owner 观察真实视觉与互动给出。不通过：用自动化结果、截图或“对象零跳过”代替教师结论。 | 未执行 |

## 明示边界

- 本文件在 2026-09-21 作为签署点待执行清单创建。**创建本身不是 S3 通过**，也不表示上表任何一步已在本候选上运行；未执行的步骤一律不得读作已通过。
- 025 对照的执行状态（**2026-09-21 复核订正**）：原写"本机 `code` 指向 Cursor 3.20.21 而非 VS Code，已装扩展只有 `anysphere.*` 四个，因此 Codex／Claude 的真实插件对照在本机无法执行"——**该判据不成立**。实测 `where.exe code` 返回 4 条，第 3/4 条即真实 VS Code `D:\Users\74755\AppData\Local\Programs\Microsoft VS Code\bin\code(.cmd)`；以绝对路径调用其 CLI，`code --version` → 1.133.0，`code --list-extensions` → exit 0 且列出 `anthropic.claude-code` 与 `openai.chatgpt`，即**对照所需的两家插件都已安装**。原判据误把默认 PATH 首项当成本机唯一的 `code`，并把 `~\.cursor\extensions` 当成了 VS Code 的扩展目录。**订正后：该对照本轮未执行**（需交互式 GUI 会话与跨多个课例任务的付费模型运行，超出本批范围），**不是环境阻塞**；两个扩展的登录状态未知。仍须按"只记录未完成对照、不得把无证据写成通过"处理（[当前验收记录](../reviews/2026-09-21-r20-contextual-acceptance.md) 第四节）。
- 已声明未验边界：[S3 复核入口](../reviews/1.8-S3-review.md) `:64` 记录物理触控/触控板、Word 实际呈现、Spatial local API3 及已声明兼容边界仍须与教师结论一并评估；CLI 本轮成功不代表未来模型候选永不失败。
- 与本清单相关的自动化在候选上的真实状态见[当前验收记录](../reviews/2026-09-21-r20-contextual-acceptance.md) 第一节：**`npm test` 全量已在当前工作树实测转绿**（`npx vitest run --maxWorkers=2` → `Test Files 461 passed (461)`、`Tests 4438 passed | 3 skipped (4441)`、exit 0）；此前记录的"为红、失败集随负载浮动"是**并发负载下的抖动**，不得据此推断自动化门不可通过，也不得把这一次绿读作"所有门已全绿"——`check:legacy-ready`／`check:legacy-zero` 仍硬失败，`npm run verify` 本体未跑。
