# Flow / Spatial / Mixed 产品深度审计（只读）

> 审计日期：2026-08-24；补充评估：2026-08-25  
> 分支：`codex/architecture-stabilization`  
> 基线提交：`d2371aa`  
> 范围：教师控制器、Flow、Spatial、Mixed，以及三者共用的元素、图层、属性和验证链路  
> 边界：本轮只探索、复现、阅读源码和整理结论；未修改产品代码、Schema、测试、配置或开发任务状态

## 1. 结论先行

当前最严重的问题不是“功能数量不足”，而是若干高频作者行为在真实界面中不可完成，且现有自动化仍会给出绿灯。

| 范围 | 当前结果 | 结论 |
|---|---|---|
| Mixed 中新增 Spatial 后连续插入 | 第二个世界元素因统一图层 `order` 冲突被 Schema 拒绝 | `P0`，常见创建路径不可用 |
| Flow 正文编辑 | 可输入，但鼠标拖选得不到选区；空文本块的编辑根节点没有稳定几何，初始光标错位 | 拖选为 `P0`；空块光标为 `P2`，应合并进同一轮文本编辑稳定化 |
| Flow 公式 | 双击可见公式正文时常因首次点击重渲染而无法进入编辑；现有模型只能表达独立公式块 | 交互缺陷与行内公式能力缺口均为 `P1` |
| Flow 中拖动教师控制器 | 页面手势会直接改写唯一全局 frame，且允许完整拖出画布；随后切换 Slide/统一画布会触发 Payload 校验失败 | `P0`，正常作者动作可写入下游不可交付状态 |
| Flow 工具栏、图层、媒体和富文本 | 存在状态跳变、入口割裂、伪版式和能力缺口 | 多项 `P1`，尚未达到教师可稳定使用 |
| Spatial 图层、属性、复制粘贴、全局层 | 多个入口不可达、静默 no-op 或伪成功 | 多项 `P1`，不能只修“第二个文本框” |
| 教师控制器默认折叠 | 产品目标合理，但当前折叠后仍保留大面积透明命中区，并有 Flow TOC 裁出画布等问题 | 应先修折叠语义，再改默认值 |
| 页面级控制器位置 | 当前没有独立页面位置合同；Flow 却允许在页面语境中一次手势静默修改全课位置 | 已确认取消页面作者态的点选与编辑；页面只显示无命中预览，唯一作者入口为“全局层（全课）” |
| 构建体积警告 | renderer 主块约 5.13 MB，Player IIFE 约 1.84 MB，源码映射约 18.27 MB | `P2` 性能/打包风险；警告本身不能单独证明架构重构失败 |
| 现有验证体系 | 逻辑测试覆盖不少，但缺真实指针、实际布局尺寸、跨 Surface 历史和常见 Mixed 创建链 | 存在明显“测试绿、产品红” |

结果评级：

- Slide：本轮未做完整审计，不评级。
- Flow：`engineering candidate`，但核心文字链路尚不具备教师可用性。
- 纯 Spatial：`engineering candidate`，图层所有权、属性和重复操作仍有高风险缺口。
- Mixed：常见 Spatial 作者链路为 `unusable`。
- 教师控制器“默认折叠且无需预留位置”：产品意图成立，当前实现尚不满足该语义。

本轮确认 3 个 P0，以及一组相互关联的 P1/P2。应先修核心行为和所有权/顺序事实，再改善侧栏与媒体能力；不建议先新增逐页控制器覆盖、抽象层、状态机或大而全验证平台。

## 2. 审计方法与证据边界

本轮使用了三类证据，并明确区分可信度：

1. **当前运行实测**：启动当前 Windows Electron 包确认首屏；在现有本地 renderer 中按真实点击、输入和拖动路径复现 Flow 与 Mixed 问题。
2. **源码交叉确认**：定位事件、Store 路由、Session、Schema、Published Host 和样式的实际执行路径。
3. **现有测试审阅**：确认为什么测试通过仍未覆盖用户行为；Flow 相关 8 个测试文件共 70 个测试通过，但仍无法发现鼠标拖选和实际媒体宽度问题。
4. **补充证据复核**：对用户提供的空文本光标、构建警告和统一画布失败截图做源码因果追踪，并用只读构建统计与 V9→V8 投影探针确认边界。

证据限制：

- Electron 已用于确认真实桌面首屏及控制器默认展开；后续主要交互证据来自相同 renderer 的 in-app Chromium。
- 本轮没有把真实图片/视频导入桌面工程，因此 Flow 三种媒体宽度是“高置信源码缺陷”，仍需要真实素材的编辑器 + Player 尺寸实测。
- 本轮没有完成桌面保存重开、导出和完整 CoursePlayer 纵切；这些应进入修复后的阶段门，不应把未覆盖项写成“已通过”。
- 本轮未确认 Runtime/Component 在 Spatial 试运行态与画布手势冲突，因此暂不把它升级为 bug。
- renderer 体积来自 `build.write=false` 的只读构建统计；本轮没有据此修改拆包配置，也没有完成打包后冷启动、首个可编辑画布时间和内存基线。

### 当前运行证据

- [01：Electron 首屏，教师控制器默认展开](output/playwright/product-audit-2026-08-24/01-slide-initial-expanded-controller.png)
- [03：Flow 作者态点击“收”后仍保持展开](output/playwright/product-audit-2026-08-24/03-flow-collapse-click-no-collapse.png)
- [04：Flow 空段落进入编辑后工具栏显著膨胀](output/playwright/product-audit-2026-08-24/04-flow-empty-inline-editor-zero-size-expanded-toolbar.png)
- [05：Flow 真实拖动后没有文字选区](output/playwright/product-audit-2026-08-24/05-flow-drag-selection-empty.png)
- [06：Flow 图层只显示聚合“正文”](output/playwright/product-audit-2026-08-24/06-flow-layers-excludes-document-blocks.png)
- [07：Flow 段落当前属性能力](output/playwright/product-audit-2026-08-24/07-flow-paragraph-properties.png)
- [08：Mixed 中新建 Spatial 页面](output/playwright/product-audit-2026-08-24/08-mixed-spatial-empty-expanded-controller.png)
- [09：Mixed Spatial 第二次插入文本触发 order 冲突](output/playwright/product-audit-2026-08-24/09-mixed-spatial-second-text-duplicate-order-error.png)
- [10：冲突后 Spatial 图层只剩第一个世界文本](output/playwright/product-audit-2026-08-24/10-spatial-layers-world-only-after-conflict.png)
- [11：Flow 空文本块初始光标错位（手机拍摄证据）](output/playwright/product-audit-2026-08-24/11-flow-empty-caret-mobile-evidence.jpg)
- [12：renderer 主 chunk 超过 500 kB 的构建警告](output/playwright/product-audit-2026-08-24/12-renderer-chunk-size-warning.png)
- [13：Flow 控制器拖出画布后，统一画布因 Payload 失败而无法启动](output/playwright/product-audit-2026-08-24/13-flow-controller-out-of-bounds-payload-failure.png)

