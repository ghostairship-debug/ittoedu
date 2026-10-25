# 页面卡片调整、旧模式判断纠正与剩余问题方案

日期：2026-10-25。Owner本次指定的页面卡片布局已落实；自动／逐步前置选择的错误判断已纠正；后台HTML晚订阅测试夹具已小修，Worker开发启动未强行改动。AI格式与选中／拖动／关闭保稿两类仅交付定位和方案，未实施。没有commit、push、打Portable、发布或部署，没有修改用户作品、AGENTS或历史诊断基线。

**后续实施接续：** Owner随后明确授权按两方案执行并继续Python调查；[实施结果](../20261025-format-core-repair/RESULT.md)已集成Root。下文“仅方案／未实施”保留本报告交付时点，不代表后续未执行。Python新的有效Noop watcher对照推翻了旧`watch:null`已生效的假设，当前定位和影响以[新调查](../20261025-format-core-repair/PYTHON_INVESTIGATION.md)为准，历史raw未改。

## 1. 本次结果与范围

| 项目 | 当前结论与用户影响 | 处理状态 |
|---|---|---|
| 自动／逐步 | 普通任务早已不需要先选模式，由AI结合任务、用户原话及授权判断推进。前次把历史repair18离线协议夹具当作常用UI入口，判断错误；不据此恢复选择器 | 已纠正报告；产品／测试均未改，见[MODE_CORRECTION](MODE_CORRECTION.md) |
| 页面卡片 | 整页删除只留小图标，紧邻“演示页”等类型文字；页名独立一行。命名状态在中间，新增／更多／删除状态在左下方；固定卡片宽度与导航高度沿用原值 | 已实施，限三个UI文件；实际截图与行为见第2节 |
| 后台HTML活动 | 原晚订阅测试用固定毫秒数猜首次activity时序，尚不能证明产品暂停／状态丢失。改为观察真实初始事件和getter就绪，再开始独立晚订阅 | 只修原测试夹具，最终完整文件4/4，生产activity owner未改，见[EDGE_RESULT](EDGE_RESULT.md) |
| Worker／Vite开发Python | 根目录60秒失败及阶段探针证据仍成立；当前停在模块／本机调度边界，未证明生产Python计算失败，也没有已证实的简单修复 | 保留未决；不改计算、策略、全局Vite配置或timeout，不重复旧假设试绿，见[EDGE_RESULT](EDGE_RESULT.md) |
| AI字号／颜色“调用成功但外观未变” | 确认真实语义差异：高层Gateway只改默认appearance，已有公式style／文字inline同字段仍优先显示；同意图GUI会处理这些覆盖 | 用户可见格式结果错误，按常用编辑问题优先修；本次仅[APPEARANCE_PLAN](APPEARANCE_PLAN.md) |
| 选中／拖动／关闭保稿 | 属核心路径，不能统称边缘。新协议探针证实Source旧ACK后发出过时选中请求；旧14条Slide／4条Shell失败还混有旧手势和夹具前置，不等于18个产品故障 | 本次仅[CORE_PATH_PLAN](CORE_PATH_PLAN.md)；未修产品或正式测试，不声称已证实错写／丢稿 |

显式用户偏好、通用提问及历史协议继续保留。“取消前置选择”不等于删除用户明确要求逐步审阅的能力；也不能把保留协议误写成当前默认UI。

## 2. 页面卡片：已实施及实际验证

修改限于[BottomSceneNavigator.tsx](../../../src/renderer/ui/BottomSceneNavigator.tsx)、[SceneStateStrip.tsx](../../../src/renderer/ui/SceneStateStrip.tsx)的compact分支及[bottomSceneNavigator.css](../../../src/renderer/ui/bottomSceneNavigator.css)。没有新模式、弹窗、菜单项或操作步骤；原页导航、删除确认及目标捕获、最后一页／试运行禁用、状态与母版范围、正式Bridge／Session／History逻辑均沿用。

实际Chromium渲染，200%放大裁图；这是当前组件与正式样式，不是设计稿或生成图片：

![修改后的页面卡片：删页图标在类型旁，删除状态在左下](../../../output/test-runs/targeted-followup/navigation-card-after.png)

补充：[最后一页／母版下禁用](../../../output/test-runs/targeted-followup/navigation-last-page.png)、[长标题](../../../output/test-runs/targeted-followup/navigation-long-title.png)。页名可省略显示并保留完整title与原可访问名称；删页图标保持独立20×20命中框，布局与标题不重叠；底部操作完整位于卡片内。状态列表保留独立横向滚动CSS，不挤占底部操作；本次状态样例未溢出，该项仅结构核对，未实测横向滚动。

浏览器harness挂载真实BottomSceneNavigator、EditorStore、CourseBridge、DocumentRegistry／Driver／DocumentSession，持久化端口为内存；只操作自建样例，未连用户工程。行为证据：[navigation-facts.json](../../../output/test-runs/targeted-followup/navigation-facts.json)，几何及长标题证据：[navigation-two-page-facts.json](../../../output/test-runs/targeted-followup/navigation-two-page-facts.json)。

