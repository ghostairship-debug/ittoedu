# 工作包、模型与写域

本文件由WORK_PACKAGES.json生成作阅读视图，静态计划不是调度平台。所有包未派发。每包的共享文件按下表实际owner交接，新增及既有测试全文均归独立T，包中增补命令只是需求，原路径整文件移交对应T族，实施者只给接口/建议；机械运行归E；不为凑命令写实现镜像测试。

## 派发表

| 包 | 结果 | 唯一owner | 模型/强度 | 首必要ready | 里程碑 |
|---|---|---|---|---|---|
| [K01](#k01) | 把实际作品能力从客户端私有分支迁到共同能力根 | I | gpt-6-astra/xhigh | B0后已有接口 | S1 |
| [K02](#k02) | 软件准备绑定目标的可编辑任务内容 | I | gpt-6-astra/xhigh | B0后已有接口 | S1 |
| [K03](#k03) | 在现有内容应用owner收口局部差异与专业身份 | I | gpt-6-astra/xhigh | K02-min | S1 |
| [K04](#k04) | 把常用文字与元素AI卡接到软件内容请求闭环 | G | gpt-6.1-sol/xhigh | K02-min<br>K03-min | S1 |
| [K05](#k05) | 新内容任务接入渐进上下文和同任务恢复 | G | gpt-6.1-sol/xhigh | K02-min | S2 |
| [K06](#k06) | 默认核心与精确能力自动披露，Skill只提供方法 | I | gpt-6-astra/xhigh | B0后已有接口 | S1 |
| [K07](#k07) | 统一修订结果、修复结算和明确撤回/保存操作 | G | gpt-6.1-sol/xhigh | B0后已有接口 | S1 |
| [TE01](#te01) | TeacherSource / Developer JSON 自然编辑 | TE01 | gpt-6.1-sol/xhigh | B0后已有接口 | S2 |
| [TE02](#te02) | 属性 numeric 与 chart 自然生效 | TE02 | gpt-6.1-sol/high | B0后已有接口 | S2 |
| [TE03](#te03) | GUI/tool 保存与 close 收集眼前高级草稿 | U | gpt-6.1-sol/high | TE01-port<br>TE02-port | S2 |
| [TE04](#te04) | Office 原格式恢复与回退 | TE04 | gpt-6.1-sol/high | B0后已有接口 | S2 |
| [TE05](#te05) | 复制当前稿不盲存源 | TE05 | gpt-6.1-sol/high | B0后已有接口 | S2 |
| [TE06](#te06) | 资料选集进入实际提交 | TE06 | gpt-6.1-sol/high | B0后已有接口 | S2 |
| [TE07](#te07) | Skill 按需披露不隐撤核心能力 | TE07 | gpt-6.1-sol/high | K06-min | S1 |
| [TE08](#te08) | V10 图片结果卡 | TE08 | gpt-6.1-sol/high | K02-min | S2 |
| [TE09](#te09) | 导航13按钮与正式展示状态 | TE09 | gpt-6.1-sol/medium | B0后已有接口 | S3 |
| [TE10](#te10) | 多选资产与现有库管理同源 | TE10 | gpt-6.1-sol/high | B0后已有接口 | S3 |
| [A01](#a01) | 工程分页与 Flow 正文保真同一 owner | A01 | gpt-6.1-sol/high | B0后已有接口 | S1 |
| [A02](#a02) | HTML 实测装配与源码保真单一 owner | A02 | gpt-6.1-sol/xhigh | B0后已有接口 | S3 |
| [A03](#a03) | 资源声明、现有 relay 与可修复原件闭包 | A03 | gpt-6.1-sol/high | B0后已有接口 | S3 |
| [A04](#a04) | Published 按实际使用资源挂载 | A04 | gpt-6.1-sol/high | B0后已有接口 | S3 |
| [A05](#a05) | 工具导出活性与主动取消 | A05 | gpt-6.1-sol/high | B0后已有接口 | S3 |
| [A06](#a06) | 同一资源/Journal owner 消除重复字节与未知归属全局阻断 | I | gpt-6-astra/xhigh | B0后已有接口 | S4 |
| [A07](#a07) | 重复 validate 与 ctx/投影低成本收敛 | I | gpt-6-astra/xhigh | B0后已有接口 | S4 |
| [A08](#a08) | 非业务 trace 不阻工具与回执 | A08 | gpt-6.1-sol/medium | B0后已有接口 | S2 |
| [A09](#a09) | 通用 V10 验证/生成与历史 gate 实际 consumer 收敛 | A09 | gpt-6.1-sol/high | B0后已有接口 | S4 |
| [S01](#s01) | 安装版本机产品bootstrap与Agent直接连接 | S01 | gpt-6.1-sol/high | B0后已有接口 | S2 |
| [S02](#s02) | 同profile后台常驻、SDK detach与GUI升格生命周期 | H | gpt-6.1-sol/high | B0后已有接口 | S2 |
| [S03](#s03) | 网页实际结果授权与内外具体动作grant | S03 | gpt-6.1-sol/high | B0后已有接口 | S2 |
| [S04](#s04) | 外部同页人工接管与失败恢复 | S04 | gpt-6.1-sol/high | S03-port | S2 |
| [S05](#s05) | Office现有服务的共同能力接入 | I | gpt-6-astra/xhigh | K01-min<br>TE04-port | S2 |
| [S06](#s06) | 计算授权数据桥、可用产物与artifact共同交付 | S06 | gpt-6.1-sol/high | B0后已有接口 | S2 |
| [S07](#s07) | 共同资料读取、教师选集与公开教材文件接续 | S07 | gpt-6.1-sol/high | K01-min<br>TE06-port | S2 |
| [S08](#s08) | 当前HTML作品预览动作接到共同服务 | S08 | gpt-6.1-sol/high | K01-min | S3 |
| [S09](#s09) | 已有输出和PPTX导入producer的共同consumer | X | gpt-6.1-sol/high | K01-min | S3 |
| [S10](#s10) | 正式History、资产与Slide状态的公共入口需求 | I | gpt-6-astra/xhigh | K01-min<br>TE09-port<br>TE10-port | S3 |
| [OPT01](#opt01) | 终态释放、完整日志、辅助元数据与可行动错误 | G | gpt-6.1-sol/high | B0后已有接口 | S4 |
| [OPT02](#opt02) | 颜色/CSS/活运行与native候选一次定点收口 | OPT02 | gpt-6.1-sol/high | B0后已有接口 | S4 |

## 共享文件唯一writer

原包提议路径与此表冲突以此表为准。整文件移交须暂停原writer并明确接回；不新同义DTO/Facade规避锁。公共合同/配置仅实际涉及hunk由I，非全仓重造。

### I

- src/core/tools/ToolRegistration.ts
- src/core/tools/ToolCatalog.ts
- src/core/tools/ToolTargets.ts
- src/core/tools/DocumentToolGateway.ts
- src/core/tools/HostToolServices.ts
- src/core/drivers/CourseV10Driver.ts
- src/core/drivers/courseV10Operations.ts
- src/core/documents/DocumentSession.ts
- src/core/documents/DocumentRegistry.ts
- src/main/workbench/DocumentHostService.ts
- src/main/workbench/workbenchToolServices.ts
- src/main/workbench/execution/AgentFileService.ts
- src/main/workbench/FileArtifactService.ts
- src/main/ipc.ts
- src/preload/index.ts
- src/preload/desktop-api.d.ts
- package.json
- package-lock.json
- vitest.config.ts
- playwright.config.ts
- electron-builder.yml
- src/main/workbench/documentJournal.ts
- src/shared/workbench/toolPorts.ts
- src/core/contentApply/planning/types.ts
- src/shared/workbench/execution.ts
- src/main/workbench/JournalBindingIndex.ts
- src/core/tools/ProjectFileTools.ts
- src/core/tools/HtmlImportTools.ts
- src/shared/contracts/component-platform/schema.ts
- src/shared/contracts/component-platform/published.ts
- src/shared/contracts/component-platform/runtime.ts
- src/core/drivers/resources.ts

### G

- src/main/workbench/execution/ExecutionEngine.ts
- src/main/workbench/execution/ExecutionDesktopService.ts
- src/main/workbench/execution/ExecutionContextProjection.ts
- src/main/workbench/execution/executionOutcome.ts
- src/main/workbench/execution/executionToolFacts.ts
- src/core/tools/modelToolResult.ts
- src/core/tools/TaskNoteTools.ts

### H

- src/main/workbench/external/ExternalMcpService.ts
- src/main/workbench/external/ResidentMcpSettings.ts
- src/main/workbench/external/ResidentMcpServer.ts
- src/main/workbench/external/externalDesktopService.ts
- src/main/index.ts
- src/main/windowLifecycle.ts
- src/main/windowLifecycleDesktop.ts

### U

- src/renderer/App.tsx
- src/renderer/store/editorStore.ts
- src/renderer/documents/CourseV10DocumentBridge.ts
- src/renderer/documents/DocumentProjection.ts
- src/renderer/app/useCourseProjectLifecycle.ts
- src/renderer/workbench/SelectionContextController.ts
- src/renderer/workbench/ExecutionAssistant.tsx
- src/renderer/workbench/elementCards/elementCardController.ts

### X

- src/renderer/app/useCourseDelivery.ts
- src/renderer/export/componentPlatform/delivery.ts
- src/main/workbench/delivery/DocumentDeliveryService.ts
- src/core/tools/DocumentDeliveryTools.ts

### A01

- src/core/projectFiles/componentPlatform/coordinator.ts
- src/shared/document/markdown.ts
- src/shared/document/markdownIdentity.ts
- src/core/components/document/flowDocumentProjection.ts

### A02

- src/main/workbench/contentApply/applyService.ts
- src/main/workbench/contentApply/application/html.ts
- src/main/workbench/contentApply/application/professionalHtml.ts
- src/core/contentApply/assembly/htmlAssembly.ts
- src/main/workbench/contentApply/measurement/browserCapture.ts

### S03

- src/main/workbench/externalTools/BrowserActionApprovals.ts
- src/main/workbench/externalTools/managedBrowserControlCode.ts

### S04

- src/main/workbench/externalTools/ManagedBrowserMcpService.ts

### S08

- src/main/workbench/htmlPreview/HtmlPreviewService.ts

## 每包直接交接

<a id="k01"></a>

### K01 把实际作品能力从客户端私有分支迁到共同能力根

**结果：**

同一已配置、已授权作品操作在人工、内置、resident MCP具有同一服务实现、内容语义和正式结果；第一纵切选现有Office inspect/edit或资料读取服务，随后接各分域已就绪操作。

**写入owner：**

I

**模型：**

gpt-6-astra

**强度：**

xhigh

**最终汇合（不是开工依赖）：**

S05
S06
S07
S08
S09
S10

**当前依据：**

CAP-SHARED-ROOT：共享Host/Gateway/Session已有
CAP-EXTRA-INJECTION、CAP-OFFICE-PARITY、CAP-ARTIFACT-DELIVERY、CAP-MATERIAL-EXTRACTION-PARITY、CAP-HTML-PREVIEW-ACTIONS：内置私有追加使外部漏接
CO-15：共用Gateway不等于需接管外部Agent循环

**写域：**

src/core/tools/ToolRegistration.ts
src/core/tools/ToolCatalog.ts
src/core/tools/ToolTargets.ts
src/core/tools/DocumentToolGateway.ts
src/core/tools/HostToolServices.ts
src/core/drivers/CourseV10Driver.ts
src/core/drivers/courseV10Operations.ts
src/core/documents/DocumentSession.ts
src/core/documents/DocumentRegistry.ts
src/main/workbench/DocumentHostService.ts
src/main/workbench/workbenchToolServices.ts
src/main/workbench/execution/AgentFileService.ts
src/main/workbench/FileArtifactService.ts
src/main/ipc.ts
src/preload/index.ts
src/preload/desktop-api.d.ts
package.json
package-lock.json
vitest.config.ts
playwright.config.ts
electron-builder.yml
src/main/workbench/documentJournal.ts
src/shared/workbench/toolPorts.ts
src/core/contentApply/planning/types.ts
src/shared/workbench/execution.ts
src/main/workbench/JournalBindingIndex.ts
src/core/tools/ProjectFileTools.ts
src/core/tools/HtmlImportTools.ts
src/shared/contracts/component-platform/schema.ts
src/shared/contracts/component-platform/published.ts
src/shared/contracts/component-platform/runtime.ts
src/core/drivers/resources.ts

**交唯一owner的小hunk：**

path: src/main/workbench/execution/ExecutionEngine.ts
writer: G
path: src/main/workbench/external/ExternalMcpService.ts
writer: H
path: src/main/workbench/execution/ExecutionDesktopService.ts
writer: G

**条件候选新路径（不强制新模块）：**

src/main/workbench/WorkbenchCapabilityRoot.ts（如确需将既有服务实例化与窄port接线移出Engine；只composition，无业务）

**直接消费者：**

ExecutionEngine.runTools/executeTools
ExternalMcpService.catalog/execute
现有人工UI对应service入口；由Office/资料/输出分域包列精确caller

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

沿ToolRegistration既有parser/support/effect/targets/handler绑定窄服务port；Main只创建现有service一次。作品能力从ExecutionEngine的私有追加/分支移到共同注册与真实handler，再让Engine和MCP消费。context.read/task.note/ask等会话工具仍属于内置对话，不要求复制到外部。各服务自身授权与生命周期仍在原owner。不是先做新总Facade再原样转发两套实现。

**权威执行限定：**

I写共同注册/port；G删除Engine私有作品分支，H写MCP consumer，U/X接人工端。S05/S10是I接线需求，不另派同文件writer。

**保留行为：**

现有文件/Office/图像/资料owner及真实可用条件
人工可独立使用，不依赖外部客户端在线
外部客户端自己的Skill/搜索/推理循环与果铃工具分开
权限四档、真实run grant、Stop、操作回执

**验收：**

选一个真实现有服务，三种入口实际到同一个handler/owner且效果一致；内置旧业务分支移除；未配置能力给同源availability，不新接供应商。其他域的接线按同窄注册接口陆续交付，不用等待所有能力齐备才开始。

**检查建议（T核当前V10与匹配后选1–3条）：**

kind: existing+extend
path: tests/unit/g20ToolGateway.test.ts
command: .\node_modules\.bin\vitest.cmd run tests/unit/g20ToolGateway.test.ts -t 'exports the executable registry'
proves: parser与公开schema来自实际注册；补新增已接能力，并检查没有模型簿记字段。
kind: existing+extend
path: tests/integration/g20ExternalMcpService.test.ts
command: .\node_modules\.bin\vitest.cmd run tests/integration/g20ExternalMcpService.test.ts -t 'serves a resident session|freezes the permission level'
proves: 同实际服务handler内外可达/冻结授权；需在fixture补首个服务真实接线，不能只比较tool names。
kind: planned
path: tests/integration/contentRevisionCapabilityParity.test.ts
proves: 计划新增首个服务人工command、Engine与MCP三入口共用owner行为；与分域已有等价检查合并，不再重复一套。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="k02"></a>

### K02 软件准备绑定目标的可编辑任务内容

**结果：**

教师从选区/对象发起明确局部修改，AI收到当前可编辑内容及需求即可创作；不需要复制target/writableTarget/affected或正式data全部字段以保旧值。

**写入owner：**

I

**模型：**

gpt-6-astra

**强度：**

xhigh

**最终汇合（不是开工依赖）：**

TE03

**当前依据：**

CO-01/05：replace-text已具软件绑定目标/流式临时预览/一次正式应用
CO-03/04：plain text仅适合窄正文，不能压平数学/混合样式
CO-06/09/16：目标接续、专业ID和完整Schema仍造成机械负担

**写域：**

src/core/tools/ToolRegistration.ts
src/core/tools/ToolCatalog.ts
src/core/tools/ToolTargets.ts
src/core/tools/DocumentToolGateway.ts
src/core/tools/HostToolServices.ts
src/core/drivers/CourseV10Driver.ts
src/core/drivers/courseV10Operations.ts
src/core/documents/DocumentSession.ts
src/core/documents/DocumentRegistry.ts
src/main/workbench/DocumentHostService.ts
src/main/workbench/workbenchToolServices.ts
src/main/workbench/execution/AgentFileService.ts
src/main/workbench/FileArtifactService.ts
src/main/ipc.ts
src/preload/index.ts
src/preload/desktop-api.d.ts
package.json
package-lock.json
vitest.config.ts
playwright.config.ts
electron-builder.yml
src/main/workbench/documentJournal.ts
src/shared/workbench/toolPorts.ts
src/core/contentApply/planning/types.ts
src/shared/workbench/execution.ts
src/main/workbench/JournalBindingIndex.ts
src/core/tools/ProjectFileTools.ts
src/core/tools/HtmlImportTools.ts
src/shared/contracts/component-platform/schema.ts
src/shared/contracts/component-platform/published.ts
src/shared/contracts/component-platform/runtime.ts
src/core/drivers/resources.ts

**交唯一owner的小hunk：**

path: src/main/workbench/execution/ExecutionEngine.ts
writer: G
path: src/renderer/workbench/SelectionContextController.ts
writer: U

**条件候选新路径（不强制新模块）：**

src/core/contentApply/planning/editableContentView.ts（计划：纯派生视图与内容源映射，无Store/writer）

**直接消费者：**

ExecutionDesktopService.send/start冻结输入
SelectionContextController.request
ElementCardController.send（K04接线）
Gateway.resolveEditTarget
ComponentProjectFileCoordinator.read/captureFile

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

从首个真实目标提取prepare/read适配：返回正文、富文本/Markdown/HTML、专业内容字段或源码的适当可编辑表示；基线、正式身份、字段映射、资源引用归宿主已有run/编辑上下文。若任务只改明确内容槽位，不发整实例data。若用户请求结构/格式/代码，则保相应语义表示及原源，不假装纯正文。只扩本次consumer需要的内部type，不预建全组件通用DSL/Schema注册平台。

**权威执行限定：**

先交正式内容的最窄view/binding释放K03/K04，TE03后补GUI眼前稿。view是临时投影，不持久成第二工程。

**保留行为：**

同一选区发送后浏览/换选不改投
数学、富文本、链接、专业数据/源码不因简化输入丢失
用户JSON里业务id不泛化删除
局部view与完整源码渐进读取都不扩大原授权

**验收：**

至少覆盖纯文字与一个带链接/公式的富内容真实目标；模型输入无需内部ID/revision/run/owner，返回内容能无损留住未请求变化。复杂程序仍可读/写完整源码及必要模块。目标歧义只问作品范围选项，不让教师选技术句柄。

**检查建议（T核当前V10与匹配后选1–3条）：**

kind: planned
path: tests/unit/editableContentView.test.ts
proves: 同一内容view回应用保持ID/未选片段/样式/数学；只选槽位时不暴露完整内部结构。
kind: existing+extend
path: tests/integration/g20BoundContentOutput.test.ts
command: .\node_modules\.bin\vitest.cmd run tests/integration/g20BoundContentOutput.test.ts
proves: 完整内容一次应用、普通聊天不提交、Stop/重叠人工编辑拒迟到写、settled续轮不重放；现例Markdown，新V10富内容用例计划补入。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="k03"></a>

### K03 在现有内容应用owner收口局部差异与专业身份

**结果：**

局部修订只改变请求内容；软件补齐旧值、保专业身份/引用/人工布局，并把资源和源码一次提交，Flow普通Markdown无需AI抄cw marker。

**写入owner：**

I

**模型：**

gpt-6-astra

**强度：**

xhigh

**开工接口ready：**

K02-min

**最终汇合（不是开工依赖）：**

A01
A02

**当前依据：**

CO-07/08：project.apply差异与object.update整data/style替换语义分裂
CO-09：专业行列/单元格ID已有软件工厂但完整数据入口仍暴露
CO-10/旧PF-05：Flow caller未消费普通Markdown已有位置身份对齐
CO-12/13：源码/相对模块/局部HTML保护已有正向路径

**写域：**

src/core/tools/ToolRegistration.ts
src/core/tools/ToolCatalog.ts
src/core/tools/ToolTargets.ts
src/core/tools/DocumentToolGateway.ts
src/core/tools/HostToolServices.ts
src/core/drivers/CourseV10Driver.ts
src/core/drivers/courseV10Operations.ts
src/core/documents/DocumentSession.ts
src/core/documents/DocumentRegistry.ts
src/main/workbench/DocumentHostService.ts
src/main/workbench/workbenchToolServices.ts
src/main/workbench/execution/AgentFileService.ts
src/main/workbench/FileArtifactService.ts
src/main/ipc.ts
src/preload/index.ts
src/preload/desktop-api.d.ts
package.json
package-lock.json
vitest.config.ts
playwright.config.ts
electron-builder.yml
src/main/workbench/documentJournal.ts
src/shared/workbench/toolPorts.ts
src/core/contentApply/planning/types.ts
src/shared/workbench/execution.ts
src/main/workbench/JournalBindingIndex.ts
src/core/tools/ProjectFileTools.ts
src/core/tools/HtmlImportTools.ts
src/shared/contracts/component-platform/schema.ts
src/shared/contracts/component-platform/published.ts
src/shared/contracts/component-platform/runtime.ts
src/core/drivers/resources.ts

**交唯一owner的小hunk：**

path: src/core/projectFiles/componentPlatform/coordinator.ts
writer: A01
path: src/main/workbench/contentApply/applyService.ts
writer: A02
path: src/shared/document/markdown.ts
writer: A01
path: src/shared/document/markdownIdentity.ts
writer: A01
path: src/core/components/document/flowDocumentProjection.ts
writer: A01

**直接消费者：**

ProjectFileTools→ComponentProjectFileCoordinator→ContentApplyService
Gateway.applyCanonicalMutations→courseInstancePropertyEdits
Flow body.md file writer→parseDocumentMarkdown→flowDocumentEdits
ComponentSourceEditor与project source路径复用正式command/resource writer

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

局部内容view比较与属性修订共用现有plan owner的窄差异函数；明确区分修订未提供字段与用户明确删除，数组/专业行列按自身真实位置/编辑意图维护身份，不对任意JSON发明通用deep-merge。Flow复用位置身份映射前核其current projection与正文slot适用性，保重复段落与专业对象。资源/源码仍ContentApplyService→Session一次事务；不复制装配算法。

**权威执行限定：**

必须覆盖字段修改、跨类型、新增节点、生成图片嵌入的组合，不仅文本。内容可用HTML/SVG/代码/数据，不新私有DSL/巨型万能输入/小意图模型。

**保留行为：**

原frame/顺序/浮层/未改兄弟；局部编辑不measure整页
共享定义vs实例私有源码语义与相对imports
数据、资源字节和源码共一History；unchanged不增历史
有真实重叠冲突时保返回内容，已能承载部分保留并诊断
原创HTML/JS/TS/模块/算法能力不静态化

**验收：**

Flow普通无marker局部改写保原实例身份与人工frame；选表格单元/字段改写保行列关联及未改内容；同修订走不同入口结果一致；一次undo/redo和save/reopen能恢复相应内容及资源。

**检查建议（T核当前V10与匹配后选1–3条）：**

kind: existing+extend
path: tests/integration/q2ProjectFileSources.test.ts
command: .\node_modules\.bin\vitest.cmd run tests/integration/q2ProjectFileSources.test.ts -t 'round-trips HTML/Markdown professional body|uses live project tools'
proves: 现V10源/Flow/Spatial保存重开；补无marker重复段落/人工frame与只改字段的局部反例。
kind: existing
path: tests/integration/h1CanonicalContentApply.test.ts
command: .\node_modules\.bin\vitest.cmd run tests/integration/h1CanonicalContentApply.test.ts
proves: 源码owner files与内容/资源一事务、一次History、正式undo/save/cold reopen；只在影响该依赖时执行。
kind: planned
path: tests/unit/contentRevisionFields.test.ts
proves: 计划补明确删除/未提供、专业行列身份、不同入口同语义；不以序列化字节相同当一般正确性。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="k04"></a>

### K04 把常用文字与元素AI卡接到软件内容请求闭环

**结果：**

从当前Markdown/Flow文字卡发起局部改写，普通完成即应用并可撤回；对需要样式/结构/数学/互动的请求保对应内容能力，教师不额外点应用或工具加载。

**写入owner：**

G

**模型：**

gpt-6.1-sol

**强度：**

xhigh

**开工接口ready：**

K02-min
K03-min

**最终汇合（不是开工依赖）：**

TE01
TE02

**当前依据：**

CO-02：实际TextAiButton走ElementCardController.send未传contentOutput；底层正确路线只在备用contentOnly分支
CO-03：可读正文与复杂对象适用域需分别保真

**写域：**

src/main/workbench/execution/ExecutionEngine.ts
src/main/workbench/execution/ExecutionDesktopService.ts
src/main/workbench/execution/ExecutionContextProjection.ts
src/main/workbench/execution/executionOutcome.ts
src/main/workbench/execution/executionToolFacts.ts
src/core/tools/modelToolResult.ts
src/core/tools/TaskNoteTools.ts

**交唯一owner的小hunk：**

path: src/renderer/workbench/elementCards/elementCardController.ts
writer: U
path: src/renderer/workbench/SelectionContextController.ts
writer: U
path: src/renderer/workbench/ExecutionAssistant.tsx
writer: U

**直接消费者：**

LessonDocumentEditor/FlowWorkspace→TextAiButton→ElementCardController.send
备用QuickBarAiButton→SelectionContextController.request→ExecutionAssistant

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

常用卡与备用入口调用同一软件任务准备函数，不在各UI复制资格判断。纯正文内容请求绑定已有output；富内容使用K02适配。开放对象指令可请求合适表示/真实操作，不能把所有文字卡指令用字符串规则硬判成text。发送时冻结目标、队列顺序与取消仍沿原controller/desktop。

**权威执行限定：**

真实文字卡接已有contentOutput。富文本/公式/数据/源码按适合内容表达保留，不能强纯文本。GUI共享文件交U。

**保留行为：**

现有独立对象会话、卡片草稿、队列、停止、换选不改投
普通聊天不自动写作品
权限与锁定状态按真实目标
自定义复杂内容不降为纯文字

**验收：**

真实窗口文字卡完成一次局部改写→自动正式生效→撤回；带公式或结构要求仍可完成真实目标且保未改内容。保存当前草稿由教师编辑分域包负责，集成时复用其验证，不再建卡内第二保存。

**检查建议（T核当前V10与匹配后选1–3条）：**

kind: planned
path: tests/unit/contentRevisionCardsV10.test.tsx
proves: 现tests/unit/g20M15ElementCards.test.tsx使用旧course-object；新增V10/Markdown常用卡dispatch到任务准备，冻结目标和队列取消。
kind: existing+extend
path: tests/integration/g20BoundContentOutput.test.ts
command: .\node_modules\.bin\vitest.cmd run tests/integration/g20BoundContentOutput.test.ts -t 'receives complete text|does not commit late'
proves: 复用K02同有效执行证据；相关逻辑不变不重复跑。
kind: planned_real_window
path: 在现有受影响窗口fixture上补定向行为记录
proves: 当前文字卡发送→自动应用→undo一条真实载体；公式/链接只在受影响适配需视觉确认时加同场景一个对照，非全矩阵。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="k05"></a>

### K05 新内容任务接入渐进上下文和同任务恢复

**结果：**

长任务只展示当前必要内容，原文和正式回执可按需回读；中断后在同任务保内容与进度继续，已应用修改不再生成/提交，辅助笔记失败不否认作品。

**写入owner：**

G

**模型：**

gpt-6.1-sol

**强度：**

xhigh

**开工接口ready：**

K02-min

**最终汇合（不是开工依赖）：**

K07

**当前依据：**

现ExecutionContextProjection/RunStore/Engine已有渐进投影、来源回读、同模型摘要、reconcileReceipts与不重放
旧C30/EX-02/PD-02：task.note sourceRefs只接受内部callId，模型常见providerCallId；格式错误影响结算
CO-05/06：绑定内容已有软件流序和commit，通用目标接续仍给模型

**写域：**

src/main/workbench/execution/ExecutionEngine.ts
src/main/workbench/execution/ExecutionDesktopService.ts
src/main/workbench/execution/ExecutionContextProjection.ts
src/main/workbench/execution/executionOutcome.ts
src/main/workbench/execution/executionToolFacts.ts
src/core/tools/modelToolResult.ts
src/core/tools/TaskNoteTools.ts

**直接消费者：**

Engine.prepareContext/drive/resume/recover
RunStore checkpoint/read
context.read→readContextMessage
task.note→prepareTaskNote→Engine单writer checkpoint

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

沿既有run记录保存内容任务来源、软件绑定和正式receipt；新view只做可重建工作投影。内部ID/来源映射由软件给可直接消费引用，task.note引用软件映射provider/tool来源或不提供引用也可。继续前按已有owner查回执/重读真实改变范围，不要求模型手修affected链。不另造summary服务、长期记忆平台或新小模型；现有同已选模型的可选摘要保建议性质，失败可继续。
O05由TE03/I/U处理真实磁盘reconcile，G将新的当前目标版本重新读取并在同任务继续；不重新执行已经写到磁盘的动作。

**权威执行限定：**

复用RunStore、context.read、渐进投影与不重放，不新恢复平台。读多不扩写权限，目标变化软件重读后同任务继续。

**保留行为：**

原消息/工具配对可回读；压缩不删除正式作品/资源/回执
摘要/旧source不成为授权；真实模型窗口、Stop和未知请求状态保留
新图片批次先实际送达，历史图片可归档
恢复只查已发生效果，未知副作用不换ID重放
无新固定任务轮数/时限/内容预算

**验收：**

在原run来源内压缩后能继续同内容任务；内容已commit但回复丢失只回旧receipt；未commit输入可修正；无关上下文与已授权能力不因摘要失去；笔记错误只给诊断，不要求教师处理callId。

**检查建议（T核当前V10与匹配后选1–3条）：**

kind: existing+extend
path: tests/unit/g20ContextProjection.test.ts
command: .\node_modules\.bin\vitest.cmd run tests/unit/g20ContextProjection.test.ts
proves: 配对/原文/新图片batch与归档；新内容来源加入相关断言。
kind: existing+extend
path: tests/integration/g20S05ContextRecovery.test.ts
command: .\node_modules\.bin\vitest.cmd run tests/integration/g20S05ContextRecovery.test.ts -t 'compacts a large completed turn|queries a terminal run lost tool receipt|reduces a rejected context'
proves: 压缩后有正式事实、lost receipt不重放；用fake provider不真实付费。
kind: existing+extend
path: tests/integration/g20TaskNote.test.ts
command: .\node_modules\.bin\vitest.cmd run tests/integration/g20TaskNote.test.ts
proves: 补可见来源引用映射/无引用笔记；保目标权限不可由note改写。删除旧无效拒绝断言需写明Owner机械职责决定与等效语义覆盖，不直接削弱实际授权保护。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="k06"></a>

### K06 默认核心与精确能力自动披露，Skill只提供方法

**结果：**

已授权核心能力默认可用；任务明确需要的精确能力由软件自动准备。读取创作Skill不撤普通Markdown读写/保存，不让教师或AI为工具族加载补手续。

**写入owner：**

I

**模型：**

gpt-6-astra

**强度：**

xhigh

**最终汇合（不是开工依赖）：**

TE07

**当前依据：**

CAP-SKILL-DISCOVERY、teacher-skill-reading-changes-task-catalog：courseAuthoring全run模式撤能力
teacher-skill-tool-family-loading-model-cost：空loadedFamilies导致机械tools.load
teacher-skill-external-discovery-change-without-notification：Skill变化不标listChanged
teacher-skill-research-data-not-bundled、teacher-skill-local-root-opt-in-no-product-consumer：方法产品可发现断点
旧C32：局部Skill文件读取被别的文件版本/ASCII目录门影响

**写域：**

src/core/tools/ToolRegistration.ts
src/core/tools/ToolCatalog.ts
src/core/tools/ToolTargets.ts
src/core/tools/DocumentToolGateway.ts
src/core/tools/HostToolServices.ts
src/core/drivers/CourseV10Driver.ts
src/core/drivers/courseV10Operations.ts
src/core/documents/DocumentSession.ts
src/core/documents/DocumentRegistry.ts
src/main/workbench/DocumentHostService.ts
src/main/workbench/workbenchToolServices.ts
src/main/workbench/execution/AgentFileService.ts
src/main/workbench/FileArtifactService.ts
src/main/ipc.ts
src/preload/index.ts
src/preload/desktop-api.d.ts
package.json
package-lock.json
vitest.config.ts
playwright.config.ts
electron-builder.yml
src/main/workbench/documentJournal.ts
src/shared/workbench/toolPorts.ts
src/core/contentApply/planning/types.ts
src/shared/workbench/execution.ts
src/main/workbench/JournalBindingIndex.ts
src/core/tools/ProjectFileTools.ts
src/core/tools/HtmlImportTools.ts
src/shared/contracts/component-platform/schema.ts
src/shared/contracts/component-platform/published.ts
src/shared/contracts/component-platform/runtime.ts
src/core/drivers/resources.ts

**交唯一owner的小hunk：**

path: src/main/workbench/external/ExternalMcpService.ts
writer: H
path: src/main/workbench/execution/ExecutionEngine.ts
writer: G

**直接消费者：**

Gateway.describeRun/executeCall/readSkill
Engine.refreshTools
MCP tools/list及list_changed
BundledSkillService/ScopedSkillService→SkillTools

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

分清allowed与disclosed：supports仍算实际授权/服务；核心内容读修订/已绑定保存等按真实可用性常备；按捕获目标类型、已选任务动作、Skill明确方法声明增量提供所需工具或在调用已授权具体能力时软件补载，不靠自然语言关键词推断权限。读方法只增相关披露，移除courseAuthoring对通用能力的减法副作用及内外导入分叉。复用现有catalog变化事件给MCP通知，不新建同步平台。补已存在研究/数据方法打包与真实授权本地root可读入口；不执行未知脚本或开新根。

**权威执行限定：**

区分allowed与disclosed。核心默认可用、精确能力自动接，不以未load/未读Skill拒支持操作；广告parser一致，不全放未知真实意图。

**保留行为：**

逐步展示控制prompt体积但不形成第二授权
显式读方法不自动执行脚本
真实root/realpath、当前文件分页一致性、撤权
未知/未配置媒体如实不可用；外部客户端本地Skill不归宿主控制
教学阶段确认与已授权自动推进仍由Skill，不能写通用prompt

**验收：**

同run同时处理Markdown与课件，读创作Skill后两者所需已授权能力持续可用；明确内容任务不用先tools.load；MCP收到真实目录变化；未授权/未配置能力仍不能执行；中文方法目录及未变引用文件能读取。

**检查建议（T核当前V10与匹配后选1–3条）：**

kind: existing+extend
path: tests/integration/g20ScopedSkills.test.ts
command: .\node_modules\.bin\vitest.cmd run tests/integration/g20ScopedSkills.test.ts
proves: 更新读方法不撤能力断言；补中文目录与另文件变化不阻当前新读，保实际分页/realpath/撤权。
kind: existing+extend
path: tests/integration/g20ScopedToolCatalog.test.ts
command: .\node_modules\.bin\vitest.cmd run tests/integration/g20ScopedToolCatalog.test.ts -t 'sends a narrow Markdown catalog|loads a course tool family'
proves: 只复用当前Markdown/加载逻辑；该文件课件多V9，新V10默认核心/精确自动加载用例计划补入，不能仅靠旧V9通过。
kind: planned
path: tests/integration/contentRevisionCapabilityDisclosure.test.ts
proves: 计划新增混合Markdown+V10及MCP list_changed真实消费；包含allowed不扩与已配置自动加载。与K01 parity可共享fixture。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="k07"></a>

### K07 统一修订结果、修复结算和明确撤回/保存操作

**结果：**

人工与内外AI看到相同已应用/可用/保存事实；同任务修复原失败后结算更新，未知效果不被新成功抹掉；教师说撤回/保存时软件操作原历史/当前文档，不要求AI拿历史ID或根句柄。

**写入owner：**

G

**模型：**

gpt-6.1-sol

**强度：**

xhigh

**最终汇合（不是开工依赖）：**

S10

**当前依据：**

旧C28：MCP read包装的not_committed/unusable被外层当completed
旧C29/EX-01：重读或异工具局部修复仍按旧失败结算
旧C19、CO-14：普通保存根handle全文footprint，project.save已有软件捕获参照
CAP-HISTORY-AI-COMMAND：人工undo/redo已有正式能力，内外AI缺直接消费入口

**写域：**

src/main/workbench/execution/ExecutionEngine.ts
src/main/workbench/execution/ExecutionDesktopService.ts
src/main/workbench/execution/ExecutionContextProjection.ts
src/main/workbench/execution/executionOutcome.ts
src/main/workbench/execution/executionToolFacts.ts
src/core/tools/modelToolResult.ts
src/core/tools/TaskNoteTools.ts

**交唯一owner的小hunk：**

path: src/main/workbench/external/ExternalMcpService.ts
writer: H
path: src/core/tools/DocumentDeliveryTools.ts
writer: X
path: src/core/tools/DocumentToolGateway.ts
writer: I
path: src/core/documents/DocumentSession.ts
writer: I
path: src/renderer/documents/DocumentProjection.ts
writer: U
path: src/renderer/documents/CourseV10DocumentBridge.ts
writer: U

**直接消费者：**

Engine settlement/event projection
ExternalMcpService.successful/summarize/reply/traced
DocumentDeliveryTools→Host saveWithFact
人工bridge/projection undo/redo→DocumentSession.execute

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

把已有executionToolFacts中实际业务结果读取移到最窄共享事实owner供MCP/Engine/UI用，删除另一份read=成功规则。对可确定未发生效果的失败，以宿主内容任务/实际目标与后续正式修复回执关联结算；只添加现run record必要关联，不造任务验收DSL或通用工作流状态机，不按邻近成功猜已修复。保存从当前绑定文档捕获实际身份/保存目标，编辑旧值保护与保存身份/磁盘冲突分开。明确undo/redo接同正式历史，软件选择当前head或最近AI head；后来人工head变化时不能盲撤旧项。

**权威执行限定：**

业务执行/当前可用/保存分开。纯查询读到failed仍可查询成功。软件关联笔记出处，已修解除旧错，历史入口实际走同History。

**保留行为：**

committed/unchanged与usable/partial/unusable以及saved分开
unknown receipt必须原owner核实，别的成功不修复它
unchanged不新增历史；undo头防护和文档epoch
保存中新编辑保持dirty；文档保存/外部网页副作用不混同
局部诊断与可选笔记失败不否定真实已提交结果

**验收：**

相同ContentApplyResult在MCP/Engine/UI状态一致；同目标真正修复后历史错误留记录但不仍标未完成；不相关成功/unknown仍不算修复；明确撤回当前修改/重做与GUI同一History；保存用当前文档且返回实际savedRevision。

**检查建议（T核当前V10与匹配后选1–3条）：**

kind: existing+extend
path: tests/integration/g20ExecutionOutcomeR7.test.ts
command: .\node_modules\.bin\vitest.cmd run tests/integration/g20ExecutionOutcomeR7.test.ts
proves: 新增同宿主修订关联的异入口修复与辅助笔记诊断；保未知效果、不相关文件、当前保存版本反例。
kind: existing+extend
path: tests/integration/g20ExternalMcpService.test.ts
command: .\node_modules\.bin\vitest.cmd run tests/integration/g20ExternalMcpService.test.ts -t 'S12-T03|S12-T02'
proves: 回执不重放与单Session/History现有证据；计划补V10 not_committed/partial envelope及明确undo/redo。
kind: planned
path: tests/integration/contentRevisionHistoryDelivery.test.ts
proves: 计划新增V10/Markdown局部改写后保存无需刷新根handle、最近AI撤回与后来人工head反例；GUI草稿→保存→冷开由教师编辑分域的同一集成用例覆盖，不再重复。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="te01"></a>

### TE01 TeacherSource / Developer JSON 自然编辑

**结果：**

当前实际 DeveloperTab 的共享/实例源码、网络/对象/规则/共享定义 JSON 默认按自然编辑边界生效可撤回；有效眼前稿参加 dirty/save，未完成 JSON、缺入口、IME 与新文件名输入保留原目标原输入。无变化不称写入历史，保存源码与运行通过分别表达。

**写入owner：**

TE01

**模型：**

gpt-6.1-sol

**强度：**

xhigh

**当前依据：**

src/renderer/components/ComponentSourceEditor.tsx:13-16,35-48,60-90,122-198
src/renderer/ui/DeveloperTab.tsx:16-72,144-158,189-225
src/core/components/source/sourceAuthoringEdits.ts:8-24
tests/unit/componentSourceQ0.test.tsx:112-121,139-169,239-257

**写域：**

src/renderer/components/ComponentSourceEditor.tsx
src/renderer/ui/DeveloperTab.tsx
src/renderer/ui/ComponentSourcesEditor.tsx

**条件候选新路径（不强制新模块）：**

path: src/renderer/authoring/courseDraftLifecycle.ts
single_writer: TE01
exists: False

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

日常有效编辑不再逐面板 Apply
无变化和已知格式错误就地说明
仅为真实保存/关闭 consumer 把现有 source/JSON 草稿接生命周期

**权威执行限定：**

有效Source/JSON局部稿默认进入同一正式修改链，撤回可用；无效未完成输入保留并清楚诊断，不因取消关闭而丢稿。GUI准备接口交U、Main/I与Actor/G/H接入。

**保留行为：**

冻结 document/epoch/scope/instance，原作用域和 shared vs independent source
workspace 未改文件、依赖、二进制 bytes 与正式事务
原目标 panel-switch/late ACK/本地 textarea undo/IME
restore default/discard/正式 undo 各自语义，源字符串允许保全

**验收：**

候选先被直接反例证伪，再用真实 consumer/载体和实际 diff 证明改动；mock-only/派发/提交不能称完成。重要 writer/history/recovery 迁移须未参与实施的 reviewer 核对基线+diff+证据。1–3最小检查通过即停，不全矩阵。

**检查建议（T核当前V10与匹配后选1–3条）：**

property: 先证伪
method: 在生产 Developer consumer 中改有效源码/JSON，不点击 Apply，检查实际 Session 与 dirty；先记录 baseline 遗漏，再接受修复
carrier: mounted Developer + real DocumentHostService
test: tests/unit/componentSourceQ0.test.tsx
single_writer: T
property: 目标和未完成输入保全
method: 一条序列覆盖 IME、未完成 JSON、换选择、迟 ACK；邻对象不写，raw 输入留存，接受输入一条逻辑历史
carrier: actual controls + CourseV10DocumentBridge
test: tests/unit/teacherAdvancedDraftLifecycle.test.tsx (new)
single_writer: T
property: 自然保存结果
method: 与 TE03 共用一次真实源码+JSON edit/Ctrl+S/冷重开/undo；无效输入保存反馈保留
carrier: real editor window + .h5lesson
test: tests/integration/teacherAdvancedSaveClose.test.tsx (new)
single_writer: T

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="te02"></a>

### TE02 属性 numeric 与 chart 自然生效

**结果：**

空值、负号、非 finite 等未完成数值不转成 0/16 或伪 flush 成功；合法图表数据按自然边界生效并可撤回。BufferedInput/StructuredField/chart 的 dirty 与保存收集覆盖完整。

**写入owner：**

TE02

**模型：**

gpt-6.1-sol

**强度：**

high

**当前依据：**

src/renderer/ui/properties/PropertyControls.tsx:23-40,163-201,241-246,292-310
src/renderer/ui/properties/ChartProperties.tsx:295-321,500-505,596-612
src/renderer/ui/ComponentPropertiesEditor.tsx:18-42
tests/unit/componentPlatformProperties.test.tsx:109-129,248-269

**写域：**

src/renderer/ui/properties/PropertyControls.tsx
src/renderer/ui/properties/ChartProperties.tsx
src/renderer/ui/ComponentPropertiesEditor.tsx

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

不完整数值保留诊断，不 reset/clamp 当成功
图表自然提交代替强制 Apply
属性输入准确进入 dirty

**权威执行限定：**

复用现数值/图表编辑器，空值编辑保留未完成输入，不悄悄写0或夹值；有效图表数据自然应用。共享保存准备由TE03/U接线。

**保留行为：**

IME/local undo/stale capture
合法几何合同和现有 preview/cancel/color
多系列转 pie/donut 的真实保留系列确认
canvas text+frame coalescing

**验收：**

候选先被直接反例证伪，再用真实 consumer/载体和实际 diff 证明改动；mock-only/派发/提交不能称完成。重要 writer/history/recovery 迁移须未参与实施的 reviewer 核对基线+diff+证据。1–3最小检查通过即停，不全矩阵。

**检查建议（T核当前V10与匹配后选1–3条）：**

property: 先证伪
method: 实际几何 BufferedInput 清空后保存，baseline Number('')/clamp；修后 raw 保留、正式值不变、flush 未完成
carrier: actual property + real bridge
test: tests/unit/componentPlatformProperties.test.tsx
single_writer: T
property: 图表自然撤回
method: 实际 ChartProperties 改分类/系列/值，自然结束无 Apply，canonical 改一次，undo 还原；非法 cell/IME 留可修
carrier: ChartProperties + real V10 Session
test: tests/unit/teacherChartNaturalEditing.test.tsx (new)
single_writer: T
property: 保存当前属性
method: 复用 TE03 一次未 blur 合法 numeric/chart 保存冷重开；未完成输入不 allSaved
carrier: .h5lesson actual save
test: tests/integration/teacherAdvancedSaveClose.test.tsx (new)
single_writer: T

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="te03"></a>

### TE03 GUI/tool 保存与 close 收集眼前高级草稿

**结果：**

GUI/Ctrl+S/另存为和内置/外部保存收集同样的当前 GUI 草稿再保存实际固定版本。正常关闭自然应用有效输入，或保全不完整输入原目标与诊断后退出/重开，不逐面板 Apply，不报旧 formal 版本为眼前稿已保存。

**写入owner：**

U

**模型：**

gpt-6.1-sol

**强度：**

high

**开工接口ready：**

TE01-port
TE02-port

**当前依据：**

src/renderer/store/editorStore.ts:90-103,113-115,136-141,189-195
src/main/workbench/delivery/DocumentDeliveryService.ts:82-110,129-133
src/main/workbench/workbenchToolServices.ts:186-198
src/renderer/app/useCourseProjectLifecycle.ts:199-217,231-242
src/renderer/app/useFlowDocumentRecovery.ts:21-86
O05-agent-disk-reconcile：GUI已能observe/reconcile，但公开Agent缺同owner续作入口，不是永久死锁。

**写域：**

src/renderer/App.tsx
src/renderer/store/editorStore.ts
src/renderer/documents/CourseV10DocumentBridge.ts
src/renderer/documents/DocumentProjection.ts
src/renderer/app/useCourseProjectLifecycle.ts
src/renderer/workbench/SelectionContextController.ts
src/renderer/workbench/ExecutionAssistant.tsx
src/renderer/workbench/elementCards/elementCardController.ts

**交唯一owner的小hunk：**

path: src/main/workbench/delivery/DocumentDeliveryService.ts
writer: X
path: src/main/workbench/execution/AgentFileService.ts
writer: I
path: src/main/workbench/execution/ExecutionEngine.ts
writer: G
path: src/main/workbench/external/ExternalMcpService.ts
writer: H

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

工具保存准备 GUI 当前稿
close 将 can-commit 和 can-preserve 分开
allSaved 包括 source/JSON/property 当前稿
外部磁盘版本改变后，内置/外部Agent经共同FileService observe/reconcile owner取得采用磁盘、保当前或实际支持合并的结果，同任务继续同路径save；不要求先开GUI。无本地稿可接新版本，有本地稿保输入并给必要结果选择。I写公共文件接线，G/H写两actor实际consumer，U保持已有GUI同步；不重复已落盘动作，不强制先save当前稿作前置。

**权威执行限定：**

U写App/Store/Bridge，Main prepare/save I、Actor G/H。后台无GUI不强建App，GUI有可见稿时准备相同当前内容。

**保留行为：**

fixed-version/single-flight/edit-during-save dirty
权威 savedRevision/CAS/stop/unknown 查证
保存不新增内容 History
Flow 原始失败源文/诊断/准备素材
Main headless save 和应急关闭诚实反馈

**验收：**

候选先被直接反例证伪，再用真实 consumer/载体和实际 diff 证明改动；mock-only/派发/提交不能称完成。重要 writer/history/recovery 迁移须未参与实施的 reviewer 核对基线+diff+证据。1–3最小检查通过即停，不全矩阵。
外部磁盘版本改变→内置/外部Agent经共同observe/reconcile采用/保当前→同任务继续同路径真实save；至少一个无GUI headless真实公开consumer反例。已有GUI同步保留，不能替代Agent入口证明；保当前不盲覆盖未确认磁盘版本。

**检查建议（T核当前V10与匹配后选1–3条）：**

property: 先证伪
method: 真实 renderer prepare adapter+Main 中 source/JSON visible draft 经 tool save，baseline 保存前正式内容；修后实际准备并保存 resulting revision
carrier: DocumentDeliveryService+real adapter+file
test: tests/integration/g20DocumentDelivery.test.ts
single_writer: T
property: 一次保存关闭往返
method: 合并 source/JSON/numeric/chart Ctrl+S/tool save，期间后编辑仍 dirty；非法 JSON/Flow preserve-close/reopen 还原 raw 与定位，邻目标不变
carrier: real window+recovery+fresh Main .h5lesson
test: tests/integration/teacherAdvancedSaveClose.test.tsx (new)
single_writer: T
property: 失败不重放
method: actual save failure/unknown 或 recovery I/O fail 留当前输入；同一操作查先前 effect，不再次写入
carrier: real DocumentHost save failure fixture
test: tests/integration/g20DocumentDelivery.test.ts
single_writer: T
planned: tests/integration/productFollowup/T03/agentDiskReconcile.test.ts
property: 绑定同文件→其他进程/文件owner改变磁盘→headless外部Agent实际共同consumer observe/reconcile→采用磁盘/保当前的当前内容结果→同任务save；内部consumer最近层复用同owner。不是Agent写盘后仅GUI成功，也不是一般CAS/save绿case。
owner: T03整文件

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="te04"></a>

### TE04 Office 原格式恢复与回退

**结果：**

复用 OfficeContentService/OfficeFileService/File owner，让 office.create/edit 的成功修改有真实原格式前后版本恢复与变更回退。预写失败保原件，写后 unknown 查证不重放。人工系统 Office 编辑栈保持其真实 owner，不伪造 Text Session/宿主撤回。

**写入owner：**

TE04

**模型：**

gpt-6.1-sol

**强度：**

high

**最终汇合（不是开工依赖）：**

S05

**当前依据：**

src/main/workbench/office/OfficeFileService.ts:43-87
src/main/workbench/review/ExecutionChangeReviewService.ts:31-113,245-273
src/main/workbench/review/ChangeReviewStore.ts:6-68
src/main/workbench/execution/AgentFileService.ts:169-192
tests/integration/unifiedOfficeFileService.test.ts:49-94

**写域：**

src/main/workbench/office/OfficeFileService.ts
src/main/workbench/review/ExecutionChangeReviewService.ts
src/main/workbench/review/ChangeReviewStore.ts

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

既有 changeReview 原格式 binary snapshot 与恢复
成功修改自然可撤回
按真实回执表达已应用/已落盘，不泛化第二审批/Apply

**权威执行限定：**

复用Office/File/ChangeReview原格式恢复，不仿造Office/造Text Driver；I公共文件hunk独写。

**保留行为：**

OOXML 原格式/未改段落表格单元格幻灯片素材
有限计算 partial 保 unsupported 原式
physical CAS/stop/binding
物理写后 ACK unknown 不重放
manual system application

**验收：**

候选先被直接反例证伪，再用真实 consumer/载体和实际 diff 证明改动；mock-only/派发/提交不能称完成。重要 writer/history/recovery 迁移须未参与实施的 reviewer 核对基线+diff+证据。1–3最小检查通过即停，不全矩阵。

**检查建议（T核当前V10与匹配后选1–3条）：**

property: 先证伪
method: temp Office real edit 后 current changeReview entry baseline 不可回退；修后记录 actual binding/before/after 并恢复
carrier: OfficeFileService+FileArtifact+review
test: tests/integration/teacherOfficeRecovery.test.ts (new)
single_writer: T
property: 原格式回退
method: DOCX/XLSX/PPTX 小样各一字段 edit/readback/rollback/readback，未改内容和 unsupported formula 保留；语义/资源验收，无一般 hash 门
carrier: real OOXML bytes+existing inspectors
test: tests/integration/unifiedOfficeFileService.test.ts
single_writer: T
property: 冲突/unknown
method: disk 外改拒 stale rollback；replace 后失败 unknown，同 task 查询不第二次 replace；known prepare fail 零写盘
carrier: real file failure fixture
test: tests/integration/g20ChangeReviewEngineChain.test.ts
single_writer: T

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="te05"></a>

### TE05 复制当前稿不盲存源

**结果：**

按教师目标复制磁盘版本或当前可见稿；复制当前稿从真实活动 Session/草稿成副本，不隐式保存源。当前默认 disk copy 已正确，保 copied=disk-version；消除 flushFirst 要模型先 file.save 的机械手续。

**写入owner：**

TE05

**模型：**

gpt-6.1-sol

**强度：**

high

**最终汇合（不是开工依赖）：**

TE03

**当前依据：**

src/core/tools/AgentFileTools.ts:28,52
src/main/workbench/execution/AgentFileService.ts:325-352
src/renderer/lessonWorkspace/view/WorkspaceFilesTree.tsx:253-281,326-339
src/main/workbench/DocumentFileCoordinator.ts:105-110

**写域：**

src/core/tools/AgentFileTools.ts
src/renderer/lessonWorkspace/view/WorkspaceFilesTree.tsx

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

直接表达复制当前内容
软件选择真正 current snapshot，不要求模型 root/version/先 save

**权威执行限定：**

保已有正确磁盘版copy；明确当前稿副本不落盘源，不以先save为copy前置。coordinator交A01，文件执行交I。

**保留行为：**

default no overwrite
disk-version copy 不保存源且真实 copied 回执
source file unchanged
resource-copy diagnostics/per-item partial
move/rename binding 不变

**验收：**

候选先被直接反例证伪，再用真实 consumer/载体和实际 diff 证明改动；mock-only/派发/提交不能称完成。重要 writer/history/recovery 迁移须未参与实施的 reviewer 核对基线+diff+证据。1–3最小检查通过即停，不全矩阵。

**检查建议（T核当前V10与匹配后选1–3条）：**

property: 先证伪
method: 确认现有 disk copy pass，explicit current-draft copy baseline 要求保存/失败；只对后者实施，不把 blind-save 当已复现
carrier: real dirty DocumentHost+AgentFile
test: tests/integration/teacherCurrentDraftCopy.test.ts (new)
single_writer: T
property: 复制当前稿源仍未保存
method: unblurred source current draft copy，fresh-open dest 为新文本，source disk 为旧文本且 source dirty；按文本语义验收
carrier: GUI draft+real file dest
test: tests/integration/teacherCurrentDraftCopy.test.ts (new)
single_writer: T
property: 资源/失败
method: local attachment 连资源复制后 usable；dest conflict 失败无隐式 source save、无重复 completed item
carrier: WorkspaceFiles temp directory
test: tests/integration/teacherCurrentDraftCopy.test.ts (new)
single_writer: T

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="te06"></a>

### TE06 资料选集进入实际提交

**结果：**

资料页采用整材料/片段勾选实际冻结进同一次助手提交，模型取得对应真实来源/选段。课例切换、提取版本变化、取消选段不串旧资料；原资料和聊天附件归属各自保留。

**写入owner：**

TE06

**模型：**

gpt-6.1-sol

**强度：**

high

**最终汇合（不是开工依赖）：**

S07

**当前依据：**

src/renderer/app/LessonWorkspaceHost.tsx:42,60-79
src/renderer/lessonMaterials/LessonMaterialBrowser.tsx:76-80
src/shared/lessonAuthoring.ts:8-11
src/main/workbench/execution/ExecutionDesktopService.ts:388-401,497-498

**写域：**

src/renderer/app/LessonWorkspaceHost.tsx
src/renderer/lessonMaterials/LessonMaterialBrowser.tsx

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

local selections 接真实 task submit
采用冻结选段，不仅复选框外观

**权威执行限定：**

把已有材料选择带入正式请求与可读投影；不让模型重抄路径和材料清单。U拥有UI公共接线，S07拥有共同服务。

**保留行为：**

原件/出处/授权
PDF real pages，DOCX 不虚构页，PPTX real slide/embedded images
真实 visual capability
当前会话附件与选集共存

**验收：**

候选先被直接反例证伪，再用真实 consumer/载体和实际 diff 证明改动；mock-only/派发/提交不能称完成。重要 writer/history/recovery 迁移须未参与实施的 reviewer 核对基线+diff+证据。1–3最小检查通过即停，不全矩阵。

**检查建议（T核当前V10与匹配后选1–3条）：**

property: 先证伪
method: 通过真实资料 browser 勾一片段，观 actual assistant/freezer 提交；baseline 缺选集，candidate input 有选中内容/source/version
carrier: LessonWorkspaceHost→actual task submit
test: tests/unit/teacherMaterialSelection.test.tsx (new)
single_writer: T
property: 真实选段
method: existing extraction fixture 选 PDF/PPTX fragment 进入冻结 material read，非选段不加，原件不动
carrier: extractor+execution compiler
test: tests/unit/materialReferenceRead.test.ts
single_writer: T
property: 课例生命周期
method: 切 lesson 或 extraction 更新，重新定位/diagnose，旧 lesson fragment 不进入新 task
carrier: production selection/freezer
test: tests/unit/teacherMaterialSelection.test.tsx (new)
single_writer: T

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="te07"></a>

### TE07 Skill 按需披露不隐撤核心能力

**结果：**

读教学/研究/数据方法不取消同任务已有授权 read/save/import；核心已配置能力默认可用，bundled research/data 可发现。内外用一份实际 availability/permission 注册投影，不另建工具模式。

**写入owner：**

TE07

**模型：**

gpt-6.1-sol

**强度：**

high

**开工接口ready：**

K06-min

**已有接口即可先做的子片：**

ScopedSkillService中文目录、读取未变参考文件等已有接口子片B0可做，K06-min只约束新增自动接入consumer。

**当前依据：**

src/core/tools/DocumentToolGateway.ts:187-201,296-298,1015-1026
src/core/tools/ToolCatalog.ts:111-114,129-147
src/shared/courseAgentSkills.ts:1-8
src/main/workbench/skills/ScopedSkillService.ts:49-50,72-82

**写域：**

src/shared/courseAgentSkills.ts
src/core/tools/SkillTools.ts
src/main/workbench/skills/BundledSkillService.ts
src/main/workbench/skills/ScopedSkillService.ts

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

core 不需 compulsory tools.load
读方法不隐撤无关能力
添加 research-and-report/data-and-report 实际 source names
不改教学方法成新阶段门

**权威执行限定：**

方法只指导内容。I注册/metadata，G调度，H目录通知；方法包真实交付才写可调用，不另方法执行授权平台。

**保留行为：**

Skill readonly 不执行脚本/增权限
冻结 roots/realpath/服务 availability
方法文本承载教学，通用 prompt 不固化方法
tools.load 可作可选发现

**验收：**

候选先被直接反例证伪，再用真实 consumer/载体和实际 diff 证明改动；mock-only/派发/提交不能称完成。重要 writer/history/recovery 迁移须未参与实施的 reviewer 核对基线+diff+证据。1–3最小检查通过即停，不全矩阵。

**检查建议（T核当前V10与匹配后选1–3条）：**

property: 先证伪
method: mixed course+Markdown run 读 orchestrate 后 actual read/save；baseline unknown-tool/support removal，candidate 保真实调用非仅 schema
carrier: actual Gateway+DocumentHost
test: tests/integration/g20SkillTools.test.ts
single_writer: T
property: 真实方法清单
method: I generate 一次，bundle list/read research/data 正文，真实未配置或未授权仍 absent
carrier: actual Bundled/Scoped+manifest
test: tests/unit/coursewareSkillsContract.test.ts
single_writer: T
property: 内外同源
method: 零模型 Engine/外部 run 前后同 core visibility，执行一个 preserved non-course operation；只有 actual explicit discovery change 才通知
carrier: Engine runTools+resident MCP list/call
test: tests/integration/teacherSkillCapabilityParity.test.ts (new)
single_writer: T

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="te08"></a>

### TE08 V10 图片结果卡

**结果：**

实际时间线 ready image 在 V10 Slide/Flow/Spatial 插入替换，软件捕获真实目标/素材/位置/身份；保人工 frame/effects，默认生效可撤回。结果已应用和保存状态分开，已有图像连接/计费/unknown 不重放。

**写入owner：**

TE08

**模型：**

gpt-6.1-sol

**强度：**

high

**开工接口ready：**

K02-min

**当前依据：**

src/renderer/workbench/ExecutionTimeline.tsx:6,134
src/renderer/workbench/ImageResultCard.tsx:47-60,74-93,122-124
src/main/workbench/DocumentHostService.ts:63
src/core/tools/HostToolServices.ts:469

**写域：**

src/renderer/workbench/ImageResultCard.tsx
src/renderer/workbench/imageResultCard.css

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

生产 V9-only filter/address 改 V10
软件实际 surface 适配，模型不手抄 frame/身份

**权威执行限定：**

V10图片卡接已有图像连接/任务内容，软件绑定当前目标并嵌入；真实GPT OAuth按既有授权验证，不扩新媒体收费路径。

**保留行为：**

原图 retained
不自动新 provider/path
真实 provenance/billing 与 stopped ready/unapplied
same action unknown lookup
frame/effects/resource bytes undo

**验收：**

候选先被直接反例证伪，再用真实 consumer/载体和实际 diff 证明改动；mock-only/派发/提交不能称完成。重要 writer/history/recovery 迁移须未参与实施的 reviewer 核对基线+diff+证据。1–3最小检查通过即停，不全矩阵。

**检查建议（T核当前V10与匹配后选1–3条）：**

property: 先证伪
method: actual card+real V10+ready fixture baseline 无 target；修后选择正确目标并进入 real apply
carrier: timeline card+DocumentHost
test: tests/unit/g20ImageResultCard.test.tsx
single_writer: T
property: 事务往返
method: 不用生成，local ready image 插入一 surface、替换另 surface；real Session/resource/frame，undo/save/fresh reopen
carrier: real image owner+.h5lesson
test: tests/integration/teacherV10ImageCard.test.tsx (new)
single_writer: T
property: 真实视觉/目标
method: 一实际渲染图在目标 frame；pending 切选择不写 neighbor，unknown action lookup 不再生成
carrier: actual renderer+ready-resource apply
test: tests/integration/teacherV10ImageCard.test.tsx (new)
single_writer: T

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="te09"></a>

### TE09 导航13按钮与正式展示状态

**结果：**

人工能添加第13控制台按钮，软件保持可用排版；AI 可管理同一正式命名展示状态增删复制改名初始/缩略图/清覆盖，软件维护身份。保深度源码/自写导航，不将临时播放/相机写作者内容。

**写入owner：**

TE09

**模型：**

gpt-6.1-sol

**强度：**

medium

**最终汇合（不是开工依赖）：**

S10

**当前依据：**

src/renderer/ui/properties/CourseGlobalPropertiesPanel.tsx:437-449
src/shared/teacherControllerConfig.ts:64-76
src/components/teacher-controller/defaultController.ts:123-132
src/renderer/store/slices/slideAuthoringSlice.ts:157-207
src/renderer/ui/SceneStateStrip.tsx:48-49,104,114

**写域：**

src/renderer/ui/properties/CourseGlobalPropertiesPanel.tsx
src/renderer/ui/SceneStateStrip.tsx
src/core/tools/courseNavigationSchema.ts

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

remove >=12 UI gate 与 /12 counter
public state management 接现 owner
不创造13-action 合同，不让教师手编辑 JSON 兜底

**权威执行限定：**

删除UI12数量门、接已有展示状态，不造13动作合同。I/H/G接AI公共消费者。

**保留行为：**

现有 navigator、scene/step、directory/progress/keyboard
source proxy、author inert、session view
state overrides/order/initial/thumbnail/interactions
human frame、simple/custom navigation

**验收：**

候选先被直接反例证伪，再用真实 consumer/载体和实际 diff 证明改动；mock-only/派发/提交不能称完成。重要 writer/history/recovery 迁移须未参与实施的 reviewer 核对基线+diff+证据。1–3最小检查通过即停，不全矩阵。

**检查建议（T核当前V10与匹配后选1–3条）：**

property: 先证伪
method: actual global properties 12 buttons add baseline disabled；修后 actual 13th button update 不 hand JSON
carrier: global properties+V10 commands
test: tests/unit/teacherControllerProperties.test.tsx
single_writer: T
property: 导航可用
method: 真实 controller 13按钮最后 action 在 play 可点，author inert/popup 布局可用，save/reopen config
carrier: actual default control+Player viewport
test: tests/unit/TeacherControllerMatureUiV10.test.ts
single_writer: T
property: 同正式 state writer
method: 共享内外 public request create/copy/rename/initial/delete，state/refs 保留、undo，fresh saved reopen+Player initial
carrier: Gateway/Session+Published Player
test: tests/integration/teacherPresentationStateParity.test.ts (new)
single_writer: T

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="te10"></a>

### TE10 多选资产与现有库管理同源

**结果：**

多个选中对象一起提炼资产在人工/内置/外部表达同范围；既有导入/更新/删除由同 catalog owner。真实多 roots/子图/源码依赖/素材保留，软件维护身份，作品实例和 my-library 归属分清。

**写入owner：**

TE10

**模型：**

gpt-6.1-sol

**强度：**

high

**最终汇合（不是开工依赖）：**

S10

**当前依据：**

src/renderer/app/useComponentLibrary.ts:105-125,137-170
src/core/tools/AssetSourceTools.ts:14-34,55-63
src/core/tools/DocumentToolGateway.ts:876-902
src/main/workbench/assetSources/componentLibrarySearch.ts:71-92
src/main/componentCatalogManager.ts:105-125

**写域：**

src/core/tools/AssetSourceTools.ts
src/renderer/app/useComponentLibrary.ts
src/main/workbench/assetSources/componentLibrarySearch.ts

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

public extraction single-instance 扩 actual multi-selection
existing library management 共享实际入口

**权威执行限定：**

多选/库管理实体只本包；S10公共接入不重复库实现。

**保留行为：**

asset search/use/save only user requested
real subtree/source/dependency/media
new instance software identity/editability
my-library ownership/executable trust/version replacement transaction

**验收：**

候选先被直接反例证伪，再用真实 consumer/载体和实际 diff 证明改动；mock-only/派发/提交不能称完成。重要 writer/history/recovery 迁移须未参与实施的 reviewer 核对基线+diff+证据。1–3最小检查通过即停，不全矩阵。

**检查建议（T核当前V10与匹配后选1–3条）：**

property: 先证伪
method: manual multi-root fixture vs public two roots request baseline only one；修后 real archive 两 roots/order/group
carrier: real library archive+Gateway
test: tests/integration/teacherMultiSelectionAsset.test.ts (new)
single_writer: T
property: 真实复用可编辑
method: 两 roots 共图片/module Save/search/use 到另V10页，source/geometry 可独立编辑、资源 usable、undo insert
carrier: catalog install/search/read+real Session
test: tests/integration/teacherMultiSelectionAsset.test.ts (new)
single_writer: T
property: 管理实际范围
method: 支持 archive import/update/delete my-library；existing instances usable，失败/stale 不报成功
carrier: actual catalog manager+temp managed directory
test: tests/integration/teacherAssetManagementParity.test.ts (new)
single_writer: T

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="a01"></a>

### A01 工程分页与 Flow 正文保真同一 owner

**结果：**

分页读取不会把教师未观察修改伪装成模型基线；普通货币不降级旁边互动；无 marker 的确定局部改写保留正文身份、frame/style。

**写入owner：**

A01

**模型：**

gpt-6.1-sol

**强度：**

high

**当前依据：**

id: PF-01
status: confirmed E1+E2
source: docs/archive/local/evidence/20261007-product-audit/records/audit-claims.json
fact: coordinator.ts:283-293 每页 remember 完整新 snapshot 却只返回 slice；297-302 最新整 baseline；人工 tan 被旧首段正式覆盖的 V10 内存重现。
id: PF-04
status: confirmed E1+E2
source: docs/archive/local/evidence/20261007-product-audit/records/audit-claims.json
fact: markdown.ts:144-150 未闭合美元触发 invalid；coordinator.ts:148-170 整篇 preparedHtml fallback；flowDocumentProjection.ts 删除旧互动。
id: PF-05 / CO-10
status: confirmed E1+E2
source: docs/archive/local/evidence/20261007-product-audit/records/product-findings.json
fact: coordinator.ts:149-158 previous 无 file 身份分支；markdownIdentity.ts 已有位置对齐；Flow adapter 按旧 block.id 才保人工属性。
id: PF-03
status: confirmed count E2, maintenance dimension
source: docs/archive/local/evidence/20261007-product-audit/records/audit-claims.json
fact: ACK 按 snapshot 对象引用重复 Driver/完整投影，1/8 文件观察导致 apply 次数 1/8；顺带同 owner 修准确 baseline 后消除同一内容版本重复表示，不另建缓存平台。

**写域：**

src/core/projectFiles/componentPlatform/coordinator.ts
src/shared/document/markdown.ts
src/shared/document/markdownIdentity.ts
src/core/components/document/flowDocumentProjection.ts

**接线需求：**

DocumentToolGateway.ts project file adapter接线由 I；如需要传递稳定捕获标识，A01 给窄类型与 hunk，不改 Gateway。
DocumentHostService / Session 事务语义由 I 保持；A01 不增第二 writer。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

分页内容由软件捕获同一文件内容版本并稳定续读，或明确拒绝同文件混页；不能以无关工程 revision 门替代真实文件基线。apply 与最终 CAS 保留。
解析局部失败保已解包正式对象和已解析块；普通 $5 用字面美元识别规则，真公式继续原 math parser；不整篇静态化、不要求 AI 转义所有美元。
复用位置/类型/单编辑范围身份算法到 Flow adapter；重复段落按真实 source map，无法确定不随便按文本匹配。已有结构删除仍可明确删除。
ACK 以实际不可变捕获版本共享投影而非对象引用重复；只在本 package 相同边界实现，不改变观察授权。

**权威执行限定：**

同coordinator修混页、普通美元/普通链接、Flow身份与同版ACK。复用已有Markdown身份算法，不按文本全等乱配，真删除仍成立。

**保留行为：**

保持现有专业算法、结构和动态源码表达；普通修改默认生效、同一 History 撤回、保存及重开保持。
身份/资源由软件维护，不让模型抄 marker、填有限 viewport 的机械几何。

**验收：**

分页读取不会把教师未观察修改伪装成模型基线；普通货币不降级旁边互动；无 marker 的确定局部改写保留正文身份、frame/style。

**检查建议（T核当前V10与匹配后选1–3条）：**

path: tests/integration/contentRevisionProjectFilesV10.test.ts
name: pagination keeps intervening teacher edit
status: planned
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/integration/contentRevisionProjectFilesV10.test.ts -t "pagination keeps intervening teacher edit"
path: tests/integration/contentRevisionProjectFilesV10.test.ts
name: Flow literal dollars and markerless rewrite preserve opaque object and manual attributes through undo save reopen
status: planned
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/integration/contentRevisionProjectFilesV10.test.ts -t "Flow literal dollars and markerless rewrite preserve opaque object and manual attributes through undo save reopen"

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="a02"></a>

### A02 HTML 实测装配与源码保真单一 owner

**结果：**

题号/伪元素、Flow 页面背景、绘制顺序和整体合成保真；测量局部失败仍保可用原源码，普通 content 改字不重新排整页。候选 fixed/outline/字体 alpha 先证伪再修。

**写入owner：**

A02

**模型：**

gpt-6.1-sol

**强度：**

xhigh

**当前依据：**

ids: C09
C10
C11
C12
C13
AR04
status: confirmed mechanism E1 + reused E2; final V10 pixels unverified
source: docs/archive/local/evidence/20261007-product-audit/records/product-findings.json
fact: pseudo 无 serializer consumer；root paint 未入 Flow independent；group shell children=[] 将 opacity/filter 留空 iframe；flatten/外框改变绘制环境；measure 异常直接 not_committed。
ids: G-F08f
C-6
C-5
C14
AR08
status: candidate/partial; first specific falsifier required
source: docs/archive/local/evidence/20261007-product-audit/records/audit-claims.json
fact: fixed 检测在 scopes 循环、outline-only wrapper 未入 hasPaint；颜色 alpha/font 需当前 professional consumer/最终载体证据。AR08 独立 themeCss 无 active request producer，不能当普遍故障。

**写域：**

src/main/workbench/contentApply/applyService.ts
src/main/workbench/contentApply/application/html.ts
src/main/workbench/contentApply/application/professionalHtml.ts
src/core/contentApply/assembly/htmlAssembly.ts
src/main/workbench/contentApply/measurement/browserCapture.ts

**接线需求：**

A03 资源用法/来源/修复原字节接线由 A02 在 applyService 唯一写域顺序接入；A03 叶资源/measurement/relay 工作可先并行。
需要正式新字段时类型/Schemas/DocHost 接线由 I；不能为单个 CSS 候选先建新平台。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

在同一 browser capture/assembly/serializer consumer 传递伪元素及匹配样式，保持题号文字。原 CSS 作用域无法等价专业映射时保共同 Web 源码 scope，而不是让模型写实体题号。
Flow root paint 进入已有正确页面/正文 owner，保持自然阅读流。独立块可编辑，不复制每块背景。
保原 stacking algorithm/orderedChildren；非 context 父绘制相位与合成依赖需共同 scope 时保源；可等价整体效果只施一次，禁止逐子复制 opacity。
静态 measurement 的真实获取/渲染局部失败可回现有源码 carrier+清楚诊断；用户主动 abort 必须零本阶段提交，不能用 fallback 吞取消。
fixed/outline/clip/mask 以一个实际 capture 反例验证；root/inline alpha/custom font 用当前 professionalHtml/root consumer解析负例验证是否会丢色/字体，已保 Web 的情况不扩大 professional schema。AR08 若 producer 仍不存在只记录窄内部合同，不修成新能力。

**权威执行限定：**

applyService/html.ts/htmlAssembly/browserCapture/professionalHtml全文同writer；A03叶并行后交本owner接线。CSS候选先证伪，不抢同文件。

**保留行为：**

保持现有专业算法、结构和动态源码表达；普通修改默认生效、同一 History 撤回、保存及重开保持。
身份/资源由软件维护，不让模型抄 marker、填有限 viewport 的机械几何。

**验收：**

题号/伪元素、Flow 页面背景、绘制顺序和整体合成保真；测量局部失败仍保可用原源码，普通 content 改字不重新排整页。候选 fixed/outline/字体 alpha 先证伪再修。

**检查建议（T核当前V10与匹配后选1–3条）：**

path: tests/unit/htmlMeasuredStacking.test.ts
name: keeps the z5 foreground context atomic
status: existing
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/unit/htmlMeasuredStacking.test.ts -t "keeps the z5 foreground context atomic"
path: tests/integration/contentRevisionHtmlV10.test.ts
name: retains generated paint compositing and measurement failure source in V10
status: planned
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/integration/contentRevisionHtmlV10.test.ts -t "retains generated paint compositing and measurement failure source in V10"
path: tests/e2e/contentRevisionHtmlV10.spec.ts
name: one actual V10 renderer fixture covers pseudo Flow root paint overlap whole-opacity and scrolling fixed
status: planned
command: planned focused real-renderer check after only related carrier build preparation
scope: 真 V10 画面/一次核心互动；旧网页 Chromium 图片与旧 V9 测试不当果铃通过

**条件/候选：**

candidateFixture: planned: pure static fixed without sourceScopes + outline-only wrapper + root rgba(.5)/custom font
lowestCost: 先直接 browserCapture/assembly/professionalHtml 解析并检查实际正式 draft；机制未丢则关闭候选。fixed/合成像素分歧用一页原网页与正式 V10 carrier 对比，不能仅看字符串。
goNoGo: 仅支持场景真实保真损失触发局部修复；未证明全部 CSS 等价

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="a03"></a>

### A03 资源声明、现有 relay 与可修复原件闭包

**结果：**

已识别远程图片/样式/字体的许可用途从同一资源声明到测量与运行；失效资源字节可保存重开后修复；offline 只声明真实可自足范围，不承诺所有网络程序离线。

**写入owner：**

A03

**模型：**

gpt-6.1-sol

**强度：**

high

**最终汇合（不是开工依赖）：**

A02

**当前依据：**

ids: C08
C15
C17
AR05
status: confirmed owner/consumer gap E1; no live network/pixel evidence
source: docs/archive/local/evidence/20261007-product-audit/records/product-findings.json
fact: remoteReferences 已输出但 measure.allowedNetworkOrigins 缺失；resources data URL 不能表达原 remote 用途；style/font CSP 狭窄；unresolvedResources 原 bytes 未正式入资源闭包；offlineComplete 只看登记 assets。

**写域：**

src/main/workbench/htmlImport/types.ts
src/main/workbench/htmlImport/extractHtmlResources.ts
src/main/workbench/contentApply/resources/contentResources.ts
src/main/workbench/contentApply/measurement/ElectronHtmlDesignMeasurement.ts
src/main/workbench/htmlPreview/htmlPreviewResponse.ts
src/main/workbench/htmlPreview/htmlPreviewResources.ts

**交唯一owner的小hunk：**

path: src/main/workbench/htmlPreview/HtmlPreviewService.ts
writer: S08

**接线需求：**

applyService.ts 全文 A02，resourceEdits/measure request hunk 只交 A02，A03 不触碰。
src/shared contracts/web data/shared workbench ports，SandboxComponentImplementation.ts、CourseV10RuntimeView.tsx、Published publish consumer 与 main/security.ts 的共享资源接线 hunk 交 I 按实际写域分配，A03 先完成叶和用例。
若更改 buildPublishedCourseV3.ts 与 A04/A09 有消费者冲突，由 I 单次接资源信息；不重写 Player。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

声明区分 media/style/font/connect，保原 URL 和 source attribution；普通资源经既有许可来源/relay，精确用途不等于开放任意远程脚本/全部网络。Worker 在无 supported 作品事实前不改 policy。
A02 顺序接入 prepare remote 与 unresolved 字节；可修复 bytes 用已有资源/source存储形态保留真实引用，不能诊断称保留而 save/reopen 没有原件。
运行端读取已登记资源来源；缺源局部提示且可用正文先应用；源程序、数据和编辑入口都保。
offline 计算需说明已登记资源/发现外链/联网行为各实际边界；embedded assets 不将原创联网程序宣称全离线。无需为了满足 offline 将程序静态化。

**权威执行限定：**

来源/measurement/relay按实际引用，原字节保存范围真实；security等公共根交实际owner，不新网络沙箱/逐来源审批。

**保留行为：**

保持现有专业算法、结构和动态源码表达；普通修改默认生效、同一 History 撤回、保存及重开保持。
身份/资源由软件维护，不让模型抄 marker、填有限 viewport 的机械几何。

**验收：**

已识别远程图片/样式/字体的许可用途从同一资源声明到测量与运行；失效资源字节可保存重开后修复；offline 只声明真实可自足范围，不承诺所有网络程序离线。

**检查建议（T核当前V10与匹配后选1–3条）：**

path: tests/integration/contentRevisionResourcesV10.test.ts
name: declared image style font sources flow into measurement relay and runtime without remote script grant
status: planned
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/integration/contentRevisionResourcesV10.test.ts -t "declared image style font sources flow into measurement relay and runtime without remote script grant"
path: tests/integration/contentRevisionResourcesV10.test.ts
name: broken image original bytes survive save reopen and repair
status: planned
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/integration/contentRevisionResourcesV10.test.ts -t "broken image original bytes survive save reopen and repair"
path: tests/unit/x1MixedDelivery.test.tsx
name: projects real multi-file source and both asset policies without changing author data or attribution
status: existing
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/unit/x1MixedDelivery.test.tsx -t "projects real multi-file source and both asset policies without changing author data or attribution"

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="a04"></a>

### A04 Published 按实际使用资源挂载

**结果：**

当前页/全局必需内容可运行，不被未用页远程素材挂起；后页资源在使用时获取并报告局部失败，导航和 dispose 不留迟到作业。

**写入owner：**

A04

**模型：**

gpt-6.1-sol

**强度：**

high

**当前依据：**

id: C16
status: confirmed E1 mechanism; no representative elapsed-time data
source: docs/archive/local/evidence/20261007-product-audit/records/product-findings.json
fact: publishedPlayer.ts:53-65 在 mount 前顺序 await 全 assets；专业图片/媒体只收 bytes；未用远程 Promise 可阻首次挂载。

**写域：**

src/player/componentPlatform/publishedPlayer.ts
src/player/components/ComponentPlatformRuntime.ts

**接线需求：**

资源声明/远程 URL 由 A03，I 接共用字段；A04 可用现 assets.url/绑定完成 loader 叶，不等待全资源合同。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

删除首次 mount 的未用全资产等待；优先 actual instance/global/当前呈现依赖，再按具体使用加载既有 URL。未知程序使用资源时现 resource binding resolver 按需响应。
最小当前资源 owner 队列/去重及停止 signal，不建跨项目缓存平台；失败为局部缺资源，保工程数据/source。
后页首次获取/返回导航保 instance/state lifecycle；dispose 取消 fetch 和禁止迟到更新。

**权威执行限定：**

仅准备被实际使用的资源再挂载Player，复用现有资源协议与清理；不按全工程资源加启动门，不承诺所有内容离线。

**保留行为：**

保持现有专业算法、结构和动态源码表达；普通修改默认生效、同一 History 撤回、保存及重开保持。
身份/资源由软件维护，不让模型抄 marker、填有限 viewport 的机械几何。

**验收：**

当前页/全局必需内容可运行，不被未用页远程素材挂起；后页资源在使用时获取并报告局部失败，导航和 dispose 不留迟到作业。

**检查建议（T核当前V10与匹配后选1–3条）：**

path: tests/unit/contentRevisionPublishedAssets.test.ts
name: unused pending remote asset does not block first mount and later use resolves or diagnoses
status: planned
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/unit/contentRevisionPublishedAssets.test.ts -t "unused pending remote asset does not block first mount and later use resolves or diagnoses"
path: tests/unit/r1PublishedPlayer.test.ts
name: cancels a direct spatial navigation on disposal and rejects later public requests
status: existing
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/unit/r1PublishedPlayer.test.ts -t "cancels a direct spatial navigation on disposal and rejects later public requests"

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="a05"></a>

### A05 工具导出活性与主动取消

**结果：**

仍有实际进度的工具构建不会被累计 120 秒误判失败；停止能取消 GUI Renderer/headless 作业并保写前零副作用和写后 unknown 不重放。

**写入owner：**

A05

**模型：**

gpt-6.1-sol

**强度：**

high

**最终汇合（不是开工依赖）：**

S09

**当前依据：**

id: C18
status: confirmed E1+fake-clock E2; >120s real course frequency unmeasured
source: docs/archive/local/evidence/20261007-product-audit/records/product-findings.json
fact: DocumentExportPort 固定120000；App GUI buildDocumentExport 无 signal；headless finally destroy；失败在 DocumentDeliveryService writing 之前。

**写域：**

src/main/workbench/delivery/DocumentExportPort.ts
src/main/workbench/delivery/HeadlessDocumentExportWorker.ts
src/renderer/workbench/delivery/buildDocumentExport.ts

**交唯一owner的小hunk：**

path: src/main/workbench/delivery/DocumentDeliveryService.ts
writer: X
path: src/shared/workbench/toolPorts.ts
writer: I
path: src/renderer/App.tsx
writer: U

**接线需求：**

src/shared/workbench/toolPorts.ts/IPC/Main App listener/workbenchToolServices.ts cancellation/progress hunk 交 I 单writer；A05 给窄 ports。
DocumentDeliveryService.ts 写后副作用保持，若要改只由 I 独立接线，不偷移写入 owner。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

使用已有作业 lifecycle 的活性/完成/取消，固定总时限改只判断实际失联；不简单删所有 timer、不以内容预算压缩原创程序。
主线程 cancel 传同请求 identity 到 Renderer AbortController；待回应、后备 worker、已停止晚结果有清楚终态。
不改人工 useCourseDelivery 格式/全产物语义；明确本端口只覆盖工具导出链。

**权威执行限定：**

仅工具/后台120s链；人工X另算。GUI该链未取消与后台finally销worker区分，不新作业平台。

**保留行为：**

保持现有专业算法、结构和动态源码表达；普通修改默认生效、同一 History 撤回、保存及重开保持。
身份/资源由软件维护，不让模型抄 marker、填有限 viewport 的机械几何。

**验收：**

仍有实际进度的工具构建不会被累计 120 秒误判失败；停止能取消 GUI Renderer/headless 作业并保写前零副作用和写后 unknown 不重放。

**检查建议（T核当前V10与匹配后选1–3条）：**

path: tests/integration/g20DocumentExportPort.test.ts
name: rejects foreign and stale replies; abort removes the pending request
status: existing
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/integration/g20DocumentExportPort.test.ts -t "rejects foreign and stale replies; abort removes the pending request"
path: tests/integration/g20DocumentExportPort.test.ts
name: active build beyond former deadline succeeds; silent host and abort cancel renderer/headless without write
status: planned extension
command: npx --no-install vitest run tests/integration/g20DocumentExportPort.test.ts -t "active build beyond former deadline"
scope: fake clock/progress/abort consumer behavior，非真实时长性能结论
path: tests/unit/g20DocumentExportRenderer.test.ts
name: fails closed for a forged snapshot identity and a cancelled request
status: existing
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/unit/g20DocumentExportRenderer.test.ts -t "fails closed for a forged snapshot identity and a cancelled request"

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="a06"></a>

### A06 同一资源/Journal owner 消除重复字节与未知归属全局阻断

**结果：**

小文字修改保持完整撤销/重做、恢复及当前 save，却不在每个 before/after/full checkpoint 再携带同一未改素材 bytes。 同时隔离/诊断真实未知归属不可读日志，使无关作品可正常保存，保原日志与真实未知写后副作用查证。

**写入owner：**

I

**模型：**

gpt-6-astra

**强度：**

xhigh

**当前依据：**

id: C41
status: confirmed E1 + historical fixture E2; no OOM/real-machine threshold
source: docs/archive/local/evidence/20261007-product-audit/records/product-findings.json
fact: Session structuredClone full state/model history；cloneDocumentResources Uint8Array.from；Journal v8 serialize full state；compaction 已有仍携带所有历史 bytes。旧128KiB/12 edits约25倍是fixture不是生产性能。
id: C22 / ASTRA-F15
path: src/main/workbench/documentJournal.ts:609-614
fact: 无documentId/path归属的不可读日志，在非readOnly assertAvailable分支阻断无关文件保存；readOnly open与known-binding绿case不是该属性证据。

**写域：**

src/core/tools/ToolRegistration.ts
src/core/tools/ToolCatalog.ts
src/core/tools/ToolTargets.ts
src/core/tools/DocumentToolGateway.ts
src/core/tools/HostToolServices.ts
src/core/drivers/CourseV10Driver.ts
src/core/drivers/courseV10Operations.ts
src/core/documents/DocumentSession.ts
src/core/documents/DocumentRegistry.ts
src/main/workbench/DocumentHostService.ts
src/main/workbench/workbenchToolServices.ts
src/main/workbench/execution/AgentFileService.ts
src/main/workbench/FileArtifactService.ts
src/main/ipc.ts
src/preload/index.ts
src/preload/desktop-api.d.ts
package.json
package-lock.json
vitest.config.ts
playwright.config.ts
electron-builder.yml
src/main/workbench/documentJournal.ts
src/shared/workbench/toolPorts.ts
src/core/contentApply/planning/types.ts
src/shared/workbench/execution.ts
src/main/workbench/JournalBindingIndex.ts
src/core/tools/ProjectFileTools.ts
src/core/tools/HtmlImportTools.ts
src/shared/contracts/component-platform/schema.ts
src/shared/contracts/component-platform/published.ts
src/shared/contracts/component-platform/runtime.ts
src/core/drivers/resources.ts

**接线需求：**

Session.ts 全文 I：A06 提交 history resource refs/detached snapshot/append 契约的明确 hunk 与 V10 用例；I 顺序接且独立 review。
共享 DocumentResources/Journal record schema 由 I；codec可读现 archive shape，未授权不迁移用户旧工程/不加旧工程转换器。
A07 Driver.validate 次数简化须让 I 合并 Session hunk，不能双写 Session。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

先在现资源/Journal owner 内给不变资源一个表示并让 before/after 引用该表示；保持素材增删替换、owner files、Undo/Redo 的对应 bytes，不建事件溯源/新数据库平台。
公共 snapshot 仍隔离可变调用方；不能简单共享外部 Uint8Array 暴露正式 state。
落盘 ACK/损坏识别/torn tail/stop barrier/收据保，checkpoint 失败原 durable append 继续有效；不缩短或静默丢 History 来省成本。
复用现JournalBindingIndex及日志恢复owner处理无可用index且无doc/path的不可读记录；不把单份未知归属记录变成全部文件保存门，不盲回放/删除原日志，不新恢复平台。实际能定位受影响文档的损坏继续只影响该文档。

**权威执行限定：**

I写Session/Driver/Journal，消未变资源重复保撤回与恢复；已有compaction，不新历史平台。Hash仅真实资源身份合同。

**保留行为：**

保持现有专业算法、结构和动态源码表达；普通修改默认生效、同一 History 撤回、保存及重开保持。
身份/资源由软件维护，不让模型抄 marker、填有限 viewport 的机械几何。

**验收：**

小文字修改保持完整撤销/重做、恢复及当前 save，却不在每个 before/after/full checkpoint 再携带同一未改素材 bytes。 同时隔离/诊断真实未知归属不可读日志，使无关作品可正常保存，保原日志与真实未知写后副作用查证。

**检查建议（T核当前V10与匹配后选1–3条）：**

path: tests/integration/contentRevisionV10HistoryResources.test.ts
name: repeated text edits reuse immutable resource storage and undo asset replace across restart save reopen
status: planned
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/integration/contentRevisionV10HistoryResources.test.ts -t "repeated text edits reuse immutable resource storage and undo asset replace across restart save reopen"
path: tests/unit/g20DocumentJournal.test.ts
name: keeps the durable append and complete history when checkpoint replacement fails
status: existing
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/unit/g20DocumentJournal.test.ts -t "keeps the durable append and complete history when checkpoint replacement fails"
planned: tests/integration/productFollowup/T10/unknownJournalScope.test.ts
property: 不可读日志无doc/path且无可用binding index；实际调用无关文件非readOnly assertAvailable及save成功，原损坏日志保留并可诊断；已知受损文档仍不误当恢复成功。readOnly open或known-binding case不能代替。
owner: T10整文件

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="a07"></a>

### A07 重复 validate 与 ctx/投影低成本收敛

**结果：**

同一不可变候选只做一次有必要的正确性校验/changed 判断；工具ctx获取与投影只做实际 consumer 所需工作，保身份/载荷和实际资源合同。

**写入owner：**

I

**模型：**

gpt-6-astra

**强度：**

xhigh

**当前依据：**

id: S07/C42
status: confirmed E1 duplicate work; latency unmeasured
source: docs/archive/local/evidence/20261007-product-audit/records/audit-claims.json
fact: Driver.apply 已校验；Session:199,216 再校同 candidate，withRevision 又 validate；200/221 重复 digest changed 判断。
id: PF-03
status: confirmed, owned by A01 not this writer
source: docs/archive/local/evidence/20261007-product-audit/records/audit-claims.json
fact: 同版本多 read snapshot ACK 重复 Driver/完整投影；A01 在 baseline owner修，A07不改 coordinator。
id: ctx projection
status: candidate only pending exact active consumer/call-count falsifier
source: root task scope; no proven blanket ExecutionContextProjection regression
fact: 不能从传闻删除 ctx 或整个上下文投影；ctx 若对当前只读/工具无用却全模型处理才收敛。

**写域：**

src/core/tools/ToolRegistration.ts
src/core/tools/ToolCatalog.ts
src/core/tools/ToolTargets.ts
src/core/tools/DocumentToolGateway.ts
src/core/tools/HostToolServices.ts
src/core/drivers/CourseV10Driver.ts
src/core/drivers/courseV10Operations.ts
src/core/documents/DocumentSession.ts
src/core/documents/DocumentRegistry.ts
src/main/workbench/DocumentHostService.ts
src/main/workbench/workbenchToolServices.ts
src/main/workbench/execution/AgentFileService.ts
src/main/workbench/FileArtifactService.ts
src/main/ipc.ts
src/preload/index.ts
src/preload/desktop-api.d.ts
package.json
package-lock.json
vitest.config.ts
playwright.config.ts
electron-builder.yml
src/main/workbench/documentJournal.ts
src/shared/workbench/toolPorts.ts
src/core/contentApply/planning/types.ts
src/shared/workbench/execution.ts
src/main/workbench/JournalBindingIndex.ts
src/core/tools/ProjectFileTools.ts
src/core/tools/HtmlImportTools.ts
src/shared/contracts/component-platform/schema.ts
src/shared/contracts/component-platform/published.ts
src/shared/contracts/component-platform/runtime.ts
src/core/drivers/resources.ts

**接线需求：**

Session.ts/DocumentToolGateway.ts/ExecutionEngine.ts/ExecutionContextProjection.ts 全文 I；A07仅交精确同候选重复段/ctx实际 consumer hunk与计数用例，缺证据部分不修改。
若发现 ctx 实为 coordinator ACK，则直接交 A01不新增第二包；不强行凑并发。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

用一次直接计数当前 V10 change/no-op/revision 流，定位同 candidate 确定重复后删重复 check，不增跨任务全局 validation cache。
只省同阶段重复 bytes/project clone，真实外部输入/候选变更/最终 revision 必须由现合同负责；不能 remove all validate/strict。
ctx 路径首次只读核对 exact active caller+一次计数。如果已足够窄或差异无真实 consumer就关闭；若证实重复，只返回窄 projection并保模型 original/context.read，不为此建设上下文平台。

**权威执行限定：**

已有计数覆盖的重复检查修；其他ctx重复先证伪。G拥有context projection，不删所有原消息/内容。

**保留行为：**

保持现有专业算法、结构和动态源码表达；普通修改默认生效、同一 History 撤回、保存及重开保持。
身份/资源由软件维护，不让模型抄 marker、填有限 viewport 的机械几何。

**验收：**

同一不可变候选只做一次有必要的正确性校验/changed 判断；工具ctx获取与投影只做实际 consumer 所需工作，保身份/载荷和实际资源合同。

**检查建议（T核当前V10与匹配后选1–3条）：**

path: tests/integration/contentRevisionValidationWork.test.ts
name: V10 changed and noop candidates validate necessary stages once while rejecting invalid resource ownership
status: planned
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/integration/contentRevisionValidationWork.test.ts -t "V10 changed and noop candidates validate necessary stages once while rejecting invalid resource ownership"
path: tests/unit/g20ContextProjection.test.ts
name: M26 large calls and replies stay paired after projection and remain losslessly readable from original message indexes
status: existing
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/unit/g20ContextProjection.test.ts -t "M26 large calls and replies stay paired after projection and remain losslessly readable from original message indexes"

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="a08"></a>

### A08 非业务 trace 不阻工具与回执

**结果：**

非权威 timeline 慢/未settle不阻正常工具开始或正式回执返回；UI 顺序和原始记录可恢复，stop/quit 有可见 drain 状态。

**写入owner：**

A08

**模型：**

gpt-6.1-sol

**强度：**

medium

**当前依据：**

ids: ASTRA-F06
MCP-03/C26
status: confirmed E1+controlled pending E2; production disk latency unmeasured
source: docs/archive/local/evidence/20261007-product-audit/records/audit-claims.json
fact: ExternalMcpService.ts:461-480 工具前两次/工具后一次 await appendEvent；正式 document-operation另事件；service kind已跳过。Journal ACK是不同边界。

**写域：**

src/main/workbench/execution/ExecutionEventStore.ts

**交唯一owner的小hunk：**

path: src/main/workbench/external/ExternalMcpService.ts
writer: H
path: src/main/workbench/execution/ExecutionEngine.ts
writer: G
path: src/main/workbench/execution/ExecutionDesktopService.ts
writer: G

**接线需求：**

ExternalMcpService.ts/ExecutionEngine.ts/ExecutionDesktopService.ts caller取消 awaited 非业务链由 I；A08 给现 EventStore窄排队/drain能力和挂起负例。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

复用现有有序队列记录非业务 progress/display；批次/后台 drain 与正式业务 Promise解耦，避免额外回执前等待。
记录 reject 可诊断，未settle不拖业务；Stop/quit对 pending trace显示状态/必要 drain，不把 trace pending 当工程未知写入。
已提交后trace失败只补记录/回执，不重放正式工具；记录原 tool outcome/sequence保持。

**权威执行限定：**

辅助追踪不阻塞业务结果，保留必要诊断与收尾；仍由实际业务结果决定成功，不吞真实失败。

**保留行为：**

保持现有专业算法、结构和动态源码表达；普通修改默认生效、同一 History 撤回、保存及重开保持。
身份/资源由软件维护，不让模型抄 marker、填有限 viewport 的机械几何。

**验收：**

非权威 timeline 慢/未settle不阻正常工具开始或正式回执返回；UI 顺序和原始记录可恢复，stop/quit 有可见 drain 状态。

**检查建议（T核当前V10与匹配后选1–3条）：**

path: tests/integration/contentRevisionTraceCriticalPath.test.ts
name: pending pre and post trace do not block tool or replay committed operation
status: planned
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/integration/contentRevisionTraceCriticalPath.test.ts -t "pending pre and post trace do not block tool or replay committed operation"
path: tests/integration/g20ExecutionEvents.test.ts
name: retains three identical-status increments for both sources, replaces final item snapshots and never mixes reasoning or invents usage
status: existing
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/integration/g20ExecutionEvents.test.ts -t "retains three identical-status increments for both sources, replaces final item snapshots and never mixes reasoning or invents usage"

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="a09"></a>

### A09 通用 V10 验证/生成与历史 gate 实际 consumer 收敛

**结果：**

公开 validate:project 能解释当前 V10 有效/无效包；生成合同对应 V10/V3/API5；历史文档/gate 不再冒当前产品通过，不把无关旧路线门设成普通叶包前置。

**写入owner：**

A09

**模型：**

gpt-6.1-sol

**强度：**

high

**当前依据：**

ids: C01
IR-4
status: confirmed current script/codec divergence E1 + historical V10 fixture E2
source: docs/archive/local/evidence/20261007-product-audit/records/audit-claims.json
fact: scripts/validate-project.ts imports旧V9 schema/archive；CourseV10 codec 接受同包而 public validator拒绝。
id: current generator
status: confirmed direct source E1
source: scripts/generate-contracts.ts:5-7,29-77
fact: 生成仍 course-project-v9/published-course-v2/component-v4；package.json verify含旧roadmap/all矩阵。现合同生成与当前消费不一致是维护维度，不冒核心产品不可用。

**写域：**

scripts/validate-project.ts
scripts/generate-contracts.ts
scripts/check-development-roadmap.ts
scripts/check-preservation.ts
src/renderer/authoring/tools/nativeAuthoringTool.ts
src/renderer/authoring/tools/flowAuthoringTool.ts
src/renderer/authoring/tools/componentConfigureTool.ts
src/renderer/authoring/tools/backgroundTool.ts
src/core/tools/spatialStructure.ts
src/core/tools/spatialStructureSchema.ts
src/core/projectFiles/ProjectFileCoordinator.ts
src/main/workbench/build/ControlledBuildService.ts
src/main/workbench/observation/DynamicContentObservationStore.ts
src/main/workbench/htmlImport/prepareHtmlCourseCandidate.ts
src/main/workbench/htmlImport/HtmlImportDesktopService.ts
src/renderer/documents/CourseDocumentBridge.ts
src/renderer/export/slideVisualPreflight.ts
src/shared/componentCatalog.ts
src/main/componentCatalogScanner.ts
src/shared/constants.ts
src/shared/defaultTeacherControllerSource.ts
src/shared/lessonAuthoringDesktop.ts
src/shared/localAgentContract.ts
src/shared/localAgentInputMetrics.ts
src/shared/localAgentInteraction.ts
src/shared/localAgentProjection.ts
src/shared/localAgentRecordUsage.ts
src/shared/localAgentTaskContract.ts
src/shared/localAgentTaskGuards.ts
src/shared/localAgentText.ts
src/shared/localAgentTiming.ts
src/shared/localAgentUsage.ts

**交唯一owner的小hunk：**

path: src/main/workbench/contentApply/resources/contentResources.ts
writer: A03
path: src/core/tools/ProjectFileTools.ts
writer: I
path: src/core/tools/HtmlImportTools.ts
writer: I
path: src/shared/contracts/component-platform/schema.ts
writer: I
path: src/shared/contracts/component-platform/published.ts
writer: I

**接线需求：**

package.json scripts、shared schema/barrels、AGENTS.md/开发入口文档同步由 I/Root 单writer；A09 交命令接线候选，AGENTS需现Owner授权覆盖才改。
当前API5实际contract exporter须再读直接符号核实后生成，不凭旧 component-v4 文件名或记忆替换。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

validator复用当前codec/Driver并报告真实resource/source diagnostics；保无修改输入与稳定 CLI exit status；旧V9 validator若历史consumer仍需要移到明确历史入口，当前通用命令不建兼容转换器。
生成一次执行且语义验证当前版本/结构；已有制品身份合同要求的 digest可保，不以 hash证明内容对、不生成后紧接同义 --check。
历史gate降为对应历史consumer的显式维护命令，当前叶包只跑相关检查。只有证实当前保护属性/直接consumer才保为当前候选必要门；不因为本包把所有仓 gate全部删除。
O14低优先维护逐项处置：先查当前consumer；零consumer可移除/归档，有当前consumer迁当前入口/类型，只有历史consumer保明确历史入口。修悬空schema导入与当前label，不恢复旧facade/旧兼容，不全树清零。具体文件交下列owner；简单死代码/标签只解析或当前近层检查，不镜像测试。

**低优先定点处置：**

GLM-S03/GLM-S08: 上述spatial旧helper/Renderer authoring四文件5个悬空schema导入，核零current consumer后修/归档，不重接旧生产入口。
GLM-T05/G-F12*/D-5: 旧coordinator/build/observation/import/bridge历史引用与当前ProjectFileTools/HtmlImportTools label；当前工具两文件归I，其余本包；历史fixture/tests全文交T11。
G-F11a: 当前schema/published术语仅必要hunk交I；componentCatalog/scanner/constants/defaultTeacherControllerSource本包，保专业合同与原算法。
C-extra-1: contentResources.ts死helper归A03全文，A09只交当前consumer结论。
G-9: 10个localAgent文件、lessonAuthoringDesktop和fixture真实互引先核，保仍有历史consumer的合同或明确归档，不假称仅一个consumer。
G-10: 旧ProjectFileCoordinator恒等表达式、slideVisualPreflight及ControlledBuildService历史恢复字段，按当前consumer与保留行为处置，不能默认丢可恢复状态。

**权威执行限定：**

V10验证/新合同接实际consumer；历史纯文档gate诊断/只自身变化，真实代码资源门保留。仅活动闭包和新增红，不每叶全仓清零。

**保留行为：**

保持现有专业算法、结构和动态源码表达；普通修改默认生效、同一 History 撤回、保存及重开保持。
身份/资源由软件维护，不让模型抄 marker、填有限 viewport 的机械几何。

**验收：**

公开 validate:project 能解释当前 V10 有效/无效包；生成合同对应 V10/V3/API5；历史文档/gate 不再冒当前产品通过，不把无关旧路线门设成普通叶包前置。

**检查建议（T核当前V10与匹配后选1–3条）：**

path: tests/unit/validateProjectV10.test.ts
name: public validator uses production V10 archive and reports invalid declared resource without input writes
status: planned
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/unit/validateProjectV10.test.ts -t "public validator uses production V10 archive and reports invalid declared resource without input writes"
path: tests/unit/contractGenerationV10.test.ts
name: generates current V10 PublishedV3 API5 semantics for actual consumers
status: planned
scope: focused V10 or carrier behavior
command: npx --no-install vitest run tests/unit/contractGenerationV10.test.ts -t "generates current V10 PublishedV3 API5 semantics for actual consumers"

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="s01"></a>

### S01 安装版本机产品bootstrap与Agent直接连接

**结果：**

外部Agent自然定位/启动或附着已装果铃，直接消费现ready并HTTP连接；默认后台，已有GUI则附着。教师不抄Token/端口/ID，仅作品位置歧义问内容选项。

**写入owner：**

S01

**模型：**

gpt-6.1-sol

**强度：**

high

**最终汇合（不是开工依赖）：**

S02

**当前依据：**

CW-01
CW-02
CW-03
CW-04
CW-05
CW-06
CW-07
CW-08
CW-09
CW-10
CW-11
CW-12
CW-13
CW-14
CW-15
CW-16
CW-17
CW-18

**写域：**

scripts/mcpServerLaunch.ts
scripts/mcpSdkClient.ts

**条件候选新路径（不强制新模块）：**

resources/mcp-bootstrap/ 下打包helper（条件候选目录，不强制单独进程或模块）

**接线需求：**

I独写Main/index、ExternalMcpService以及目录接线。bootstrap消费现--headless-mcp/ready-file，不修改Main生命周期。Skill引用/安装hunk交已有Skill owner，教师面板文案交teacher唯一UI writer；不要求用户安装Node/取得源码，不建OS服务。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

先交已安装可执行入口定位与ready消费的最薄实现；优先实际安装/便携位置及现有进程事实，不建全局登记目录。无产品入口给真实未安装诊断，不能把旧Builder定位器冒充MCP bootstrap。
按任务路径或当前空间自动绑定；消费actual workspace/permission/profile/owned-attached与workspaceMismatch。已有GUI附着不夺owner；目标有歧义才问内容位置。端口冲突/ready失败不得把exit 0当成功。
先支持直接HTTP SDK和能力明确的外部client。具体CLI不支持本轮动态MCP时明确给其已有HTTP/正式配置消费方式；未知client不能承诺所有CLI自动挂载。

**权威执行限定：**

工程launcher保留，产品入口无源码/Node/tsx假定。Main/分发hunk交实际owner；不建OS服务/修改用户全局权限。

**保留行为：**

默认MCP/长效Token、Main headless与ready JSON、SDK HTTP attach/detach及正常owned stop已存在。工程launcher依赖仓库/tsx/dist且随父进程结束停owned；安装包未分发该脚本，同profile headless先起后GUI被拒。安装版一句提示词尚未证明。

**验收：**

仓库开发入口保持可用；产品入口在无源码/tsx假定下能得到真实ready并直连，选定作品后用现正式target/content服务应用和保存。
消费actual workspace/permission/profile/owned-attached/mismatch；目标明确软件自动选空间，歧义才问。
安装产品/CLI具体动态HTTP消费未测时只报engineering candidate，不能由Main参数支持推1prompt安装版通过。

**检查建议（T核当前V10与匹配后选1–3条）：**

command: npx --no-install vitest run tests/unit/mcpServerLaunch.test.ts tests/unit/mcpSdkClient.test.ts tests/integration/headlessResidentLifecycle.test.ts
property: ready/attached事实、detach不停止owner、关闭drain；这些是已有基础检查，新增product入口断言必须真正调用薄helper
command: 未来一次实际产品载体bootstrap→ready→HTTP共同服务，不发布
property: 无源码/tsx假定下实际可执行入口和薄helper；未知client兼容如实记录

**条件/候选：**

当前安装入口发现信息不足需实现者按真实安装布局选择，不从源码断言包已测。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="s02"></a>

### S02 同profile后台常驻、SDK detach与GUI升格生命周期

**结果：**

产品后台Main由正常应用生命周期持有，SDK detach不杀宿主；教师正常启动同profileGUI附加现Host/Session看/继续编辑，隐藏维持运行，明确退出drain/flush/dispose。

**写入owner：**

H

**模型：**

gpt-6.1-sol

**强度：**

high

**最终汇合（不是开工依赖）：**

S01

**当前依据：**

CW-09
CW-12
CW-13
CW-14
CW-15
CW-16
CW-17
WEB-11
WEB-12

**写域：**

src/main/workbench/external/ExternalMcpService.ts
src/main/workbench/external/ResidentMcpSettings.ts
src/main/workbench/external/ResidentMcpServer.ts
src/main/workbench/external/externalDesktopService.ts
src/main/index.ts
src/main/windowLifecycle.ts
src/main/windowLifecycleDesktop.ts

**接线需求：**

Main/index、ExternalMcpService整个文件、externalDesktopService及IPC/preload归I独写。leaf交singleton/window attach/close活动分类窄port。不能第二profile/工程绕过headless→GUI，不增加OS服务/代理/idle TTL。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

产品后台host由应用正常生命周期持有，SDK/client detach不杀宿主；明确停止/撤销/退出仍drain/flush/dispose。保留工程调试launcher的owned stop意义，不能无差别取消所有父进程退出保护。
同profile普通启动附加GUI到现Registry/Session；隐藏保持运行，真实pending调用才算关闭时在忙，空闲长效session不冒称正在执行。Token/端口主动变化后读取新ready并重新取当前工程事实。
短HTTP断同Session-Id查原回执；DELETE/newinitialize用新run当前事实。未知已执行文件/网页操作先查，不建全局exactly-once或跨终态登录平台。

**权威执行限定：**

H独写启动/生命周期；同host GUI共享DocHost，不第二profile/writer。SDK close仅本地，DELETE结束run与owned关自有host分清。

**保留行为：**

默认MCP/长效Token、Main headless与ready JSON、SDK HTTP attach/detach及正常owned stop已存在。工程launcher依赖仓库/tsx/dist且随父进程结束停owned；安装包未分发该脚本，同profile headless先起后GUI被拒。安装版一句提示词尚未证明。

**验收：**

后台先起→同profile开GUI仍同PID/同Registry/同History，先前未保存工程可编辑；SDK detach后host仍可连接，主动退出正常保全。
短断同Session-Id先查原回执；DELETE/newinitialize使用新run和当前目标。跨session未知写入先观察当前文件/工程，不加全局重放表。
headless先起→同profileGUI仍同Host/History/dirty工程，空闲session不算busy；明确退出正常保全。

**检查建议（T核当前V10与匹配后选1–3条）：**

command: npx --no-install vitest run tests/integration/headlessResidentLifecycle.test.ts tests/unit/windowCloseRecovery.test.ts tests/unit/windowVisibility.test.ts
property: 正常drain/关闭活动；新增同host promote fixture真实保原Registry/Session，非仅参数/字符串
command: 未来集成候选仅一次真实本机产品载体：bootstrap→后台应用→GUI接续→detach→正常退出；无需发布
property: 无仓库产品入口和实际窗口同一工程；安装/构建准备仍按届时授权，当前不运行

**条件/候选：**

当前安装入口发现信息不足需实现者按真实安装布局选择，不从源码断言包已测。
不默认跨任务终态/应用重启保浏览器登录；网页登录寿命与MCP长效分开。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="s03"></a>

### S03 网页实际结果授权与内外具体动作grant

**结果：**

内外按冻结任务结果和真实remote tool effect生成同具体动作grant；已授权低风险读/填写先做，不明确最终发送/提交范围才问内容选项，不因click/type名字每次询问。

**写入owner：**

S03

**模型：**

gpt-6.1-sol

**强度：**

high

**最终汇合（不是开工依赖）：**

H

**当前依据：**

WEB-02
WEB-03
WEB-04
WEB-05
WEB-06
WEB-14
CAP-BROWSER-EXTERNAL-ACTIONS
CAP-BROWSER-STATE-AND-EXPOSURE

**写域：**

src/main/workbench/externalTools/BrowserActionApprovals.ts
src/main/workbench/externalTools/managedBrowserControlCode.ts

**接线需求：**

I独写Engine permission/allow-all、ExternalMcpService、workbenchToolServices实际grant接线。S03只写BrowserActionApprovals/pure helper；ManagedBrowserMcpService归S04唯一writer。软件维护snapshot/operation身份，不交模型登记。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

按已发现remote tool真实effect判断read/write；外部mcp.invoke包装名称不代表修改。任务结果与实际操作范围明确则软件发具体grant给现consume链；保留当前页/operation身份但不把它们交模型填写。
现允许本任务提示与真正授权范围一致；选择未明确的最终提交/上传/发送结果时用已有ask显示结果选项，已授权低风险先做。不要把click/type全按同一种批准；也不把full偷换成不受目标约束。
上传用明确获授权文件owner冻结原字节，不局限于盲用workspace默认根；保留现相对来源/realpath/封存机制。读取来源与写授权分开，不让context增大授权。

**权威执行限定：**

已授权明确工作继续，范围不清才结果选项；grant不是逐动作弹窗。G/H/U接各actor原接口。

**保留行为：**

同WebContentsView与内置活跃run的同页takeover/resume已接；内置write一律ask，allow-all未建立任务授权；外部通用boolean确认未登记具体BrowserActionApproval；外部GUI控制仅认可builtin run；resume观察失败可能service称human但backend仍拦人工输入。

**验收：**

同任务显式授权连续两步低风险网页修改只消费已确定范围，不每步重复问；结果不明确仅问必要选项。
内外同一操作可登记并consume，read不误出修改批准；参数/真实页变化、Stop与人工接管使旧动作失效。
参考读取不增加网页写授权；上传明确文件由file owner冻结，不盲以workspace默认root代替授权。

**检查建议（T核当前V10与匹配后选1–3条）：**

command: npx --no-install vitest run tests/integration/g20BrowserActionApprovals.test.ts
property: 更新原逐动作预期为软件按冻结结果生成动作grant；保留真实参数/页身份及失败恢复断言，不把旧断言全部删掉
command: 独立T新增（I只提供接口）外部focused真实grant到tests/integration/g20McpBrowserRoundtrip.test.ts
property: 实际read免误批准与write consume，按Owner结果授权修旧逐动作预期，保真实页/参数身份断言

**条件/候选：**

任务授权生成具体动作grant，不等于无目标browser write；真实页/参数变化使旧动作失效。
外部上下文读取不扩写授权。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="s04"></a>

### S04 外部同页人工接管与失败恢复

**结果：**

外部Session显示同一task WebContents页，人登录/输入后交回；失败时真实backend键鼠owner与service/UI一致。重新观察人工后页面，不重放未知派发结果。

**写入owner：**

S04

**模型：**

gpt-6.1-sol

**强度：**

high

**开工接口ready：**

S03-port

**已有接口即可先做的子片：**

ManagedBrowserMcpService.control现有resume观察失败恢复B0可做，S03-port只约束新增grant接线。

**最终汇合（不是开工依赖）：**

H
S03

**当前依据：**

WEB-01
WEB-07
WEB-08
WEB-09
WEB-10
WEB-11
WEB-12
WEB-13

**写域：**

src/main/workbench/externalTools/ManagedBrowserMcpService.ts

**接线需求：**

ExternalMcpService整个文件、externalDesktopService/ExecutionDesktopService外run定位及IPC/preload由I独写。S04独占ManagedBrowserMcpService/ElectronEmbeddedBrowser并消费S03 grant；不改BrowserActionApprovals。teacher已持UI锁时只交最小UI hunk。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

外部session/run接到现浏览器viewport/control与可用窗口；同页hide/show不导航、不清登录。需要人工时在同profile宿主显示GUI（依S01窄port），无窗口时如实等待该入口，不换独立浏览器。
resume失败若backend已关人工输入，则真实恢复backend human并核对state；takeover的早返回不得保留错误owner。返回先取得新页面事实，清旧观察/grant，已派发中断写为unknown，查证再继续。
停止、换空间、撤权释放当前run；HTTP短断可同Session-Id续，DELETE/新run不得冒充旧页；不加入跨终态/重启登录持久平台。

**权威执行限定：**

同页外部/内置人工接管与恢复一致，按已有浏览器，不新环境。

**保留行为：**

同WebContentsView与内置活跃run的同页takeover/resume已接；内置write一律ask，allow-all未建立任务授权；外部通用boolean确认未登记具体BrowserActionApproval；外部GUI控制仅认可builtin run；resume观察失败可能service称human但backend仍拦人工输入。

**验收：**

外部takeover→人工输入→resume使用同一WebContents；resume snapshot失败后老师真实可输入，再次接管/重试可恢复。
派发后断连/取消的unknown先查询页面事实；不重放未知提交。不同client能力及无窗口条件诚实披露。

**检查建议（T核当前V10与匹配后选1–3条）：**

command: npx --no-install vitest run tests/integration/g20BrowserExecutionControl.test.ts tests/integration/g20ManagedBrowserTakeoverWait.test.ts
property: 现同run接续，新增backend控制已切agent后snapshot失败→真实恢复human→重试反例
command: 未来GUI候选对本地可控网页做一次外部同页人工输入/返回和snapshot失败恢复
property: 真实WebContents键鼠owner；不访问供应商或有实际发送副作用网站

**条件/候选：**

当前受管页面为随机非持久partition；不宣称读取了教师别的浏览器已开页或长期保存账号登录。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="s05"></a>

### S05 Office现有服务的共同能力接入

**结果：**

内外同授权调用现OfficeFileService处理原格式语义，接teacher TE04真实恢复/保存结果；模型不维护OOXML/资源/版本，服务域不重造Office回退。

**写入owner：**

I

**模型：**

gpt-6-astra

**强度：**

xhigh

**开工接口ready：**

K01-min
TE04-port

**最终汇合（不是开工依赖）：**

TE04

**当前依据：**

CAP-EXTRA-INJECTION
CAP-OFFICE-PARITY
CAP-OFFICE-REAL-SCOPE
CAP-OFFICE-APPLY-REVERT

**写域：**

src/core/tools/ToolRegistration.ts
src/core/tools/ToolCatalog.ts
src/core/tools/ToolTargets.ts
src/core/tools/DocumentToolGateway.ts
src/core/tools/HostToolServices.ts
src/core/drivers/CourseV10Driver.ts
src/core/drivers/courseV10Operations.ts
src/core/documents/DocumentSession.ts
src/core/documents/DocumentRegistry.ts
src/main/workbench/DocumentHostService.ts
src/main/workbench/workbenchToolServices.ts
src/main/workbench/execution/AgentFileService.ts
src/main/workbench/FileArtifactService.ts
src/main/ipc.ts
src/preload/index.ts
src/preload/desktop-api.d.ts
package.json
package-lock.json
vitest.config.ts
playwright.config.ts
electron-builder.yml
src/main/workbench/documentJournal.ts
src/shared/workbench/toolPorts.ts
src/core/contentApply/planning/types.ts
src/shared/workbench/execution.ts
src/main/workbench/JournalBindingIndex.ts
src/core/tools/ProjectFileTools.ts
src/core/tools/HtmlImportTools.ts
src/shared/contracts/component-platform/schema.ts
src/shared/contracts/component-platform/published.ts
src/shared/contracts/component-platform/runtime.ts
src/core/drivers/resources.ts

**接线需求：**

本包无独立实体写域，全部I共有root/interface小hunk；OfficeFileService、FileArtifact和Review恢复由teacher TE04唯一writer，不单独建active leaf。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

先以现inspect/create/edit parser接共同能力，支持条件保真实format、授权路径、冻结版本和stop；模型不维护OOXML/资源/版本。
现office inspect/create/edit归同load/discover/execute，外部仍经过已观察binding/路径/Stop，不另建外部Office实现。
Office恢复/当前保存port由teacher TE04提供，本包只消费真实saved/applied/unknown，不伪造Text Session或第二History。
不支持公式保原式/局部计算诊断；不能静态猜测拒整份可用Office，也不能假称完整Excel重算或系统Office未保存稿已合并。

**权威执行限定：**

仅纳K01/I共同Office consumer接线，不独派实体writer；TE04恢复。

**保留行为：**

AgentFileService已持OfficeFileService及已观察binding；有限DOCX/XLSX/PPTX语义处理真实存在，外部files窄type未暴露Office。edit直接replace落盘，没进课件History/AI回退，系统Office未保存稿不归宿主。

**验收：**

内外同parser/真实Office owner，read-only只inspect，来源/已观察binding不因读取更多参考扩大写范围。
外部产生真实原格式内容，TE04恢复/保存结果port经此入口回执一致，后来磁盘人工改不被覆盖。
物理写入后回读或ACK失败明确unknown并先读取现文件，不重复create/edit。

**检查建议（T核当前V10与匹配后选1–3条）：**

command: 独立T新增（I只提供接口）外部Office共享dispatch focused fixture，复用tests/integration/unifiedOfficeAgentFiles.test.ts
property: 真正调用现原格式owner，非目录名称
command: 消费teacher TE04最小原格式恢复/保存检查记录，接口/相关实现未变不重跑
property: 不重复Office回退实体测试，不争写TE04

**条件/候选：**

完整Office版式、任意图表/图片、共享/数组公式不在现服务承诺。
若当前宿主根本没有Office草稿，不能写成已实现默认仅应用后显式保存；方案及证据需按真实文件owner表述。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="s06"></a>

### S06 计算授权数据桥、可用产物与artifact共同交付

**结果：**

软件冻结授权数据给现计算后端、维护真实work/output位置和有效产物；内外artifact.save同服务交付真实用户文件。ImageResultCard UI归teacher，本包只消费已ready资源。

**写入owner：**

S06

**模型：**

gpt-6.1-sol

**强度：**

high

**当前依据：**

CAP-COMPUTE-SHARED-AND-INPUT
CAP-ARTIFACT-DELIVERY
CAP-IMAGE-SHARED-CONDITIONS
CAP-IMAGE-HUMAN-CARD
CAP-SEARCH-MEDIA-CONFIGURATION

**写域：**

src/core/tools/WorkbenchServiceTools.ts
src/core/tools/HostArtifactTools.ts
src/main/workbench/compute/ComputeJobService.ts
src/main/workbench/compute/PodmanComputeBackend.ts
src/main/workbench/execution/HostArtifactDeliveryService.ts

**接线需求：**

I扩现HostToolServices compute input提供者、artifact parser/support/handler接公共根并删除Engine私有delivery分支；字节读取仅File/资料/作业owner给，不能通过模型base64或临时路径执行搬运。 ImageResultCard目标/应用UI全归teacher；本包不写该实体。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

用户指定已有文件/材料作为数据时由授权file/material owner冻结bytes填现ComputeJobInput.inputs；public输入只表达来源语义，软件维护内部ID、mount名称与版本。
现work/output保唯一实路径，软件向程序内容请求提供可使用的输入/输出位置，输出Names由内容意图/实际产物确定；不改计算backend平台/安装环境。
已完成exit0但某辅助文件坏，逐文件诊断并保有效成果可读取/交付；保缺文件、symlink、越界与未知进程结果真实状态，不伪造整批ready。
将现artifact.save注册内外同一服务，query已有来源回执后交付，目标冲突不给无声覆盖；ready、应用工程、写入用户文件分别表达。

**权威执行限定：**

数据桥/有效产物/完整可取日志/独立成果，I公接线。ImageCard TE08独写，后端缺只条件不新装WSL/Podman/媒体。

**保留行为：**

内外同ComputeJobService，但公开compute只接代码/输出名；底层inputs字节存在。work/output挂载不同，整批异常牵连有效产物。HostArtifactDelivery只内置额外追加；图片人工卡仍旧course-v9目标。

**验收：**

两个入口均能对授权CSV输入执行同作业，输入版本被冻结；有效CSV成果不因另一个坏辅助文件整份不可用。
独立成果交付有真实written回执与文件可读，Stop/unknown不能再次执行收费/计算副作用；相同run归属不跨其他会话。
现backend未就绪时明确not-configured/环境诊断，不能以mock通过称用户实机计算已可用。

**检查建议（T核当前V10与匹配后选1–3条）：**

command: npx --no-install vitest run tests/integration/g20ComputeToolChain.test.ts tests/integration/g20ComputeJobRecovery.test.ts
property: 现fake backend可验证数据桥/unknown晚结果；新增有效+坏辅助文件组合，不能把fake称实机后端
command: npx --no-install vitest run tests/integration/g20HostArtifactDelivery.test.ts -t "atomically creates verified bytes|keeps an unknown result queryable|never overwrites"
property: 共享接入实际File owner交付/unknown/冲突；不因原文件另含80MiB用例跑全file
command: 未来仅现成计算环境做一次授权CSV→数值/CSV文件focused journey；artifact图像用ready fixture
property: 不安装/下载新环境、不启动新媒体route；已授权GPT OAuth未来必要focused验证仍允许，不把mock当供应商成功

**条件/候选：**

WSL/Podman/固定本地Python镜像本轮未探测；不安装/下载新环境。
联网搜索、音频/视频/音乐未配置，只披露现可用性；图像GPT OAuth已授权不等于当次连接成功。
图片卡UI唯一writer为teacher；CAP-IMAGE-HUMAN-CARD只在owner接口说明，不在本服务写域。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="s07"></a>

### S07 共同资料读取、教师选集与公开教材文件接续

**结果：**

教师采用的具体资料/片段随同内容需求交给AI，内外同受授权资料owner读取正文、图示和出处；公开教材PDF/已支持Office响应自动交给现提取器；读取更多参考不扩作品改写范围。

**写入owner：**

S07

**模型：**

gpt-6.1-sol

**强度：**

high

**开工接口ready：**

K01-min
TE06-port

**最终汇合（不是开工依赖）：**

TE06

**当前依据：**

CAP-MATERIAL-EXTRACTION-PARITY
CAP-MATERIAL-SELECTION-CREATION
CAP-MATERIAL-OWNERSHIP
CAP-MATERIAL-FORMAT-VISION
CAP-WEB-FILE-HANDOFF
CAP-SKILL-DISCOVERY

**写域：**

src/main/workbench/execution/MaterialReadTools.ts
src/main/workbench/attachments/AttachmentService.ts
src/main/workbench/network/WebResearchService.ts
src/core/execution/PayloadCompiler.ts

**接线需求：**

I接公共material parser/support/handler及外部source resolver，不公开整个聊天附件存储；Engine frozen sources与ToolCatalog Skill模式小hunk归I。leaf将材料选集作为既有提交来源输入，不做第二任务Context store。 资料选集UI若teacher已有锁，仅交sources接口/hunk；本包独占MaterialReadTools与WebResearchService相关服务域，不形成第二UI writer。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

复用提取算法及provenance表达，显式授权的课例文件或本次附件成为source；软件解析片段/source关系并交内容请求，模型不抄附件内部ID。
教师勾选used fragments提交冻结后保范围/出处；切作品或再次选择不让旧选集误用。文档输入目标与参考来源分开。
共享web服务拿到已授权公开URL的受支持bytes后交现材料owner保存不可变原件/提取快照，给来源URL/页段位置；取消释放处理中输入，不执行下载文件。
PDF/PPTX真实页号，DOCX全文/段落不伪造排版页码；局部复杂对象提取缺口保正文与原件，不整份拒绝。图示理解依已冻结视觉角色，准备好图片不称理解通过。
Skill仅决定方法/相关能力展示，不因读取方法撤掉已授权其他文本的read/save；不复制外部client对话/笔记/历史控制。

**权威执行限定：**

材料/选集/公开教材文件共同服务；TE06 UI选集，不复制附件库/聊天/未授文件。

**保留行为：**

真实隔离PDF/DOCX/PPTX提取和内置MaterialReadTools存在；外部缺该复合入口。LessonWorkspaceHost资料勾选只本地显示未到助手提交。web.open文件响应只needs-material-reader，未接下载/提取。读Skill会撤部分同run普通能力。

**验收：**

采用1个资料片段后发出的内容请求能实际read该片段及出处，未选材料不自动展开；多读参考不增加writable target。
外部shared material与内置对同授权原件取得相同格式locators/coverage；不能只返回路径算读取。
公开PDF响应能够获取可读正文/页图与源URL，遇局部缺口仍保可用内容；不碰登录私网/新格式。

**检查建议（T核当前V10与匹配后选1–3条）：**

command: npx --no-install vitest run tests/unit/lessonMaterialSelection.test.tsx tests/integration/g20MaterialFind.test.ts
property: 现选择/locators；新增提交payload实际包含selected source而非仅checkbox状态
command: 新增focused共享资料dispatch和local HTTP PDF→现isolated extractor接续用例，依托tests/integration/g20AttachmentExtraction.test.ts / g20AttachmentExecution.test.ts
property: 实际原件/来源/提取consumer；先核查对应文件是否启动Electron，按必要carrier准备一次
command: 未来资料侧栏→选片段→提交→可追溯内容请求做1次真实UI检查
property: 人类采用选择真正进入创作；不顺便做模型理解/全课创作矩阵

**条件/候选：**

原件授权与聊天附件存储不同；不能用外部可读工作空间推所有历史附件可读。
XLSX结构读取归Office inspect；不新建全格式/视觉供应商。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="s08"></a>

### S08 当前HTML作品预览动作接到共同服务

**结果：**

人工/内置/外部同一授权HTML作品消费同预览owner检查当前内容与互动，软件选择明确目标/版本/句柄；后台按需现worker可提供预览，需人工显示时复用同host GUI。

**写入owner：**

S08

**模型：**

gpt-6.1-sol

**强度：**

high

**开工接口ready：**

K01-min

**当前依据：**

CAP-HTML-PREVIEW-ACTIONS
CAP-EXTRA-INJECTION

**写域：**

src/main/workbench/htmlPreview/HtmlPreviewService.ts
src/core/tools/HtmlActionTools.ts
src/main/workbench/observation/TaskHtmlPreview.ts
src/main/workbench/observation/HtmlActionService.ts
src/main/workbench/observation/HtmlActionDesktopPort.ts

**接线需求：**

I将现HtmlActionTools/support/handler接同catalog以及Main后台按需preview ports；不复刻一份外部HTML浏览器、另存当前HTML才能验收或篡改工程页面。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

明确当前HTML文档时软件捕获target/epoch/revision并复用live或isolated preview；两个作品目标歧义用现内容选择，不把全量目录交模型猜。
共享五种narrow action parser，模型提供点击/输入意图；内部frame/observation/operation仍软件维护。
源文变更后重新观察当前canonical revision，旧动作失效；Stop/open竞态与未知动作保持不重放。
GUI安装与headless worker装配用同factory；实际无frame时给不可用条件，不能发现目录就声称动作可执行。

**权威执行限定：**

只已证当前HTML文档预览，不假所有正式V10互动已可操作；复用观察worker真实条件。

**保留行为：**

TaskHtmlPreview/HtmlActionService读取canonical当前版本、截图/点击/输入/error并校验identity；GUI IPC阶段只给内置注入，headless未装该actions。唯一HTML target支持，两个HTML目标有歧义；不能泛化全部V10播放控制。

**验收：**

外部检查当前未保存HTML时截图/错误/点击结果对应同canonical revision，原磁盘内容不成为第二真相。
source change/reload/Stop使旧动作失效；unknown后先观察，不再次派发原动作。
不声称现raw HTML动作等于V10全部组件运行/课堂互动自动控制。

**检查建议（T核当前V10与匹配后选1–3条）：**

command: npx --no-install vitest run tests/integration/g20HtmlActionsTools.test.ts tests/integration/g20HtmlActions.test.ts
property: 现intent-only parser、真实DOM/version/unknown/Stop；新增共享外部调用真实service一例
command: 未来GUI或headless真实preview载体仅1个可控HTML：未保存修改→observe→click/input→state/error核对
property: 当前内容的实际互动结果；按需worker与live模式仅测本次变更涉及分支

**条件/候选：**

密码/文件控件保持现不支持；不借预览获取工作台登录权限。
不把真实截图等价于全面视觉/教学质量accepted。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="s09"></a>

### S09 已有输出和PPTX导入producer的共同consumer

**结果：**

内外输出/导入消费现人工同producer、冻结snapshot/授权bytes与File owner；PPTX保原件/可编辑页，格式范围诚实。活性/取消/晚成功依assembly A05同port，本包只接consumer。

**写入owner：**

X

**模型：**

gpt-6.1-sol

**强度：**

high

**开工接口ready：**

K01-min

**最终汇合（不是开工依赖）：**

A05

**当前依据：**

CAP-COURSE-EXPORT-OFFICE
AR06-one-export-capability
C18-export-wait-cancel
AR07-export-extra-actions
AR05-online-offline-meaning
CAP-PPTX-IMPORT-AI

**写域：**

src/renderer/app/useCourseDelivery.ts
src/renderer/export/componentPlatform/delivery.ts
src/main/workbench/delivery/DocumentDeliveryService.ts
src/core/tools/DocumentDeliveryTools.ts

**接线需求：**

I顺序接ExportFormat/DocumentDeliveryTools/Gateway/Main/Renderer共享consumer；A05给活性/cancel/晚结果port，teacher给人工导入/输出UI。S09不复制producer、不改A05生命周期实体、不建设新调度平台。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

现format producer从冻结snapshot/资源生成，延伸document.export公开格式并保原约束；PDF读现print owner、PPTX保实际编辑语义、DOCX只Flow。多Flow文件由软件命名/目标处理，不让模型序列化。
PPTX公共入口复用createCourseFromPptx→CourseV10Driver/archive→create/open；软件分配身份/资源/目标，保源/可解析页及诊断，不把材料读取或空白H5称导入。
deadline/活性/cancel/late-result全部交assembly A05，本包接signal/progress/结果窄port，不改port/worker，不另派deadline owner。
warning/50MiB/真实格式后果展示交teacher输出UI；共同consumer不复制审批，generated/written/unknown按现owner，物理写unknown查证不重写。
离线输出只承诺已known工程资源包装；原创网络逻辑保留并说明依赖，不全撤CSP或下新供应商资产。

**权威执行限定：**

X共同格式输出/人工noninfo与50MiB提示；PPTX现导入消费I。A05取消叶独占，不重造算法。

**保留行为：**

人工V10 PDF/PPTX/Flow DOCX已有producer/write；公共document.export只有3网页format。DocumentExportPort累计120秒移pending，GUIbuild无signal，晚成功丢弃；headless worker finally销毁。写盘后unknown保护必要。

**验收：**

document.export三actor调用现producer；Flow DOCX/Slide PPTX/PDF各自范围真实，generated不冒written；明确未支持格式不静态化HTML/工程。
公共PPTX调用真实converter：文字+图片转可编辑V10、保源并save/reopen；已保存ACK失败读原目的地不重导。
A05取消/活性/late/unknown状态传递诚实，相关证据有效不重复测试。

**检查建议（T核当前V10与匹配后选1–3条）：**

command: 新增公共format/import真实producer调用focused case；旧g20M21PptxCourse.test.ts目标如使用须迁到V10
property: 真正converter/format生产结果，不用工具名或旧V9pass
command: 只跑本consumer命中现V10 producer：componentPlatformX2Pptx / componentPlatformDocxSemantics；PPTX文字图片save/reopen fixture
property: 最低成本格式/可编辑行为，未改路径证据不重跑
command: 消费assembly A05取消/活性/晚结果记录，接线变化仅加1条对应结果传播
property: 不重复A05矩阵/不争写deadline owner

**条件/候选：**

没有真实课程>120秒频率证据，不能把counterexample说实测用户卡住率。
当前人工useCourseDelivery独立路径不必然命中DocumentExportPort，不称所有导出都被时限卡。
本包只已有PPTX，不新增PPT/PDF/通用Office全保真转换。
素材未知能力/复杂对象给具体诊断，不能静默整页截图代替可编辑转换。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="s10"></a>

### S10 正式History、资产与Slide状态的公共入口需求

**结果：**

教师明确撤回/重做/多选提炼/管理库/逐步呈现时，内外同owner能力消费；软件捕获历史头、selection与状态关系，AI只交内容意图。服务包只接公共入口。

**写入owner：**

I

**模型：**

gpt-6-astra

**强度：**

xhigh

**开工接口ready：**

K01-min
TE09-port
TE10-port

**最终汇合（不是开工依赖）：**

TE09
TE10
K07

**当前依据：**

CAP-HISTORY-AI-COMMAND
CAP-ASSET-SHARED-SCOPE
CAP-ASSET-MANAGEMENT-AI
CAP-PRESENTATION-STATES-AI
CAP-NAVIGATION-SHARED

**写域：**

src/core/tools/ToolRegistration.ts
src/core/tools/ToolCatalog.ts
src/core/tools/ToolTargets.ts
src/core/tools/DocumentToolGateway.ts
src/core/tools/HostToolServices.ts
src/core/drivers/CourseV10Driver.ts
src/core/drivers/courseV10Operations.ts
src/core/documents/DocumentSession.ts
src/core/documents/DocumentRegistry.ts
src/main/workbench/DocumentHostService.ts
src/main/workbench/workbenchToolServices.ts
src/main/workbench/execution/AgentFileService.ts
src/main/workbench/FileArtifactService.ts
src/main/ipc.ts
src/preload/index.ts
src/preload/desktop-api.d.ts
package.json
package-lock.json
vitest.config.ts
playwright.config.ts
electron-builder.yml
src/main/workbench/documentJournal.ts
src/shared/workbench/toolPorts.ts
src/core/contentApply/planning/types.ts
src/shared/workbench/execution.ts
src/main/workbench/JournalBindingIndex.ts
src/core/tools/ProjectFileTools.ts
src/core/tools/HtmlImportTools.ts
src/shared/contracts/component-platform/schema.ts
src/shared/contracts/component-platform/published.ts
src/shared/contracts/component-platform/runtime.ts
src/core/drivers/resources.ts

**接线需求：**

没有独立leaf写域；I唯一公共接口/目录consumer writer。teacher负责多选asset/状态实体，assembly负责History资源成本；真实port接线后完成，不把要求当已实现。

**接线解释：**

草稿中I泛称共享接线，不授权该角色写别的owner文件；以本包共享表/精确shared_hunks为准。候选新路径未实现，只有实际需要才选，不强制新增模块。

**复用/实施边界：**

显式History意图用现Session mutation/最近AI头；不让模型指定编号/盲撤后来人工结果，Office/网页不冒充课件History。
资产多选/管理/状态consumer接teacher真实selection/planner/Library窄port；同canonical transaction，软件管理身份，不要求模型登记。
库项和作品嵌入包/instances owner保持区别；库删除不暗删工程内容。
资源clone/Journal成本全归assembly A06/A07，本域不加缓存/第二History/事件溯源，不重复有效成本测试。

**权威执行限定：**

I/K07公入口，TE09/TE10实体、U Bridge、A06/A07成本。不可再派一个实体writer。

**保留行为：**

人工undo/redo/revert最近AI已用同DocumentSession，AI普通修改有History却无显式公共消费；人工API5资产多选/库管理和Slide surface.presentation.set存在，公共AI入口未覆盖全部。实体行为由teacher唯一owner补，资源History成本交assembly A06/A07。

**验收：**

AI显式undo/redo与人工同History，当前头/后来人工反例正确，save/reopen当前内容。
teacher已交付多选/状态能力通过公共真实port可达，actor不缩水；作者状态与临时run view分开。
资源History成本/恢复事实引用A06/A07有效证据，接口相关实现未变不重跑。

**检查建议（T核当前V10与匹配后选1–3条）：**

command: 独立T给componentPlatformSession.test.ts加1条History公共consumer→真实Session+later-human反例
property: 显式AI消费与同History，不因接线重跑不变Journal
command: 消费teacher资产多选/状态focused证据，必要1条public handler→real port；旧g20AssetLibraryTools/PresentationStateTools V9不报V10通过
property: 不复制实体测试/writer
command: 消费assembly A06/A07有效记录，不在本域重测资源增长/重写Journal
property: 消除重复写域/同义验证

**条件/候选：**

不新建管理/登记平台；当前目标/Stop/最终CAS/资源闭包保留。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="opt01"></a>

### OPT01 终态释放、完整日志、辅助元数据与可行动错误

**结果：**

复用终态释放/来源/日志分页，保必要可恢复信息；静默截断与不准确错误不迫模型猜或重复写。

**写入owner：**

G

**模型：**

gpt-6.1-sol

**强度：**

high

**最终汇合（不是开工依赖）：**

K05
K07
S06

**当前依据：**

O06
O07
O08
O13
O17
O19

**写域：**

src/main/workbench/execution/ExecutionEngine.ts
src/main/workbench/execution/ExecutionDesktopService.ts
src/main/workbench/execution/ExecutionContextProjection.ts
src/main/workbench/execution/executionOutcome.ts
src/main/workbench/execution/executionToolFacts.ts
src/core/tools/modelToolResult.ts
src/core/tools/TaskNoteTools.ts

**交唯一owner的小hunk：**

path: src/core/tools/DocumentToolGateway.ts
writer: I
path: src/main/workbench/external/ExternalMcpService.ts
writer: H

**复用/实施边界：**

不得加idle TTL/全局恢复或诊断平台，真实协议/业务意图不全抹。pure日志归S06独立叶。

**权威执行限定：**

各真实文件只归I/G/H原owner；OPT01不是另一writer。

**保留行为：**

正式回执、实际文件节点定位、原必要消息与真实异常事实。

**验收：**

确定失败一次指出可继续办法，后段日志可取；释放以实际结构计数，不虚报已量化卡顿。

**检查建议（T核当前V10与匹配后选1–3条）：**

planned: tests/integration/productFollowup/T10/
property: 终态、日志、恢复保已提交动作

**条件/候选：**

页限/重复ref便利规范化先一次证伪，已source截断可以先修。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。

<a id="opt02"></a>

### OPT02 颜色/CSS/活运行与native候选一次定点收口

**结果：**

每个既有疑点确认/反证/条件均有处置；成立分支交现owner修，不假风险造平台。

**写入owner：**

OPT02

**模型：**

gpt-6.1-sol

**强度：**

high

**当前依据：**

O01
O02
O09
O10
O16
O18
O20

**复用/实施边界：**

先active caller，颜色不能等价不默丢alpha；保Web分支不概括全导入损失；native无新假设不反复制造崩溃。 O18分别核当前裸域URL、5.10.discovery的enum/版本/limit/ID及G-F05c Flow width fit-content/auto：只对已有正确carrier语义做一次parse/消费检查，支持且便利无实际副作用才规范化；不支持或反证附当前证据关闭，不造泛化enum/版本转换能力。

**权威执行限定：**

定位可独立；实际源码修交A02/A09/I/G/H，不抢文件。

**保留行为：**

真实格式/运行/权限、原件及原有效证据。

**验收：**

一次最低检查得明确当前结论；反证/零consumer关闭，不写mock/未测为完成。

**检查建议（T核当前V10与匹配后选1–3条）：**

planned: 按实际active疑点选最近层已存在case或一个carrier；无caller不运行。
property: 候选最便宜证伪，不全矩阵

**条件/候选：**

依已有native档案，未配置/缺有效触发保边界，不新OS沙箱。

测试/GUI/模型均未运行。最近层足够即停；真正视觉/保存/交互属性用真实载体，重要owner/算法/持久化迁移独立R审。旧V9/零匹配不得当V10通过。
