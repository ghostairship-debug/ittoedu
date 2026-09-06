# 1.9：会话恢复、删除与真实课例打磨（默认隐藏）

## 结果与边界

复用 1.8 已交付的基础聊天、引用、CLI 时间线、安全渲染、Stop/Undo 和多轮修改。本版集中完成会话恢复/迁移/删除及真实课例连续使用，不重新建设聊天入口，也不依赖 MCP。

会话在应用重启后可恢复，并可按会话、当前工程或全部应用记录删除。应用只承诺删除自己保存的记录，不能声称同步删除 CLI 自身历史。Save As 不复制原工程会话。

AI 入口默认隐藏。本版只形成 `v1.9.0-rc.N` engineering candidate 源码标签，不发布 HTML 或安装器；Owner accepted 在 S4（2.0）统一签署。

PPTX 人工导入增强是本版并列交付线，始终可见，不受 AI 开关或 CLI 是否可用影响。版本节点、详细边界和实施顺序见 [PPTX 能力增强计划](../../PPTX_IMPORT_ENHANCEMENT_PLAN.md)。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r19-040-session-persistence-deletion` | 会话恢复、迁移/损坏隔离、Save As 隔离和范围删除 | `r18-060-release`, `r16-020-local-session-store` | 否 | `chat-ui`, `ai-session` | 应用重启后恢复消息/timeline/adapter mapping；逐版本 migration 保持可读，单个损坏 session 被隔离并可删除且不阻塞同/其他工程；Save As 新工程会话为空；删除单会话/工程/全部的影响范围准确；UI 明示 CLI 历史另行处理；本节点在现有 `tests/unit/serializedSessionMount.test.ts` 增加 migration/corruption/三种删除用例 |
| `r19-050-internal-dogfood` | 用真实课例完成端到端内部 Dogfood 与问题分级 | `r18-043-context-references`, `r18-044-tool-timeline`, `r18-045-safe-markdown-formula`, `r18-046-stop-undo-stale`, `r19-040-session-persistence-deletion` | 否 | `chat-ui` | 同一真实课例依次完成引用材料生成、当前页修改、整课 QA / 修复、Stop、教师并发 stale、Undo、重启恢复和删除；结果可保存重开、Player / HTML 运行；问题按当前用户可用性与安全 / 合规维度分别记录 |
| `r19-051-pptx-media-effects` | 增强内嵌媒体与可表达的简单演示效果 | `r18-051-pptx-editable-diagrams` | 否 | `app-save-recovery`, `store-slide`, `authoring-interaction`, `published-slide`, `export-pptx` | 内嵌且当前媒体管线可解码的视频/音频走现有资产与播放能力；外链不自动下载；仅将已有声明式显隐/入场语义可准确表达的简单触发映射到正式交互，复杂时间线与转场明确静态保留；连续播放、保存重开、离线 HTML 及静态导出提示正确，不声称 PowerPoint 动画等价 |
| `r19-060-release` | 形成 1.9 engineering candidate 并发布 v1.9.0-rc.N 源码标签 | `r19-050-internal-dogfood`, `r19-051-pptx-media-effects` | 否 | `none` | 自动化与 1.9 全部目标测试通过，固定 fixture 覆盖 Chat、timeline、安全渲染、Stop、Undo、stale、重启、迁移、损坏隔离和删除，并证明人工功能不退化、无第二 event/session writer 后创建 `v1.9.0-rc.N` 源码标签；本节点不签署 accepted，保全矩阵晋升留到 S4；本版新增 PPTX 增强节点也必须达到其验收边界，不能只完成 AI 主线即发布 |

执行顺序：1.8/S3 后补齐聊天会话恢复与删除，再以同一真实课例验证持续使用；PPTX 媒体增强可按独立写锁推进。基础聊天已由 1.8 验收，只有相关实现或证据变化才重跑对应检查。

## 接口与数据合同

- Chat message 持久化记录包含本地 message ID、role、纯文本源、render version、引用快照、adapter/session、sequence 范围和时间；使用 `WorkspaceIdentityV1` owner 与版本化 schema，不保存可执行 HTML。migration 失败或单条损坏时隔离该记录并给出可删除诊断，不让整个 store 无法启动。
- context reference 是发送时快照，包含类型、display label、canonical target、document revision 和最小内容。材料引用遵循 1.5 的本地材料合同和用户明确选择。
- timeline 直接投影 adapter 原生事件、候选检查与宿主 commit receipt，不建立另一套 tool 状态；secret / environment / raw credential 字段在持久化前过滤。
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
