# r11-010-domain-contract-extraction｜抽取仍有效的领域合同

- Release / Dependencies: 1.1 / r11-002-legacy-inventory-zero-check
- Write locks: `contracts-schema`
- Inventory access: read
- Preservation: PM-02, PM-07, PM-09, PM-13–PM-16, PM-28

## Outcome / current evidence

Native、Design、Media、Playback 与 Component 元数据等仍有效原语由各自正式合同拥有；`projectTypes.ts` 不再是 V9 合同的事实 owner。wire、默认值和公共导出保持不变。

### 2026-09-03 reopened evidence

类型 owner 已建立，但 `contracts/course-project-v9/schema.ts` 仍本地复制 Asset、Component、Design、Media 与 Playback schema；`media-v1` 和 Component embedded metadata 的对象 strictness 也未闭合。先用现有 V9 fixture/边界测试冻结 accepted-value、default 与 optionality，再让五个正式 owner 的 strict schema 与当前 V9 支持域等价；禁止直接换 import 后缩窄旧 V9 可读集合。

## Read first

- `src/shared/projectTypes.ts`
- `src/shared/contracts/native-v1/index.ts`
- `src/shared/contracts/design-v1/index.ts`
- `src/shared/contracts/media-v1/index.ts`
- `src/shared/contracts/course-project-v9/types.ts`
- `src/shared/contracts/component-v4/types.ts`

## Exact targets

| Source definitions in `projectTypes.ts` | Sole target owner | First consumers to switch |
|---|---|---|
| `TextAlign` through `TeacherControllerNode`, shape constants/helpers | `contracts/native-v1/types.ts`, `schema.ts`, `index.ts` | Course Project V9 types/schema、Published V2 types/schema |
| `ProjectFontToken`, `ProjectColorToken`, `ProjectDesignTokens` | `contracts/design-v1/types.ts`, `schema.ts`, `index.ts` | V9/Published contracts |
| `AssetKind`, `AudioChannel`, `SoundDefinition`, `ProjectAudioSettings`, `ProjectMediaSettings`, `AssetMeta`, `RuntimeAsset`/map | `contracts/media-v1/types.ts`, `schema.ts`, `index.ts` | V9/Published contracts |
| `ProjectPlaybackSettings`, `PresenterCommand`, `PresenterKeyBinding`, `ProjectPresenterSettings` | 新建 `contracts/playback-v1/types.ts`, `schema.ts`, `index.ts` | V9/Published contracts |
| `EmbeddedComponentPackageMeta` | `contracts/component-v4/types.ts` + matching strict schema export | V9/Published contracts |

`ProjectDocument`、`SceneDocument`、`ScenePresentation*`、`BaseNode`、`SceneNode*`、`DeepPartial` 不在本任务移动；它们留作待删除 Legacy owner。表外类型不得由执行者自行归类。

## Write scope

只允许创建/修改 Exact targets 的五个合同目录、`projectTypes.ts` 的临时 type/value re-export、V9/Published contract imports、合同生成输入与 listed tests。禁止迁移表外 consumer、改变字段/判别器/默认值、移动 V8 Project/Scene 本体、创建 V2 Native 或 V10。

## Execution

1. 严格按 Exact targets 五行顺序处理，不重新分组；每行先复制定义到 sole owner并保持导出名/结构，再切换 first consumers。
2. 对该行补 matching strict schema（若原 schema 已存在则移动而不复制）；每一层对象 unknown field 都明确拒绝。同组常量/窄 helper 一起迁移，不跨行。
3. 让 Course Project V9、Published V2 和 Component V4 首先改从正式 owner import。
4. 切完 direct contracts 后，旧 `projectTypes.ts` 只 re-export 已搬迁原语；定义本体只能在 sole owner，避免双 owner 和循环依赖。
5. 更新合同生成追踪，证明 wire JSON 没有变化；交接列出本任务预期减少的 LEG endpoint，不修改共享 inventory。

## Stop conditions

- 需要改变 Schema、字段 optionality 或序列化结果。
- 产生 contracts → renderer、Player → renderer Store 或合同循环依赖。
- 无法确定某类型属于 V8-only 还是仍受支持领域原语。

## Acceptance

- V9/Published/Component 合同不再从 `projectTypes.ts` import 已抽取原语。
- V9 schema 不再本地定义 Asset、Component metadata、Design、Media 或 Playback schema；五组定义只由正式 owner 导出。
- 当前 V9 边界值、default、optionality 与 fixture 均保持可读，嵌套 unknown field 仍 fail loud。
- 每个原语只有一个定义 owner；临时 re-export 不含复制类型。
- 合同产物语义不变，现有 V9 工程与 Published V2 payload 仍严格解析。

## Focused validation

- `npx vitest run tests/unit/courseProjectCoreContract.test.ts tests/unit/courseProjectTopLevelFields.test.ts`
- `npm run check:contracts`
- `npm run typecheck`

## Rollback / handoff

按原语组回滚 import 与 owner 迁移，不能只恢复一侧造成双定义。交接列出仍由 `projectTypes.ts` 拥有的 V8-only 类型和后继消费节点。
