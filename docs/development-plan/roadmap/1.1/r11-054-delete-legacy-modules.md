# r11-054-delete-legacy-modules｜按复核清单删除零 consumer 旧模块

- Release / Dependencies: 1.1 / r11-053-legacy-inventory-reconciliation
- Write locks: `app-save-recovery`, `contracts-schema`, `legacy-inventory`, `editor-store-history`, `published-producer`, `generated-index`
- Inventory access: write
- Preservation: PM-01–PM-28

> 执行者分工（2026-09-03）：r11-053 交付精确 deletion list 后，本节点可派通用执行者按组机械删除；通用规则见 [执行者指南](EXECUTION_GUIDE.md)。

## Outcome / current evidence

只删除 r11-053 在同一候选明确列出的零 consumer 旧模块，并清理由这些删除直接造成的 import/barrel/build 引用；所有产品删除、generator 更新和验证完成后，才在最终 inventory-only 阶段把对应 status 更新为已定义的 `removed`，不创建 re-export 桩或双轨 fallback。

## Integrator audit / locked（2026-09-03）

当前没有有效 deletion list，本节点未解锁。旧 handoff 中列出的 Player、Export、Shared V8、Archive 路径只可作为调查线索，不能抄入写入范围；唯一授权来自修正 scanner 后、同一固定候选上的新 r11-053 handoff。

重新执行时不拆新节点，同一规格内按组：

| 组 | 删完立刻跑 |
|---|---|
| Shared contract | `npm run check:contracts` |
| Player/payload | `npx vitest run tests/unit/publishedCourseProtocol.test.ts tests/unit/playerCapture.test.ts` + `npm run typecheck`。`tests/e2e/window.d.ts` 若仍 `import type { PlayerApp }`，同组改为 CoursePlayer/V2 bridge 类型，禁止留下对已删文件的 import |
| Export/diagnostics | `npx vitest run tests/unit/coursePackageExport.test.ts tests/unit/coursePptxExport.test.ts tests/unit/coursePrintArtifacts.test.ts` |
| Archive/test helper | `npx vitest run tests/unit/courseProjectArchive.test.ts tests/unit/projectFormatIsolation.test.ts` |

前一组红则停，只回滚该组。全组完成后才跑规格底部的集成 focused validation。

r11-053 pre-delete identity 只在任务入口、第一组删除前精确核对一次，并作为不可变 anchor 保留在 inventory；第一组后当前 product tree 必然变化，不得继续要求它等于 anchor。后续每组只核对 anchor 未被改写、当前累计 diff 只含已经完成的授权组，并重跑本组零查询。全部组完成后先运行现行 generator、更新正式输出，以 ratchet 和 focused checks验证累计删除，再在 post-delete closure 重跑 r11-055；随后计算最终 product digest，最后以 inventory-only 阶段写 status/scanner version/identity并运行 zero。product digest 排除 inventory 与 `artifacts/release-evidence/v1.1/**`，因此证据写入不会自失效；`reconciledProductCommit` 表示产生该 product tree 的最近产品提交，允许当前 HEAD 仅多一个 inventory-only 后继提交。inventory status 用已有枚举 `removed`（不要 `removed-zero`）。禁止 alias/re-export/no-op。

## Read first

- r11-053 的固定 deletion list 与候选身份
- `docs/development-plan/inventories/legacy-consumers.json`
- deletion list 中每个 exact target、直接 import/barrel/config/generator consumer 与 replacement 行为测试

## Exact targets

本任务的允许删除集合严格等于 r11-053 handoff 的 deletion list。执行者必须先把该清单逐项抄入任务卡的“写入范围”，格式为 `LEG ID / exact path / zero query / replacement / PM evidence`；清单外文件即使名称含 legacy 也禁止删除。每个 owner 组按 Shared contract → Player/payload → Export/diagnostics → Archive/test helper 顺序处理，前一组 focused check 失败时不得继续下一组。

## Write scope

允许删除 deletion list 中的精确旧模块，修正仅由删除引起的 import/barrel/config/build 引用，更新唯一 inventory、forbidden/read-model tests 中精确 stale target 声明和真实 consumer 要求的合同/能力生成追踪。forbidden/read-model tests 只可机械删除已不存在 target 的直接声明，不得改变 assertion 语义、AST/import helper或固定违规 fixture。post-delete r11-055 revalidation 可更新 `FEATURE_CONSUMER_OWNER_LEDGER`，但只允许删除与本次授权 target 一一对应的 consumer、记录单调减少后的数量；不得掩盖新增边、改变 owner、放宽 baseline 或扩大 adapter 白名单。后四类变化必须先回滚受影响删除并返回 r11-055，修正后从 r11-053 重新固定 identity；单调 ledger-only 刷新不改变 Legacy product closure，无需重做 pre-delete 053。禁止新增或修改替代 consumer、改变产品行为或 Schema wire、弱化断言、删除清单外文件、修改排除项或手改生成产物。

## Execution

