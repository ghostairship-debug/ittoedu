# 目标架构与目录设计

目标不是追求教科书式分层，而是让每项能力拥有清晰入口，并让 Store、App 和 Workspace 不再承担所有职责。

---

## 1. 总体架构

```text
┌─────────────────────────────────────────────┐
│ App Shell                                   │
│ 菜单、窗口、项目生命周期、模式和布局        │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│ Editor Core                                 │
│ canonical document / assets / history       │
│ active editor / selection / selectors       │
└───────────────┬───────────────┬─────────────┘
                │               │
      ┌─────────▼──────┐  ┌────▼──────────────────┐
      │ Surface Editors│  │ Cross-surface Features │
      │ Slide/Flow/    │  │ Component/Runtime/     │
      │ Spatial        │  │ Interaction/Media/...  │
      └─────────┬──────┘  └────┬──────────────────┘
                │               │
                └───────┬───────┘
                        │
       ┌────────────────▼─────────────────┐
       │ Published Producer / Player      │
       │ Preview / Export                 │
       └──────────────────────────────────┘
```

---

## 2. 推荐目标目录

```text
src/
├── main/
│   ├── index.ts
│   ├── windows/
│   ├── ipc/
│   ├── persistence/
│   └── catalog/
├── preload/
├── shared/
│   ├── contracts/
│   ├── course-project/
│   ├── published-course/
│   ├── component/
│   ├── runtime/
│   ├── interaction/
│   └── common/
├── renderer/
│   ├── app/
│   │   ├── App.tsx
│   │   ├── EditorShell.tsx
│   │   ├── projectLifecycle.ts
│   │   ├── previewLifecycle.ts
│   │   └── exportActions.ts
│   ├── core/
│   │   ├── editorStore.ts
│   │   ├── editorState.ts
│   │   ├── editorHistory.ts
│   │   ├── editorSelectors.ts
│   │   ├── activeEditor.ts
│   │   └── transactions.ts
│   ├── surfaces/
│   │   ├── slide/
│   │   ├── flow/
│   │   └── spatial/
│   ├── features/
│   │   ├── components/
│   │   ├── runtime/
│   │   ├── interactions/
│   │   ├── media/
│   │   ├── global-layers/
│   │   ├── teacher-controller/
│   │   └── diagnostics/
│   ├── project/
│   ├── preview/
│   ├── export/
│   ├── ui/
│   └── styles/
└── player/
```

这是目标，不要求一次完成，也不要求所有现有文件移动。

---

## 3. 依赖方向

### 允许

```text
renderer/app
  → renderer/core
  → renderer/surfaces + renderer/features
  → shared

renderer/surfaces
  → renderer/core 公共类型和事务入口
  → renderer/features 公共入口
  → shared

renderer/features
  → renderer/core 的最小公共事务类型
  → shared

player
  → shared published/contracts
```

### 禁止

```text
shared → renderer
player → renderer/store
feature A → feature B 内部文件
surface → App.tsx
UI → history 内部结构
preview/export → 反向写 Store
```

---

## 4. Feature 公共入口

每个 Feature 推荐：

```text
features/components/
├── index.ts
├── types.ts
├── selectors.ts
├── commands.ts
├── model/
├── ui/
└── tests/
```

`index.ts` 只导出跨模块真正需要的符号。模块内部不得通过公共入口反向引用自己。

不要求所有 Feature 都具有完全相同目录；没有必要的文件可以不建。

---

## 5. Surface 不强行统一

Slide、Flow、Spatial 的内部编辑模型不同。只统一：

- 当前 location；
- 当前 selection 的类型化表示；
- 文档事务入口；
- history 提交方式；
- 预览输入来源；
- 模式能力暴露。

不建立万能 `SurfaceEditorService`。只有出现两个以上真实消费者时才抽象公共接口。

---

## 6. 迁移期兼容层

允许短期存在：

```text
legacy-read-adapters/
```

规则：

- 只读；
- 文件名带 `legacy` 或 `projection`；
- 有删除任务编号；
- 禁止新增消费者；
- 禁止从投影反向生成 V9；
- 每完成一个消费者迁移就缩小其 API。

---

## 7. 目标文件规模

文件大小不是硬门禁，但应作为提示：

- UI 组件通常不超过 500–800 行；
- 纯模型/命令文件通常不超过 800–1200 行；
- 单个 Feature 公共入口应容易在数分钟内读懂；
- 新任务不得继续扩大现有几个上帝文件，除非只是迁移期接线。

不为满足行数而制造无意义碎片。
