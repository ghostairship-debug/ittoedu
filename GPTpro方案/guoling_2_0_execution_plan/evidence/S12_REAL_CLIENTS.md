# S12 两种真实外部客户端：工程证据

记录：2026-09-23，Asia/Shanghai。本记录不替代正式包 REL-T12 或 Owner 验收。

## 结论与边界

S12-T01 的 real-engine 断面已通过：Codex CLI 0.155.1 与 OpenCode 1.18.26 使用同一份源码生产 `ExternalMcpService`、`McpDocumentServer`、`DocumentHostService`、Gateway、Registry 和 durable journal，实际发现、读取、修改同一个未保存 Markdown 文档并查询正式回执。没有用两个自写 HTTP/SDK 客户端冒充外部客户端，没有第二套领域实现。

这不是首次成功：两轮付费尝试先失败，第三轮在分别修正已定位的客户端配置、资源入口、票据说明后完成。失败记录保留；没有换模型、换计费路由或同因盲目重试。

REL-T12 仍未运行：此次没有使用正式安装包，也没有在正式包中完成“内置任务部分提交 → 外部接手 → 继续 → 撤权”的完整界面链。S12-T02 的真正并发、多 bridge 关闭重连，以及其他安全/磁盘冲突场景复用各自 integration/windows 证据，不能由本次顺序 CLI 修改替代。此断面没有验证保存、重开或导出。

## 真实模型和账号边界

| 客户端 | 运行前实际配置核对 | 本次固定选择 | Fast 与计费记录 |
| --- | --- | --- | --- |
| Codex 0.155.1 | `codex login status` 为 Logged in using ChatGPT；当前公开模型目录列出 Luna 的 priority/Fast 能力 | `gpt-5.6-luna`，OpenAI / 现有 ChatGPT OAuth，medium reasoning | `service_tier="fast"`、`features.fast_mode=true`；请求 Fast，未从服务端另行确认实际队列级别或费用；不推断套餐名 |
| OpenCode 1.18.26 | `opencode auth list` 为 OpenAI oauth；`models openai --verbose --pure` 将 `gpt-5.6-luna-fast` 映射到 API `gpt-5.6-luna`，`serviceTier:priority` | `openai/gpt-5.6-luna-fast`，OpenAI OAuth，medium variant；原生资源消息也记录相同 provider/model/variant | 请求 priority；CLI 输出 cost=0 是其客户端元数据，不能据此声称账号实际免费或无额度消耗 |

只解析公开配置/模型元数据与登录状态，没有打开 OAuth 凭据文件，没有读取/输出令牌。运行时 MCP bearer 只通过子进程环境传递，落盘配置保留环境变量引用，日志作 bearer 脱敏。Claude 的公开模型配置与认证状态存在混合信息，本次未选择；未运行 Claude/DeepSeek，也不对该通道推断通过。

## 成功运行

命令：`npx tsx scripts/g20-external-cli-probe.ts --clients=codex,opencode --run`

原始目录：`output/g20/s12-cli/2026-09-22T20-52-23-661Z/`（本地 2026-09-23 04:52）。完整状态见 `report.json`，客户端原始调用见 `codex-stdout.jsonl`、`opencode-stdout.jsonl`。

| 客户端 | 实际行为 | CLI 用时 | 正式结果 |
| --- | --- | --- | --- |
| Codex | 原生 MCP 发现与 resource 读取；read → text.replace → operation.lookup → read | 36.494 秒 | 1 次 applied，revision 0→1；lookup 返回同一 operationId；KEEP_ORIGINAL 与 OPENCODE_SLOT 保留 |
| OpenCode | 原生 MCP 发现；真实 `opencode serve --pure` 自己读取 resource 附件，再由 `opencode run --attach --session` 驱动 Luna；read → text.replace → operation.lookup → read | 33.126 秒 | 1 次 applied，revision 1→2；lookup 返回同一 operationId；KEEP_ORIGINAL 与 CODEX_LUNA_OK 保留 |

两个授权在 revision 0 就已冻结。OpenCode 在 Codex 修改后使用原先授权的另一段，实际范围映射仍正确。同一 `documentId=2c547b01-87c6-4b37-a854-30ba9f46ba05`，最终 RegistryCount=1、revision=2、undoDepth=2；正文为 `KEEP_ORIGINAL\nCODEX_LUNA_OK\nOPENCODE_LUNA_OK\n`。

正式 operationId：Codex `tool:4a42369a805d901a440ad9326ff543d1096fc7dc130142cfe6b705af2f424020`；OpenCode `tool:c0c5d807488201c891842a1595a10ffdaf1eeef62df42f1ce76ced3e437a78f4`。两项回执为 `persistence:recoverable`，不是已保存文件的声明。

