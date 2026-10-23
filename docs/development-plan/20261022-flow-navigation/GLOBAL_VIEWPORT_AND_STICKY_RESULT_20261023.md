# 全局视口投影与 Flow 原生吸顶修复

日期：2026-10-23。本文件接替原 RESULT 中“交互 Overlay 应扣除 controllerInsets”的结论；原导航运动、flowMotion 与历史实测仍按各自范围保留。

## 结论与根因

全局 Underlay、Overlay 的 viewport-pinned 实例现在使用同一个完整视口。交互性只决定命中，不再决定画布大小。没有 18px 导航补偿、第二套坐标、安全区状态或作品特例。普通 Flow 正文的版心、padding 和阅读宽度保持原规则。

原实现有三处同源断点：

1. `createTeacherControllerHudGeometry` 扣除 `controllerInsets`，而 Underlay／非交互 Overlay 另取完整矩形。全宽交互导航因此只能覆盖缩小的画布，背景和边线在右端提前终止。
2. 百分比实例只在 identity transform 时采用 CSS 像素布局；缩放／旋转提交后会切回 reference fit。逆投影还把原始 1280px／4096px 尺寸当作当前解析尺寸，产生虚构位移与缩放。
3. 运行态 `ComponentNavigationOwner.moveInstance` 自行重算旧投影，与画面显示不一致；位于底部 clamp 的导航向上拖动时可能仍停在原处。

现在 `resolveGlobalViewportLayout` 为绘制、逆投影与运行态拖拽提供同一解析结果。`width/height:100%` 各自解析到完整视口轴，仿射变换持续使用相同语义；普通参考画幅实例继续使用既有 reference mapping。已有 viewport clamp 与教师台收展仍复用原实现，作者 frame 不因自动布局而被保存改写。

18px 的真实用途是宿主观察平移条的控件厚度。已删除 `playbackControllerInsets`、`controllerInsets` 及“原生滚动条厚度 × 最大缩放 + 固定18px”的全局预算。`PlaybackViewSession.chrome.insets` 只表达当前实际滚动条／平移条，用于控件自身布局、面板定位和观察平移范围；不再进入全局画布投影。历史 Flow 载体的教师控件也只在其自身约束中消费实际 chrome。

## 实际修改

| 文件 | 修改 |
|---|---|
| `src/shared/teacherControllerViewportGeometry.ts` | 单一完整视口；移除 plane／pointer-events 几何分支；统一百分比解析、仿射逆投影与共享布局 helper |
| `src/shared/playbackViewGeometry.ts`、`src/player/playbackViewSession.ts` | 删除固定 controller budget；保留实际平移条厚度及其局部布局 |
| `src/renderer/components/ComponentNavigationOwner.ts` | 运行态拖拽使用共享解析 frame，不再重算另一份投影 |
| `src/renderer/ui/workspaces/SlideLayerSelectionOverlay.tsx`、`FlowWorkspace.tsx` | Flow 选框边框可直接拖动，复用原有 affine gesture／事务，保证 iframe 全局内容也有可达的平移入口 |
| `src/player/componentPlatform/modelProjection.ts`、`compiledPlayer.ts`、`src/renderer/ui/FlowWorkspace.tsx` | 编辑、试运行、model／compiled Player 使用完整 viewport；退出 controllerInsets 接线 |
| `src/player/surfaces/flow/FlowSurfaceHost.ts` | 历史载体的具体教师控件使用当前实际 chrome.insets |
| `src/shared/flowNativeLayout.ts`、`src/shared/componentPresentation.ts` | Flow 正常读序支持原生 sticky 与 CSS inset／zIndex；公共样式摄取支持 viewportPinned 的 width／height 两轴100% |
| `src/renderer/ui/flow/flowBlockPaint.ts` | 原生段落等编辑投影消费同一 sticky 规则，退出后清理旧样式 |
| `src/main/workbench/contentApply/application/plan.ts` | 正式创建对象时保留 sticky 声明及两轴 viewport stretch；增量 style 文件沿共同 policy 接通 |