1. 在任务入口、第一组删除前确认当前 pre-delete product closure、inventory 的 scope/scanner version/digest 与 r11-053 handoff 完全一致；不一致立即停止并退回 r11-053。把该 identity 记录为不可变 anchor，本任务后续不重写它，也不再拿变化后的当前 tree 与它比较。
2. 对 deletion list 的一个 owner 组，先确认 inventory 中 anchor 未被改写、当前累计 diff 只来自已完成的授权组，再重跑本组零查询和 replacement 直接行为测试；出现清单外漂移、任何 consumer/unknown 或 PM 证据失效时，该组不动。
3. 删除该组精确文件，清理仅因文件不存在而失效的 import、barrel、bundle/config entry；不得创建 deprecated alias、re-export、silent fallback 或空实现。
4. 运行该组最近层验证；此时不改 inventory status。全部组删除与直接清理完成后，按现行 generator 更新真实 consumer 要求的合同/能力制品；若 generator 仍消费旧源，返回对应 owner，不把它当删除清理。
5. 对 generator 完成后的最终产品树运行本规格产品 focused checks和 `npm run check:legacy-inventory`；此时 inventory 仍绑定 pre-delete anchor，只允许使用能接受 endpoint 单调减少的 ratchet/probe，禁止提前运行 identity-enforcing ready/zero。按授权删除造成的精确 consumer 减少单调刷新 ledger，再运行 r11-055 的完整 Focused validation，形成绑定 post-delete 源码、测试、helper、fixture 与 ledger 的新 gate 结果；pre-delete pass 不得复用。真实红灯先回滚对应删除组；只有 assertion/helper/fixture 语义变化、ledger 新增/改 owner/放宽 baseline 或产品修正才返回 r11-055，并在修正后从 r11-053 重做 reconciliation。
6. 只有前述产品树、正式输出与 post-delete r11-055 gate 全部稳定且验证通过后，才计算最终 post-delete product digest；在唯一 inventory 的独立最终阶段把相应 record 设为 `removed`，按 `file-absent` / `symbol-absent` expectation 验证目标，保留 pre-delete anchor、zero evidence、replacement 和查询，并写入 post-delete identity。随后运行不写报告的 `npm run check:legacy-zero`；只有通过才完成 054。zero 失败时先回滚 inventory JSON，再按命中返回对应删除组、r11-002 或产品 Owner；r11-060 只在同一最终输入上追加 `--report`。

## Stop conditions

- 任务入口候选与 r11-053 不同；或进入删除后出现不能由已完成授权组解释的清单外 product/test/generator 漂移；或本组零查询不再为零。
- 删除会减少 UI、Surface、导出、动态 carrier、diagnostic、Builder、保存/Recovery 或测试保护的受支持行为。
- 需要修改 replacement、断言、timeout、retry、排除项或清单外代码才能恢复绿灯。
- 需要类型 alias、re-export、no-op 或 fallback 才能编译。

## Acceptance

- deletion list 中旧模块、imports、bundle/config entry 均不存在；清单外路径未被删除。
- 对应 inventory record 使用 `removed`，计数、最近产品 commit、replacement 与零查询可重现；不存在第二台账。
- inventory 的 post-delete product digest/scanner version 与当前非 inventory product closure 一致，并保留可追溯的 r11-053 pre-delete identity；file/symbol expectation 均满足。
- PM-01–PM-28 的 replacement 行为仍由同一层证据保护，构建/测试不依赖兼容桩。
- r11-055 全部结构与代表行为门已在最终 post-delete closure 重新通过，且测试/helper/fixture/ledger 未被弱化；只有该结果可以解锁 r11-060。
- inventory 更新前的 `check:legacy-inventory` 只证明相对 pre-delete anchor 单调减少；最终 inventory 写入后 `check:legacy-zero` 在同一 post-delete product/inventory identity 上通过。两者顺序不得颠倒。
- ledger 只发生与授权删除一一对应的 consumer 单调减少；没有新增边、owner 改写、baseline 放宽或 adapter 白名单扩大。

## Focused validation

- `npx vitest run tests/unit/editor10ForbiddenTokens.test.ts`
- `npx vitest run tests/unit/architectureDependencyRatchet.test.ts tests/unit/readModelBoundary.test.ts tests/unit/editorStore.test.ts tests/unit/coursePackageExport.test.ts`
- `npx vitest run tests/integration/architectureBaselineFlows.test.tsx tests/integration/mixedCrossSurfaceHistory.test.tsx`
- `npm run typecheck`
- `npm run check:contracts`
- `npm run check:legacy-inventory`（inventory 最终更新前）
- `npm run check:legacy-zero`（inventory 最终更新后，不写 report）

## Rollback / handoff

若某 owner 组出现遗漏 consumer 或 post-delete 055 红灯，只回滚该组文件删除、对应的单调 ledger 减项与直接生成输出；最终 inventory 阶段尚未发生时没有“对应状态”可回滚。需要改变 055 assertion/helper/fixture、增加或改写 ledger 边时，在回滚后返回 055，并在修正后重开 053。若最终 inventory-only 写入或 zero 验证错误，先只回滚该 JSON 变更，再按稳定类别决定是否回滚对应删除组；不得全量恢复所有 Legacy。交接精确列出 pre-delete anchor、已删除组、未删除组、累计授权 diff、每组验证与首个失败 endpoint。
