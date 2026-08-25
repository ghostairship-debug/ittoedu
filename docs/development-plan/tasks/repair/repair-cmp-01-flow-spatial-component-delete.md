# repair-cmp-01-flow-spatial-component-delete 修复 Flow/Spatial 组件删除假成功

- Status / Owner: queued /
- Risk / Hotspot: S2 / editor-store-history
- Outcome / Why now: 非 Slide 会话的组件包删除走空 `commit` 后仍提示“已删除”并返回 true，且引用统计可能漏掉 Flow/Spatial V9 carrier。
- Write scope / Baseline: baseline `b967c96`; `src/renderer/store/editorStore.ts` 的组件包删除入口、现有 V9 reference/usage collector、必要的 component/course command 与直接 tests；不得修改 Component API 4 或 Course Project V9 Schema。
- Acceptance: Slide、Flow 稿纸/浮层、Spatial 世界及 global/surface 引用都阻止误删；真正未使用包通过 V9 command 删除，sidecar/package bytes、undo/redo、保存重开一致；失败不改变工程且不显示成功。
- Focused validation: `npx vitest run tests/unit/componentPackageManagement.test.tsx tests/unit/componentPackageLifecycle.test.ts tests/unit/courseComponentPackageTransactions.test.ts`。
- S2 safety / rollback: 回滚起点 `b967c96`；全部删除测试使用 fixture/内存归档，不操作用户文件；若现有 collector 无法完整覆盖三 Surface，先收敛共享 V9 usage collector，不回退到 V8 projection 或双写。
