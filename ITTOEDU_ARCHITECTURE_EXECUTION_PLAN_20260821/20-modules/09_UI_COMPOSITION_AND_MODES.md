# UI 组合、属性面板与模式整合

---

## 1. 目标

把 UI 从“在几个巨型组件中按节点类型和模式穷举”改为：

```text
App Shell
→ 当前 Surface UI
→ 当前 Feature UI
→ 当前模式决定展示层级
```

业务逻辑仍由 Feature commands/selectors 提供。

---

## 2. Workspace

目标只负责路由：

```tsx
<SurfaceEditor activeEditor={activeEditor} />
```

每个 Surface 自己组合：

- authoring canvas；
- overlay；
- text/code draft；
- Surface toolbar；
- current selection rendering。

---

## 3. Properties

`PropertiesTab.tsx` 目标变成注册式路由，但不建立复杂插件系统。

简单映射即可：

```ts
resolvePropertyEditor({
  surfaceKind,
  selectionKind,
  editorMode,
})
```

Feature 提供对应 UI：

- text；
- image；
- video；
- component；
- runtime；
- controller；
- Flow block；
- Spatial camera/path/relation。

公共样式字段可以复用小型 section 组件。

---

## 4. Sidebar

不要分别维护简单和专业两份业务 Tab。

定义 Tab 元数据：

```ts
{
  id,
  label,
  modes,
  render
}
```

Code 模式可以切换为独立 workspace，而不是在狭窄 Sidebar 内塞所有代码编辑器。

---

## 5. 代码模式布局

推荐：

```text
左：课程树/对象树
中：代码编辑草稿
右：Schema、Diff、诊断、应用按钮
底：预览或结果
```

第一阶段不需要引入 Monaco。可继续使用 textarea/轻量编辑器，先统一数据链。

---

## 6. 高频与高级属性

同一 Feature 提供字段定义或组件组合：

```text
common
advanced
code-only
```

简单模式显示 common；专业模式显示 common + advanced；代码模式显示结构化数据。

不为每种模式复制表单 state。

---

## 7. CSS

随着 Feature 迁移：

```text
styles/
├── tokens.css
├── shell.css
├── shared-controls.css
└── features/
```

不要求一次拆完 `globals.css`。仅在移动 UI 时同步移动对应样式，最后删除孤儿规则。

---

## 8. 完成标准

- 模式判断集中；
- Workspace 不包含所有 Surface 逻辑；
- Properties 不直接调用大量 Store action；
- Feature UI 与 Feature command 同目录；
- Code 模式不绕过命令；
- 新增编辑能力主要修改一个 Feature，而非多个上帝组件。
