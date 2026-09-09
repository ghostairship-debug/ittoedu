# r18-092-codex-interactive-adapter：接通Codex图片公开摘要提问纠正与原生回合控制

- Release: 1.8
- Dependencies: `r18-091-cli-model-controls`
- Optional: 否
- Write locks: `cli-adapter-codex`
- Gaps: G01, G04, G05, G06, G09

## 结果与现状

Codex app-server接收真实图片/文件、公开可读事件、提问回答和中途纠正，支持同任务多回合及准确取消；与相同配置和用户授权的外部Codex保留原生文件、终端、网络、工具连接、Skills及子任务能力。

V2 app-server transport已有工作区实现。2026-09-08[审查](../../reviews/1.8-first-batch-review.md)确认：初始化阶段进程退出不拒绝待处理RPC，open与取消可能一直等待；turn/start也未携带所选model。先修复失败收口及091实际配置接线，再补受影响真实路径，不把接口和专属单测存在当成完成。

当前thread/start与resume还固定read-only/never，命令/文件审批统一decline。按最新完整CLI方向，这些产品强加的裁剪须在原生配置和GUI授权接线后退出，不能把最小观察范围当成整个Codex的权限边界。

本批的已定位符号、固定原生映射、允许改动、退出点和精确检查见[首批执行包第6节](FIRST_BATCH_EXECUTION.md)。先用已预完成合同与真实样本，不重复探索其已确定边界。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/codexAppServer.ts](../../../../src/main/localAgent/codexAppServer.ts)
- [src/shared/localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)
- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/main/localAgent/candidateStaging.ts](../../../../src/main/localAgent/candidateStaging.ts)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)

## 允许写域与旧路径退出

Codex原生adapter、共用事件/桥中必要的Codex分支与脱敏fixture；不得修改Claude/OpenCode能力语义或复制调度器。

## 执行步骤

1. 用088已验证协议接通image/localImage和当前不可变观察；图片路径文本不算视觉输入。默认输入精简不限制原生工具继续获取材料，候选staging仅用于编辑器摄取。
2. 将正文/公开摘要/计划/工具/usage按原生item与sequence映射并去重；JSON仅供诊断。
3. 接通原生提问/授权的受支持回传、turn steer、interrupt及续轮；允许/拒绝/取消按原生语义到达CLI，验证request/expectedTurn等关联不误投任务，删除审批统一decline路径。
4. 候选与原生completed分离，接收host result后继续同一session；移除旧文本单轮消费路径。
5. 消费090/091确定的工作上下文和真实有效配置，删除固定read-only/never覆盖；不替用户提权、不绕过原生拒绝。保留原生工具连接、Skills和子任务发现，应用只加编辑器连接，不复制工具循环或建设独立MCP/RPC平台。

本次失败收口覆盖error、进程close、主动close及无响应：拒绝并清空全部待处理RPC，唤醒消费方；按初始化/配置/启动等阶段设置有界等待。close即使发现进程已退出也须结束尚未完成的Promise，重复关闭和退出竞态保持幂等。共享Harness清理由090/091协调者集成，叶子adapter不另建会话Owner。

## 验收与可信反例

- 识别已有选中图片无需用户再上传；可读进度、一次回答与中途纠正真实到达，模型/effort为091已确认配置。
- 反例：图片不可读、乱序/重复事件、旧turn纠正、断流后已提交receipt、Stop后候选不能产生重复或迟到工程写入。
- 复用立即exit(23)的初始化反例，验证open明确拒绝；初始化/配置/turn-start无响应后Stop/删除在规定期限结束，运行槽释放且能发起新任务。当前阶段零工程写，且不关闭其他CLI或用户进程。
- 在相同版本、账号、有效配置和授权的外部基线下，受影响文件/终端/网络及已有工具/Skill/子任务能力不被GUI裁剪；一个必要原生授权往返能允许、拒绝和取消。权限限制来自用户/CLI时如实显示，不能通过默认提权取得成功。
- 普通CLI文件生成与正式工程提交分开；root外制品、过期和迟到候选不能被宿主摄取或写入工程。此约束不禁止原生已授权的其他文件操作。

## 停止条件

已安装版本缺少必要原生能力时使用088支持矩阵明确阻断；不降为旧文本路径再标完成。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/codexAppServer.test.ts tests/unit/diagnosticLog.test.ts
```

真实Codex完成识图→小修改→宿主结果→续轮纠正并Stop；保持提示为普通语言，内部协议由产品产生。原生能力对等只补本次配置/授权改变影响的最少对照，复用088有效样本，在103汇合；不另跑全平台矩阵，不凭启动参数或工具列表宣称实际能力已保留。

## 回退与交接

交付Codex有效版本/模型、输入输出样本、事件去重和取消证据；100可直接消费相同task/observation/receipt语义。
