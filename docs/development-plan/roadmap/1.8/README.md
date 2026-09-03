# 1.8：CLI Agent、MCP 与 Skills（默认隐藏）

## 结果与边界

1.8 首次向 CLI 提供版本化、本地、会话级的 live MCP Authoring Server，把交互式上下文读取和 1.4 的正式写工具暴露给 Codex、Claude、OpenCode。一个中立 Agent Profile 生成三种 CLI 的启动配置；各 CLI 继续使用自身规划、Skills、子任务和工具循环，编辑器不建立重复 Agent Runner。1.7 的 batch candidate parser/1.4 command mapper 继续作为宿主提交内核，但不冒充 MCP 或 live authoring channel。

修改权威工程必须调用产品 MCP 写工具。结构化 stdout-only adapter 不启用通用文件工具；启用文件工具时，其配置只把当前 session staging 作为任务工作目录，宿主仍只摄取 realpath 闭合的当前 candidate。教师并发修改使 revision 变化后，旧工具调用返回 stale 并零写入。

AI 入口默认隐藏。发布制品只有源码 tag，不发布 HTML 或安装器。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r18-000-mcp-authoring-server` | 提供版本化 session-scoped MCP server、鉴权上下文和统一错误 / receipt envelope | `r17-060-release` | 否 | `main-preload`, `contracts-schema` | 只有 harness 启动的当前 session 能连接；initialize 明确协议 / server / tool 版本；断开或 session generation 变化后旧连接失效；坏参数、未授权 tool、内部失败均返回结构化错误且不泄漏 Main 对象 / 文件路径之外的秘密；本节点在现有 `tests/unit/coursewareAuthoringRunner.test.ts` 增加并通过 MCP session / failure 用例 |
| `r18-010-context-read-tools` | 提供当前选择、当前页、整课、材料和能力 / 诊断只读上下文 | `r18-000-mcp-authoring-server` | 否 | `main-preload` | 每个读取结果包含 project identity、document revision、canonical target 和被请求的最小字段；不同工程 session 互不可读；材料原文只在明确请求时返回；读取不改变工程、选择、历史或材料索引 |
| `r18-011-write-tool-mapping` | 把 1.4 正式 Surface / global / dynamic 工具映射为 MCP tools | `r18-000-mcp-authoring-server`, `r14-060-release` | 否 | `editor-store-history`, `contracts-schema`, `main-preload` | MCP catalog 是 1.4 Authoring Tool catalog 的精确版本化投影，不复制 tool schema/handler；名称、输入、target/create-scope、receipt 与 capability metadata 有 conformance；Slide、Flow、Spatial、global/background/network/dynamic 各至少一项成功；stale/invalid/适用的 admission failure 零写入且无历史项 |
| `r18-020-neutral-agent-profile` | 定义不含模型循环的中立 profile 并生成 CLI 会话配置 | `r18-010-context-read-tools`, `r18-011-write-tool-mapping` | 否 | `generated-index` | profile 只声明 MCP server、允许工具、staging、skills、上下文预算和 adapter capability；同一 profile 可确定地生成三种 adapter 输入；不包含模型计划图、Provider key 或项目私有绝对路径；生成结果可版本校验；本节点在现有 `tests/unit/coursewareSkillsContract.test.ts` 增加并通过三 CLI profile 生成用例 |
| `r18-021-codex-profile` | Codex 使用中立 profile 启动其原生 Agent / tool loop | `r18-020-neutral-agent-profile`, `r16-011-codex-adapter` | 否 | `generated-index`, `main-preload` | fixture 与真实 Codex 会话都能发现同一 MCP tool 集、读取上下文、调用写工具并收到 receipt；规划 / tool-call 事件来自 Codex adapter；应用没有执行自建 plan step |
| `r18-022-claude-profile` | Claude 使用中立 profile 启动其原生 Agent / tool loop | `r18-020-neutral-agent-profile`, `r16-012-claude-adapter` | 否 | `generated-index`, `main-preload` | fixture 与真实 Claude 会话都能发现同一 MCP tool 集、读取上下文、调用写工具并收到 receipt；规划 / tool-call 事件来自 Claude adapter；应用没有执行自建 plan step |
| `r18-023-opencode-profile` | OpenCode 使用中立 profile 启动其原生 Agent / tool loop | `r18-020-neutral-agent-profile`, `r16-013-opencode-adapter` | 否 | `generated-index`, `main-preload` | fixture 与真实 OpenCode 会话都能发现同一 MCP tool 集、读取上下文、调用写工具并收到 receipt；规划 / tool-call 事件来自 OpenCode adapter；应用没有执行自建 plan step |
| `r18-030-course-skills` | 提供 `course-design`、`course-build`、`qa-repair`、`style-remix` 产品 Skills | `r18-020-neutral-agent-profile` | 否 | `generated-index` | 每个 Skill 明确输入、停点、允许工具和交付物；`course-design` 不越过教师确认写工程，`course-build` 只消费已确认两份 Markdown，`qa-repair` 最多一次局部修复，`style-remix` 使用正式槽位工具；三种 profile 均能加载 |
| `r18-031-editing-craft-skills` | 提供 `pro-editing`、`visual-craft`、`interaction-craft` 产品 Skills | `r18-020-neutral-agent-profile` | 否 | `generated-index` | 三个 Skill 分别限定编辑范围、视觉检查和互动宿主选择；都遵循 Native → Recipe → Existing Component → Generated Component → Runtime 阶梯；不会建议直接改 `.h5lesson` / Store / 源码；三种 profile 均能加载 |
| `r18-040-staging-file-boundary` | 启用文件工具的 CLI profile 通过当前 session staging 摄取约束 | `r18-020-neutral-agent-profile`, `r17-010-staging-workspace` | 否 | `main-preload` | 对三种 profile 逐项判定：stdout-only 明确 N/A；启用文件工具时工作目录/允许路径指向当前 staging，宿主只摄取 realpath 闭合文件并拒绝绝对外部引用、`..`、外链 symlink、其他 session 和 `.h5lesson`；不宣称 OS sandbox；MCP 仍是唯一权威写路径并原子提交；在现有 `tests/unit/scopedValidationWorkflow.test.ts` 增加配置/摄取失败用例 |
| `r18-041-human-concurrency` | 人工编辑与 Agent 工具调用以 revision / session generation 正确并发 | `r18-011-write-tool-mapping` | 否 | `editor-store-history`, `main-preload` | Agent 读取后教师修改同一 target、其他 target、Save As、关闭工程四种情形分别触发合同规定的 stale / 新 identity；迟到 tool result 均零写入；无冲突调用提交为单一历史事务且教师可 Undo |
| `r18-050-three-cli-benchmark` | 三种 CLI 在同一 profile / 固定课例上完成可比构建与局部修改 | `r18-021-codex-profile`, `r18-022-claude-profile`, `r18-023-opencode-profile`, `r18-030-course-skills`, `r18-031-editing-craft-skills`, `r18-040-staging-file-boundary`, `r18-041-human-concurrency` | 否 | `main-preload` | 每种 CLI 分别完成同一固定页生成与同一局部修改；记录 tool / receipt、载体选择、stale、耗时和最终诊断；三份产物均可人工编辑、保存重开、Player / HTML 运行；缺失某 CLI 明确失败而不以另一 CLI 代替 |
| `r18-060-release` | 固定课例通过三 CLI、MCP、Skills 与并发人工闭环并发布 1.8 源码 tag | `r18-050-three-cli-benchmark` | 否 | `none` | Owner 观察三种真实 CLI 的 MCP 调用、人工并发 stale、适用的 staging 摄取拒绝和最终课件，检查保存重开、Undo、Player、HTML 与诊断；把 MCP 单一 catalog/session/revision 边界晋升到保全矩阵，证明 MCP/Skills 无 raw Store/Main/UI deep import 后签署 `accepted`；普通构建仍隐藏，dogfood channel 可显式启用，发布源码 tag |

并行 frontier：context / write tools 在 server 合同后可并行；三种 adapter profile 与两组 Skills 在 neutral profile 后可并行；staging boundary 可独立推进。所有分支汇合到同一三 CLI benchmark，不允许只验证一种 CLI 后推断另外两种。

## 接口与数据合同

- MCP server 由应用 harness 以本地 session-scoped transport 启动；连接绑定 adapter session、project owner、document revision、session generation 和 staging root。它不开放任意 Renderer Store / Main IPC。
- read tool 返回最小上下文与 canonical targets；write tool 参数映射到 `AuthoringToolTargetWireV1` 或 create-scope，结果原样携带 1.4 receipt 和准入 finding。
- neutral profile 是数据配置：profile version、adapter capability、MCP server launch、allowed tools、skill roots、staging root、context limits。它不含模型推理步骤。
- 三个 CLI adapter 可以生成不同启动参数 / 配置文件，但不得改变产品 tool schema 或工程写入语义。
- 1.8 的 live authoritative project read/write 只有 MCP tools 能做。结构化 stdout-only profile 不承担文件工具 conformance；启用文件工具时以工作目录/配置和宿主 realpath 摄取边界证明当前 session 隔离，不以 prompt 代替，也不把该结果描述成通用 OS sandbox。无法形成可靠摄取边界的文件工具保持禁用。
- Skills 只编排产品已批准的上下文与工具，不能扩大 host、网络、秘密或文件权限。

## 精确验证入口

核心实现只使用以下当前已存在的精确测试入口；对应节点在表格 Acceptance 指定的现有文件中增加命名用例：

```text
npm run test:product -- tests/unit/courseAuthoringTarget.test.ts tests/unit/courseAuthoringSession.test.ts tests/unit/coursewareSkillsContract.test.ts
npm run test:product -- tests/unit/coursewareAuthoringRunner.test.ts tests/unit/editorTransaction.test.ts tests/unit/scopedValidationWorkflow.test.ts
npm run test:product -- tests/integration/architectureBaselineFlows.test.tsx tests/integration/mixedCrossSurfaceHistory.test.tsx
npm run test:e2e -- tests/e2e/stabilizationOwnershipController.spec.ts
```

版本候选再执行总路线统一验证；真实 CLI benchmark 不以 fixture 替代，fixture 只用于确定性故障注入。
