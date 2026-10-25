# 属性草稿实际路径独立核查

2026-10-25。本叶只读调查 Root 当前集成源码；不写产品或正式测试。主实现由 document_repair 在隔离候选负责，Root 已集成最终白名单。当前状态：**修前真实 RightSidebar 浏览器已证 IME 的 blur-pending 换选会丢 A 最终输入；修后同一链 1/1 通过，A／B raw 均可恢复，显式 Esc 取消 A 后 B 可提交 Main，frame 保持。** 数值／公式原正常路径仍通过。Chromium 已关闭，运行窗口已释放，不再扩大验证。

## 当前可确定的边界

真实入口是 `RightSidebar → PropertiesTab → usePropertiesContext → usePropertiesAuthoringBinding → PropertiesPanelRouter → SlideNativePropertiesPanel → PropertyDraftBoundary → BufferedInput／FormalFormulaPropertyEditor／TextContentTextarea`。

`RightSidebar.tsx:185—188` 对图层／属性使用 `visited` 后常驻的 `hidden` 容器。切换 tab 不是卸载属性根；`PropertiesTab` 和 Router 的 slide-native 分支也没有强制 key。真正 A／B 控件重挂由 NativePanel 内 `PropertyDraftBoundary` 的 keyed Provider 决定。因此不能把旧后两例的持续 PropertiesTab 装配当成“不可能发生、真实 Root 总会重新挂根”。

真实 binding（`usePropertiesAuthoringBinding.tsx:71`）是 JSON 数组：documentId、epoch、root、surface、state、selected ids、global、精确 author-field identity。非 IME 目标切换立即换控件，旧 registry entry 卸载停放；活动 IME 只保留其原 input DOM 到 compositionend。`usePropertyDraftFlush` 在新控件挂载时按原 target／label／kind 取回停放 raw；无归属的非数组 binding 卸载会被清掉。`flushPropertiesDrafts` 对已卸载 owner 仅等待已准入 pending，未应用 raw 继续停放，不阻塞别的当前属性。这种返回 true 本身不证明 raw 已写入或已丢失。

## 三条旧红例应分别判断

| 旧例 | 夹具实际路径 | 静态核查结论／仍需证明 |
|---|---|---|
| retains a dirty draft when the captured target changes and refuses to retarget save | 直接 rerender Boundary／BufferedInput，key 使用不可解析的 `'first'/'second'` | 它期待非 IME 同一旧 DOM 常驻，与当前 keyed Provider 策略不同；且该 key 无法归属文档恢复。不可用这个 DOM 身份首错直接证明真实 A 丢稿，也不能只改 key 使 raw 被清空而称修复。真实对应应查 JSON binding、返回 A 恢复／取消、B 不受阻。 |
| preserves a dirty formula source on target change and refuses to save it into the neighbor | 实际 Main／Store／PropertiesTab，直接 store.selectNode 从公式 A 换 B | 正式 LaTeX 控件有独立 raw、baseline、pending／failure；不在 blur 自动应用，应用由 Enter／“应用公式”或原 flush 路径触发。A 可被停放，flush=true 不是误写 B 的证据；必须核返回 A 的 x+1、B 可独立应用、A 可取消、durable raw 保留。 |
| keeps an IME property draft on target change and cancels its original canvas owner without writing the neighbor | 实际 Main／Store／PropertiesTab，直接 store.selectNode 从文字 A 换 B；没有真实 blur | 与真实持续 hook 装配相符；但真实图层 tab／Node click 会先造成 textarea blur，可能进入 blur-pending，和 direct selection 时序不同。仅看 compositionend 后 flush 的 true／false，不能裁定原稿、canvas owner 和 B 的可用性。 |

第2／3不是直接 rerender 控件；不能把第1例的 key／DOM 前置问题一并套用。

## 修前原 owner 断点与实际等级

