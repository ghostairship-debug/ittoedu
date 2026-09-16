# 第三方执行工人协议

给高性价比 / 第三方模型用。父代理只汇总、合入、复检。执行前必须读完本文件，再读一张任务卡。

与源码冲突时以源码为准，并在 HANDOFF 写明；不要擅自改合同判别器来迁就实现。

## 0. 先看状态，禁止重做

权威看板：[00_INDEX.md](00_INDEX.md)「合入状态」。状态为 **已合入** 的任务禁止再实现。

已合入的 T/P/Q/F/G 以 `origin/main` 为祖先。不要再领取 F1–F3 或 G0–G3。

## 1. Git（必须按序）

1. 不要在 `/workspace` 上直接改。只用自己的 isolated worktree。
2. `git fetch origin main`。
3. 从任务卡写明的基线建分支。  
   - 历史 T/P 卡：不要再领取。  
   - 历史车道 Q（Q1–Q8）：不要再领取。  
   - 历史车道 F（F1–F3）：不要再领取。  
   - 历史车道 G（G0–G3）：不要再领取。  
   - 其它新卡：从 `origin/main` 建 `cursor/<task-slug>-0ab9`。
4. 不属于本任务的脏文件一律不要 add。
5. 每个逻辑步骤一次 commit。任务卡若要求「重命名 / 行为」分开，就两次 commit。
6. `git diff --check` 必须干净。
7. `git push -u origin <你的分支>`。
8. **禁止** 开/改 PR、禁止 `gh` 写操作。PR 由父代理处理。
9. 写 `docs/tasks/editor-1.0/<TASK>_HANDOFF.md`（见文末模板）。

## 2. 文件防火墙

- 只改任务卡「允许修改」列表。多改一个文件 = 失败。
- 机械 import 更新：仅当重命名导致最小验证无法编译时，允许在 **同一重命名 commit** 里改引用方；HANDOFF 列出这些文件。行为 commit 禁止顺手改无关引用。
- 同一提交禁止同时改 Schema 判别器和教师可感知 UI。
- 热点冲突（别人已改同一允许文件且语义不同）→ **停**，写 HANDOFF，不要合并脑补。

## 3. 验证防火墙

默认只跑任务卡「最小验证」里列出的命令（通常 1–2 个 Vitest 文件），外加 `git diff --check`。

禁止：`npm test`、`npm run test:e2e`、`npm run build:desktop`、`npm run verify`、`npm run verify:full`。  
默认也禁止 `npm run typecheck`。

**红项优先，尽量少跑全量：**

1. 绿过的先不用管。`T6_FREEZE_HANDOFF.md` 里已绿的 `check:contracts` 不要重跑，除非本卡改了 `scripts/generate-contracts.ts` 或 `artifacts/contracts/**`。
2. 优先改红的，并只跑红的单独测试。当前 T6 红项是 `typecheck`。
3. 本轮例外：任务卡最小验证若写了 `npm run typecheck`（[T1-A](T1_A_MOVE.md)、[T6-tc-tests](T6_TC_TESTS.md)），允许只跑这一条红命令。仍禁止 `npm test` / e2e / desktop。[T1-C](T1_C_AUDIT.md) 不要跑 typecheck。
4. 不要每改一个文件就 typecheck / vitest。每个 commit 收口最多跑一次最小验证。
5. 不要每次修改后跑 T6 五条命令。整轮五条只留给 T6 红项清完后的一次证明。

发现类型/构建风险（且本卡不允许改那些文件）只写入 HANDOFF。不要为了绿而删测试。

T6 是唯一允许跑 `npm test` / e2e / desktop 的任务，且必须遵守 [T6_FREEZE.md](T6_FREEZE.md) 的「已绿不重跑、只追红项、收口才整轮一次」。

## 4. 产品硬边界（执行中不得违反）

- 工程真相只有 Course Project V9。不要恢复 V8 导入 UI 或密封导入器。
- V9 已软冻结：不要改已有字段、判别器或语义。additive 可选字段须单独合同提交，保持 `.strict()`，不要用 passthrough 偷加键。
- 试运行 / 整课预览走 CoursePlayer + Published V2 宿主。禁止把 Phaser `PlayerApp` 接回 Mixed / Flow / Spatial 试运行。
- Phaser 只服务 Slide **编辑**命中。
- 不新增 `projectMode`、四模式字段、Hash/审批/Evidence、可见 AI。
- 不启动 V10。**S0 未完成探索产物前，不拆整个 `editorStore.ts` / `Workspace.tsx`。** 功能卡不得改 S0 第 6.5 节内核文件。
- 教师控制器仍是 **一份全局图层**。不要复制到 scene `layerItems`。
- Vite `chunks larger than 500 kB` 不当 bug。
- 自动化最多 `engineering candidate`。不要写 `accepted` / `art candidate`。

## 5. 停下来的条件（立即停 + HANDOFF）

- 允许文件列表不够用，你想改列表外文件。
- 需要改 V9 判别器 / Component API 数字 / Runtime API 数字才能做完。
- 集成分支上该文件已有另一车道的未合入语义，你无法无损接上。
- 最小验证无法在不删测试、不弱化 schema 的情况下通过。
- 任务卡写「禁止与 X 并行」，而你发现自己正在改 X 的文件。

## 6. HANDOFF 模板

```markdown
# <TASK> HANDOFF
- 范围：
- 合同是否变化：是/否
- 分支 / SHA：
- 允许列表外改动（必须空，除非重命名机械 import）：
- 最小验证命令与结果：
- 未验证（交给 T6）：
- 停下来的原因（若有）：
- 下游：
```
