# Editor Core：唯一文档、历史、选择与事务

这是本轮风险最高、收益最大的模块。必须渐进迁移，不做一次性重写。

---

## 1. 目标状态

```ts
interface EditorState {
  document: CourseProjectDocument
  assets: CourseAssetSidecar
  componentFiles: ComponentPackageFileStore

  history: EditorHistory
  activeEditor: ActiveEditor
  ui: EditorUiState

  projectPath: string | null
  dirty: boolean
}
```

### ActiveEditor

```ts
type ActiveEditor =
  | {
      kind: 'slide'
      surfaceId: string
      locationId: string
      sceneId: string
      scope: EditingScope
      selection: SlideSelection
    }
  | {
      kind: 'flow'
      surfaceId: string
      locationId: string
      blockId?: string
      scope: EditingScope
      selection: FlowSelection
    }
  | {
      kind: 'spatial'
      surfaceId: string
      locationId: string
      scope: EditingScope
      selection: SpatialSelection
    }
```

不再依靠三个 nullable session 推断当前编辑器。

---

## 2. Canonical Document

唯一可写对象：

```text
CourseProjectDocument
```

以下内容最终只能是 derived：

- V8-shaped `ProjectDocument`；
- SceneDocument projection；
- effective layers；
- Workspace snapshot；
- Published payload；
- Player input；
- export plan。

任何 derived 对象都不得反向替换 canonical document。

---

## 3. 统一事务

建议保留现有 Immer/Patch 基础，不引入新框架。

```ts
interface EditorTransactionResult {
  document: CourseProjectDocument
  patches: Patch[]
  inversePatches: Patch[]
  assetChanges?: AssetFileHistoryChange[]
  componentChanges?: ComponentPackageHistoryChange[]
  selection?: ActiveEditor['selection']
}
```

Store 提供一个窄入口：

```ts
commitTransaction(label, buildTransaction)
```

它负责：

1. 获取当前 document；
2. 执行纯命令；
3. 校验 target/revision；
4. 同时提交文档和二进制 delta；
5. 写一条 history；
6. 更新 dirty；
7. 保持或更新 selection。

不建立 Command Bus。

---

## 4. History

目标是“一次用户操作一条逻辑历史”。

### 文档

使用 patches/inverse patches。

### 素材与组件字节

使用显式 delta：

```ts
type BinaryChange =
  | { kind: 'add'; key: string; bytes: Uint8Array }
  | { kind: 'remove'; key: string; previous: Uint8Array }
  | { kind: 'replace'; key: string; previous: Uint8Array; next: Uint8Array }
```

不把完整 sidecar 快照重复放入每个 past/future。

### 输入草稿

文本和代码草稿不进入 history，提交时形成一条记录。

### 拖拽

pointer move 期间只更新临时 frame，pointer up 提交一次。

---

## 5. Selection

Selection 必须携带稳定身份：

- surfaceId；
- locationId；
- layerItemId/blockId；
- scope；
- stateId（需要时）。

不使用：

- 数组下标；
- DOM ID；
- Phaser 临时 hit ID；
- 当前视觉顺序作为唯一身份。

---

## 6. Selector

建议分层：

```text
canonical selectors
→ surface selectors
→ feature selectors
→ UI composition
```

Selector：

- 纯；
- 无副作用；
- 不创建新的 session；
- 对同一输入尽量稳定引用；
- 不缓存可写对象；
- 不依赖 App。

---

## 7. 迁移步骤

### CORE-01：建立 canonical selectors

在不改 Store 形状的情况下，统一提供：

- `selectCourseDocument`；
- `selectCourseAssets`；
- `selectActiveEditorIdentity`；
- `selectCurrentSurface`；
- `selectCurrentLocation`。

所有新代码只用这些入口。

### CORE-02：建立 ActiveEditor union

先与旧 session 并存，由旧状态映射生成；逐个 Surface 改成以 union 为导航真相。

### CORE-03：统一 transaction facade

将现有 Slide/Flow/Spatial command 包装到同一提交入口，但命令实现保持各自独立。

### CORE-04：统一 history

先迁移新功能，再迁移既有命令。期间旧 history 只能由兼容层调用。

### CORE-05：sidecar delta

替换 Slide candidate sidecar past/future 等完整快照。

### CORE-06：移除可写旧 Project

旧 `project` 先改成 selector 输出，再迁移消费者，最后从 Store 删除。

### CORE-07：移除冗余 sessions

当 Surface 已直接基于 document + ActiveEditor 工作时删除对应 session 真相。

---

## 8. 完成标准

- Store 中只有一个可写 `CourseProjectDocument`；
- 三种模式读写相同文档；
- 三种 Surface 使用统一事务提交；
- Undo/Redo 跨 Surface 行为一致；
- 保存直接读取 canonical document；
- Player/Export 不读取旧 project；
- 无 derived projection 写回；
- 旧 session 只剩局部草稿或已删除。
