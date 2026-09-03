# r11-012-published-v2-schema-independence｜解除 Published V2 对旧工程模型的依赖

- Release / Dependencies: 1.1 / r11-011-v9-native-schema-independence
- Write locks: `contracts-schema`, `published-producer`
- Inventory access: read
- Preservation: PM-02, PM-17–PM-23, PM-25, PM-28

## Outcome / current evidence

Published Course V2 的类型、Schema 和 producer 只依赖正式 V9/Published/Native/Media/Design/Playback 合同，不经过 V8 `ProjectDocument`、`SceneNode` 或 `projectSchema`；V2 wire 不变。

### 2026-09-03 reopened evidence

当前 parser 仍把 Published 数据 hydrate 成 `CourseProjectDocument`，填造 author assets/components 后调用 `courseProjectDocumentSchema.safeParse`。本节点必须让 Published V2 直接验证自身 strict 结构与 reference/order/teacher-controller 等语义不变量；只允许复用不依赖作者文档的纯中性 helper，禁止任何 Published→CourseProjectDocument hydration。

## Read first

- `src/shared/contracts/published-course-v2/types.ts`
- `src/shared/contracts/published-course-v2/schema.ts`
- `src/renderer/export/course/buildPublishedCourse.ts`
- `src/shared/publishedLessonTypes.ts`
- `tests/unit/publishedCourseProtocol.test.ts`
- `tests/unit/buildPublishedCourseV2.test.ts`

## Write scope

允许修改 Published V2 types/schema、V9→V2 producer、正式领域合同 imports、目标测试和生成合同。禁止增加 Published V3、改变 V2 formatVersion/wire、恢复 legacy payload fallback 或修改 Player 行为。

## Execution

1. 替换 Published types/schema 对 `projectTypes.ts` / `projectSchema.ts` 的 import，使用 r11-010/011 的正式 owner。
2. 确认 `PublishedNativeLayerItem.content` 与 V9 Native content 使用同一 strict 定义，不复制第二份 union。
3. 将 Playback/Design/Media/Component 元数据从对应正式合同导入。
4. producer 保持 authoring→Published 单向；删除 parser 中的 `CourseProjectDocument`、`courseProjectDocumentSchema` 与 `hydrate*` authoring conversion，不构造假的 author assets/components。
5. 对旧 V2 fixture、全局层、Flow/Spatial、Runtime/Component、duplicate ID、reference/order、teacher-controller 语义和未知字段做成对解析测试。

## Stop conditions

- 需要改 formatVersion 或删除当前 V2 字段。
- 为兼容旧代码而让 Published parser 接受 V8 payload。
- producer 与匹配 Player 对同一字段解释不一致。

## Acceptance

- Published V2 types/schema/producer 不 import V8 工程或旧 Scene Schema。
- Published parser 对 `CourseProjectDocument`、`courseProjectDocumentSchema` 和 authoring hydration 零命中，语义错误由 Published-owned validation 直接拒绝。
- 当前 V2 payload 字节语义与严格拒错行为不变。
- buildPublishedCourseV2 对 Slide/Flow/Spatial/Mixed 及动态 carrier 仍产出匹配 Player 可读输入。

## Focused validation

- `npx vitest run tests/unit/publishedCourseProtocol.test.ts tests/unit/buildPublishedCourseV2.test.ts tests/integration/architectureBaselineFlows.test.tsx`
- `npm run check:contracts`
- `npm run typecheck`

## Rollback / handoff

整体回滚 Published contract/producer import 迁移，不能保留双 Schema。交接列出仍引用旧 Published/Export payload 的 consumer。
