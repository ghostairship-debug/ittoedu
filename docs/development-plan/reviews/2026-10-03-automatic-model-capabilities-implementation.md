# 自动补全模型能力与统一协议实施记录

日期：2026-10-03。状态：工程候选，本轮实现与聚焦验证已完成；未提交、未发布。保留当前工作树及此前已有改动，未修改用户连接、凭据或课件。

## 交付行为

模型思考配置改为软件补充资料并维护协议参数：先采用当前连接目录明确提供的档位（包括显式空列表），缺失时使用公开型号资料，再由已核实的型号与协议规则补充。仍无法识别的别名可在菜单或连接设置中搜索、选择参考型号，无需手填 JSON。参考只用于识别能力，实际请求仍使用用户选定的模型 ID、原连接和计费来源。

模型菜单保留默认收藏列表，“更多模型”按实际接入连接分组；收藏绑定 `connectionId + model`。同名模型在不同连接下保持独立。TeamoRouter API 预置为按量付费，界面展示各连接保存的计费类型，不根据公开型号资料推断套餐或改写账单。

离散强度、思考开关、固定思考与原生数值思考配置分别展示。Claude Haiku/Sonnet 4.5 的思考 token 数是 Anthropic 协议参数，包含其不小于 1024 的要求；这不是 Agent 任务额度。本轮未新增请求、工具、总 token、任务时长或子任务次数上限。

## 资料与执行边界

`ModelKnowledgeService` 使用 [models.dev 公共目录](https://models.dev/api.json)、本地缓存与随软件分发的规范化快照，保留来源、时间与 MIT 许可。公共读取不携带 Provider 凭据。资料超过 24 小时后后台刷新，先返回已有资料；网络或缓存写入失败继续使用可用资料。内置快照可由 `scripts/refresh-model-knowledge.ts` 更新。

实际模型 ID 查询先匹配当前连接供应商，手选参考型号使用完整 `provider/id` 键优先，避免将另一供应商的同名请求 ID 当作参考。连接目录只持久化自身声明，公共补充资料由知识服务持有；任务快照重新补充当前资料，旧公共 metadata 不覆盖刷新结果。菜单再次打开也重新读取免费公共资料。

资料声明不等于当前代理已经执行相应强度。缺少资料保留未知，固定思考不虚构关闭档，未知数值格式不猜参数。界面保留相应来源与执行边界说明。

## 四类协议

| 协议 | 请求与认证 | 本轮行为 |
|---|---|---|
| OpenAI Chat | 原连接 `/chat/completions`、API Key | 保留既有接口；软件写入已识别型号的思考参数。 |
| OpenAI API Responses | 原连接 `/responses`、API Key | 新增 API 适配，与 OAuth 共用 SSE 和原生续轮处理。 |
| Anthropic Messages | 原连接 `/v1/messages`、API Key 与版本头 | 新增原生思考、签名块及工具结果续轮。 |
| ChatGPT Responses | 既有 Codex 后端、OAuth 与账号头 | 保留原登录、账号与请求行为。 |

显式协议选择有效。对于已知支持多协议的 TeamoRouter 连接，Claude 自动使用 Messages，匹配的 GPT 文本型号使用 API Responses；其他连接按其配置，不推断任意代理均支持全部端点。协议选择冻结在任务 `apiProtocol`，凭据解析仍核对原连接身份，模型 ID 与计费不替换。

序列化、上下文计量和实际传输共用协议路由。原生 Responses 保留加密思考内容与工具 call ID，Messages 保留签名思考与 redacted 块；不同协议的原生续轮明确拒绝，避免丢失状态。Messages 必需的 `max_tokens` 来自显式选择或型号输出窗口，上下文预留与之对应。辅助摘要对预算型 Anthropic 思考关闭并清除其预算，避免与摘要输出窗口冲突；主任务选择保持冻结。

## 最小充分验证

- **真实 TeamoRouter 只读目录**：前序调查的 `GET /v1/models` 返回 47 项，未声明思考档位。这证明目录缺字段，不证明上游强度已经生效；本轮没有向远程模型发送付费生成或逐档探针。
- **本地 HTTP/SSE 与执行链**：`g20ModelKnowledge.test.ts` 覆盖公共资料读取、无凭据请求、同连接优先、显式参考、缓存重开、后台刷新和旧补充资料替换；`g20AutomaticModelCapabilities.test.ts` 覆盖目录、角色持久化、冻结协议、原凭据解析与原模型请求。`g20AnthropicMessagesProvider.test.ts`、`g20OpenAIResponsesProvider.test.ts` 与既有 `g20ChatGPTProviders.test.ts` 通过本地 Node HTTP/SSE 验证原生思考、工具两轮续接、协议隔离、取消及失败行为。`g20S05ContextRecovery.test.ts` 的真实 Engine 用例确认预算型摘要参数正确且不改变主选择。
- **控件与实际呈现**：受影响的 `g20ModelReasoning.test.ts`、`g20ApiReasoningCatalog.test.ts`、`g20ExecutionAssistant.test.tsx`、`g20ExecutionSettingsPanel.test.tsx` 用例通过，覆盖参数映射、直接参考选择及 Haiku 数值设置。真实 Chromium 渲染实际组件与样式，设置 API 使用 fixture；Claude 强度、Haiku 思考控件及未知别名参考完成操作验证，不冒称完整 Electron 或远程生成验证。
- **最终集成**：Renderer/Electron 类型检查及两端构建均退出 0，日志位于 `output/automatic-model-capabilities/*-final.log`。各轮仅复验受影响属性，未重跑全矩阵。

最终浏览器观察见 [alias-reference-observed.json](../../../output/automatic-model-capabilities/ui/alias-reference-observed.json)：选择参考 `anthropic/claude-opus-4-6` 后，实际模型仍为 `private-alias`，连接仍为 `router-metered` 按量账号，保存参数为 `thinking.type=adaptive` 与 `output_config.effort=high`；原收藏数组未变，模型调用数为 0。截图与可复查组件 fixture 位于 [UI 证据目录](../../../output/automatic-model-capabilities/ui/)。

剩余边界是远程服务实际接受并执行各型号强度，尚未付费实测；本轮交付的是自动配置、正确协议装配与本地行为验证，不将公开资料、请求参数或目录读取记作代理执行能力已验证。
