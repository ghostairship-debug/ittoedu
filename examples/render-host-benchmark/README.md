# 渲染宿主过渡基准

这是一份可重复生成、完全离线的课件工程，用于回答一个具体问题：编辑器不应把 DOM、Phaser 或 Three.js 中的任何一个当成业务核心，而应让 Course Project V9 JSON 根据内容职责选择最小的渲染增强层。组件路径统一使用 Component API 4，并分别覆盖 DOM 与 Phaser 渲染面。

当前目录并存两代交付：`project-v9.json`、`render-host-benchmark-v9.h5lesson`、`published-v2.json` 与 `render-host-benchmark-v2.html` 是当前 V9 / Published V2 基准；无后缀的 Project V8 文件仍由 release verifier 消费，作为冻结兼容输入保持原字节与原行为，不代表产品继续创作 V8。

基准刻意把五类能力分成五页，便于直接比较编辑边界、运行时能力、组件复用价值和兼容成本。

| 场景 | 承载方式 | 要验证的结论 |
| --- | --- | --- |
| 01 纯原生节点 | 工程内文字与图形 | 稳定、高编辑需求内容不需要 runtime |
| 02 Runtime API 2 Phaser runtime | `renderMode: phaser` | 只用一次的粒子/程序动画直接写在场景 runtime 更短 |
| 03 Runtime API 2 Three.js runtime | `renderMode: dom` | Three.js 可预打包进单个 runtime，核心 Player 不需要导入 Three.js |
| 04 Component API 4 DOM 表格 | `renderMode: dom` 组件 | 高复用、需结构化编辑的表格适合组件化 |
| 05 Component API 4 Phaser 仪表 | `renderMode: phaser` 组件 | 同一组件合同可按效果选择 Phaser 渲染面 |

## 文件结构

```text
render-host-benchmark/
├── README.md
├── THIRD_PARTY_NOTICES.md
├── THIRD_PARTY_NOTICES_V9.md
├── project.json
├── project-v9.json
├── published-v2.json
├── runtimes/
│   ├── phaser-runtime.js
│   ├── three-runtime.entry.ts
│   └── three-runtime.js
├── components/
│   ├── editable-table/          # V4 DOM + props.content
│   └── phaser-meter/            # V4 Phaser 组件夹具
├── assets/*-fallback.svg
├── render-host-editable-table.h5component
├── render-host-phaser-meter.h5component
├── render-host-benchmark.h5lesson
├── render-host-benchmark.html
├── render-host-benchmark-v9.h5lesson
└── render-host-benchmark-v2.html
```

`three-runtime.entry.ts` 在构建时从精确锁定的开发依赖 Three.js `0.185.1` 导入，Vite 把两者卷成一个不含 `import` / `export` / `require` 的 IIFE。该 IIFE 直接注册 `CoursewareRuntime.define(...)`，再被内联到 `project.json`、`.h5lesson` 和单 HTML。编辑器和 Player 源码不导入 Three.js，没有 3D 的课件不付费。

本例使用程序几何，因此没有将 GLB 伪装成工程图片素材，也没有扩展 Project V8 的 `AssetKind`。未来使用离线 GLB 时，一次性小模型可跟随 runtime 打包，高复用模型应作为组件包内部素材；只有需要教师从工程“媒体”管理中独立替换模型时，才应设计新的一等模型素材协议。

## 生成

在项目根目录执行：

```powershell
npm run build:render-benchmark
npx vitest run tests/integration/renderHostBenchmark.test.ts
npx playwright test tests/e2e/render-host-benchmark.spec.ts
```

最后一项依赖第一项已生成的 Player 与基准产物。它在真实浏览器中执行交互、确定性 WebGL 捕获和 25 轮压力切换；若只需重新生成夹具，可单独运行 `npm run build:render-benchmark:fixture`。

构建脚本会完成下列门禁：

