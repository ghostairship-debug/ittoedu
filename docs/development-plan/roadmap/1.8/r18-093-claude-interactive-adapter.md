# r18-093-claude-interactive-adapter：接通Claude双向原生会话图片提问纠正与取消

- Release: 1.8
- Dependencies: `r18-091-cli-model-controls`
- Optional: 否
- Write locks: `cli-adapter-claude`
- Gaps: G01, G04, G05, G06, G09

## 结果与现状

Claude原生程序化会话保持双向输入，能看图片、按需读文件、问答/纠正/取消，并从宿主结果继续任务；与相同配置和授权的外部Claude保留文件、终端、网络、原生工具连接、Skills和子任务能力。

独立双向Claude V2 transport已有工作区实现。2026-09-08[审查](../../reviews/1.8-first-batch-review.md)确认：open返回未交给CLI的随机会话ID，原生ID未被Harness同步，正常继续会恢复不存在的会话；模型/effort也只改变本地配置对象。先修真实身份与091配置链，不重建已有双向输入。

当前启动参数将工具限定为Read/AskUserQuestion，Read只接受Observation映射，其他工具授权一律deny。这些产品强加限制须退出；完整原生能力不等于替用户提高权限。

本批的已定位符号、固定原生映射、允许改动、退出点和精确检查见[首批执行包第6节](FIRST_BATCH_EXECUTION.md)。先用已预完成合同与真实样本，不重复探索其已确定边界。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/adapter.ts](../../../../src/main/localAgent/adapter.ts)
- [src/main/localAgent/claudeProcessTransport.ts](../../../../src/main/localAgent/claudeProcessTransport.ts)
- [src/main/localAgent/process.ts](../../../../src/main/localAgent/process.ts)
- [src/shared/localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)
- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)

## 允许写域与旧路径退出

Claude adapter和必要的共用process/事件接口；共享cwd/环境/合同由090/091唯一Owner集成，叶子只消费该规则。保留单一原生会话Owner，不以多次无关联CLI调用模拟正在运行的交互。

## 执行步骤

1. 依据088真实协议保持输入可用，建立question/input/turn关联和stdout背压/完成条件。
2. 图像通过原生内容输入，默认观察/能力文件按需附带；采用091确认的model/effort。更多资料可由CLI按原生授权读取，不以Observation映射作为全部Read权限。
3. 映射正文、公开摘要、计划、工具、提问与usage；中途补充/回答进入同一任务，取消关闭本任务资源。
4. 续轮接收真实receipt与新观察；切换consumer并删除对应stdin一次关闭路径，CLI内部仍掌握模型循环。
5. 删除固定Read/AskUserQuestion工具白名单和其他工具统一deny；保留原生工具、Skills、子任务与已有连接。按安装版本真实协议通过090在当前聊天壳提供的最小界面回传允许/拒绝/取消，不等待101，不改用户全局配置或默默提权。sdkMcpServers等空数组的含义以原生发现和调用核对，不臆断已有连接被清除。

新建会话ID只有实际用于原生会话且取得确认后，才能作为可恢复身份持久化；也可接收CLI生成的真实ID，但不得保存未确认随机占位值。统一将原生身份变化交给Harness，恢复只用已确认句柄；缺失或冲突明确失败，不静默开另一会话。原生stdin保持打开与进程结束后的应用“继续”恢复分别验证。

## 验收与可信反例

- 真实Claude识图、读取指定能力卡、等待教师回答、执行后根据宿主结果继续修改；UI输入接收与CLI消费可区别。
- 反例：输入关闭、未回答问题、服务断流、重复终态、取消后迟到、重启旧session不得假完成或重放候选。
- 模拟原生ID不同于临时值，核对最终磁盘记录及下一次resume参数；真实Claude首轮记住临时测试标记，结束该进程后经应用“继续”入口恢复并正确回答。adapter内部字段更新不能替代持久化恢复成功。
- 与相同有效配置的外部基线核对受影响原生工具/Skill/子任务和授权往返；原生允许的观察索引外资料可读取，原生拒绝仍有效。只从当前candidate root闭合制品或正式结构化通道摄取工程候选，不把CLI文件操作成功说成画布/History已提交。

## 停止条件

若程序化接口不支持必需交互，先用088证据更新最低版本/支持边界；不以重启进程丢失上下文的方式宣称原生续轮。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/claudeProcessTransport.test.ts tests/unit/diagnosticLog.test.ts
```

真实Claude完成与092同语义最小链；保留真实双向输入和取消确认，不把fixture/旧两轮源码修订代替新功能。能力对等只补工具/授权裁剪退出影响的有限实际对照，复用088尚有效证据并在103汇合，不重复三CLI完整任务矩阵。

## 回退与交接

交付输入生命周期、事件映射和异常清理证据；100只消费共用正式合同，不含Claude专属流程分支。
