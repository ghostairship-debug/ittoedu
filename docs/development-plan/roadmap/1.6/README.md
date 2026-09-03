# 1.6：本地 CLI 会话内核（默认隐藏）

## 结果与边界

应用能探测并安全启动用户已安装、已自行登录的 Codex、Claude、OpenCode CLI，统一消费会话事件、恢复和取消，但不读取或保存 API Key。CLI 保留自己的模型规划、工具循环、Skills 和子任务能力；应用只提供进程 / 会话 harness，不实现第二套 Agent Runner。

1.6–1.9 的 AI 入口在普通内部生产构建中默认隐藏；受控 dogfood channel 在对应纵切通过后可以显式启用，不必等到 2.0 才首次使用。三种 CLI 全部缺失、未登录、版本不支持或运行崩溃时，现有人工创建、编辑、保存、重开、Player 和导出仍全部可用。

发布制品只有源码 tag，不发布 HTML 或安装器。实现节点可从 1.1 基线并行开始，发布节点为保持版本顺序等待 1.5。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r16-000-cli-adapter-contract` | 定义 `LocalAgentCliAdapterV1`、标准事件和错误分类 | `r11-062-owner-release` | 否 | `contracts-schema`, `main-preload` | 三个 adapter fixture 都通过同一 contract suite；`probe` / `start` / `resume` / `cancel` 输入输出严格解析；八类标准事件保持顺序和 session identity；未知事件、坏 JSON 和进程异常转为明确 failed 分类而不抛进 Renderer；本节点在现有 `tests/unit/electronLaunchEnvironment.test.ts` 增加并通过 adapter contract fixture 用例 |
| `r16-010-secure-process-launcher` | Windows 使用解析后的明确 executable + args 启动和停止 CLI | `r16-000-cli-adapter-contract` | 否 | `main-preload` | 路径含空格和非 ASCII 时仍启动精确 executable；参数逐项传入而非 shell 字符串；恶意 shell 元字符不产生第二进程 / 重定向；cancel 终止子进程树并只影响目标 session；Renderer 不能调用任意 executable |
| `r16-011-codex-adapter` | Codex CLI 探测、版本、启动、流式、恢复、取消与错误归一化 | `r16-000-cli-adapter-contract`, `r16-010-secure-process-launcher` | 否 | `main-preload` | 已安装 / 未安装 / 未登录 / 不支持版本 fixture 分别返回确定 probe 结果；start 输出标准 session / text / tool / usage / completed；resume 延续同一外部会话；cancel 后不再转发迟到事件；不读取 Codex 凭据 |
| `r16-012-claude-adapter` | Claude CLI 探测、版本、启动、流式、恢复、取消与错误归一化 | `r16-000-cli-adapter-contract`, `r16-010-secure-process-launcher` | 否 | `main-preload` | 已安装 / 未安装 / 未登录 / 不支持版本 fixture 分别返回确定 probe 结果；start 输出标准 session / text / tool / usage / completed；resume 延续同一外部会话；cancel 后不再转发迟到事件；不读取 Claude 凭据 |
| `r16-013-opencode-adapter` | OpenCode CLI 探测、版本、启动、流式、恢复、取消与错误归一化 | `r16-000-cli-adapter-contract`, `r16-010-secure-process-launcher` | 否 | `main-preload` | 已安装 / 未安装 / 未登录 / 不支持版本 fixture 分别返回确定 probe 结果；start 输出标准 session / text / tool / usage / completed；resume 延续同一外部会话；cancel 后不再转发迟到事件；不读取 OpenCode 凭据 |
| `r16-020-local-session-store` | 在应用 userData 的版本化目录保存配置、会话映射和事件记录 | `r15-000-material-contract`, `r16-000-cli-adapter-contract` | 否 | `main-preload` | 复用 r15-000 的 `WorkspaceIdentityV1`，记录按该身份隔离；关闭重开可恢复，同 ID 不同路径互不可见，Save As 得到新 identity 且会话为空；每个本地 schema 版本有显式 migration，单个损坏记录被隔离并报告而不使其他 workspace 不可用；`.h5lesson`、Published 和导出均无 session/trace；本节点在现有 `tests/unit/serializedSessionMount.test.ts` 增加 owner/migration/corruption/Save As 用例 |
| `r16-030-cli-lifecycle` | 三种 adapter 共用单一会话状态机与 backpressure / crash / cancel 处理 | `r16-011-codex-adapter`, `r16-012-claude-adapter`, `r16-013-opencode-adapter`, `r16-020-local-session-store` | 否 | `main-preload` | running → completed / failed / cancelled 转移不可逆；重复 completed、乱序 tool result、超大输出和进程崩溃均被归一化且 UI 线程不阻塞；重启只恢复可恢复会话；不存在跨 adapter 串流或跨工程记录 |
| `r16-031-hidden-manual-isolation` | 普通构建隐藏 AI 入口，并证明 CLI 故障不影响人工工作流 | `r16-030-cli-lifecycle` | 否 | `workspace-properties`, `main-preload` | 默认设置、工具栏和菜单没有 AI / chat / provider 入口；模拟三 CLI 缺失、未登录、启动失败和运行崩溃后，人工创建对象、保存、关闭重开、Undo / Redo、Player 与 HTML 导出逐项成功；工程无 session 字段 |
| `r16-040-release` | 固定课例验证隐藏 CLI 内核与人工隔离并发布 1.6 源码 tag | `r16-031-hidden-manual-isolation`, `r15-060-release` | 否 | `none` | 内部验证分别用三种真实已安装 CLI 完成 probe、start、stream、resume、cancel；在三种不可用状态下完成人工代表闭环，确认普通构建无入口且 dogfood channel 可显式启用；把已验收 CLI/session 行为晋升到保全矩阵，证明无 raw Store/UI 依赖、第二 session writer 或跨 workspace 泄漏后由 Owner 签署 `accepted` 并发布源码 tag |

并行 frontier：安全 launcher、session store 可在合同落定后并行；三个 adapter 在 launcher 完成后可由不同写锁顺序并行开发，但共享状态机的整合只在 `r16-030-cli-lifecycle` 完成。

## 接口与数据合同

`LocalAgentCliAdapterV1` 至少提供：

```text
probe
start
resume
cancel
```

标准事件至少包含：

```text
session
text
tool-call
tool-result
usage
completed
failed
```

另有应用归一化的 `cancelled` 终态；它不能伪装为 CLI 原生事件。每个事件携带 adapter ID、内部 session ID、可选外部 session ID、单调 sequence 和时间；工具参数 / 结果按可序列化 payload 保存，不能混入进程对象或秘密环境变量。

- executable 来自已批准 adapter 的自动探测结果或用户明确选择的文件路径；Renderer 只传 adapter / operation / session，不传任意命令。
- Windows 启动直接传 executable 与参数数组，禁用 shell 拼接。应用只传 adapter 明确需要且允许的环境，不读取 CLI 的凭据文件或长期 token。
- 本地 session owner 使用共享版本化 `WorkspaceIdentityV1`（工程稳定 ID + 规范化文件位置）；Save As 产生新 owner且不复制记录。store schema 必须可迁移，损坏记录按 workspace 隔离并可重建/删除；记录不进入 CourseProject、Published、Component、Runtime 或导出。
- 适配器负责 CLI 协议差异；上层只消费统一事件，不基于终端文案猜测工具调用。

## 精确验证入口

核心实现只使用以下当前已存在的精确测试入口；对应节点在表格 Acceptance 指定的现有文件中增加命名用例：

```text
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts tests/unit/windowsSourceLaunchContract.test.ts tests/unit/serializedSessionMount.test.ts
npm run test:product -- tests/unit/diagnosticLog.test.ts tests/unit/courseProjectRoundTrip.test.ts
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

adapter 测试使用可控 fixture executable 覆盖失败注入；发布门另做真实 CLI 人工验证，不把外部登录或网络状态变成自动化必需条件。
