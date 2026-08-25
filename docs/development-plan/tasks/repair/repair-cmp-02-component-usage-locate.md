# repair-cmp-02-component-usage-locate 修复组件使用位置定位

- Status / Owner: queued /
- Risk / Hotspot: S2 / none
- Outcome / Why now: ComponentsTab 定位 Flow 使用位置时假设存在与 component instance 同 ID 的 `flow-block` location；合法 V9 无此 location 时既不激活有效位置也不选中 block，却仍无条件提示“已定位组件使用位置”。
- Write scope / Baseline: baseline `3780090`; `src/renderer/ui/ComponentsTab.tsx`、既有 Flow selection helper 的直接调用与 UI tests；不得修改 Store/History、usage collector、V9 Schema 或删除事务。若实证必须修改 Store，停止本卡、重标 `editor-store-history` 并等待 UI-01 释放热点。
- Acceptance: 已复现的 Flow component 即使没有与 instance 同 ID 的 `flow-block` location，也会先激活其所属 Flow surface 的任一有效 location，再通过既有 Flow selection action 真实选中该 block；只有当前 surface/location 与 block selection 均确认后才提示成功，没有有效 location 或无法选中时给出可操作失败且不改文档/history。
- Focused validation: `npx vitest run tests/unit/componentPackageManagement.test.tsx`；新增直接 UI fixture 覆盖 component ID 与 location blockId 不同、stale active surface、无有效 location 三个分支，并断言实际 Flow selection 与成功/失败反馈。
- S2 safety / rollback: 回滚起点 `3780090`；定位路径只读，不触碰用户文件、文档内容或 history；独立 Reviewer 复核 Flow surface 路由与“先报成功后 no-op”反例。
