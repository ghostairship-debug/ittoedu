# r11-061-no-regression-candidate｜最终一次无回归检查

- Release / Dependencies: 1.1 / r11-060-zero-gate
- Write locks: `none`
- Inventory access: read
- Preservation: PM-01–PM-28

## Outcome / current evidence

产品与测试不再变化后，由 Codex 只做一次最终集成验证。本节点不生成 candidate Hash/report，不运行 installer release verifier，不重复运行各实施卡 focused tests。

## Execution

1. `npm run typecheck`。
2. `npm run test:product`。
3. `npm run check:preservation`。
4. Codex 审查最终 diff，确认 Flow→DOCX、Slide/Spatial→PPTX、保存/恢复、三 Surface、Player、Runtime/Component 与适用导出没有明显遗漏。

任一失败返回首个最小责任卡；修复后只重跑受该修复影响的最终命令。自动化通过只授予 engineering candidate，不自动发布。

## Write scope

默认只读。发现缺陷时结束本节点并新建精确返工卡；禁止在最终门现场顺手修改产品或断言。

## Stop conditions

- 工作树仍有未归属产品改动。
- 任一命令失败或出现新增 flaky；flaky 只原样重跑一次。

## Acceptance

- typecheck、全量产品测试和保全门在同一最终代码上通过。
- Codex 复查无未处理高优先级问题。
- 明确标记为 engineering candidate，等待 Owner 062。

## Focused validation

- `npm run typecheck`
- `npm run test:product`
- `npm run check:preservation`

## Rollback / handoff

失败不形成候选；返回最小责任卡。通过后只解锁 r11-062。
