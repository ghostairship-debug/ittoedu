# r11-014-media-design-component-consumers｜迁移 Media/Design/Component consumer

- Release / Dependencies: 1.1 / r11-012-published-v2-schema-independence
- Write locks: `contracts-schema`
- Inventory access: read
- Preservation: PM-01, PM-07, PM-13–PM-16, PM-18, PM-28

## Outcome / current evidence

素材元数据、音频设置、Design Tokens、组件包元数据与组件实例 consumer 只依赖正式领域/V9/Component V4 合同；保存字节、替换历史、宿主能力和设计结果不变。

## Read first

- `src/shared/contracts/media-v1/index.ts`
- `src/shared/contracts/design-v1/index.ts`
- `src/shared/contracts/component-v4/types.ts`
- `src/renderer/media/courseMediaLibraryImport.ts`
- `src/renderer/components/courseComponentPackageTransactions.ts`
- `src/renderer/project/v9AssetAdapter.ts`

## Exact targets

| Group | Exact consumers | Sole contract / preserved behavior |
|---|---|---|
| Media/asset | `courseMediaLibraryImport.ts`, `v9AssetAdapter.ts`, `assetManager.ts` | `media-v1` + V9 asset；import/replace/sidecar bytes/history |
| Design | `src/renderer/ui/DesignTokensEditor.tsx` | `design-v1`；token value/default/preview 不变 |
| Component metadata transaction | `componentPackageStore.ts`, `courseComponentPackageTransactions.ts`, `importComponentPackage.ts` | `component-v4`；document + package bytes 单事务 |
| Published component host type imports | `src/player/surfaces/publishedComponentMount.ts`, `ComponentAuthoringTargetRegistry.ts` | Published V2 + Component V4；identity/lifecycle/API 不变 |

执行者不得处理表外 Component/Runtime host 或 1.4 才解决的 registry identity、asset closure、lifecycle 缺口。

## Write scope

只允许修改 Exact targets 中的精确文件和 `designTokens.test.tsx`、`assetReferences.test.ts`、`courseComponentPackageTransactions.test.ts` 的直接断言。禁止修改共享 inventory、表外 host、package/archive 字节、组件 API、网络权限、Registry identity、生命周期或 UI 工作流。

## Execution

1. 按 Exact targets 四行顺序验证当前 import；只替换仍从 `projectTypes.ts` 取得表中原语的路径。
2. 每组改从 sole contract import；保留 V9 `CourseAssetMeta.remote?` 与基础 AssetMeta 的现有继承/组合语义。
3. component package transaction 仍一次提交 document + bytes，替换/Undo 行为不变。
4. Player host 只接收匹配 Published/Component V4 输入，不引入 renderer Store。
5. 更新行为测试，确认没有因 import 迁移新增复制类型；交接按 LEG ID 列出预期减少的 endpoint、replacement 与精确查询，不修改共享 inventory。

## Stop conditions

- 需要改变 component package、asset sidecar 或 Design Token wire。
- 发现 Registry identity/direct asset closure/lifecycle 缺口；这些属于 1.4 独立硬门，记录后停止扩面。
- 迁移会删除当前宿主网络或桌面能力。

## Acceptance

- 已迁移 consumer 不再从 `projectTypes.ts` 取得 Media/Design/Component 定义。
- 组件导入/替换、素材引用/替换、资源历史与设计 token 行为不变。
- 正式合同无重复 owner，LEG endpoint 在当前树中可验证减少；共享 inventory 留待 r11-053 原子复核。

## Focused validation

- `npx vitest run tests/unit/designTokens.test.tsx tests/unit/assetReferences.test.ts tests/unit/courseComponentPackageTransactions.test.ts`
- `npm run typecheck`

## Rollback / handoff

按领域组回滚 import/owner 切换；保留已通过的其他组。交接分别列出 Media、Design、Component 的剩余旧 consumer。
