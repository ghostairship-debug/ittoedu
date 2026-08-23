# ARCH-2 W2-A 资源安全阶段门

记录时间：2026-08-24（Asia/Shanghai）
阶段范围：`ARCH-2 / W2-A Media + Components + Core History`
基线：`d6b56a2`（ARCH-1 gate complete）
候选：A-01 `91ee19b`、A-02 `d7f8032`、A-03 `031c107`、A-04 `59436aa`、A-05 `1dff8eb`

## 1. Gate 结论

W2-A 达到进入 W2-B 的工程门槛：

- Slide、Flow、Spatial 三个现有 history 都能携带同一语义的 document/resource transaction frame；
- 显式项目媒体库批量入库与已安装组件包替换成为两个真实跨 Surface delta 行为；
- Flow 正文继续使用 `FlowMediaBlock` / `FlowComponentBlock`，没有被降级为 LayerItem；
- metadata、asset bytes、package files 与所有实例版本在一次 undo/redo 中同步；
- async 文件/目录读取前捕获 project/revision/package target，stale/conflict/no-op 均零写；
- 22/22 同协议性能指标无 threshold breach；三份 fixture、save/reopen、Published V2 与 Component API 4 均通过；
- 结构性完整快照字段仍诚实保留，未把“目标行为不再消费”误报为“历史债务已删除”。

结论为 `W2-A engineering gate = pass`。这不是完整 ARCH-2、产品发布或 teacher acceptance；Runtime、Interactions、共享层、Diagnostics、Save/Recovery 仍在 W2-B。

## 2. Consumer 与行为 before / after

| 指标 | ARCH-2 起点 | W2-A | Gate |
|---|---:|---:|---|
| resource-aware Surface histories | 1 / 3 | 3 / 3 | pass |
| 显式 project media-library full-snapshot behavior | 3 | 0 | pass |
| Flow N-item library import revisions/history | N / N | 1 / 1 | pass |
| Spatial N-item effective revision/history | 0 / 0 | 1 / 1 | pass |
| product asset-delta behaviors | 1 | 2 | pass |
| product component-package delta producers | 0 | 1 | pass |
| V8 component replacement planner production consumer | 1 | 0 | pass |
| Store retarget helper / caller | 1 / 1 | 0 / 0 | pass |
| component replacement empty `commit()` fallback | 1 | 0 | pass |
| raw renderer Store import files | 23 | 23 | no growth |

精确边界：Store 对 `importCourseMediaAssets` 的旧直接 consumer 从 4 个源码引用降到 0；该函数在 `v9MediaAudioCommands.ts` 内仍有 2 个合法 consumer，用于 add/place 在数量或场景容量不足时退回 library。W2-A 只宣称“显式 project media-library import”三 Surface 从完整快照迁走，不宣称所有 placement fallback 已迁移。

## 3. 结构债务仍非零

| 结构 | 起点 | W2-A | 解释 |
|---|---:|---:|---|
| sidecar Past/Future fields | 2 | 2 | 删除门未满足 |
| sidecar field reference lines | 41 | 41 | 22 Past + 19 Future |
| component package Past/Future fields | 2 | 2 | 删除门未满足 |
| package field reference lines | 19 | 19 | 10 Past + 9 Future |
| full sidecar persistence adapters | 3 | 3 | Slide/Flow/Spatial bare legacy entries仍需对齐 |
| Slide full package snapshot adapter | 1 | 1 | import/delete/editable actions仍消费 |

剩余真实行为包括：Slide 旧 media/audio/update/delete，Flow/Spatial 图片/视频导入并放置，组件 import/delete/editable-copy/editable-update。Flow/Spatial 组件 import 的 package-resource undo 也不在本波次承诺。只有这些精确 consumer 逐项迁完并稳定一个波次，才能删除四个兼容字段。

## 4. 代表行为证据

### Media library

- Slide-heavy、Flow-heavy、Mixed→Spatial 均为两素材 `revision +1 / history +1`；
- history frame 含两个 `AssetFileHistoryChange`，四个完整资源栈深度不增加；
- scene/block/world/global topology 与 selection 不变；
- 一次 undo 删除两项 metadata/bytes，一次 redo 精确恢复；
- `__proto__` 作为合法 own asset key 可 forward/inverse/redo，资源 record 原型不变；Buffer 输入变为独立 base `Uint8Array`；
- missing-byte repair 保存重开后，Published V2 能读取被引用图片；producer 前后 Store state 不变；
- App deferred `selectImages` 证明 target 捕获早于 await；正常两图入库仍为一条 history。

### Component replacement

- Slide-heavy、内存嵌套 section 的 Flow-heavy、Mixed→Spatial 均为一个 `ComponentPackageHistoryChange`；
- metadata、files、content hash 与所有实例版本原子替换，四个完整资源栈深度不增加；
- recursive FlowComponentBlock 保持正文 carrier；ComponentLayerItem 的 ID/props/fallback/geometry/order/visibility/ownership 不变；
- 一次 undo/redo 精确恢复 before/after 包；Spatial 按既有 history 语义在 undo 清空 selection，forward 无变化；
- manual 与 Catalog target 均在异步读取前捕获；entry/file SHA、expected ID/version、source/trust 检查未改变；
- save/reopen 保留 4.1 files，Published V2 Schema 通过并输出 `apiVersion: 4`，nested Flow block 指向同版本包。

