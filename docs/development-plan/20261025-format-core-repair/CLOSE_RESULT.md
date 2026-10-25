# C1 关闭与保稿结果

2026-10-25。执行范围：已授权的 `CORE_PATH_PLAN` C1，以及直接阻断旧 Shell 验证的 C2 前置。本叶在隔离工作树 `C:\Users\74755\.codex\worktrees\document-close-repair\果铃工作台` 工作，没有拷回 Root，没有改生产代码、用户工程、基线、timeout、模式或关闭默认动作；未 commit、push 或发布。

## 当前结论

真实 Main + 临时文件 + mounted Shell 的两条组合链已分别通过：冲突时标签关闭和 Shell `closeAll` 拒绝；`preserveAll` 不覆盖磁盘，canonical、History 及未应用 raw 可在新 Host 恢复；原 Main 关闭对话框取消后，同一编辑器可继续输入并一次 Undo。

本次尚未复现必须修改生产 owner 的丢稿或吞新输入。旧 Markdown renderer fixture 没供给真实 Main 的保存基线，现已补准确 `baseSource`；旧 Shell 创建前置改为当前实际入口，保留数据及无 CLI 回退断言。原 Shell 三例分别已通过：背景文档例复用首次全文件证据，另两例收窄查询后定向通过，没有再跑已有效例。

## C1 精确变更

| 文件 | 本叶增量 |
|---|---|
| `tests/unit/documentCloseShellMain20261025.test.tsx`（新增） | 两条真实 Main / Journal / 临时磁盘 / mounted Shell 组合链；原 `documentCloseDialog` 的 dialog 选择及 IPC 只作离线输送适配，正文、恢复、History 与操作 owner 均用真实实现 |
| `tests/helpers/markdownRendererHost.ts` | `observeFile` 从真实 `DocumentSession.readSavedSource()` 提供可得保存基线，与 Main `observeDisk` 的事实一致；未将当前 dirty 稿或新磁盘稿冒充基线 |
| `tests/unit/LessonWorkspaceShell.test.tsx` | 首例沿当前“新建标签页 → 文档名 → 新建 MD 文档”进入，并在该标签创建区域查询；原 untitled、空源、唯一 Session、无旧 CLI/创作回退断言均保留。真实基线可产生多个冲突 hunk，等待至少一处真实冲突控件，不再假定全局唯一；冲突关闭及原编辑器/History/磁盘断言未删 |
| 本文件 | 结果及证据限制 |

没有本叶生产文件增量；隔离工作树里预叠的 Root 产品／测试改动不属于本叶结果。

## 组合链的已证属性

第一条：`keeps a conflicted tab and canonical History, preserves unapplied merge input through Main cancel, and restores both in a new Host without writing disk`。

- Main 打开临时 `a.md`，正式人类事务改成 teacher 稿，磁盘同处改成 external 稿；挂 Shell 后确实出现逐 hunk 的冲突控件。
- 通过真实标签 X 调到 `DocumentFileSession.close`，结果 false；Shell `closeAll()` 也 false。标签和同一个 `.ProseMirror` 保留，canonical teacher 稿与 undoDepth=1 不变。
- 在一个真实冲突 hunk 输入未应用合并 raw，`preserveAll()` 成功，原辅助恢复记录含该 raw，磁盘 external 稿未被覆盖。
- 经真实 `closeDocumentWithDialog` → renderer `preserveAll` → 原 Main dirty 决定，离线对话框选择取消；收到 `requestResumeClose`，原编辑器保留。继续修改手工 raw 并再次保稿。
- 卸载 renderer，新建同 journal 的 Host，走现有 recovery summary → `restore` → Shell `focusDocument` 路径。等待当前冲突输入实际就绪及新 epoch 的认领/持久 ACK，再检查：canonical teacher 稿、undoDepth=1、新 raw 均在，磁盘仍是 external 稿。

第二条：`returns from the real Main cancel to the same mounted editor, accepts new input and undoes it once without saving the file`。

- 正式 dirty teacher 稿挂 Shell，原 Main 关闭选择取消，保留同一 PM DOM 和 Session。
- 通过该真实 PM view 的输入事务追加新文字，经 Shell `preserveAll` 确认到 Main，undoDepth 从 1 到 2。
- 发原 Ctrl+Z 键盘入口，一次恢复 teacher 稿，undoDepth=1、redoDepth=1；没有调用保存，临时磁盘原件不变。

三种入口语义保持：标签关闭先确认输入；Shell `closeAll` 先 flush 当前输入、冲突时拒绝；Main 的 `preserveAll` 只保全，由原关闭策略继续作保存/放弃/取消决定。没有统一成强制保存或强制放弃。

## 验证与原始观察

