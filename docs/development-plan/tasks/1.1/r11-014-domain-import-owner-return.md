# r11-014-domain-import-owner-return 领域合同 consumer 归位

- Status / Owner: queued / Codex
- Outcome / Evidence: 消除 r11-053 首次扫描证实的 live V9/Published consumer 对 `shared/projectTypes.ts` 中 Media、Design、Component V4 与 Playback 原语 re-export 的直接依赖，改从各自正式合同唯一 Owner 读取；不改 archive/package 字节、wire、历史、宿主能力或 UI 行为。
- Write scope: 仅修改当前直接 import `shared/projectTypes.ts` 且所需符号已由 `contracts/media-v1/**`、`design-v1/**`、`component-v4/**` 或 `playback-v1/**` 定义的 Player、Renderer、Shared 与直接测试 caller，以及本卡与任务板。禁止修改 V8-only Player/Export/Shared 模块、Schema、scanner、inventory、组件 API 或 Registry identity。
- Write locks: contracts-schema
- Acceptance: 对应 caller 只从正式领域合同 import，无复制类型或 re-export 兼容层；素材、组件包、Design Token、音频与演示者设置的直接测试和 TypeScript 检查通过。
- Validation: `npx vitest run tests/unit/designTokens.test.tsx tests/unit/assetReferences.test.ts tests/unit/courseComponentPackageTransactions.test.ts tests/unit/mediaTab.test.tsx tests/unit/courseRuntimeTransactions.test.ts` 与 `npm run typecheck`。