测试修改：`globalViewportGeometry20261022`、`flowStructuredLayout20261021`、`flowNavigationMotion20261022.spec` 撤销旧导航缩窄预期；`stabilizationOwnershipController.spec` 移除已退役 helper 的引用，历史控件预期使用实际原生滚动条。新增 `flowSticky20261023.test.ts`、`globalViewport20261023.spec.ts`。这些断言变化来自本轮 Owner 明确的完整视口决定，没有放宽旧平滑导航或正文版心断言。

## 验证与证据

使用当前源码生产构建，按 Player → Renderer 的实际依赖顺序构建；Electron 构建完成。Renderer、Electron、E2E 三套 TypeScript 检查通过。独立 reviewer 核查直接消费者、错误断言调整，并复现／复核百分比仿射与运行态拖拽反例，最终无代码阻断项。

聚焦单元共11文件／74项通过，按相关变化增量执行，未运行全仓矩阵：全局几何、教师台几何、HUD、PlaybackViewSession、Flow结构布局、导航运动／owner、阅读定位、章节入口、原生段落观察及新 sticky。全宽导航与全屏背景的缩小／旋转／放大后 clamp 均覆盖逆投影往返；运行态拖拽反例从 y552 正确上移到 y532，作者数据保持不变。

生产浏览器主要证据：[production-20261023-v3](../../../output/playwright/global-viewport-20261023/production-20261023-v3/)，具体见 `facts-production-players.json`、`facts-electron.json` 和截图。测试使用生产 `dist-player/player.iife.js`、`compiled-player.iife.js`，内容编译 helper 只负责正式编译物化，不替代运行时。

| 生产路径 | 内容视口 | Underlay | 交互导航 | 导航下缘 |
|---|---|---|---|---|
| model HTML | 1440×900 | 1440×900 | 1440×64 | y900 |
| compiled HTML | 1440×900 | 1440×900 | 1440×64 | y900 |
| model HTML | 390×900 | 390×900 | 390×64 | y900 |
| compiled HTML | 390×900 | 390×900 | 390×64 | y900 |
| Electron 编辑／试运行 | 1327×891 | 1327×891 | 1327×64 | 与 viewport.bottom 同为1051 |

真实截图像素验证右缘导航背景 `[20,44,60]`、右下缘分隔线 `[245,196,86]`，右端按钮真实点击成功。Electron 真实原生滚动条为15px；120%观察缩放时，两条18px平移条可见，全局背景／交互导航仍保持完整投影，按钮可操作。普通 Flow 滚动内容的 clientWidth 会扣除原生滚动条，这与全局画布完整覆盖是不同属性。

原生 sticky 使用真实 wheel：model／compiled 在1440px下 top 从207.59375变为0，反向滚回后恢复207.59375；Electron 试运行从311.796875吸附到160（真实 scroll owner 的上沿），反滚恢复原位。另用 agent-browser 在生产 compiled 的390px视口真实点击右端按钮、wheel至 scrollTop600，sticky.top=0；反滚至0后恢复386.78125，截图保存在同一证据目录。

旧导航生产回归2项通过，证据在 [viewport-regression-20261023](../../../output/playwright/flow-navigation-20261022/viewport-regression-20261023/)：平滑导航／flowMotion、快速反向、连续PageDown与repeat、减少动态、0.75缩放、动态高度、精确停靠、Abort、普通wheel、真实iframe wheel接管及停止后不拉回。新用例同时覆盖章节中途重定向和 Slide／Spatial／Flow 切换。

新生产用例2项通过，包含独立 profile 的实际编辑器打开、缩放、试运行、另存、关闭、另一进程／profile 冷开。经 DocumentToolGateway 的 `document.export(format:'html-offline')` 正式导出，回执 `status=written`、`warnings=[]`；该正式 HTML 再次在1440与390断网验证完整几何与真实按钮。页面错误为0。

