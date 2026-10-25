# 集中独立技术审查

日期：2026-10-25。Reviewer：`baseline_review` 子智能体；未参与产品、测试或基线脚本实现，仅提交审查意见及本文。依据 `WORKING_PROTOCOL.md` §3.1、当前 Owner 指令和本目录 PLAN。主执行者的实施、自检和产品决定不作为独立审查结论。

## 当前结论

已核候选的产品源码 diff、测试 diff、新增图片面板 / CSS / 图片浏览器装配与两份浏览器用例、基线脚本，以及 DOCUMENT / HTML / FLOW / ENGINE / REMAINING / IMAGE_GUI_RESULT 和 OWNERSHIP_INVESTIGATION。**D01 消费者覆盖缺口及终点阶段确认的 R2 专业文本控件回退，均已按下述窄边界完成候选增量复审；当前无未处理的产品技术审查问题。未发现通过删除正确数据、范围、History 或保存断言来迁就实现。产品候选与诊断交付有效；整体全量比较仍未闭合，不能据本文宣称全仓通过或全部新增稳定失败已消除。**

## 需闭合事项

| 项目 | 当前源码事实与用户影响 | 最小处理 |
|---|---|---|
| D01 原生图片裁剪消费者：已闭合 | 原候选的 Flow 浮层与 Spatial 图片面板没有方案列出的裁剪入口。增量已将原生 frame / 实际 bounds 或 anchor 接回现有 `ImageCropOverlay`，保留非零旋转限制；Flow 所选原生图统一接原 `actions().mediaTools.openCrop`，沿原 `FlowMediaCropEditor` 只写 data.crop，不另改 frame / paragraphAnchor。 | Reviewer 已核增量源码、两项新增浏览器用例及原始报告；Spatial 150% 下精确裁剪 / 一次 History / 整实例 Undo 和 Flow 锚定浮层裁剪 / 保 frame 与锚点 / Undo / Esc 零写入均有实际证据。没有新增裁剪引擎、几何 owner 或缩减 D01。 |
| 构建生成噪音：已闭合 | 审查时另有 17 个 `src/shared/generated/componentBuiltinSources/*.ts` 改动；已抽核的文件将依赖注释 / 模块路径从 `node_modules/...` 变为 `D:/果铃工作台/node_modules/...`。主执行者确认来源是 Junction 下重新准备 player，启动时这些文件清白、无本轮组件 runtime 改动后，仅恢复这 17 文件。 | Reviewer 增量核对该目录 git status 已干净。此项属于候选范围 / 维护问题，不冒充当前产品不可用。 |
| 最终证据：运行结束，比较仍未闭合 | 前一根目录集成候选有三段 typecheck、两份新浏览器完整文件 4/4；Root 已记录后续候选必要三段 typecheck exit 0，可按同一候选复用。起点 308 文件、终点 304 文件复跑均已完成；运行器错误、重复名称仍保留 `reportComplete=false`，终点 exit 2。 | 产品候选已有有效组合证据；全量比较仍未闭合。不得将本次源码审查、局部通过或旧失败归因替代终点事实，无需因 Reviewer 变更重跑未变的有效检查。 |

以上事项已逐项发回主执行者。裁剪增量及生成噪音已完成对应复审；主体未变范围的审查继续有效。最后证据由主执行者按实际运行补齐，不因独审再次重跑未变范围。

## 已核的关键边界

