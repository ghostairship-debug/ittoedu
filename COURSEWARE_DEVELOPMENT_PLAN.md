# Course Project V9 统一与 Editor 1.0 收尾方案

> 计划版本：12.10  
> 更新日期：2026-08-19  
> 12.10 变更：流式讲义「先能读、再近 Word，不要解冻 V9」走车道 G，已合入 `main`。G0 修试运行/预览滚动（无合同）；G1 接线流内顺序与 F 遗留作者入口；G2/G3 只做一小包 additive（字体/段级/wrap/paperSpace）。不要重做 F1–F3 或 G0–G3。  
> 12.9 变更：Course Project V9 作者工程 Schema **软冻结**。已有字段、判别器和语义不得改；允许 additive 可选字段。不承诺旧编辑器打开含新键的课（内部分发、持续更新）。不等于 Editor 1.0 已发布。Published V2 / Runtime / Component 本次未冻。
> 12.8 变更：编排改为先确认中等策划再写带表面的呈现脚本；构建先盘资产再拆任务；局部复杂互动走组件（可新建），场景 Runtime 管整页动态。澄清 P8 宿主已合入、空 catalog ≠ 不能挂组件。无限画布运行态同时支持自由逛与镜头巡游（会话相机，交互占用时让路）。  
> 12.7 变更：教师回归缺陷 Q1–Q8 已合入 `main`。不要重做 P1–P8 或 Q1–Q8。  
> 12.6 变更：T6 Windows e2e 27/27 已合入 `main`。自动化仍只是 `engineering candidate`。未获教师 `accepted` 不得宣称 Editor 1.0 已发布。  
> 12.5 变更：T6 全量在 typecheck 停手。本轮补 T1-A / T1-C 与测试对齐后重开 T6。修红只跑红命令/红测文件；已绿步骤不重跑；整轮五条只在红项清完后跑一次。未获教师 `accepted` 不得宣称 Editor 1.0 已发布。  
> 12.4 变更：剩余任务卡（T3/T4/T5/T6/P5-persist/P8）改成逐步算法、允许/禁止文件和停手条件，给高性价比第三方工人执行；父代理只合入与复检。工人协议见 `docs/tasks/editor-1.0/02_WORKER.md`。T1-B 在 T0 `canvas-runtime` 夹具仍写 `legacy-runtime-v2` 前禁止删判别器。P8 在 P1/P3/P4 合入后可领取。  
> 12.3 变更：补充「互动组件在流式讲义与无限画布中不可用」为车道 P8，排在 P1/P3/P4 之后（同文件宿主）。  
> 12.2 变更：把 2026-08-18 定位的教师可见缺陷收进车道 P；合同冻结仍走车道 C（T0–T6）。同一提交不得混改 Schema 判别器和教师手感。  
> 12.1 变更：删除 V8 导入与失效重建任务包；执行拆到 [docs/tasks/editor-1.0/00_INDEX.md](docs/tasks/editor-1.0/00_INDEX.md)。  
> 取代：计划 11.0–12.3。已删除 `docs/tasks/v8-to-v9-rebuild/**`，不得再领取 R0–R8。  
> 当前工程格式：Course Project `schemaVersion: 9`  
> 发布格式：Published Course V2  
> 运行时：Runtime API 2 / Surface Runtime API 3  
> 组件：Component API 4  
> 产品版本号：`package.json` 已是 `1.0.0`；V9 Schema 已软冻结。**未获教师 `accepted` 前，不得宣称 Editor 1.0 已发布。**

本文件是唯一长期总纲。可执行任务卡在 `docs/tasks/editor-1.0/`。若与 README、USER_GUIDE 或能力索引冲突，以源码、Schema 和本文件为准，并在同一变更中修正过时文档。

---

## 1. 当前事实

审计日期：2026-08-18。当前产品就是仓库根目录 / `main`。V9 重建已合入。日常启动、构建和验证都在根目录进行。

已经成立、不要重做：

