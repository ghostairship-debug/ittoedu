# App Shell、项目生命周期、持久化与 IPC

---

## 1. 当前问题

`App.tsx` 同时处理：

- 项目新建/打开/最近；
- 保存/另存为/恢复；
- 素材批量导入；
- Component Catalog；
- 试运行/整课预览；
- 多种导出；
- 诊断；
- 模态框；
- 全局快捷键。

目标不是增加 Application Service 层，而是把这些职责拆成少量明确函数与 hooks。

---

## 2. 目标结构

```text
renderer/app/
├── App.tsx
├── EditorShell.tsx
├── useProjectLifecycle.ts
├── useRecoveryLifecycle.ts
├── usePreviewLifecycle.ts
├── useExportActions.ts
├── useCatalogActions.ts
└── dialogs/
```

### `App.tsx`

只负责：

- 初始化 hooks；
- 组合顶层布局；
- 传递明确 action；
- 显示顶层错误与 busy 状态。

### `EditorShell.tsx`

负责：

- Toolbar；
- Course Tree；
- Workspace；
- Sidebar；
- 模式；
- 面板布局。

---

## 3. 项目生命周期

```text
new/open
→ parse archive
→ validate V9
→ load document + sidecars
→ replace canonical state once
→ initialize ActiveEditor
```

保存：

```text
read canonical document + sidecars
→ build archive
→ write through desktop API
→ update path/recent/dirty
```

不得从 Workspace、projection 或 Player 反建保存数据。

---

## 4. 恢复

保留现有恢复能力，避免扩展成复杂 WAL 系统。

需要保证：

- 恢复副本来自 canonical document；
- 同一时刻一个恢复写任务；
- 新 revision 取消或覆盖旧任务；
- 恢复文件与正式文件分离；
- 恢复后先作为未保存工程打开；
- 用户显式保存后才覆盖目标。

---

## 5. IPC

Renderer 不直接访问 Node 文件系统。

IPC 按领域分组：

```text
project.open/save/recovery/recent
asset.select
component.catalog
export.write
diagnostics.export
window
```

共享类型放 `src/shared/ipcTypes.ts` 或按领域拆分。

不为每个小函数建立 class；保持纯对象与 typed functions。

---

## 6. Busy 与错误

避免一个全局 `busy` 阻断所有功能。可用少量操作类别：

```ts
type AppOperation =
  | 'open-project'
  | 'save-project'
  | 'import-assets'
  | 'preview'
  | 'export'
  | 'catalog'
```

只禁用会冲突的入口。

错误分类：

- 用户取消：无错误；
- 可读业务错误：中文提示；
- 系统失败：保留日志；
- fatal archive 错误：不替换当前文档。

---

## 7. 迁移顺序

1. 先提取 hooks，不移动底层业务；
2. 每个 hook 只接现有函数；
3. 再将底层数据来源改成 Editor Core；
4. 最后缩减 App imports；
5. App 行为稳定后再移动文件目录。

---

## 8. 完成标准

- App 不直接操作 Surface 内部 session；
- App 不计算复杂诊断；
- App 不包含导出格式实现；
- 打开/保存只读写 canonical document；
- 预览/导出只调用统一 producer；
- IPC 调用集中且类型明确；
- 顶层文件可以快速读懂。