- **R1 插入**：合法 GUI 空程序根不再被共享 planner 的 `childIds` 存在性检查误拒；原 Gateway 整对象句柄接受范围在适配处保留。共享规划、继承锁检查和正式 operation / History 未另建 owner。原始 `boundary-focused-first.json` 中 `glxRendererConsumers20261020` 与 `auditGatewayInsertionLayout20261023` 完整文件均通过；这不代表该组合报告整体通过。
- **Flow 运行与 D02**：点击捕获只在编辑态执行；试运行不再挡宿主 DOM 业务事件。定位仍调用原布局计划；上下文字层 / 转正文进原“更多”，删除复用原对象菜单。新增真实 Main / Store / Bridge / Flow 浏览器用例保留编辑点击不执行业务、拖动只产生一次 revision、Undo、试运行恰一次业务点击、默认教师展开及回编辑再选中的断言。
- **文档 U-R02—06**：普通文档固定栏与原选区动作已对照 `2376311b3`；Flow 文档级正文 / 源码、插入及草稿动作回稳定区域，目标格式仅在一个选区条。段落能力依据正式节点 / schema；带出处引用继续经旧菜单保护。链接快捷入口复用旧 `openLink`，通过已有 `trackSelection` 保持原范围，未造第二 writer。
- **HTML / IME**：恢复顶部“编辑 / 完成编辑”，保留整体 ACK 与选择 / 输入分离。HTML 图片写入支持子集符合 D01 的精确字段边界，异步选图显式捕获原 target；Main revision 检查未删除。IME 修复仍由原输入 owner 在 compositionend 读取最终值并一次完成；没有全局样式 mock。
- **图片面板**：参数仍调用现有 properties 命令；替换走原资源 / canonical transaction。Slide 与共享交互 hook 的原生图片分流修正使其保持整对象拖动；内部图片仍带 `selectionIdentity`，没有降级改父对象。图片专项测试确实断言替换保 frame / flowLayout、一次旋转 History / Undo / Redo、完成后身体拖动和新 DocumentHost 冷开数据，没有用 Alt 拖 / 句柄拖替代原目标。
- **R4**：非 owner 取消只改提示，原权限、错误码和零取消调用断言保留。新增 OAuth 用例使用真实 `chatgpt-responses` 序列化 / 预算路径，明确断言实际 compacted、旧 native round 退出后续 wire、原运行记录保留及 call / output 配对；没有改算法或付费调用。
- **测试迁移**：Flow 输入用例的 `setInputActive(true)` 对应已批准的显式进入输入；文件文档仍断言直接可输入。公式 / 段落 / 格式查询移到唯一条后，原数据、邻文、IME、ACK、Undo、保存和 DOM 结果断言继续存在。`resolveSelection` 补的是当前 mock 缺少的真实生产 hook 返回端口，不是在生产加兜底。
- **只读调查**：两项 `object.update.appearance` 有效外观差异与当前 GUI / core planner、渲染优先级一致；调查没有借机迁移业务或更改产品语义，其余类别没有被无证据扩成重构任务。

## 基线脚本独审

R0 早期候选中已报告的缺口已在当前脚本修正：JSON 与 default reporter 同时输出以捕获未处理错误；嵌套 Hook / 文件级错误及明确文件通过观测；旧实际执行用例消失 / skip 的未决；有旧真实用例观测时不误判遮蔽；重复名称不算 fixed；纯 passed 文件记录不制造假缺失；pending / 未完成报告不宣称完整。

当前仍直接读取原 `test:product` 两个 exclude；文件发现为 1495，默认 workers=3。失败文件一次独立进程复跑，首过复跑失败也保留；旧偶发到当前稳定会算新增稳定失败。未运行 / 改名 / 缺失不算修复，文件遮蔽和重复名称保留未决；脚本不接入 build / CI，不自动批准失败。HEAD、dirty 前后、版本、范围、并发、耗时、数量和原始报告位置有记录。

以上为源码语义审查；实际起终点结果和未决分类仍需主执行者按同次运行保全，不能据此称全仓通过。

### 起点初轮原始报告的现阶段限制

Reviewer 只读核对 `D:/果铃工作台/output/test-baseline/2026-10-24T15-57-58-625Z/initial.json`、`initial.log` 与同次 `files.json`：初轮发现和报告均为 **1495 文件**，没有漏报或意外文件；**8430 用例 = 7849 passed + 571 failed + 10 skipped**。具体 assertion 没有 pending，日志没有“生成报告时仍在运行”警告。Vitest 聚合 `numPendingTests=10` 包含这些 skipped，不应混同仍在执行或据此新增“必须无 skip”的门。以上不是整轮稳定 / 偶发分类；该轮失败文件单独复跑尚在进行。

同次日志 50111—50204 明确报告 **4 个 unhandled errors**，关联 `g20SkillTools` 的 content TypeError、`g20S07ToolIncrementDelivery` 的 MCP connection closed、`glxContainerEditing20261020` 的“当前会话没有课程工程”、`componentPlatformW0SpatialPointer` 的拒绝提交。Vitest 的关联测试提示不等于已经证明唯一根因或其他测试不受影响。

这些错误是在本轮候选产品修复合入前的起点中实际观察到的**既有证据限制**，不是可豁免白名单。原始错误、issues、exit 2 和 `reportComplete=false` 必须保留；即使终点出现同名错误，或具体断言通过，也不能自动清掉限制或签“全仓无新增失败”。可对有真实对应观察的用例给有限稳定 / 偶发 / 修复 / 未决分类，同时明确整轮比较未闭合。

