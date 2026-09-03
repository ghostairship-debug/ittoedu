# r11-032-player-v2-only-entry｜Player 入口只接受 Published V2

- Release / Dependencies: 1.1 / r11-033-runtime-authoring-preview-v2, r11-041-pptx-v2-only, r11-042-pdf-v2-only, r11-043-html-web-v2-only
- Write locks: `published-producer`
- Inventory access: read
- Preservation: PM-06, PM-09, PM-14–PM-21

## Outcome / current evidence

在作者预览、PPTX/PDF capture、两种 HTML 与 Web Package 已全部改用 r11-031 V2 seam 后，正式 Player bundle/entry 只解析并运行 Published Course V2；旧 `ExportPayload`、V8 `ProjectDocument`、legacy `PlayerApp`/published lesson 入口退出产品路径。Slide/Flow/Spatial/Mixed 与动态 carrier 均通过 `CoursePlayer`。

## Read first

- `src/player/index.ts`
- `src/player/PlayerApp.ts`
- `src/player/payload.ts`
- `src/player/publishedLesson.ts`
- `src/player/surfaces/CoursePlayer.ts`
- `src/player/publishedCoursePresenter.ts`

## Exact targets

| Target | Required action | Must already be zero before edit |
|---|---|---|
| `src/player/index.ts#startPlayer` | strict parse Published V2 并只 mount `CoursePlayer` | Workspace preview、PPTX/PDF capture、HTML/Web producer 的 Legacy input |
| `src/player/payload.ts` / `PlayerApp.ts` / `publishedLesson.ts` | 若 product/bundle consumer 为零，加入 r11-054 deletion handoff；本任务只断开 entry | 所有 static/dynamic/config/bundle consumer |
| presenter/input/audio helper | 仍服务 V2 的 helper 移到现有 V2 owner，保持 API/行为 | 不复制 Project/Scene 或保留 dual parser |
| bundle tests | Published V2 success；Legacy/corrupt fail-loud | 不测试 V8 success/migration |

## Write scope

只允许修改表中 Player entry/helper 与直接 bundle/protocol tests；旧模块文件的最终删除留给 r11-054。禁止修改共享 inventory、renderer producer、Workspace、HTML/PPTX/PDF packaging、Published V2 wire、Runtime/Component API 或为旧 payload 加迁移/静默 fallback。

## Execution

1. 核对 033/041/042/043 handoff，逐项证明 browser bundle、try-run、full preview、HTML/Web、capture 的 Legacy entry consumer 为零；任一非零立即停止并退回 owner。
2. 让入口在启动时 strict parse Published V2，并只 mount `CoursePlayer`；unsupported/corrupt payload 显示可行动错误。
3. 迁移仍有价值的 presenter/input/audio helper 到 V2 owner，不复制旧 Project。
4. 证明 legacy entry/payload 的静态、动态/config、bundle 和 product consumer 为零后断开 entry；旧文件不在本任务删除，精确加入 r11-053 reconciliation handoff。
5. 更新 bundle tests；不在本任务修改 HTML/Web producer。交接列出 LEG-002 预期减少的 endpoint、replacement 与精确查询，不修改共享 inventory。

## Stop conditions

- 任一正式 Preview/Export 仍只会提供旧 payload。
- Flow/Spatial/Mixed 或动态 carrier 在 CoursePlayer 上缺失当前能力。
- 需要 silent fallback、自动迁移旧 payload 或保留双入口。

## Acceptance

- 正式 Player bundle 只接受 Published V2，旧 payload fail-loud。
- Slide/Flow/Spatial/Mixed 的导航、互动、状态、Component/Runtime 均不降级。
- legacy Player entry 的 product/bundle consumer 在当前树为零，精确 LEG-002 handoff 可重现；共享 inventory 留待 r11-053。

## Focused validation

- `npx vitest run tests/unit/publishedCourseProtocol.test.ts tests/unit/publishedCourseNavigation.test.ts tests/integration/architectureBaselineFlows.test.tsx`
- `npm run typecheck`

## Rollback / handoff

回滚 entry wiring；不能同时发布两个自动选择的 Player 入口。交接列出仍依赖旧 payload 的正式 producer。
