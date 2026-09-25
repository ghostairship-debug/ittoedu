# 测试执行与证据记录

## 测试不是语义规则库

工程断言验证：用户输入没有丢失；实际模型/工具与所选一致；领域操作忠实执行；内容、资源、History、保存和恢复正确；应用没有增加不必要的往返和中间文件。模型是否理解风格、设计是否满意，另记模型评测，不为每个失败样本新增流程。

## 基础样本

| 样本 | 覆盖内容 | 使用目的 |
|---|---|---|
| F-MD-CORE | 中文、emoji、CRLF/LF、标题、强调、链接、列表、引用、表格、图片与代码块 | 正文选择、源文映射、格式保留、即时内容、撤销 |
| F-MD-DIRTY | 未保存新文档、正文未提交输入、附件粘贴、外部文件改变 | 未保存AI、草稿恢复、保存/关闭/冲突 |
| F-COURSE-ALL | 同一h5lesson含Flow/Slides/Spatial、Native、Component、Runtime、全局/局部层 | 既有功能保全、同一内容内核、深度编辑与导出 |
| F-MULTIDOC | 两份h5lesson与多份MD，路径有中文/空格/同名 | 文档隔离、非当前页编辑、SaveAs、移动与重绑定 |
| F-RUNTIME-EVENTS | 内置 Provider 流、受控构建/图片 job 与外部 MCP 的脱敏事件、重复/缺序/最终快照、工具更新、授权、取消 | 归一化和回放，不代替真实服务测试 |
| F-ATTACH | 截图内存图片、本地多文件、普通Windows文件复制、文字PDF和扫描页 | 真实视觉输入、文件状态、CF_HDROP、容量限制 |
| F-FAILURE | 磁盘满、权限拒绝、断网、进程退出、响应丢失、句柄失效 | 阻断、幂等查询、停止屏障和恢复 |
| F-LOAD | 10000过程事件、10份文档、多附件、长中文正文 | 渲染与内存趋势，不是容量承诺 |

样本优先复用仓库已有合适制品，并补缺失的最小文本/数据。固定样本标识与版本；仅当内容身份是验收属性时记录 hash；不得随输出不合预期而改基准。没有版权/分发授权的用户材料不用作公开测试附件。

## 分层执行

**单元与合同：** 纯内核不依赖Electron，覆盖操作、句柄、映射、资源历史、序列与幂等。每个当前缺陷先有可失败的最小复现。

**集成：** 真实主/渲染边界、FileService、worker、运行时网关、订阅和磁盘恢复；使用故障注入验证取消与写入竞态。

**Electron/Windows：** 不只检查DOM存在。实际点击选中文字、粘贴截图/文件、拖拽、按Enter、关闭/移动文件，断言正文与磁盘结果、焦点和布局几何。

**真实模型：** 每条声明连接记录runtime版本、账号类型、实际模型/档位、上游事件与所收到工具。视觉样本验证输入确实送达，不能仅凭模型回答一句“看到了”证明。

**人工产品：** 独立用户按黄金旅程操作，记录卡住步骤、额外提示和错误恢复。截图/录屏是证据辅助，不代替内容断言。

## 已有命令入口

下面命令来自核查基线的`package.json`，实施后按实际脚本运行。不得把设计中的新测试文件名当成当前已存在脚本。

```bash
npm run typecheck
npm run check:contracts
npm run check:ai-capabilities
npm run test:product
npm run test:e2e
npm run build:desktop
npm run verify:release
```

单次开发先跑改动相关单元/集成，再跑相邻能力和定点Electron回归；集成批次与发布跑完整门。构建、契约、字体/资源、旧内容保全与正式包检查不能只选其中一项。脚本链内的pre步骤和环境变量要记录，避免零匹配或默认skip被误认成通过。

本包中的验收ID应映射到实际新增或已有测试标题；推荐按`S06-T01`等标识关联，不要求重命名所有已有测试。真实 API、图像、OAuth 或外部 AI 付费测试需要已授权账号和预算；未获得条件保持`blocked`并解决，不暗用其他账号。

## 性能测量

以用户点击发送为起点，以第一处真实内容变化、第一次正式提交和任务结束为不同终点。阶段耗时分开记录上下文准备、连接打开、模型等待、工具运行、内核提交、渲染和保存。

跨进程各用单调时间测本地跨度，主进程相关时间用于汇总；不能直接相减两个独立时钟得到虚假的负延迟。原生运行时内部模型次数不可见则记录unknown，不能把整个native turn称为一次模型调用。

固定模型/供应商/档位、材料和会话起点做冷启动与热连接对照。比较直接工具和专项候选时明确不同任务适用范围。十分钟背景案例可作为耗时样本，但不把具体语义动作写成硬编码验收规则。

## 证据文件

每次运行填入`templates/test_run.json`，附输出日志、实际发现与执行数量、失败原因和制品引用。签收表只读取真实状态；`not_run`为未执行，`blocked`为环境阻塞，均不等于passed。