- 默认工程真相是 `CourseProjectDocument`（`COURSE_PROJECT_SCHEMA_VERSION = 9`）。
- 用户可见入口仍是成熟 `App` 表面。
- Slide / Flow / Spatial 可从空白直接创建；Mixed 从 `locations` / `surfaces` 推导，没有持久化 `projectMode`。
- `globalLayerItems`、`surfaceLayerItems`、逐 location 可见性仍是引擎能力。
- 正式 Skill 只有 `orchestrate-courseware` 与 `build-courseware-project`。V8 Builder 已从仓库树删除。
- 无可见 AI；无 Hash/审批/Evidence 教师流程。
- Vite `chunks larger than 500 kB` 不当缺陷修。
- T0–T6、P1–P8、Q1–Q8 源码已合入 `main`。P8 是三种表面挂载 Component API 4，不是「Flow/Spatial 永远没有组件」。
- Course Project V9 Schema 已于 2026-08-19 **软冻结**（见决策 4 与 [docs/contracts/V9_COMPATIBILITY_POLICY.md](docs/contracts/V9_COMPATIBILITY_POLICY.md)）。

当前剩余（不要把已合入项再列成待领取）：

| 缺口 | 说明 |
|---|---|
| 教师 `accepted` 与真实课例视觉/互动复核 | 自动化最多 `engineering candidate` |
| 外部组件目录 | 快照指向 `../courseware-components`，当前 `unavailable`；工程仍可导入或新建 `.h5component` |
| 无限画布运行态逛世界 | 产品要求自由逛 + 镜头巡游；会话手势在 `SpatialSurfaceHost`，不写回工程相机 |

不要从 `f272756` 再开重建分支。不要把 donor HEAD 当产品主干。

---

## 2. 决策

1. Course Project V9 是唯一作者工程真相。
2. **删除 V8 导入。** Archive 只接受 `schemaVersion === 9`。
3. 空白工程直接构造 V9。
4. **Course Project V9 已软冻结。** 已有字段、判别器和语义不得改；允许 additive 可选字段（须单独合同提交，保持 `.strict()`）。新编辑器必须读所有合法 V9。不承诺旧编辑器打开含新键的课。破坏性变化进 V10。
5. Store / Workspace / Player / UI 重构不得改已有 V9 字段、判别器和语义；需要新持久化数据时只能 additive 或 V10，不得把会话态写进工程。
6. Editor 2.0 的 AI 走独立 Authoring Protocol，不修改 V9；当前 `courseAiHandoff` / `courseAiPatch` 仍是未挂载 reserved 接口。
7. 破坏性工程模型才进 V10。
8. **教师可见播放/编辑缺陷走车道 P，不塞进合同提交。** 控制器仍是一份全局图层，不每表面复制。编辑态 inert，运行态可拖、可点、只改会话。
9. **所有画布默认白色、可改颜色。** Slide 场景已有 `backgroundColor`。Spatial/Flow 使用 T1 已合入的可选 `backgroundColor?`（缺省 `#ffffff`），不新造第四类 surface。
10. 课程结构必须能删除整组（演示 / 流式讲义 / 无限画布），且同类型位置可跨组调整；不得只靠「组内排序」。

目标架构：

```text
教学设计 / 呈现脚本 / 素材
          │
          ▼
V9 Builder / Product Compiler
          │
          ▼
Course Project V9  ─────────────── 唯一作者工程真相
    │          │          │
    │          │          └── Project Health / Preflight
    │          └───────────── Editor Commands / History / Recovery
    └──────────────────────── Published Course V2 Producer
                                      │
                                      ▼
                             Player / HTML / Web / PDF / PPTX
```

V9 课的「当前位置试运行」和「整课预览」走 `CoursePlayer` + Published V2 宿主（SlidePublishedAdapter / FlowSurfaceHost / SpatialSurfaceHost），**不要再把 Phaser `PlayerApp` 当成 V9 试运行主路径。** Phaser 仍负责 Slide **编辑** 命中与几何。

---

## 3. 车道与执行包

```text
车道 P  产品事实与教师可感知收尾     可改 UI，不改 V9 判别器
车道 C  合同冻结与协议去 V8         已完成；此后 Schema 仅 additive，且单独提交
```