运行后两个授权均 revoked。`opencode-after-revoke.json` 记录真实 `opencode mcp list --pure` 对同 endpoint 返回 401；该 CLI 仍以 exitCode=0 退出，因此按真实连接结果记录撤权生效，绝不将退出码本身当成功。

## 配置摩擦、修复与失败记录

- `2026-09-22T20-38-10-385Z`：无费 OpenCode 原生发现成功，只记配置/发现，不记模型验证。
- `2026-09-22T20-38-46-094Z`：首轮各 0 commit。Codex 已发现/读 resource，但本地 MCP 审批设置拒绝 inspect；OpenCode 将资源 URI 错当 domain target，Gateway 拒绝 invalid-target。
- `2026-09-22T20-46-15-075Z`：无费 OpenCode 原生 resource 附件缺 source.text，被客户端自身 schema 拒绝，没有模型请求。
- `2026-09-22T20-47-03-896Z`：无费 OpenCode `noReply` 原生 resource 附件成功，`opencode-native-resource.json` 保存其真实读取结果。探针没有 SDK 代读。
- `2026-09-22T20-47-21-586Z`：第二轮各 0 commit。Codex 无点工具预授权生效，点号工具的逐字段 CLI 配置未命中；OpenCode 把读取使用过的票据再交给修改，Gateway 正确拒绝 operation-payload-mismatch。
- `2026-09-22T20-50-06-714Z`：无费 Codex app-server 命令不支持 exec 专用的 ignore-user-config 参数，未发模型请求。
- `2026-09-22T20-50-48-433Z`：无费 app-server config/read 证实仅允许 read/text.replace/operation.lookup，server approval_mode=approve；使用独立空配置目录核对，未读取凭据。正式 exec 继续使用现有 OAuth、read-only Shell，没有升级 Shell 权限。
- 成功轮同时保留 `codex-effective-mcp-config.json` 和 `opencode-native-resource.json`。OpenCode 普通 run 文本不提供模型 resource-reader；原生 resource source 附件才会触发客户端自身的 readResource。正式 TUI 用户应使用其资源附件入口。

产品修复：`resources/templates/list` 返回只读空表，继续经过 origin、session、grant 检查；初始化说明、context.ticketRule 与所有领域工具 ticket.description 共用规则：每个不同调用（含只读）使用新票据，只读可省略由宿主分配；只有查询/重试同一调用才复用原票据、工具名及完全相同的参数。此说明对日常客户端可见，不仅存在于验收提示。

## 最小充分工程核验

`npx vitest run tests/integration/g20McpClientRules.test.ts --reporter=verbose`

- 04:52:08：1 file / 1 test passed，0 skipped，1.21 秒。真实 HTTP、官方 SDK、DocumentHost/Gateway/Registry，验证同源 schema、票据规则、读取票据不可用于修改、lookup 同正式 receipt、空 templates、Origin/撤权守卫。SDK 验证单独标注，不冒充两 CLI。
- 此前该新增测试误将临时 affected 句柄也要求 lookup 完全相同而失败；合同只要求正式 receipt 相同，纠正断言为 receipt 比较后通过。未放宽正式文档/History/operationId 断言。
- 04:55:06：在随后 M09 工具事实接线后必要复验同一项，1/1 passed、0 skipped、1.21 秒。真实 EventStore 检查 input/output/error、applied/documentId/operationId/revision，不伪造 saveStatus、外部 reasoning/usage/run.end。未重跑收费 CLI。

后续 M09 只增加实际工具事件详情与异常结算，未改变领域 schema、票据、授权或正式 writer。CLI 断面证据按工作协议继续有效。

## 来源与恢复执行

探针脚本为 `scripts/g20-external-cli-probe.ts`，不传 `--run` 时仅做无费配置/原生资源检查。重跑收费前仍须重新确认当时实际 CLI 版本、OAuth/模型目录和已授权路由；脚本固定 Luna，不自动换模型、不循环付费重试。

客户端依据：[Codex MCP 配置](https://learn.chatgpt.com/docs/extend/mcp)、[Codex Fast](https://learn.chatgpt.com/docs/agent-configuration/speed#fast-mode)、[OpenCode server 正式 API](https://opencode.ai/docs/server/)、[OpenCode 1.18.26 原生 resource 附件实现](https://github.com/anomalyco/opencode/blob/v1.18.26/packages/opencode/src/session/prompt.ts)、[OpenCode 1.18.26 CLI run 参数实现](https://github.com/anomalyco/opencode/blob/v1.18.26/packages/opencode/src/cli/cmd/run.ts)。没有从历史 Luna 路由推断本次通道。
