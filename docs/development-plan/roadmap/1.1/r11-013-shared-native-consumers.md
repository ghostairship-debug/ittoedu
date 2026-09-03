# r11-013-shared-native-consumers｜迁移共享 Native consumer

- Release / Dependencies: 1.1 / r11-012-published-v2-schema-independence
- Write locks: `contracts-schema`, `workspace-properties`
- Inventory access: read
- Preservation: PM-03–PM-09, PM-13, PM-17–PM-18

## Outcome / current evidence

文本、富文本、公式、图形、教师控制器、动画与素材引用等跨 Editor/Player 的共享 consumer 从正式 Native/V9 合同读取，不再因复用有效原语而 import 整个旧工程类型文件。

## Read first

- `src/shared/contracts/native-v1/index.ts`
- `src/shared/textRuns.ts`
- `src/shared/formulaRenderer.ts`
- `src/shared/teacherControllerConsistency.ts`
- `src/shared/assetReferences.ts`
- `src/shared/playerAuthoringProtocol.ts`

## Exact targets

| Semantic group | Exact consumer files | Required imports |
|---|---|---|
| Text/runs/layout | `textRuns.ts`, `textLayout.ts` | `contracts/native-v1` Text types |
| Formula | `formulaLinear.ts`, `formulaRenderer.ts` | Native Formula AST/Node types |
| Shape | `canvasShapeRenderer.ts`, `phaserShapeRenderer.ts` | Native Shape types/constants |
| Teacher controller | `teacherControllerConsistency.ts`, `teacherControllerLayout.ts` | Native controller action/button/node |
| V9 assets | V9 asset closure owner 与 `tests/unit/assetReferences.test.ts` 的受支持 V9 case | `contracts/media-v1` + V9 Layer item types；Legacy `assetReferences.ts` 不改造成双模型 helper |
| V9 presentation | V9-owned presentation helper、`renderer/ui/SceneStateStrip.tsx`、`renderer/course/slideInteractionView.ts`、`tests/unit/sceneStateUi.test.tsx` | `SlidePresentation`、`SlidePresentationState`、`SlideSceneDocument`；Legacy `presentation.ts` 保持 Legacy-only |
| Authoring protocol | `playerAuthoringProtocol.ts` | V9 Native/presentation target types；不得保留完整 Scene/Project input |

表外 renderer、Player Scene、Store、Export、Archive 不属于本任务；对应后继节点处理。

## Write scope

只允许修改 Exact targets 表中的共享/V9 owner 文件、列出的 live UI consumer、它们的直接 type-only import caller与 `formulaNode.test.ts`、`textRuns.test.ts`、`teacherControllerConsistency.test.ts`、`assetReferences.test.ts`、`sceneStateUi.test.tsx`。`shared/presentation.ts` 与 `shared/assetReferences.ts` 只保留 Legacy-only 事实并交 052/054，不得扩成 V8/V9 union。禁止泛写其他 `src/shared/**`、迁移 Editor Store/Player Scene/Export/Archive 或改变运行/视觉语义。

## Execution

1. 按 Exact targets 顺序执行；live V9 consumer 需要 presentation/asset helper 时建立 V9-owned 窄 helper，不向 Legacy helper加入 V9 union。若 consumer 实际只服务 Legacy，则登记给 052/054，不自行现代化。
2. 改为从 `contracts/native-v1`、Course Project V9 或对应正式合同 import；不得从高层 barrel 反向引入 renderer。
3. 保持文本 Unicode/runs、公式 AST、Shape、teacher-controller、动画与 asset 引用的当前逻辑。
4. 每组迁移后删除旧 import，不删除旧定义文件；交接按 LEG ID 列出旧 path#symbol、replacement 与零命中查询，不修改共享 inventory。
5. 目标测试必须验证行为或结构解析，不只断言 import 字符串。

## Stop conditions

- consumer 实际需要完整 V8 Project/Scene，而非共享原语。
- import 迁移产生循环或使 Player 依赖 renderer。
- 测试差异表明 wire、布局、动画或控制器行为改变。

## Acceptance

- live V9 UI/asset/authoring protocol consumer 不再 import 或投影 Legacy Project/Scene；Legacy helper 对 V9 产品 consumer 为零，并形成 052/054 精确 handoff。
- 对应 LEG confirmed endpoint 在当前树中已消失且 replacement 路径可追溯；共享 inventory 留待 r11-053 原子复核。
- Text/Formula/Shape/Teacher controller、Slide presentation state 选择与素材删除行为不变，保存和 Undo/Redo 不降级。

## Focused validation

- `npx vitest run tests/unit/formulaNode.test.ts tests/unit/textRuns.test.ts tests/unit/teacherControllerConsistency.test.ts tests/unit/assetReferences.test.ts tests/unit/sceneStateUi.test.tsx`
- `npm run typecheck`

## Rollback / handoff

按语义组回滚 imports 与正式 owner 引用；不恢复已证明不需要的旧全工程依赖。交接列出仍需完整旧 Scene 的 consumer，交给具体 lane。
