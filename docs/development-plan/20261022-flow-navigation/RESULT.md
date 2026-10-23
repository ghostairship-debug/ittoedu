# Flow 导航运动、背景协同与视口修复

> 2026-10-23 后续修正：本页关于“交互 Overlay 保留 controllerInsets”、导航宽度减18px的旧结论已由[全局视口与原生吸顶修复结果](GLOBAL_VIEWPORT_AND_STICKY_RESULT_20261023.md)取代。该后续修复统一所有 viewport-pinned 全局实例的完整视口，同时接通 Flow 原生 sticky；本页原导航运动及历史证据保留。

开始：2026-10-22；完成：2026-10-23。

本轮已实现共享的 Flow 平滑导航、公开运动事实与完整视口投影。没有启动组件／Flow 重构，没有修改咖啡 r204 GLX、离线原件或创作源码，没有提交、推送、部署或发行。

咖啡原有背景 Runtime 的固定时长形变仍属于作品代码。本轮提供并实测了公开同步能力，创作线采用下述接口后才能将该作品的形变改为严格跟随滚动；没有把通用测试作品的同步结果冒充原咖啡 Runtime 已采用新接口。

## 根因及统一实现

| 问题 | 已确认根因 | 修复 |
|---|---|---|
| Flow 瞬间跳转 | `flowReading.scrollFlowTarget()`直接写入最终 scrollTop，挂载的阅读 owner 没有可取消的运动过程 | `createFlowReadingNavigation()`持有一次有限 rAF 运动；距离与视口高度决定时长，最高900ms；真实滚动、每帧真实测量、完成精确停靠 |
| 背景经过中间章节时反复重启 | `reading.activeInstanceId`是实际阅读事实，不能同时承担导航意图与作品插值时钟 | `TeacherControllerSnapshot.flowMotion`提供同一次导航的起点、目标、实际进度及状态；reading继续报告真实几何，视觉参数仍归作品 |
| 快速下一章／键盘重复目标 | 旧请求被取消后才解析相对目标，丢失其目标意图；document capture还可能先于播放器消费PageDown取消运动 | 相对目标在取消前由原导航 owner 解析；原生按键接管等传播结束，播放器已消费的按键与repeat继续归正式键盘导航 |
| 对象顶部与章节构图混为一谈 | 目录标题直接作为对象定位，忽略已有章节组的留白与入口 | `resolveFlowChapterEntry()`只沿正式阅读树使用最近section或顶层原生布局组的首标题入口；对象定位继续使用自身锚点／scroll-margin |
| 布局变化与输入抢夺 | 目标位置一次性计算；iframe滚轮不会向父document冒泡，但原生滚动链会改变父Flow | 每帧重新解析真实布局，完成后ResizeObserver按需校准；检测实际scroll位移，并以目标文档位置、尺寸和scale区分布局锚定与人工接管；接管后立即释放旧锚点 |
| 背景右侧／底部留边 | 所有pinned全局对象共用减去controllerInsets的HUD矩形；全宽只拉伸横轴 | 同一共享几何同时提供完整内容视口和安全交互区。Underlay与显式非交互Overlay使用完整区，交互Overlay保留预算；显式100%分别覆盖对应轴；逆投影使用相同选择 |
| 试运行HUD仍贴住边缘 | FlowWorkspace没有传入已有PlaybackViewSession的controllerInsets | 编辑／试运行消费同一个session的实际安全预算，背景仍使用完整区 |

没有新增持久阅读状态、GLX字段、时间轴、截图滚动、第二导航 owner 或iframe输入转发协议。取消、Stop、surface离开、观察绑定释放和dispose沿既有生命周期清理。

## 代码修改