同一提交不得同时改 Schema 判别器和教师可感知交互。P 与 C 分 worktree；抢同一热点时停下来，不要互相 rebase 进对方的合同/手感提交。

执行拆分、并行边界、最小验证命令见：

- [docs/tasks/editor-1.0/00_INDEX.md](docs/tasks/editor-1.0/00_INDEX.md)
- [docs/tasks/editor-1.0/01_SHARED.md](docs/tasks/editor-1.0/01_SHARED.md)

### 3.1 车道 C：合同冻结

| ID | 内容 | 验证 |
|---|---|---|
| T0 | tag、V9 夹具、工作区已有产品补丁收口 | 1 个 round-trip 测试 |
| T1 | **E / A0 / A / D / B1 / B / C 已合入** | 红项优先：typecheck / 本卡单测 |
| T2 | 删除 V8 导入与 migration | 2 个 archive/migration 测试 |
| T3 | 单后端、去掉 candidate | 1–2 个 backend 测试 |
| T4 | 能力索引、validate CLI | 1–2 个 capabilities/CLI 测试 |
| T5 | **已合入** Read Model 边界 | 1 个 UI 适配测试 |
| T6 | **工程门禁已合入 `main`**（合同哈希、CI、禁止项、Windows e2e 27/27）。教师 `accepted` 仍缺 | 视觉/真人清单后才能发布 |

T0–T6、P1–P8、Q1–Q8、F1–F3、G0–G3 已合入 `main`。未获教师 `accepted` 不得宣称 Editor 1.0 已发布。

### 3.2 车道 P：教师可见缺陷（12.2–12.3）

按教师感知排序，不是按文件名排序。稳定性「时好时坏」不单开任务：P1–P4 先去掉双渲染器和跨表面重挂造成的明显竞态；Store/Workspace 大拆仍属 1.0 之后。

| ID | 内容 | 为何这个顺序 |
|---|---|---|
| P1 | 运行态视频 + 控制器可拖可点 + Mixed 导航接到宿主 | 试运行/整课预览现在是空壳；不先修，后面的跳转和媒体都无法验收 |
| P2 | Mixed 跨位置保留 `canvasMode === 'run'` | 依赖 P1 的宿主还在；改 `editorStore` 激活路径 |
| P3 | Flow 编辑态图片/视频真正显示可编 | 与 P1 文件不重叠，可并行；验收时编辑/运行对照 |
| P4 | Spatial 选中框跟旋转；编辑与试运行显示图/视频 | 与 P1 分担 `SpatialSurfaceHost` 时串行该文件 |
| P5 | 画布默认白、可改色 | CSS 可先做；持久化等 T1 可选字段 |
| P6 | 课程树：删除整组/流式页、跨组挪页、主按钮文案 | 不挡播放；可与 P1 并行 |
| P7 | 图层树不再把全局控制器当成场景物件 | 不挡播放；与 T5 抢 `NodesTab` |
| P8 | Flow / Spatial（及 CoursePlayer 上的 Slide 试运行）挂载 Component API 4 | **已合入**；不要重做 |

中间任务禁止 `npm test`、e2e、`build:desktop`、`verify`。默认也禁止 `typecheck`；本轮仅 T1-A / T6-tc-tests 可跑当前红命令 `typecheck`。P 车道最小验证仍是 1–2 个 Vitest 文件；**艺术验收只在 T6 前的课例复核，不在中间宣称 `art candidate`。** 不要每次修改后跑 T6 五条命令。

---

## 4. 版本策略

| 对象 | 当前冻结 | 后续 |
|---|---|---|
| Editor | 未发布；待教师 `accepted` | SemVer |
| Course Project | `schemaVersion: 9` **软冻结** | additive 可选字段可进 V9；破坏性进 V10 |
| Published Course | V2（本次未冻） | 独立升级 |
| Runtime | canvas-runtime API 2；surface-runtime API 3 | 新能力走独立 API 版本 |
| Component | API 4 | 独立升级 |
| Interaction | Interaction Protocol V1 | 破坏性判别器进 V2 |
| AI Authoring | 1.0 不发布 | 2.0 发 Protocol V1，不改已有 V9 字段 |

