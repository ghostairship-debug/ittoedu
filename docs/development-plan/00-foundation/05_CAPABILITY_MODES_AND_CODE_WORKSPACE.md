# 简洁编辑、专业编辑与现有 DeveloperTab

## 1. 当前事实

当前内部类型只有：

```ts
type EditorMode = 'simple' | 'professional'
```

DeveloperTab 位于专业模式。不存在现成第三个全局 `code` 模式。

## 2. 本轮产品边界

本轮只保留两种现有用户模式：

1. **简洁编辑**：高频能力直接可达，已有低频能力按当前界面渐进披露；
2. **专业编辑**：保留完整可视化属性、互动、组件、Runtime、诊断和其中的 DeveloperTab。

DeveloperTab 当前已提供 Runtime、对象 JSON、规则 JSON 以及 Component Manifest/Runtime 编辑。稳定化只保护这些现有能力，并将其提交改接稳定 target/transaction。**新 Code Workspace 入口、结构化 Diff 产品扩展和第三 Toolbar mode 全部移出稳定化必经路线**。如未来真有产品需求，另立产品 Epic 决策，且仍不写入 V9。

## 3. 能力共享规则

现有模式和 DeveloperTab 只决定：

- 入口是否显示；
- 默认展开程度；
- 表单字段数量；
- 视图是表单还是代码；
- 是否显示高级诊断。

它们不得拥有不同的：

- canonical data；
- package lifecycle；
- Surface placement；
- save/preview/export producer；
- undo/redo；
- schema validation。

## 4. 能力暴露矩阵

| 能力 | 简洁编辑 | 专业编辑（含现有 DeveloperTab） |
|---|---|---|---|
| 高频元素/媒体 | 直接 | 直接；DeveloperTab 可查看已有结构 |
| 高级属性 | 保留现有可发现性 | 全量；已有对象 JSON |
| 组件 | 保留现有入口，本轮不扩建 | 完整现有 Catalog/工程包/属性；DeveloperTab 有 Manifest/Runtime |
| 互动 | 保留常用模板 | 完整规则及已有规则 JSON |
| Runtime | 保留现有暴露 | 完整属性与已有 Runtime 源码编辑 |
| 全局层 | 固定可发现，不得因模式隐藏 | 完整操作 |
| 教师控制器 | 保留当前可发现程度，本轮不新增模板入口 | 完整现有作者入口 |
| 诊断 | 操作点错误与导出阻断 | 按需完整面板 |

## 5. 现有 DeveloperTab 的稳定化提交链

```text
编辑局部草稿
→ 解析/Schema/协议校验
→ 调用现有 Surface/Feature action 或 command
→ 加入 stable target guard
→ Core transaction
→ 一条 history
→ 更新同一 canonical document
```

现有 DeveloperTab 已通过 Store actions 写入，不存在“裸 setState 代码旁路”这一既定事实；当前缺口是 actions 尚未统一到稳定 target、transaction 和单一 history。内部实现若需要计算 patch/diff，可作为 transaction 细节，但本轮不新增结构化 Diff 产品界面。

## 6. 模式切换

涉及 contenteditable、IME、代码和复杂表单时：

- composing 中禁止无提示切换；
- dirty 草稿必须提交、取消或明确保留；
- stale draft 不能应用到新 location；
- 模式切换本身不产生工程历史；
- 用户提交草稿才产生一条历史。