## 3. 关键用户链路健康度

| 步骤 | 用户行为 | 期望 | 当前结果 | 健康度 |
|---|---|---|---|---|
| 1 | 新建默认工程 | 控制器遵循新默认且不影响内容操作 | 当前默认展开 | 待调整，但不能只改默认值 |
| 2 | 新建 Flow，插入并编辑段落 | 可稳定进入编辑、拖选、格式化 | 可输入；鼠标无法拖选；工具栏显著变形 | 阻断 |
| 2A | 点击空 Flow 文本块 | 光标落在真实输入起点，输入前后几何稳定 | 空 inline editor 没有稳定宽高；光标错位，首字符出现后才恢复 | 缺陷 |
| 2B | 双击 Flow 公式正文 | 任意可见公式区域都能稳定进入公式编辑 | 首次点击选择后重渲染，第二击常落在新 DOM；左侧稳定区域更容易触发 | 高风险 |
| 3 | 在 Flow 管理内容和浮层 | 能看懂正文顺序与浮层层级 | 图层只给一个“正文”伪行，内容结构不可管理 | 严重不合理 |
| 3A | 在 Flow 页面点击或拖动教师控制器 | 页面编辑不应命中全局控制器；底层内容可直接操作 | 当前页手势会选中并改写全局 frame；还可完整拖出画布并使后续统一画布启动失败 | 阻断 |
| 4 | 默认 Slide 工程中新增 Spatial | 形成正常 Mixed 工程 | 页面创建成功，第一个文本成功 | 部分可用 |
| 5 | 在同一 Spatial 再插入元素 | 连续创作 | 第二个任意世界元素可能与控制器 `order=1` 冲突 | 阻断 |
| 6 | Spatial → Slide → Spatial | 内容和撤销历史都保留 | 内容保留，但撤销历史被清空 | 高风险 |
| 7 | Spatial 全局层添加元素 | 元素跨场景持续存在 | UI 明确承诺可加，但 Store 固定路由到 world，返回 `wrong-owner` | 阻断该功能 |
| 8 | Spatial 调属性、复制、粘贴、重复 | canonical 工程实际变化 | 多个属性被静默忽略；部分操作伪成功或空操作 | 高风险 |

## 4. P0：核心创建与编辑阻断

### MIX-01：Mixed 新增 Spatial 后，第二个世界元素必然撞上全局控制器顺序

**分类：已运行确认的功能缺陷。**

最短复现：

1. 新建默认 Slide 工程。
2. 新增一个无限画布，形成 Mixed。
3. 在 Spatial“元素”中点击“文本”两次。
4. 第一次成功；第二次失败，世界中仍只有一个节点。
5. UI 暴露底层错误：`Effective unified layer order is duplicated: 1`。

该问题不是文本专属。文字、公式、图形、图片、视频、组件和 Runtime 都共用世界元素追加逻辑，因此任意第二个 world item 都可能失败。

根因链：

- 默认教师控制器为全局图层，使用 `order=1`：`src/renderer/project/createCourseProject.ts:65`。
- Mixed 追加 Spatial 只创建空 `world.layerItems`，没有协调继承的 global order：`src/renderer/course/courseLocationCommands.ts:316-357`、`:519-535`。
- Spatial 新元素的顺序只从 `world.layerItems` 计算，依次分配 0、1、2……：`src/renderer/course/spatialEditorCommands.ts:450-464`。
- V9 Schema 正确要求 global + surface + world 的有效图层顺序唯一：`src/shared/contracts/course-project-v9/schema.ts:1257-1272`、`:1368-1372`。
- 纯 Spatial factory 已把继承的全局层抬到 `100000+`，说明代码已知 world-only allocator 的限制；Mixed 追加路径遗漏了同类处理：`src/renderer/project/createSpatialCourseProject.ts:27-38`。

为什么现有样例和测试没挡住：

- Mixed baseline fixture 使用了刻意错开的 10、40、100、9000 等顺序，绕开了真实默认新建路径。
- Spatial 单测里的控制器 order 不是默认的 1。
- 现有 Mixed E2E 主要覆盖打开、保存重开和试运行，没有覆盖“默认 Slide → 新增 Spatial → 连续插入两个元素”。

修复边界建议：修复 order 分配/归一化的单一事实源，不改 V9 Schema 约束；Schema 在这里正确地阻止了非法工程。

### FLOW-01：Flow 正文无法用鼠标拖选

**分类：已运行确认的功能缺陷。**

最短复现：

1. 新建 Flow 页面并插入段落。
2. 双击或再次点击段落进入就地编辑。
3. 输入一段文字。
4. 从文字中部拖动到另一端。
5. 没有选区高亮，浏览器 Selection 结果为空。

运行态事实：

- `.flow-inline-editor` 的计算样式为 `user-select: none`。
- 编辑器能获得焦点、显示光标并输入，但实际指针拖动不产生选区。

根因链：

- 全局 `body` 设置 `user-select: none`：`src/renderer/styles/globals.css:49-56`。
- Slide 编辑层明确覆盖为 `user-select: text`：同文件 `:1513-1530`。
- Flow 的 `contenteditable` 没有对应覆盖：`src/renderer/ui/FlowWorkspace.tsx:160-180`。

测试缺口：`flowInlineTextEditor.test.tsx` 覆盖逻辑 selection、IME 和 runs，但没有真实 CSS 级联、pointer drag 或浏览器 Selection。相关 70 个测试通过仍没有发现该 P0。

### CTRL-05：Flow 可把全局控制器完整拖出画布，并写入下游拒绝的工程状态

**分类：用户证据 + 源码链 + 纯函数投影探针确认的功能缺陷。**

最短复现：

1. 在 Flow 编辑态按住教师控制器并向画布外拖动。
2. 指针捕获允许在画布外继续更新，松开后把越界坐标写回 V9 全局项。
3. 切换到 Slide 或启动统一画布。
4. V9 工程本身仍通过，但 V9→V8 投影后的 `playback.controls='canvas'` 找不到任何与画布相交的可见控制器，统一画布显示“课件 Payload 缺少必要数据或版本不受支持”。

