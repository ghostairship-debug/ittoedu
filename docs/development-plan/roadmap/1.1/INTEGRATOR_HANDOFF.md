# 1.1 Integrator handoff（接手审计修订：2026-09-03）

本文件取代 2026-09-02 的 Grok handoff。旧 handoff 中“不要重开 r11-000–055”“剩余链只有 053 → 054 → 060 → 061”以及基于旧 scanner 得出的 deletion list 均已被源码和可复现检查推翻，不能作为继续开发或删除文件的授权。

当前裁决是：**保留已有实现成果，先修裁判与 Owner 边界，再重新进入 Legacy reconciliation；不整体回滚，也不直接继续 053/054。**

---

## 0. 2026-09-03 Codex 执行检查点

本节是当前恢复路线的权威检查点；与下文“接手审计时”的节点状态或恢复顺序冲突时，以本节和当前任务板为准。下文保留的旧统计与反例只是审计依据，不是新的完成声明或删除授权。

- 已闭合：`r11-026`、`r11-030`、`r11-031`、`r11-040`、`r11-041`、`r11-042`、`r11-043`、`r11-033`、`r11-029`。对应产品路径与直接门可保留，不再因下游待办重开它们。
- `r11-029` 已通过 10 个聚焦测试文件共 127 项测试、`typecheck`、scoped diff check 与精确负边界查询。根 `Workspace.tsx` 只消费 exactly-one discriminated route；Flow/Spatial connector 使用命名 selector 与 typed port；Slide leaf 只接收同一时点 projected snapshot 和分组 ports；module-global bind、live Store facade 与 Store→UI 反向依赖均为零。
- r11-029 任务卡已按协议删除，任务板重新生成后为 0 项；本次文档收口后的 `check:development-roadmap` 与文档 scoped diff check 通过。
- **1.1 未完成。** 按用户要求，当前检查点立即暂停；不创建下一任务卡，不 commit，不 tag，不 release。
- 2026-09-03 重基核实：检查点提交 `bb1f848` 上 `check:development-roadmap` 通过，但 `check:preservation` 因 PM-08 的 `globalLayerUi.test.tsx` 夹具失败，`check:legacy-inventory` 报 7 项未登记观察；三道门中两道为红。剩余节点已按 [执行者指南](EXECUTION_GUIDE.md) 改写为执行版，并在 `docs/development-plan/tasks/1.1/` 建首批卡。

本轮可复用的直接证据：`r11-042` 为 8 个文件 / 94 项测试并通过 `typecheck`，覆盖真实 Spatial host capture、Flow semantic print 与共享 producer facts；`r11-043` 为 6 个文件 / 104 项测试并通过 `typecheck`、capability check 与真实在线 E2E，完成 producer Owner 迁移；`r11-033` 为 8 个文件 / 81 项测试并通过 `typecheck`，闭合 Surface owner remount、精确 origin network lease 与 Slide authoring base/named-state 保留。证据只在相关实现、依赖、fixture 与验证定义未变化时复用。

恢复后的剩余 failure-owner 边界如下：

| Failure owner | 2026-09-03 重基后的状态 |
|---|---|
| `r11-029` 返工卡 | 修复 PM-08 夹具（`globalLayerUi.test.tsx` retained-spatial-path）与两处新增 LEG-011 import（`spatialAuthoringIntents.ts`、`SlideWorkspaceConnector.tsx`）。 |
| `r11-025` | 以证据闭合；history 镜像残留归 `r11-037` W1。 |
| `r11-032` | 只剩 `playerCapture.ts` 的 PlayerApp 旧捕获函数与类型引用；Flow-only 项待 Integrator 给出失败测试，否则作废。 |
| `r11-034` | `sameProjectIdentity` 改为比较 `projectId` 与 hook 自有的 `epoch`；两条红→绿测试。 |
| `r11-035` | 四个 emit 使用预检时的 `pending.snapshot`；过期 finding 不导航；大文件改网页包走 `exportCourse('web-package')`；三条红→绿测试。 |
| `r11-036` | 解码后再核对 identity 且 identity 加入 `locationId`；两条红→绿测试。 |
| `r11-037` | 拆为 W1–W9，W1–W7 符号表已钉死。 |
| `r11-052` | 按当前测试树重算为 A–E；旧渲染器簇六个模块需由 `r11-053` 先登记为 targets。 |

