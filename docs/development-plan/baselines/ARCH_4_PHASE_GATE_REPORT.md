# ARCH-4 Delivery 与 Legacy Consumer 阶段门报告

> 日期：2026-08-24（Asia/Shanghai）
>
> 合并产品候选：`c49330c`；后续任务状态提交未改变产品源码
>
> 结论：`pass / engineering candidate`

## 1. 结论

ARCH-4 只迁移了两个有当前合法 V9 用户风险的交付点，并保留仍有真实职责的 Legacy：

- 合法 V9 单 HTML / Web Package 预检不再先分析 V8 projection，保存报告使用真实 `schemaVersion: 9`；
- Flow-only、Spatial-only 与 Mixed PDF 现在要么取得覆盖完整有序 page plan 的 Published artifact，要么明确失败；非纯 Slide 不再静默回退到可能漏内容的 V8 raster；
- pure Slide raster、source-null defensive path、PPTX、DOCX、Project Health、fixtures/release 等仍有 owner 的路径保持；
- 阶段门只生成了一次真实 Mixed Electron PDF。它是 3 页 `surface-native` 16:9 文档，按 Slide → Flow → Spatial 顺序完整包含三类内容，无空白尾页、边缘裁切或运行态目录。

Pipeline 为 green；阶段结论是 engineering candidate。实际 Slide 页的两段文字重叠来自门禁夹具中两个 LayerItem 完全相同的作者坐标，不是分页/缩放遗漏；因此本报告不把自动化产物升级为 `art candidate` 或教师 `accepted`。

## 2. 实现与复用证据

| 任务 | 产品提交 | 行为 delta | 当前最小验证 | 独立审查 |
|---|---|---|---|---|
| V9 HTML/Web preflight | `24212d7` | 两条合法 V9 route 的 V8 collector runtime calls `1 → 0`；保存 schema `8 → 9` | App integration + package unit：`2 files / 5 tests`；root TypeScript | APPROVE |
| 非 Slide PDF 完整性 | `a887469` | complete image coverage 才选 image PDF；否则非纯 Slide 选完整 semantic document；缺件 fail closed | print unit + App integration：`2 / 6`；root + Electron TypeScript | APPROVE |
| Mixed 物理页盒 | `c49330c` | 未指定 paper box → 按 A4/Letter/`surface-native` + orientation 明确页盒；Slide/Spatial fit；Flow 可续页 | 受影响 unit + real-builder App integration：`2 / 6`；root TypeScript | APPROVE |

第二次 `2 / 6` 是 `c49330c` 修改 artifact builder 后对失效证据的替代结果，不是把同一候选重复验证。Electron main/config 在页面适配 retry 中未变化，复用 `a887469` 的 Electron TypeScript。

`24212d7` 后的 `App.tsx` 变化只落在 PDF artifact/readiness 分支；combined-head 静态复核确认 HTML/Web 的 V9 preflight mapping 与零 Legacy collector 调用仍保持，因此无需重复其 focused suite。

## 3. 唯一一次实际 Mixed Electron PDF

### 3.1 真实路径

使用临时独立 Playwright spec 打开仓库现有合法夹具 `tests/fixtures/course-project-v9/mixed.h5lesson`，实际执行：

```text
Electron production renderer
→ 打开 V9 archive
→ UI PDF 导出预检（0 个错误）
→ 继续导出
→ renderer artifact
→ preload/IPC
→ main hidden BrowserWindow
→ waitForPrintableDocument
→ Chromium printToPDF
→ native save writer
```

只构建当前需要的 `build:renderer` 与 `build:electron`；Player source 未改，复用现有 bundle。目标 Playwright `1 test / 1 passed`，无 page error、console error 或外部网络请求。临时 spec 已删除，因而最终 V4 不会把这次一次性实物门禁重复运行。

### 3.2 产物与机器检查

- PDF：`output/pdf/arch-4-mixed-surface.pdf`
- 大小：`27,799` bytes；header `%PDF-`；SHA-256 `DAF12E21D503D224913533C23C87DF62D110A2FE6709F162E00FE6AEA9DB8653`
- Chromium / Skia PDF 1.4；`3` 页；每页 `960 × 540 pt`，对应含 Slide 的 `surface-native` 1280×720 CSS px
- Pypdf 文本顺序：
  1. `Mixed 起始页`、`表面共享`
  2. `讲义`、`讲义标题`、`同一工程内的流式页面。`
  3. `空间节点`
- 全文不含 `flow-runtime-toc` 或 `打开目录`。

### 3.3 全页渲染与视觉复核

