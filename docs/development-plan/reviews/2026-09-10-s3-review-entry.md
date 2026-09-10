# 1.8 S3 教师复核入口（2026-09-10）

2026-09-11：[同候选最终工程验收](2026-09-10-final-acceptance.md)已完成约定范围及实际失败修复。原 124 项 E2E 最终 100 通过、24 条件跳过，另两项真实会话／隔离验收通过；类型、构建、能力清单及相关示例检查通过。修复后的候选为 `r18-final-20260910-02`。旧 CLI 失败、返工、模型配置和耗时按原范围保留，无新增付费模型调用。**当前为 engineering candidate，尚无 Owner S3 签署；未发布或创建 accepted 标签。**

依据：[060/S3 规程](../roadmap/1.8/r18-060-release.md)、[103 工程出口](../roadmap/1.8/r18-103-ai-usability-exit.md)、[既有 S3 范围](1.8-S3-review.md)、[本轮执行方案](../roadmap/1.8/LATENCY_COMPLETION_PLAN.md)。原 050/051/052/083/087、三 CLI 与外部 Builder 均保留；不重新扩成无关全矩阵。

## 候选身份与现场准备

- [最终候选清单](C:/Users/74755/Documents/HTML课件编辑器/output/r18-final-acceptance-20260910/candidate-02-source.json)及[源码归档](C:/Users/74755/Documents/HTML课件编辑器/output/r18-final-acceptance-20260910/candidate-02-source.zip)保留当前未提交改动，基线 HEAD 为 `c839c205e594ab61bfa01c22b4a4f28303862d8d`。root 与实际测试目录源码一致，root 的 Player／Renderer／Electron 已最终构建。原 `candidate-01` 不冒充修复后身份。
- 真实测试应用位于 `C:/Users/74755/Documents/courseware-r18-worktrees/r18-final-acceptance-0910`；root 是现有本地复核入口。三 CLI 的准确原工程路径、复制 profile 和选中会话见[恢复记录](C:/Users/74755/Documents/HTML课件编辑器/output/r18-final-acceptance-20260910/retained-session-review/result.json)。单独打开另名 `.h5lesson` 不会携带原聊天历史。当前恢复记录来自已完成历史，无正在等待应用／运行中的新模型任务。
- A/B/C 的工程、七阶段画面和归属检查见[持久隔离记录](C:/Users/74755/Documents/HTML课件编辑器/output/r18-final-acceptance-20260910/workspace-isolation-review/evidence.json)；本轮助手停靠下人工改稿后的[Flow 新 HTML](C:/Users/74755/Documents/HTML课件编辑器/output/r18-final-acceptance-20260910/flow-docked-review/fresh-flow.html)及[实际画面复核](C:/Users/74755/Documents/HTML课件编辑器/output/r18-final-acceptance-20260910/visual-review.md)单独保存。旧日期 HTML 仅在相关实现未变时按原范围复用。
- 完整首轮和修复批次见[最终 E2E 索引](C:/Users/74755/Documents/HTML课件编辑器/output/r18-final-acceptance-20260910/e2e-final-index.json)。原模型失败、纠错、续接、等待教师及延迟记录继续保留；新通过不覆盖历史失败。

## 教师实际操作清单

按顺序记录“通过 / 需修改 / 未验”，并指出具体页面、对象或操作。工程检查结果供参考，教师判断以实际内容和行为为准。

