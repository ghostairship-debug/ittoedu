# r11-040-v9-health-preflight｜统一 V9 diagnostics 与导出预检

- Release / Dependencies: 1.1 / r11-013-shared-native-consumers, r11-014-media-design-component-consumers
- Write locks: `published-producer`
- Inventory access: read
- Preservation: PM-02, PM-09, PM-16–PM-26, PM-28

## Outcome / current evidence

GUI 健康面板、CLI validate 与导航定位共享 Course Project V9 finding catalog；041–043 只把各格式 producer 事实适配到该 catalog，不复制规则。V8 `ProjectHealthDiagnostic` / `ExportPreflightReport` 不再是产品真相；1.1 已可保存的 preflight JSON 保持现有外部字段、code、severity、target 与文案语义，由 V9 adapter 产生。

### 2026-09-03 reopened evidence

V9 finding catalog、GUI 与 CLI 主体可保留，但 live saved-report 合同仍导出 `ExportPreflightReport` 且声明 `schemaVersion: 8 | 9`；直接 consumer 位于 `useCourseDelivery.ts` 与 `ExportPreflightDialog.tsx`。本节点把它迁为明确 V9-only `CourseProjectExportPreflightReportV1`（或等价窄名称），`schemaVersion` 固定为 9，同时保持 reportVersion、字段、code/severity/target/message 与排序不变。

## Read first

- `src/shared/courseProjectHealth/`
- `src/shared/projectHealth.ts`
- `src/shared/projectDiagnostics.ts`
- `src/renderer/export/exportPreflight.ts`
- `src/renderer/ui/ExportPreflightDialog.tsx`
- `src/renderer/diagnostics/projectHealthNavigation.ts`
- `scripts/validate-project.ts`
- `scripts/generate-ai-capabilities.ts`
- `artifacts/ai-capabilities/diagnostics.json`

## Exact targets

| Owner | Exact target | Fixed result |
|---|---|---|
| Finding catalog | `src/shared/courseProjectHealth/**`, `courseProjectValidationDiagnostics.ts` | V9 document/sidecar facts → stable code, severity, canonical target, message params；不包含格式 UI |
| GUI/navigation | `ProjectHealthPanel`, `ExportPreflightDialog`, `projectHealthNavigation`, `useCourseDelivery.ts` | 同一 finding 可显示、分组并跳到正确 Surface/object；无旧 project fallback |
| CLI/archive | `scripts/validate-project.ts`, `validateProjectArchiveBytes` 的 V9 branch | 同一 code/severity/target；unsupported 与 corrupt 分离 |
| Saved report adapter | `exportPreflight.ts` 的 `CourseProjectExportPreflightReportV1` common report shape | `schemaVersion: 9`；1.1 保持当前可保存 JSON 其余外部字段与排序；内部 input 为 V9 findings |
| Capability consumer | generator + diagnostics artifact | 仅发布 catalog 中真实存在的 code；生成检查一致 |

041/042/043 分别拥有 PPTX、PDF、HTML/Web 的 producer-specific adapter；本任务不得接线这些格式，也不得自行判断删除既有 finding。

## Write scope

只允许修改表中 exact target、对应直接测试和真实 generator 输出。禁止修改共享 inventory、PPTX/PDF/HTML/Web producer adapter、改变导出格式或已保存 report shape、删除/降级现有 finding、把合法远程资源定义为错误、恢复 V8 input 或预建通用诊断框架。

## Execution

1. 从现有 `projectHealth`、`exportPreflight` 与 capability artifact 枚举全部 code，固定每个 code 的现有 severity、target、message params、GUI/CLI 可见性和适用 consumer；不允许执行者现场决定“仍有意义”。
2. 将清单逐项迁入现有 Course Project health/validation 模块，输入必须是 V9 document + sidecar/common context；V9 暂无事实的 code 立即停止并列出缺口，不删除它。
3. 各 consumer 只适配显示/格式，不复制诊断规则；网络 finding 比较声明与使用，不禁止合法 origin。
4. GUI、navigation、CLI/archive 与 saved-report adapter 切换到 catalog；sessionless/headless 显式要求 V9 input，不读 `state.project` fallback。041–043 再接各格式 context。
5. 更新 capability generator/artifact；交接列出 LEG-006/007 预期减少的 endpoint、replacement 与精确查询，不修改共享 inventory。旧模块留待 r11-054 在 r11-053 复核为零后删除。

## Stop conditions

- 某 finding 只能通过旧 Scene/Project 获得且没有 V9 等价事实。
- 迁移会改变导出阻断/警告等级或隐藏用户可见错误。
- 需要修改 Schema 或静默忽略未知 carrier。

## Acceptance

- GUI/CLI/common report 使用同一 V9 diagnostic truth 与稳定定位；041–043 有固定 adapter 合同可接。
- 当前 finding、warning/blocking 行为不减少；unsupported fail-loud。
- 已保存 preflight JSON 的 1.1 外部 shape/code/severity/target 不变，capability artifact 与 catalog 一致。
- 产品闭包对旧 `ExportPreflightReport` symbol 与 `schemaVersion: 8 | 9` 零命中；UI 与 delivery consumer 使用 V9-only report type。
- LEG-006/007 的产品 consumer 可验证下降。

## Focused validation

- `npx vitest run tests/unit/courseProjectHealth.test.ts tests/unit/courseProjectValidationDiagnostics.test.ts tests/unit/exportPreflightUi.test.tsx`
- `npx vitest run tests/unit/projectHealthNavigation.test.ts tests/unit/validateProject.test.ts tests/unit/courseSlidePreflightParity.test.ts`
- `npm run check:ai-capabilities`

## Rollback / handoff

按 consumer 回滚 adapter，保留单一旧诊断路径直至等价；不得双跑后合并结果。交接列出无法从 V9 取得的精确 finding。