根因链：

- Flow 将 client 坐标换算为 1280×720 本地坐标时不做边界限制：`src/renderer/ui/FlowWorkspace.tsx:583-594`。
- pointer move / up 直接生成任意 x/y，`pointercancel` 还复用提交函数：同文件 `:1604-1704`、`:1796-1799`。
- `transformFlowOverlayFrame` 只验证有限数和最小尺寸，随后直接改写全局控制器的基础 frame：`src/renderer/course/flowSharedAuthoringAdapters.ts:976-1036`。
- V9 frame 对 x/y 只要求有限数，因此作者状态可通过 V9：`src/shared/contracts/course-project-v9/schema.ts:115-121`。
- 切换 Surface 时会重建投影：`src/renderer/store/editorStore.ts:6248-6253`、`:6338-6344`；V9 全局 frame 被原样投影到 V8：同文件 `:801-840`。
- V8 又正确要求 canvas controls 至少有一个与画布相交的可见全局控制器：`src/shared/teacherControllerConsistency.ts:31-68`、`src/shared/projectSchema.ts:853-859`。外层只把具体校验失败包装成通用 Payload 错误：`src/player/payload.ts:13-27`。

这项缺陷说明重构边界确实没有闭合：作者端允许保存的 V9 状态，下游统一画布明确拒绝。它与构建 chunk 警告没有因果关系。

修复边界：

1. Slide / Flow / Spatial 共用一个控制器作者边界约束；无论展开或折叠，至少保留可见恢复把手在安全区内。
2. `pointercancel` 只取消 preview，不得提交。
3. 给已存在的越界工程提供“重置到安全位置 / 居中”恢复入口，并把具体原因显示给作者。
4. 不要通过把 `playback.controls` 静默改成 `none` 来绕过校验。

最小纵切应覆盖四边拖出、画布外松开、`pointercancel`、Flow→Slide、保存重开、统一画布和发布 Player。

## 5. 教师控制器：产品目标正确，但当前不能直接翻默认值

用户目标应被保留为明确产品决策：

> 新建课件的教师控制器默认折叠；折叠后只占极小视觉和交互范围；后续课件设计不需要为它预留版面；教师可随时展开、折叠和拖走。

当前实现还不满足这句话的后半段。

### CTRL-01（P1）：折叠后视觉很小，命中范围仍是完整 900×64

- 默认控制器尺寸 900×64，默认展开：`src/renderer/project/createProject.ts:429-452`。
- 折叠布局视觉上约为右侧 30×30 小胶囊：`src/player/teacherControllerLayout.ts:85-180`。
- 但 DOM 根节点和 Slide / Flow / Spatial Host 仍保留完整作者 frame，且 `pointerEvents: auto`：
  - `src/player/teacherControllerDom.ts:138-180`
  - `src/player/surfaces/slide/SlidePublishedAdapter.ts:272-303`
  - `src/player/surfaces/flow/FlowSurfaceHost.ts:463-493`
  - `src/player/surfaces/spatial/SpatialSurfaceHost.ts:946-976`

后果：折叠后虽然看起来不占位，透明区域仍会截获点击；在 Spatial 中还可能阻断空白平移或下层元素命中。因此在修复前宣称“无需预留位置”并不成立。

### CTRL-02（P1）：Flow 目录打开后可能把折叠入口移出画布

- Flow TOC 宽 260px：`src/player/surfaces/flow/flowRuntimeToc.ts:11`。
- 打开后 article / overlay 整体右移 260px：`src/player/surfaces/flow/FlowSurfaceHost.ts:338-341`。
- Player 根容器 1280×720 且 overflow hidden：同文件 `:183-201`。

默认控制器靠近右侧，折叠按钮再被整体右移后可能超出 1280px，用户将无法找回控制器。现有测试只覆盖了一个非默认的较小控制器位置，没有覆盖该组合。

### CTRL-03（P1）：Mixed 中“全局控制器”的临时状态按 Surface 分裂

Slide、Flow、Spatial 各自维护教师控制器运行 Session；Mixed 同时挂载三种 Host。结果是同一个全局控制器的折叠/拖动状态可能因 Surface 不同而不同，不符合“全课控制器”的直觉。课程 restart 还只重置位置，不清空这些 Session map。

相关实现：

- `src/player/surfaces/slide/SlidePublishedAdapter.ts:423-425`、`:617-628`
- `src/player/surfaces/flow/FlowSurfaceHost.ts:107-110`、`:480-526`
- `src/player/surfaces/spatial/SpatialSurfaceHost.ts:432-435`、`:1030-1067`
- `src/player/publishedDynamicHosts.ts:83-141`、`:240-259`、`:564-620`

### CTRL-04（P1）：作者态强制展开，无法真实预览默认折叠

Flow / Spatial 作者 chrome 明确传入 `{ offset: 0, collapsed: false }`：

- `src/renderer/ui/TeacherControllerAuthoringChrome.tsx:54-87`
- `src/renderer/ui/FlowWorkspace.tsx:1801-1816`
- `src/renderer/ui/Workspace.tsx:1189-1212`

本轮真实点击 Flow 中的“收”后，控制器仍完整展开，并切换为选中全局控制器。即便之后只修改 factory 默认值，作者态反馈仍会与运行初始状态不一致。

### 页面级全局控制器编辑能力决策：取消页面作者态点选与编辑

**已确认结论：页面编辑态中的控制器只保留无命中预览，不可点选、不可聚焦、不可拖动或缩放；所有作者编辑只在“全局层（全课）”进行。**

用户的逻辑判断成立：如果作者在“当前页”语境中拖动控制器，产品却把结果写回唯一全局 frame，那么这不是页面级编辑，而是一次未充分告知的全课修改。反过来，如果把它真的定义为页面级编辑，则必须允许不同页面保存不同位置，并补齐继承、恢复、复制、删除、导出和运行时合并语义。当前不应保留两者之间的模糊状态。

此前考虑的“第一次点击跳转全局层、第二次拖动再写全局位置”仍会产生频繁且意外的上下文切换，因此不采用。全局对象不应通过页面对象的命中行为来承担入口职责；仓库已经有固定“全局层（全课）”入口，直接使用这一入口更符合所有权，也更可预测。

现在不实现逐页位置的理由：