软冻结后必须能读取所有合法 V9 工程，不改变已有字段含义，不允许静默丢字段。允许再加可选字段并写明缺省；不承诺旧编辑器打开含新键的课。

必须进 V10 的变化：新 Surface 无法由现有三类表达；改变 Location / Layer owner / 统一图层顺序 / Presentation 合并 / 稳定 ID；必须写入工程的完整时间轴或协作模型；删除或重解释现有必填字段。

T1 已合入的 additive：`SpatialSurfaceDocument.backgroundColor?` 与 `FlowSurfaceDocument.backgroundColor?`，缺省 `#ffffff`。Slide 场景 `backgroundColor` 语义不变。

---

## 5. 非目标

- 不全面重写 `editorStore.ts`、`Workspace.tsx`、属性栏。
- 不一次性移除所有 `SceneNode` 形状投影。
- 不加入可见 AI、聊天、模型调用。
- 不新增尚无产品需求的 Surface 或 Native 类型。
- 不为数字整齐重置 Runtime / Component / Published 版本号。
- 不把教师可感知交互缺陷塞进合同提交。
- 不把 Phaser `PlayerApp` 重新接成 V9 Mixed 试运行主路径来「顺便」修视频。
- 不每表面复制一份教师控制器。
- 不为「时好时坏」单开稳定性史诗；1.0 之后再拆 Store / Workspace。

1.0 之后再做：统一 Command 层、拆 Store、V9-native Read Model 替换投影、拆 Workspace、Player Authoring 语义 Patch。

---

## 6. Editor 1.0 Done Definition

- V9 是唯一持久化 Schema，也是唯一 AI Builder 输出。
- 没有用户可达的 V8 默认真相、导入、双后端、candidate 产品语义。
- Runtime 合同无迁移型 legacy 字段。
- V9 合同有机器快照与哈希。
- 真实 V9 夹具可打开、保存、重开、播放、导出。
- 文档与能力索引不再把 Project V8 写成当前格式。
- **P1–P8 在真实课例上通过视觉/互动复核**（试运行与整课预览：控制器可拖可点；三种表面视频能播；Flow/Spatial 编辑能看见图/视频；画布默认白可改色；课程树能删组、能跨组挪同类型页；图层不把全局控制器显示成场景物件；Flow/Spatial 中的互动组件在编辑可选、试运行可交互，缺包时才用静态后备）。
- 自动化、视觉、真人验收通过。
- **教师明确 `accepted`。**
- 内部投影适配器可以存在，不得形成第二份工程真相。

---

## 7. 仍然有效的产品约束（来自已完成的 11.4 重建）

- 不新增持久化四模式字段。
- 不取消全局层、MediaTab、动画、组件、图层控制、教师控制器。
- 不把 Flow 普通 block 当 z-order 图层。嵌入稿纸的组件仍是文档块；视口浮层组件才进统一图层。
- 不给 Flow/Spatial 另造一套组件运行时。复用现有 Component API 4 / `ComponentRegistry`；禁止复制 CourseStudio 动态编辑器。
- 不给 Spatial 另造弱化元素编辑器。
- 不维护两套可见编辑器。
- 不以 hidden/no-op 冒充完成。
- 自动化不能代替教师 `accepted`。
- 编辑态控制器 inert；运行态控制器可执行但只改会话偏移/折叠，不写回工程 frame，除非教师明确「保存位置」。
- Spatial 世界与视口 HUD 使用不同坐标空间；选中框必须跟物件旋转。

---

## 8. 教师可见缺陷：定位原文（12.2，历史）

定位日期：2026-08-18。下列条目的源码修复已合入 `main`（P1–P8、Q1–Q8）。保留原文供取证，**不要按「仍待领取」施工。** 当前剩余是教师视觉复核与 `accepted`。

### 8.1 共同因果

V9 课试运行/整课预览走 Published V2 宿主，Slide 编辑仍走 Phaser。两套渲染器对视频、控制器、资源 URL 的实现不一致。跨表面 `activateCourseLocation` 会 `apply*Backend` 并写死 `canvasMode: 'edit'`。

### 8.2 逐项

**P1 运行态控制器与视频**

