# 空间停靠点与站内步骤合同

Owner 2026-10-04 已批准空间源采用 impress.js 的 `.step`、`data-x`、`data-y`、`data-scale`、`data-rotate`；本轮包含镜头旋转、停靠点跟随对象及停靠点内 fragment。工程内文件解析与序列化归 D，本合同给出 C 的稳定目标格式和播放 consumer；不要求模型填写对象、镜头或步骤编号。

## D 可立即使用的格式与 helper

- 每个空间区块落为 `SpatialSurfaceDocument.world.layerItems` 中的正式对象；普通 HTML 落为 `composition`，逐条出现沿用 `class="fragment"`。
- 为区块生成 `camera.frames` 和课程顺序中的 `spatial-camera` location；镜头的 `targetLayerItemId` 指向同一世界内的对象。身份及引用由软件分配。地图文件的 `.step` 及 data 属性解析、读回属于 D 写域，本轮 C 不改 `projectFiles`。
- `src/core/course/normalizeCourseProject.ts` 的 `normalizeCourseProject(project)` 返回归一化副本；跟随镜头取对象中心、当前旋转和按课程画布拟合的 zoom（各侧 5% 留白）。移动、缩放和旋转对象后由同一正式归一化路径更新镜头；删除目标后取消跟随，保留最后有效 pose。手动 `updateSpatialCameraFramePose` 设定镜头会取消跟随。
- pose 的 `rotation?: number` 单位为度，缺省为 0；Player 的 SVG/HTML 世界绕视口中心反向旋转。命中、平移和剔除使用同一旋转矩阵；编辑器绘制旋转后的镜头框，静态镜头页使用同一取景。

`src/shared/composition/spatialStopSteps.ts` 接受 V9 或 Published 的 Spatial surface 及课程 `locations`，不依赖 Store、文件服务或宿主状态。接口已稳定：

```ts
spatialStopLocations(surface, locations) // 当前 surface 的停靠位置，保持课程顺序
spatialSteppingStops(surface, locations)
// Map<locationId, { layerItemId: string; count: number }>
spatialFragmentStepId(step) // "fragment_step_<k>"，0 为到站
spatialFragmentStepIndex(stateId) // 合法派生状态的 k，其他输入 undefined
spatialFragmentNodeAttributes(surface, locations, locationId, step)
// Map<layerItemId, Map<compositionNodeId, Record<string, string>>>
```

D **无需生成或保存 Spatial presentation states**，也无需登记 fragment。软件按当前内容派生步骤，继续使用原有帧与 location 身份；返回的节点属性只应用在渲染副本上，不写进源码或工程。`withCompositionNodeAttributes` 复用 Slide 的节点投影规则。

## 播放与编辑语义

- 按课程顺序，第一个跟随某对象的停靠点承担该对象的讲解步骤：到站显示标题等普通内容，fragment 为 0；随后按文档顺序每步展开一个，展开全部后才前往下一停靠点。后续另一个停靠点若再次跟随同一对象，作为完整内容的回看，不再生成第二套讲解步骤。
- 前面已讲过的对象显示全部 fragment，尚未抵达的对象隐藏 fragment。反向一步从后一站到前一站的最后 fragment，再逐步收回；精确重进首次讲解点从到站 0 开始。显式命名状态只接受当前停靠点实际存在的步骤。
- Spatial 画布仍是场景，停靠点与 fragment 都是其内部步骤；场景按钮直接跳过当前画布剩余步骤。整课首尾才是步骤边界。键盘、翻页笔、教师控制台、Interaction V1 的 `step.next` / `step.previous` 和目录消费同一 `buildCoursePlaybackSequence`。
- 站内步进保留当前会话相机和存活的组合 iframe，增量更新 fragment 属性；普通站间移动复用载体。显式重播仍重置载体，不将运行时状态写回作者工程。
- 编辑视图与静态捕获显示全部 fragment，作者可直接修改。正式内容编辑后新播放器按当前内容重新派生步骤；保存、重开保留对象、跟随引用与旋转，不保存播放进度。
- 当前位置试运行使用同一播放序列，跨 Surface 跳转在该入口不可用；初始镜头取明确请求的停靠点。整课预览及 HTML 播放继续使用唯一 Published 导航事务和既有守卫、取消、历史及停止语义。
- 简单互动沿用正式 Interaction V1；本合同不新增 DOM 互动规则、模型编号工作或累计次数、输出、时限、大小门，CAS/停止保持原边界。

## 本轮证据与集成边界

2026-10-04 C 本轮检查通过，16 个不同的相关用例；已通过而未受后续修改影响的证据继续复用，没有跑全矩阵：

| 范围 | 通过证据 |
|---|---|
| `spatialStopSteps.test.ts` | 3 项：序列、反向显隐、正式内容/几何编辑后归档重开；跟随和旋转仍正确 |
| `spatialCameraStops.test.ts` | 4 项：既有跟随、旋转与实际世界投影 |
| `spatialLocationTryRun.test.ts` | 2 项：既有空间试运行 |
| `spatialStopFragments.test.ts` | 5 项：真实 Chromium 中 Published/翻页笔、正式 Interaction V1、当前位置控制台、跨 Surface 返回、编辑/捕获与初始命名步骤 |
| `publishedCourseNavigation.test.ts` | 仅选择 `steps through Slide states` 与 `groups contiguous Flow anchors` 两项，确认共享导航接线保持既有 Slide/混合语义 |
| 类型与制品 | `tsc --noEmit` 通过；仅 `vite.player.config.ts` 对应 Player 构建通过，未运行完整 build/verify |

依赖目录为已有主树 junction，仅只读复用。Vitest 临时配置指定本工作区 `output/c-spatial-checks/vite-cache`，用 `--configLoader runner` 避免配置临时包写入共享 node_modules；Player 通过程序化读取现有 Vite 配置并设 `configFile:false` 构建，产物只位于本工作区 `dist-player`。没有修改或清理主树依赖。

首轮临时测试配置因 `__dirname` 在 runner 中不可用而失败，改成局部等价配置；新增 Interaction 测试最初误用未公开的状态属性，随后快速连按命中既有键盘去抖，改为正式 Interaction 动作和公开快照/触发入口后通过，未改键盘实现。最后类型检查发现新 fixture 的联合配置未保留字面量类型，修正后通过。这些是本轮实际命中的检查问题，不以历史失败推导其他修复。

C 工作区位于 `D:/果铃-restructure-worktrees/20261004/c-format`。依赖提交 `867aba5a`、`53d2a08b`；本工作区不代替主线集成。D 的 impress 源文读写以及最终合流检查由对应 writer 完成。历史 C 失败（`spatialProductIntegration` 的新建 fixture 未识别 Spatial，`unifiedCompositionAuthoring/Drag/FlowSpatial` 的 carrier/Hook，以及前轮已更新的 `g20HtmlImport/Desktop/M24` 旧拒绝断言）只作记录，本轮没有复测或宣称消除；仅实际相关检查失败才进入根因修复。