| 检查 | 看什么、点击什么 | 分别证明什么 |
| --- | --- | --- |
| 1. 文字、图片与整页 | 打开对应工程：核对标题“简谐运动”的内容、字号与页面居中；检查绿色图片仍保留白色图案、透明区及未选的红色共享图片；检查排版页标题在上、两个对象顶端对齐、留白和间距合理，原内容和大小保留。 | 精确小修改与整页关系分别正确；没有误改未选对象、遮盖替代或内容丢失。不要由一次文字通过替图片或排版签字。 |
| 2. 预览、提问与控制 | 先核对三 CLI 已恢复历史的实际配置和结果，查看 Claude 修改前／候选／应用原始画面及 OpenCode T11 两轮记录；Owner 若另行执行新任务，再实际体验等待应用、回答、补充要求和停止。 | 当前恢复的是已完成历史，不冒充待应用或进行中新任务。本轮确定性真实宿主路径已验证可审阅候选、讨论零写、续修、停止与迟到候选屏障；教师仍按实际体验给出结论。 |
| 3. 按钮与连续机制 | 当前修复样本进入“当前位置试运行”，点击“点击显示答案”，读取实际答案；查看同一任务的行为反馈与完成状态。连续 Runtime 样例实际暂停、继续、调整振幅和重置；分数组件改变等份数、增加分子、重置。 | 按钮真的改变状态，反馈来自实际动作；动画、参数和重置连续工作。旧截图、按钮命中或静态后备不能代替这些行为。 |
| 4. 三表面、导航与缩放 | 在 Mixed 样例依次使用“下一步”“上一步”“下一场景”、PageDown/ArrowRight 和“场景目录”；越过场景首末步并“重播”。在播放中展开“缩放”，放大、用横纵边条查看四角，再“恢复视图”；Flow 长文滚动和 Spatial 镜头分别操作。 | Slide/Flow/Spatial 的场景与步骤一致；场景按钮跳过内部步骤；重播回本场景首步。文字和内容同比缩放，控制器可达；恢复视图不改步骤、答案、镜头或动态进度，Flow 阅读滚动不被重复移动。 |
| 5. 共享与单实例 | 分别打开共享修改、单实例修改工程，进入三表面的组件并点击各自 `Add …` 按钮。共享样例三处每次加 2；单实例样例仅 Flow 每次加 2，另两处仍加 1。 | 共享范围与单实例范围准确，三表面真实互动和未选实例保留。人工包修改已有独立工程证据，现场复核按同一候选保留该范围。 |
| 6. Builder 与教学内容 | 打开 Builder 的 Native、动态两个片段，核对“教师手工补充：保留这条课堂备注。”和“（已复习）”同时存在；实际操作动态片段。另看三页分数课的讲解顺序和概念是否适合课堂。 | 外部普通课例目录构建、教师改动与 AI 增量能够衔接；制品可编辑、可运行。两个片段是工程样例，不冒充教师确认的完整课例。 |
| 7. PPTX 图示与公式 | 打开下表完整导入工程，并对照源 PPTX：在线性流程、层级组织、循环中改一处文字和位置；在受支持公式中改分子或分母。查看未支持项的页码和原因，再试运行、保存重开和适用导出。 | 图示是可编辑文字/形状/连接线，公式是可编辑公式；不是图片冒充。SmartArt 源第 4 页不支持且导入后为空白，与工厂初始空白页分别记录；未知公式及导出限制按报告核对，不能由导入成功推断视觉无损。 |
| 8. 人工交替、保存与本地隔离 | 在副本中手工改字，正常撤销/重做，再保存、关闭并重开；比较编辑器、整课预览和适用 HTML。对 AI 修改后的人工改动按正常顺序撤销，检查没有吞掉手工内容。切换 root 准备的两个工程及另存副本，查看资料与会话归属。 | 当前编辑产生的 Undo/Redo、保存恢复和运行结果一致；工程之间不串资料或会话，另存不复制旧会话。重开后的工程不承诺恢复上次运行的内存撤销栈。 |

观看速度时，分别记录首次正确可用结果、任务结束、等待教师的时间及失败/返工；不从单次样本推断普遍提速。

## 已存在的制品入口

### 本轮代表与旧通过对照

`.h5lesson` 用编辑器打开；HTML 可直接打开。本轮样本的工程检查与代理实际画面复核已经完成，结果仍不等于 Owner 签署；旧制品只按表中范围保留。

