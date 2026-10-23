# Runtime 独立候选评审

日期：2026-10-24
评审者：`/root/runtime_performance/nav_state_dependency`
结论：本次审查范围内未发现阻断问题。

## 范围与证据边界

本评审只读审查以下候选变更，评审者未实施这两部分软件：

- `src/player/components/runtime/containerScopes.ts`：从正式实例树派生运行时父级索引。
- `src/player/components/ComponentRuntimeWorld.ts`：`setState()` 只在导航守卫引用该状态键时通知导航；以及测量回调中复用父级索引的接线。

Geometry API 的坐标、帧一致性和取消语义，以及 `resourceUrlLease.ts` 的资源身份语义均排除在本评审结论之外，由对应独审负责。资源 lease 已由结构 reviewer 确认存在 R02（共享 Blob URL 影响反向解析逻辑 ID），应以其修复复核为准。未编辑软件，未运行或重跑测试、构建、浏览器和性能测量。只读查看了父级索引和状态过滤相关新增测试的断言，不将实施者已有测试结果表述为本评审独立执行结果。

## 正式树父级索引

未发现阻断。

- `containerScopes.ts:16–29` 的索引顺序与原 `project.ts:277–281` 的 `owningContainer()` 一致：工程根优先，然后全局 underlay、overlay，再按 `Object.values(instances)` 顺序取首个父级。循环终止仍由各祖先遍历的 `visited` 保持。
- 缓存通过 `WeakMap<CourseProjectV10, RuntimeOwnership>` 随工程对象持有，索引值不反向引用工程对象；退役工程可回收。索引是正式树的派生查询，不形成第二份可写作者树。
- 当前实际 producer 支持快照假设：`courseV10Operations.ts:820–849` 总是创建新工程对象，局部操作按路径分离待写实例；`DocumentProjection.ts:148–166` 接受新快照时替换模型；`project.ts:350–372` 的展示状态投影创建新实例表和新工程；`compiledPlayer.ts:238–241` 每次更新从原工程重新解析展示投影。
- 同工程对象的实例表、revision、根数组、全局两层数组引用变化也会重建索引。现有查询读取实例的当前容器与可见性，索引只缓存父子归属；没有把动态可见性或播放状态固定进索引。
- World 测量回调沿 `runtimeInstanceOwner()` 追溯 Flow 祖先，使用同一正式归属关系，未引入另一个祖先查询来源。此项只确认接线和归属复用。

## Runtime 状态与导航通知

未发现阻断。

- `ComponentRuntimeWorld.ts:987–999` 保留状态快照隔离、指定键订阅者逐次通知和 `__runtime.state` 事件，最后按当前工程 `navigationGuards[].conditions[].key` 决定导航通知。未缓存过时的守卫依赖，新增或修改守卫会使用当前工程。
- `ComponentNavigationOwner.ts:389–393` 的导航守卫是该 owner 从运行状态读取导航准入条件的输入。`exists` 与 `compare` 两类条件都通过 `key` 读取，当前筛选均覆盖。
- Fragment 状态由导航写出：`ComponentNavigationOwner.ts:238–245`；Fragment 数量来自已准备的 Runtime HTML，而非任意业务状态。投影直接订阅 Fragment 键，见 `compiledPlayer.ts:133–134`，无需普通状态反向刷新导航。
- 互动准入仍经 `__runtime.state → refreshClickAffordances` 更新，见 `ComponentRuntimeWorld.ts:543–546`；互动规则读取最新状态，见 `componentInteractionRuntime.ts:34–37、56、98–99`。条件显示直接订阅自己的状态键，见 `input/behaviors.ts:36–47`。
- 教师控制台读取 `host.read()` 和 `canExecute()`，并订阅导航，见 `defaultController.ts:100、140、195`；没有遗漏的内置隐式状态键。导航守卫变化仍通知它刷新按钮准入。
- Runtime 准备与能力变化的独立通知保留，见 `ComponentRuntimeWorld.ts:164–168`。重启和视图变化的明确导航通知仍存在，见 `ComponentNavigationOwner.ts:660`、`CourseV10RuntimeView.tsx:335`。

这处筛选移除了“普通测量／动画状态 → 导航全量 changed → 教师控制台重建、Flow TOC 测量、全局控制器 placement 重画”的反馈。该判断来自通用消费者链，不依赖 v08 状态键或作品代码。

## 收口

本次独审范围无阻断，可进入主线集成与既定真实验收。该结论是源码与实际生产链审查，不替代加载、滚动、保存冷开或作品完整性的运行验收。
