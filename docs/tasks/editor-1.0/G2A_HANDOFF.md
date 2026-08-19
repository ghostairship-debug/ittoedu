# G2A HANDOFF

- 范围：打包 G2+G3 所需的可选字段（`TextRunStyle` / `flowTextRunStyleSchema` / `textRunStyleSchema` 的 `fontFamily?` 与 `fontSize?`；Flow heading/paragraph/quote 块的 `textAlign?` 与 `lineSpacing?`；`FlowMediaBlock` 与 `FlowComponentBlock` 的 `wrap?`；`LayerItemBase` 与 `PublishedLayerItemBase` / `publishedLayerBaseFields` 的 `paperSpace?`；`textLayout.ts` 的 `Required<TextRunStyle>` 缺省补齐与 `textRuns.ts` 的 `normalizeStyle` 拷贝）。保持 `.strict()`，无 `.passthrough()` / `z.unknown()`。
- 合同是否变化：是（只增量添加可选字段，保持向后兼容，缺省行为等同原有行为）。
- 分支 / SHA：`cursor/g2a-additive-schema-0ab9` / 见 git 提交。
- 允许列表外改动（必须空，除非重命名机械 import）：无。
- 最小验证命令与结果：
  - `npm run generate:contracts`：通过，已生成 4 个合同产物文件。
  - `npx tsx scripts/generate-contracts.ts --check`：通过（合同 JSON 快照已是最新状态；共 4 个合同产物文件通过校验）。
  - `npx vitest run tests/unit/courseProjectCoreContract.test.ts`：通过（10 passed）。
  - `git diff --check`：通过（无空白或格式异常）。
  - 注：基线集成分支 `cursor/flow-near-word-g-0ab9` 上的 `tests/unit/flowUnifiedLayerEntry.test.tsx` 存在来自上游 G1C 合入时的 TypeScript 类型比较问题（`focus === 'blocks'`），未在本卡修改该测试文件，严格遵守文件防火墙。
- 未验证（交给 T6）：UI 交互、全量 e2e 测试与 desktop build。
- 停下来的原因（若有）：无。
- 下游：G2/G3 后续车道（可直接基于这些已声明的可选 Schema 字段开展排版与图层定位实现）。
