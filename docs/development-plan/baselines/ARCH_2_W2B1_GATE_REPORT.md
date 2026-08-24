# ARCH-2 W2-B1 Runtime / Interaction 阶段门

记录时间：2026-08-24（Asia/Shanghai）
阶段范围：`ARCH-2 / W2-B1 Runtime authoring + Interaction authoring/Published host`
Gate 起点：`ef08171`（B1-12 已关闭并完成 repo-index）
任务范围：`arch-2-b1-01` 至 `arch-2-b1-13`

## 1. Gate 结论

W2-B1 的功能与工程阶段门通过，可进入 W2-B2：

- Runtime asset、source、keyed content、Properties scalar 与支持的 Slide scene/global template lifecycle 已改为精确 canonical V9 target；真实变化各自只产生一个当前 Surface transaction，stale/locked/replaced/detached/occupied/no-op 均为零写。
- Runtime template removal 继续使用统一图层 delete/hide 与 undo/redo；没有第二套 Runtime-only 删除协议。
- Automation 的 reveal-sequence template 与对同一规则的后续支持字段 patch 共用标准 Interaction V1 rule 与 typed V9 planner/transaction；Flow/Spatial local authoring 诚实不可用。
- Published V2 session 以 session-owned global controller 与可选 Slide-local controller 执行受支持的 `node.click`、enter/exit motion 与 whole-course navigation slice；Slide、Flow、Spatial 各自通过 DOM port 保持 node、camera 与 gesture ownership。
- Preview、packaged Player 与 host controller 不写作者 Store 或 Published payload；切换、replay、restart、suspend、destroy 会取消或重建应失效的工作。
- 旧 Runtime raw writer/helper 已清零并由架构 ratchet 固定；Legacy `InteractionEngine` 与 generic rule adapters 保持诚实非零，没有被误删或误报。

结论为 `W2-B1 functional engineering gate = pass`。这不是完整 ARCH-2、发布判定或教师验收。性能测量有 `8/22` 个 operation rows 出现 breach，共 `12` 个 median/P95 单项越过调查线，作为明确的 ARCH-2 final-gate 风险保留；不把 functional green 误写成 performance accepted。

## 2. 边界：本阶段实际交付与没有交付的能力

### Runtime

已交付的是 canonical authoring lifecycle：

- async picker 前捕获 Runtime asset target，binding + AssetMeta + bytes 一次提交；
- Developer source draft 显式 apply/cancel，保持 API 2/API 3 与其他字段；
- Workspace keyed text、Properties enabled/renderMode/content field 精确提交；
- Slide scene/global missing-slot template 精确创建，existing/unsupported slot 不覆盖；
- archive reopen 与 Published V2 projection 保持数据且 producer read-only。

Published V2 dynamic hosts 仍只为 Runtime LayerItem 呈现 minimal/static fallback。真实 `RuntimeHost` / `CourseRuntimeKernel` execution 仍属于 `LEG-002` 的 Legacy ExportPayload consumer；本 gate 没有宣称 Published Runtime execution。

### Interaction

已迁移的是 Automation reveal-template + supported subsequent field patches，以及独立的 Published `node.click` playback slice。两者共用 Interaction V1 contract，但 reveal template 的 `scene.enter` trigger 仍不在当前 playback slice 中，因此本 gate 不宣称该 template 自动播放。

既有 generic add/delete/duplicate/move/click-rule actions、Properties click-rule adapters 与 Developer JSON adapters 仍可达；Flow/Spatial local carrier 不存在。它们是明确 residual consumer，不是本 gate 的假零值。

## 3. Consumer 与 dependency ratchet

| Gate | 当前结果 |
|---|---|
| `setSceneRuntime`, `setGlobalRuntime` | `0 / 0` in src+tests |
| `updateSceneRuntime`, `updateGlobalRuntime` | `0 / 0` in src+tests |
| `runtimeDocumentToCourseRuntime`, `makeRuntimeLayerItem` | `0 / 0` in src+tests |
| `writeSceneRuntime`, `writeGlobalRuntime`, `freshRuntime` | `0 / 0 / 0` in src+tests |
| `courseRuntimeToDocument` | exactly `3`: one definition + two V9→V8 read projections |
| `onPrepareMotionTargets` | `0` in src+tests |
| Runtime template product UI path | exactly one path in `DeveloperTab` |
| Automation typed template/update path | `applyInteractionTemplateAtTarget` + `updateInteractionRuleAtTarget` |
| Raw generic update-rule UI consumers | exactly `DeveloperTab` + `PropertiesTab`; Automation generic add/delete/duplicate/move intentionally retained |
| Published controller instances per session | exactly two construction sites: global + optional Slide-local |
| Published DOM port construction | one each in Slide, Flow and Spatial hosts |
| Legacy `InteractionEngine` construction | remains in `PlayerScene`; deletion not claimed |
| Player imports from renderer Store | `0`, preserved by the existing dependency ratchet |

