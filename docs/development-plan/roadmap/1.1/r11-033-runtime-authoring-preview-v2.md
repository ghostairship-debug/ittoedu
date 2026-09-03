# r11-033-runtime-authoring-preview-v2｜作者预览切换到 Published V2

- Release / Dependencies: 1.1 / r11-014-media-design-component-consumers, r11-031-published-slide-player, r11-050-v9-fixture-foundation
- Write locks: `workspace-properties`, `published-producer`
- Inventory access: read
- Preservation: PM-03, PM-07–PM-09, PM-12–PM-21, PM-25

## Outcome / current evidence

Slide 当前页 try-run/作者预览由 canonical V9 构建 Published V2，并通过 r11-031 的 CoursePlayer seam 运行；`SlideLocationWorkspace.tsx` 不创建 `ExportPayload`、挂载 `PlayerApp` 或从旧 Scene 投影拼完整快照。当前真实 seam 已位于 `coursePlayerTryRun.ts`：`SlideLocationWorkspace` 的 Published authoring mount effect 是 `mountPublishedCourseAuthoring` 的唯一产品调用者，后者复用 `mountPublishedCourseTryRun` 和同一 V2 producer。`Workspace.tsx` 是负边界，不得重新取得 preview lifecycle。

## Read first

- `src/renderer/ui/workspaces/SlideLocationWorkspace.tsx` 的 `syncCompleteAuthoringSnapshot`、调用 `mountPublishedCourseAuthoring` 的 Published authoring mount effect、`publishedAuthoringSessionRef` 与 `handlePublishedAuthoringMessage`
- `src/renderer/ui/coursePlayerTryRun.ts` 的 `PublishedCourseMountInput`、`buildPublishedCourseTryRunPayload`、`mountPublishedCourseTryRun` 与 `mountPublishedCourseAuthoring`
- `src/renderer/ui/serializedSessionMount.ts` 的 `beginSerializedSessionMount` / `enqueueSerial` 销毁顺序合同
- `src/renderer/export/course/buildPublishedCourse.ts`
- `src/shared/textLayout.ts`
- `tests/unit/coursePlayerTryRunFit.test.ts`
- `tests/unit/serializedSessionMount.test.ts`
- `tests/unit/publishedSlideCaptureSession.test.ts`

## Exact targets

| Target | Required replacement | Parity evidence |
|---|---|---|
| `SlideLocationWorkspace#syncCompleteAuthoringSnapshot` 与 Published authoring mount effect | canonical active V9 draft、location、state、scope → 一个 Published authoring session；完整同步不再读取 `selectActiveScene` / `EditorState.project` 或生成旧 `SceneNode` snapshot | state/global/surface/local、controller、Component、Runtime |
| `buildPublishedCourseTryRunPayload(input: { project; assetFiles; components }): PublishedCourseV2Payload` | 保持现有精确输入 owner，由 `buildPublishedCourseV2Payload` 一次构建 V2；asset/component bytes 只来自当前 session closure | 工程 asset ID 解析同一 bytes；remote 仅按声明 origin |
| `mountPublishedCourseAuthoring(input): Promise<PublishedCourseSession>` | 保持现有导出签名：`Omit<PublishedCourseMountInput, 'authoring' | 'initialPresentationStateId'>` 加 `sessionId`、`scope`、`stateId`、可选 `onMessage`；唯一产品调用者固定为 `SlideLocationWorkspace` 的 Published authoring mount effect，并只委托一次 `mountPublishedCourseTryRun` | authoring 不接受试运行初始状态，不创建第二 payload/host |
| `publishedAuthoringSessionRef` + `beginSerializedSessionMount` + `PublishedCourseSession.destroy` | 沿用现有 generation-bound create/update/destroy；重挂载先销毁前一 session，迟到 ACK/message 不越过 token/barrier | Stop、stale、unmount 无泄漏/旧实例回流 |
| 文本与字体接线 | `textLayout.ts` 现有 auto-height/fixed/shrink；顶层与 iframe 安装同一 resolved font bytes | 同一 fixture 在 authoring/try-run/Player 相同 |

本任务不新建 `src/renderer/preview/runtimePreviewPayload.ts` 或 `runtimePreviewLifecycle.ts`，也不另建 iframe/bundle seam；当前正式 seam 就是上表的 `coursePlayerTryRun.ts` 导出。若这些现有 symbol 或唯一调用关系在执行前变化，先由 Integrator 更新规格，执行者不得现场选择新架构。

## Write scope