1. 核对安装的 Three.js 必须与 `package.json` 中精确版本 `0.185.1` 一致且许可证为 MIT，再与 3D 入口打成 IIFE，并确认源码小于 2 MiB、不含外部模块语法；
2. 执行 Phaser / Three runtime 的注册段，确认均注册 Runtime API 2；
3. 解析 V4 DOM 和 V4 Phaser manifest，并执行两份组件注册段；
4. 使用真实 V9 factory、Slide authoring command 与组件 import API 生成五页 Course Project V9；
5. 生成 V9 `.h5lesson` 后用当前 archive API 重新打开，核对五页、两份 runtime 和两份组件；
6. 用 Published V2 producer 和当前 Player Bundle 生成不依赖网络的 V2 JSON 与单 HTML，同时校验冻结的 V8 文件未被改写。

Three.js 的 MIT 许可证和版本信息分别位于 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 与 [`THIRD_PARTY_NOTICES_V9.md`](THIRD_PARTY_NOTICES_V9.md)。转发对应生成产物时应同时保留通知。

## 实际互动验收

以下步骤只以当前 V9 / Published V2 产物为验收入口；`render-host-benchmark.h5lesson` 与 `render-host-benchmark.html` 仅作为 release verifier 使用的冻结 V8 兼容输入，不参与当前产品验收。

1. 用编辑器打开 `render-host-benchmark-v9.h5lesson`，确认左侧有五个场景，且第一页只有可直接选择的原生节点。
2. 第二页进入“当前位置试运行”，点击轨道左/右侧；确认行星相位改变、状态文字更新。
3. 第三页拖动地球并滚动鼠标滚轮；确认视角和距离变化，“恢复视角”能回到确定状态。
4. 第四页点击表格行、排序和恢复按钮；回到编辑模式修改组件 `props.content` 文案，确认预览更新。
5. 第五页点击 V4 Phaser 仪表盘不同位置；确认指针和计数文案更新，且单个组件不影响其他场景。
6. 快速往返切换第二/三/四/五页 25 轮并在每轮重播末页（100 次切页、25 次重播），观察浏览器性能面板；确认不累积 RAF、DOM 监听、Phaser `update` 监听或 WebGL 上下文。
7. 执行 PDF/PPTX 静态导出；确认 Three runtime 在 `prepareCapture()` 中主动渲染确定帧，V4 表格在捕获时固定高亮首行；Three runtime 捕获失败时使用登记的 SVG `staticFallback`，组件捕获失败时显示带名称的诊断占位。
8. 打开 `render-host-benchmark-v2.html` 重复 2–5 步，确认无 CDN、远程模型或其他网络请求。

自动化 E2E 会实际完成 25 轮第二至第五页切换和末页重播，即 100 次切页、25 次重播；结束时断言没有遗留 runtime/component mount 或 runtime Canvas，活动 RAF 数未持续增长，并检查无外部请求、页面异常和控制台错误。DOM 监听器数量和浏览器 WebGL 上下文回收仍应按第 6 步用性能工具人工复核。

## 生命周期与静态捕获

- Phaser runtime 在 `destroy()` 中解除点击与 Scene `update` 监听，并销毁自己创建的容器；
- Three runtime 区分 `setVisible` 与 `suspend/resume`，`prepareCapture()` 主动设置确定状态并渲染一帧；宿主随后立即复制画布，验证默认 `preserveDrawingBuffer: false` 的稳定捕获；
- Three runtime `destroy()` 取消 RAF，解除全部 DOM/WebGL 监听，释放 geometry、material、texture、render list 和 renderer，最后主动丢失 WebGL 上下文；
- V4 DOM 组件把字体就绪任务登记到 `capture.waitUntil()`，捕获前恢复确定排序与高亮状态，销毁时解除事件并清空 Shadow DOM 宿主；
- V4 Phaser 组件与 DOM 组件使用同一生命周期和捕获合同，只暴露各自声明的渲染面。

这份基准是架构与回归夹具，不是对所有教学内容的通用模板。真实课件仍应先按教学策划拆分稳定状态、简单声明式互动、一次性运行时和高复用组件。
