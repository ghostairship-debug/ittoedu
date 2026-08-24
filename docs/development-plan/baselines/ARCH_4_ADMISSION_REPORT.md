# ARCH-4 Delivery 与 Legacy consumer 必要性准入报告

> 日期：2026-08-24（Asia/Shanghai）
>
> 产品基线：`36a92f8`；其后只新增本次 admission claim
>
> 决策规则：格式必须有合法 V9 用户路径上的可复现错误或可删除 consumer；renderer artifact 与 Electron readiness 必须一起成立

## 1. 结论

| 候选域 | 当前问题 | 决定 | 实现卡 |
|---|---|---|---|
| V9 HTML/Web preflight | 合法 V9 仍先分析 V8 projection，保存报告仍写 `schemaVersion: 8` | admit | `arch-4-01` |
| 非纯 Slide V9 PDF | Flow-only/Mixed 回退或使用不完整 image HTML；Mixed 可静默漏 Surface | admit | `arch-4-02` |
| source-null Preview/HTML/Web | 正常 UI 无法形成三个 V9 source 全空 | skip | 0 |
| pure Slide PDF/PPTX | Legacy raster/snapshot 仍比当前 Published semantic/capture 接线完整 | retained | 0 |
| Spatial-only PDF | 现有每镜头 SVG image 覆盖完整 | retained current path | 0 |
| DOCX | 已走 Flow-native `buildFlowDocx`，无 V8 fallback | retained | 0 |
| Project Health、fixtures、release | 仍有明确诊断/兼容 owner，没有已选 replacement | retained | 0 |
| `validateProjectArchiveBytes` | source 定义 `1`，incoming production/test reference `0` | ARCH-5 deletion candidate | 0 |

两张实现卡都写 `App.tsx`，必须串行。第一张只修预检输入/报告；第二张在第一张完成后修 PDF artifact、App 路由与 Electron readiness。两者不修改 Published producer、Schema/contracts、Store、Player、PPTX、DOCX 或 IPC shape。

## 2. HTML/Web：准入 V9-native preflight 报告

### 2.1 可复现当前路径

`App#handleExport` 对非 DOCX 格式无条件先调用：

```text
collectExportPreflight(state.project)
→ collectCoursePackageExportPreflight(sources.project)
→ mergeCoursePackagePreflight(base, v9)
```

`state.project` 是固定 `schemaVersion: 8` 的 `ProjectDocument`。merge 返回 `{ ...base }`，因此合法 V9 的单 HTML/网页包预检 JSON 仍报告 `schemaVersion: 8`；该 JSON 可由 UI 保存，是用户可见的错误来源，不只是命名债务。

准入 `arch-4-01-v9-html-web-preflight`：合法 V9 且 target 是 `single-html` 或 `web-package` 时，只把现有 Course Package V9 preflight 映射为 `ExportPreflightReport`；其他格式和 source-null 分支保留旧 base/merge。`ExportPreflightReport.schemaVersion` 仅放宽为 `8 | 9`，不改 report version/shape。

Exact delta：

- 合法 V9 HTML/Web 两条 route → V8 collector `2 → 0`；
- 每次上述导出执行 V8 collector `1 → 0`，V9 package collector保持 `1`；
- 可保存报告 schema `8 → 9`；
- App 内旧 collector import/call 与仓库 `21` 个文本引用仍因 PDF/PPTX/retained paths 存在，不宣称 LEG-006 删除。

这张卡不承诺 V8 layout/health/network heuristics 的逐项等价；它承诺现有 V9 package preflight 的发布闭包、组件哈希、资源字节和 Player bundle 阻断。未来缺失的 V9-native heuristic 只有在真实风险出现时另行准入。

## 3. PDF：准入非纯 Slide 全 Surface 完整性

### 3.1 当前结果矩阵

| 课程形态 | 当前 Published `pdf-html` | App 实际行为 |
|---|---|---|
| Flow-only | 无 | 回退 V8 raster，无法可靠表达 Flow |
| Spatial-only | 每镜头一张 SVG image | 覆盖完整，可保留 |
| Slide-only | 无（App 未提供 Published capture） | 回退现有 Slide raster，可保留 |
| Mixed、无 Spatial | 无 | 回退 V8 raster，Flow 可遗漏 |
| Mixed、含 Spatial | 只有 Spatial images | 直接导出并静默遗漏 Slide/Flow |