全部 `maxWorkers=1`，按 Root 分配的独占窗口运行，没有全矩阵或付费模型。报告在本工作树 ignored `output/test-runs/format-core-repair/close/`：

| 报告 | 观察与裁定 |
|---|---|
| `shell-main-initial.json` | 0 用例：node_modules junction 的实际依赖路径被 Vite `?url` asset 读取范围拒绝。没有执行产品行为 |
| `shell-main-real.json` | 2 个新用例都在构造 Main 时因我新增的 Electron mock 漏 `app` 导出失败。补 `app:undefined` 后使用 Main 原有 fixture 内目录分支；不是关闭产品故障 |
| `shell-main-ready.json` | 正常稿取消/新输入/一次 Undo 完整通过（378 ms）；冲突例在我不准确假设“只有一个 hunk”的查询处失败，尚未执行其关闭断言 |
| `shell-conflict-main.json` | 仅冲突例：原 Shell `actions.run` 异步尚未进入 close，我同步取 spy 结果失败；改为等待实际 close 调用。没有删其 false/保稿断言 |
| `shell-conflict-ack.json` | 冲突关闭、保稿、取消、新 Host 恢复原文均已到达；最后把短暂显示的未认领只读候选当作当前 hunk ready，过早检查新 epoch 失败。改为等待当前可编辑冲突 hunk 的准确 raw 和持久认领 ACK |
| `shell-conflict-recovery-ready.json` | 仅上述冲突例通过（1539 ms）；另一个用例明确过滤未运行，不称这一跑为整文件通过 |
| `shell-existing.json` | 原 Shell 全 3 例：1 passed / 2 failed。背景文档 focus、原编辑器及 History 例通过（338 ms）；首例遇页面两个同名“新建 MD 文档”，次例遇真实基线下多个同名 hunk 控件，两处全局单例查询失败，未证明生产操作故障 |
| `shell-existing-scoped.json` | 仅复跑前两处受影响例：2 passed / 1 skipped（491 ms、338 ms）。首例在标签创建区域查询；冲突例只等待真实冲突存在，原 closeAll=false、preserveAll=true、same PM、canonical teacher/undoDepth=1、无保存、disk external 断言全部通过。背景文档例明确过滤，复用上一跑有效证据 |

第二条先前的通过证据未受之后仅针对第一条冲突装配的局部改动影响，继续复用；第一条以最终定向报告为准。没有为了一个全绿截图重复已有效路径。所有初始失败报告保留，不将新 fixture 准备错误宣称产品修复，不把未运行记通过。

原 Shell 本次首跑和定向复跑同样保留，没有抹除原始红灯或修改历史基线。`baseSource` 由真实保存事实供给；没有通过改预期稿件、删除拒绝关闭或磁盘保护断言来消除失败。C1只覆盖上述Shell链，后来追加的指定Menu／PPT检查见文末C2，不能把未运行的其他旧用例宣称已清理。

隔离工作树需要的 `vitest.close.config.ts` 只存在同一 ignored raw 目录：在原配置上允许 Vite 读取当前 checkout 与 node_modules junction 的真实依赖目录，未放开全盘、未改正式配置或 mock 产品业务。

## 验证边界

这是 jsdom mounted Shell + 真实 Main/磁盘/Journal 的组合证据；Electron 窗口、IPC 输送及对话框选择由局部离线适配供给，没有声称实际 OS 原生窗口、完整 Electron GUI、物理输入法或所有文件格式验收。真实恢复入口顺序是先 restore 后 focus，未把普通 Open File 改成静默恢复旧稿。

C1 没有扩大到所有关闭竞态或新的产品取舍。组合 typecheck 与独审由 Root 在最终候选执行；若后续相关实现改变，应只重核受影响属性。

## C2 当前菜单与 PPT 路径（追加）

Root 在 C1 独审通过后授权继续闭合 `CORE_PATH_PLAN` C2 的两个指定文件：`tests/unit/g20M21TabMenu.test.tsx` 和 `tests/unit/g20M21PptxEntries.test.tsx`。本段仅追加这两个测试的维护与验证；没有再次修改已交付 C1 测试或 helper，没有改生产 UI、能力、回调或格式。

### 事实与维护理由