实际输入补证发现 iframe 内部 pointer 不会冒泡到 Flow，原选框只有 resize／rotate；仅给宿主放一个 drag handler 不能证明用户可拖动。已让 Flow 既有选框边框提供移动命中区，调用同一 `FreeTransformGesture`、逆投影与 canonical transaction；不覆盖内容输入、不新增 iframe 转发协议。其他工作区不启用该可选选框能力。

最终强化 Electron 用例通过（1项／14.4秒），证据在 [production-20261023-v4-editor-d](../../../output/playwright/global-viewport-20261023/production-20261023-v4-editor-d/)。真实选框边框拖动30px：画面 top987→957，canonical frame.y10000→797；Undo 回987及原frame，Redo 回957／797。另存、关闭应用、独立 profile 冷开，重新选择同一全局导航后 top957 与保存前一致。正式导出 revision3、warnings=[]，1440／390 全宽、右端按钮可点；此时导航按作者刚保存的 y797 展示，不应再要求它自动贴底。正式导出的 sticky 再次用真实 wheel 验证0→500→0，top207.59375→0→207.59375。最后一处选框改动的 Renderer 生产重建、Renderer／E2E 类型和独立增量 review 也通过，原 Player／Main 及未变浏览器证据复用。

## 下一轮作品侧最简用法

不需要新增公共滚动或锚点 API。把标题、导航、正文放在同一 Flow 正常阅读顺序，导航使用现有实例 style：

```ts
// 声明式示意；实际修改仍经正式工程事务。
flow.childIds = [titleId, navigationId, ...articleIds]
navigation.style = { ...navigation.style, position: 'sticky', top: 0, zIndex: 20 }
// navigation 属于 Flow 读序，不属于 Global Overlay，亦无 flowPlacement / viewportPinned。
```

导航保留正常占位，标题先滚出，导航到达顶部后由浏览器吸顶；反向滚动自动恢复。要贯穿整篇吸顶，导航应为 Flow 顶层对象，或放在覆盖整篇的阅读组中；放进仅含标题与导航的短组会遵循 CSS 的父级底边限制。原生 sticky 不依赖 Runtime 读取 scrollTop，也不依赖 flowMotion。

导航按钮继续复用已有公共接口，无需改导航状态：

```js
context.teacherController.execute({
  type: 'scene.go', sceneId: flowId,
  targetInstanceId: chapterId, targetKind: 'chapter'
})
```

章节需要避开其上方导航时，使用已有 `scrollMarginTop` 表达作品所需距离。完整横幅作品可使用既有 Flow `edgeToEdge`／全宽布局；普通阅读版心按作者当前布局保留。本轮没有把全局 Overlay 自动改成 sticky，也没有改装咖啡工程。

## 准确边界

- 本轮只写通用产品源码、测试与软件记录，未写咖啡 v05／v06／v07 GLX、作品源码或素材；开始时已有的大量脏改动与未追踪成果保全，未 reset／stash。
- 390px证据是浏览器CSS视口，不是移动真机；Electron 实际编辑视口为1327px，移动宽度由生产 Player 与正式导出验证。
- 初始验证材料的整屏交互 iframe 会持有整屏输入，其内部透明不等于把输入传给宿主兄弟 Flow；已将测试导航约束为其实际64px高度。早期采样点撞到 sticky、wheel落入侧栏等夹具失败保留在相邻目录，没有据此加入产品补偿。
- 额外执行 `teacherControllerFlowWorkspace.test.tsx` 与 `slideWorkspaceV10.test.tsx` 得到7失败／4通过及2个未处理错误：Flow 夹具在渲染前缺少 `courseView.activeDocumentId`；Slide 夹具有 `adoptedStyleSheets` 模拟缺失及既有 quick-bar／草稿 Promise／资源／frame 断言不匹配。Slide 未启用新增 movable，失败并未经过新增边框分支；本轮不扩修这些旧夹具、不删除其正确断言，也不宣称全仓绿色。新增移动入口以生产 Electron 实际操作闭环判定。
- 未签咖啡作品已采用 sticky 或其整体创作质量，未提交 Git、推送、发行、部署。