1. `TextContentTextarea` 的属性正文共享 `slideContentEdit`。A IME 期间换 B 时，Boundary 暂留 A 控件，但 hook 已读 B；旧 A `updateDraft` 的 liveTarget／requireLiveSelection 会拒绝新选中的上下文。旧 A setComposing(false) 仍可能结束 A 的共享输入。该静态链已由下述实际浏览器补全结果，不再只是候选。
2. **主实现独立 mounted 红例已证 B raw 丢失**：没有 blur 的换选时序中，A shared draft 留存，B begin 被拒绝但 textarea 继续接收 raw，flush=true，Main B 仍原值／History=0，registry 只有 A raw。该证据由 document_repair 持有，本叶不冒称亲自执行，也不把它等同物理 IME。
3. **本叶真实 RightSidebar 浏览器已证 A raw 丢失**：真实点击图层 tab 会触发 A onBlur→blur-pending；合成期间选中 B，A shared.composing=true 且 DOM仍是原 A；最终输入“A 的中文完成”后 shared=null／registry=[]，返回 A 只有“A 原正文”。这与上行互补，不能只修 B admission 而忽略原 A 输入被误认完成。

这些断点应在原 owner 修复，不能用清草稿、无条件 remount、冻结整个属性面板或新建第二 draft／writer 掩盖。修后同链表明仍沿原控件、原共享输入 owner 和原 Esc 取消路径完成，没有发现需要新 UI／模式／默认路径产品决定。

## 实际执行与原始证据

全部在 Root `D:/果铃工作台`，单 worker，按 Root 窗口串行执行，结束后 Chromium 已关闭并释放窗口。没有写 `src/` 或 `tests/`。

| 阶段／raw | 到达结果与准确归因 |
|---|---|
| `root-before.json` | ignored 探针误从不存在的 `src/components/formula` 导入，测试尚未装载；改为既有 `components/text` 正式导出。不是产品故障。 |
| `root-before-import-corrected.json`／`fixture-tab-toggle/` | 实际 Nodes 的 crossSurfaceCommands.selectNode 自动切属性，探针又点一次已展开“属性”使其关闭，故找不到 X。只修自动化在 tab 已展开时不再 toggling，不改产品导航。不是属性失效证据。 |
| `root-before-tabs-corrected.json`／`root-before/facts.json`／`root-before/failure.png` | 一条真实 Main／Store／Bridge／Course runtime／RightSidebar 链，数值及公式全部目标断言到达并通过，最后 IME A 恢复断言失败。0 pageerror；不把前半正常掩成全链通过。 |
| `root-after.json`／`root-after/facts.json`／`root-after/final.png` | Root 集成后仅复验同一链一次，1/1 通过，10.54s。修前 A 恢复首错已通过，继续到原 Esc 取消 A、恢复 B、原 flush／drain、实际 Main 正文及 frame；0 pageerror。 |

成功的数值路径：A.X 输入 `-` → 实际图层／Nodes B（B.X=400）→ 返回 A.X 仍为 `-` → Esc 后 A.X=80；Main History=0。真实 JSON binding 的 raw 留在原 A，不是旧第1例的无归属 string key。

成功的公式路径：A 原 x，输入 x+1 后切 B，registry 为 A 的 x+1／baseline x；`flushPropertiesDrafts(documentId)=true`，Main History仍0；B 应用 y+2 后 History=1，A与两个文本实例未改；原 `courseInputs.prepare(...,'preserve')=true`，Main `readAuthoringDrafts` 实际含 A 的 x+1（含 recoveryRecord）；返回 A 恢复 x+1，“取消”后回 x，未误写邻公式。这证明本例的 flush=true 是“停放 raw 不阻塞 B”，不等于把 x+1 应用到 B或丢原稿。

IME 失败事实（保持原探针正确断言）：

```text
选中 B，A shared.composing=true，registry A raw=“A 的中文候选”，sameImeDom=true
compositionend final=“A 的中文完成”
之后 shared=null，properties=[]
B 输入“B 的新正文” → flush=true → 返回 B 仍保留新正文
返回 A：actual=“A 原正文”，expected=“A 的中文完成”（失败）
```

IME通过真实 DOM CompositionEvent/InputEvent 驱动组件生命周期，tab／Nodes 是实际浏览器点击；明确不是 Windows 系统输入法实测。失败事实支持**输入生命周期真实产品断点**，不扩大为所有中文输入、所有模式或全部属性保存都坏。主实现已收到该原始事实。

## Root 集成后实际结果

源码根为 `D:/果铃工作台`，Chromium `149.0.7827.55`，保留相同实际 RightSidebar／Nodes／binding／Main 协议装配。

