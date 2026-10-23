# Runtime geometry and transient motion

2026-10-24。软件层已实施；未修改正式 v08、素材或路线代码。

## 独立定位

- `ComponentRuntimeScope.target()` 在直接宿主有 DOM element；Sandbox 只有最新已观察的数据快照。它没有跨 iframe 批量读取当前正式目标布局的方式。`teacherController.viewportBounds()` 是调用者视口中的播放区域，`teacherController.read().reading` 是另一次广播收到的导航读数；二者不是其他组件当前文档位置，也不保证与作品保存在 `scope.state` 的历史 rect 同时刻。
- Flow Editor、Model Player、compiled Player 都有实际 `[data-flow-paper-scroll]`；Model/compiled 已注册正式容器 target，Editor 只注册普通子对象，缺容器基准注册。已在 Editor 既有 observation effect 中补 `surfaceId -> observationContent` 及 expected-element 清理。
- `layout.read/reportSize` 负责宿主输入尺寸/自然高度，不是跨对象位置总线。`scope.state` 是临态业务状态，不写持久工程，但把视口 rect 和 reading 写进去仍会形成跨时刻样本；不能将临态等同于同帧。
- 现有 `target.motion.replace` 已提供有限暂态 effect、write/nextFrame/animate、channel 替换、AbortSignal、任务/挂载清理；`ComponentRuntimeHost` 将 channel 限定到来源实例/挂载，`ComponentWorldInteractions` 和 `MotionScope` 不写作者 frame 或 History。本轮复用，没有新增动画系统。
- 独立核 v08：`visual-slot.js:18` 每次把视口坐标和当时 reading 合成对象；`local-program-bridge.js:16` 同样发布局部 rect；`journey-runtime.js:59` 直接拼各槽位最新值，`:169` 从当时有效的路线数组取 `.at(-1)`。因此不同 reading 的坐标可混算，route 身份可因某个槽位首次出现/失效突然变化。`:205` entryX 使用目的物体列、`:237` 等将移动端主体缩至 14px，属于作品选择。`:37–48` 像素处理/去底是作品脚本；不能把特定素材黑底 flood-fill 放进宿主通用坐标接口。

## 实施

在已有 scope 上增加可选 `measure(references)`，返回同一次同步 host 布局观测的样本。`sampleTime` 为宿主 `performance.timeOrigin + performance.now()` 毫秒。

- `viewportFrame` 将正式 target 边框内的 CSS 像素映射到调用者视口（Sandbox 会在同一 request turn 取得 iframe 仿射基准并投影）。
- Flow 的 `contentFrame` 在实际滚动 owner 的未缩放内容像素中；`contentToViewport` 映射到同一调用者视口；`flow.viewport` 是内容空间内可见窗口，x/y 就是同批 scrollLeft/scrollTop。`scrollSize` 只描述真实滚动 DOM，不替代教师导航的阅读语义（Editor 的额外空白纸可能在其中）。
- 未连接/无可测视觉投影为 null；有真实布局的已挂载离屏对象可测；不会为尚未挂载内容制造几何，也没有保留几何 cache/第二布局树。
- natural-height 嵌套 Flow 不自滚动时，沿已有正式父链使用外部实际 scroll owner。父链复用本轮性能修复的派生索引。
- Host 仅在 scope 存活时提供/返回样本；Sandbox 退出解决所有待回测量为 null，并释放 iframe；不写 state、作者事务或 History。

源码：`runtime.ts`、`ComponentRuntimeHost.ts`、`componentGeometry.ts`、`SandboxComponentRuntime.ts`、World ports 回调、`FlowWorkspace.tsx`。正式发现入口更新 `componentAuthorSourceRuntimeNote`（project Source/reference 回执共用）和 `workbench-usage/references/project-files.md`。

另配合性能修复，将 Sandbox 的作者资源反向查找接入已有 lease.reverse，避免 `Object.entries(resourceUrls)` 触发全部 lazy URL getter。资源 lease 本身由运行性能叶子负责。

## 验证

| 证据 | 结果 |
| --- | --- |
| `tests/unit/runtimeGeometry20261024.test.ts` | 6 passed；同批离屏、滚动 content 稳定、缩放和 iframe 投影、fresh 重排、unmounted null、natural nested outer scroll、真实 World native consumer、retire/不写 state |
| `tests/unit/runtimeGeometryBrowser20261024.test.ts` | 实际 Chromium passed；`compileCoursePlayback -> mountCompiledCourse` 真 Source consumer、1100/390 宽、滚动 400、0.75 scale Sandbox、source 改变后真实 iframe 替换/重挂、dispose |
| `tests/unit/runtimeGeometryEditor20261024.test.ts` | 实际 Editor harness/Driver/Registry/Bridge；scroll 0 -> 200 内容坐标稳定；close 旧 scope measure null；重开恢复；1100 -> 390 宽 |
| `browser-measurements.json` | compiled 第二目标 y=1908 -> 1508，Flow content y 保持 1908；窄屏视窗 390；iframe 第二目标 content y=1720，在 scroll600、0.75倍载体下 caller y=1493.328125，与真实 DOM 转换误差 <0.1 CSSpx |
| `editor-measurements.json` | desktop/reopened/narrow 全部样本，错误数组为空；Editor Flow 视窗 1100 -> 390，scroll 0 -> 200 |

类型检查由 Root 在全集成后统一运行。该叶子未跑完整 build/性能矩阵、未 commit。首次 Editor 命令只回传了初始 stdout，session ID 未保留；完整 JSON 在核心断言后写出，进程结束，不能将此描述成已保存该命令完整退出日志。

## 保证边界

该软件能力解决同批正式目标几何的可获得性和坐标基准。它不会自动改写 v08 现有 slot 广播，不自动恢复未挂载 DOM 的艺术锚点，不选择路线，不将原生 effect 与任意异步 Canvas 绘制强制变成全局原子提交，也不会替作品去底/裁切。作品应采用新观测接口并保有一个明确的 route/渲染 owner；见 `CREATIVE_HANDOFF.md`。
