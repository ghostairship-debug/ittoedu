# 本轮增量独立审查（2026-10-25）

审查者：`/root/baseline_review`。未参与本轮产品／测试实现；仅只读核源码、实际截图、原始报告及方案，写入本文件。未重跑测试、类型检查或浏览器，未修改产品、测试及历史基线，也未代替 Owner 批准新的产品选择。前轮独审保留在原目录，不由本文件覆盖。

**结论：本轮页面卡片布局及 Offscreen 夹具修正，在下述范围内独审通过，未发现新增阻断项。几份方案和综合结果清楚区分了已实施、诊断、计划与未决；不能由此签收全仓无新增失败、完整 Electron／磁盘路径或方案尚未实施的能力。**

## 1. 页面卡片：实际改动与授权一致

核对完整实际 diff：`BottomSceneNavigator.tsx`、`SceneStateStrip.tsx` 的 compact 呈现分支、`bottomSceneNavigator.css`。本次获确认的是删页只保留图标并紧邻类型、页名不被删除按钮挤压、状态删除放在左下方；这三文件没有借布局调整改变删除范围或模式。

| 核查项 | 独审结论及证据 |
|---|---|
| 类型旁删页、标题独立 | [最终多状态图](../../../output/test-runs/targeted-followup/navigation-card-after.png)中删页为图标，紧邻“演示页”；标题独立一行。[长标题图](../../../output/test-runs/targeted-followup/navigation-long-title.png)中按原固定卡宽省略，保留完整 `title` 和原导航按钮的可访问名称。不是缩小标题以容纳删除文案 |
| 真实位置 | [两页几何](../../../output/test-runs/targeted-followup/navigation-two-page-facts.json)在 200% 下类型与删除按钮相隔 8px，即 4 CSS px；按钮 40×40，即 20×20 CSS px。标题宽 260px，即 130 CSS px，与图标不同排；底部操作在卡片范围内。导航高度 126、卡片 flex-basis 198 的原值未改 |
| 点击与键盘入口 | 标题／类型虽然移出缩略图按钮，外层 `li` 既有非 `button/input` 点击仍调用原 `goTo(card.page)`；没有缩窄为只能点击缩略图。原导航按钮的 `aria-current`、`aria-label` 和 `onClick` 保留，删除仍是独立按钮，新增对应焦点样式 |
| 状态与底部操作 | 原状态按钮放入独立横向列表，新增／更多／删除状态放入左下操作行；compact 以外分支未改。原状态选择、母版、重命名、菜单及删除回调保留，未新增状态 owner 或 History |
| 删除目标及禁用 | 页删除仍调用原 `requestDelete(card)`，原确认、捕获对象、`editCaptured/deleteCourseSurface` 不变；最后一页和 run 禁用表达式未变。状态删除仍先捕获目标，再经原确认调用 `deletePresentationState`；母版下禁用。最后一页／母版的真实 disabled 呈现见[截图](../../../output/test-runs/targeted-followup/navigation-last-page.png) |

[navigation-facts.json](../../../output/test-runs/targeted-followup/navigation-facts.json)的正式 Session 观察支持：取消状态删除 revision 4／undoDepth 4 不变；确认仅少一个命名状态，undoDepth 4→5，Undo 恢复；整页确认打开／取消 revision 6 不变；删除第一页只留下第二页，undoDepth 4→5，Undo 恢复第一页及两状态。复核 harness 确实挂载当前组件、EditorStore、CourseBridge 与真实 DocumentRegistry／Session，持久化端口为内存。

这些证据只覆盖上述组件布局及操作链；不等于完整 Electron 窗口、真实磁盘保存／冷开、任意状态数量滚动或所有载体重新验收。状态横向滚动仍由列表 CSS 承担；现有截图／几何没有溢出状态样例，不额外声称实测过滚动。

## 2. 检查结果没有被包装成全绿