pending 解析补充与纯 passed `<file>` 比较修正没有改变已执行测试观察，不要求重跑起点。该轮全部复跑结束后，可对**同次保留的全部 raw JSON / log** 做一次性重解析，核对具体 pending / 未完成警告、文件集合、明细数量、重复名称与 unhandled，补准确的解析版本 / 修正说明；不要替换原始报告、消除真实错误、重新 record 一份起点或把整轮标完整。本初轮没有实际 pending，故该项晚补解析不会改变上述初轮状态；复跑结果仍须按实际检查。

### 起点分类完成及根目录组合证据增量

Reviewer 直接读取 `D:/果铃工作台/output/test-baseline/start-e77963756.json` 并只读扫描同次 **309 份 raw 报告 / 日志**：起点 308 个失败文件复跑已完成；具体用例观察为 **561 稳定失败、16 偶发、7843 通过、10 未通过（原 skipped）**，另有 **7 条文件级稳定失败**，不能混作新增用例数。报告保留 initial 以及 retry-69 / 75 / 162 / 226 的运行器 / 全局错误、6 组同名的 12 条额外 occurrence，`reportComplete=false`。扫描确认没有具体 pending 或 still-running 警告；Root 没有清洗这些真实 issues。

CA246 的起点初轮与 retry-129 均失败。Reviewer 读到 retry-129 完整 JSON：该文件 1 条明确失败、无用例缺失；末尾另有 forks worker 终止超时。该清理警告应保留为同次诊断，单凭它不足以再推断另有漏报用例或增加新的全局通过门，亦不能将明确的用例失败抹去。Root 的阶段探针在原 watch 与 watch:null 下各只执行一次，均在 Vite 页面载入 / 调度边界停滞、Worker / Python 未启动；当前没有唯一根因结论，不能把它说成 Python 执行失败，也没有据此修改正式测试、配置、断言、timeout 或 exclude。

已直接读取根目录 `output/test-runs/boundary-root-browser.json`：Flow 两例与图片两例均实际 passed，两个完整文件 **4/4**，不是 filtered 用例重复计数。`boundary-root-typecheck.log` 记录原 npm typecheck 的 main / electron / e2e 三段调用且无诊断，主执行者记录该进程 exit 0。候选集成后的产品组合证据有效；这不使全量比较自动闭合。

终点已在同一次 `--check` 运行中启动（`output/test-baseline/2026-10-24T17-20-02-350Z/`，1497 文件，默认 3 workers）；本文此时**不签无新增稳定失败**，待真实终点分类再做事实增量核对，不重审未变源码。

### 最终冻结样本与比较事实

终点已完成并返回 **exit 2**。Reviewer 直接读取 Root 的 `docs/development-plan/test-baseline/known-failures.json`，并只读扫描同次 **305 份 raw JSON / log**（1497 文件初轮 + 304 文件单独复跑）：没有具体 pending、still-running 警告或明细数量不符。具体用例为 **7874 passed、541 stable-failure、14 flaky、10 skipped**，另有 **1200 文件级通过、7 文件级稳定失败**。比较保留 **newStable=14、fixed=34、becameFlaky=0、masked=0、unresolved=36**；后者是 **18 个唯一键**，全部属于同文件同名的 6 组重复记录，不能当成 36 个新产品缺陷。

初轮有 **8 个 unhandled errors**；后续 retry-70 / 77 / 164 / 221 / 268 仍各有运行器 / 全局错误标记。前四类与起点关联的错误相同，另四个初轮错误关联 `slideContentFirst20261022`，不能把终点全部八个说成起点已经观察到。起点本身也不完整，加上重复名称无法可靠对应，报告正确保留 `reportComplete=false` 与 issues；不得洗成“全仓无新增失败”或“全绿”。

14 条新增稳定失败的冻结观察与已审补正对应如下；已通过的后续聚焦证据**没有倒填**原比较：