`architectureDependencyRatchet.test.ts` now additionally proves:

- Runtime pure planners/views cannot import App/UI/editorStore;
- five Runtime Store use cases each contain its own expected planner, `createEditorTransactionStep` and `persistProjectResourceTransaction` inside the bounded method slice;
- nine removed raw Runtime symbols remain absent while the three read-projection references remain exact;
- Automation template/update method slices use the typed planners and one persistence seam; residual raw update-rule UI consumers remain exactly named, while Automation generic add/delete/duplicate/move remains explicitly nonzero;
- the session has global + optional local controller instances and all three Surface hosts retain a Published DOM port;
- Legacy engine construction remains bounded to `PlayerScene` rather than spreading into Published hosts.

Final ratchet result：`11/11 passed`。

## 4. 聚焦与代表工程验证

- Runtime focused union：`24 files / 301 tests passed`，覆盖 pure planners、Store/Workspace/Properties/Developer vertical slices、race/no-op/lock/history/template lifecycle、archive 与 Published projection。
- Interaction/Published focused union：`17 files / 182 tests passed`，覆盖 authoring view/planner/UI、controller/DOM port、Slide/Flow/Spatial hosts、gesture/navigation 与 producer protocol。
- Architecture fixture union：`2 files / 9 tests passed`。
- Deterministic fixture check：slide-heavy、flow-heavy、mixed-spatial 与 manifest 均 `OK`；SHA 分别为 `101b8e81…`、`326b1c29…`、`939a0d55…`、`9e9a8a42…`。
- 三份 fixture validator：`3/3 status=valid`，Schema/stable IDs valid，`canExport=true`；协议为 Project 9 / Published 2 / Runtime 2+3 / Component 4 / Interaction 1。
- slide-heavy 只有 2 条既有 static-export informational notice；三份工程均 0 error / 0 warning。

## 5. 完整候选与真实桌面门

- `npm run typecheck`：root / Electron / E2E 三个 TypeScript project 全通过。
- `npm run check:contracts`：4 个合同生成物最新。
- `npm run check:ai-capabilities`：能力清单最新。
- Full unit/integration candidate：`247 files / 1,720 tests passed`，使用 `npm test -- --maxWorkers=4`，用时 `191.77s`。
- 默认高并发候选曾仅使 `repoIndexGenerator` 的 15 秒测试在约 17 秒超时；同测试独立运行 `6/6`、`9.28s` 通过，限制为 4 workers 后完整候选全绿。没有放宽测试 timeout。
- Full Electron Playwright：`30/30 passed`，用时 `24.8m`；pretest 同时成功构建 Player、renderer、Electron、examples 与注册 fixtures。
- 关键桌面证据包括：专业模式 Interaction template + Runtime template/source/Properties、当前位置 try-run、画布 100%/150% 对齐、scene/global Runtime text+asset save/reopen、whole-course Preview、HTML/Web、PDF/PPTX、recovery、跨 Surface image replacement 与 render-host stress。

桌面覆盖仍没有一条“通过 UI author 一个 supported `node.click` rule，再在 Electron 内点击执行”的端到端用例；真实 DOM/controller/三 Surface 执行由 17-file focused integration union 覆盖。该缺口不被伪装成 teacher acceptance，留给最终 ARCH-2 产品验收补齐。

## 6. 性能调查

协议与 ARCH-0/W2-A 相同：同 fixture、5 warmups + 21 samples；median 调查线为 `max(base×1.25, base+1ms)`，P95 调查线为 `max(base×1.35, base+2ms)`。

