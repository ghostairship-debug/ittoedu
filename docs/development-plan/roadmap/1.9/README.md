# 1.9：内部 AI 工作台（默认隐藏）

## 结果与边界

内部用户可以在编辑器内看到 Chat、CLI 运行状态和工具时间线，引用当前选择 / 当前页 / 整课 / 材料，停止运行，并把成功 AI 写入作为一个产品事务撤销。消息使用安全 Markdown / 公式渲染，原始 HTML 和脚本不执行。

会话在应用重启后可恢复，并可按会话、当前工程或全部应用记录删除。应用只承诺删除自己保存的记录，不能声称同步删除 CLI 自身历史。Save As 不复制原工程会话。

AI 入口默认隐藏。本版只形成 `v1.9.0-rc.N` engineering candidate 源码标签，不发布 HTML 或安装器；Owner accepted 在 S4（2.0）统一签署。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r19-000-chat-shell` | 内部 Chat shell 显示会话、输入、运行状态和 adapter 身份 | `r18-060-release` | 否 | `chat-ui` | 内部开关下可新建 / 切换会话并选择三种 adapter；idle / starting / running / stopping / completed / failed 状态与会话状态机一致；普通构建无入口；Chat 崩溃或关闭不影响画布、保存和 Player |
| `r19-010-context-references` | 消息可显式引用当前选择、当前页、整课和材料 | `r19-000-chat-shell`, `r18-010-context-read-tools` | 否 | `chat-ui`, `mcp-server` | 四种引用在发送前显示名称、范围和 revision；发送 payload 只含已勾选引用；选择变化不暗改已发送消息；跨工程 / 已删除材料引用拒绝；不按材料类型阻止用户发送 |
| `r19-020-tool-timeline` | 时间线按序显示 text、tool call / result、receipt、usage 与终态 | `r19-000-chat-shell`, `r18-000-mcp-authoring-server` | 否 | `chat-ui`, `ai-session` | 流式事件按 sequence 稳定合并，重复事件不重复展示；工具项能展开 canonical target、参数摘要、结果 / finding 和 revision；敏感环境值不进入 UI / 日志；重开后时间线与持久化记录一致；本节点在现有 `tests/unit/serializedSessionMount.test.ts` 增加并通过 timeline 重放 / 去重用例 |
| `r19-021-safe-markdown-formula` | Chat 消息和公式安全、可复制、可访问地渲染 | `r19-000-chat-shell` | 否 | `chat-ui` | Markdown 标题 / 列表 / 代码和受支持公式正确显示；`script`、事件属性、危险 URL、原始 iframe / HTML 不执行；恶意 fixture 不产生网络或 DOM 事件；键盘可遍历消息与复制原文，渲染失败显示安全文本 fallback；本节点在现有 `tests/unit/formulaNodeUi.test.tsx` 增加并通过 Chat 恶意 Markdown / 公式 fallback 用例 |
| `r19-030-stop-undo-stale` | 变更预览、Stop、迟到结果防护、stale 提示与 AI 写入 Undo 闭环 | `r19-020-tool-timeline`, `r18-041-human-concurrency` | 否 | `chat-ui`, `store-kernel`, `ai-session` | 提交前预览列出 canonical target、old / new 摘要和预期 revision；Stop 调用 adapter cancel 并递增 session generation；Stop 后到达的 text 可标迟到但 tool result 零写入；教师并发修改显示 stale target；一次成功 AI 提交只有一个历史事务，点击 Undo 精确恢复且不撤销其后的教师事务 |
| `r19-040-session-persistence-deletion` | 会话恢复、迁移/损坏隔离、Save As 隔离和范围删除 | `r19-000-chat-shell`, `r16-020-local-session-store` | 否 | `chat-ui`, `ai-session` | 应用重启后恢复消息/timeline/adapter mapping；逐版本 migration 保持可读，单个损坏 session 被隔离并可删除且不阻塞同/其他工程；Save As 新工程会话为空；删除单会话/工程/全部的影响范围准确；UI 明示 CLI 历史另行处理；本节点在现有 `tests/unit/serializedSessionMount.test.ts` 增加 migration/corruption/三种删除用例 |
| `r19-050-internal-dogfood` | 用真实课例完成端到端内部 Dogfood 与问题分级 | `r19-010-context-references`, `r19-020-tool-timeline`, `r19-021-safe-markdown-formula`, `r19-030-stop-undo-stale`, `r19-040-session-persistence-deletion` | 否 | `chat-ui` | 同一真实课例依次完成引用材料生成、当前页修改、整课 QA / 修复、Stop、教师并发 stale、Undo、重启恢复和删除；结果可保存重开、Player / HTML 运行；问题按当前用户可用性与安全 / 合规维度分别记录 |
| `r19-060-release` | 形成 1.9 engineering candidate 并发布 v1.9.0-rc.N 源码标签 | `r19-050-internal-dogfood` | 否 | `none` | 自动化与 1.9 全部目标测试通过，固定 fixture 覆盖 Chat、timeline、安全渲染、Stop、Undo、stale、重启、迁移、损坏隔离和删除，并证明人工功能不退化、无第二 event/session writer 后创建 `v1.9.0-rc.N` 源码标签；本节点不签署 accepted，保全矩阵晋升留到 S4 |

并行 frontier：context reference、tool timeline、安全渲染与 session 删除在 shell 完成后可按写锁并行；Stop / Undo 汇合 timeline 与并发语义，最终由真实 Dogfood 统一验证。

## 接口与数据合同

- Chat message 持久化记录包含本地 message ID、role、纯文本源、render version、引用快照、adapter/session、sequence 范围和时间；使用 `WorkspaceIdentityV1` owner 与版本化 schema，不保存可执行 HTML。migration 失败或单条损坏时隔离该记录并给出可删除诊断，不让整个 store 无法启动。
- context reference 是发送时快照，包含类型、display label、canonical target、document revision 和最小内容。材料引用遵循 1.5 的本地材料合同和用户明确选择。
- timeline 直接投影 adapter / MCP 事件与 receipt，不建立另一套 tool 状态；secret / environment / raw credential 字段在持久化前过滤。
- Stop 使当前 session generation 失效并调用 adapter cancel。旧 generation 的任何写结果都返回 stale / ignored，不能靠到达时间猜测有效性。
- AI 写入仍是 editor transaction；Undo 只针对其 receipt 标识的事务，并遵守现有混合人工历史语义。
- 删除只覆盖应用 userData 的会话 / trace；UI 不承诺删除 Codex、Claude、OpenCode 自身保存的历史。

## 精确验证入口

核心实现只使用以下当前已存在的精确测试入口；对应节点在表格 Acceptance 指定的现有文件中增加命名用例：

```text
npm run test:product -- tests/unit/serializedSessionMount.test.ts tests/unit/courseAuthoringSession.test.ts tests/unit/editorTransaction.test.ts
npm run test:product -- tests/integration/mixedCrossSurfaceHistory.test.tsx tests/integration/architectureBaselineFlows.test.tsx
npm run test:product -- tests/unit/formulaNodeUi.test.tsx tests/unit/diagnosticLog.test.ts
npm run test:e2e -- tests/e2e/stabilizationOwnershipController.spec.ts tests/e2e/stabilizationCoreUsability.spec.ts
```

版本候选再执行总路线统一验证；Dogfood 使用真实课例和真实 CLI，自动化只给出 engineering candidate，S4 的 Owner 签署决定 accepted。
