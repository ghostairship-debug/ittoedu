# 模型收藏、连接分组与统一思考配置实施记录

日期：2026-10-03。状态：工程候选，保留当前工作树；未提交、未发布。

## 用户结果

- 模型快捷菜单默认只显示用户收藏。空收藏显示入口提示，不自动把当前模型或 OAuth 模型加入收藏；再次打开仍从收藏列表开始。
- “更多模型”按实际接入连接分组，显示 Provider、账号/套餐和计费类型，可按连接或模型搜索。相同模型在 TeamoRouter、DeepSeek 官方和其他套餐下是独立条目。
- 星标与选择模型是独立操作。收藏以 `connectionId + model` 保存到既有 ExecutionSettingsStore，不绑定连接 revision，不复制凭据或模型参数。取消当前收藏不切换当前模型，不改变角色配置或高级参数。目录暂不可读取时已有收藏仍可选择；撤销或缺失的连接保留收藏并显示不可用。
- 思考档位统一解析：连接目录明确声明优先，包含显式空列表；缺失时由已核实的模型家族与现有协议补充。选择后由软件维护相应请求参数，模型 ID 和路由保持原值。不按套餐、域名或中转品牌分别硬编码。

## 实现与证据边界

`src/shared/workbench/modelReasoning.ts` 是档位说明与参数映射的唯一实现。UI 删除旧 OAuth 专用重复表。目录同时接受 `supported_reasoning_efforts/default_reasoning_effort` 与 `effort.supported_levels/default_level`。

DeepSeek V4/V4.1 使用 `thinking.type` 和 `reasoning_effort` 联动；“关闭”显式关闭思考，默认移除受管字段，无关高级选项保留。官方档位为低、高、最高；不同名称对应实际档位的映射见 [DeepSeek 官方说明](https://api-docs.deepseek.com/guides/thinking_mode/)。已知 GPT 使用当前协议对应的 Chat 标量或 Responses 对象；已知 Gemini 使用其 [OpenAI 兼容参数](https://ai.google.dev/gemini-api/docs/openai)。未核实的型号和 Claude 兼容参数保留未知及高级输入入口，未知模型点击默认不会清除高级 reasoning 字段。

本会话只读核实的 TeamoRouter `/v1/models` 目录有 47 项，未声明思考档位。目录缺字段不能证明模型不支持，也不能从 API 成功推断具体强度实际生效。文档补充在菜单明确标为当前连接未经验证；本轮未做逐档付费探针、未发送模型生成请求，也未新增请求、工具、token 或任务时长额度。

对 GPT-6 Astra/6.1 Sol，以及启用思考的 GPT-6 Sol/Luna，现有说明区展示 [官方上游工具调用对 Responses 的要求](https://developers.openai.com/api/docs/guides/latest-model)。该说明不禁止选择，不宣称中转已完成协议转换。当前 `chatgpt-responses` 仍是 OAuth 连接，本轮不扩展为第三方 API 的通用 Responses 适配器。

## 最小充分验证

- `g20ModelFavorites.test.ts`：两项通过；首项走真实 Desktop Service → Store。覆盖保存重开、不同连接的同名模型、连接版本变化、取消不改变 profile、旧设置缺字段默认空列表，以及既有串行 writer 的并发更新。
- `g20ModelReasoning.test.ts` 与 `g20ApiReasoningCatalog.test.ts`：首批 11 项通过，后续只对未知参数保留的一个用例和协议说明的两个用例进行受影响验证，均通过。实际 Provider 序列化检查覆盖 DeepSeek、GPT、Gemini Chat 和 OAuth Responses 的请求正文，无网络生成调用。
- `g20ExecutionAssistant.test.tsx`：菜单、收藏、切换、目录优先和思考选择相关 11 项通过；root 补充 Chat 协议说明及 OAuth 不显示该说明后，受影响两项通过。其他聊天、课件与真实模型矩阵未重跑。
- agent-browser 驱动真实 Chromium 渲染实际 `ExecutionAssistant` 组件及样式。默认收藏、更多模型的连接分组、搜索指定连接和星标操作通过；给 DeepSeek 官方同名模型加星后当前仍为 TeamoRouter 模型，原高档和 temperature 保留，角色保存和模型调用均为 0。该证据是实际组件 fixture，不冒称完整 Electron 集成实测。
- 集成后 Renderer/Electron 类型检查与两端构建通过。独立只读审查未发现本轮收藏、连接绑定、参数映射及 IPC 接线的实际问题。已有无关证据继续有效。

截图、可复查 fixture 和实际操作结果：`output/model-picker-reasoning/`。root 已查看默认收藏和更多连接分组截图，按钮、星标及菜单显示正常。所有隔离工作树保留，未清理共享依赖。

剩余边界：自动展示依据来自目录或官方模型说明；中转实际是否执行相应强度仍取决于该服务。未知型号可通过高级参数配置，不能声称所有第三方 API 都提供可自动查询的思考能力目录。
