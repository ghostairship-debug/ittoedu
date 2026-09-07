# r18-089-flow-viewport-repair：修复Flow初始投影与教师控制器在真实窗口中的可达性

- Release: 1.8
- Dependencies: `r18-077-playback-view-controls`, `r18-087-navigation-level-exit`
- Optional: 否
- Write locks: `authoring-flow`, `published-flow`, `workspace-shell`
- Gaps: G11

## 结果与现状

在1280×720及第二个真实窗口中，Flow编辑、当前位置试运行、整课预览与离线HTML的正文/浮层投影一致，教师控制器及观察缩放入口始终可达。

G11真实记录仍发现控制器投影到宿主视口之外；既有D1方案A已获批准，不能重新改回固定16:9缩放或把编辑缩放当播放缩放。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/shared/flowViewportGeometry.ts](../../../../src/shared/flowViewportGeometry.ts)
- [src/shared/teacherControllerLayout.ts](../../../../src/shared/teacherControllerLayout.ts)
- [src/renderer/ui/FlowWorkspace.tsx](../../../../src/renderer/ui/FlowWorkspace.tsx)
- [src/renderer/ui/TeacherControllerAuthoringChrome.tsx](../../../../src/renderer/ui/TeacherControllerAuthoringChrome.tsx)
- [src/player/teacherControllerDom.ts](../../../../src/player/teacherControllerDom.ts)
- [docs/development-plan/THREE_SURFACE_ARCHITECTURE_INTEGRATION_PLAN.md](../../THREE_SURFACE_ARCHITECTURE_INTEGRATION_PLAN.md)

## 允许写域与旧路径退出

Flow正式布局/视图Owner、教师控制器定位consumer与对应目标测试；复用现有几何正逆映射。不得添加聊天专属截图布局或第二控制器坐标算法。

## 执行步骤

1. 从已记录窗口/课件重现初始不可达，核对actual viewport、正文scroll、overlay尺度、控制器safe bounds和resize路径。
2. 在正式几何Owner修复初始/resize/模式切换的边界校正，使作者命中、运行投影和控制器消费同一解释。
3. 校验外部放大到200%、横纵平移边条、恢复以及正文滚动；缩放不重挂Runtime/Component，不吞其内部输入。
4. 移除对应旧初始定位分支；验证既有Flow课件、人工编辑、保存重开与HTML。

## 验收与可信反例

- 正文和浮层的选框命中准确；三个应用模式和离线HTML均可操作控制器、缩放按钮与边条。
- 反例：长正文滚到中/尾、窄窗口resize、满屏动态内容、200%后恢复，不出现控制器越界、重复scroll或动态重播。

## 停止条件

若修复需要改变已批准D1语义或V9存储解释，先提交具体课件和差异更新合同；不得暗中改坐标保存规则。未有硬件的手势只能列未验证。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/flowViewportGeometry.test.ts tests/unit/teacherControllerAuthoringBounds.test.ts tests/unit/teacherControllerConsistency.test.ts
npm run test:e2e -- tests/e2e/stabilizationFlowAuthoring.spec.ts tests/e2e/stabilizationOwnershipController.spec.ts
```

在两个实际窗口逐项观察编辑/试运行/预览/HTML；截图保留模式、窗口、缩放和滚动状态，不能只看DOM坐标或fixture数量。

## 回退与交接

交付复现与修复前后画面、几何约束、旧分支退出、对095可复用的真实宿主观察边界；回退只回退本包几何修复，保留其他人工修改。
