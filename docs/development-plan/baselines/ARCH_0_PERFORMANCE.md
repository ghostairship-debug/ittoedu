# ARCH-0 功能与性能基线

> 状态：`target-green / bounded engineering baseline`
>
> 任务：`arch-0a-perf-00-test-and-performance-baseline`
>
> Claim commit：`1899deb33eb9b7cef13a3ad2ccbe1018d5eca171`
>
> 证据日期：`2026-08-24`

本文固定后续产品代码迁移使用的同机功能和性能参照。它分开报告 pipeline、functional 和 outcome；任何自动化、截图或性能数字都不产生 `accepted` 结论。

## 1. 固定协议

### 环境

- Windows 11 Home China `10.0.26200` / x64；
- Node `v24.14.0`；
- Intel Core Ultra 9 285H，16 逻辑核；
- 物理内存约 `31.5 GiB`；
- 不记录主机名、用户名或绝对路径。

### 样本

| Fixture | SHA-256 | 字节 |
|---|---|---:|
| `tests/fixtures/architecture-baseline/slide-heavy.h5lesson` | `101b8e8186e1fbadbf9f083e5d3273eee9f1166fa3028478f290497537274a7b` | 7,050 |
| `tests/fixtures/architecture-baseline/flow-heavy.h5lesson` | `326b1c29d72358d01373af26cbc6f97f396a34ce40e0e057079bbdcd76beeea0` | 5,358 |
| `tests/fixtures/architecture-baseline/mixed-spatial.h5lesson` | `939a0d5520fe21a6608a4cb11b8487f87d223a1da15286965803eb4e2aaa66df` | 6,583 |

### 采样

- Node 计时：`performance.now()`；
- 每项 5 次 warmup + 21 次 measured sample；
- Median：排序后中位数；P95：nearest-rank；
- 所有数字只能与同机、同 fixture hash、同 Node 主版本和同采样数的后续结果比较；
- Electron 数值是隐藏窗口下的单次就绪观察，不与 Node median/P95 混合；
- HTML/Web 使用当前已存在但未纳入 Git 的 `dist-player/player.iife.js`，其 pipeline freshness 为 `unknown`，不用它宣称当前构建已验证。

重复命令：

```powershell
npx tsx scripts/measure-architecture-baseline.ts --samples=21 --warmup=5
npx vitest run tests/integration/architectureBaselineFlows.test.tsx
```

本地原始样本、导出结果和 Electron 证据位于 `output/architecture-baseline/`，该目录被 Git 忽略。

## 2. Node median / P95

单位均为 ms。

| Fixture | Operation | Median | P95 |
|---|---|---:|---:|
| Slide-heavy | archive open | 1.230 | 2.176 |
| Slide-heavy | archive save + reopen | 3.546 | 5.278 |
| Slide-heavy | validation + export preflight | 3.933 | 5.626 |
| Slide-heavy | Published V2 build | 1.588 | 2.917 |
| Slide-heavy | standalone HTML build | 5.909 | 7.578 |
| Slide-heavy | web-package ZIP build | 37.890 | 50.419 |
| Flow-heavy | archive open | 0.454 | 1.361 |
| Flow-heavy | archive save + reopen | 2.111 | 2.678 |
| Flow-heavy | validation + export preflight | 1.916 | 3.129 |
| Flow-heavy | Published V2 build | 0.669 | 0.875 |
| Flow-heavy | standalone HTML build | 4.787 | 6.446 |
| Flow-heavy | web-package ZIP build | 54.930 | 79.038 |
| Mixed/Spatial | archive open | 1.594 | 1.761 |
| Mixed/Spatial | archive save + reopen | 5.677 | 6.515 |
| Mixed/Spatial | validation + export preflight | 5.082 | 8.133 |
| Mixed/Spatial | Published V2 build | 2.998 | 4.142 |
| Mixed/Spatial | standalone HTML build | 9.478 | 10.883 |
| Mixed/Spatial | web-package ZIP build | 77.044 | 91.272 |

| Cross-cutting operation | Median | P95 |
|---|---:|---:|
| Slide transform + undo + redo | 2.498 | 2.851 |
| Flow apply-text + undo + redo | 0.408 | 0.569 |
| Mixed 顺序切换全部 4 个 Published location | 2.131 | 2.949 |
| Flow DOCX build | 1.939 | 2.254 |

后续回归检查规则：在完全相同协议下连续两次出现以下任一情况时进入调查，而不是立即删减能力：

- median 高于 `max(基线 × 1.25，基线 + 1 ms)`；
- P95 高于 `max(基线 × 1.35，基线 + 2 ms)`；
- 任何功能状态由 green 变 red。

## 3. 一次实际导出生成

`buildCoursePptx` 和 `buildCoursePrintArtifacts` 在 21 次性能采样外各执行一次。

| Fixture / target | Status | 真实结果 | 结论 |
|---|---|---|---|
| Slide-heavy PPTX | `green-with-fallback-warnings` | 3 slides，63,455 bytes；`output/architecture-baseline/exports/slide-heavy/slide-heavy.pptx` | Runtime 与 Component 使用作者静态 fallback；0 report error |
| Mixed/Spatial PPTX | `red` | 3 slides，56,133 bytes；`output/architecture-baseline/exports/mixed-spatial/mixed-spatial.pptx` | PptxGenJS 对 2 个 Spatial SVG 页报 `Image data lacks a base64 header`；文件存在不等于结果可靠 |
| Slide-heavy print artifacts | `green-partial` | 3 pages，1 份 mixed print HTML | 无 Slide capture provider，3 个 Slide PDF 图像均明确 warning/skip |
| Flow-heavy print artifacts | `green` | 1 page，print HTML + DOCX；DOCX 5,099 bytes | 0 error / 0 warning；公式使用解释性 OMML text fallback |
| Mixed/Spatial print artifacts | `green-partial` | 4 pages，print HTML + Spatial PDF HTML + Flow DOCX | Slide 页因无 capture provider 明确 warning/skip；Spatial/Flow 产物已生成 |
| OS PDF `printToPDF` | `unknown` | 本任务未接管原生保存对话框 | 不用 print HTML 或 preflight 冒充 PDF 文件 |

