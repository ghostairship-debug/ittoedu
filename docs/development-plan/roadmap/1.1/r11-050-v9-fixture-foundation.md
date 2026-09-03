# r11-050-v9-fixture-foundation｜建立 V9/Published 测试基础

- Release / Dependencies: 1.1 / r11-011-v9-native-schema-independence, r11-012-published-v2-schema-independence
- Write locks: `generated-index`
- Inventory access: read
- Preservation: PM-02–PM-28

## Outcome / current evidence

所有仍受支持的行为测试都能从明确的 Course Project V9 / Published V2 fixture 和 sidecar/component bytes 构造输入，不需要 V8 Project/Scene factory。当前已有 V9 fixture，但旧 Player/Export/Archive tests 仍依赖 `tests/helpers/projectV8.ts`。

## Read first

- `tests/fixtures/course-project-v9/sources.ts`
- `tests/fixtures/architecture-baseline/`
- `scripts/build-architecture-baseline-fixtures.ts`
- `tests/unit/architectureBaselineFixtures.test.ts`
- `tests/unit/courseProjectRoundTrip.test.ts`
- `tests/unit/buildPublishedCourseV2.test.ts`

## Exact targets

| Fixture source | Required IDs / files | Direct consumers to preserve |
|---|---|---|
| `tests/fixtures/course-project-v9/sources.ts` | `slide-native`, `slide-presentation-state`, `global-layer-teacher-controller`, `canvas-runtime`, `surface-runtime`, `component`, `flow`, `spatial`, `mixed`, `multi-asset` | V9 round-trip、Published producer、Player/export unit tests |
| `tests/fixtures/architecture-baseline/manifest.json` + builder | `slide-heavy.h5lesson`, `flow-heavy.h5lesson`, `mixed-spatial.h5lesson` | architecture baseline flows、Owner 1.1 matrix |
| `examples/render-host-benchmark/` | `render-host-benchmark-v9.h5lesson`, `project-v9.json`, `published-v2.json`, `render-host-benchmark-v2.html` | example check、Runtime/Component/离线 HTML release carrier |
| V8 rejection input | 最小原始 bytes，仅表达 schemaVersion/损坏类别 | r11-051/052 的 unsupported/corrupt fail-loud；不得 import `projectV8.ts` |

上述 ID 与文件集合固定；执行者不得自行新增无 consumer 的 fixture 或把缺口改成静态截图。

## Write scope

只允许修改表中 source/builder/manifest/fixture、`tests/unit/architectureBaselineFixtures.test.ts`、`tests/unit/courseProjectRoundTrip.test.ts`、`tests/unit/buildPublishedCourseV2.test.ts`，以及由表中现有 generator 产生的 tracked files。禁止修改产品代码、Schema、其他 tests、测试断言结果、生成无 consumer 的制品或用静态占位替代 Runtime/Component。

## Execution

1. 为 Exact targets 表中每个固定 ID 建立 PM-02–PM-28 coverage：Slide/Flow/Spatial/Mixed、六种 Native、global/surface、状态/互动、Component/Runtime、网络、各导出；缺口绑定到现有最接近 ID，不现场发明新体系。
2. 只扩展现有 V9 source factory；document、asset bytes、component files 与 expected Published input 使用稳定 ID 和确定性数据。
3. dynamic carrier fixture 必须运行真实 host 协议并带静态后备；禁止只保存截图。
4. fixture 生成器不得写 HEAD/时间/绝对路径；相同输入产生稳定语义。
5. 在 `architectureBaselineFixtures.test.ts` 与 `buildPublishedCourseV2.test.ts` 逐项实例化固定 ID，证明 document/sidecar/component bytes 能保存重开并生成 Published；旧 helper consumer 的语义分类和迁移只由 r11-052 执行。

## Stop conditions

- 某受支持行为无法由当前 V9/Published 合同表达。
- 需要修改产品 Schema、删除断言或把动态内容静态化。
- 生成制品没有真实测试/release consumer。

## Acceptance

- Exact targets 的固定 ID 逐项有 PM coverage 与直接 consumer，不新增孤儿 fixture。
- fixture 不 import V8 Project/Scene/helper，包含真实 sidecar/component bytes。
- 保存重开、Published、Player/导出 fixture 的 stable identity 一致。

## Focused validation

- `npx vitest run tests/unit/architectureBaselineFixtures.test.ts tests/unit/courseProjectRoundTrip.test.ts tests/unit/buildPublishedCourseV2.test.ts`
- `npm run check:examples`

## Rollback / handoff

回滚本任务新增 source/fixture 和试迁测试；不要回滚既有 V9 fixtures。交接按待迁测试列出可复用 fixture ID。
