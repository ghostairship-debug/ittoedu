# 当前仓库事实与方案基线

> 核对基线：ghostairship-debug/ittoedu `main` @ `690411d4a101b4020134712108262bddf08e0d2e`

本文件记录方案设计所依赖的当前事实。它不是永久架构文档；结构变化后应由索引工具和阶段交接同步更新。

---

## 1. 当前产品架构事实

当前正式约定已经明确：

```text
Course Project V9 = 唯一持久化工程协议
编辑态：
  Slide → Phaser 作者画布
  Flow → Flow 编辑容器
  Spatial → Spatial 编辑容器
运行态：
  CoursePlayer + Published Course V2
```

V9 Schema 当前为软冻结状态。本轮架构治理默认不创建 V10，也不改变已存在字段语义。

---

## 2. 当前高耦合热点

基线树中主要热点文件：

| 文件 | 约大小 | 当前职责问题 |
|---|---:|---|
| `src/renderer/store/editorStore.ts` | 352 KB | V8-shaped project、V9 文档、三种 session、history、素材、组件、命令和 UI 状态混合 |
| `src/renderer/ui/Workspace.tsx` | 145 KB | Surface 判断、编辑画布、试运行、命中、预览和多种 UI 接线混合 |
| `src/renderer/ui/PropertiesTab.tsx` | 128 KB | 多节点类型、多 Surface、多模式属性编辑混合 |
| `src/renderer/styles/globals.css` | 109 KB | 全产品样式集中 |
| `src/renderer/ui/InteractionEditor.tsx` | 85 KB | 互动规则 UI 与多种行为编辑混合 |
| `src/renderer/App.tsx` | 73 KB | 应用壳、保存恢复、素材导入、预览、导出、目录和诊断混合 |
| `src/renderer/ui/FlowWorkspace.tsx` | 65 KB | Flow 页面、浮层、文本编辑和布局行为混合 |
| `tests/e2e/editor.spec.ts` | 144 KB | 大多数核心 E2E 集中 |

文件大小不是唯一问题，但它反映了职责边界与 AI 认知入口过度集中。

---

## 3. 当前 Store 中存在的多套状态

基线代码中同时存在或投影出：

- `project: ProjectDocument`；
- Course Project V9 文档；
- `slideCandidateUi` 等 V8-shaped 投影；
- Slide backend/session；
- Flow session；
- Spatial session；
- Course authoring session；
- Slide sidecar past/future；
- Component package past/future；
- 原 Project history 与各 Surface history。

这意味着“一次编辑”可能需要同步多个对象。目标是逐步收口为：

```text
一个 CourseProjectDocument
一个 sidecar
一套逻辑 history
一个 ActiveEditor
若干局部草稿
```

---

## 4. 当前能力模式

### 简单模式

当前主要显示：

- 元素；
- 图层；
- 属性；
- 高频工程操作；
- 简化入口。

### 专业模式

当前增加：

- 组件；
- 互动与动画；
- 开发；
- 最近工程；
- 另存为；
- 工程检查。

### 代码能力

代码能力目前主要位于 `DeveloperTab.tsx`，包括：

- Runtime 源码；
- 对象 JSON；
- 规则 JSON；
- Component Manifest；
- Component Runtime。

本轮将其整合为明确的代码模式，但不删除能力。

---

## 5. 当前组件体系

仓库已经具备：

- Component API 4；
- 本地组件包；
- 工程嵌入组件；
- Catalog 扫描与快照；
- 组件实例；
- 组件属性编辑；
- 组件代码编辑；
- Slide/Flow/Spatial 运行态挂载；
- HTML、网页包和静态导出路径。

当前能力索引中 Catalog 状态仍可能为 unavailable，但这只代表现阶段没有可用目录源，不代表组件库路线应删除。

---

## 6. 当前诊断体系

当前“工程检查”混合了：

- Schema 之外的引用完整性；
- 交互与动作有效性；
- 素材、组件与 Runtime 检查；
- 信息释放分析；
- 视觉密度分析；
- 导出可用性提示；
- 定位和诊断报告导出。

同时 `App.tsx` 会跟随项目变化计算健康摘要。目标不是删除能力，而是拆成：

```text
快速结构校验
专业按需分析
导出专属预检
代码模式结构化报告
```

---

## 7. 当前索引问题

`PROJECT_COGNITION_INDEX.md` 已经提出 `repo-index/`、modules、features、tests 等结构化入口，但基线根目录实际没有该目录，且部分列出的源码路径已经失效。

这说明：

- 需求是正确的；
- 手工 Markdown 方案不足；
- 需要自动生成的开发侧代码图；
- 不能继续让产品能力索引承担开发导航职责。

---

## 8. 当前已有可复用基础

以下能力应复用，而不是重新建设：

- TypeScript、Zod、Zustand、Immer；
- Course Project V9 Schema；
- Published Course V2；
- Component/Runtime contracts；
- `generate:ai-capabilities`；
- `generate:contracts`；
- `validate:course-project`；
- Vitest、Playwright；
- `RecoveryWriteCoordinator`；
- 现有纯命令与投影模块；
- 当前 `PROJECT_COGNITION_INDEX` 中仍正确的架构事实。

---

## 9. 基线变化处理

若开始执行时 HEAD 已变化：

1. 不重新全仓库评估；
2. 运行最新索引生成器；
3. 比较热点文件、Schema、模式和 Feature 入口；
4. 只更新受影响文档；
5. 若 persisted Schema 或运行主路径已变，创建 ADR 后再调整执行顺序。
