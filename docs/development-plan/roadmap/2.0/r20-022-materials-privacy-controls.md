# r20-022-materials-privacy-controls：完成常见材料支持与引用删除数据控制

- Release: 2.0
- Dependencies: `r20-011-first-use-risk-notice`, `r15-020-material-tools-citations`, `r19-040-session-persistence-deletion`, `r19-045-material-context`
- Optional: 否
- Write locks: `main-preload`, `contracts-schema`, `workspace-shell`

## 结果与现状

教师通过软件上传和理解常见课程材料，逐项管理默认引用、来源与应用记录；删除、首次保存/Save As和导出边界可复查。2.0材料支持范围与真实读取能力一致，不要求外部AI或终端先行预处理。

045负责材料结构/分片Owner；按2026-09-15 Owner决定，PDF、DOCX、PPTX三类基本材料读取及真实创作消费必须在1.9完成，不能延期由本节点兜底。本节点消费其真实交付结果与已有文本能力，完善独立图片等其他承诺格式、生产体验和数据控制。复杂/受保护/损坏材料的边界必须准确，不能用“已上传”替代“已读懂”。

## 开始前与阅读入口

核对[产品方案第6/8节](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)、[开发计划](../../AI_ASSISTANT_DELIVERY_PLAN.md)、[架构合同](../../ARCHITECTURE_CONTRACT.md)、[工作协议](../../WORKING_PROTOCOL.md)与[共同实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)。

- [materialContract.ts](../../../../src/shared/materialContract.ts)、[materialRepository.ts](../../../../src/main/materialRepository.ts)、[materialService.ts](../../../../src/main/materialService.ts)：原件/提取状态、片段读取和缓存删除。
- [MaterialLibraryDialog.tsx](../../../../src/renderer/ui/MaterialLibraryDialog.tsx)、[CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)：上传、来源、取消默认引用和错误恢复。
- [generationSnapshot.ts](../../../../src/renderer/authoring/generation/generationSnapshot.ts)、[materialCitationTool.ts](../../../../src/renderer/authoring/tools/materialCitationTool.ts)：实际默认输入与课程可携带引用。
- [localAgent/repository.ts](../../../../src/main/localAgent/repository.ts)、[workspaceIdentity.ts](../../../../src/main/workspaceIdentity.ts)：040/042现有范围删除与身份。
- [courseProjectArchive.ts](../../../../src/renderer/project/courseProjectArchive.ts)、[buildCoursePackages.ts](../../../../src/renderer/export/course/buildCoursePackages.ts)：工程/Published/HTML数据边界。

## 允许写域与旧路径退出

既有材料提取与窄服务、Main/preload/合同、Workspace引用/清理控制；会话删除和draft身份复用040/042，不另建材料库、删除服务或会话状态。跨AI repository写域的缺陷回其Owner，不在本节点复制writer。

## 执行步骤

1. 逐类核对045交付的文本、PDF、DOCX、PPTX与图片读取，关闭2.0普通教师材料缺口：目录/页/段落、表格、图示/公式和原图之间可定位。提取与原生视觉读取在软件任务中完成，保留来源和缺页/损坏/不支持原因；图像或扫描页没有可靠结果时不能伪报已读取。成功条件是原件有效、整体结构已取得、当前教学范围所需内容已实际读取；其余未读部分记录缺口，仅在影响当前目标时阻断，不新增全材料“已理解”状态或强制全文/OCR预处理门。
2. 引用列表显示本次默认材料/页/对象及来源，取消后后续默认请求确实不再附加该项；运行中的不可变观察不被悄悄改写，下一轮取得新观察。原生CLI仍可按任务授权主动读取更多资料，取消引用不等于撤销其文件权限或删除已发送历史。
3. 普通局部修改只取必要片段/图片，不反复传整份材料；同名更新、重新提取和缓存版本变化可见。完整材料仍可按任务取得，不能为省token静默截断题干、公式或图表。
4. 将040的单会话/工程/全部应用记录删除和042的draft/首存/Save As绑定到实际控制。运行中删除先失效相关任务；列出实际删除对象并可复查，原始用户文件不随缓存清理删除。
5. 显示应用记录占用与选择性清理，说明外部CLI历史的独立处理方式。应用只能承诺自己的记录删除；当前CLI没有提供删除确认时不伪称外部记录消失。
6. 工程中有意使用的材料内容、素材和可携带来源继续随课程保存；临时提取缓存、消息、trace、原生session映射和凭据不进入.h5lesson、Published或任何导出。清理应用缓存不得破坏已经嵌入的课程内容。

## 验收与可信反例

- 普通常见PDF/DOCX/PPTX/图片/文本材料均有实际软件上传、结构/原图读取与出处结果；特殊限制按具体页/内容和原因报告。自动流程消费原件、整体结构与当前教学范围的实际读取事实，无关未读页不阻断；必要图示/扫描页未读不能冒充成功。
- 取消默认引用与下一请求输入一致，原生主动读取和已发送历史解释准确；删除可复查且不误删原文件或课程内容，Save As隔离，导出数据边界成立。
- 坏/空材料、跨工程同名文件、已删片段、发送中取消、扫描页误判、缓存过期和删除中任务完成，均不能虚报完整读取、串工程或重复发送旧默认材料。

## 停止条件

无法可靠读取关键教学内容时明确缺口并在软件内提供补材料/修正途径，不让外部Agent预制结果冒充内置。外部CLI历史无法验证删除时如实说明；不因材料类别猜测风险而禁用正常原生能力。

## 聚焦验证

准备与证据复用统一遵循[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)。相关产物准备一次后直接选择材料测试，补格式/片段/取消引用/缓存删除与课程保全反例；新增提取适配器和新UI用例先随实现创建，再将实际文件与名称列入入口。下列E2E只选已有材料库链，不整文件运行三CLI付费矩阵；零匹配不得通过。

```text
npx --no-install vitest run tests/unit/coursewareAuthoringRunner.test.ts tests/unit/localAgentTaskContract.test.ts tests/unit/coursePackageExport.test.ts
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep "S2 材料库：导入检索、可携带引用和另存为隔离$"
```

真实应用使用本节点新增或修复格式的材料，取消一项默认引用后核对原生输入，执行范围删除、Save As并打开课程/导出物。045未变的格式证据复用；不为材料UI重复所有CLI与全部导出格式。

## 回退与交接

交付2.0真实材料支持范围、默认输入/主动读取边界、来源/删除和课程保全证据。020用它完成内部全流程，025/030/S4消费同一事实，不保留教师手工外部预处理缺口。
