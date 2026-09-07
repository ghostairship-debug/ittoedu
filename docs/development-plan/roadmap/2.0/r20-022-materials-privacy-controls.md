# r20-022-materials-privacy-controls：统一材料引用应用记录删除与Save As数据控制

- Release: 2.0
- Dependencies: `r20-011-first-use-risk-notice`, `r15-020-material-tools-citations`, `r19-040-session-persistence-deletion`
- Optional: 否
- Write locks: `main-preload`, `workspace-shell`

## 结果与现状

教师可逐项管理材料/页面引用、查看当前发送范围、删除应用记录并理解Save As与外部CLI历史差异。

1.5材料与1.9本地删除已有Owner；本节点把它们统一为产品控制，不新增一套材料库或删除服务。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/materialRepository.ts](../../../../src/main/materialRepository.ts)
- [src/main/materialService.ts](../../../../src/main/materialService.ts)
- [src/main/localAgent/repository.ts](../../../../src/main/localAgent/repository.ts)
- [src/main/workspaceIdentity.ts](../../../../src/main/workspaceIdentity.ts)
- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)
- [src/shared/materialContract.ts](../../../../src/shared/materialContract.ts)

## 允许写域与旧路径退出

Main/preload现有材料/会话窄服务与Workspace控制投影；正式课程可见引用继续按工程合同保存，临时缓存/trace不进工程。

## 执行步骤

1. 引用列表逐项显示本次选中材料/页/整课和来源，取消后下一请求确实不发送；未选原文不自动加入。
2. 将040三种删除与Save As身份隔离接入统一UI，显示实际删除范围/结果；当前任务删除遵循先失效再清理。
3. 提供三CLI历史处理官方说明，明确应用只能删除自己记录；支持查看本地记录占用和选择性清理。
4. 核验工程/Published/导出不含AI消息、trace、原生session映射、缓存或凭据，课程有意引用保留。

## 验收与可信反例

- 取消引用与实际输入一致，删除可复查且不误删课程内容，Save As新会话；导出数据边界成立。
- 反例：跨工程同名材料、已删引用、发送中变更引用、删除中运行、历史链接不可用，不能误承诺已删除外部历史或重复发送旧材料。

## 停止条件

无法确认外部CLI删除时只说明操作/能力，不代称成功；不得按材料类别禁止正常使用。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts tests/unit/coursewareAuthoringRunner.test.ts tests/unit/coursePackageExport.test.ts
```

真实设置取消一项材料并核对原生输入，执行范围删除/Save As与打开导出产物；使用可丢弃测试记录。

## 回退与交接

交付引用/删除界面与输入对账证据，供025/030/S4；不复制材料私有状态到AI合同。