| 冻结样本中的新增稳定条目 | 数量 | 当前审查状态 |
|---|---:|---|
| HTML 顶部旧“进入创作”locator：htmlAuthoringRecords 1、unifiedSelectionHtml 3 | 4 | 已审 U-R01 等价 locator 补正；两个完整文件 17/17 的后续证据覆盖，不改原 raw |
| HTML 占位图旧“选择图片”locator | 1 | 已审 D01 locator 补正，目标过；该完整文件仍 17/18，不称全绿 |
| 图片 GUI 固定保存名撞上原 GLX | 1 | 已审唯一保存路径夹具补正，首用例后续 1/1，不删除原 GLX 或放宽 SaveAs |
| 画布专业文本控件回退：Shared inline host、Popover 高亮 | 2 | 已审窄产品分支恢复；真实范围 / 光标与 Popover 原断言通过 |
| 普通完整文档两处按新“加粗”查询旧入口 | 2 | 已审明确 file / 原“粗体”的等价 fixture；原数据、marks、Undo 不变 |
| Flow 两处旧“所有 toolbar 只能一条”断言 | 2 | 已审稳定文档动作区 + 唯一目标格式条的准确能力断言；完整 11/11 |
| executionRepair 的 repair18 automatic 首次模式选择 | 1 | 起点 **passed / passed**、终点 **failed / failed**；“问题已回答或已关闭”仍待归因，不能称旧偶发或凭未改相关业务代码判无关 |
| offscreenSandbox cooperative activity snapshot | 1 | 起点 **failed / passed**，终点同点 **failed / failed**；旧偶发转为本次稳定，按规则计新增稳定；根因仍待只读归因 |

上述前 12 条已由已审候选补正及限定聚焦证据覆盖，后 2 条保留实际新增稳定 / 未决事实。冻结全量尚未包含最后一处产品呈现分支与六份测试补正，Root 将在原观察落盘后集成并保留同次 JSON / 比较。最终定义依靠未变有效证据与已审后续补证组合，不宣称已跑过“最终定义全仓”，不为洗掉原观察重跑 1497 文件或重新 record。后两条归因材料完成后仅增量核事实，不重审既有产品候选。

### 综合结果与未决归因的最终文字核对

Reviewer 已直接阅读 Root `RESULT.md` §7、`test-baseline/README.md` 及 ENGINE / REMAINING 的只读归因追加：起终点统计、14 条唯一对应项、36 / 18 的重复名称口径、12 条样本后补正、两条新增稳定未决、未修改 JSON / 重新 record、最后 1 产品 + 6 测试补正后的证据范围，与已核原始观察一致。两份文档没有将 34 个 fixed 直接冒充 34 个本轮产品修复，也没有宣称最后定义全仓通过；候选补正后三段 typecheck exit 0 与未变检查复用边界写明。

offscreen 的追加说明已与测试 237、246—250 行核对：失败的是作者 40ms 回调另存的 `paused.late`；249 行读取的**当前活动快照与 readonly 已通过**，不能改写成当前 activity getter 为 undefined。70ms 固定等待与现有报告未记录作者回调 / 活动到达顺序，不能区分未执行回调和活动到达前读取；runtime 直接 owner 链未命中本轮 UI 改动、fixture 不挂载这些 UI，只支持“尚无直接因果证据”，不证明产品无问题或允许抵消旧偶发转本次稳定。

repair18 的 executing 可见与 question 注册之间存在源码窗口，且 stepwise 参数族已有同点偶发；没有本次 trace，仍不能将 automatic 的起点 passed / passed、终点 failed / failed 降格成历史偶发，亦不能断定真实问题已展示后用户无法回答。Root 第7节保留两项未决及后续需证属性的表述准确。它们已有只读归因材料，结论仍是证据不足，而非未开展调查。

本次只核文档事实与必要测试片段，产品 / 脚本审查及所有未变有效证据复用；没有重跑测试、修改 Root 文档、产品源码、失败快照或正确断言。不代替 Owner 作新产品决定、整体接受或发布批准。

### 终点冻结后的两处 HTML 测试入口补正

Reviewer 已直接核对候选 diff：`htmlAuthoringRecords.test.ts:349` 和 `unifiedSelectionHtml20261024.test.tsx:49` 各仅将一个按钮 locator 从“进入创作”改为“编辑”。这是 U-R01 已明确要求恢复的同一 HTML 顶部模式开关，不是修改产品以迎合测试；没有改变 fullName、事件 / 模式 ACK、几何、数据、History 或后续行为断言。源码没有随这次补正变化，原候选产品与根目录有效组合证据可继续复用。

已读取 `output/test-runs/html-direct-consumers-verified.json`：上述两个完整文件分别 10 和 7 条，合计 **17/17 passed、0 skip**。本次明确 include 两文件、globalSetup=[] 的聚焦配置没有删用例或放松断言；它不证明其他文件，更不替代终点全量。

