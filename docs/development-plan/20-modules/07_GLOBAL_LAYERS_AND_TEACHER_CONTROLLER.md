# 全局层、Surface 共享层、有效图层与教师控制器

## 1. 必须保留的 V9 能力

- `globalLayerItems`；
- `surfaceLayerItems`；
- scene/world layer items；
- location visibility；
- ownership-aware order；
- lock/hide/copy/delete；
- 教师控制器全局单份。

不启动 V10 统一图层迁移。

## 2. Storage Owner 与视觉顺序

数组是存储 scope，不是互不相干的视觉平面。有效图层组合必须保留：

```text
global + surface + scene/world
→ visibility filter
→ ownership-aware order
→ authoring rows / canvas / player
```

不能通过搬目录或扁平数组丢失 owner。

## 3. Authoring Scope

继续使用 `CourseAuthoringScopeToken`：

```text
owner: global | surface | scene | world
ownerKey
locationId
surfaceId
sceneId/stateId
```

选择全局控制器时保持当前 location，只切 owner。

## 4. 教师控制器

- Canonical：global NativeLayerItem；
- 编辑态 inert 或作者 Chrome；
- 运行态可拖、可点，只改会话状态；
- 不为每个 Surface 复制 persisted controller；
- Player 中的位置/手势优先级继续受保护；
- Export 有明确静态处理或说明。

## 5. UI 可发现性

全局层入口不得因简洁/专业模式切换而完全消失。高级配置可以折叠，但 owner 行、选择和基本操作必须可发现。

教师控制器的简洁模板入口属于目标能力，不影响当前专业入口的保留。

## 6. Owner

- Global Layers Feature：组合、owner、visibility、order 和通用操作；
- Teacher Controller Feature：控制器专属 props、authoring chrome、运行行为；
- Surface：本地 scene/world items；
- Core：只处理 target/history，不理解控制器细节。

## 7. 验收

- Mixed 跨页显示正确；
- 全局 row 与画布/属性选中同一稳定地址；
- lock/hide/order/undo/save/reopen；
- Flow/Spatial 不把控制器当普通正文或世界复制；
- 运行时拖拽不写回工程；
- 简洁模式仍能发现全局层。