本包的`tools/validate_plan.py`只检查方案文件、链接、任务图和状态一致性；它的通过不表示上述产品测试通过。

## 依据
- [R29 · package.json](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/package.json)：Electron 43.1.1；依赖；build/dist:win/verify:release 脚本。
- [R30 · docs/development-plan/reviews/2026-09-21-r20-contextual-acceptance.md](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/docs/development-plan/reviews/2026-09-21-r20-contextual-acceptance.md)：工程验收记录与未解决项，实施后需重新验证。
- [R34 · src/renderer/document/SharedDocumentEditor.tsx](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/document/SharedDocumentEditor.tsx)：publishLayoutSelection；sourceMap；source/layout；caller owns history。
- [R35 · src/renderer/document/editorSession.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/document/editorSession.ts)：selection adapter；Decoration；update 中 EditorState.create；外部撤销回调。
- [R41 · src/renderer/authoring/tools/authoringToolFacade.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/authoring/tools/authoringToolFacade.ts)：createAuthoringToolFacade / describeAuthoringTools；执行与发现同源。
- [R42 · src/renderer/authoring/tools/executeAuthoringTool.ts](https://github.com/ghostairship-debug/ittoedu/blob/0de8801bb7de3299129b66e293dc49c9ce298f76/src/renderer/authoring/tools/executeAuthoringTool.ts)：executeAuthoringTool；完整复制、Schema 检查、commitPort。


## 主路径、连接矩阵与判断预算

开发主路由为 TeamoRouter（provider `teamorouter`，`https://api.teamorouter.com/v1`）DeepSeek，第二路由为 DeepSeek 官方 API；文本/视觉、规划和工具调用的适用真实模型用例已获授权。探针按供应商实时目录钉定模型 ID，首选 V4.1 Flash；记录路由 + 模型 ID、实际账号档位、协议与能力，不能混写 `deepseek-flash`（Owner 路由说明中的 V4.1）和 `deepseek-v4-flash`（V4），不能把 dsh 配置目录当供应商目录权威。开发凭据仅运行时读取 `TEAMOROUTER_API_KEY` / `DEEPSEEK_API_KEY`；产品凭据用自己的安全存储，不将内部测试连接固化为产品默认。

首轮上线 GPT OAuth，使用 Owner 当前账号正式登录，前期图片生成通过该连接；登录和 OAuth 图像验证已授权，实际执行时记录 endpoint、执行者、模型、能力与费用。独立图片 API 供应商与账号待定，在启用该连接前决定，不作为 B05 前置。S05/P5 先验证认证与连接，B05/S14 验证实际生成/编辑及资源闭环；OAuth 对用户仍可选，API 文本/编辑不依赖它。账号选择不等于能力已证实，图片不支持或请求状态未知时不暗换收费路径。

S12-T01、M12-T05 等确需外部客户端的用例继续按各 CLI 既有授权：Codex/OpenCode 用 Luna，Claude 用 DeepSeek，记录当时实际配置，不推断历史路由；Luna 默认 Fast，不支持则用普通速度。授权不允许越界切模型或无限同因重跑。

发布必须有代表性低成本 API 生产记录，以及实际可用且已授权的 Token Plan 路由验证。对话/视觉/生图可组合；高能力 GPT 作为质量上限对照，不替代主使用方式。某套餐资料允许不等于账号已开通；记录 unknown/blocked，不捏造成功。

TeamoRouter 的按量/套餐/免费档按实际账户核实；两把 API Key 不证明 Token Plan 已开通。S05-T07 必须有真实套餐与按量连接，缺少套餐条件时保留缺口，不能用免费档或两条按量 API 替代。仅在需新增采购或授权时交 Owner 决定。

OAuth 按具体供应商、认证、模型、图像功能和实际 harness 验证；API 完整任务无需 OAuth/CLI。外部 MCP 至少两类客户端调用同一 Server，业务实现不分叉。只有工具互通，不默认验收外部全聊天或自动启动/停止。

确定性事件与故障注入：错目标/越权/取消后写入/重复提交均为零；非法或不完整参数不得 commit。参考 Windows 机器上普通局部工具与增量可见 p95 ≤200ms，网络/模型等待单列；输入规模、机器和样本写入报告。

每个真实任务族在实施前冻结样本与成功判据，记录首次成功率、修复后成功、人工介入、得到正确成果的总时间及费用。编辑任务看正确范围与保存重开，图片看真实生成/参考输入与资源闭环，构建看可运行交互与导出。若换模型/费用路线则不把收益归于 harness；相同模型无法对齐时声明不可直接归因。

探针采用一轮明确样本和失败归因的时间盒；新变化/假设才能重试。结果不足则 experimental/blocked，不能无限重复付费以求绿色。循环网络重试遵循供应商限流与预算；响应状态未知不盲目发第二个收费任务。

本轮方案修订不跑这些产品门。以后实现按最小充分验证，历史有效证据可复用，不因审查者或会话改变重跑。
