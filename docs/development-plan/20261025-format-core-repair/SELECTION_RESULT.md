# 选中／拖动修复结果

2026-10-25。Owner 已授权按 CORE_PATH_PLAN 实施 S1／S2。工作区：`C:/Users/74755/.codex/worktrees/selection-ack-repair/果铃工作台`。**S1／S2 两个生产断点已在原 owner 修复；最终真实 Main／Bridge／Source／Nodes 浏览器整链通过。** 未拷回 Root，未 commit／push／发布，未操作用户工程。关闭／保稿及格式由其他 writer 负责。

## 结论与产品边界

确认一个生产协议断点：realm pointer 的 start 等旧 `commitTextEdit` 返回后，只检查文档／页面上下文。期间 Nodes 已选 B，或原提交已完成而同一对象有新输入时，旧 begin 仍把真实 Bridge 的选中改回 Source。修前两个装配用例实际得到 `['source']`，分别应保留 `['neighbor']`、`['text']`；这不是仅 spy 发出请求。

只修原 `SlideLocationWorkspace.authorPointer` owner：start 复用现有 `captureInputIntent`；begin 前重核意图、精确选择身份及当前没有剩余／新的输入。过时 continuation 清空待开始的 realm pointer。**此检查不放入已开始 gesture 的 update／end**，保留自身合法选中后的拖动、queued end 和一次提交。没有新增 selection store、输入 owner、writer、History、UI、模式或操作路径。

S2 浏览器进一步证实另一个原生产断点：旧宿主 ACK 因 Nodes 换选失效后，`deferredPointer` 的 ended record 没有退役；真实鼠标复用 pointerId=1，新 Source 手势已选中，但后续 move／up 仍被旧 record 吞掉，无法完成拖动。仅在 `deferredPointer.current === pending` 后清理该失效记录；paint／ACK 两个同 owner 失效门采用相同退役规则，不清新 pending 或共享 pointer。真实 Bridge 同 id 红例及最终正常物理拖动均证明修复，不用新 pointerId、睡眠或改变正确断言绕过。

正常物理鼠标受现存 `data-slide-authoring-hit-plane` 仲裁，走宿主 paint 路径；本次浏览器普通物理点击在修后保持 Nodes B，但不据此声称修前普通鼠标必经 realm 故障。另在真实 Source document 中投递 PointerEvent，经原 sandbox producer／transport／host 到真实 Bridge，验证 realm 协议；该证据明确低于完整普通用户物理复现。

## 相对接手 Root dirty 基线的文件

| 路径 | 此分支增量 |
|---|---|
| `src/renderer/ui/workspaces/SlideLocationWorkspace.tsx` | realm start／begin 意图与输入检查；原宿主 deferred 失效后按 record 身份退役。接手基线副本在 raw `baseline/SlideLocationWorkspace.tsx`，不把 Root 原有 dirty 改动算作本分支 |
| `tests/unit/unifiedSelectionSlide20261024.test.tsx` | 复用原真实 Bridge／Session／Driver／History fixture，新增 S1 3 例、S2 5 例；原正确断言及原手势产品代码不迁就旧 14 红而改写 |
| `tests/helpers/currentSlideSelectionBrowserHarness.tsx`（新增） | 包装既有真实 Course runtime／connector harness，旁挂实际 NodesTab，共用原应用 store／Bridge；不改生产端口 |
| `tests/integration/slideSelectionAckBrowser20261025.test.ts`（新增） | 同一 Main 临时文档的物理宿主 ACK／realm 协议 ACK／可见背景拖动／Undo 链；仅 test transport 控制真实 ACK 时序，Source 使用 esbuild 和实际 sandbox |
| 本文件（新增） | 证据、命令、失败与边界 |

## 已执行证据

raw 根目录：`output/test-runs/format-core-repair/selection/`。