终点运行使用的是 Root 冻结的原两份测试定义，补正此时尚未集成。等终点实际落盘后，若其中出现旧 locator 失败，应如实保留该次 raw / comparison / known-failures 的观察；再单独记“终点当时的定义存在已确认名称恢复后的测试入口失配，后续两行等价补正由两个完整文件 17 条通过补证”。不能将补正后的通过倒填进原全量、从原失败列表删除，或写“最终定义全仓无新增”。这是同一产品候选的后续测试消费者补正，足以在原证据之外闭合该有限变更，不因两行 locator 再跑 1497 文件或重新 record 洗掉原观察。

### 图片 GUI 用例保存目标补正

Reviewer 直接比较冻结 Root 与候选的 `imagePanelBrowser20261024.test.ts`：仅新增 `node:crypto` 的 `randomUUID` 导入，并把固定 `image-panel-saved.glx` 改为每次唯一的 `image-panel-saved-${randomUUID()}.glx`。根目录终点初轮 raw 中，该首用例确实在 `DocumentHostService.save` 以“另存目标已存在”失败；同文件 Spatial 例实际通过。这是测试复跑时输出目标重用造成的夹具问题，不能为了让测试绿而改正式 SaveAs 的既有目标保护或删除原 GLX 证据。

该补正保留正式 `host.save`、全新 DocumentHost 冷开、实例 data / frame、资源及 History 的全部原断言，未删原文件、覆写已有 GLX 或改产品。已读取候选 `output/test-runs/image-panel-browser/vitest-unique-save.json`：受影响首用例 **1/1 实际通过**，Spatial 例因 `-t` skipped，不能将该次写成两个完整用例通过。facts 记录唯一的新保存路径及实际冷开成功；与本补正无关的 Spatial 原通过证据继续有效。

此测试修正也应在终点原始观察落盘后再集成；保留原 raw / comparison 中的保存冲突失败，并单列后续针对性补证，不倒填全量或重新 record。产品与保存权限语义未变，原产品独审和有效证据继续复用，不为这一输出文件名补正重跑全仓。

### 画布专业文字与普通单元格的控件边界裁决（已增量闭合）

终点阶段补查确认：R2 将 `SharedDocumentEditor` 的非 Flow 固定格式区域统一恢复为原普通控件，连带使作品内专业文字输入失去已批准的共用 `TextFormatControls`、范围说明及字号步进。原集中审查没有充分区分这一直接消费者，现明确更正；不能把该回退归作测试查询漂移，也不能反过来给全部 `inline-text` 套用组件改版。

Reviewer 只读核对当前生产调用图及原统一 PLAN §2 / §5.2—5.3、本轮 U-R06 / R2-B 后裁决：**仅 `!documentScope && Boolean(props.toolbarHost)` 使用既有共用 `TextFormatControls`**，其余普通控件、Flow 当前唯一格式条及文档级操作保持原边界。这是当前已存在 producer 事实的最窄充分区分，不引入新 UI 类别或第二内容 owner。

- `components/text/editor.tsx:46—51` 将 inline-text 与 host 原样透传；作品内 `ProfessionalContentEditor:115—116` 和 `useSlideNativeTextEditor:312—316` 的表格单元格明确给外置 host 与 scope，属于已批准的画布专业输入条。
- 属性面板 `TableComponentEditor:69—70` 与 `ComponentAuthoringPanel` 内 `TextComponentEditor` 不传 host，保留原普通控件。`tableRichEditing.test.tsx:36` 查询“粗体”是在保护这一受支持路径，不能改成“加粗”来扩大产品边界。
- `LessonDocumentEditor` 虽提供 host，但 documentScope=true；Flow 全文亦为 document scope，不被上述窄条件命中。没有把外置容器本身误当所有文档都接受组件改版的授权。

Reviewer 随后直接比较冻结 Root 与候选 `SharedDocumentEditor.tsx`：增量确实只有上述 `TextFormatControls : 原控件` 呈现分支，复用原 scope / step / style / toggle；链接、公式、清除格式、输入 / History 没有分叉。两份普通完整文档 fixture 明确 `target="file"` 后恢复“粗体”查询，原 mixed marks、字体、DOM 光标、stored marks、Undo 断言均在；专业 inline-text + host 的“加粗”断言未改。Flow 原“所有 toolbar 必须一个”断言替换为 U-R03 / 04 的准确能力：稳定正文 / 源码 / 插入区域不带加粗、唯一当前格式条且全 DOM 仅一个加粗、格式条不带源码；没有只把数量改成二来放过重复格式条，原选择、连续输入、范围和写入断言不变。

