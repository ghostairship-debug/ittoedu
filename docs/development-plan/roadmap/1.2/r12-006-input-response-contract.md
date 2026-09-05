# r12-006-input-response-contract｜定义 Native input、input.submit 与 Published V2 对等严格分支

- Release / Dependencies: 1.2 / none
- Write locks: `contracts-schema`, `published-slide`, `published-interaction`
- Inventory access: none

## Outcome / current evidence

当前 Native union 没有 input，Interaction controller 也只绑定 click/audio/video。按 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §5 一次落定 input、`input.submit`、归一化、descriptor port 与 fail-loud consumer；本节点不交付教师 UI 或真正执行规则。

## Read first

- `src/shared/contracts/native-v1/types.ts`
- `src/shared/contracts/native-v1/schema.ts`
- `src/shared/contracts/interaction-v1/types.ts`
- `src/shared/contracts/interaction-v1/schema.ts`
- `src/shared/assessmentEvaluators.ts`
- `src/player/interactions/PublishedInteractionSurfacePort.ts`
- `src/player/interactions/PublishedInteractionController.ts`
- `src/player/surfaces/slide/SlidePublishedAdapter.ts`
- `tests/unit/interactionSchema.test.ts`
- `tests/unit/interactionDiscriminatorContract.test.ts`
- `tests/unit/assessmentEvaluators.test.ts`

## Write scope

允许修改 input/interaction 相关 contract、barrel、fixture、V9/Published semantic validator、共享答案归一化、Surface port 类型，以及 Slide/Controller 中为 typecheck 必需的 explicit unsupported 分支。禁止实现 input DOM、Store command、规则族 UI、batch 写入或 PPTX。

## Execution

1. 按实施合同定义 strict `NativeInputContent`、style 与 `InputSubmitTrigger`；登记 V9/Published matching branch，版本号不变。
2. 在语义校验中强制 scene-local Slide、两个已声明且类型匹配的 key、真实 input target 与 family ID 引用；为 Slide surface/Flow/Spatial/global 逐一增加拒绝反例。
3. 抽取共享 text/number normalization 纯函数，旧 assessment evaluator 复用同一 text 函数；把合同中的 number grammar 做成表驱动测试。
4. 在 Surface port 定义 `PublishedInputDescriptor`、`describeInput` 与 `bindInputSubmit`，返回约定统一为 disposer 或 null；不加入 DOM read API。
5. Controller 识别该 trigger，但 delivery 未落地前以稳定 `unsupported-trigger`/`bind-unavailable` 诊断 fail loud；Slide renderer/adapter 的穷尽分支同样显式失败，确保 typecheck 通过。
6. 更新兼容政策、生成合同、旧 reader 反例与新 fixture；不得在本节点生成能力索引。

## Stop conditions

- 必须新增“答案正确”条件、修改 `course-state.set`、查询任意 DOM 值或修改 `InteractionEngine`。
- input 不能被限制为 Slide scene，或需要在 content 重复保存 layerItemId/frame。
- 只能用 optional bag/passthrough 或升级 V10/Published V3 才能表达。

## Acceptance

- 旧 fixture 继续通过；input/trigger 合法 fixture 通过；缺字段、额外字段、错 key 类型、错容器、错 target 分别定位拒绝。
- 归一化表与实施合同一致，V9/Published 对等，未交付 consumer 全部 fail loud。
- `npm run typecheck` 通过；本节点没有可点击的半成品 UI，也没有生成索引写入。

## Focused validation

- `npm run check:contracts`
- `npm run test:product -- tests/unit/interactionSchema.test.ts tests/unit/interactionDiscriminatorContract.test.ts tests/unit/assessmentEvaluators.test.ts tests/unit/courseProjectCoreContract.test.ts tests/unit/courseProjectRoundTrip.test.ts`
- `npm run typecheck`

## Rollback / handoff

合同、validator、fixture、port 类型与 unsupported consumers 整体回滚。交接 `r12-007-input-response-delivery` 时列出 input/trigger schema symbol、normalizer、descriptor port 和全部稳定诊断码。
