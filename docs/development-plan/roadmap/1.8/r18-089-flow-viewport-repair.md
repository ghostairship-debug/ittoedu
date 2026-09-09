# r18-089-flow-viewport-repair：修复Flow初始投影与教师控制器在真实窗口中的可达性

- Release: 1.8
- Dependencies: `r18-077-playback-view-controls`, `r18-087-navigation-level-exit`
- Optional: 否
- Write locks: `authoring-flow`, `published-flow`, `workspace-shell`
- Gaps: G11

## 结果与现状

在1280×720及第二个真实窗口中，Flow编辑、当前位置试运行、整课预览与离线HTML的正文/浮层投影一致，教师控制器及观察缩放入口始终可达。

2026-09-08审查：初始投影/Playback View接线已有实现，但超宽控制器每次render按整面板校正会在左右位置间震荡；默认视口右端缩放/收起被裁剪。本批截图已显示失败，详见[首批审查](../../reviews/1.8-first-batch-review.md)。既有D1方案A已获批准，不重做正文响应式布局，也不能把编辑缩放当播放缩放。

本批的已定位符号、固定原生映射、允许改动、退出点和精确检查见[首批执行包第3节](FIRST_BATCH_EXECUTION.md)。先用已预完成合同与真实样本，不重复探索其已确定边界。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/shared/flowViewportGeometry.ts](../../../../src/shared/flowViewportGeometry.ts)
- [src/shared/teacherControllerLayout.ts](../../../../src/shared/teacherControllerLayout.ts)
- [src/renderer/ui/FlowWorkspace.tsx](../../../../src/renderer/ui/FlowWorkspace.tsx)
- [src/renderer/ui/TeacherControllerAuthoringChrome.tsx](../../../../src/renderer/ui/TeacherControllerAuthoringChrome.tsx)
- [src/player/teacherControllerDom.ts](../../../../src/player/teacherControllerDom.ts)
- [src/player/teacherControllerRuntimeSession.ts](../../../../src/player/teacherControllerRuntimeSession.ts)
- [tests/e2e/r18-089-flow-viewport.spec.ts](../../../../tests/e2e/r18-089-flow-viewport.spec.ts)
- [docs/development-plan/THREE_SURFACE_ARCHITECTURE_INTEGRATION_PLAN.md](../../THREE_SURFACE_ARCHITECTURE_INTEGRATION_PLAN.md)

## 允许写域与旧路径退出

Flow正式布局/视图Owner、教师控制器定位consumer与对应目标测试；复用现有几何正逆映射。不得添加聊天专属截图布局或第二控制器坐标算法。

## 执行步骤

1. 从已记录窗口/课件重现初始不可达，核对actual viewport、正文scroll、overlay尺度、控制器safe bounds和resize路径。
2. 在正式几何Owner修复初始/resize/模式切换的边界校正，使作者命中、运行投影和控制器消费同一解释。
3. 校验外部放大到200%、横纵平移边条、恢复以及正文滚动；缩放不重挂Runtime/Component，不吞其内部输入。
4. 移除对应旧初始定位分支；验证既有Flow课件、人工编辑、保存重开与HTML。

本次修复优先使超宽面板约束幂等：按正式recovery bounds保住真正可操作的恢复入口，不以“整个面板只要部分相交”作为可达性。重复render/状态刷新/resize不继续改变位置；打开、缩放和边界校正只写视图会话，不写工程revision或History。

## 验收与可信反例

- 正文和浮层的选框命中准确；三个应用模式和离线HTML均可操作控制器、缩放按钮与边条。
- 反例：长正文滚到中/尾、窄窗口resize、满屏动态内容、200%后恢复，不出现控制器越界、重复scroll或动态重播。
- 回归固定900宽控制器与约683 CSS px视口，连续校正保持稳定；实际点击缩放/收起并确认结果，核对按钮与所有裁剪祖先的有效可见区域，不能只用面板相交或toBeVisible。长正文fixture必须产生可滚动内容，并断言中/尾scrollTop与画面实际变化。

## 停止条件

若修复需要改变已批准D1语义或V9存储解释，先提交具体课件和差异更新合同；不得暗中改坐标保存规则。未有硬件的手势只能列未验证。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/flowViewportGeometry.test.ts tests/unit/teacherControllerAuthoringBounds.test.ts tests/unit/teacherControllerConsistency.test.ts
npx --no-install playwright test tests/e2e/r18-089-flow-viewport.spec.ts --grep "mixed-global-controller stays reachable at 1280×720 and 1440×900"
```

在两个实际窗口逐项观察编辑/试运行/预览/HTML；截图保留模式、窗口、缩放和滚动状态，不能只看DOM坐标或fixture数量。

## 回退与交接

交付复现与修复前后画面、几何约束、旧分支退出、对095可复用的真实宿主观察边界；回退只回退本包几何修复，保留其他人工修改。
