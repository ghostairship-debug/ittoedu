# r11-041-pptx-v2-only｜PPTX 只消费 Published V2/capture

- Release / Dependencies: 1.1 / r11-031-published-slide-player, r11-040-v9-health-preflight, r11-050-v9-fixture-foundation
- Write locks: `published-producer`
- Inventory access: read
- Preservation: PM-07–PM-09, PM-13–PM-16, PM-18, PM-22, PM-25

## Outcome / current evidence

PPTX 产品入口只从 Course Project V9 构建匹配 Published V2，再走当前原生对象 producer 与动态 carrier capture；不调用 V8 `buildExportPayload` / `buildPptx`。可编辑文字/公式/图形、媒体与 warning 语义保持。

## Read first

- `src/renderer/App.tsx` 的 PPTX handler
- `src/renderer/export/course/buildCoursePptx.ts`
- `src/renderer/export/buildPptx.ts`
- `src/renderer/export/pptxShared.ts`
- `src/renderer/export/pptxTextAndShape.ts`
- `src/renderer/export/renderPptxComponentSnapshots.ts`
- `src/renderer/export/renderPptxRuntimeSnapshots.ts`
- `tests/unit/coursePptxExport.test.ts`

## Write scope

只允许修改 App PPTX use case、`buildCoursePptx`、`pptxShared.ts`、`pptxTextAndShape.ts`、两项动态 snapshot adapter、PPTX preflight adapter 和三个 listed tests。`pptxShared` 只接收窄 frame/name 或正式 Native render input；`pptxTextAndShape` 从 `contracts/native-v1` 取 Text/Formula/Shape 类型。禁止修改共享 inventory、旧 `pptxImages.ts`/`buildPptx.ts` builder、其他导出、删除 PPTX、把所有内容栅格化、弱化 warning、改变 Published V2 或扩展兼容矩阵。

## Execution

1. 记录当前适用 Surface/carrier 的原生对象、静态捕获和 warning 结果。
2. App 只传递 canonical V9 archive/session input；producer 构建一次 Published V2 并使用 r11-031 capture seam、稳定 identity 与 asset closure，禁止直接调用 `PlayerApp`。
3. Text/Formula/Shape 等可编辑对象继续原生生成；Component/Runtime 使用现有受控 capture 与静态后备。
4. `pptxShared` 删除 `SceneNode` 输入，改用本地窄 frame/name 或 r11-030 render input；`pptxTextAndShape` 直接从 `contracts/native-v1` 取类型，不为旧 builder 保留 projectTypes 兼容输入。
5. PPTX-specific facts 适配 r11-040 finding catalog；unsupported Surface/content 保持诚实 warning/block，不回退到旧 V8 raster path。
6. 删除产品对 legacy PPTX builder/payload 的调用；交接列出 LEG-004 预期减少的 endpoint、replacement 与精确查询，不修改共享 inventory；旧测试/模块留待 r11-052/054。

## Stop conditions

- 当前受支持的可编辑对象必须降为整页图片。
- dynamic capture、素材闭包或 warning 语义不等价。
- 必须恢复旧 payload 才能导出固定课例。

## Acceptance

- PPTX 产品入口无 V8 payload/Project/Scene consumer。
- 产品 PPTX dependency closure 对 `projectTypes` / `SceneNode` 零命中；旧 builder 不在本节点现代化。
- 现有可编辑对象、动态静态表达、素材和 warning 行为不降级。
- 失败不会生成伪成功文件，且作者工程不被写入。

## Focused validation

- `npx vitest run tests/unit/coursePptxExport.test.ts tests/unit/renderPptxComponentSnapshots.test.ts tests/unit/renderPptxRuntimeSnapshots.test.ts`
- `npm run typecheck`

## Rollback / handoff

回滚 PPTX use case 切换，不删除旧 builder；交接列出 V2 producer/capture 缺失的具体内容类型。
