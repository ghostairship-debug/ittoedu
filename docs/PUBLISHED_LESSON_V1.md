# Published V3 与输出指南

本路径保留为现有发布检查脚本的文档入口，当前正文描述 Published Course V3；旧 PublishedLesson V1 原文在[归档](archive/README.md#历史原文)。文件名不是协议版本事实。

作者工程使用 Project V10，Published V3 是运行投影，正式 Schema 在 [published.ts](../src/shared/contracts/component-platform/published.ts)。作品中的定义、实例、表面、资源、行为与控制器沿这一合同运行；不把旧 Published V2 包裹当当前输出。

输出从 drain 后的正式快照和同一 Main compilation owner 构建；GUI 保原 UI 草稿准备，独立后台无 UI 草稿但保正式 Session drain。实际实现见[纯构建叶子](../src/renderer/workbench/delivery/buildDocumentExport.ts)、[交付服务](../src/renderer/export/componentPlatform/delivery.ts)和[Published producer](../src/renderer/export/componentPlatform/buildHtml.ts)。

单 HTML 与网页包使用实际 Player，PPTX/PDF/DOCX 消费对应专业数据/捕获投影。报告中的 severity、canExport、surface/instance 目标和文件 ACK 都来自现有服务，不用另一个旧诊断 Schema 重新推定结果。

正式工程提交、可用性、磁盘保存和导出 written 是不同事实。输出成功后检查所要求的实际产物与受影响运行属性；长期凭据不得进入 Published、组件包或导出物。
