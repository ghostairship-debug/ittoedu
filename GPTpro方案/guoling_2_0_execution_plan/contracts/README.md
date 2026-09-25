# 接口设计样例

`workbench-contracts.ts`是目标边界的可类型检查样例，不包含真实实现。用于讨论和落实文档、工具、运行时、内容流与事件的职责；不能直接导入产品并宣称功能完成。

模型只接触`ModelToolCall`的短目标和输入，宿主再生成`CommandEnvelope`。调用者不能通过模型输入自报权限、文档revision、actor或持久化状态。业务参数的完整Schema来自已有工具注册表，不在此重写一套。

Driver内部各自保有Markdown源文或V9课件模型。本例没有统一超级文档。Example JSON中的内容均为结构样例，不含用户凭据和真实执行回执。

2026-09-23 后续边界补充：样例中的 `live/build/media`、`build/image` 和文档授权字段只描述当前能力，不是永久封闭的工具/job 分类，也不是所有任务必须有文档目标的要求。后续格式拥有独立模型，文件、scratch、进程和外部作业按真实需求补相应宿主授权与结果语义；不得借扩展类型允许模型自报权限或绕过文档 writer。具体名称和接口可以等价调整，不要求实现固定清单。本次只补文档，未改 TypeScript 样例或产品公共类型；详细范围见 [L03](../long_term/L03.md)。

类型验证命令（需要本地TypeScript，属于方案检查）：

```bash
node ../../node_modules/typescript/bin/tsc --ignoreConfig --strict --noEmit --target ES2022 --module ES2022 contracts/workbench-contracts.ts
```

设计样例通过类型检查，不证明产品网关、权限、持久化或模型调用已经实现。

上述命令从执行包目录运行，使用仓库当前 TypeScript；`--ignoreConfig` 显式忽略根 tsconfig，避免把样例误纳入产品编译。独立阅读包需自行提供 TypeScript。

修订样例新增 Connection/Auth 与 Billing 分离、按角色的 ExecutionProfile、read/operation/job 工具结果、MCP 操作票据、事实交接、受控构建与媒体 Provider。MCP wrapper 连接同一文档服务；票据可随观察结果预发，一次普通写入不要求增加固定模型轮。

EditContentDecoder 只把目标绑定且已确认解码的文本映射为草稿事件；完整工具参数校验后才可提交。Provider 的截断/失败终态不能当作成功 complete。实际具体 schema、状态机、隔离与持久化仍待实现和行为测试。