1. 核心目标是“默认折叠、真实占位极小、教师运行时随时拖走”，而不是预先为每页排一个控制器位置。折叠 footprint 和运行 Session 修好后，逐页 authored position 的剩余价值有限。
2. 控制器是全课唯一的视口级授课工具。内容、按钮、样式和作者默认位置保持全局，认知成本最低；当前逐 location 只支持显隐，已经能处理少数页面不需要控制器的情形。
3. V9 的 `CourseLocation` 不是通用“页面”：Slide location 指向 scene，Flow location 是长文档中的 block 锚点，Spatial location 是 camera frame。按 location 保存坐标会让控制器在 Flow 滚动或 Spatial 巡游时跳动，并制造大量无意义记录：`src/shared/contracts/course-project-v9/types.ts:423-445`。
4. 现有 `ScopedLayerItem` 只有 location visibility，没有 frame override：同文件 `:119-141`。Slide 命名状态的 `layerItemOverrides` 也不能借用来覆盖全局控制器，因为 Schema 只允许引用当前 `scene.layerItems`：`src/shared/contracts/course-project-v9/schema.ts:461-487`。
5. 真正增加持久化覆盖会同时触及 Course Project V9、Published Course V2、V9→V8 投影、三个 Player Host、导出/重读和严格 Schema 兼容，不是一次属性面板小修。

应统一成以下交互：

1. **页面编辑态**：仍可显示控制器的实际预览，但 authoring hit-test、pointer、键盘焦点、选择框和 resize handles 全部关闭；命中应穿透到底层文字、图片、视频或画布手势。纯预览节点不进入作者态 Tab 顺序，也不向辅助技术伪装成可操作控件。
2. **全局层编辑态**：通过固定“全局层（全课）”入口选择控制器，才允许调整位置、尺寸、样式、按钮和显隐范围；持续显示“影响全部页面”的范围提示。
3. **试运行 / 正式运行态**：控制器恢复完整交互，可展开、折叠和拖动；拖动保持 session-only，不写工程、不产生 dirty，也不冒充 authored override。
4. **跨模式一致性**：Flow 应删除当前页面手势中的 global 选择和提交路径：`src/renderer/ui/FlowWorkspace.tsx:1604-1704`。Slide / Spatial 已要求 global scope，应统一为相同的“页面 inert、全局层可编辑”语义：`src/renderer/authoring/v9TeacherControllerAuthoring.ts:230-295`、`src/renderer/authoring/spatialWorldAuthoring.ts:695-719`。

只有在 CTRL-01～05 修复、默认折叠真实可用后，仍有明确教师证据表明 Mixed 的不同布局必须预设不同落点，才重新立项一个窄的 additive exception。届时也不应做通用 `byLocationId`：Flow / Spatial 最多按 Surface，Slide 才可显式按 scene；只覆盖 x/y，默认继承全课位置，用户明确选择“为当前表面/幻灯片单独定位”后才创建稀疏记录，并提供“恢复全课位置”。这是一项条件性未来方案，不进入当前稳定化范围。

### 默认折叠的安全落地顺序

1. 修复 CTRL-05 越界写入与恢复链，保证任何作者位置都能被统一画布和 Published Player 接受。
2. 折叠时把真实命中 footprint 缩到可见胶囊；展开时恢复完整命中范围。
3. 修复 Flow TOC 对控制器位置/可恢复性的影响。
4. 明确 Mixed 的全局控制器临时状态：折叠应跨 Surface 连续，位置可按 Surface 保存本次运行 offset；补全 restart 语义。
5. 让作者态能真实预览折叠状态；页面预览无命中，作者编辑只存在于全局层。
6. 最后只把**新建控制器和缺失后恢复的控制器**默认设为折叠；保留现有工程中显式保存的 `defaultCollapsed`，不做覆盖式迁移。

这一顺序不需要新增状态机，也不需要修改 V9 Schema；当前 Schema 已有必填布尔值，Published Course 也会复制该值。

## 6. Flow：功能边界不是照搬 Slide，而是保证同等级的核心可靠性

### FLOW-02（P1）：Paragraph 工具栏在短/长状态之间确定性跳变

- 普通选中只显示结构工具；进入富文本编辑后突然加入范围格式工具，并可能换成两行。
- 工具栏绝对定位、自动高度、允许换行；接近页面底部时还会从下方切到上方。
- 当前表现会遮挡内容、改变操作目标位置，并放大“paragraph 栏忽长忽短”的感知。

源码：

- `src/renderer/ui/FlowBlockContextToolbar.tsx:62-80`、`:87-251`
- `src/renderer/ui/FlowWorkspace.tsx:808-826`、`:1164-1167`

这不是随机渲染 bug，而是现有交互规则本身不合理。应稳定主工具栏外形，把低频范围工具渐进披露，避免编辑焦点变化造成整排控件重排。

### FLOW-03（P1，高置信源码缺陷）：正文宽 / 较宽 / 全宽媒体很可能实际同宽

编辑器和 Player 都先把父级 reading container 限制为正文宽，再给子级媒体设置 `width: 100%` 和不同 `maxWidth`。子级不能越过已经更窄的包含块，所以“较宽 / 全宽”的样式字符串虽不同，实际可见宽度很可能相同。

- 编辑器：`src/renderer/ui/FlowWorkspace.tsx:1353-1369`、`:1742-1751`
- Player：`src/player/surfaces/flow/FlowSurfaceHost.ts:904-906`、`:992-1017`

现有测试只断言 `style.maxWidth` 字符串，不断言 `getBoundingClientRect().width`，形成假绿灯。此项应在有真实媒体时做编辑器和 Player 双端实测后再关闭。

### FLOW-04（P1）：文中视频几乎无法在作者态验证和配置

当前属性只有题注、粗粒度版式、环绕、替换、上下移动、转浮层和删除；编辑态 `<video>` 没有 controls，而 Player 固定 `controls=true`。作者无法配置或可靠检查 poster、预览/播放、自动播放、循环、静音、起止时间和控件策略。

- `src/renderer/ui/PropertiesTab.tsx:2223-2425`
- `src/renderer/ui/FlowWorkspace.tsx:363-373`
- `src/player/surfaces/flow/FlowSurfaceHost.ts:1032-1037`

其中完整播放策略会涉及 V9 additive 可选字段，应单独走合同提交；不应借此打开 V10 或大迁移。

### FLOW-05（P1）：文中图片只有素材块最低能力

已有：替代文本、题注、正文/较宽/全宽、环绕、替换、上下移动、转浮层、删除。

缺少的高频内容编辑能力包括：裁剪、焦点、object-fit、明确尺寸/宽度比例、宽高比、常用边框/圆角，以及对实际版式尺寸的即时画布反馈。