按 PDF skill 使用 bundled Poppler `pdftoppm -png -r 144` 把全部三页渲染到 `tmp/pdfs/`，逐页以原始分辨率检查。三页 PNG 均为 `1920×1080`、非空，非白内容边界分别为：

| 页 | Surface | non-white bbox | 视觉判断 |
|---:|---|---|---|
| 1 | Slide | `(60,64)–(210,89)` | 两个文本层均存在且未触边；夹具作者把二者都放在 `(40,40,520,80)`，所以叠字是输入内容事实 |
| 2 | Flow | `(85,110)–(333,320)` | 标题与正文顺序清楚、四周有留白、无目录 chrome |
| 3 | Spatial | `(1016,596)–(1756,711)` | 1120×760 viewBox 内容完整落入 16:9 页盒，节点框未裁切 |

没有额外页、空白页、边缘触碰、被截断的 Surface 或第二个嵌套 document。视觉证据证明本阶段目标“交付完整性”成立；它不评价夹具本身的版式美术质量。

## 4. 精确 consumer / artifact delta

### HTML/Web preflight

- 合法 V9 `single-html` / `web-package`：每次 V8 preflight runtime call `1 → 0`，V9 package preflight保持 `1`；
- source-null：V8 collector 保持 `1`；PDF/PPTX：V8 base + V9 merge 保持；
- App 静态 call sites 因 guarded 分支拆开而不是删除 symbol；同一 `git grep -o` 方法下仓库 `collectExportPreflight` 文本出现数 `21 → 25`，增加项来自新 mapping/integration characterization，不宣称 Legacy symbol 删除。

### PDF

- Flow-only Published `pdf-html`：`0 → 1` complete semantic document；
- Mixed without Spatial：`0 → 1` complete semantic document；
- Mixed with Spatial：partial Spatial-only image selection → complete semantic document；
- Spatial-only：complete SVG image PDF 保持；pure Slide without capture：Published `pdf-html` 仍为 `0`，App raster fallback 保持；
- non-pure-Slide missing artifact 的 V8 raster/export calls：`1 possible path → 0`，改为精确 actionable error；
- main one-image-per-logical-page condition：`1 → 0`；至少一页与所有实际图片 decode 条件保持。

### Retained Legacy snapshot

在 `scripts/**`、`src/**`、`tests/**` 范围内，以同一 `git grep -o` 方法比较 `36a92f8 → combined HEAD`：

| Symbol | occurrences delta | 结论 |
|---|---:|---|
| `buildExportPayload` | `30 → 30` | retained |
| `buildPptx` | `14 → 14` | retained |
| `collectProjectHealth` | `39 → 39` | retained |
| `openProjectArchive` | `47 → 47` | retained |
| `createProjectArchive` | `57 → 57` | retained |
| `createProjectV8Fields` | `17 → 17` | retained |
| `validateProjectArchiveBytes` | `1 → 1` | ARCH-5 deletion candidate；仍只有定义 |

## 5. 验证边界与生成物

- 本阶段复用三组当前候选 focused evidence及其独立 APPROVE；页面适配改动后只重跑其实际失效的 print/App evidence与 root TypeScript。
- 真实输出只运行上述一个 targeted Electron test；没有运行完整 unit、完整 E2E、`build:desktop`、性能或三份代表课件矩阵。
- Task board 与 repo-index 在报告、任务状态固定后各 generate/check 一次；diff hygiene 通过。
- 未修改 Schema/contracts、Published producer、Player、Store、Workspace、Properties、PPTX、DOCX、fixtures、dependencies、capability/semantic/golden facts。

## 6. 状态分层与下一阶段

- Pipeline：green。Focused evidence、目标构建、唯一实际 PDF、全页渲染、task-board/repo-index freshness 和 diff hygiene 均通过。
- Engineering：`engineering candidate / pass`。两个真实 V9 交付缺口已修复，Legacy 保留边界没有为阶段标题强迁。
- Outcome：Mixed PDF 完整性在真实 Electron 路径成立；HTML/Web 保存报告由 App integration 证明使用 V9 identity/schema。fixture-authored Slide 重叠不归因于本阶段导出。
- Art / accepted：未声明。自动化和测试夹具不能代替真实教师对实际课程输出的审美/教学复核。

ARCH-4 关闭后，下一步只启动 ARCH-5 删除必要性准入：先对 `validateProjectArchiveBytes` 与 ARCH-3 的 `appendBlankFlowPage` 做八类删除门禁，再在同一个最终候选上运行一次 V4 完整验证与三份代表课件结果复核。
