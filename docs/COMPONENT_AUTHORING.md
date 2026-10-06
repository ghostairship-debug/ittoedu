# 统一组件开发指南（API 5）

当前正式合同是 Project V10 + Component API 5。源类型以 [project](../src/shared/contracts/component-platform/project.ts)、[runtime](../src/shared/contracts/component-platform/runtime.ts)、[operations](../src/shared/contracts/component-platform/operations.ts) 与 [Schema](../src/shared/contracts/component-platform/schema.ts) 为准，旧 V4 包指南仅作[历史材料](archive/README.md#历史原文)。

## 定义、实例与实现

定义包含数据合同、角色与共享实现；实例保存专业数据、样式、frame、childIds 及局部 Source。共享或私有 Source 不抹掉专业身份，普通局部编辑不重排整页。frame、编组、顺序与正式身份由软件维护。

实现消费 ComponentRuntimeContext，经 mount 返回 MountedComponent；update 接最新实例数据，updatePlacement 只处理位置变化，dispose 释放该挂载。具体端口和可选能力见源类型与[现有组件](../src/components/)。运行状态与作者工程分离，正式修改经唯一 DocumentSession/History。

## 程序和权限

局部程序保留源码、资源与生命周期，使用实际提供的 scope、target、events/state、媒体/互动等端口；不访问 Provider Secret、原始 Electron Main、任意 OS 或未开放 API。隔离环境不因导入代码获得工作台文件和登录权限。

Source 与 HTMLProgram 保完整同步 target 读取；静态默认 Web 可由宿主采用引用快照。这是软件传输优化，不是作者必须添加的标记或格式门。Web 片段的 transport 画布与作者自己的内容/背景区分，不能手工改宿主 iframe 或为布局修改整课。

创建与局部应用使用正式工程工具/组件源码入口。软件负责身份、依赖与可编辑登记；采用 Source override 后仍要保实际专业数据与人工 frame。提交 ACK、实际运行、保存冷开和输出分别验证，检查只覆盖本次变化。