- 现象：试运行与整课预览中全局控制器拖不动、按钮失效；除 Flow 稿纸视频块外，运行态视频不能播。
- 原因：`TeacherControllerDom` 只更新 session `offset`，Slide/Flow 宿主不写回 `left/top`（Spatial 会）。Flow 运行浮层 `position: fixed; inset: 0`。Slide 舞台 CSS `scale` 后命中易偏。Flow/Spatial 当前位置试运行未接 `executeTeacherControllerAction` / Mixed 导航。`SlidePublishedAdapter.appendLayerNode` 无 `video`；Flow 浮层与 Spatial `createWorldItem` 无 `<video>`。V9 不再把 Phaser `renderVideoNode` 当试运行主路径。
- 修：三宿主都把 offset 写回 DOM；Flow 浮层相对舞台而不是窗口；Slide 命中用逻辑画布而不是被 scale 打偏的盒；`createPublishedCourseSession` 与当前位置 try-run 都接到 `MixedCourseNavigator`；Slide/Flow 浮层/Spatial 世界挂可播 `<video>`（controls、现有 asset URL）。不要为了视频把试运行打回 Phaser。

**P2 Mixed 跳转打回编辑**

- 现象：混合课跳转位置/表面时，试运行变回编辑。
- 原因：`applyV9Backend` / `applyFlowBackend` / `applySpatialBackend` 无条件 `canvasMode: 'edit'`。跨表面必走这些函数。`Workspace` 虽有 `goToLocation` 订阅，session 已随 edit 卸载。
- 修：激活位置时若当前已是 `run`，保留 mode，只切换 Published session 的 location/surface；不要为跳转整棵重挂编辑后端。同一表面内切场景本就不改 mode，保持。切到「场景基础」（`stateId === null`）的旧路径不要误伤试运行。

**P3 Flow 编辑媒体**

- 现象：编辑态图片、视频不显示、不能当媒体编。
- 原因：稿纸 `<img>` 只有 `data-flow-asset-id` 无 `src`；视频是「视频占位符」。浮层只渲染 `label || '浮层'`。默认插入已是 `document-block`，问题在绘制，不在插到错误 owner。
- 修：编辑态用 sidecar blob URL 画 `<img>` / `<video>`；浮层同样画出 image/video；视频在编辑态至少显示封面并可选择，播放仍以试运行为准。

**P4 Spatial 编辑几何与媒体**

- 现象：旋转时边框不动；编辑不显示视频；试运行不显示图/视频。
- 原因：物件 div 有 `rotate`，`SpatialSelectionOverlay` 的 `selectionBox` 是轴对齐矩形；`stageSelectionOverlayGeometry` 只用旋转算手柄。世界层只渲染 image。试运行 SVG 无 video；image 依赖 `resolveAsset`。
- 修：选中框（或盒本身）跟 `rotation`；编辑世界/HUD 画视频封面或 `<video>`；试运行 `createWorldItem` 画 image（保证 asset URL）和 video。P1 若已改 `SpatialSurfaceHost` 视频，本任务只补编辑态与选中框。

**P5 画布默认白、可改色**

- 现象：无限画布黑底 `#111318`；不能改；三种画布不统一。
- 原因：`.workspace--spatial .canvas-viewport` 与 `derivedV8ProjectFromSpatial` 写死暗色。`SpatialSurfaceDocument` 无 `backgroundColor`。属性「场景背景」只在 Slide 会话出现。
- 修：T1 增加可选字段，缺省白。P5：CSS 默认白；属性可改并写入 V9；编辑视口、试运行宿主、Published 读取同一字段。Slide 继续用场景色。Flow 稿纸白；若加页铬字段则属性可改。禁止把 Spatial 底色写进假 V8 场景却不写回 V9。

**P6 课程树删除、跨组、文案**