| 内容 | 可打开的工程 / 结果 | 当前范围 |
| --- | --- | --- |
| OpenCode 新文字样本 | [正确结果工程](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path/opencode-text-auto-2026-09-10T12-39-52-431Z/correct-result.h5lesson)；[记录](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path/opencode-text-auto-2026-09-10T12-39-52-431Z/result.json) | OpenAI OAuth，Luna/high；已查看实际标题居中与放大。首次正确结果 73.689 秒、任务结束 73.661 秒；有一次原生命令纠错，不称首遍无错。 |
| 图片保真 | [本轮正确结果工程](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path/opencode-image-auto-2026-09-10T12-52-47-905Z/correct-result.h5lesson) | OpenCode Luna/high；绿色图片、透明/白色细节及未选共享红图检查通过，实际画面已复核。首次正确 130.852 秒含像素采样，终态 126.443 秒；两次原生命令语法纠错。 |
| 整页排版 | [本轮正确结果工程](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path/codex-layout-auto-2026-09-10T12-56-40-701Z/correct-result.h5lesson) | Codex Luna/max；一次事务、内容保留、Undo/重开及实际画面通过。首次正确 451.147 秒，原生等待明显变慢且原因未可细分，不算提速。 |
| 按钮修复 | [本轮修复结果工程](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path/opencode-interaction-auto-2026-09-10T13-21-41-927Z/correct-result.h5lesson)；[实际行为反馈](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path/opencode-interaction-auto-2026-09-10T13-21-41-927Z/runtime-observations.json) | OpenCode Luna/high；一个源码提交、实际私有点击前后文字进入模型续轮；正常点击、Undo 故障恢复、Redo 修复恢复及重开通过。已查看完整答案；场景是功能样例，非成品版式。 |
| OpenCode 普通 T11 | [回答后工程](C:/Users/74755/Documents/HTML课件编辑器/output/r18-clarification/opencode-2026-09-10T12-42-31-883Z/T11-answered.h5lesson)；[两轮记录](C:/Users/74755/Documents/HTML课件编辑器/output/r18-clarification/opencode-2026-09-10T12-42-31-883Z/result.json) | Luna/high；同一原生会话先问新标题，提问完成且零写；回答后只改“波动的秘密”一次，Undo/Redo/重开通过，提问与重开画面已复核。 |
| Claude / DeepSeek 文字预览 | [正确结果工程](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path/claude-text-preview-2026-09-10T15-16-47-848Z/correct-result.h5lesson)；[工程记录](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path/claude-text-preview-2026-09-10T15-16-47-848Z/result.json)；[完成时原生记录](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path/claude-text-preview-2026-09-10T15-16-47-848Z/completed.native.json)；[重开后原生记录](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path/claude-text-preview-2026-09-10T15-16-47-848Z/reopened.native.json) | 实际命名用例 PASS 1/1、约 1.7 分钟（含验证）；Claude Code 2.1.267，用户临时配置 `deepseek-flash[1M]` / max，原生 resolvedModel 为 `deepseek-flash[1m]`。42.777 秒待应用且零提交，13.382 秒驱动滚动审阅等待，58.222 秒终态、58.999 秒实际正确挂载；一原生轮、一提交，5 个工具均 completed、0 次格式修复。Undo/Redo 和重开通过。 |
| Claude 预览实际画面 | [修改前可见画面](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path/claude-text-preview-2026-09-10T15-16-47-848Z/preview-before-visible.png)；[候选可见画面](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path/claude-text-preview-2026-09-10T15-16-47-848Z/preview-candidate-visible.png)；[首次正确结果](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path/claude-text-preview-2026-09-10T15-16-47-848Z/first-usable-ui.png)；[一次撤销画面](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path/claude-text-preview-2026-09-10T15-16-47-848Z/one-undo.png)；[代理审阅记录](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path/claude-text-preview-2026-09-10T15-16-47-848Z/manual-review.json) | 代理已实际查看上述四张图；前图与候选分别滚动可读、应用入口可达，应用前工程未改，应用后标题正确。重开为自动断言通过，未另记为人工重开看图。此项证明当前通道的文字预览闭环和实际 UI 可审阅性，不证明 DeepSeek 理解图片，也不代表 Owner 已现场操作。 |
| Claude / Sonnet 历史失败 | [12:33 原失败记录](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path/claude-text-preview-2026-09-10T12-33-09-762Z/failure.native.json) | 当时渠道 503，报告无可用 `claude-sonnet-5`；该次零提交、未生成可审阅候选。DeepSeek 通道的新通过不改写此失败，也不与 Sonnet/high 混算提速。更早整卡截图被滚动区裁切不等于界面不可达，保存态前后重绘不代替候选审阅。 |

### 并列保留的 S3 范围