## 5. 性能

环境、fixture SHA、5 warmups + 21 samples 与 ARCH-0 完全相同。调查线为 median `max(base×1.25, base+1ms)`、P95 `max(base×1.35, base+2ms)`；本轮 22/22 未触发。

| Fixture / operation | ARCH-0 M/P95 ms | W2-A M/P95 ms | Breach |
|---|---:|---:|---|
| Slide open | 1.230 / 2.176 | 1.304 / 1.918 | no |
| Slide save+reopen | 3.546 / 5.278 | 3.241 / 4.613 | no |
| Slide validate/preflight | 3.933 / 5.626 | 3.307 / 4.831 | no |
| Slide Published V2 | 1.588 / 2.917 | 1.627 / 2.638 | no |
| Slide standalone HTML | 5.909 / 7.578 | 5.184 / 8.817 | no |
| Slide Web ZIP | 37.890 / 50.419 | 42.329 / 48.958 | no |
| Flow open | 0.454 / 1.361 | 0.397 / 0.623 | no |
| Flow save+reopen | 2.111 / 2.678 | 1.474 / 2.153 | no |
| Flow validate/preflight | 1.916 / 3.129 | 1.408 / 2.493 | no |
| Flow Published V2 | 0.669 / 0.875 | 0.531 / 0.974 | no |
| Flow standalone HTML | 4.787 / 6.446 | 4.061 / 7.264 | no |
| Flow Web ZIP | 54.930 / 79.038 | 38.872 / 63.910 | no |
| Mixed open | 1.594 / 1.761 | 1.072 / 1.487 | no |
| Mixed save+reopen | 5.677 / 6.515 | 3.926 / 4.389 | no |
| Mixed validate/preflight | 5.082 / 8.133 | 4.844 / 7.921 | no |
| Mixed Published V2 | 2.998 / 4.142 | 1.934 / 2.296 | no |
| Mixed standalone HTML | 9.478 / 10.883 | 8.384 / 9.409 | no |
| Mixed Web ZIP | 77.044 / 91.272 | 66.171 / 72.797 | no |
| Slide transform+undo+redo | 2.498 / 2.851 | 2.324 / 3.840 | no |
| Flow apply-text+undo+redo | 0.408 / 0.569 | 0.360 / 0.440 | no |
| Mixed navigate all locations | 2.131 / 2.949 | 1.951 / 2.464 | no |
| Flow DOCX | 1.939 / 2.254 | 1.781 / 2.364 | no |

Mixed history 50 commits/depth 50，heap delta `+25,677,064 bytes`；与 ARCH-0 相差 `+1,112 bytes`，仍是无 forced-GC 的定性观察。一次导出状态无新增降级：Slide PPTX `green-with-fallback-warnings`；Flow print/DOCX green；Mixed print partial；Mixed/Spatial PPTX 仍为已登记 red，2 条 `Image data lacks a base64 header`。

## 6. 自动验证

- A-01–A-05 focused union：通过；A-04 Coordinator 14 files / 148 tests，A-05 14 files / 130 tests；
- independent Store reviews：A-04 13 files / 137，A-05 11 files / 44，均无 blocker；
- final full unit/integration candidate：224 files / 1,377 tests passed；
- dependency ratchet：8/8；
- root/Electron/E2E TypeScript：pass；
- three fixture validators：3/3 `status=valid`, `canExport=true`；fixture SHA deterministic；
- contracts、AI capabilities、task board、repo-index freshness/quality 和 final clean full-test rerun：见本 gate 最终提交后的命令记录。

不在 W2-A 重跑 desktop E2E：本波次没有新可见 UI、placement、Player 或 export implementation；真实风险是 async target + Store/resource/history，已由 5 个 pure/history suites、两个 App deferred race、三 Surface vertical slices、archive reopen 与 Published read-only 覆盖。完整 desktop/E2E 仍在 ARCH-2 phase gate。

## 7. Ratchet 与当前事实

`architectureDependencyRatchet.test.ts` 防止：

- Feature planners 反向依赖 App/UI/Editor Store；
- Flow/Spatial resource frame/undo/redo/legacy-count seam 消失；
- Store 重新调用 `importCourseMediaAssets`、逐项 `importAsset`、V8 replacement planner、retarget helper 或 empty replacement commit；
- App 把 Media/manual/Catalog target capture 移到 await 之后。

Media、Components、Editor Core 三个现有 semantic current fact 已更新为当前实现，同时明确 placement/audio/editable actions、三 histories/V8 projection 与完整快照仍是债务。

## 8. 分层状态与下一步

- Pipeline：`pass / engineering candidate`。
- Functional outcome：`green for W2-A target behaviors`；Mixed PPTX 保持已登记 red，不是本波次新增。
- Visual outcome：`unchanged art candidate`；没有新视觉或交互布局。
- Accepted：`not claimed`。

下一步仅允许 W2-B：Runtime/Interactions → Published behavior → Flow teacher controller/global layers → Diagnostics → Save/Recovery；继续保持 Store/App/Workspace/Published 单写者。