| Fixture / operation | W2-B1 M/P95 ms | 调查线 M/P95 ms | 结果 |
|---|---:|---:|---|
| Slide open | 1.459 / 2.489 | 2.230 / 4.176 | pass |
| Slide save+reopen | 3.807 / 5.844 | 4.546 / 7.278 | pass |
| Slide validate/preflight | 3.776 / 5.631 | 4.933 / 7.626 | pass |
| Slide Published V2 | 1.579 / 2.402 | 2.588 / 4.917 | pass |
| Slide standalone HTML | 6.234 / 9.195 | 7.386 / 10.230 | pass |
| Slide Web ZIP | 42.915 / 47.345 | 47.363 / 68.066 | pass |
| Flow open | 0.392 / 0.682 | 1.454 / 3.361 | pass |
| Flow save+reopen | 1.604 / 2.175 | 3.111 / 4.678 | pass |
| Flow validate/preflight | 1.564 / 2.112 | 2.916 / 5.129 | pass |
| Flow Published V2 | 0.581 / 1.041 | 1.669 / 2.875 | pass |
| Flow standalone HTML | 4.412 / 5.806 | 5.984 / 8.702 | pass |
| Flow Web ZIP | 52.521 / 108.620 | 68.663 / 106.701 | P95 breach |
| Mixed open | 2.090 / 2.593 | 2.594 / 3.761 | pass |
| Mixed save+reopen | 8.028 / 8.451 | 7.096 / 8.795 | median breach |
| Mixed validate/preflight | 9.333 / 11.100 | 6.353 / 10.980 | median + P95 breach |
| Mixed Published V2 | 3.889 / 4.706 | 3.998 / 6.142 | pass |
| Mixed standalone HTML | 14.896 / 18.000 | 11.848 / 14.692 | median + P95 breach |
| Mixed Web ZIP | 108.822 / 114.169 | 96.305 / 123.217 | median breach |
| Slide transform+undo+redo | 4.315 / 4.703 | 3.498 / 4.851 | median breach |
| Flow text+undo+redo | 0.629 / 0.867 | 1.408 / 2.569 | pass |
| Mixed navigate all locations | 4.113 / 5.528 | 3.131 / 4.949 | median + P95 breach |
| Flow DOCX | 3.147 / 4.676 | 2.939 / 4.254 | median + P95 breach |

结果为 `14/22` 指标无 breach。Mixed history 50 commits/depth 50，heap delta `+25,674,736 bytes`，与 W2-A 的 `+25,677,064` 相差 `-2,328 bytes`；仍只是无 forced-GC 的定性观察。

调查判断：

- 与 W2-B1 直接相邻的 Mixed navigation、HTML/Web packaging 存在绝对约 1–33ms 的调查线超出，需要在最终 ARCH-2 gate 复测并分离 controller/session 与 bundle-size 成本；
- 同轮 Slide transform、Mixed save/validate、Flow DOCX 等不经过新 Published controller 的操作也同时变慢，说明测量包含系统/进程整体方差，不能把全部差异直接归因于 B1；
- Flow Web P95 出现明显双峰；不以一次重跑挑选更好结果，而是保留最终稳定测量；
- 当前绝对时延未形成可见功能失败，30/30 desktop flow 也无 timeout，但 performance status 只能是 `investigation amber`，不能称为 accepted。

Export 状态无新增 functional red：Slide PPTX `green-with-fallback-warnings`；Flow print/DOCX green；Mixed print partial；Mixed/Spatial PPTX 仍是既有 red（2 条缺少 base64 header 的 library message）。

## 7. Repo knowledge 与 current-fact 修正

- `feature:runtime` 与 MOD-09 现在区分 canonical V9 authoring、Published static fallback 和 `LEG-002` real Runtime execution。
- `feature:interactions`、MOD-10 与 MOD-13 现在区分 typed Automation slice、Published global/optional-local controllers、generic adapters 与 Legacy engine。
- 原 ARCH-2 resource baseline 中“Runtime 两次提交”“Published 无 Interaction consumer”的陈述已更新。
- Repo index pre-close quality signature：`1b08133d5f99ac6ea2271b43ea8d5e3d058fe6872cd8a7e962a40f0925efba00`。
- Controlled：Hit@5 `100%` / Recall@15 `95%`；Broad：Hit@5 `100%` / Recall@15 `85.3846%`；0 forbidden、0 high-confidence wrong；generation/query deterministic。

## 8. 分层状态与下一步

- Pipeline：`pass / engineering candidate`。
- Functional outcome：`green for W2-B1 scoped behaviors`。
- Performance outcome：`investigation amber; 8/22 operation rows breached, with 12 individual median/P95 crossings retained for final ARCH-2 gate`。
- Visual outcome：`existing art candidate; no teacher visual acceptance performed`。
- Accepted：`not claimed`。

下一步允许 W2-B2：Global Layers / Controller → Diagnostics → Save / Recovery。最终 ARCH-2 gate 必须重新处理上述 performance breaches、MixedNavigator failure-atomicity、large-world Spatial visual/performance、Published Runtime Legacy execution 与真实 teacher/product acceptance；不得把本 gate 当作发布结论。
