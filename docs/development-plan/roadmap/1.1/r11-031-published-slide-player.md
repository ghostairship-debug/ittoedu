# r11-031-published-slide-player｜Slide Player 直接消费 Published/V9 模型

- Release / Dependencies: 1.1 / r11-012-published-v2-schema-independence, r11-030-native-render-boundary
- Write locks: `published-producer`
- Inventory access: read
- Preservation: PM-03, PM-08–PM-09, PM-14–PM-18

## Outcome / current evidence

`SlidePublishedAdapter`、direct authoring patch 与复用它们的 CoursePlayer capture seam 从 Published Slide/V9 authoring target 生成 render input，不构造旧 Scene/Project；命名状态、global/surface/local 合成、Component/Runtime 与 ACK/error 语义保持。旧 `PlayerScene`/`PlayerApp` 不是正式产品 target，交 052/054。作者预览和各格式接线留给 033/041–043。

## Read first

- `src/player/surfaces/slide/SlidePublishedAdapter.ts`
- `src/player/surfaces/slide/publishedSlideAuthoringPatch.ts`
- `src/player/surfaces/slide/publishedSlidePhaserComponentMount.ts`
- `src/player/surfaces/CoursePlayer.ts`
- `src/renderer/export/playerCapture.ts`
- `tests/integration/publishedRuntimeSlideHostIntegration.test.ts`
- `tests/integration/publishedPhaserComponentSlideHostIntegration.test.ts`

## Exact targets

| Target | Required result | Explicit non-owner |
|---|---|---|
| `SlidePublishedAdapter` | Published Slide → r11-030 readonly render input；保留 base/state/global/surface/local composition | 不改 Published wire |
| `publishedSlideAuthoringPatch` | 完整校验 target/revision/generation/owner/item；stale 零写入 | 不改 authoring command |
| `CoursePlayer` / `playerCapture` seam | 提供只接收 Published V2 的 mount/capture API，供 033/041/042/043 调用 | 本任务不切 App、Workspace、HTML/PPTX/PDF producer |

## Write scope

只允许修改表中 target、必要的直接类型与 listed tests。禁止修改 Workspace/runtime preview、App 导出 handler、HTML/PPTX/PDF producer、Published V2 wire、authoring command、Flow/Spatial host、Component/Runtime API、z-order 或创建 legacy fallback。

## Execution

1. 记录 Slide base + presentation override + global/surface/scene 的 effective composition 输入。
2. 让 adapter 输出 r11-030 render input 与动态 carrier mount descriptor，不输出旧 SceneDocument。
3. direct authoring patch 必须校验完整 target/revision/generation/owner/item；stale 和 invalid 零写入并返回现有 error/ACK。
4. 让 `CoursePlayer`/`playerCapture` 暴露只接受已 parse Published V2 的复用 seam；不得在该 seam 内接受或探测 Legacy payload。
5. 保持 Component/Runtime 生命周期、事件 buffer、教师控制器 Overlay 与密集栈序。正式 target 删除旧 Scene import/adapter；旧 `PlayerScene` / `PlayerApp` 及其成功测试只登记为 052/054 handoff，不在本节点现代化或删除。

## Stop conditions

- 需要改 Published V2 或从 Player DOM 反建 authoring document。
- 动态 carrier、命名状态或 global plane 顺序不能等价表达。
- patch target 丢失 canonical identity 字段。

## Acceptance

- Published Slide 和当前位置试运行均不构造旧 Scene/Project。
- 命名状态、动画、互动、Component/Runtime 与控制器行为不变。
- stale/迟到 patch fail-loud 且 authoritative project 零写入。
- V2 capture seam 能复用同一 CoursePlayer，且 Legacy payload 输入明确失败；033/041–043 不需再访问 `PlayerApp`。

## Focused validation

- `npx vitest run tests/unit/publishedSlideAuthoringPatch.test.ts tests/unit/slidePublishedCaptureStacking.test.ts tests/integration/publishedRuntimeSlideHostIntegration.test.ts`
- `npx vitest run tests/integration/publishedPhaserComponentSlideHostIntegration.test.ts tests/unit/playerCapture.test.ts`
- `npm run typecheck`

## Rollback / handoff

回滚 Slide adapter/patch 切换；不改变 Published producer。交接列出仍需旧 Scene 的 Player symbol 和缺失 render input 字段。
