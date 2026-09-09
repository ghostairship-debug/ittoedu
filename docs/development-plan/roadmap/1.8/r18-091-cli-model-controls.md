# r18-091-cli-model-controls：按三CLI真实能力发现模型强度与会话配置

- Release: 1.8
- Dependencies: `r18-090-ai-task-contract`
- Optional: 否
- Write locks: `cli-adapter-codex`, `cli-adapter-claude`, `cli-adapter-opencode`, `main-preload`, `ai-session`
- Gaps: G04

## 结果与现状

UI可取得三CLI真实模型、推理强度、有效配置与会话能力，用户选择可被原生确认并实际进入请求；不再硬编码low或Big Pickle。同一账号、版本、工作上下文和授权下保留原生配置，不因进入GUI裁剪原生工具或默默提高权限。

2026-09-08审查：能力目录与配置接口已有实现，但Harness只保存偏好，新adapter直接open/startTurn；Codex漏传所选model，Claude只改本地current，没有原生模型/effort控制。详见[首批审查](../../reviews/1.8-first-batch-review.md)。本节点仍未完成，不能用配置返回对象或目录发现成功代替请求生效。

本批的已定位符号、固定原生映射、允许改动、退出点和精确检查见[首批执行包第5节](FIRST_BATCH_EXECUTION.md)。先用已预完成合同与真实样本，不重复探索其已确定边界。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/codexAppServer.ts](../../../../src/main/localAgent/codexAppServer.ts)
- [src/main/localAgent/openCodeAcp.ts](../../../../src/main/localAgent/openCodeAcp.ts)
- [src/main/localAgent/adapter.ts](../../../../src/main/localAgent/adapter.ts)
- [src/main/localAgent/service.ts](../../../../src/main/localAgent/service.ts)
- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/main/localAgent/process.ts](../../../../src/main/localAgent/process.ts)
- [src/main/localAgent/claudeProcessTransport.ts](../../../../src/main/localAgent/claudeProcessTransport.ts)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)

## 允许写域与旧路径退出

LocalAgent模型/有效配置发现、Main/preload窄桥与唯一非秘密偏好；UI控件由101消费。共享启动上下文由090的唯一Owner接线，三adapter消费同一规则。禁止Renderer传任意启动参数、凭据或未知模型字段；这不授权过滤掉原生CLI所需配置、环境、Skills或用户工具连接。

## 执行步骤

1. 按090合同实现原生模型与能力枚举、缓存和失效；CLI版本/账户/模型目录变化重新发现。
2. 将model/effort/mode的期望值与原生确认值分开；切换模型清除不再合法的effort，采用该模型真实默认。
3. start/resume/运行中配置采用原生支持时机；尚未生效显示待切换，不以UI选中值冒充实际请求配置。
4. 删除硬编码策略；为101提供同一可读状态与错误，不在聊天维护第二模型列表。
5. 区分原生有效配置与应用显式偏好，未选择的配置沿用CLI自身规则。核对用户/目录配置、必要环境和工作目录的实际发现，候选根不机械替代原生工作上下文；配置变更只在原生支持的边界生效，不能以统一read-only/never或工具白名单覆盖用户授权。

修复顺序：先由Harness在每次新建/恢复的合法边界应用唯一偏好，再由Codex将model/effort进入实际thread/turn、Claude使用安装版本已证实的原生配置入口、OpenCode消费原生配置确认。配置失败或确认不一致不得假报current，也不得静默启动默认模型。运行中不能立即生效时记录待切换，在下一合法边界确认；只保存非秘密配置，不修改用户全局CLI设置。

用户已有MCP或其他原生工具连接、Skills和子任务由CLI继续管理；应用只提供所需窄配置/授权接线，不自建MCP服务或工具RPC。空mcpServers/sdkMcpServers数组不能单独证明已有连接消失或保留，必须以实际发现与调用为证据。

原生授权的最小请求/回答界面由090在当前聊天壳交付，092–094基础门直接消费；091负责有效配置和原生支持的选项，不等待101。101只完善配置展示与整体任务可用性，不能形成100等待adapter、adapter又等待101的隐性依赖。

## 验收与可信反例

- 每CLI选用不同于原默认的可用模型并查看实际请求/原生确认；支持effort的模型可切换且真实生效。
- 反例：模型下架、CLI未登录、无effort选项、运行中不支持切换、恢复到不兼容模型时明确状态，人工编辑正常。
- 新建和恢复测试从Harness入口捕获实际原生wire，断言所选model/effort与确认相符；覆盖原生拒绝、确认值不一致和无合法effort。只断言configured.current的单测不能作为本节点出口。
- 使用无秘密的配置夹具证明工作目录、配置来源与必要环境不会被宿主静默替换；原生授权模式在新建/恢复后保持，未经用户授权不能提高权限。真实工具/授权行为随092–094和103的受影响对照汇合。

## 停止条件

若当前CLI无法发现某能力，给出最低版本或明确不支持，不填假选项；不借此添加自有Provider配置。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/diagnosticLog.test.ts tests/unit/codexAppServer.test.ts tests/unit/claudeProcessTransport.test.ts tests/unit/openCodeAcp.test.ts
```

真实三CLI各验证一次发现→选择→请求确认，复用088尚有效样本；模型差异不混用为同一行为证据。

## 回退与交接

交付capability/有效配置消费API、来源及失效规则和101显示样例；错误保留最后有效偏好，不能静默启动另一个模型或使用另一权限模式。