不建议把文中图片直接改成 Slide 自由节点；只需补齐文档流媒体应该有的内容编辑能力。需要覆盖正文时，用户应显式“转为浮层”。

### FLOW-06（P1）：图层引擎语义基本正确，信息架构却使功能看起来“废了”

真实界面中，多个正文块只显示一个聚合“正文”行，并提示标题和段落不进入图层。该行不能管理块列表、顺序或嵌套。

- 固定单一“正文”行：`src/renderer/ui/NodesTab.tsx:453-477`
- 提示正文不进入图层：同文件 `:479-483`
- 文档块顺序实际藏在画布拖放和 Properties 上下移动：`src/renderer/ui/FlowWorkspace.tsx:1229-1240`、`src/renderer/ui/PropertiesTab.tsx:2345-2403`

正确设计不是把每个 Flow 段落塞进 z-index，而是在同一侧栏中明确分成：

- **内容 / 大纲**：每个 Flow block、顺序、嵌套、媒体块和文中组件。
- **浮层**：真正的 LayerItem，提供前后层级、锁定、隐藏和定位空间。

### FLOW-07（P1）：富文本模型已有能力，但编辑入口与状态反馈割裂

Flow run 已支持颜色、粗体、斜体、下划线、删除线、着重号、高亮、字体和字号：`src/shared/contracts/course-project-v9/schema.ts:557-567`。

稳定 Properties 只提供字体、字号、粗体、斜体和颜色；下划线、删除线、着重号、高亮和清除格式只在临时编辑工具栏中出现。再叠加无法拖选和工具栏跳变，数据模型能力无法转化为可靠作者能力。

另外，界面写“选区格式”，但没有 caret range 时会格式化整块；当前控件没有明确反馈“正在改选区、整段还是混合值”。

### FLOW-08（P2）：属性值不代表当前选区

`src/renderer/ui/PropertiesTab.tsx:2448-2477` 会从 runs 中取第一个具有颜色/字体/字号的值，而不是根据当前 caret/range 聚合，也没有“混合值”。复杂段落中，Properties 很可能展示与当前选区无关的格式。

### FLOW-09（P2）：浮层所有权和定位空间命名混在一起

内部 `viewport-overlay` 实际表示“统一浮层系统所有”，但同一个对象又可能 `paperSpace='paper'` 跟随稿纸。UI 应统一叫“浮层”，把“属于浮层系统”与“钉在视口/跟随稿纸”拆成两个概念，不让用户理解内部 ownership 术语。

### FLOW-10（P2）：空文本块没有稳定编辑几何，初始光标错位

用户提供的手机拍摄证据与此前截图中的 0×0 空编辑根节点一致。Flow 新建段落和“新增段落”都会产生空 paragraph：`src/renderer/course/flowDocumentModel.ts:45-60`、`src/renderer/course/flowEditorCommands.ts:186-188`。编辑器把它渲染成空的 inline `<span contentEditable>`，只给 `minHeight: 1.4em`，却没有 block display 或稳定宽度：`src/renderer/ui/FlowWorkspace.tsx:160-179`。

空文本会生成空 HTML，selection 又被恢复到这个没有子节点、没有稳定盒子的根：`src/renderer/authoring/flowTextEdit.ts:839-868`、`:1005-1049`。因此点击时浏览器只能在不可靠的零尺寸几何上绘制 caret；输入首字符后才出现 line box 和宽度，光标随之恢复正常。这也会让空段落尾部的点击更容易落到外层 block 而退出编辑。

修复不需要新模型：让编辑根成为 full-width block，给稳定 min-height / line-height、`user-select: text` 和 `cursor: text`；必要时使用不进入模型的占位 `<br>`。真实 Chromium 测试应断言空编辑根 bounding rect 非零、焦点和 caret 在根内、输入首字符前后几何不跳，并覆盖 IME、段落/标题/引用/列表/表格。

### FLOW-11（P1）：双击公式正文会被首次点击后的 DOM 重渲染打断

- 外层公式 block 只监听原生 `dblclick`：`src/renderer/ui/FlowWorkspace.tsx:1201-1207`。
- 首次 click 会选中公式并在正文前插入工具栏：同文件 `:1541-1583`。
- 公式正文由 imperative canvas 承载：同文件 `:1422-1434`、`src/player/PublishedFormulaPaint.tsx:14-40`。

首次点击改变组件树后，第二次点击可能落到新建的 DOM target，浏览器不再把两次 click 合成为同一个 target 的 `dblclick`；左侧未被替换的 block 区域反而更容易成功。段落已有“第二次 click 进入文本编辑”的 fallback：`src/renderer/ui/FlowWorkspace.tsx:947-960`，公式没有。

现有测试直接合成 `dblclick`，没有走“首次点击 → 重渲染 → 第二次点击”的真实链，因此是假绿灯。应保持公式正文 target 稳定，并提供明确“编辑公式”入口作为可发现 fallback；测试必须发出两次真实 click，而不是直接派发 dblclick。

### FLOW-12（P1，产品能力缺口）：当前不能表达文本中夹杂公式

评估结论是：**当前确实无法以可编辑、可访问和可重新解析的语义表达行内公式。**

- Flow rich text 只有字符串与样式 runs：`src/shared/contracts/course-project-v9/types.ts:185-197`、`src/shared/contracts/course-project-v9/schema.ts:556-629`。
- 公式是独立 block：同 types `:252-257`、schema `:720-726`。
- “插入公式”只会在当前块后新增 standalone formula block：`src/renderer/store/editorStore.ts:7474-7493`。
- Flow 文本编辑器明确只接受文本型块，Player 也把公式作为独立块渲染：`src/renderer/authoring/flowTextEdit.ts:28-30`、`:239-260`，`src/player/surfaces/flow/FlowSurfaceHost.ts:947-968`、`:1085-1104`。

直接输入 Unicode 公式字符只能伪装视觉，无法保存 AST、替代文本和公式级再编辑。因此“当 x>0 时，函数 f(x)=x² 单调递增”这类正文是当前真实能力空洞，不是入口隐藏。

建议保留独立 display formula，同时以单独 additive V9 合同任务为 Flow rich text 增加 inline formula atom：在 caret 插入，具有稳定 ID、公式 AST 和可访问文本，并完整覆盖 paragraph / heading / quote / list / table、选区删除、复制粘贴、撤销、保存重开、Player、打印和 PPTX。它不应与 FLOW-11 的交互 bug 混成一次小修，也不需要打开 V10 或重写整套文本编辑器。

### Flow 与 Slide 的合理能力边界