- 原终点报告 `D:/果铃工作台/output/test-baseline/2026-10-24T17-20-02-350Z/initial.json`：TabMenu 首例停在旧 `Markdown 文档名` 前置，另一关闭目标例 passed；PPT 空内容导入例已完成真实解析并调用 callback，停在旧单参数断言，其余创建顺序、损失确认取消及 Main archive/PPT 原字节三例 passed。这些原始记录不修改。
- `WorkspaceDocumentTabs` 当前创建入口与 C1 已核的一致。菜单“重命名”已存在于 `bdb9e1dc2`（2026-10-14），不是本轮新增；完整菜单断言保留它，不截数组。未保存路径动作仍需说明 `尚未保存到文件`，单一 menu、关闭其他/右侧禁用理由和精确关闭目标断言均保留。
- 文档标签的 reveal 已由 `documents.reveal(documentId)` 承接；本测试供给可观察的该端口并核对准确 bound documentId，不再等待旧 UI 自定义事件。该端口测试不等于真实 OS 资源管理器已打开。
- `useLessonWorkspaceController.newCourseFromPptx` 传入文件、`AbortSignal` 和当前 navigation 函数；`App.newProjectFromPptx` 在准备/损失确认后都核查取消与前台归属（此为源码证据）。测试回调保留真实 `createCourseFromPptx` 和损失确认，签名收取三参；新增可控晚到成功结果，但不在 fixture 内复制 App 守卫。
- PPT 页事实从唯一正式 `rootIds → instances[rootId].container/childIds` 读取：一页 Slide、原页名与尺寸、原文字 `知识 😀` 和原椭圆专业数据均需实际存在，不增加 `project.surfaces` 兼容 writer。

### C2 验证状态

4 个指定目标分别通过：TabMenu 两例、PPT 受影响空内容导入例、新增取消/后来工作空间例。没有生产变更，也没有删除或减少原菜单、禁用理由、关闭目标、PPT 数据、损失取消和原件保护断言。C2 本叶仅增加以下两个测试文件增量及本节：

| 文件 | 增量 |
|---|---|
| `tests/unit/g20M21TabMenu.test.tsx` | 同一当前创建入口；完整菜单包含已有重命名；一个菜单及禁用理由；reveal 准确 documentId；真实当前 course-v10 模型作为关闭标签快照，保留右侧/其他的精确关闭 ID 断言 |
| `tests/unit/g20M21PptxEntries.test.tsx` | 正式三参回调和 AbortSignal/foreground 事实；唯一正式 Slide 根及原页/文字/椭圆内容；刻意晚到 true 回执不改变后来工作空间和资源区选中。其余原创建顺序、loss cancel、Main archive/原字节断言保留。临时目录清理验证 resolved 临时根与本 fixture 前缀；cleanup 清本 fixture 的 localStorage |

仍按 Root 独占运行窗口、`maxWorkers=1`，复用同一仅针对依赖 junction 实路径的 ignored Vite 配置。C2 原始报告同在 `output/test-runs/format-core-repair/close/`：

| 报告 | 实际观察 |
|---|---|
| `c2-current-paths.json` | 精确 4 例首次运行：TabMenu 2/2 passed；PPT 两例 failed，另 3 例明确过滤。导入例停在我新增的原 XML 名假设：现行 parser 将文字实例标为 `课题 文字`，直接源码 `pptxImport.ts` 约 290 行已有 `${name} 文字` 映射。取消例的 signal/foreground、后来工作空间和资源区保持均已过，最后宽泛全局 alert 查询匹配到默认助手服务不可用，而非 controller 导入错误。两处按实际 owner 收窄，未改用户内容或生产行为 |
| `c2-pptx-exact.json` | 只复跑受影响 PPT 两例：2 passed（614 ms、372 ms）/ 3 skipped。实际检查了一页正式 Slide、原文字 `知识 😀`、椭圆和三参；取消后 signal 已 abort、foreground=false，晚返 true 仍保留后来工作空间与资源区选中。错误断言限定到 `.lesson-workspace-error`，保留对真实 controller 错误的检查 |

菜单本次通过证据未受后续仅 PPT 查询/预期修正影响，继续复用，没有为末次整文件全绿重跑。原终点报告内未变的 PPT 创建顺序、损失确认取消和 Main archive/原字节三例证据复用，最后一次过滤未跑明确保留。没有将首次 fixture 错误宣称产品故障，也没有将此前只走到回调的原 PPT 解析证据冒充正式根与原内容检查；这些新断言以 `c2-pptx-exact.json` 为准。

边界：新增取消链通过 mounted Shell 的实际导入/取消/工作空间切换和区域导航控件，使用真实解析和现行 signal/foreground 协议；回调故意在取消后仍返回成功，检查实际 controller 不把后来资源区导航切回旧导入的内容区。测试中的 `completed` 仅记录解析结果，不是正式 App 工程创建；不把 fixture 自己守卫通过当成 App 应用保护，也不声称 worker、完整 App 创建/应用结果或原生文件选择器已验收。C1 已有效证据不重跑。

菜单重命名只检查既有能力仍在，未扩成重命名文件的完整链；reveal 只检查向原宿主端口投递准确文档，未声称 OS 资源管理器验收。原来已通过的关闭目标例改为准确的当前格式 fixture 后本次重核，未以“旧已过/已红”豁免真实断言。结果待 Root 独审/集成，没有拷回 Root、commit、push 或发布。
