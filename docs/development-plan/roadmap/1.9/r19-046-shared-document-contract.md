# r19-046-shared-document-contract：定义统一正文、源文、数学与双保存接口

- Release: 1.9
- Dependencies: `r18-060-release`
- Optional: 否
- Write locks: `contracts-schema`, `export-docx-print`

## 结果与边界

把 [共用正文合同](../../R19_SHARED_DOCUMENT_CONTENT_CONTRACT.md) 与 [课例/文件接口](../../R19_LESSON_DOCUMENT_WORKSPACE_CONTRACT.md)变成唯一纯类型、严格解析、序列化、数学结构/OMML和可执行样例。Owner无兼容需求，不编写旧Flow text/runs、AST或旧会话转换器。

046先建立独立纯模块与合同验证；正式V9/Published根Schema和正在使用的工厂在048可运行切换批次中接入，不能先令主应用失配。此节点不开放新Flow写入口。

## 直接入口与写域

读取 [V9 types](../../../../src/shared/contracts/course-project-v9/types.ts)、[V9 schema](../../../../src/shared/contracts/course-project-v9/schema.ts)、[Published schema](../../../../src/shared/contracts/published-course-v2/schema.ts)、[formulaLinear.ts](../../../../src/shared/formulaLinear.ts)、[flowDocx.ts](../../../../src/renderer/export/course/flowDocx.ts)。新纯正文/数学模块归Shared Domain；不导入Renderer Store或文件系统。

## 执行顺序

1. 定义唯一inlines/LaTeX与全正文承载点；落实文本/数学样式、链接/代码、稳定身份、只读纯文本投影与明确错误。
2. 实现cw-markdown-v1双向codec和strict资源映射，形成完整实际对象fixtures；不将说明占位符或库JSON当产品输入。
3. 形成有限数学语法表、结构化树和OMML映射，先覆盖合同九类样例及n-ary操作数边界，再用实际Word尽早验证修改/保存/重开。
4. 固定工程与文件两类接入口、选区位置和事务结果；锁定经过样例验证的库版本。生成正式能力合同的时机由048根切换统一处理。

## 验收与聚焦验证

新增命名测试文件在实施时创建：sharedDocumentContent、sharedDocumentMarkdown、sharedDocumentMath（可沿项目测试命名规范调整）。语义往返核对正文/格式/ID/资源，非法ID/未知字段/缺资源/不闭合公式拒绝；不以字节相同或字符串存在代替。

数学检查目标OMML结构并在Word操作合同表。Word环境不可用明确留待验，不把其他软件或截图计通过；其可用性不阻塞纯模块开发，046的完整数学转换出口须获得该证据。没有真实模型调用需求。

## 退出与交接

向047提供纯内容/选区/codec，向048提供正式根切换目标与数学/导出模块，向049提供文件保存/诊断端口语义。正式consumer切换仍由048单一Owner组织；未执行的验证不计完成。

2026-09-15 首批实现见[实施记录](../../reviews/2026-09-15-r19-shared-document-contract.md)：Shared Domain 合同、codec、结构数学/OMML、双归属端口与 67 项聚焦检查通过；桌面 Word 实际修改、保存、重开及逐页呈现已有证据。当前是独立模块 engineering candidate，正式根模型与真实编辑 consumer 尚未切换。
