# 2.0：内部生产 AI 作者工作流

## 结果与边界

2.0 把本地 CLI 驱动的 AI 作者工作流从受控 dogfood 提升为内部生产构建的默认可见能力：团队用户可以设置 Codex、Claude 或 OpenCode，引用选定上下文，生成/编辑课件，查看工具轨迹，Stop、Undo、处理 stale，并管理应用保存的会话。CLI 由用户安装、登录并持有凭据；产品不读取或保存 API Key，也不重写 CLI 的模型/Agent 循环。本版本不代表面向外部不受信用户、公开插件市场或多租户 SaaS 发行；`r20-*` ID 中的 `public` 仅为稳定历史标识。

首次使用必须说明外部 CLI 可能把用户选定上下文发送给其 Provider。产品不按材料类型猜测或阻止发送；是否发送由教师在可见引用和风险说明基础上决定。删除应用记录不声称删除 CLI 自身历史。

所有既有人工能力保持可见和可用；未安装、未登录、版本不兼容、CLI 崩溃、网络失败、Stop、stale 或准入失败都不能降低人工编辑器。

S4 Owner 验收 1.9–2.0 后发布 `v2.0.0` 内部源码标签与从同一 accepted 候选冻结的 `examples/render-host-benchmark/render-host-benchmark-v2.html`，不发布安装器。三 CLI 的固定验收工作区证明内部生产 AI 工作流；发布 HTML 证明课程运行制品，二者不混为同一制品。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r20-000-public-governance` | 锁定内部生产可见性、支持矩阵、数据边界、错误分类与发布政策 | `r19-060-release` | 否 | `contracts-schema`, `generated-index`, `workspace-shell` | 正式 capability/settings 只列 Codex、Claude、OpenCode；明确内部生产分发、用户安装/登录、应用不保存 key、session owner、staging/MCP 写边界和 AI 数据不入工程/导出；普通人工功能不受 AI 开关影响；发布矩阵只有内部源码 tag + 固定 HTML，并规定 Owner 签署后不得重生成 |
| `r20-010-cli-setup-ui` | 内部生产设置页完成自动探测、自定义路径、版本、登录指引与诊断 | `r20-000-public-governance`, `r16-030-cli-lifecycle` | 否 | `workspace-shell`, `cli-adapters` | 三种 CLI 分别显示 installed/missing/unauthenticated/unsupported/ready；自定义路径通过 approved adapter launcher 验证；缺失状态提供安装/登录步骤；设置页不能显示/输入 API Key，任一失败不阻塞关闭设置并继续人工编辑；本节点在现有 `tests/unit/electronLaunchEnvironment.test.ts` 增加并通过三 CLI 内部设置状态用例 |
| `r20-011-first-use-risk-notice` | 首次外部 CLI 使用前显示一般数据发送风险并记录本地确认 | `r20-000-public-governance` | 否 | `workspace-shell` | 每个 workspace identity 首次发送前显示 CLI / Provider、将发送的引用清单、应用不控制 Provider 保留策略和“继续 / 取消”；取消零启动 / 零发送；确认只保存在应用本地且可重看；PDF、教材、学生作业等材料类型不触发产品级禁止规则；本节点在现有 `tests/unit/courseAuthoringSession.test.ts` 增加并通过风险确认 workspace 隔离用例 |
| `r20-020-public-authoring` | 正式开放 Chat、生成、局部编辑、timeline、Stop、Undo 与 stale 体验 | `r20-010-cli-setup-ui`, `r20-011-first-use-risk-notice`, `r19-030-stop-undo-stale` | 否 | `chat-ui`, `store-kernel`, `ai-session` | ready CLI 可从内部生产可见入口新建会话并完成单页生成和当前选择编辑；运行状态/tool receipt 可见；Stop 与迟到结果零写入；教师并发修改显示 stale；成功写入一次 Undo 恢复；关闭 Chat 后人工编辑、保存、Player 和导出继续工作；本节点在现有 `tests/integration/architectureBaselineFlows.test.tsx` 增加并通过正式 AI 提交/Stop/stale 用例 |
| `r20-021-profile-controls` | 教师可选择 CLI、内置 profile / Skills 和允许的上下文范围 | `r20-000-public-governance`, `r18-050-three-cli-benchmark` | 否 | `generated-index`, `workspace-shell` | UI 只显示通过版本校验的内置 profile / Skills；切换 CLI 不改变产品 tool schema；发送前能查看 adapter、Skills、引用范围和 staging 边界；不提供任意 Main / OS / secret 权限开关；无效 profile 阻止 AI 启动但不影响人工功能 |
| `r20-022-materials-privacy-controls` | 材料引用、会话删除、Save As 隔离和 CLI 历史差异成为公共控制 | `r20-011-first-use-risk-notice`, `r15-020-material-tools-citations`, `r19-040-session-persistence-deletion` | 否 | `main-preload`, `workspace-shell` | 发送前可逐项取消材料 / 页面 / 整课引用；Save As 后会话为空；按会话 / 工程 / 全部删除应用记录结果可复查；课程中的可见引用仍随工程保存；UI 明确链接到三种 CLI 各自历史处理说明且不宣称代删 |
| `r20-030-docs-accessibility` | 完成内部设置 / Chat / timeline 的键盘、读屏、错误恢复与用户文档 | `r20-020-public-authoring`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls` | 否 | `workspace-shell`, `generated-index` | 仅键盘可完成 CLI 设置、风险确认、引用选择、发送、Stop、查看 tool finding、Undo 和删除；焦点顺序/状态 announcement/对比度通过项目基线；内部文档逐项覆盖三 CLI 安装登录、数据边界、失败恢复、staging/MCP、删除差异和人工回退 |
| `r20-040-three-cli-acceptance` | 三种真实 CLI 在同一固定课例完成同一生成与局部编辑矩阵 | `r20-020-public-authoring`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls` | 否 | `cli-adapters` | Codex、Claude、OpenCode 各自完成同一单页生成和同一现有页局部编辑；每种都覆盖 Stop、教师并发 stale、Undo、应用重启恢复和会话删除；产物保存重开、Player、单 HTML、诊断通过；任一种失败不得以另一种结果替代；本节点在现有 `tests/e2e/stabilizationCoreUsability.spec.ts` 增加并通过三 CLI 固定矩阵用例 |
| `r20-050-owner-acceptance` | Owner 验收 S4 AI 产品并签署 v2.0.0 accepted 候选 | `r20-030-docs-accessibility`, `r20-040-three-cli-acceptance` | 否 | `none` | Owner 在同一固定课例完成 S4 AI 产品验收：覆盖 1.9 的 Chat/timeline/safe render/Stop/Undo/stale/restart/migration/corruption/delete，以及 2.0 的三 CLI 设置、风险提示、生成、编辑、材料隐私、无障碍与人工回退；验证三 Surface、Native/Component/Runtime、保存重开、Player、适用导出和断网固定 HTML，晋升 1.9–2.0 已验收行为到保全矩阵并签署 `v2.0.0` accepted 候选，记录 HTML identity 后不得重生成 |
| `r20-060-release` | 发布 v2.0.0 内部源码标签与固定课例离线 HTML | `r20-050-owner-acceptance` | 否 | `none` | 同一 accepted 候选的 `npm run verify` 已通过；发布前断网打开 Owner 已签署 identity 的固定 HTML且不重生成，扫描工程、Published 与 HTML 不含消息、tool trace、本地材料缓存或凭据；证明无第二 Store、tool catalog 或写入通道后创建 `v2.0.0` 内部源码标签并发布同一 HTML，无安装器 |

并行 frontier：CLI 设置和首次风险说明在治理合同后可并行；公共 authoring 与 profile / privacy 控制汇合到文档 / 无障碍和三 CLI 验收。`r20-050-owner-acceptance` 不能用自动化报告替代，`r20-060-release` 不能提前创建正式制品。

## 接口与数据合同

- 公共设置只保存 adapter ID、探测 / 用户选择的 executable 路径、可显示版本、profile 选择和非秘密偏好；认证由 CLI 自己完成。Renderer 不能传任意 executable / args。
- 首次使用记录以 workspace identity + notice version 为键，只证明用户看过本应用说明，不代表 Provider 合规同意。每次发送仍展示实际引用；产品不做材料类别封锁。
- 内部生产 authoring 复用 1.6–1.9 的 adapter、MCP、staging、admission、receipt、session generation 与 history，不建立 2.0 专用写入通道。
- AI 会话 / message / tool trace / usage / staging / 材料缓存永不进入 CourseProject、Published、Component、Runtime、PPTX、PDF、Web package 或单 HTML。
- Save As 创建新的本地 workspace identity，不复制会话。删除应用记录的范围与结果可验证；CLI 自身历史只提供说明，不做无法保证的删除承诺。
- 2.0 固定课例离线 HTML 精确为 `examples/render-host-benchmark/render-host-benchmark-v2.html`；它是纯课程运行制品，没有 AI 设置、Chat、MCP server 或 CLI 运行依赖。r20-050 签署其 identity 后，r20-060 只发布同一 bytes，不重新生成。

## 精确验证入口

内部生产实现只使用以下当前已存在的精确测试入口；对应节点在表格 Acceptance 指定的现有文件中增加命名用例：

```text
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts tests/unit/serializedSessionMount.test.ts tests/unit/courseProjectRoundTrip.test.ts
npm run test:product -- tests/unit/courseProjectHealth.test.ts tests/unit/coursePackageExport.test.ts tests/unit/coursePrintArtifacts.test.ts
npm run test:product -- tests/integration/courseExportPreflightApp.test.tsx tests/integration/architectureBaselineFlows.test.tsx
npm run test:product -- tests/unit/courseAuthoringSession.test.ts tests/unit/electronLaunchEnvironment.test.ts tests/unit/serializedSessionMount.test.ts
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts tests/e2e/publishedOnlineSingleHtml.spec.ts
npm run verify
```

自动化只建立 engineering candidate；三种真实 CLI 与固定课例的 S4 Owner `accepted` 是 `v2.0.0` 发布的最终门。