- [g20BottomSceneNavigator 原报告](../../../output/test-runs/targeted-followup/navigation-unit.json)确为完整 5 例、1 过 4 失败、0 pending。该测试本次无 diff。逐条核对起点及冻结终点，4 条 fullName、稳定失败分类和首个失败相同：两条 scope／ACK 断言、旧“删除页面”按钮查询、旧“删除程序？”确认查询。历史同点失败不足以证明后续全部用户路径正确；本轮真实删除链另由浏览器证据提供，整文件仍未通过。
- 类型检查复用 Root 本轮执行记录的 exit 0；最后仅 CSS 微调不要求重跑类型。本审查未自行运行类型检查，也不把类型结果当布局、删除或保存证据。
- Offscreen 最终修正复用本审查者已经完成的实际 diff／直接生产 owner／[最终完整文件 raw](../../../output/test-runs/targeted-followup-20261025/offscreen-activity-initial-events.json)独审：4/4、0 skip；父与 owned realm 均独立记录解析期真实初始事件，待真实 getter 和初始事件就绪后再启动晚订阅，后续事件独立。readonly、原输入／实例身份、协作暂停恢复、不协作 timer、清理及前一条 Source 初始事件断言保留；生产 activity owner 未改。首次聚焦报告仍保留，未用它替换最终补正后的证据。

原全量起终点、`known-failures.json`、14 条新增稳定观察、全局错误及 `reportComplete=false` 继续是冻结样本事实。本轮聚焦通过和 fixture 修正均不能追认那个样本全绿；没有通过改名、skip、exclude、加 timeout 或重录基线使失败消失。

## 3. 方案与综合结果边界

| 文件 | 本次核查结论 |
|---|---|
| [MODE_CORRECTION](MODE_CORRECTION.md) | 正确撤回将 repair18 离线 fixture 当作当前常用 UI 的判断。直接核对当前 instruction 与 fixture：当前不要求先选自动／逐步，fixture 强制返回模式问题并直接调用 Desktop 协议。保留显式用户偏好／通用问题／历史服务协议不构成恢复旧 UI 的理由。本文件没有把源码核对说成真实模型或 GUI 新验收，也未落实新的模式门 |
| [APPEARANCE_PLAN](APPEARANCE_PLAN.md) | 仅定位／方案。沿用前轮真实 planner／operation／renderer 演算，明确未新增完整 Gateway 传输、AI 实跑或保存冷开证据。高层实际外观与底层默认值语义、混合来源复制需明确采纳；没有在本轮偷偷改 API、GUI 或 renderer 优先级。拟修落在既有专业外观 owner，并保留字段、范围、组合属性顺序、写入预告和 History，未借此建新平台 |
| [CORE_PATH_PLAN](CORE_PATH_PLAN.md) | Source 新事实已准确限为生产事件处理器向 spy 发出一次过时选中回调；[原事实](../../../output/test-runs/targeted-core-path/slide-late-realm-facts.json)确为新 Nodes=`text`／新编辑器=`text` 后仍请求 `custom/field`，未 begin 编辑或整工程 capture。不能据此宣称正式错写、丢稿或 Chromium 完整复现。14 条 Slide／4 条 Shell 分别保留旧前置和待验证路径；修复包为后续计划，冲突关闭／保稿没有冒称已验收。新可见默认动作、入口移除或操作路径取舍仍须 Owner 决定 |
| [EDGE_RESULT](EDGE_RESULT.md) | Offscreen 的聚焦修正及限制与已独审事实一致。Worker 候选通过与 Root 60s 失败／阶段探针分开，watch:null 反事实失败未被落成配置修复，未把停在模块／调度边界说成 Python 计算已坏或已修。未决继续保留 |
| [RESULT](RESULT.md) | 已核本轮最终综合文字。准确区分三个产品布局文件、一个测试夹具修改、模式解释纠正、两个计划及 Worker 未决；明确内存持久化、g20 1/5、新 probe 失败与正式写入证据的差别。没有把方案列为已实施，也没有代替 Owner 批准外观语义或新的 UI／模式／路径 |

本次独审不要求重复有效证据，也不扩为旧红例清零。当前可交付为获批布局、Offscreen 聚焦夹具修正及如实分级的方案／报告；其余事项按上述未决和未实施状态接续。