| 对象 | 正确管理方式 | 应否进入 z-index 图层 |
|---|---|---|
| 标题、段落、列表、引用 | 文档块顺序、嵌套、段落样式 | 否 |
| 文中图片、视频、组件 | 块顺序、版式、环绕、内容编辑 | 否 |
| 转为浮层的图片、视频、组件 | z-order、锁定、隐藏、定位空间 | 是 |
| Shape / Runtime | 浮层 | 是 |
| 音频 | 文中媒体块 | 否 |
| 教师控制器 | 视口浮层 / 全课控制器 | 是 |

Flow 不应照搬 Slide 的 x/y、旋转、固定框高和自由叠放模型；但必须达到同等级可靠性的鼠标/键盘选区、IME、撤销、保存重开、核心字符格式、当前选区反馈、段落格式、媒体内容编辑和内容顺序管理。

## 7. Spatial / Mixed：第二个文本框只是最先暴露的系统性问题

### MIX-02（P1）：跨 Surface 切换会保留内容但清空撤销历史

复现结果：在 Spatial 新增元素后切到 Slide，再切回同一 Spatial，元素仍在，但撤销已不可用；Session camera 也回到镜头帧，而不是保留用户浏览位置。

根因：跨类型位置切换会重新 `open*AuthoringSession`，而 `openSpatialAuthoringSession` 每次创建新 sessionId、generation 和空的 past/future。

- `src/renderer/store/editorStore.ts:6319-6360`
- `src/renderer/course/spatialEditorCommands.ts:178-206`

这会造成“内容在、撤销权没了”的危险体验。应先明确跨 Surface 历史产品语义，再让 Slide / Flow / Spatial 一致；不需要为了这一点新增一套通用工作流状态机。

### SPATIAL-01（P1）：全局层明确承诺可添加，但入口固定路由到 world

Spatial 全局层 Elements 文案明确说这里添加的文字、图片、图形和全局组件会跨场景持续存在，但 `addTextNode`、公式、图形、图片、视频等在 Spatial Session 存在时都固定调用 world 插入。world 命令按设计拒绝非 world scope，于是 UI 承诺和实际命令冲突。

- UI 承诺：`src/renderer/ui/ElementsTab.tsx:153-170`
- 固定路由：`src/renderer/store/editorStore.ts:7379-7461`、`:7547-7566`、`:7618-7761`
- world 命令拒绝 wrong owner：`src/renderer/course/spatialEditorCommands.ts:425-430`

### SPATIAL-02（P1）：统一图层显示跨 owner 行，但部分行看得见、点不动

- Spatial 有效图层会显示 global、surface、world，只过滤教师控制器。
- 点击行统一调用 `selectNode`，但 Spatial 不像 Slide / Flow 那样根据 owner 切换 scope。
- `selectSpatialLayers` 只接受 `layer.source === session.scope`。
- 当前 UI 只能进入 global/world，类型中存在的 `surface` scope 无可达入口；surface-owned 内容会成为只读“幽灵层”。

相关路径：

- `src/renderer/ui/NodesTab.tsx:356-402`、`:510-535`
- `src/renderer/store/editorStore.ts:5659-5680`、`:10620-10640`
- `src/renderer/course/spatialEditorCommands.ts:249-283`
- `src/renderer/authoring/spatialWorldAuthoring.ts:721-730`

### SPATIAL-03（P1）：属性面板暴露大量控件，但 Store 静默忽略 patch

Properties 暴露名称、透明度、播放初始状态和完整文字样式；Spatial `updateNodes` 实际只处理 locked、visible，以及 world 元素的 x/y/width/height/rotation，然后直接 return。

- UI：`src/renderer/ui/PropertiesTab.tsx:672-820`
- Store：`src/renderer/store/editorStore.ts:10125-10165`

因此名称、透明度、播放初始状态、整框字体/字号/颜色/对齐/背景等变更会被静默忽略。global HUD 的几何属性还可能错误调用 world transform 并返回 `wrong-owner`。

边界：Spatial world 文字“内容”有专用 content-edit 提交链，不能笼统说所有文字编辑都不可用；问题是通用属性和整节点样式入口与实际能力不一致。

### SPATIAL-04（P1）：复制 / 粘贴 / 重复存在空操作或伪成功

- 图层行公开“重复”。
- `duplicateNode` 只有 Slide 专用分支；Spatial 落入旧通用 `commit`，而该 V9 `commit` 明确为空操作。
- Ctrl+C/V/D 仍直接调用旧 Store 方法，没有走已接入 Surface action 的正确路由。
- 粘贴可能不改变 canonical Spatial 工程，却更新选择和“已粘贴”状态，形成伪成功。

相关路径：

- `src/renderer/ui/NodesTab.tsx:521-535`
- `src/renderer/store/editorStore.ts:4900-4910`、`:9668-9715`
- `src/renderer/App.tsx:1723-1760`

### SPATIAL-05（P2）：跨 owner 拖动会换坐标系但不换算坐标

图层允许跨来源拖放并改变存储范围；Spatial global 是 viewport 坐标，surface/world 是 world 坐标。owner move 只移动同一个 item 并保留原 frame，没有 world ↔ viewport 换算。可预期结果是视觉跳位，移入 surface 后还会落入不可达 scope。

- `src/renderer/ui/NodesTab.tsx:402-445`
- `src/renderer/course/spatialEditorView.ts:81-116`
- `src/renderer/course/effectiveLayerCommands.ts:628-690`

此项代码路径明确没有换算，但仍应补一条真实可视 E2E 后再关闭。

### SPATIAL-06（P2）：底层 Zod JSON 直接暴露给教师

第二次插入失败时，UI 显示完整 `code / path / message` JSON。`persistSpatialResult` 直接把 command reason 写入 `errorMessage`：`src/renderer/store/editorStore.ts:3237-3260`。这既不可操作，也暴露内部结构；应保留诊断详情给日志，对用户给出可理解、可恢复的错误。

## 8. 跨模式设计不一致

### CROSS-01（P1）：Elements 宣称“可拖入画布”，Flow / Spatial 却没有对应接收链

Slide、Flow、Spatial 共用同样的卡片和 drag payload，面板写“可单击添加，也可拖入画布”；实际只有 Slide Workspace 处理外部元素拖入。Flow 只处理内部块重排，Spatial 没有接收该 payload。

- `src/renderer/ui/ElementsTab.tsx:72-140`、`:151-350`
- Slide 接收：`src/renderer/ui/Workspace.tsx:3283-3359`
- Flow 只有内部 reorder：`src/renderer/ui/FlowWorkspace.tsx:1229-1239`