1. **修前 S1：2 失败／1 通过**，`before-unit.json`。两个过时 continuation 实际抢回 Source；合法 ACK＋queued end 的正式主体拖动通过。先前 CLI 带不支持的 `--minWorkers` 被 Vitest 在装载测试前拒绝，记录于 `cli-not-run.txt`，不计入测试观察。
2. **修后定向 7 例首轮 6 通过**，`after-unit.json`。S1 两红转绿，A 正式数据、B 新输入对象身份／数据、邻对象、正式操作次数和 History 均有断言；合法 ACK 拖动、既有同目标慢 ACK 双击、旧 hover、旧精确菜单 action 均通过。仅 S2 新坐标 fixture 预期未计入既有吸附：Source 中心 205 距邻对象上边 200 为 5，实际正确吸到 200，故 y=110 而非 115。单例 verbose 查实后，把真实 up 点移出吸附半径，精确 frame、目标、邻对象数据、一次 History 和 Undo 断言保留；该 **1 例通过**于 `after-unit-paint-final.json`，没有重跑其余 6 例。对应说明 `unit-snap-diagnostic.txt`。
3. **浏览器已到达 S1 两条真实 ACK 链**，`after-browser.json` 与 `browser-fixture-toolbar-overlap/ack-facts.json`：普通 physical-host 的 realmFacts 为空，实际 Nodes B 在 ACK 后仍是 B；真实 Source realm 带 authorKey=label、generation=3 的 start／end 也保留 B。两次正式 A 内容各只提交一次，Main revision／History=2，Source／邻对象未改，page／runtime errors=[]。随后 S2 初始测试点位被现存 B quickbar 遮挡，截图已证实点到了工具条；不把这次后段 fixture 失败签成 Source 无法选中。

浏览器准备期还保留两个准确失败，不当成产品故障或隐去：`before-browser.json`／`browser-initial-fixture-ack-late/` 的 gate 晚于真实 PM live input 提交；`before-browser-gate-corrected.json`／`browser-fixture-compile-shadow/` 的局部 `transform` 变量遮蔽 esbuild import，Source 编译前 TDZ。分别仅纠正 test ACK 前置和局部变量名。没有增 timeout、隐藏 hit-plane／quickbar，或改产品来制造浏览器红例。

### S2 新的真实浏览器失败（必须保留）

`after-browser-final.json`／`browser-reused-mouse-before-fix/`：选用绿背景实际可见下部后，Source 已由物理单击正确选中；随后实际鼠标拖动仍没有正式写入，Main History=2、Source frame 仍 (430,90)，因此原 History=3 断言失败，Undo 尚未到达。page／runtime errors 为空。**这次不是工具条点位前置，不能降成 fixture、边缘问题或把期望改成2。** 两个 ACK 对照仍均保持 B。

上述原 owner 根因已由同一 id 的真实 Bridge 用例证实：`before-reused-mouse.json` 为 **1 红／1 过**，后续 Source 已选却没有拖动 History（应2、实1）；较新同 id intent 正常完成。按 record 身份退役后 `after-reused-mouse.json` 为 **2 过**，Source 正式 frame=(470,120)、邻对象不变、一次拖动 History、Undo 恢复原 Source；较新 pending 仍正常完成。原 catch 已清其仍拥有的 deferred record，尚无 ACK reject 同因残留实证，不机械扩全失败矩阵。

### 最终真实浏览器通过

`after-browser-reused-mouse-fixed.json` **1 条完整链通过**，`browser/facts.json`／`browser/ack-facts.json`／`browser/selection-after-undo.png`：

- Chromium 149.0.7827.55，真实 Main 临时文档、当前 Store／Bridge／Course runtime／Slide connector、实际 NodesTab 与实际 Source sandbox。
- 两次 A 正式输入的真实 ACK 分别经过普通 physical-host 与 Source realm protocol；Nodes B 在各次 ACK 前后均保持 B，A 每次提交一次，Source／邻对象不变。
- 实际物理鼠标在可见 Source 绿色非字段背景单击选择，再整体拖动 40×30 作者单位；只改 Source，frame=(470,120)，Main History 从2到3。随后正式 Undo 恢复 Source 原 frame／内容，邻对象仍不变，未进入文字编辑。
- page errors=[]，runtime errors=[]。保留 History=3、精确目标／邻对象、一次提交、Undo 全部原正确断言；没有隐藏 quickbar／hit-plane、增加 timeout 或加 sleep。