只允许修改 `src/renderer/ui/workspaces/SlideLocationWorkspace.tsx`、`src/renderer/ui/coursePlayerTryRun.ts` 中上表精确 symbol、为该既有 seam 所需的最窄直接类型，以及列出的直接用例。`Workspace.tsx` 只允许作为负边界测试读取，不得重新取得 preview lifecycle。`serializedSessionMount.ts` 只读其既有销毁合同；若必须修改它则停止并更新规格。禁止新建 preview payload/lifecycle 文件、修改 Published V2 wire、文本布局规则本身、网络授权、Player/Runtime/Component API、其他 Surface authoring或共享 inventory。

## Execution

1. 用 r11-050 固定 Slide fixture 同时记录 authoring、try-run、CoursePlayer 的 shrink/auto-height、resolved font family/bytes、local asset、remote source、global/surface/state、Component/Runtime 结果。
2. 保持 `buildPublishedCourseTryRunPayload` 的固定签名和唯一 V2 producer 调用；`SlideLocationWorkspace` 只把 active committed V9 document、asset files、component packages、location/state/scope 交给 `mountPublishedCourseAuthoring`，不得先投影 V8、再反建 Published，也不得构建第二 payload。
3. 将 `syncCompleteAuthoringSnapshot` 的旧 Scene/project 读取改为 r11-031 已固定的 canonical V9 authoring target/patch 语义；不得从 DOM、Player 或旧投影反建节点。若 r11-031 没有足够的 V9 patch 输入，停止并退回该依赖节点。
4. 保持 `SlideLocationWorkspace` 是 `mountPublishedCourseAuthoring` 唯一产品调用者；该函数继续只委托一次 `mountPublishedCourseTryRun`。资源直接沿 `PublishedCourseMountInput.assetFiles/components` 进入 Published closure，不新增 object-URL 台账或第二资源生命周期模块。
5. 沿用 `beginSerializedSessionMount`、session token、snapshot barrier 与 `PublishedCourseSession.destroy`；generation/revision/ACK/stale/destroy 保持，迟到结果零写入，重挂载与 unmount 必须先完成前一 session 销毁。
6. 按架构合同统一文本/字体/资产解析：复用现有 helper，不复制 shrink、font-face 或 asset fallback 规则；remote 失败显示现有可见错误。
7. 删除 Slide authoring seam 对 `buildStandaloneHtml`、`ExportPayload`、`PlayerApp`、`selectActiveScene` 和 `EditorState.project` 的剩余调用，并证明 `Workspace.tsx` 未重新取得 lifecycle；若某项在前置节点后已为零，只记录零查询，不做空重构。交接列出 LEG-001/002 endpoint、replacement 与精确查询，不修改共享 inventory。

## Stop conditions

- 同一输入在 authoring/try-run/Player 的文字布局、字体 bytes 或工程资产 bytes 仍不一致。
- 需要修改文本布局规则、Published wire、网络权限或动态宿主 API 才能接线。
- patch/ACK/stale、资源销毁、Component/Runtime 生命周期或 controller 行为退化。
- 只能通过保留 Legacy preview fallback 才能通过。

## Acceptance

- SlideLocationWorkspace/runtime preview 不构造 V8 Project/Scene/ExportPayload，不挂载 PlayerApp，只走 `mountPublishedCourseAuthoring` → `mountPublishedCourseTryRun` → Published V2/CoursePlayer seam；Workspace 不拥有 lifecycle，且不存在第二 payload/resource/lifecycle 模块。
- `mountPublishedCourseAuthoring` 的固定签名不变，唯一产品调用者是 SlideLocationWorkspace Published authoring mount effect；asset/component closure 由固定 `PublishedCourseMountInput` 传入且不复制。
- 固定 fixture 的文本自适应、字体、local/remote 素材、状态合成和动态 carrier 在 authoring/try-run/Player 对齐；失败可见。
- generation、ACK、stale、destroy 与资源释放无回归；作者工程与历史在预览失败时不变。

## Focused validation

- `npx vitest run tests/unit/coursePlayerTryRunFit.test.ts tests/unit/serializedSessionMount.test.ts tests/unit/publishedSlideCaptureSession.test.ts tests/unit/textLayout.test.ts tests/unit/bundledFontExportEmbedding.test.ts`
- `npx vitest run tests/integration/publishedRuntimeSlideHostIntegration.test.ts tests/integration/publishedPhaserComponentSlideHostIntegration.test.ts`
- `npm run typecheck`

## Rollback / handoff

整体回滚 V2 preview 接线与 bundle 选择，保留已修复的资源清理测试；不得同时保留自动双入口。交接列出唯一仍需 Legacy 的 path#symbol、具体 parity 差异与所属 owner。
