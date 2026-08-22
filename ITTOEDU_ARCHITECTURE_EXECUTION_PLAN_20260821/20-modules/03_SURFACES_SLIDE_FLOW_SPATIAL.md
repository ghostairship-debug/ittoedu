# Slide、Flow、Spatial Surface 模块

---

## 1. 共同原则

三种 Surface 共享：

- Course Project V9；
- ActiveEditor identity；
- Editor Core transaction；
- history；
- assets；
- Components/Runtime/Interactions Feature；
- Published producer；
- 模式能力配置。

三种 Surface 不共享：

- 内部布局模型；
- 坐标系统；
- 文本编辑方式；
- 摄像机；
- block/scene/world 结构。

---

## 2. Slide

### 保留

- Phaser 编辑态命中和几何；
- Published Adapter 视觉真相；
- Native/Component/Runtime 层；
- scene/state/scope；
- 画布级编辑；
- 全局与 Surface 共享层。

### 目标目录

```text
surfaces/slide/
├── index.ts
├── model/
├── commands/
├── selectors/
├── authoring/
├── phaser/
├── ui/
└── preview/
```

### 迁移重点

- `Workspace.tsx` 中 Slide 逻辑迁入 Surface；
- V8-shaped Scene projection 只读；
- Phaser proxy 不保存；
- Properties 通过 Slide Feature selectors/commands；
- content edit 草稿只在 authoring 模块；
- preview rebuild key 不等于 document revision。

---

## 3. Flow

### 保留

- 流式 block 文档；
- paper/overlay；
- 文本 runs；
- 公式；
- 媒体；
- wrap；
- paperSpace；
- DOCX/PDF；
- Component/Runtime。

### 目标目录

```text
surfaces/flow/
├── index.ts
├── model/
├── commands/
├── selectors/
├── authoring/
├── ui/
├── layout/
└── preview/
```

### 迁移重点

- `FlowWorkspace.tsx` 拆成 block list、overlay layer、text editor、toolbar；
- block command 保持纯；
- overlay 与 paper 坐标明确；
- 不通过 Slide project 投影写回；
- Flow 导出从同一 Flow model 读取；
- 作者态与运行态共享语义，不共享 DOM。

---

## 4. Spatial

### 保留

- world/viewport 坐标；
- camera frame；
- path；
- relation；
- semantic zoom；
-自由逛；
- Native/Component/Runtime；
-运行态手势。

### 目标目录

```text
surfaces/spatial/
├── index.ts
├── model/
├── commands/
├── selectors/
├── authoring/
├── camera/
├── paths/
├── relations/
├── ui/
└── preview/
```

### 迁移重点

- world frame 与 viewport state 分离；
- 相机临时状态不自动写 document；
- 只有明确命令保存 camera frame；
- path/relation/semantic zoom 通过统一 transaction；
- Spatial 不依赖 Slide Phaser proxy；
- Player 只读 Published Spatial input。

---

## 5. Surface 路由

Workspace 目标：

```tsx
switch (activeEditor.kind) {
  case 'slide':
    return <SlideEditor />
  case 'flow':
    return <FlowEditor />
  case 'spatial':
    return <SpatialEditor />
}
```

Workspace 不再知道每个 Surface 的内部命令、selector 和生命周期。

---

## 6. 切换事务

Surface 切换：

1. 检查未提交文本/代码草稿；
2. 提交、取消或阻止；
3. 更新 ActiveEditor；
4. selection 按稳定地址恢复；
5. 新 Surface 读取 canonical document；
6. 不复制文档；
7. 不创建第二个写入真相。

---

## 7. 完成标准

- 三种 Surface 可独立定位入口；
- 修改一个 Surface 不需要读取另外两个实现；
- Workspace 只路由；
- Properties 通过当前 Surface adapter 渲染；
- Surface 切换不改变 document；
- 保存、预览和导出读取同一 V9 数据。
