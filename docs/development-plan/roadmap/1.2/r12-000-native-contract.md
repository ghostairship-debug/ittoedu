# r12-000-native-contract｜定义 Table / Chart 的 V9 Native 严格分支与 Published V2 窄增量

- Release / Dependencies: 1.2 / none
- Write locks: `contracts-schema`
- Inventory access: none

## Outcome / current evidence

Course Project V9 当前 `NativeElementContent` 只有 text/formula/image/video/shape/teacher-controller，Published V2 直接消费同一 Native 内容类型。把 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §3–§4 的 Table/Chart 形状一次性落成 strict 合同，使后续 Factory/UI/Player/PPTX 节点没有字段设计权。

## Read first

- `src/shared/contracts/native-v1/types.ts`
- `src/shared/contracts/native-v1/schema.ts`
- `src/shared/contracts/course-project-v9/types.ts`
- `src/shared/contracts/course-project-v9/schema.ts`
- `src/shared/contracts/published-course-v2/types.ts`
- `src/shared/contracts/published-course-v2/schema.ts`
- `tests/unit/courseProjectCoreContract.test.ts`
- `tests/unit/courseProjectRoundTrip.test.ts`
- `tests/unit/publishedCourseProtocol.test.ts`

## Write scope

只允许修改上述合同/fixture/目标测试、`docs/contracts/V9_COMPATIBILITY_POLICY.md` 与 `artifacts/contracts/**`。为让穷尽 consumer 编译，可在其现有 switch 加入带稳定错误码的 explicit unsupported 分支；不得实现 UI、renderer 或导出，也不得修改旧 Native 字段。

## Execution

1. 按实施合同完整定义 Table 与 Chart 类型、strict schema、边界和交叉不变量；不得先用 `Record<string, unknown>` 或可选核心字段占位。
2. 把两个分支同时接入 V9 与 Published V2 schema、barrel、生成合同和 fixture builder；限定为 Slide scene/Slide surface，Flow/Spatial/global 的反例必须定位拒绝。
3. 为旧合法 V9/Published fixtures、新分支合法 fixture、缺字段、额外字段、重复 ID、行列错位、Chart 长度/数值错误分别增加解析用例。
4. 使现有穷尽 consumer typecheck；未由后续节点交付的路径返回 `unsupported-native-table` / `unsupported-native-chart`，不得返回空元素、shape 或截图。
5. 合同提交中不混入 Factory、Store、Properties、Player 或 PPTX 实现；后续 `r12-010-table-core` / `r12-020-chart-core` 不再修改字段形状。

## Stop conditions

- 精确形状无法在 V9 additive strict union 内表达，或需要改变既有 Native/presentation override 语义。
- Published 必须升级 V3、旧 fixture 不能保持，或只能靠 passthrough 让全仓编译。
- Table/Chart 必须进入 Flow/Spatial/global 才能让现有 consumer 工作。

## Acceptance

- 新旧合法 fixture 严格通过；每类非法 fixture 以精确 path 失败。
- V9 与 Published 类型语义对等，版本号不变；旧 reader 反例 fail loud。
- 全仓 typecheck 通过，所有尚未交付 consumer 明确 unsupported，没有 silent omission。

## Focused validation

- `npm run check:contracts`
- `npm run test:product -- tests/unit/courseProjectCoreContract.test.ts tests/unit/courseProjectRoundTrip.test.ts tests/unit/publishedCourseProtocol.test.ts`
- `npm run typecheck`

## Rollback / handoff

合同、fixture、生成制品和 unsupported consumer 作为一个原子纵切回滚。交接给 `r12-010-table-core` / `r12-020-chart-core` 时列出最终导出的类型/schema symbol 与合法/非法 fixture 名称，不留字段 TODO。
