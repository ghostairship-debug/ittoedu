# r11-052k-ai-capability-owner-evidence AI 能力证据 Owner 收口

- Status / Owner: queued / unassigned
- Outcome / Evidence: 修正 AI 能力生成器、测试和生成物中仍把待删除 V8/旧 Player 模块列作当前来源或刻意保留为字符串的证据；能力清单只声明 V9 正式合同、当前 Published Player Owner 与真实 headless build 入口。
- Write scope: `scripts/generate-ai-capabilities.ts`、`tests/unit/aiCapabilities.test.ts`、`artifacts/ai-capabilities/**`、必要的同伴能力生成测试、本卡与任务板。禁止修改运行时产品行为、schema 语义、scanner、inventory、timeout/retry 或 V8 拒绝行为。
- Write locks: generated-index
- Acceptance: 来源闭包与显式 capability source 不再包含 `projectTypes.ts`、旧 Project archive/validator、旧 Player kernel/app；生成物由正式命令确定性刷新，能力摘要、Schema 和协议版本保持不变。
- Validation: `npm run generate:ai-capabilities`、`npm run check:ai-capabilities`、`npm run test:capabilities`、`npm run typecheck`。
