# r11-030-native-render-boundary｜建立非持久化 Native render input

- Release / Dependencies: 1.1 / r11-013-shared-native-consumers, r11-014-media-design-component-consumers
- Write locks: `published-producer`
- Inventory access: read
- Preservation: PM-07–PM-09, PM-14–PM-18

## Outcome / current evidence

节点渲染、动画、视频、场景素材和教师控制器使用从 V9/Published Native item 物化的只读 render input，不把旧 `SceneNode` 当作 authoring、Player 或持久合同；`SlidePublishedAdapter.ts` 只保留 stage/session/interaction lifecycle，Native discriminator painter 迁入真实只读模块。

### 2026-09-03 spec correction / revalidation

正式 V2 产品 seam 已位于 `publishedNativeRendering.ts` + `SlidePublishedAdapter.ts`。`PlayerScene`、`renderNode`、motion/video/controller/sceneAssets 属于待删除 Legacy path，不在本节点现代化；它们的成功测试由 052 迁移/删除，模块只可在 053 新鲜零清单后由 054 删除。

## Read first

- `src/player/surfaces/slide/publishedNativeRendering.ts`
- `src/player/surfaces/slide/SlidePublishedAdapter.ts`

## Write scope

只允许复核/修改 `publishedNativeRendering.ts`、`SlidePublishedAdapter.ts`、必要的正式 Native direct types 与 V2 最近层测试。旧 Player renderer 只形成 052/054 handoff，禁止为保留它而复制或反向接线正式 seam。禁止改变 DOM/Canvas/Phaser 视觉语义、authoring wire、Player navigation、Component/Runtime host 或把 render input 写回工程；禁止新增通用 Player framework。

## Execution

1. 列出六种 Native 的渲染字段、动画字段、asset resolver、teacher-controller action 和 stable layer identity。
2. 定义只读 discriminated render input，来源仅为 V9/Published Native content + Layer frame/状态；无 schemaVersion、Scene/Project owner 或 writer。
3. 在 `publishedNativeRendering.ts` 直接拥有 Published Native painter/read model；它不得 import 或组合 Legacy renderNode/motion/video/controller/sceneAssets，也不得持有 session、Store、writer、navigation 或 schemaVersion。
4. `SlidePublishedAdapter.ts` 只把已解析的 Published stage item 与 host ports 交给该模块，保留 mount/update/destroy、interaction/ACK 与 authoring inert 语义；原文件删除 Native switch、painter state 和重复 asset 规则。
5. Slide authoring/try-run 与 Published Player 使用同一 adapter 语义，但 authoring 保持 inert。
6. 证明正式 V2 seam 对 `SceneNode`/`ProjectDocument` 与旧 renderer 零依赖；旧 renderer endpoint 原样交给 052/054，不修改共享 inventory、不提前删除。

## Stop conditions

- render input 需要成为可持久化/可编辑模型。
- adapter 丢失命名状态、global plane、asset、动画或 controller 行为。
- 需要修改 Runtime/Component host 才能完成 Native 迁移。

## Acceptance

- 正式 `publishedNativeRendering` / `SlidePublishedAdapter` 不 import 旧 Scene/Project 类型或旧 renderer；死 Legacy 路径不冒充产品 target。
- Text/Formula/Image/Video/Shape/Controller 在 authoring、try-run、Player 的视觉/互动结果不变。
- `SlidePublishedAdapter.ts` 不含 Native discriminator painter；`publishedNativeRendering.ts` 无 session、Store、writer、schemaVersion 或反向 authoring conversion，原文件相应 imports/state/branches 已真实消失而非 re-export。

## Focused validation

- `npx vitest run tests/unit/slidePublishedNativeText.test.ts tests/unit/slidePublishedCaptureStacking.test.ts tests/integration/publishedRuntimeSlideHostIntegration.test.ts tests/integration/publishedPhaserComponentSlideHostIntegration.test.ts`
- `npm run typecheck`

## Rollback / handoff

整体回滚一个 renderer 的 adapter 切换；保留旧路径直至同一行为恢复。交接列出尚未迁移的 SceneNode render consumer。