两个实现约束使“直接把 mixed HTML 标为 pdf-html”不可行：

1. `buildMixedPrintDocumentHtml` 当前把 `renderFlowPrintHtml()` 的完整 `<!doctype><html><body>` 嵌入另一个 document；
2. `src/main/pdfExport.ts#waitForPrintableDocument` 要求 `.page >= 1` 且 image 数等于 page 数，合法语义 Flow/Mixed HTML 会被拒绝。

准入 `arch-4-02-non-slide-v9-pdf-completeness`，用户行为为：合法 V9 非纯 Slide 课程按 `mixedPrintPlan` 覆盖全部 Slide/Flow/Spatial 页面，绝不回退到只能表达 Slide 的 V8 raster；纯 Slide 保留高保真 raster。

最窄规则：

1. 计划页全部已有 image capture 时继续用 image-based PDF HTML，Spatial-only 因此保持现状；
2. 含非 Slide 页面且 image coverage 不完整时，使用合法 mixed semantic HTML 作为 `pdf-html`；
3. 每个逻辑页有 `.page`，Flow 复用 body fragment，禁止嵌套第二个 document；
4. pure Slide 缺 Published capture 时仍不生成 Published `pdf-html`，App 走现有 raster；
5. Electron readiness 只要求至少一个 `.page` 且所有实际 images 完成解码，不再假设每页恰好一张图；
6. 非纯 Slide 若仍缺 `pdf-html`，App 显式报“PDF 导出不完整”，不调用 V8 renderer 或 export API。

Main 打印错误直接沿用现有可见错误，不触发第二次 Legacy 回退。Source-null defensive branch保持不变。

## 4. Retained / skip 边界

- Source-null：Store 初始化、新建三 Surface、V9 open 和 clear candidate 都会安装/重建至少一个 V9 source；未发现合法 UI 能让 Slide/Flow/Spatial source 同时为空。未来若新增清空所有 session 的真实入口，再重审。
- Pure Slide PDF：Published semantic HTML 对非文字图层仍可能只有 ID 占位，旧 raster 当前更完整。
- Pure Slide PPTX：旧 `buildPptx` 自动捕获 Component/Runtime；Published PPTX 依赖 App 提供 `captureDynamicItem`，当前没有。
- DOCX：Flow-native，无本卡要移除的 Legacy fallback。
- Project Health / V8 toolbar、fixtures/release：仍有 owner 和兼容用途，不因名称或阶段标题迁移。

固定盘点命令在 `src/** scripts/** tests/** examples/**` 的当前文本引用数仍为：`buildExportPayload=23`、`buildPptx=12`、`collectExportPreflight=21`、`collectProjectHealth=38`、`openProjectArchive=47`、`createProjectArchive=56`、`createProjectV8Fields=17`、`validateProjectArchiveBytes=1`。最后一项只有定义，进入 ARCH-5 八问删除门禁；其他项不以总引用归零为目标。

## 5. 顺序、验证与阶段门

1. `arch-4-01` 先串行修改 App preflight，并用新 App integration、现有 course package unit 和 root TypeScript 验证；
2. `arch-4-02` 基于其 product HEAD 再修改 App/PDF artifacts/main readiness，用 print artifact unit、新 App PDF integration、root renderer TypeScript 与 Electron TypeScript 验证；
3. ARCH-4 gate 复用两卡证据，只补一次真实 Mixed PDF：实际走桌面 `exportPdf`，核对三 Surface 可见、page list 顺序、无明显裁切/空白/遗漏、无 Flow runtime TOC；保存渲染页/截图证据；
4. 阶段门再做 exact consumer delta、combined TypeScript（仅在第二卡证据被后续改动失效时）、一次 repo-index/task-board freshness 与 diff hygiene。

不运行完整 unit、完整 Electron E2E、desktop build、性能或三份代表工程矩阵；本阶段的输出变化只需要一个目标 Mixed PDF 真实复核。
