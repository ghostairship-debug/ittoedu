# 原方案复核事实与证据

日期：2026-10-10。核对基线 df21debdde2a86e7108a1af41b7aa4df62746b67，开始时云工作树 clean。Windows 本地未提交成果/发行件未取得，不能推断与云端相同。以下是方案依据，不是实施完成记录。

## 已复现的核心失效

### 文件原观察依据丢失

真实 DocumentSession/Gateway，受控交错，无 GUI：

1. Text 文档 r0/source=before；write(mode=replace) 或 patch 提供 r0 expectedVersion。
2. 原版本校验通过后，attachRunDocument 前，真实人工 Session.execute 把文档改为 HUMAN!（r1）。
3. commit 重新 attach/issueTarget 捕获 r1，旧 AI draft 被接受为 r2。
4. 回执 beforeVersion 为 r0，documentResult.beforeRevision 为 1；核心复现中人稿被覆盖。

定位：AgentFileText.ts:114–129、149–154；DocumentToolGateway.ts:569–575。原稿将其描述为未提供观察版本的静态风险，低估了问题。没有据此宣称真实用户历史稿已经损坏。

脚本：[verify-execution-file-race.ts](verify-execution-file-race.ts)。原执行用 /tmp 脚本和实际仓库绝对导入；包内只改为相对导入和 os.tmpdir，逻辑不变，副本未重新运行。

### 新运行回复串入旧消息

直接调用真实 ExecutionDesktopService.collectReply，使用内存 conversation store：

- initialMessageCount=2、本轮没有 assistant 时，上一轮“已修改完成”落为本轮 runId 的回答。
- 带 tool_calls 的“正在修改，请稍等”被取为回答。
- finishReason=length 的截断文字落为普通答复。

定位：ExecutionDesktopService.ts:845–869；ExecutionEngine.ts:915、945–948。证明消费者算法，不是 GUI/provider 端到端。

脚本：[verify-execution-reply.ts](verify-execution-reply.ts)。包内仅改导入路径，未重新执行。旧脚本输出失效行为，不是修复后通过断言。

在仓库根用实际已安装 tsx 可执行：

- node --import tsx docs/development-plan/20261010-workbench-consolidated/evidence/verify-execution-file-race.ts
- node --import tsx docs/development-plan/20261010-workbench-consolidated/evidence/verify-execution-reply.ts

仅使用自身新建临时目录/内存消息，不指向用户稿。缺依赖先记录，不为文档核对安装/重建。修复后文件脚本遇到正确冲突可能异常退出；应在正式回归测试中验证人稿/映射，不用旧脚本 exit0 签收。

## 已核对的源码行为

| 主题 | 当前证据与影响 | 归属 |
|---|---|---|
| 同文档多卡 | EditSessionService:46/96 按文档单 editId，EditPreviewProjection:8/43/72 单快照；只改锁不足 | W1.2 |
| 卡跨空间 | elementCardController:337/371–378 使用全局 workspace，旧卡追问可转到新空间 | W2.2 |
| 当前稿确认 | 两通道直接 answer，Engine仅解等待；userQuestion缺作品范围；Session drain不提交 renderer草稿 | W2.4 |
| Mermaid/粘贴 | mermaidCodeBlockView:18–21/107–110误拦换行/注释；editorSession:233–243实际围栏粘贴缺口，349资源取消静默 | W2.4 |
| 卡事件 | elementCardController:551–587 每事件追赶/全历史刷新、无迟到保护；风险未量化 UI性能 | W2.3 |
| 会话组织 | conversations:50–59 home 已是空间内分类；真正断点是 DesktopService:405–443与Assistant:725–727的默认目标耦合 | W2.1 |
| 文本目标 | ToolTargets:322 定性 replace-text；courseInstanceEdits:20拒绝范围属性；text/data:91现有范围格式已供人工调用；富文本替换不是完全不能格式化 | W1.1 |
| 能力投射 | ToolCatalog:210八族默认可见，load无增量；已有发现/刷新链可复用 | W1.4 |
| 资源 | AssetSourceTools:64、Gateway:1398–1400、provideImage:785三层原生可写工程耦合 | W4.2 |
| 文件授权 | Engine:1802/1811/2050及续作879漏 boundPaths；Host233–238有精确集合；Office预检受影响，不能机械放开父目录 | W4.1 |
| 默认目录 | AgentFileService:21 mkdir/create跟 home，read/write和HostArtifactDeliveryService:106跟 workspace | W4.1 |
| 保存 | Gateway:1708 project.save已转发file.save，不是第二 writer；默认导出不是错误保存别名 | W4.1 |
| 自然结束 | executionExitDecision:368仅pending/unknown继续，已知失败允许partial；task.finish门/提前break确实存在 | W1.3 |
| 停止 | Engine stop/finally和Gateway.stop有撤权/屏障，没有普遍失效证据 | W1.2 |
| 导航 | 现场保留/当前页reset已有；画布scene.previous/next绕过step，编辑态interactive=false需接线 | W2.5 |
| 原生装配 | p normal line-height/figcaption等窄门，sourceScopes不必要body保留应从实际画面/可编辑性核对；固定自由frame是可用基础 | W3 |
| MCP | enabled:true，默认权限已同源workspace，Bearer门存在；configure只影响新连接；前台读取集合与file路径不一致 | W4.4 |
| MCP旧设置 | ResidentMcpSettings.load旧enabled覆盖新默认，不能只改常量 | W4.4 |

前台额外读取、迟到刷新等按源码差异/风险报告，未称为已运行利用。full 的真实空间外读写由用户确认保留，不暗中加禁止或开通审批。

## 验证边界与材料身份

审查未修改产品代码、运行付费模型或发行。个别辅助检查因监听 EPERM、缺 pdf-lib/Mermaid 依赖未完成，不计通过，也不直接算产品行为缺陷；未重复全量测试。Portable 实物、Windows运行与安全日志未取得，详见包内专项报告。

原 GPT Pro 原文完整留存，SHA-256：
01a6323e47ee93018f9d814718eced18b2440419e17cb59c0e55879dbaf7c2c7。
原稿自称“已定”不自动等于用户决定；执行以 EXECUTION_PLAN 为准，原文不作启动必读。