这是明确的伪 affordance。修复可二选一：补齐两种 Surface 的 drop 行为，或只在实际支持的 Surface 展示“可拖入”。

### CROSS-02（P1）：相同“文本 / 图片 / 视频”卡片产生不同对象，界面没有解释

- Slide 文本是自由 Native 文本框。
- Flow 文本是文档段落；图片/视频默认是文中媒体块，图形才是浮层。
- Spatial 文本/媒体是 world item。

差异本身合理，但同一 UI 卡片、同一文案和同一拖拽承诺没有说明 Surface 语义，用户会自然期待 Slide 同等级的编辑能力和图层行为。应在 Elements、空状态或插入反馈中清楚说明“文档块 / 浮层 / 世界元素”。

### CROSS-03（P2）：交互承载对象的 Properties 在 Flow / Spatial 中不可用

当选中 Flow / Spatial 的交互 carrier 时，Properties 不提供与 Slide 对等的上下文入口，而是引导到 Automation。该路由可能符合“统一自动化”的长期方向，但当前缺少就地可发现性，进一步加剧“不同模式像不同产品”的感受。

### CROSS-04（P1）：同一个全局控制器在三种作者表面具有不同的写入语义

Flow 允许页面中的第一次拖动手势同时完成“选择 global + 修改全局 frame”，而 Slide / Spatial 只在 global scope 接受控制器变换。结果是相同对象在 Flow 看似“本页可编辑”，实际静默影响全课。应按第 5 节已确认决策统一为：三种页面作者态中的控制器都不参与 hit-test、选择或变换，只有全局层能写全课默认位置；不新增逐页坐标，也不通过页面点击自动切换 scope。

## 9. 构建体积警告与“重构是否彻底”的判断

用户截图中的 Vite / Rolldown 警告真实存在，但**仅凭“某个 chunk 大于 500 kB”不能推出架构重构不彻底**。模块职责边界与产物拆包是相关但不同的问题：代码可以完成职责拆分，却仍因静态入口和内嵌产物被打进同一个 chunk。

本轮只读 `build.write=false` 统计：

| 产物 | 未压缩体积 | gzip 体积 | 主要风险 |
|---|---:|---:|---|
| renderer 主 chunk | 约 5,127,636 B | 约 1,378,745 B | 冷启动解析/编译、内存与首个可编辑画布延迟 |
| Player IIFE | 约 1,844,916 B | 约 499,908 B | 被 renderer 以字符串内嵌，主进程并未真正隔离其加载成本 |
| `pptxgen` chunk | 约 368,531 B | 未单独记录 | 导出能力仍应按需加载 |
| renderer source map | 约 18,269,390 B | 不适用 | 当前进入应用包，带来安装体积和源码暴露风险 |

主要来源包括 Phaser（约 2.70 MB rendered bytes）、`virtual:player-bundle`（约 1.86 MB）、React DOM，以及仍然较大的 `editorStore.ts`、`PropertiesTab.tsx` 和 `Workspace.tsx`。`vite.renderer.config.ts` 会把完整 `dist-player/player.iife.js` 读成字符串；Slide authoring / try-run 又静态拉入 Phaser 和 Player，App / Workspace 还静态连接大体积编辑与导出入口。

因此结论应分两层：

- **架构结论**：这个警告本身不能证明职责重构失败，也与 CTRL-05 的 Payload 失败没有因果关系。
- **交付结论**：如果本次重构承诺过“运行时隔离、按需加载或显著改善启动性能”，那么性能解耦这一纵切仍未完成；当前是需要测量和治理的 `P2`，不能把警告阈值调高后当作完成。

推荐顺序是先记录打包后的冷启动、首个可编辑画布时间、峰值内存和安装包体积，再依次延迟加载嵌入 Player、Phaser/Slide、PPTX/导出；同时确认生产包是否需要 source map。`manualChunks` 只能改善缓存/并行加载，若入口仍同步执行，并不会自动消除解析和内存成本。

## 10. 验证体系为什么会放过这些问题

当前不是“验证太少”，而是验证层级与风险错配：逻辑和 Schema 测得较多，真实用户行为测得太少。

| 已有验证 | 能证明什么 | 不能证明什么 |
|---|---|---|
| 命令 / Schema 单测 | 数据结构、reason、字段和部分状态转移 | pointer drag、CSS 级联、真实选区、视觉可达性 |
| DOM / jsdom 测试 | 元素和 style 字符串存在 | 真实布局宽度、遮挡、工具栏跳变、视频可操作性 |
| 基线 fixture 测试 | 精心构造样例可运行 | 默认新建路径不会产生 order 冲突 |
| Mixed 打开与试运行 E2E | 页面可导航、Host 可启动 | 连续作者操作、跨 Surface undo、全局层插入 |
| 自动化绿灯 | `engineering candidate` | 教师可用、视觉合理、`art candidate` 或 `accepted` |

### 防止复发且不过度验证的最小体系

不建议新增 dashboard、证据清单、审批状态机、全模式组合矩阵或每张任务都跑完整 `verify`。每个问题只增加一条能守住用户行为的最小纵切：

1. **Mixed 顺序**：默认 Slide → 新增 Spatial → 连续插入两个不同 world 元素 → 保存重开；断言无错误且 effective order 唯一。
2. **Flow 选区**：真实浏览器 pointer drag；断言 Selection 非空，格式化只影响选区。
3. **Flow 空块**：真实 Chromium 中断言空 contenteditable rect 非零、caret 在根内，首字符输入前后编辑几何稳定。
4. **Flow 公式入口**：依次发出两次真实 click，并在第一次 click 触发重渲染后仍能进入公式编辑；不得只合成 dblclick。
5. **Flow 行内公式**：只在独立合同任务落地时增加 paragraph/list/table 的插入、删除、复制粘贴、保存重开与真实 Player 纵切。
6. **Flow 媒体版式**：编辑器与 Player 分别断言三种布局的实际 bounding rect，而不是 style 字符串。
7. **Spatial history**：插入 → 切 Slide → 切回 → undo / redo；断言 canonical project 正确变化。
8. **Spatial owner**：在 global、surface、world 各选择/新增一个受支持对象；断言路由、地址和 owner 一致。
9. **Spatial 属性与复制**：每个公开控件至少验证 canonical project 真正改变；禁止只验证 toast、selection 或临时 clipboard。
10. **教师控制器**：四边越界、画布外松开和 `pointercancel` 后仍可恢复；Flow→Slide、保存重开和真实 Player 可启动；折叠后命中框接近可见胶囊；Flow TOC 打开后按钮仍在画布内；Mixed 切换和 restart 状态符合产品定义。
11. **控制器作者语义**：Slide / Flow / Spatial 页面作者态均无法点选、聚焦或变换控制器，pointer 可命中其下方内容；只有全局层可修改 frame；Flow 换 block、Spatial 换 camera 不产生位置覆盖或跳动。