| 实际操作 | 结果 |
|---|---|
| 打开状态删除，取消 | revision仍4、undoDepth仍4；两页、两命名状态保留 |
| 确认“删除状态” | 只删除当前“练习反馈”，母版、讲解和两页保留；undoDepth 4→5 |
| 执行原正式Undo | 被删状态按原身份恢复，undoDepth回4；不要求恢复已删除状态的临时选中 |
| 打开整页删除，再取消 | revision仍6、undoDepth仍4；模型无变化 |
| 确认“删除整页” | 只删除捕获的第一页面，第二页保留并成为当前页；undoDepth 4→5 |
| 执行原正式Undo | 第一页及其两个原状态恢复，第二页保留；undoDepth回4 |
| 样例调整为最后一页、选母版 | 页删除图标禁用；当前状态删除禁用，截图有实际disabled状态 |

本次只签该组件的浏览器实际布局与上述正式操作链，不冒充完整Electron窗口、实际磁盘保存／冷开或所有载体均重新验收。导航harness、浏览器及本地服务已关闭，不影响其他创作任务。

## 3. 两类修复方案的实施顺序

1. **AI格式：** 在现有专业外观owner收敛高层“整对象实际字号／颜色”与GUI结果，保留底层默认值编辑、局部范围授权和其他格式；公式已有style及文字inline同字段按现有GUI规则计划正式字段操作。必须同时处理同次data＋appearance顺序与预告写入范围，不改renderer优先级。具体语义、混合来源复制尚需明确，详见[方案](APPEARANCE_PLAN.md)；本轮没有替Owner采纳语义或修改API。
2. **Source慢ACK与新选择：** 已有mounted生产事件处理器探针记录一次过时`selectAuthorSpot(custom,field)`；先用真实Bridge／Source realm验证用户路径，再在现有SlideLocationWorkspace重核输入意图与选择身份，旧延续失效即退出，保留同目标正常续接。不建第二selection store或writer。详见[方案S1](CORE_PATH_PLAN.md)。
3. **关闭与保稿：** 用真实Main和临时磁盘核冲突关闭拒绝、preserve不覆盖磁盘、取消后继续编辑和恢复稿重开。旧Shell fixture漏baseSource，只能说明测试未提供真实协议前置；不能据此宣称已经丢稿或关闭链已验收。发现真实断点才修原DocumentFileSession／输入owner。详见[方案C1](CORE_PATH_PLAN.md)。
4. 其余旧拖动／菜单／新建／PPT失败先沿当前已批准手势和正式协议补到达条件，保留准确目标、邻对象、一次History及取消断言；只有实际用户行为失败才修产品，不按红例数量扩面。

上述是可接续方案，不是本次已执行清单；新UI、模式或操作路径取舍仍先确认。既有“单击选择、主体拖动、双击编辑”和显式冲突／保稿语义继续作为约束。

## 4. 检查、独审及原始失败保留

| 最小相关检查 | 实际结果与限制 |
|---|---|
| offscreenSandbox20261013完整文件 | 最终4/4、0 skip；解析期初始事件、晚订阅getter和后续事件独立，状态／输入／身份／暂停恢复断言保留。原始[报告](../../../output/test-runs/targeted-followup-20261025/offscreen-activity-initial-events.json)，生产实现未改 |
| g20BottomSceneNavigator完整原文件 | 5例中1过4失败：[报告](../../../output/test-runs/targeted-followup/navigation-unit.json)。4条与起点／冻结终点同名同分类：两条scope ACK夹具、旧“删除页面”query、旧“删除程序？”query；本次未修改该测试、scope逻辑或确认名称。真实当前删除链由上文浏览器证据单列，不能把整文件写成通过 |
| Root renderer/core类型 | `npx tsc -p tsconfig.json --noEmit --incremental --tsBuildInfoFile output/typecheck-cache/main.tsbuildinfo`，exit0，[日志](../../../output/test-runs/targeted-followup/typecheck.log)。最后仅相关CSS布局微调，无需重跑类型；未改Main等已有类型证据复用 |
| 新Source过时ACK协议诊断 | 仅一次单用例；“旧选择不得发出”断言实际失败。它是定位证据，selection port是spy，不签正式内容错写或完整Source浏览器复现。[事实与限制](CORE_PATH_PLAN.md#2-一次新诊断旧ack发出过时选中请求) |
| 独立审查 | [REVIEW.md](REVIEW.md)记录本轮布局、夹具语义及报告边界的增量独审；作者不自签独审 |

未重跑全仓、未改`known-failures.json`／历史raw、未exclude／skip／加timeout来洗绿。上一轮冻结终点14条新增稳定观察及`reportComplete=false`继续是那个历史样本的事实；12条先前补正、offscreen本次补证及repair18语义纠正分别记录，不能据此回写“全仓通过”。Worker未决与旧同名对应限制继续保留。

本轮新产品改动仅页面卡片三文件，新测试修改仅offscreen单文件；其他本轮成果为方案和报告。前轮未提交修复、用户创作任务和文件均保留；没有生成新Git提交或发布制品。
