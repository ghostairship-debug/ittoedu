# r18-093-claude-interactive-adapter：接通Claude双向原生会话图片提问纠正与取消

- Release: 1.8
- Dependencies: `r18-091-cli-model-controls`
- Optional: 否
- Write locks: `cli-adapters`, `main-preload`, `ai-session`
- Gaps: G01, G04, G05, G06, G09

## 结果与现状

Claude原生程序化会话保持双向输入，能看图片、按需读文件、问答/纠正/取消，并从宿主结果继续任务。

当前stdin一次写完后关闭；输出流式不等于输入可持续交互。现有候选成功证据仅证明当前单轮路径。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/adapter.ts](../../../../src/main/localAgent/adapter.ts)
- [src/main/localAgent/process.ts](../../../../src/main/localAgent/process.ts)
- [src/main/localAgent/protocol.ts](../../../../src/main/localAgent/protocol.ts)
- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)

## 允许写域与旧路径退出

Claude adapter和必要的共用process/事件接口；保留单一原生会话Owner，不以多次无关联CLI调用模拟正在运行的交互。

## 执行步骤

1. 依据088真实协议保持输入可用，建立question/input/turn关联和stdout背压/完成条件。
2. 图像通过原生内容输入，能力/资源经授权观察文件按需读；采用091确认的model/effort。
3. 映射正文、公开摘要、计划、工具、提问与usage；中途补充/回答进入同一任务，取消关闭本任务资源。
4. 续轮接收真实receipt与新观察；切换consumer并删除对应stdin一次关闭路径，CLI内部仍掌握模型循环。

## 验收与可信反例

- 真实Claude识图、读取指定能力卡、等待教师回答、执行后根据宿主结果继续修改；UI输入接收与CLI消费可区别。
- 反例：输入关闭、未回答问题、服务断流、重复终态、取消后迟到、重启旧session不得假完成或重放候选。

## 停止条件

若程序化接口不支持必需交互，先用088证据更新最低版本/支持边界；不以重启进程丢失上下文的方式宣称原生续轮。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts tests/unit/coursewareSkillsContract.test.ts
```

真实Claude完成与092同语义最小链；保留真实双向输入和取消确认，不把fixture/旧两轮源码修订代替新功能。

## 回退与交接

交付输入生命周期、事件映射和异常清理证据；100只消费共用正式合同，不含Claude专属流程分支。