暂停后恢复的唯一顺序是：`r11-029 返工卡 → r11-032 → r11-034 → r11-035 → r11-036 → r11-037（W1–W9）→ r11-052（A–E）→ r11-055 → r11-053 → r11-054 → post-delete r11-055 → r11-060 → r11-061 → Owner r11-062`。`r11-055` 的第一次执行是 pre-delete 结构门，第二次是 054 删除后在未改弱的同一门上复验；053/054 仍只能消费届时固定候选的新 reconciliation。

---

## 1. 接手审计时工作树快照（历史）

- 仓库：`C:\Users\74755\Documents\HTML课件编辑器`
- 分支 / HEAD：`main` / `018d3df56c0f0e26f0c00b9e2cc16da69be83a05`；HEAD ahead `origin/main` 1
- 工作树：307 个 tracked 文件有变化，另有 119 个 untracked 文件；tracked diff 约为 18,501 insertions / 37,898 deletions。本轮成果尚无可独立回退的 1.1 checkpoint
- `npm run typecheck`：通过
- `npm run test:product`：通过，275 files / 2147 tests
- r11-052 focused waves、现有 r11-055 focused tests：通过；这些结果只证明相应行为或现有断言通过，不证明规格退出条件成立
- `npm run check:legacy-inventory`：通过；当前 inventory 为 confirmed 208、unknown 0、tokenHits 404
- `npm run check:legacy-ready` / `check:legacy-zero`：以 `known-debt` 失败
- `npm run check:preservation`：失败，`malformed-map`
- `npm run check:development-roadmap`：接手审计时报告 25 个路径问题；本次计划纠偏后仍失败，当前为 13 项，r11-000 完成前该门继续视为红灯
- `git diff --check`：失败，5410 项，主要是四个源码文件整文件 CRLF 和一个测试文件尾部空行

这些红灯中的 architecture/preservation/scanner 属于 1.1 发布门，不是已经证实的当前用户可用性 P0/P1。产品回归全绿是保留已有实现、避免整体回滚的直接证据。

## 2. 审计后的节点裁决

| Node | 裁决 |
|---|---|
| r11-000 | 重新验收。路线 checker 当前把可执行证据、历史描述和删除目标混在一起；审计初始 25 项，本次计划修订后当前 13 项 |
| r11-001 | 重新验收 evidence mapping。PM 标准不变；PM-15、PM-21 及其他被迁测试必须绑定真实 replacement |
| r11-002 | 重新完成 scanner。现有 ready/zero 可在台账清空后遗漏 live token，candidate identity 也未成为强制门 |
| r11-026 | 重新打开。叶子属性面板保留，但 `PropertiesTab.tsx` 尚未成为纯 context router |
| r11-029 | 重新打开。Workspace 叶子保留，但 `Workspace.tsx` 尚未成为 exactly-one Surface router |
| r11-037 | 重新打开。现有 slices/kernel/owners 保留，但 root、宽 ports 与 `crossSurfaceCommands` 仍承载业务或镜像 |
| r11-052 | 重新打开。仍有 V8/旧 payload 成功测试，且删除测试到 PM/路线证据的映射未闭合 |
| r11-055 | 撤销既有 pass。现有词法测试在合同明显失败时仍为绿色，属于假阳性门 |
| r11-053 | 上次 reconciliation 作废。旧 digest 已过期，上游裁判和 owner gate 也未成立 |
| r11-054 / 060 / 061 | 未解锁 |
| r11-062 | r11-061 解锁后仅由 Owner 执行；未签署 `accepted` 不得 tag 或发布 |

## 3. 可直接保留的成果

