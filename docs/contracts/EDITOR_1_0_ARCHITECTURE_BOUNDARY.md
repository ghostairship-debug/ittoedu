# Editor 1.0 架构与系统边界规范

> 本文档阐明当前编辑器、播放器、图层系统、AI 接口及验收标准之间的架构分工与系统边界。
> 权威实现以源码实现为准。

---

## 1. 运行时与渲染器分工

```text
Course Project V9 (唯一工程真相)
      │
      ├── 编辑态 (Edit Mode)
      │     ├── Slide 画布: Phaser 负责几何与编辑命中测试
      │     ├── Flow 画布: Flow 专属编辑容器
      │     └── Spatial 画布: Spatial 专属编辑与坐标变换容器
      │
      └── 试运行 / 整课预览 (Run Mode / Full Preview)
            └── CoursePlayer + Published V2 宿主体系
                  ├── Slide: SlidePublishedAdapter
                  ├── Flow: FlowSurfaceHost
                  └── Spatial: SpatialSurfaceHost
```

### 1.1 试运行与预览宿主
- **主路径**：V9 课件的「当前位置试运行」和「整课预览」统一由 `CoursePlayer` 配合 Published Course V2 宿主体系承载（包含 `SlidePublishedAdapter`、`FlowSurfaceHost`、`SpatialSurfaceHost`）。
- **禁止回退**：禁止将 Phaser `PlayerApp` 接回 Mixed、Flow 或 Spatial 的试运行链路。

### 1.2 Phaser 的边界职责
- Phaser 仅服务于 Slide 表面在**编辑态**下的元素命中检测（Hit-testing）、几何包围盒计算与画布交互。
- Phaser 不作为 Mixed/Flow/Spatial 播放和试运行引擎。

### 1.3 统一 16:9 舞台孔
- 编辑状态、当前位置试运行与整课预览共用同一块 **1280×720（16:9）** 逻辑舞台，以 letterbox 落入当前可用区域。
- 整课预览使用全屏 16:9 覆盖层，不使用更矮的对话框作为“摄像机”。
- Spatial 世界镜头仍在该孔内平移/缩放；HUD / 教师控制器使用与播放相同的 1280×720 视口坐标。
- Flow 讲义可以高于 720 并滚动；浮层与控制器钉在同一块 1280×720 投影框上。

---

## 2. 统一图层与元素模型

所有 Native、Runtime、Component 以及教师控制器均纳入统一图层体系：

### 2.1 元素集成
- **Native 元素**：文本（`text`）、公式（`formula`）、图片（`image`）、视频（`video`）、图形（`shape`）和教师控制器（`teacher-controller`）。
- **Component 元素**：符合 Component API 4 规范，在 Slide、Flow、Spatial 三种表面及运行时中统一挂载；缺失包时采用静态后备资源（`staticFallbackAssetId`）。
- **Runtime 元素**：符合 Runtime API 2/3 规范。

### 2.2 命中与稳定标识
- **画布命中**：画布文字必须可命中，普通可替换图片应可命中。
- **持久化地址**：图层元素的 `layerItemId`（authoringAddress）是跨保存/重开保持稳定的唯一标识；临时的运行时 `hitId` 不得替代 `layerItemId`。

### 2.3 教师控制器交互边界
- **存储归属**：教师控制器作为唯一一份全局图层元素保存在 `globalLayerItems` 中，禁止在各场景复制副本。
- **编辑态表现**：保持 inert（仅作位置展示与属性配置，不触发业务动作）。
- **运行态交互**：支持拖拽与点击交互；交互仅更新当前会话状态（offset / 折叠状态），除非教师主动触发保存，否则不写回工程持久化 frame。

---

## 3. AI 边界规范

- **编辑器内无可见 AI**：当前编辑器界面内不存在可见的 AI 聊天窗口、提示词输入框、模型选择器、Provider 配置或运行时网络大模型调用。
- **预留接口**：`courseAiHandoff` 与 `courseAiPatch` 属于内部预留接口（internal/reserved），当前未在编辑器 UI 挂载，不得宣称为可用功能。
- **AI 创作路由**：AI 辅助创作在编辑器外部通过标准工具流进行（`orchestrate-courseware` 先确认教学策划再写带表面的呈现脚本，`build-courseware-project` 盘点资产后构建 V9 工程）。

---

## 4. 交付与验收判定标准

- **自动化测试**：自动化测试通过最多证明为 `engineering candidate`（工程候选）。
- **视觉与互动复核**：必须在真实课例中完成跨表面试运行、视频播放、控制器拖拽与图层行为复核，方可视为 `art candidate`。
- **最终验收（`accepted`）**：必须来自教师真实试用与明确验收确认。
- **发布状态**：Course Project V9 Schema 已软冻结。未获教师 `accepted` 前，不得宣称 Editor 1.0 已正式发布。
