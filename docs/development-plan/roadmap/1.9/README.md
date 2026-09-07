# 1.9：持续创作、会话恢复与长任务

## 结果与边界

按2026-09-07[当前开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)重新编排：先通过1.8/S3的真实可用性门，再完成长期查找/分支、多任务、未命名工程、首次保存、恢复/删除、原生上下文压缩与真实课例连续创作。1.8必须已经能理解当前图片/文字/运行状态、编辑和验证；本版不代修它的核心阻断，也不重建聊天入口。

AI入口延续默认可见，工程真相/历史/事务不变。完整身份、任务与恢复语义统一见[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md#8-新旧会话与未命名工程)。本版只形成 `v1.9.0-rc.N` engineering candidate源码标签，无HTML/安装器；Owner accepted在2.0/S4签署。

PPTX内嵌媒体/简单效果继续是独立必选交付线，遵守[PPTX能力增强计划](../../PPTX_IMPORT_ENHANCEMENT_PLAN.md)，不受CLI可用性影响。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r19-040-session-persistence-deletion` | 会话恢复、迁移/损坏隔离、Save As 隔离和范围删除 | `r18-060-release`, `r16-020-local-session-store` | 否 | `chat-ui`, `ai-session` | 真实重启后消息和已应用结果可查，继续请求读取当前课件；三种删除范围、旧V1迁移和Save As隔离正确。 [完整规格](r19-040-session-persistence-deletion.md) |
| `r19-041-session-navigation` | 交付会话搜索分支多任务状态与既有事务历史审阅 | `r19-040-session-persistence-deletion` | 否 | `chat-ui`, `ai-session` | 搜索能定位真实内容；从历史节点分支讨论并编辑时理解当前课件；切任务与回答问题路由准确，两个任务不会并发写。 [完整规格](r19-041-session-navigation.md) |
| `r19-042-draft-workspace-continuity` | 支持未命名工程AI与首次保存后的明确身份切换 | `r19-040-session-persistence-deletion` | 否 | `contracts-schema`, `ai-session`, `app-save-recovery`, `chat-ui` | 未保存新课件可讨论与编辑；首次保存后继续目标读取新状态且不重复提交；两个draft隔离，Save As不带旧会话。 [完整规格](r19-042-draft-workspace-continuity.md) |
| `r19-043-long-task-context` | 闭合长任务上下文压缩缓存失效与阶段性能诊断 | `r19-041-session-navigation`, `r19-042-draft-workspace-continuity` | 否 | `ai-session`, `cli-adapters`, `chat-ui` | 真实对话触发至少一次CLI原生压缩/长上下文边界，再人工修改并继续，当前事实与目标/范围保持；有限预算可停止并恢复。 [完整规格](r19-043-long-task-context.md) |
| `r19-050-internal-dogfood` | 以真实课例验证连续创作长任务恢复与跨入口衔接 | `r18-043-context-references`, `r18-044-tool-timeline`, `r18-045-safe-markdown-formula`, `r18-046-stop-undo-stale`, `r19-040-session-persistence-deletion`, `r19-041-session-navigation`, `r19-042-draft-workspace-continuity`, `r19-043-long-task-context` | 否 | `chat-ui` | 三CLI连续使用与T12完整生命周期有真实证据，无未关闭当前核心流程阻断/数据错误/假完成；个人Skill构建产物可接应用继续编辑。 [完整规格](r19-050-internal-dogfood.md) |
| `r19-051-pptx-media-effects` | 增强内嵌媒体与可表达的简单演示效果 | `r18-051-pptx-editable-diagrams`, `r18-060-release` | 否 | `app-save-recovery`, `store-slide`, `authoring-interaction`, `published-slide`, `export-pptx` | 支持范围媒体实际播放且可人工编辑；简单效果顺序/触发符合既有正式语义；离线HTML素材闭包正确。 [完整规格](r19-051-pptx-media-effects.md) |
| `r19-060-release` | 形成 1.9 engineering candidate 并发布 v1.9.0-rc.N 源码标签 | `r19-050-internal-dogfood`, `r19-051-pptx-media-effects` | 否 | `none` | 1.9所有必选节点通过且无未关闭核心流程/数据错误，源码候选与验证实现一致；AI与PPTX均完成。 [完整规格](r19-060-release.md) |

040完成后041与042都可开始，但共享chat-ui/ai-session写锁，默认串行集成；043等两者完成。PPTX 051可在S3后按独立写锁推进。050汇合持续使用能力，060同时等待AI和PPTX，不能绕过其中一线。

## 接口与验证重点

- 本地AI记录使用090正式版本合同与既有repository；旧记录可查看、坏记录隔离；恢复后重新观察，旧running/候选不自动执行。
- 搜索索引可重建，讨论分支不复制工程；多个任务的写入串行并分别重校验。
- draft身份仅限应用本地AI，首次保存按共同合同显式切换；Save As不复制旧会话。应用删除不承诺删除外部CLI历史。
- 长上下文由CLI原生循环处理，宿主保存任务目标/receipt并提供新观察；能力/资产缓存与文档/草稿/视图/运行版本分别失效。
- 每个完整规格列1–3条真实存在的目标命令及必须的真实操作；本地会话存储用electronLaunchEnvironment等实际包含repository/协议测试的入口，不能用通用DOM挂载测试冒充迁移/删除证据。
- 验收用T12完整生命周期和连续课例。未变1.8证据保留，新增重启/未命名工程/长任务必须真实验证；标签候选不替代S4教师结论。
