# Flow 可用性 review 整改

当前基线为 `156e9ee`。外部报告基线为 `945ed40`；A/B/C 与原生浮层旋转路径仍适用于当前源码，S2 未签署的状态描述已经过时。本次不撤销或重做 S1/S2 签署。

## 已实现的行为

- **A，课堂可用性 P1**：Flow 原生视频复用共享 Published Native video handle，登记到课程 AudioManager；当前页试运行没有外部音频 owner 时使用自身 AudioManager。离开 Surface 主动暂停；返回不自动播放、不重置进度；位置移除、重建和销毁释放媒体登记与事件。共享视频实现从 Slide 目录迁至 Published 公共目录，Slide consumer 同步改用唯一实现。
- **B，互动状态 P1**：同一 Flow 的普通正式位置导航保留正文和仍适用的浮层实例；按位置组成增删浮层，退休实例的状态/导航能力同步失效。位置交互重新绑定，保留原始命中与旋转属性。显式重播、reset 与 Published 正文更新仍重建。位置可见性使某浮层离开当前组成时，该实例会销毁；再次出现为新实例，不承诺保存已移除浮层的局部状态。
- **C，动态准入缺陷**：Flow 与 Spatial 都对目标的实际挂载实例执行共享 PNG capture 和 capture barrier，不再把 Flow 的位置 JSON 当作动态捕获成功；保留现有 Flow JSON capture 合同。prepareCapture 抛错、capture.waitUntil 拒绝或超时均拒绝候选，不进入工程/资源提交。
- **原生浮层旋转，P2**：Flow 静态浮层容器应用正式 rotation，图形内部仍按局部坐标绘制，避免二次旋转。

## 验证结果

| 验证 | 本次结果 |
|---|---|
| `npx tsc --noEmit`、`npx tsc -p tsconfig.e2e.json --noEmit` | 通过 |
| FlowSurfaceHost、Published Runtime Flow、Published Interaction Flow、Published Global Canvas Runtime Mixed 四个目标测试文件 | 42/42 通过；包含普通位置保留、显式重置、失效回调、视频登记/释放、全局隐藏后再显示 |
| Published Interaction Slide 与 Published Global Canvas Runtime Mixed 两个目标文件 | 32/32 通过；与上一行存在重叠，不累计为独立用例数 |
| 真实 Chromium 执行 `runDynamicAdmissionProbe` | 三 Surface 合法 Component 均提交；三 Surface prepareCapture 抛错、Flow 等待拒绝/超时五个候选均失败；revision、工程与资源保持不变，无准入根元素残留。已有 Runtime、stale、缺素材等探针结果仍符合预期 |
| `npm run build:player` | 通过 |
| `npx playwright test tests/e2e/stabilizationCoreUsability.spec.ts tests/e2e/publishedRuntimeFlowV2.spec.ts --grep 'Flow review:|离线便携单 HTML'` | 2/2 通过：真实录制视频实际播放、教师控制器静音、两次离场/返回、正文与浮层计数保留、条件浮层增删、重播与销毁；离线单 HTML 的 Flow Runtime 真实指针点击 |
| 真实 Flow 呈现检查 | 浏览器中检查了文字 +30° 与矩形 -20° 的实际旋转；截图在本地 `tmp/flow-rotation-final.png`，不作为版本制品 |
| `git diff --check` | 通过 |

JSDOM 的 media/canvas 未实现提示不作为实际播放证据；真实视频行为由 Chromium 探针覆盖。未运行完整 Vitest、完整 Electron E2E、PDF/DOCX/PPTX 全格式回归。本次自动化仅为 engineering candidate。

## 尚未实现的同步故障隔离

当前动态准入仍在编辑器 document 的 JavaScript 线程执行。Promise.race 与 capture deadline 只能约束异步等待，不能抢占同步长任务/死循环。本次未把这点宣称为已修复。

已在 [1.7 路线](../roadmap/1.7/README.md) 的 `r17-012-host-smoke-admission` 边界补充要求：自动生成动态候选准入开放前，确定并验证独立、可终止的候选执行载体；候选卡死时编辑器输入、取消和保存仍能响应，终止/迟到结果不得提交。优先评估复用 Published 宿主的独立执行进程，不扩大正常课堂同宿主设计或建设通用权限平台。
