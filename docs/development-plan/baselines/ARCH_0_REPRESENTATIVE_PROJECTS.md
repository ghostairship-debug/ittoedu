# ARCH-0 Course Project V9 代表工程基线

> 状态：`target-green / engineering fixture evidence`
>
> 任务：`arch-0a-rep-00-v9-representative-projects`
>
> Claim commit：`090aa11590baee19cf183a1674e4e8bbf72837ef`
>
> 固定归档时间：`2026-08-24T00:00:00.000Z`

本基线固定三份由当前 Course Project V9 合同和归档器直接生成的代表工程。它们不是将既有约 2 KB 的单能力 fixture 改名，也不包含 Project V8 根字段或迁移标记。

## 1. 可重复生成

```powershell
npx tsx scripts/build-architecture-baseline-fixtures.ts
npx tsx scripts/build-architecture-baseline-fixtures.ts --check
```

`--check` 在内存中重建全部归档和 `manifest.json`，逐字节对比现有文件，不修改工作树。严格生成物不写入 HEAD、当前时间、绝对路径或机器信息。

## 2. 归档与哈希

| 代表工程 | 字节 | SHA-256 | 主要用途 |
|---|---:|---|---|
| `tests/fixtures/architecture-baseline/slide-heavy.h5lesson` | 7,050 | `101b8e8186e1fbadbf9f083e5d3273eee9f1166fa3028478f290497537274a7b` | Slide 状态、统一图层、图片/声音、组件、Canvas Runtime、控制器、互动和静态导出输入 |
| `tests/fixtures/architecture-baseline/flow-heavy.h5lesson` | 5,358 | `326b1c29d72358d01373af26cbc6f97f396a34ce40e0e057079bbdcd76beeea0` | 语义块、富文本/IME 探针内容、公式、表格、代码、媒体、Section 和 FlowComponentBlock |
| `tests/fixtures/architecture-baseline/mixed-spatial.h5lesson` | 6,583 | `939a0d5520fe21a6608a4cb11b8487f87d223a1da15286965803eb4e2aaa66df` | Slide/Flow/Spatial、global/surface shared/controller、镜头、路径、关系、语义缩放、组件和 Surface Runtime |

机械可读矩阵位于 `tests/fixtures/architecture-baseline/manifest.json`。

## 3. 能力矩阵

| 要求 | Slide-heavy | Flow-heavy | Mixed/Spatial |
|---|---|---|---|
| 合法 Schema 9，完整 sidecar/component bytes | 是 | 是 | 是 |
| Presentation states / 统一 global-surface-scene order | 是 | 不适用 | Slide 子集 + 三 Surface 有效层 |
| 媒体 | PNG + 可解码 PCM WAV | Flow image block | Slide/Flow 图片 + Runtime asset |
| Component API 4 | Slide ComponentLayerItem | FlowComponentBlock | Spatial ComponentLayerItem |
| Runtime | Canvas Runtime API 2 + scene fallback | 不适用 | Surface Runtime API 3 + surface fallback |
| 教师控制器 / Player 导航输入 | global controller + 4 locations | 3 Flow locations | global controller + 4 Mixed locations |
| 静态导出输入 | 3 scenes + component/runtime fallback | Flow print/DOCX blocks | explicit mixedPrintPlan，含 2 Spatial frames |
| Spatial camera/path/relation | 不适用 | 不适用 | 是 |

Flow 工程中的组件保持为 `FlowComponentBlock`；只有 Flow 视口浮层使用 `surfaceLayerItems` 中的 `LayerItem`。

## 4. 目标验证结果

2026-08-24 在 Node `v24.14.0` / Windows x64 执行：

```powershell
npx tsx scripts/build-architecture-baseline-fixtures.ts --check
npx vitest run tests/unit/architectureBaselineFixtures.test.ts
npx tsc --noEmit
npm run --silent validate:course-project -- tests/fixtures/architecture-baseline/slide-heavy.h5lesson
npm run --silent validate:course-project -- tests/fixtures/architecture-baseline/flow-heavy.h5lesson
npm run --silent validate:course-project -- tests/fixtures/architecture-baseline/mixed-spatial.h5lesson
```

结果：

- deterministic check：4/4 输出逐字节一致；
- focused unit：4/4 通过；
- root TypeScript check：通过；
- 三份工程：全部 `status=valid`、`schemaVersion=9`、`error=0`、`warning=0`；
- single HTML、web package、PDF 和 PPTX preflight：三份工程均 `canExport=true`；
- 归档解包后的 `project.json` 均无 `scenes` / `globalRuntime` / `globalNodes` V8 根字段。

## 5. 结论边界与后续证据

当前证明三份代表输入是可重建、可打开、合同合法且可通过导出预检的 engineering fixtures。它们不自动证明：

- 真实编辑器中的打开→修改→撤销/重做→保存重开；
- 真实 CoursePlayer 中的三 Surface 播放、媒体解码和组件/Runtime 挂载；
- Flow 实际 IME composition 事件、焦点和选区语义；
- HTML/Web/PDF/PPTX/DOCX 真实写出的可见结果；
- 性能阈值、`art candidate` 或产品 `accepted`。

上述项由后续 ARCH-0A 性能/手工流程基线和各产品代码阶段门禁补足。