- Course Project V9 / Published Course V2 的既有合同和已通过产品行为
- 已拆出的 Flow authoring 模块、App lifecycle/delivery/import hooks
- `publishedNativeRendering.ts` 及 Slide Published Native painter 迁移
- Course package analysis、preflight、emitter 的真实拆分
- 现有 Store kernel、resource helpers 与 Surface slices 中已经通过行为测试的实现
- PDF print HTML、Published executable decode、V9 health/preflight、native node factory 等已迁产品路径
- 已经删除且有 V9/V2 replacement 的旧测试与 helper；不得为了返工恢复 V8 成功路径

“可保留”不等于对应 r11 节点已经完成；完成仍以各规格的负边界、唯一 writer 和有效门为准。

## 4. 当前恢复顺序

1. **建立可恢复工作点。** 先区分无关 untracked 内容并按用户授权固定恢复点；未获授权时不得自行 commit/tag，也不得把变化中的 dirty tree 冒充 053/061 固定候选。换行与 EOF 噪声不在此步越权修改，分别随 026、029、037、052 的合法文件范围清理，最终由 `git diff --check` 证明。
2. **r11-000：修路线裁判。** 对 checker 报出的每个路径逐项分类为可执行 evidence、Read first、历史描述或删除目标；只要求真实可执行入口存在，禁止通过删除重要引用或放宽检查求绿。若最后只剩 preservation map/matrix 的真实 stale evidence，精确交给 r11-001。
3. **r11-001：先恢复当前 preservation 权威。** 不改 PM-01–PM-28 标准，修复当前 map/matrix、checker 输入闭包与失效条件，使 `check:preservation` 和 `check:development-roadmap` 在 002 前都通过。
4. **r11-002：修 Legacy scanner。** ratchet 必须按精确 `path#symbol` 阻止新增 endpoint；ready/zero 必须绑定当前候选 identity；zero 必须直接断言允许的元数据以外 live token、旧模块、Schema 8 作者样本、`.h5lesson` 与正式生成物全部为零。已登记旧目标自身的定义命中标为 `target-definition`：ready 允许 `file-absent` 目标尚在，zero 报 `legacy-module-present`。增加“inventory 已清空但 live token 仍在”等 false-pass fixture。
5. **分类并排队 scanner owner return。** 按精确 consumer 把 SceneStateStrip、PPTX shared、visual density、Course Project model 及其他命中排到 r11-013/020/033/040/041/037/052 等既有 Owner；这里只建立精确 failure queue，不提前执行节点。每个 Owner 仍须等待稳定 DAG 前置成立，037/052 的命中并入后续第 6/7 步，不能绕过 026 → 029 → 025 复核。
6. **r11-026 → r11-029 → 复核 r11-025 → r11-037：定向返工 Owner 边界。** 026/029 共用 `workspace-properties` 写锁，串行执行。029 后重验 r11-025，只有 evidence closure 失效才执行它；037 前再确认 r11-032/034–036 闭包未变。保留叶子与 slices，只删除 root 中仍在的业务、宽 Facade、镜像、万能服务和模块级 service locator。
7. **r11-052：闭合测试迁移与 evidence。** 所有保留成功行为只使用 V9/V2；V8 仅保留最小 fail-loud rejection。逐 case 记录被删测试与 replacement/PM 证据；只要本任务改变 evidence，就在同一任务同步 preservation map/matrix，并保持 preservation/roadmap 两门为绿，不再把正常交接退回 r11-001。
8. **r11-055：重做删除前结构门。** 使用 TypeScript import/AST/精确 symbol 与固定最小违规 fixture，同时证明 root-only wiring、UI roots only routing、无第二 writer/镜像/宽 Facade/运行时环。门只接受本次 pre-delete gate 的最终源码、测试、helper 与 ledger 状态；行为绿和结构绿必须同时成立。
9. **r11-053：在固定候选上重新 reconciliation。** 只更新唯一 inventory；ready 必须通过，zero 只允许 `file-absent` 待删除目标自身的 `target-definition` 导致明确 `legacy-module-present`。`symbol-absent` 可在宿主文件保留时闭合。旧 digest、旧 deletion list 和 LEG-008 的旧结论都必须重新证明。
10. **r11-054 → post-delete r11-055 revalidation → r11-060 → r11-061。** 054 只删除新 053 明确授权的精确路径；全部删除、generator 输出和测试清理稳定后，允许 ledger 仅按本次授权删除一一对应地单调减少 consumer，再在最终 post-delete closure 以未改变的 assertion/helper/fixture/baseline/白名单重跑完整 055 gate。只有需要改变 assertion、AST/import helper、fixture 语义，ledger 新增边/改 owner、放宽 baseline/白名单，或修产品/测试时，才回滚受影响删除并返回 055；这些变化都要求从 053 重做 reconciliation。通过后，060 用 scanner 的固定 `--report` 输出证明真实零遗留，061 在同一 clean candidate 上通过 contracts、路线、preservation、zero、verify 与 diff hygiene。
11. **r11-062。** r11-061 解锁后工程会话停止，交由 Owner 对固定课例签署；未签署不得 tag 或发布。

