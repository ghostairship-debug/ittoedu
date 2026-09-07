# r18-091-cli-model-controls：按三CLI真实能力发现模型强度与会话配置

- Release: 1.8
- Dependencies: `r18-090-ai-task-contract`
- Optional: 否
- Write locks: `cli-adapters`, `main-preload`
- Gaps: G04

## 结果与现状

UI可取得三CLI真实模型、推理强度及会话能力，用户选择可被原生确认并实际进入请求；不再硬编码low或Big Pickle。

本机原生协议已暴露模型信息，但产品选择与请求未贯通；不同CLI/模型的能力和默认值并不相同。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/codexAppServer.ts](../../../../src/main/localAgent/codexAppServer.ts)
- [src/main/localAgent/openCodeAcp.ts](../../../../src/main/localAgent/openCodeAcp.ts)
- [src/main/localAgent/adapter.ts](../../../../src/main/localAgent/adapter.ts)
- [src/main/localAgent/service.ts](../../../../src/main/localAgent/service.ts)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)

## 允许写域与旧路径退出

LocalAgent模型/配置发现、Main/preload窄桥与唯一非秘密偏好；UI控件由101消费。禁止Renderer传任意启动参数、凭据或未知模型字段。

## 执行步骤

1. 按090合同实现原生模型与能力枚举、缓存和失效；CLI版本/账户/模型目录变化重新发现。
2. 将model/effort/mode的期望值与原生确认值分开；切换模型清除不再合法的effort，采用该模型真实默认。
3. start/resume/运行中配置采用原生支持时机；尚未生效显示待切换，不以UI选中值冒充实际请求配置。
4. 删除硬编码策略；为101提供同一可读状态与错误，不在聊天维护第二模型列表。

## 验收与可信反例

- 每CLI选用不同于原默认的可用模型并查看实际请求/原生确认；支持effort的模型可切换且真实生效。
- 反例：模型下架、CLI未登录、无effort选项、运行中不支持切换、恢复到不兼容模型时明确状态，人工编辑正常。

## 停止条件

若当前CLI无法发现某能力，给出最低版本或明确不支持，不填假选项；不借此添加自有Provider配置。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts tests/unit/coursewareSkillsContract.test.ts
```

真实三CLI各验证一次发现→选择→请求确认，复用088尚有效样本；模型差异不混用为同一行为证据。

## 回退与交接

交付capability/配置消费API、失效规则和101显示样例；错误保留最后有效偏好，不能静默启动另一个模型。