- `src/shared/flowReading.ts`：真实滚动运动、距离时长、减少动态、接管／Abort、ResizeObserver、阅读选择及有限生命周期。
- `src/shared/flowChapterEntry.ts`：按正式结构解析章节入口，不按作品名称或章节编号识别。
- `src/shared/contracts/component-platform/teacherController.ts`：可选`flowMotion`与`scene.go.targetKind`，现有read/subscribe桥直接传输。
- `src/renderer/components/ComponentNavigationOwner.ts`：原owner接入运动、取消前解析相对目标、观察订阅和释放。
- `src/player/componentPlatform/ModelPlayer.ts`、`modelProjection.ts`、`publishedPlayer.ts`、`compiledPlayer.ts`：同一观察合同、章节入口、motion订阅与清理；隐藏旧Flow仅取消其滚动，不取消新surface的导航请求。
- `src/renderer/ui/FlowWorkspace.tsx`：原编辑／试运行owner接线、章节入口、dispose与实际chrome预算；保留此前未提交的编辑修复。
- `src/player/surfaces/flow/FlowSurfaceHost.ts`：历史Flow载体的scrollIntoView路径复用共享滚动owner，不另建公开运动协议。
- `src/shared/teacherControllerViewportGeometry.ts`、`playbackViewGeometry.ts`：完整视口／安全区域及一致逆投影，保留现有18px预算。

## 验证及证据

真实浏览器沿仓库现有Playwright流程执行，使用当前生产Published构建、model Player与compiled单文件HTML路径。独立小作品的背景Runtime只通过公开`context.teacherController.read()/subscribe()`采样并改变位置、大小、颜色，没有读取宿主DOM，也没有自己的逐帧循环。

最终单元命令与类型／构建日志位于[本轮证据目录](../../../output/playwright/flow-navigation-20261022/)；真实浏览器分项及保留失败由[evidence-index.json](../../../output/playwright/flow-navigation-20261022/evidence-index.json)索引，未因局部修正重复全矩阵。

- 新增单元：`flowNavigationMotion20261022`、`flowNavigationOwnerMotion20261022`、`flowChapterEntry20261022`、`globalViewportGeometry20261022`。
- 复用回归：`flowReadingNavigation20261021`、`flowStructuredLayout20261021`、`flowParagraphObservation20261022`、`teacherDirectoryTargets`、`teacherControllerViewportGeometry`、`coreExperienceHudGeometry`。
- 旧clamped-selection单测显式使用instant，以继续独立验证选择语义；真实运动另由可控时钟与浏览器用例验证，没有弱化原断言。
- `tests/e2e/flowNavigationMotion20261022.spec.ts`保留真实按键、两种正式Player、咖啡只读样本、真实iframe滚轮、动态高度与Electron试运行检查。
- 最终10文件／57项聚焦回归通过，三套TypeScript、Player／Renderer／Electron生产构建通过；独立review发现并推动修复了真实键盘、iframe接管与完成后布局选择问题。

### 实测

咖啡 r204 的model与compiled HTML两条路径均得到下表尺寸，高度1000px时背景高度均为1000px，背景实例数量始终为1：

| 内容视口宽度 | Underlay宽度 | 交互导航宽度 |
|---|---|---|
| 1440px | 1440px | 1422px |
| 1550px | 1550px | 1532px |
| 390px | 390px | 372px |

通用测试作品在900px高视口下，两种HTML路径同样铺满背景，HUD底部保留18px。真实导航中背景位置／大小／颜色与同一motion.progress同时变化；跨过多个阅读章节仍保持同一motion id，快速反向从当前视觉快照继续。

0.75缩放、上方内容高度增加400px时，目标停靠到预设125px。Abort后停稳，普通滚轮与手动scroll不拉回。真实iframe内部trusted wheel在运动约417.7/598.9ms时使父Flow从2995px降至2755px，请求返回false，150ms后仍在2755px；修复前同路径会被自动拉回并错误返回true，原失败保留。

连续真实PageDown从chapter2继续到chapter3，按住键的repeat不取消当前motion。完成后人工滚动会清除最后completed motion，背景重新跟随reading；静止后绘制次数不增长。减少动态直接到达。Slide／Spatial切换与返回Flow均成功。