- 现象：Flow 删不了页面；Mixed 删不了整组；不能把第二组演示页挪到第一组；流式/无限画布主按钮都叫「新增页面」。
- 原因：`deleteCourseSurface` / `deleteCourseLocation` 已有，Store/ScenePanel 未接。`flow-block` 走 `deleteCourseLocation` 会抛「请通过 Flow 编辑器删除标题块」。`planCourseTreeReorder` 要求同一 `parentKey`，没有「迁到另一同类型 surface」的命令。`PRIMARY_LABELS` 把 `flow-page` / `spatial-page` 写成「新增页面」；下拉文案已正确。
- 修：UI 接上删整组（最后一处位置仍拒绝）。Flow 页删除走 `deleteCourseSurface`，不要拿标题块命令冒充。新增「同类型 location 迁到目标 surface」命令（演示场景迁到另一 Slide 组；不要把 Flow 块迁进 Slide）。主按钮：当前主操作是流式时「新增流式讲义」，无限画布时「新增无限画布」，演示页「新增演示页面」或「新建场景」保持现有 scene 主操作。

**P7 图层中的全局控制器**

- 现象：打开图层仍看到全局控制器，像场景物件。
- 原因：`NodesTab` 统一有效图层按 owner 分组；控制器在「全局」，标签「全课、不可下沉」，仍在同一棵树。
- 修：图层树默认不把教师控制器列在「场景 / 本页 / 世界」里。允许只在「全局」保留一条，或收到「全课控件」入口（已有 `global-layer-entry`）。禁止再复制一份进场景。不启动 V10 owner 迁移。

**P8 Flow / Spatial 互动组件（12.4 可领取；P1/P3/P4 已合入）**

- 现象：在流式讲义和无限画布中插入或已有的互动组件不可用：编辑看不到真实组件、不能点选编辑属性所依赖的画布命中；试运行/整课预览不能交互。
- 原因：Slide **编辑**仍走隔离 Player iframe，有 `componentTargets` 真挂载。Flow/Spatial 与 CoursePlayer 上的 Published 宿主都没有挂 Component API 4：
  - Flow 编辑稿纸 `case 'component'` 只渲染包名和没有 `src` 的后备 `<img>`；浮层与媒体一样只显示标签。
  - Flow 运行 `renderBlockDom` / `renderStaticOverlayItem` 只画 `staticFallback` 或 `[组件后备：pkg@version]` 文本。
  - Spatial 编辑世界层把 `external-component` 落成 `node.name`；HUD 同样。
  - Spatial 运行 `createWorldItem` 对 component 画蓝底矩形 + `packageId`；`createViewportHud` 只有文字。
  - `SlidePublishedAdapter` 在试运行路径上也只画静态后备（与 Flow/Spatial 同一缺口）；P8 抽出共用挂载，三种表面试运行一起接，避免三套假完成。
- 修：在 P1 宿主与 P3/P4 编辑绘制合入之后，用现有 `ComponentRegistry` / 组件会话把 Component API 4 挂进 Flow 稿纸块、Flow 浮层、Spatial 世界（HTML overlay，不要塞进 SVG 当唯一载体）和 Spatial HUD。编辑态可命中、属性可改、`authoringAddress` 稳定；试运行可交互。包缺失或打印/捕获时才用 `staticFallbackAssetId`。不改 Component API 版本，不复制 CourseStudio。
- 顺序：禁止与 P5-persist 同时改同一宿主。逐步算法与 helper 形状见任务卡。

**稳定性**

双后端、切位置整棵重挂、编辑 blob vs 运行 data URL、Flow `fixed` 浮层、Slide CSS scale，造成时好时坏。P1–P4 降低这些竞态。不在 1.0 收尾里拆 `editorStore` / `Workspace`。

---

## 9. 最终判断

当前缺口只剩教师课例复核与 `accepted`，不要把已合入的 C/P/Q/F/G 再当成待做：

1. **车道 C / P / Q / F / G**：合同（含 V9 Schema 软冻结）、教师可见宿主、回归缺陷、流式讲义作者界面与近 Word 接线的源码已在 `main`。
2. **验收**：真实课例视觉/互动复核之后，才能教师 `accepted` 并发布 Editor 1.0。

> **不要再增加 V8 兼容，也不要再跑一遍 V8→V9 重建。不要重做 T0–T6、P1–P8 或 Q1–Q8。V9 已软冻结：不要改已有字段与判别器；additive 走单独合同提交。内部实现再逐步解耦。**