直接读取 `document-boundary-external-field.json`：三个完整文件 **24 条中 23 passed / 1 failed / 0 skip**；专业 Popover **2/2**、普通 `tableRichEditing` **1/1** 保留原断言通过，SharedDocumentEditor **20/21**。唯一 stale-paste:true 的 `diagnostic.not.called` 失败，在起点中已真实观察 failed / failed、同一“粘贴目标已改变”诊断；本增量不改该用例、paste / 资源逻辑或断言，不能称整个 Shared 文件或该组合全绿。Flow `document-boundary-flow-remaining.json` 完整 **11/11**，新产品条件不命中该路径，沿未变有效证据复用。

该边界及必要行为的候选增量已闭合；Root 终点观察继续冻结，之后的实际集成和必要类型检查由 Root 收口。原终点失败与本次后续修复分别报告，不重跑未变全仓或改写原始失败。

### HTML 占位图直接消费者补正

已核 `g20M23HtmlLightEdit.test.ts` 仅一行按钮 locator“选择图片”→“替换图片”，对应 D01 明确的图片面板动作。占位图地址、Source AI 卡存在、不绑定动态文字的诊断 / AI 禁用断言均未改；原测试只检查按钮存在，没有把它冒称实际 picker / 替换提交证据。异步精确目标仍由原新增图片用例验证。

直接读取 `html-lightedit-direct-verified.json`：完整文件 **17/18 passed、0 skip**，目标占位图用例通过；另一条 ACK 用例仍查旧“编辑预览”而失败。起点也记录该 ACK 用例 failed / failed、同一旧名称失败。此次未改它或产品握手，不称该文件全绿。先前两个顶部 locator 的 17/17 与图片唯一保存名的 1/1 补正证据继续有效，没有重复执行或覆盖终点 raw。

## 裁剪增量复审

- `NativeSelectionContext` 接受当前原生图片的实际屏幕 bounds / anchor，复用既有源到客户端矩阵和正式 properties patch。Spatial 的 camera 投影没有另建几何 writer，非零旋转仍显示原限制；`ImageCropOverlay` 算法未改。
- `FlowWorkspace.selectedImageId` 包含正文、浮层与全局的原生图片，裁剪统一委托原媒体 owner；内部图片仍按真实 author-field 能力处理。`FlowMediaCropEditor` 增量仅为对话框焦点、Esc 和 IME 判断，使从面板转入后可立即取消。global 属静态接线核对，没有冒称独立全局 GUI 证据。
- 已直接读取 `image-panel-browser/spatial-crop/vitest.json` 和 facts：新增 Spatial 例实际通过；320×200 → 280×200、translation 不变、crop.right=.125、一次 History、Undo 整实例恢复并保选。已查看 `spatial-cropped.png`，画布右边裁去且选框对应新 frame。
- 已直接读取 `flow-floating-boundary-20261024-crop/test-report.json` 和 facts，并核对实际新增用例的真实输入与断言：左裁剪 .2、frame / paragraphAnchor 不变、一次 History、Undo 和立即 Esc 零写入、同图片保选。两个专项均只运行新用例；同文件旧用例因 `-t` 未运行，不重复算通过。
- 两项新增载体属性的证据足够闭合原遗漏，不扩成所有镜头 / 旋转 / 嵌套矩阵的全矩阵声明。相关最终类型检查仍由主执行者收口。

## 证据边界

Reviewer 直接读取了上述原始聚焦 JSON：文档 audit 58/58、普通文档 / 表格 4/4、图片 unit 22/22、HTML 9/9，以及含中途失败的 document-pass2 / document-final3；最终有效证据按具体文件复用，没有将中途失败报告伪称全绿。

已实际查看 `image-panel-browser/agent-browser-adjustments-fixed.png`：展开面板位于图片右侧、不遮盖预览；查看 `flow-floating-boundary-20261024/flow-locator-and-more.png`：当前定位直接显示、原更多菜单可见、文档操作区域独立存在。这里只证明这些已呈现样本，未宣称所有视口 / 物理 IME / 原生文件对话框 / Electron 全路径。

额外 HTML 扫描旧测试 2 条失败、Slide 14 条旧失败、4 条在 `2376311b3` 同点失败及其被夹具挡住的后续属性，leaf 文档已保留，应继续出现在总结果边界中。审查不替 Owner 批准新的 UI / 模式 / 路径，不批准 commit、push、打包发布或部署。
