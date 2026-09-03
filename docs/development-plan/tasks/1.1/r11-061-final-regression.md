# r11-061-final-regression 1.1 最终回归与保全

- Status / Owner: active / Codex
- Outcome / Evidence: 在最终产品代码与 Legacy inventory 冻结后，依次完成类型、全量产品行为与保全门，形成 1.1 engineering candidate 的最终自动化证据。
- Write scope: 产品树只读验证；当前失败只允许修改 `src/renderer/{runtime,interactions}/commit*Authoring.ts` 的 history-entry 端口语义、Published authoring 重挂载的直接责任 Owner、对应最近层测试及必要生成物；本卡与任务板。
- Write locks: editor-store-history
- Acceptance: `typecheck`、`test:product`、`check:preservation` 全部成功；失败修复后只重跑被改动影响的最终命令，未弱化断言、timeout 或 retry。
- Validation: 最终代码不再变化后各运行一次 `npm run typecheck`、`npm run test:product`、`npm run check:preservation`。