最终 DOM 退役修改后，仅增量复跑原慢 ACK 双击1项，`after-retained-double-click-final.json` **1过**，正式 A 数据／一次 History、精确 Source 字段编辑和不重新命中旧坐标的全部原断言保留。因此有效定向单测为新增8项及原慢 ACK 双击1项的对应证据，不是该文件20／20全跑通过；其他未受相关路径影响的有效证据不机械重跑。

`browser/failure.*` 是保留的上一失败快照，也已归档到 `browser-reused-mouse-before-fix/`；最终结果以 `after-browser-reused-mouse-fixed.json` 及 `browser/facts.json` 为准，不删除旧失败。

## 命令

所有命令在上述隔离 worktree 执行，单 worker，按 Root 分配窗口串行运行：

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/unifiedSelectionSlide20261024.test.tsx -t 'discards a realm field start|discards an old realm continuation|continues a valid realm body start' --maxWorkers=1 --reporter=json --outputFile=output/test-runs/format-core-repair/selection/before-unit.json

node node_modules/vitest/vitest.mjs run tests/unit/unifiedSelectionSlide20261024.test.tsx -t 'discards a realm field start|discards an old realm continuation|continues a valid realm body start|keeps the original Source body target|ignores an older Source hover reply|keeps a newer native input|retains the double-click edit intention' --maxWorkers=1 --reporter=json --outputFile=output/test-runs/format-core-repair/selection/after-unit.json

node node_modules/vitest/vitest.mjs run tests/unit/unifiedSelectionSlide20261024.test.tsx -t 'keeps the original Source body target' --maxWorkers=1 --reporter=json --outputFile=output/test-runs/format-core-repair/selection/after-unit-paint-final.json

node node_modules/vitest/vitest.mjs run tests/integration/slideSelectionAckBrowser20261025.test.ts --maxWorkers=1 --reporter=json --outputFile=output/test-runs/format-core-repair/selection/after-browser.json

node node_modules/vitest/vitest.mjs run tests/unit/unifiedSelectionSlide20261024.test.tsx -t 'retires an invalidated host ACK pointer|lets the later host intent' --maxWorkers=1 --reporter=json --outputFile=output/test-runs/format-core-repair/selection/before-reused-mouse.json

node node_modules/vitest/vitest.mjs run tests/unit/unifiedSelectionSlide20261024.test.tsx -t 'retires an invalidated host ACK pointer|lets the later host intent' --maxWorkers=1 --reporter=json --outputFile=output/test-runs/format-core-repair/selection/after-reused-mouse.json

node node_modules/vitest/vitest.mjs run tests/integration/slideSelectionAckBrowser20261025.test.ts --maxWorkers=1 --reporter=json --outputFile=output/test-runs/format-core-repair/selection/after-browser-reused-mouse-fixed.json

node node_modules/vitest/vitest.mjs run tests/unit/unifiedSelectionSlide20261024.test.tsx -t 'retains the double-click edit intention' --maxWorkers=1 --reporter=json --outputFile=output/test-runs/format-core-repair/selection/after-retained-double-click-final.json
```

S2 单例另以 `--reporter=verbose` 取得吸附实际值；浏览器准备两轮使用对应 before 报告路径。`git diff --check` 对产品与 unit 文件通过。

## 未覆盖／不扩大结论

- S1／S2 当前最小浏览器链已通过；没有把它扩大成全部 Slide／Source 功能或全引擎通过。
- 同一选择的新输入保护由真实 Bridge mounted 用例签收，浏览器目前签 Nodes 换选；未冒称浏览器已验证新输入时序。
- jsdom 的局部 paint 能力只用于协议装配，真实 paint 由 Chromium 链承担；不把 mounted hit list 说成真实像素。
- 没有跑旧 Slide 全文件、全仓矩阵、typecheck、Electron／保存重开或全引擎；没有宣布旧 14 红全清零、全产品验收或 Owner 接受。
- realm cancel／late end 的处理分支及旧 Flow／图片未改，本轮不为无关重跑扩面。若发现需改手势含义、优先级、模式或用户入口，应先给 Owner 前后差异；本次未产生这种决定。