完整 files/pages/report/warnings 在 `output/architecture-baseline/node-measurements.json` 的 `oneShotExports` 中。

## 4. Electron + CDP 单次可见证据

Electron 使用隐藏窗口和临时 profile 启动，通过 agent-browser 连接 CDP。原生打开对话框未被自动操作；三份工程由临时“最近工程”种子经正式 IPC 读取，种子在会话后删除。

| 操作 | 单次就绪时间 | Functional |
|---|---:|---|
| 打开 Slide-heavy | 716.8 ms | green |
| 打开 Flow-heavy | 1,120.5 ms | green |
| 打开 Mixed/Spatial | 2,552.5 ms | green |
| Mixed Slide → Flow | 625.8 ms | green |
| Mixed Flow → Spatial | 1,948.4 ms | green |
| Slide 当前位置 Preview mount | 706.9 / 1,218.3 ms | green，两次单次观察 |
| Slide Preview destroy | 1,282.0 ms | green |
| Flow Preview mount | 986.2 ms | green |
| Flow Preview destroy | 588.7 / 788.7 ms | green，两次单次观察 |
| Spatial Preview mount | 597.4 ms | green |
| Spatial Preview destroy | 566.7 ms | green |

最终读取的 renderer console errors = 0，page errors = 0，未观察到外部网络请求。Flow 和 Spatial Preview 的两次 screenshot 命令在自动化工具中超时，但 DOM readiness、可访问树和 mount/destroy 证据已成功；超时不记为产品错误。

可见截图：

- `output/architecture-baseline/electron-slide-heavy.png`；
- `output/architecture-baseline/electron-slide-preview.png`；
- `output/architecture-baseline/electron-flow-ime-editor.png`；
- `output/architecture-baseline/electron-mixed-slide.png`。

截图只证明 mount、可达性和 Flow IME 编辑态。截图中放大的 1px fixture 图片、静态 fallback 和 Flow 底部排版仅是 engineering fixture 证据；视觉质量仍待产品复核，不是 art/outcome accepted。

## 5. 必要操作状态

| Required operation | Status | Evidence / boundary |
|---|---|---|
| 新建 | `unknown` | 本基线固定现有样本，未执行新建后保存 |
| 打开 | `green` | 3/3 archive API + 3/3 隐藏 Electron 真实 IPC |
| 保存→重开 | `green` | 3/3 `createCourseProjectArchive` → `openCourseProjectArchive`，内容/sidecar/component bytes 一致 |
| 原生保存/另存为 | `unknown` | 不伪造原生文件对话框，不改写 fixture |
| undo / redo | `green` | Slide transform 和 Flow text 均是一次提交、一次撤销、一次重做 |
| 切 location | `green` | Mixed Published navigator 4/4；Electron Slide→Flow→Spatial 可见 |
| 拖拽提交 | `green` at command boundary / `unknown` trusted pointer | Slide transform 一次命令产生一条 history；未用非 trusted 事件冒充真实鼠标拖拽 |
| Flow IME | `green` synthetic protocol / `unknown` real OS IME | 代表 fixture 上 composition 期间不提交，end + blur 后提交；Electron 编辑器可见；真实系统输入法未自动化 |
| Preview mount / destroy | `green` | Flow integration host + Slide/Flow/Spatial 真实 Electron 当前位置试运行 |
| HTML / Web | `green with pipeline provenance unknown` | 真实 standalone HTML 和 ZIP bytes；Player bundle freshness 未由本任务构建门证明 |
| DOCX | `green` | Flow-heavy 和 Mixed Flow 都产生真实 DOCX bytes |
| PPTX | Slide `green-with-fallback-warnings`; Mixed `red` | 见“一次实际导出生成” |
| PDF | `unknown` | print HTML/Spatial PDF HTML 已生成，本任务未执行 OS `printToPDF` |

## 6. Mixed / history 观察

Mixed/Spatial 在同一 Slide session 内连续提交 50 次 transform：

- history depth：50；
- 本次观察 heap delta：`+25,675,952 bytes`；
- 没有强制 GC，所以该 delta 只是定性起点，不是泄漏结论或阈值；
- 后续必须使用同一脚本和相同提交数比较。

## 7. 分层结论

### Pipeline

`partial / current full pipeline unknown`。三份 V9 校验、专用 integration、root TypeScript 和本任务脚本通过；没有运行全量 verify、完整 E2E、桌面重建或打包。

专用 Flow integration 在 jsdom 中会打印现有 React 警告：`key` 被包含在 props 对象中再 spread 到 JSX。测试仍为 5/5 green，但该警告不是绿色产品结论，也没有在基线卡中顺手修改 `FlowWorkspace` 热点；它作为后续 Flow/UI 模块化 finding 保留。

### Functional

`green-bounded with one explicit red and several unknowns`。归档往返、历史、Mixed 切换、当前位置试运行和 HTML/Web/DOCX 主证据为 green；Mixed/Spatial PPTX 为 red；原生 Save As、真实 OS IME、trusted pointer 和 OS PDF 为 unknown。

### Outcome

`engineering fixture evidence only`。截图可复核，但 fixture 视觉质量和静态 fallback 不是 art candidate；本任务不宣称产品可用、发布就绪或 `accepted`。
