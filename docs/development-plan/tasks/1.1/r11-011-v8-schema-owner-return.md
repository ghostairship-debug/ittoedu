# r11-011-v8-schema-owner-return V8 Schema consumer 归位

- Status / Owner: queued / Codex
- Outcome / Evidence: 消除 r11-053 扫描证实的 live Native/Playback 测试与 UI consumer 对 `shared/projectSchema.ts` 的依赖，改用 Native V1 / Playback V1 的窄 Schema；V8-only archive/player/model 仍保持待删事实，不改造为双模型 helper。
- Write scope: `src/renderer/ui/FormulaAuthoringEditor.tsx`、当前直接 import `projectSchema.ts` 的受支持 Native/Playback 测试、相应最近层 fixture，以及本卡与任务板。禁止修改 V8-only Player/Archive/Model、V9/Published wire、scanner 或 inventory。
- Write locks: contracts-schema
- Acceptance: 受支持 consumer 不再 import `projectSchema.ts`；公式 AST、图片安全区与 Presenter Settings 行为不变；不新增兼容 schema 或宽松 parser。
- Validation: `npx vitest run tests/unit/formulaLinear.test.ts tests/unit/imageSafeAreas.test.tsx tests/unit/presenterSettingsUi.test.tsx` 与 `npm run typecheck`。