Electron最终真实试运行中，Underlay与内容视口均为1327×891，HUD右侧保留当前chrome所需78px，底部18px；记录128条运动中样本，停稳后paint次数不增长。截图与几何见`electron-safe-0015/facts-electron-trial.json`，不以桌面HTML代替真实试运行。

### 保留的失败与边界

额外运行的`u14FlowPlacement.test.ts`有5项失败：夹具缺少`kernel.readView`／`courseViews.activeDocumentId`，以及既有media-drop夹具失败。失败位置在本轮未改的接口／测试准备，未据此改写无关编辑／导入实现，也未宣称全仓绿色。本轮选定的导航与几何回归独立通过。

一次Renderer构建与Player重建并发执行，读取到尚未生成的compiled-player制品而失败；随后按Player→Renderer依赖顺序构建通过。该过程日志保留，不作为产品运行缺陷。

本轮不改写咖啡作品中的锚点、构图、固定时长视觉参数，也不把某一标题必须落在207px当作软件通用常量。章节入口使用现有结构与真实留白，`targetKind:'object'`仍可精确定位原锚点；视觉设计的最终采用由创作线完成。

## 创作线Runtime接口与示例

```ts
const state = context.teacherController.read()
state.reading       // { containerId, activeInstanceId, progress }，真实阅读事实
state.flowMotion    // 可选，当前／最近一次有限导航运动
```

`flowMotion`字段：`containerId`、挂载期递增`id`、`kind:'chapter'|'object'`、`status:'running'|'completed'|'cancelled'`、`fromInstanceId`、`targetInstanceId`、`startScrollTop`、`targetScrollTop`、`scrollTop`、`progress`、`elapsedMs`、`durationMs`。像素坐标是scroll owner未缩放的CSS像素，progress使用实际滚动位移；完成为1。目标可能随真实布局更新。减少动态时durationMs为0。

完成后保留最后completed快照供收尾；人工接管会清掉它。运行中取消会通知cancelled，不恢复旧目标。不要将该对象写入作品，也不要在每次reading.activeInstanceId改变时重启同一次导航的视觉动画。

以下是作品侧消费方式；`visualForChapter`、`visualForReading`、`interpolate`与`draw`由作品自己的视觉规则实现：

```js
let visual = initialVisual, start = visual, motionKey = '', off
function paint() {
  const s = context.teacherController.read(), m = s.flowMotion
  if (m?.status === 'running') {
    const key = `${m.containerId}/${m.id}`
    if (key !== motionKey) { motionKey = key; start = visual }
    visual = interpolate(start, visualForChapter(m.targetInstanceId), m.progress)
  } else if (m?.status === 'completed') {
    visual = visualForChapter(m.targetInstanceId)
    motionKey = ''
  } else {
    motionKey = ''
    visual = visualForReading(s.reading)
  }
  draw(visual)
}
function connect() {
  if (!off) off = context.teacherController.subscribe(paint)
  paint()
}
function disconnect() { off?.(); off = undefined }
connect()
return { suspend: disconnect, resume: connect, destroy: disconnect }
```

通过正式owner导航即可，不新增第二套导航：

```js
await context.teacherController.execute({
  type: 'scene.go', sceneId: flowContainerId,
  targetInstanceId: headingId, targetKind: 'chapter'
}, signal)
// 精确对象定位：同一调用将targetKind改为'object'。
// 既有目录动作已明确chapter；旧调用未传时，正式目录标题按chapter解释，其余按object。
```

## 收口

独立评审已通过，当前范围没有剩余阻断问题。结论仅为本地候选及本轮真实载体证据成立，不扩大为发行或咖啡作品整体视觉签收。

本轮停止于通用软件修复、必要回归、真实浏览器／Electron证据与接口交接。组件体系／Flow重抽象保持暂停，作品采用、Git提交、推送及发行均未执行。