运行策略：

- 每张修复卡：只跑对应单测 + 1 条真实浏览器用户行为。
- 热点合并前：跑受影响 Surface 的保存重开和真实 Player smoke。
- 阶段门 / 最终候选：才跑完整 E2E、build、导出和 `verify`。

这样可以直接防住本次问题，同时避免重新堆出过度验证体系。

## 11. 推荐修复顺序（本轮未执行）

### 第一批：恢复核心可用性

1. CTRL-05：先阻止控制器越界写入、修正 `pointercancel`，提供旧数据恢复，并打通 Flow→Slide / 保存重开 / Player 纵切。
2. MIX-01：统一有效图层 order 分配，补默认 Mixed 连续插入纵切。
3. FLOW-01：恢复 Flow contenteditable 的真实文字选择，补 pointer drag 纵切。
4. SPATIAL-03 / 04：禁止公开控件静默 no-op 或伪成功；未接通能力应暂时隐藏或给出明确不可用状态。

### 第二批：修正所有权、历史和控制器语义

1. SPATIAL-01 / 02：统一 global / surface / world 的编辑 scope、选择和插入路由。
2. MIX-02：明确并实现跨 Surface undo / camera session 语义。
3. CTRL-01～04：先修折叠命中、TOC、Mixed session 和作者态预览；取消三种页面作者态的控制器命中与编辑，只保留全局层作者入口，再将新控制器默认改为折叠。
4. SPATIAL-05：跨 owner 移动要么做坐标换算，要么在无法安全换算时禁止该拖放。

### 第三批：改善 Flow 核心作者体验

1. FLOW-10：为所有空 rich-text block 提供稳定编辑几何，并与 FLOW-01 共用真实浏览器纵切。
2. FLOW-11：保持公式正文 target 稳定，并增加明确“编辑公式”入口。
3. 稳定 Paragraph 工具栏几何和渐进披露。
4. 把侧栏拆成“内容 / 大纲”和“浮层”语义。
5. 统一富文本选区状态、混合值和稳定入口。
6. 修复媒体真实宽度；补图片内容编辑和视频预览/基础播放设置。
7. FLOW-12 以独立 additive 合同任务补行内公式，不与公式双击 bug 或通用编辑器重构捆绑。

### 第四批：统一跨模式语言和错误反馈

1. 修复“可拖入”的伪 affordance。
2. 给相同元素卡片增加 Surface 语义反馈。
3. 把底层 Zod JSON 改为教师可理解错误，并保留日志诊断详情。

### 第五批：在实测指标驱动下治理打包体积

1. 建立一次打包后冷启动、首个可编辑画布、内存和安装包体积基线。
2. 按收益依次懒加载内嵌 Player、Phaser/Slide 和导出入口；检查生产 source map 打包策略。
3. 指标改善后再调整 chunk 规则；不以“警告消失”替代用户可见性能结果。

## 12. 不应采取的修复路线

- 不要把 Flow 的所有段落和文中媒体都强行塞入 canvas z-index；这会破坏文档流语义。
- 不要为了第二文本框问题放宽 V9 Schema 的 order 唯一约束；应修分配器和 Mixed 创建路径。
- 不要在透明命中区、TOC 和 Mixed session 未修前只把 `defaultCollapsed` 改成 `true`。
- 不要让页面中的点击、拖动或键盘操作选中全局控制器，也不要自动跳转到全局层；页面预览必须无命中并让事件穿透到底层内容。
- 不要现在新增通用逐 location 控制器坐标：Flow block 和 Spatial camera 不是布局页，也不要复制多个控制器再靠显隐模拟。
- 不要用提高 `chunkSizeWarningLimit` 或只分 `manualChunks` 来证明性能问题已解决。
- 不要为这些问题新增 V10、`projectMode`、通用状态机、插件层或大规模 Store 重写。
- 不要用“测试通过”代替真实编辑器截图、真实指针操作、保存重开和 Player 结果。
- 不要一次把 Flow 做成轻量 Word 或把 Spatial 做成完整白板；先修当前公开入口的真实性和核心创作链。

## 13. 本轮最终判断

用户指出的问题属实，而且范围比表面现象更大：

- “Mixed 无限画布无法插入第二个文本框”是统一图层 order 分配在 Mixed 真实创建路径中的确定性 P0，不是偶发 UI 问题。
- “Flow 无法拖选、空文本块光标错位、Paragraph 栏来回变化、文本能力远弱于 Slide”均有运行或源码证据；根因主要在 CSS 选区、空 inline editor 几何、工具栏状态设计和能力入口割裂。
- 公式正文双击失败是首次点击重渲染打断原生 dblclick 的交互缺陷；“文本中夹杂公式”则是当前 rich-text 合同不能表达的独立产品能力缺口，两者不能用同一个补丁糊在一起。
- “Flow 图层是废的”在用户体验层面成立，但正确修法不是让正文拥有 z-index，而是提供可操作的内容大纲，并把真正浮层单独管理。
- Spatial 还存在全局层插入失败、跨 owner 图层不可选、属性 no-op、复制粘贴伪成功和跨 Surface 撤销丢失等高风险问题。
- Flow 将教师控制器拖出画布后会写入“V9 接受、统一画布拒绝”的状态，这是新确认的 P0，也明确暴露了作者合同与下游投影没有闭合。
- 教师控制器可以、也应该最终默认折叠，并让课件设计无需预留位置；但必须先让越界恢复、折叠后的真实命中面积、Flow TOC 和 Mixed 状态语义与这个产品承诺一致。
- 暂不实现逐页控制器位置：它不是当前目标的必要条件，且通用 location 在 Flow / Spatial 中不是页面。页面编辑态也不承担入口、点选或变换；所有持久化位置只在明确的“全局层（全课）”语境中调整。只有稳定化后仍有真实需求，才单独评审 Surface / Slide scene 的窄覆盖合同。
- 构建大 chunk 是需要指标化治理的 `P2`，却不能单独证明职责重构失败；若重构承诺包含按需加载和运行时隔离，则这部分交付仍未完成。

在以上 P0/P1 修完并通过最小真实行为纵切前，不应把 Flow、Spatial 或 Mixed 结论提升到 `accepted`。
