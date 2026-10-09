# 查询当前任务所需能力

工具和连接可用性统一见共享指南的[发现与可用性](../../workbench-usage/references/discovery.md)。内置读取用 `skills.read {skill:"workbench-usage",path:"references/discovery.md"}`；不通过跨根相对路径调用读取器。

普通 HTML 新建课件使用 `course.createFromHtml`，已有工程修订使用 `edit-content`。用户明确使用外部 Builder V2 时，`session.discover()` / `api.discover()` 和 `readCapability()` 提供该环境实际支持的能力，详见[外部构建](external-case-build.md)。只读所需合同。

承载边界按需读[承载方式](representation-capabilities.md)，具体缺口保留来源并按实际诊断说明。