| 内容 | 已存在的绝对路径 | 使用边界 |
| --- | --- | --- |
| 三表面场景/步骤 | [Mixed 工程](C:/Users/74755/Documents/HTML课件编辑器/output/r18-navigation-evidence/mixed.h5lesson)；[Mixed HTML](C:/Users/74755/Documents/HTML课件编辑器/output/r18-navigation-evidence/mixed.html) | 3+2+3 步工程样例；导航工程证据可复用，教师尚未签署。 |
| 播放缩放/平移 | [Mixed HTML](C:/Users/74755/Documents/HTML课件编辑器/output/r18-077-playback-evidence/mixed.html) | 有三表面、动态状态和控制器工程证据；物理触控/触控板仍按实际设备记录未验。 |
| 共享 / 单实例组件 | [共享工程](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path-component-patch/shared-2026-09-09T10-22-30-900Z/01-patched.h5lesson)；[单实例工程](C:/Users/74755/Documents/HTML课件编辑器/output/r18-short-path-component-patch/instance-2026-09-09T10-23-53-257Z/01-patched.h5lesson) | 可在当前编辑器逐表面试运行；旧真实准入、事务与互动证据保留。 |
| 连续振动 Runtime | [工程](C:/Users/74755/Documents/HTML课件编辑器/output/playwright/r18-generated-runtime/generated.h5lesson)；[HTML](C:/Users/74755/Documents/HTML课件编辑器/output/playwright/r18-generated-runtime/generated.html) | 检查暂停/继续、振幅与重置；只作其既有载体范围对照。 |
| 分数探索组件 / 三页分数课 | [组件工程](C:/Users/74755/Documents/HTML课件编辑器/output/playwright/r18-generated-component/generated.h5lesson)；[组件 HTML](C:/Users/74755/Documents/HTML课件编辑器/output/playwright/r18-generated-component/generated.html)；[三页课工程](C:/Users/74755/Documents/HTML课件编辑器/output/playwright/r18-whole-course/generated.h5lesson)；[三页课 HTML](C:/Users/74755/Documents/HTML课件编辑器/output/playwright/r18-whole-course/generated.html) | 复核图形与分数同值、重置及“平均分→二分之一→判断”的知识顺序；旧教学样例不是本轮新生成成功次数。 |
| 外部 Builder Native 片段 | [rev7 工程](C:/Users/74755/Documents/HTML课件编辑器/output/r18-development-20260908/r18-104-skill-cold-start/native/lesson.h5lesson)；[AI 增量后 HTML](C:/Users/74755/Documents/HTML课件编辑器/output/r18-development-20260908/r18-104-skill-cold-start/native/lesson-revised-1788865624522.html) | 两段教师/AI 标记均保留；旁边 `lesson.html` 是基线，不用于代表增量终态。 |
| 外部 Builder 动态片段 | [rev14 工程](C:/Users/74755/Documents/HTML课件编辑器/output/r18-development-20260908/r18-104-skill-cold-start/dynamic/lesson.h5lesson)；[AI 增量后 HTML](C:/Users/74755/Documents/HTML课件编辑器/output/r18-development-20260908/r18-104-skill-cold-start/dynamic/lesson-revised-1788865941730.html) | 实际片段构建、人工修改、AI 增量及恢复证据；不代替完整教师课例。 |
| 051 SmartArt 完整导入 | [完整可编辑工程](C:/Users/74755/Documents/HTML课件编辑器/output/r18-s3-preparation-20260910/smartart-real-source.h5lesson)；[完整 HTML](C:/Users/74755/Documents/HTML课件编辑器/output/r18-s3-preparation-20260910/smartart-real-source.html)；[导入报告](C:/Users/74755/Documents/HTML课件编辑器/output/r18-s3-preparation-20260910/smartart-real-source-import-report.json)；[源 PPTX](C:/Users/74755/Documents/HTML课件编辑器/output/smartart-probe/smartart-families.pptx) | 4 个导入页、46 个 Native 对象，实际磁盘回读通过。29 条报告包括边框、文字排版与不支持家族；源第 4 页无受支持对象，导入后为空白，不能宣称全部 SmartArt 无损导入。 |
| 051 SmartArt 小夹具 | [已编辑工程](C:/Users/74755/Documents/HTML课件编辑器/output/playwright/r18-diagrams/edited.h5lesson)；[已编辑 HTML](C:/Users/74755/Documents/HTML课件编辑器/output/playwright/r18-diagrams/edited.html)；[旧真实源第 1 页 HTML](C:/Users/74755/Documents/HTML课件编辑器/output/smartart-probe/r18-diagrams-page-1.html) | 本轮实际命名用例通过，文字/位置编辑、历史、保存重开和导出证据保留。小夹具展开教师控制器→下一场景可看“观察”改成“比较”；故意移动的文字不作成品版式验收，小夹具也不是整份源文件的编辑终态。 |
| 052 旧 OLE 公式完整导入 | [完整可编辑工程](C:/Users/74755/Documents/HTML课件编辑器/output/r18-s3-preparation-20260910/legacy-equations-real-source.h5lesson)；[完整 HTML](C:/Users/74755/Documents/HTML课件编辑器/output/r18-s3-preparation-20260910/legacy-equations-real-source.html)；[导入报告](C:/Users/74755/Documents/HTML课件编辑器/output/r18-s3-preparation-20260910/legacy-equations-real-source-import-report.json)；[源 PPTX](<D:/台式机桌面/九数上(RJ)--1.精品教学课件/25.2 第2课时画树状图求概率.pptx>) | 29 个导入页、711 个 Native 对象，其中 27 个可编辑公式，实际磁盘回读通过。142 条提示逐条保留页码和原因；公式字体/间距按编辑器样式呈现，动画/切换、超链接及部分效果省略，第 24 页连接关系变为独立线条，自动扩框后的相邻布局仍需审阅。提示条数不等于跳过对象数或逐页视觉通过。 |
| 052 旧 OLE 公式小夹具 | [已编辑工程](C:/Users/74755/Documents/HTML课件编辑器/output/playwright/r18-equations/edited.h5lesson)；[已编辑 HTML](C:/Users/74755/Documents/HTML课件编辑器/output/playwright/r18-equations/edited.html)；[旧真实源第 4 页 HTML](C:/Users/74755/Documents/HTML课件编辑器/output/pptx-tree-diagnosis/r18-equations-page-4.html) | 本轮实际命名用例通过，可编辑 AST、历史、保存重开及离线 Player/导出证据保留。小夹具二分之一改三分之一；PPTX 导出仍是既有静态公式绘制，不承诺可编辑 OLE/公式导出。 |

