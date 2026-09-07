# r18-092-codex-interactive-adapter：接通Codex图片公开摘要提问纠正与原生回合控制

- Release: 1.8
- Dependencies: `r18-091-cli-model-controls`
- Optional: 否
- Write locks: `cli-adapters`, `main-preload`, `ai-session`
- Gaps: G01, G04, G05, G06, G09

## 结果与现状

Codex app-server接收真实图片/文件、公开可读事件、提问回答和中途纠正，支持同任务多回合及准确取消。

现有app-server已能提交文字/包源码候选，但turn输入为文本，部分摘要/计划事件未投影，不能据此宣布插件体验。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/codexAppServer.ts](../../../../src/main/localAgent/codexAppServer.ts)
- [src/main/localAgent/protocol.ts](../../../../src/main/localAgent/protocol.ts)
- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/main/localAgent/candidateStaging.ts](../../../../src/main/localAgent/candidateStaging.ts)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)

## 允许写域与旧路径退出

Codex原生adapter、共用事件/桥中必要的Codex分支与脱敏fixture；不得修改Claude/OpenCode能力语义或复制调度器。

## 执行步骤

1. 用088已验证协议接通image/localImage、只读观察文件与候选staging；图片路径文本不算视觉输入。
2. 将正文/公开摘要/计划/工具/usage按原生item与sequence映射并去重；JSON仅供诊断。
3. 接通原生提问/审批的受支持回传、turn steer、interrupt及续轮；验证expectedTurn等关联不误投任务。
4. 候选与原生completed分离，接收host result后继续同一session；移除旧文本单轮消费路径。

## 验收与可信反例

- 识别已有选中图片无需用户再上传；可读进度、一次回答与中途纠正真实到达，模型/effort为091已确认配置。
- 反例：图片不可读、乱序/重复事件、旧turn纠正、断流后已提交receipt、Stop后候选不能产生重复或迟到工程写入。

## 停止条件

已安装版本缺少必要原生能力时使用088支持矩阵明确阻断；不降为旧文本路径再标完成。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts tests/unit/editorTransaction.test.ts
```

真实Codex完成识图→小修改→宿主结果→续轮纠正并Stop；保持提示为普通语言，内部协议由产品产生。

## 回退与交接

交付Codex有效版本/模型、输入输出样本、事件去重和取消证据；100可直接消费相同task/observation/receipt语义。
