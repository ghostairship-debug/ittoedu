# 任务协议与文件防火墙

---

## 1. 任务必须是结果导向

好任务：

> 将 Component Catalog 与工程 Installed Packages 分离，保持现有安装、更新和本地导入能力不变。

坏任务：

> 优化组件架构。

---

## 2. 必填字段

```text
Task ID
Baseline SHA
Goal
User-visible behavior
Non-goals
Canonical data
Read path
Write path
Allowed files
Read-only files
Forbidden files
Invariants
Implementation steps
Minimal validation
Index impact
Rollback
```

---

## 3. 文件防火墙

### Allowed

任务可修改。

### Read-only

允许读取，但修改需要新卡。

### Forbidden

即使发现问题也不修改，只记录。

---

## 4. 热点修改协议

修改以下文件时，任务卡必须列出目标符号和预计删除/移动内容：

- `editorStore.ts`；
- `App.tsx`；
- `Workspace.tsx`；
- `PropertiesTab.tsx`；
- persisted Schema；
- Published producer。

不允许只写“允许修改整个文件”。

---

## 5. 迁移型任务

必须列出：

```text
Old entry
New entry
Temporary adapter
Consumers to migrate
Deletion condition
```

禁止只复制代码而不定义删除条件。

---

## 6. 行为型任务

必须先明确：

- simple/professional/code 哪些模式可见；
- Slide/Flow/Spatial 哪些 Surface 生效；
- edit/run/export 哪些阶段生效；
- Undo/Redo；
- save/reopen；
- fallback。

---

## 7. Schema 任务

若确实需要 additive Schema：

- 独立任务；
- 说明默认值；
- 说明旧工程；
- 说明旧编辑器；
- 更新 contract；
- 更新 fixtures；
- 不与 UI 重构同一提交。

本轮默认不做 Schema 任务。

---

## 8. 发现越界问题

Agent 输出：

```text
Out-of-scope finding
Impact
Suggested new task
Blocking: yes/no
```

不得直接扩大实现。
