# G2A · 一小包 additive 合同（字体/段级/绕排/paperSpace）

> 状态：**可领取**  
> 症状：G2/G3 需要可选字段；必须单独合同提交，不要混进滚动 bugfix  
> 车道：G  
> 合同变化：**是**（只 additive 可选键，`.strict()` 保留）  
> 工人先读：[02_WORKER.md](02_WORKER.md)、[G0_FLOW_NEAR_WORD_PLAN.md](G0_FLOW_NEAR_WORD_PLAN.md)、[docs/contracts/V9_COMPATIBILITY_POLICY.md](../../contracts/V9_COMPATIBILITY_POLICY.md)

## 一句话

一次打包 G2+G3 可选字段。缺了等于今天。不要改判别器、`LayerFrame.mode`、owner、统一排序。不要写 UI。

## Git

1. isolated worktree。
2. `git fetch origin cursor/flow-near-word-g-0ab9`
3. 建 `cursor/g2a-additive-schema-0ab9`
4. 合同与 `generate:contracts` 可两次 commit。push。**禁止开 PR。**
5. 写 `docs/tasks/editor-1.0/G2A_HANDOFF.md`

## 允许修改

```text
src/shared/projectTypes.ts                         仅 TextRunStyle 可选字段
src/shared/projectSchema.ts                        仅 textRunStyleSchema
src/shared/textRuns.ts                             normalizeStyle 拷贝新键
src/shared/textLayout.ts                           仅 DEFAULT_RUN_STYLE / runStyle 基线补缺省，不要改绘制算法语义
src/shared/contracts/course-project-v9/types.ts
src/shared/contracts/course-project-v9/schema.ts
src/shared/contracts/published-course-v2/types.ts  PublishedLayerItemBase 可选 paperSpace
src/shared/contracts/published-course-v2/schema.ts publishedLayerBaseFields
docs/contracts/V9_COMPATIBILITY_POLICY.md          仅 additive 举例补四行
tests/unit/courseProjectCoreContract.test.ts       追加 omitted 用例
artifacts/contracts/**                             generate:contracts 产出
docs/tasks/editor-1.0/G2A_HANDOFF.md
```

## 禁止

- 改 `schemaVersion`、判别器字面量、`LayerFrame.mode` 唯一值
- `.passthrough()` / `z.unknown()` 弱化
- 任何 UI / Player 绘制 / `editorStore.ts`
- 把 paragraph 变成 NativeLayerItem
- 同一路径 Read 第二次；全程最多 **8** 次 Read
- `npm test` / e2e / desktop（**允许**本卡 `npm run typecheck` 与 `npm run generate:contracts`）

## 基线（≤4 Read）

1. Read `TextRunStyle`（`projectTypes.ts` 约 212–221）和 `flowTextRunStyleSchema`（course-project-v9/schema.ts 约 556–564）。
2. Read `FlowHeadingBlock` / `FlowParagraphBlock` / `FlowQuoteBlock` / `FlowMediaBlock` / `FlowComponentBlock` / `LayerItemBase`（types.ts 约 39–56 与 204–279）。
3. Read `layerItemBaseFields` 与 `flowMediaBlockSchema`（schema.ts 约 123–134、657–665）。
4. Read `PublishedLayerItemBase` 与 `publishedLayerBaseFields`。

`publishLayerItem` 已 spread 去掉 label/locked 后 clone，**不必改 producer** 只要类型/schema 有可选键。

## 逐步算法

全部 optional，缺省行为：

| 字段 | 位置 | schema |
|---|---|---|
| `fontFamily?` | `TextRunStyle` + `flowTextRunStyleSchema` + V8 `textRunStyleSchema` | `z.string().trim().min(1).max(300).optional()` |
| `fontSize?` | 同上 | `finiteNumber.min(8).max(400).optional()` |
| `textAlign?` | heading/paragraph/quote 块 | `z.enum(['left','center','right']).optional()` |
| `lineSpacing?` | 同上 | `finiteNumber.min(0).max(200).optional()` |
| `wrap?` | `FlowMediaBlock` + `FlowComponentBlock` | `z.enum(['none','left','right']).optional()` |
| `paperSpace?` | `LayerItemBase` + `publishedLayerBaseFields` | `z.enum(['viewport','paper']).optional()` |

`textLayout.ts` 的 `Required<TextRunStyle>` 必须补：

```ts
fontFamily: '',
fontSize: 0,
```

空字符串 / 0 表示「run 未覆盖，继续用 node.style」。不要让旧课测量跑偏：`runStyle` 里若 `fontSize === 0` 或 `fontFamily === ''`，绘制仍用 `node.style`（保持现有 `font()` 用 node.style 即可，只要类型能编过）。

`normalizeStyle` 把新键有值时拷贝进去。

`V9_COMPATIBILITY_POLICY.md` §3 举例补上这四类可选键（各一行）。

跑：

```bash
npm run generate:contracts
npm run typecheck
```

## 测试

`courseProjectCoreContract.test.ts` 追加：

- 解析一份**不含**新键的合法 Flow 工程（用 `createBlankFlowCourseProject` 或现有 shell），`fontFamily`/`wrap`/`paperSpace`/`textAlign` 均为 undefined。
- 解析一份带 `wrap: 'left'` 的 media 与 `paperSpace: 'paper'` 的 surfaceLayerItem，值保留。
- 未知键仍失败（现有 unknown key 测试不要删）。若没有 unknown key 测试，不要新造弱化。

## 最小验证

```bash
npm run generate:contracts
npx tsx scripts/generate-contracts.ts --check
npm run typecheck
npx vitest run tests/unit/courseProjectCoreContract.test.ts
git diff --check
```