两份完整导入工程及 HTML 均保留默认教师控制器与一张工厂初始空白页，总场景数为 5/30，播放起点设为首导入页；表中 4/29 页仅计源文件的导入页。已真实打开完整 HTML，并用鼠标操作控制器导航 SmartArt 源第 1–4 页、公式源第 1/4 页，两者 `pageerror` 均为空，见[实际导航记录](C:/Users/74755/Documents/HTML课件编辑器/output/r18-s3-preparation-20260910/html-review.json)。代理已查看 SmartArt 第 1/2/3 页及公式第 4 页；展开控制器会遮住底部，另保留[SmartArt 第 1 页内容帧](C:/Users/74755/Documents/HTML课件编辑器/output/r18-s3-preparation-20260910/smartart-real-source-page-1-content.png)和[公式第 4 页内容帧](C:/Users/74755/Documents/HTML课件编辑器/output/r18-s3-preparation-20260910/legacy-equations-real-source-page-4-content.png)供收起后核对。这些是导航与代表页证据，不代表视觉无损、全部 29 页通过或教师实际编辑验收。

103 新增的“正式 unchanged 回执直接结束后持久重开”和“waiting-input 持续到原绝对期限”两个命名用例已集成并通过（2/2），未发现产品缺陷；其余有效候选/Controller/Main/期限证据继续复用。原关键链每 CLI 三个槽位按有效范围保留失败、续接与最终结果，不要求另造九次 clean first pass。本轮文字、图片、排版、互动、普通 T11、Claude / DeepSeek 文字预览以及 051/052 复核制品均已完成，不再列作待生成；本次临时模型配置不扩张为 DeepSeek 图像理解或原 Sonnet 渠道恢复的证明。

## 当前工程结果与待 Owner 签署

1. **工程验收已经执行。** 同候选真实应用、三 CLI 历史恢复、本地会话／材料／另存隔离、人工保存恢复、三表面、PPTX、动态载体、Builder 和版本级检查已按[最终报告](2026-09-10-final-acceptance.md)完成约定范围。原失败已修复复验，24 个专项条件跳过仍不计通过。此前“现场与版本检查尚未执行”的状态已被本次结果取代。
2. **教师判断与支持边界仍独立。** 需要 Owner 看过当前结果，判断教学内容、视觉和实际体验；整份 29 页逐页视觉、本机 Word、物理触控／触控板没有新证明。SmartArt 不支持家族、导出限制及 Spatial local world/API3 静态边界保留。预览／停止等新现场模型体验若未由教师实际执行，也不补写为已验。
3. **签署与发布尚未发生。** 本次为 engineering candidate，无 S3 代签。只有实际签署且获得发布授权后，才晋升保全矩阵并创建 `v1.8.0` accepted 源码标签；本版不发布 HTML 或安装器。本次未提交、打标签或发布。

复核记录：候选身份 ______；复核日期 ______；Owner ______；已通过项 ______；需修改/未验项及具体位置 ______；已确认的支持边界 ______。

**Owner 当前结论：尚未签署。**
