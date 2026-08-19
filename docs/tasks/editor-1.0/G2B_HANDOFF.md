# G2B HANDOFF
- 范围：父代理外科合入工人 G2B 的字体/字号/段级对齐/行距，**拒绝整支 merge**。工人 `b813e50` 删了 G0B 稿纸滚轮/拖拽、`wideContentWidth` 三档宽度、G1B 引用下拉 `convert-quote`、浮层 chrome 与对应单测。
- 合同是否变化：否
- 分支 / SHA：合入 `cursor/flow-near-word-g-0ab9`（工人枝 `cursor/g2b-flow-font-ui-0ab9` 仅作参考，不要整支快进）
- 允许列表外改动：`FlowWorkspace.tsx` 仅 heading/paragraph/quote idle `textAlign`/`lineHeight`（G1E 已合入，补工人防火墙里被迫跳过的编辑态段级样式）；`flowWorkspace.test.tsx` / `flowSurfaceHost.test.ts` 加锁 G0 滚动与段级样式
- 最小验证命令与结果：待跑 `flowProductIntegration` + `flowWorkspace` + `flowSurfaceHost`
- 未验证（交给 T6）：桌面/e2e
- 停下来的原因（若有）：工人实现降级，父代理手工接线
- 下游：G3B wrap + paperSpace；禁止再删 `article` wheel/pointer 滚动与三档 maxWidth