不新增 `r11-*` ID；失败返回现有 failure owner。跨会话真正开始执行时，按 `WORKING_PROTOCOL.md` 为当下首个节点建立任务卡并生成任务板；本 handoff 不伪造 queued/active/blocked 状态。

## 5. 各门必须补上的反例

### r11-002

- inventory confirmed/unknown 均为零，但扫描范围仍有旧 token：ready/zero 必须失败
- 已登记 path 中新增另一个旧 symbol：ratchet 必须失败，不能退化成 path allowlist
- current tree digest 与 reconciled identity 不同：ready/zero 必须失败为 stale candidate
- `.h5lesson` 的 `project.json.schemaVersion = 8` 或正式 HTML 含旧 bundle token：zero 必须失败
- inventory 汇总计数与 records 不一致：malformed inventory

### r11-055

- `Workspace.tsx` 直接调用 raw Store、构造 Surface command facade 或内联 connector：失败
- `PropertiesTab.tsx` 直接 mutation、解析 target 或 import Surface command：失败
- `editorStore.ts` 在 factory 内外实现 projection/persist/Feature planner，或 import `ui/**`：失败
- `crossSurfaceCommands` 实现 Surface command、save/recovery/persist，或 Feature port 汇总完整 document/session/writer：失败
- module-global mutable bind/service locator、第二 History/writer、Core→Feature 或 Store→UI 边：失败

不得用 LOC、文件数、字符串存在性、大白名单或“叶子 import 已存在”替代这些结构事实。

## 6. Legacy 清理边界

当前 208 confirmed / 404 tokenHits 只是审计快照，不是删除清单。旧 handoff 中列出的 Player、Export、Shared V8、Archive 路径只可作为调查线索；它遗漏了正式合同、V9 schema union、Audio/Flow host、旧成功测试和非 token import 等 consumer。

r11-053 之前禁止写 inventory 来伪装减少；r11-054 之前禁止删除旧模块。唯一删除授权必须来自修正 scanner 后、同一固定候选上的新 r11-053 handoff，格式仍为：`LEG ID / exact path / zero query / replacement / PM evidence`。

## 7. 硬边界

- Course Project V9、Published Course V2、Runtime API 2/3、Component API 4；不恢复 V8 导入，不创建 V10
- 不整体回滚 Grok 已有成果，不恢复 `tests/helpers/projectV8.ts` 或 V8 success suite
- 不通过改名 token、扩大排除、路径 allowlist、re-export、no-op、silent fallback 或弱化断言求绿
- 不新增第二 Store/Session/History、完整 Store Facade、兼容双写或万能 Surface service
- 不把自动化 `engineering candidate` 写成 Owner `accepted`
- 未经用户明确要求不 commit、tag 或发布 `v1.1.0`

## 8. 重新接手时的最小阅读顺序

1. `COURSEWARE_DEVELOPMENT_PLAN.md` 当前开发路线
2. `docs/development-plan/TASK_BOARD.md`
3. 本文件与将执行的 r11 规格
4. `docs/development-plan/ARCHITECTURE_CONTRACT.md` 对应 Owner/持久化/Published 条目
5. `docs/development-plan/WORKING_PROTOCOL.md`
6. 当前源码、直接 consumer 与目标测试

若文档自述与源码或可复现结果冲突，以源码和结果为准，先返回相应既有规格更新计划，不沿用旧完成状态。