1. 数值 A.X 的 `-` 仍按原 JSON binding 停放，返回 A 可恢复，Esc 回 80；History=0。公式 A 的 x+1 仍可停放，B 可应用 y+2；原 preserve prepare 后 Main durable records 仍含 A 的 x+1，返回 A 可恢复／取消，History=1。未把原来正常的停放语义改成一律阻塞或自动提交。
2. A 合成期间通过浏览器实际点击 Nodes B，`sameImeDom=true`，原 A input DOM 保留。compositionend 最终中文后，A shared input 仍属 A，`composing=false`；registry 保留 `raw="A 的中文完成"`、`baseline="A 原正文"`，不再消失。
3. B 输入 `B 的新正文` 时，A 原 owner 尚未完成。B 首次 `flush=false`，registry 同时保留 A 最终中文与 B 新正文；界面仍沿现有提示“属性草稿对应的编辑目标已经改变，请按 Esc 放弃草稿后重试。”提示拒绝，没有虚报完成或清掉 B raw。返回 A／B，各自恢复准确 raw。
4. 沿原可见操作返回 A 按 Esc 取消，再返回 B，仍显示 `B 的新正文`；原 `flushPropertiesDrafts=true`，随后原 `drainCourseDocument` 到 Main。实际 Main textA 仍为 `A 原正文`，textB 为 `B 的新正文`，textB frame 仍为宽240／高90、transform `[1,0,0,1,400,100]`。最终 undoDepth=2（公式 B 一次、正文 B 一次），saveError=null，0 pageerror。

修前 raw 与失败截图均保留，未覆盖。此次成功证明真实浏览器 UI 生命周期、原 owner 保稿与正式 Main 写入；IME 输入仍是 DOM composition 协议驱动，**未冒称 Windows 系统输入法实测**。未另跑整应用 Electron、全部属性矩阵、磁盘保存冷开或 Undo；主实现自己的 GLX 冷开／单元与 Root 类型结果由各自报告承担，本叶不冒称独立执行。

## 独立探针与最小复验记录

ignored 目录：`output/test-runs/draft-compute-repair/draft-browser/`。

- `draft-path.test.ts`：一个真实 Main 临时工程；复用既有 Course runtime／Slide connector，并直接挂**真实 RightSidebar**。图层／属性的 visited／hidden、Nodes click、所有 binding／flush／registry 均来自当前产品，没有在 harness 复制守卫或 flush 规则。
- `draft-path.config.mts`：只 include 这一例，单 worker，禁用无关 setup／globalSetup。原30s不提高，不跑矩阵。
- 路径：真实数值 X 输入 `-` → Nodes B → 返回 A → Esc；公式 A `x+1` 停放 → B 应用 `y+2` → 原 courseInputs.prepare 保全 → 返回 A 恢复／取消；文字 A 合成协议 → 实际图层／Nodes B → compositionend → B 输入 → 离开／返回两者。A 中文和 B 新 raw 都必须仍可取回；正式内容、History、raw records、Main durable records 及错误信息同步记录。修后已到达原可见 Esc 取消 A、返回 B、原 flush／drain、B 最终 Main 正文及 frame 不改断言。
- IME 通过真实 DOM composition 事件驱动组件生命周期，明确不等于 Windows 物理输入法验收；不会把模拟事件说成系统 IME。普通 tab／Nodes 操作使用真实浏览器点击。
- `DRAFT_SOURCE_ROOT` 可选择 Root 或主实现候选，但同一 bundle 的 store、UI 和 runtime 均来自该同一源码根，不混用两个 store。Main 文件服务沿 Root 的未改实际服务；输出按 `DRAFT_RUN_LABEL` 隔离，保留修前／修后 raw，不覆盖原失败。

修前实际命令（另两轮分别写上表同名报告）：

```powershell
node node_modules/vitest/vitest.mjs run --config output/test-runs/draft-compute-repair/draft-browser/draft-path.config.mts --reporter=json --outputFile=output/test-runs/draft-compute-repair/draft-browser/root-before-tabs-corrected.json
```

Root 最终白名单集成后实际命令：

```powershell
$env:DRAFT_RUN_LABEL = 'root-after'
node node_modules/vitest/vitest.mjs run --config output/test-runs/draft-compute-repair/draft-browser/draft-path.config.mts --reporter=json --outputFile=output/test-runs/draft-compute-repair/draft-browser/root-after.json
```

本叶交付仅本报告与 ignored `draft-browser/` 探针／raw，产品与正式测试保持只读；不 commit、push 或发布。最低充分的同链复验已完成，停止新增运行。
