# repair-cap-01-honest-project-health 收窄未兑现的 Project Health 声明

- Status / Owner: queued /
- Risk / Hotspot: S1 / none
- Outcome / Why now: 能力索引不再把当前 CLI 尚未提供的全工程语义分析笼统声明为 `project-health`；当前生成器仍在 `scripts/generate-ai-capabilities.ts:1067` 输出该项，机器 freshness 通过但语义不真实。
- Write scope / Baseline: baseline `b967c96`; `scripts/generate-ai-capabilities.ts`、`artifacts/ai-capabilities/**`、直接能力索引测试；不得修改 validator、Schema 或产品运行代码。
- Acceptance: `validation.checks` 只列当前 CLI 实际可达检查；宽泛 `project-health` 在 V9 collector 真正接线前不存在；生成物确定且能力文档无相反声明。
- Focused validation: `npm run generate:ai-capabilities && npm run check:ai-capabilities`; `npm run test:capabilities`。
