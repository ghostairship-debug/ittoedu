# Slide、Flow、Spatial 的 Carrier、Placement 与共同边界

## 1. 统一什么

- CourseProjectDocument；
- projectId/revision；
- AuthoringTarget；
- Core transaction/history；
- asset/component package lifecycle；
- preview/export producer 输入；
- authoringAddress 与 owner scope。

## 2. 不统一什么

- Slide scene/presentation state；
- Flow 文档流、嵌套 section、wrap 与排版；
- Spatial world/camera/path/relation；
- 各 Surface selection；
- Phaser/DOM/Spatial viewport 生命周期。

## 3. Carrier 矩阵

| 内容 | Slide | Flow 稿纸 | Flow overlay | Spatial | Global/Surface shared |
|---|---|---|---|---|---|
| Native | LayerItem | 对应 FlowBlock | LayerItem | LayerItem | ScopedLayerItem |
| Media | Native LayerItem ref | FlowMediaBlock | Native LayerItem ref | Native LayerItem ref | ScopedLayerItem |
| Component | ComponentLayerItem | FlowComponentBlock | ComponentLayerItem | ComponentLayerItem | ScopedLayerItem |
| Runtime | RuntimeLayerItem/scene runtime | Surface runtime 或明确 block/overlay 方案，不伪造普通 block | RuntimeLayerItem | RuntimeLayerItem/world runtime | ScopedLayerItem |

## 4. Placement command

每个 Surface 拥有 placement：

```ts
placeSlideComponent(...): SlideCommandResult
insertFlowComponentBlock(...): FlowCommandResult
placeFlowOverlayComponent(...): FlowCommandResult
placeSpatialComponent(...): SpatialCommandResult
```

Components 只提供 package/default props/validation；Media 只提供 asset import plan。App/use-case 将它们与 Surface command 和 Core transaction 组合。

## 5. Owner Scope

继续复用：

```text
global
surface
scene
world
```

Flow 普通 block 不进入 generic z-order owner。选择 global row 不改变当前 location；world 使用 surface authoring address 但保留 world ownerKey。

## 6. Stable identity

- Layer：layerItemId；
- Flow：block id；
- location/surface/scene/world：合同 ID；
- authoringAddress：跨保存稳定；
- 禁止 DOM id、数组下标、临时 hitId 作为持久身份。

## 7. Surface seam

公共 Surface 入口最多提供：

- selector；
- command；
- placement；
- selection adapter；
- preview adapter；
- minimal UI entry。

不建立万能 SurfaceEditorService。

## 8. 验收重点

- Flow block 排序与 DOCX/PDF 阅读顺序不因模块化变化；
- Flow wrap 与 paperSpace 保留；
- Spatial 自由逛与路径巡游保留，会话相机不写回；
- Slide Phaser 只负责编辑态，不重新成为 V9 Player；
- Component/Runtime/Media 的 carrier 正确且可保存重开。
