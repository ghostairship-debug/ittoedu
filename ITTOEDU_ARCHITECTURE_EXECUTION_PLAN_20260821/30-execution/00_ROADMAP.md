# 总体执行路线

本路线按依赖和风险排序。不要跳过 P0 直接重写 Store，也不要在 P3 前删除旧写入路径。

---

## P0：基线、Feature 盘点与知识系统 V1

### 目标

- 固定当前事实；
- 建立 Feature Matrix；
- 修复认知索引漂移；
- 生成可查询代码图；
- 让后续 AI 使用 Context Pack。

### 主要工作包

```text
BSL-01
IDX-01～IDX-04
DOC-01
MAP-01
```

### 退出条件

- `repo:index` 可生成；
- `repo:context` 能定位典型任务；
- 所有 semantic 路径存在；
- Feature Matrix 覆盖核心能力；
- 当前产品事实文档不再指向不存在路径。

---

## P1：公共入口与模块边界

### 目标

不改变产品行为，先让新代码有正确入口。

### 主要工作包

```text
BOUND-01
FAC-01～FAC-06
TESTMAP-01
```

### 输出

- Editor Core facade；
- Components、Runtime、Interactions、Media、Diagnostics facade；
- Surface facade；
- import 边界检查；
- 测试映射。

### 退出条件

- 新任务不再直接增加 Store 深层 API；
- Feature 可以从公共入口进入；
- 旧路径暂时 re-export，不中断功能。

---

## P2：低风险解耦

### 目标

先拆不涉及 persisted 数据真相的职责，降低 App/UI 复杂度。

### 主要工作包

```text
APP-01～APP-03
DIAG-01～DIAG-03
COMP-01
UI-01
STYLE-01
```

### 输出

- App lifecycle hooks；
- 诊断按需运行；
- Components UI 子域拆分；
- 模式能力配置；
- Workspace/Properties 路由骨架。

### 退出条件

- App 不再实时计算完整工程检查；
- Component 子域边界明确；
- 模式判断开始集中；
- 仍保持旧 Store 写入链。

---

## P3：Canonical Document、ActiveEditor 与统一历史

### 目标

建立真正唯一的可写 V9 文档。

### 主要工作包

```text
CORE-01～CORE-07
MEDIA-01
```

### 顺序

```text
selectors
→ ActiveEditor
→ transaction facade
→ 新命令接入
→ history/sidecar delta
→ 旧 project 只读
→ 删除旧写入
```

### 退出条件

- 保存、预览、导出读取 canonical document；
- 新旧模式使用同一 document；
- 一次操作一条 history；
-旧投影不可写；
- 三个 nullable session 不再决定文档真相。

---

## P4：模式、组件、Runtime、互动与诊断整合

### 目标

把高级能力保留在统一 Feature API 上。

### 主要工作包

```text
MODE-01～MODE-03
COMP-02～COMP-05
RUN-01～RUN-03
INT-01～INT-03
DIAG-04
```

### 退出条件

- 简单、专业、代码模式共用命令；
- 组件四子域完成；
- Code 模式通过 draft/diff/command 写入；
- 诊断分层完成；
- Catalog 空状态不影响本地/工程组件。

---

## P5：Surface 模块迁移

### 目标

让 Slide、Flow、Spatial 各自形成独立纵向模块。

### 主要工作包

```text
SLIDE-01～SLIDE-04
FLOW-01～FLOW-04
SPATIAL-01～SPATIAL-04
WORKSPACE-01
PROPS-01
```

### 退出条件

- Workspace 只路由；
- Properties 只组合 Feature 编辑器；
- 修改一个 Surface 不需要理解另外两个内部实现；
- 三 Surface 共用 Core transaction/history。

---

## P6：Player、导出、Legacy 清理与最终收口

### 目标

删除过渡实现和历史噪声，完成最终架构。

### 主要工作包

```text
PLAY-01～PLAY-03
EXPORT-01～EXPORT-03
CLEAN-01～CLEAN-05
FINAL-01～FINAL-03
```

### 退出条件

- Player/Export 只读 canonical producer；
- 无可写 V8-shaped project；
- 无重复 history；
- 过时任务和索引已清理；
- 索引 fresh；
- 最终一次完整验证通过；
- 人工核心流程可用。

---

## 阶段验证频率

| 时机 | 验证 |
|---|---|
| P0 开始 | 一次基线完整验证 |
| 每个工作包 | 目标测试 + diff check |
| 每个阶段结束 | typecheck + 相关集成/E2E + desktop smoke |
| P6 最终 | 一次 `npm run verify`，必要时再跑 release 验证 |

不在每个工作包重复完整验证。
