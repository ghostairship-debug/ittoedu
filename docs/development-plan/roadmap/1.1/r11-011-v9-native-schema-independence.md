# r11-011-v9-native-schema-independence｜解除 V9 Native 对旧 Scene Schema 的依赖

- Release / Dependencies: 1.1 / r11-010-domain-contract-extraction
- Write locks: `contracts-schema`
- Inventory access: read
- Preservation: PM-02, PM-07–PM-09, PM-26, PM-28

## Outcome / current evidence

Course Project V9 的 `NativeElementContent`、strict parser、presentation `nativeData` 合并校验与 render materializer 直接使用 V9 Native 合同，不再借 `sceneNodeSchema` / `SceneNode` 校验或表达。1.1 wire 完全不变，并为 1.2 Table/Chart strict 分支留下正确扩展点。

## Read first

- `src/shared/contracts/course-project-v9/types.ts`
- `src/shared/contracts/course-project-v9/schema.ts`
- `src/shared/projectSchema.ts`
- `src/shared/presentation.ts`
- `tests/unit/courseProjectCoreContract.test.ts`
- `tests/unit/courseProjectRoundTrip.test.ts`

## Write scope

允许修改 Course Project V9 types/schema、正式 Native v1 types/schema、V9 materializer/override helper 和目标测试/生成合同。禁止新增 Table/Chart、改变任何现有 native discriminator/字段、把新分支塞入 `SceneNode`、使用 passthrough 或允许未知字段。

## Execution

1. 为 text/formula/image/video/shape/teacher-controller 建立各自 strict content schema，并复用正式领域子 schema。
2. 将 `NativeElementContent` 改为不经过 `NativeNodeData<SceneNode>` 的显式联合；类型结构须与当前 wire 等价。
3. 将 `materializeNativeLayerItem` 的输出改成只读 render input，不再声明为旧 `SceneNode`。
4. presentation override 先深合并 base V9 native data，再按对应 discriminator 的 V9 schema 严格校验；公式 AST 分支替换规则保持。
5. 更新 JSON Schema/合同测试，加入未知字段、跨 discriminator override 和 round-trip 反例。

## Stop conditions

- 任何旧 V9 fixture 的解析结果或缺省语义改变。
- 需要 `.passthrough()`、`z.unknown()` 透传或把新类型写入 `SceneNode`。
- render consumer 要求可写或持久化的旧节点对象。

## Acceptance

- V9 types/schema 不 import `SceneNode`、`BaseNode` 或 `sceneNodeSchema`。
- 命名状态 `nativeData` 对六种现有分支均严格往返；非法字段 fail-loud。
- 现有 V9 archive、Player/导出输入和生成合同保持可用。

## Focused validation

- `npx vitest run tests/unit/courseProjectCoreContract.test.ts tests/unit/courseProjectRoundTrip.test.ts`
- `npm run check:contracts`
- `npm run typecheck`

## Rollback / handoff

整体回滚 V9 Native schema/materializer 切换；不得保留一半旧 parser、一半新 type。交接列出尚消费 render input 的旧 Scene consumer。
