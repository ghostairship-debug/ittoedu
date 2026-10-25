# AI格式、核心编辑路径修复与Python调查

2026-10-25。两份方案的本次授权范围已实施、集成Root并完成相关验证：**修复AI整对象字号／颜色不生效、旧realm ACK抢回选择，以及旧宿主手势记录吞掉后续鼠标拖动三个实际断点。关闭保稿真实组合链正常，未为了旧测试红灯改关闭语义。** Python已完成进一步定位与影响研究，未改正式计算配置或测试。

执行依据：[AI格式方案](../20261025-targeted-followup/APPEARANCE_PLAN.md)、[核心路径方案](../20261025-targeted-followup/CORE_PATH_PLAN.md)及Owner本次明确实施授权。5位子智能体分别承担三个隔离实现分支、Python调查和独立审查；Root保全原dirty、按白名单顺序集成。没有新增UI、模式或操作路径，没有修改用户作品、AGENTS或真实用户数据；**未commit、push、打Portable、发布或部署。**

## 1. 产品结果与修复边界

| 问题 | 根因与最终行为 | 证据与限制 |
|---|---|---|
| AI改字号／颜色，工具成功但实际外观仍旧 | 高层appearance原先只写默认值，公式style和文字inline同字段优先显示。现与既有GUI共用专业字段规划：文字默认＋已有同字段覆盖、公式已有style优先，否则默认。只处理明确提供字段，保留其他格式、范围身份、公式、链接、布局与邻对象 | 真实Gateway修前红例→修后工具／Host完整16/16；实际冷开模型在当前Slide组件呈现正确，见[外观结果](APPEARANCE_RESULT.md)及第2节 |
| 同次data＋appearance与预告范围 | 复用正式data.set计划后的有效数据再规划外观，保留正文remap；捕获展示状态只解析一次。实际执行和effectWriteScopes共用计划，避免旧inline索引及漏报 | 合并／省略字段／组合state／来源／范围与继承锁均有直接断言；没有第二writer或样式平台 |
| Source旧realm ACK抢回选择 | 原realm start只核文档／页面上下文。现begin前复用原输入意图、选择身份及新输入检查；旧延续失效退出。已开始手势的update/end保持原owner，合法同目标续接不被取消 | 修前真实Bridge两红，修后正式选择／输入与History保护通过；普通物理路径与Source协议路径分级，见[选中结果](SELECTION_RESULT.md) |
| ACK失效后后续鼠标拖不动 | 真实浏览器发现宿主deferred失效后残留ended记录；真实鼠标复用pointerId=1，后续up被旧记录截走。现只按原record身份退役失效pending，不清后来同id意图或新gesture | 同id真实Bridge修前红→修后过；浏览器可见Source背景整体拖动40×30，History2→3、邻对象不变、Undo恢复；未改History预期、换id、加sleep或隐藏UI |
| 关闭、保稿、取消和恢复 | 真实Main／磁盘／Journal＋mounted Shell链验证正常；旧helper遗漏保存基线，现供给Session.readSavedSource，旧创建查询走现行入口。冲突关闭仍拒绝、preserve不覆盖磁盘、Main取消后继续原编辑器 | 两条组合链分别通过；无需改生产关闭／恢复owner。离线IPC／对话框输送边界明确，见[关闭结果](CLOSE_RESULT.md) |
| 菜单／PPT前置 | 保留当前已有重命名、准确reveal文档身份及关闭目标；PPT按三参协议、正式rootIds/instances/Slide容器检查。取消后刻意晚到true，实际controller仍保后来工作空间和资源区 | 4目标分别通过。未新增菜单能力或兼容surfaces writer；不冒充完整App工程创建、OS文件选择器或PPT Worker验收 |

高层实际字号／颜色修复没有改变底层`properties.data.appearance`的默认值字面语义、局部`text.format`范围授权或renderer优先级。混合文字appearanceFrom继续原默认值复制，不取首片段、清格式或拒绝原合法调用。相对字号步进继续按各段原值处理。

## 2. 实际验证与独审

| 范围 | 最终有效证据 |
|---|---|
| 格式工具、插入、History、保存冷开 | `g20TextFormatting`和`nativeInsertAppearance`两个完整文件16/16、0skip：[after-final.json](../../../output/test-runs/format-core-repair/appearance/after-final.json)。真实DocumentHostService工具修改，各操作一History，Undo／Redo，正式GLX保存及独立新Host冷开完整模型一致 |
| 原GUI格式消费者 | 完整`componentPlatformProperties`首轮26项中23过、3旧失败。绝对格式、公式原控件及相对步进有效证据复用；后续修正仅工具planner，没有改已过GUI路径。三条失败保持，见第4节 |
| 集成Root实际格式呈现 | 上述真实Main冷开模型，经browser memory-backed host载入当前Runtime／Store／Bridge／Slide组件。默认、显式文字、继承段、行内公式、独立公式均60px／`#abcdef`；邻对象24px黑，italic／highlight／underline及link／range／formulaID保留，runtime errors=[]。[实际事实](../../../output/test-runs/format-core-repair/browser/appearance-facts.json)、[截图](../../../output/test-runs/format-core-repair/browser/appearance-after.png) |
| Source精准装配 | 8新增＋1既有相关慢ACK用例分次有效通过，包含新选择／新输入、合法ACK续接、paint晚到up、hover/menu旧响应及同id旧记录退役；最后DOM代码变化后只重核受影响既有双击例。不是20/20全文件全跑；每次过滤与旧失败见[分项结果](SELECTION_RESULT.md) |
| Source实际浏览器 | [完整1链通过](../../../output/test-runs/format-core-repair/selection/after-browser-reused-mouse-fixed.json)，真实Main临时文档、当前Store／Bridge／Source sandbox与Nodes UI；两ACK链、可见背景物理拖动、一次History、邻对象和Undo，page/runtime errors均空。[最终事实](../../../output/test-runs/format-core-repair/selection/browser/facts.json) |
| 关闭保稿、Shell、C2 | C1两链分别有效；原Shell3例分别通过（首跑背景例，前置修正后另两例）；Menu2与PPT2分别通过。明确保留filtered/skipped和初始fixture失败，未凑成末次全文件全绿；原数据、History、raw、磁盘及取消保护断言未删除 |
| 集成后的相关类型 | `tsconfig.json`、`tsconfig.electron.json`、`tsconfig.component-platform.json`一次检查全部exit0，分别覆盖受改renderer/core/tests、Main Gateway消费者及正式组件/driver边界。日志：[renderer/core](../../../output/test-runs/format-core-repair/typecheck-renderer-core.log)、[Electron](../../../output/test-runs/format-core-repair/typecheck-electron.log)、[component-platform](../../../output/test-runs/format-core-repair/typecheck-component-platform.log) |
| 独立审查 | [REVIEW.md](REVIEW.md)：另一未参与实现者核对相对接手dirty基线的实际增量、直接消费者、正确断言、原始结果和实际截图；不以作者自检代独审 |

浏览器格式前置首次激活了helper的默认空白文档，未出现目标；通过原`activateCourseDocument`切到冷开样本后才取得上表事实，ignored harness也已固定该初始化。此为自建装配前置，不是格式产品故障。浏览器没有直接运行Electron/Main或沿用原保存Session；真实工具与冷开事实由前段Main测试提供，后段只证明当前实际renderer消费同一冷开模型。

首轮候选中发现的真实实现错误（文字合并覆盖默认、局部变量TDZ、Zod partial补默认误写省略字段）均修生产候选后复验；新fixture的顺序／保存revision／范围元数据、命中点／吸附等错误分别记录。没有改正确预期来掩盖产品错误；特别是Source无拖动History的真实浏览器失败保留并修根因，未改成无变化通过。

## 3. Python定位及产品影响

详见[PYTHON_INVESTIGATION.md](PYTHON_INVESTIGATION.md)，该报告及两次新实验已独审。

- 原配置下，极小控制页读取也耗时22.728秒；工作Node高CPU／RSS和长心跳间隔发生在业务Worker之前，外部父Node保持约1秒心跳。不能把它说成Python运算慢或整台机器统一冻结。
- 纠正前轮错误解释：inline `watch:null`在当前Vite配置合并时会丢失，旧探针没有证明实际关监听，不能据此排除watcher。新对照在configResolved后置null，并于createServer和listen后证实实际NoopWatcher及空监听。
- 有效对照1/1约4.83秒通过，控制读取6ms、真实Worker执行Python返回42、stderr空，原四项计算／策略断言均达到。强支持根目录文件监听相关启动压力；插件配置身份、缓存／OS缓存和运行时点变量仍保留，不能宣称无条件唯一因果。
- 正式无Vite的私有本地映射计算链已有有效实际成功记录：NumPy／pandas／Matplotlib、CSV和PNG正式written交付、取消49ms。当前相关源码无使该证据失效的变化，复用而未重复实跑。它不替代所有计算任务或新的安装包验收。

**产品分级：当前证据指向开发／自动化验证可靠性问题，不是已证实的全产品Python阻断。** 调用内置计算的统计／图表任务若初始化卡住会受阻，普通选中、正文编辑、人工保存、播放器没有直接调用该计算链。没有使用遥测，频率未知，不能称普遍／高频或因未知就说影响很小。

建议后续仅对CA246计算测试载体禁用其不验收的文件监听，保真实Worker、Python和请求策略；不全局关闭产品开发HMR。**本轮Python只定位与研究影响，未改正式CA246、Vite配置、计算实现、timeout或策略，未签原CA246通过。**

## 4. 保留失败、交付与接续

三条既有GUI属性草稿目标切换／IME测试仍未通过；与本次实施前冻结终点样本的fullName及首错对应，且失败不进入本次字号／颜色helper。[逐条对照与未解决范围](APPEARANCE_RESULT.md#5-三个未通过的既有草稿切换问题)。不能由本报告宣称所有草稿切换或IME安全场景已验收。

没有重跑全仓、重录`known-failures.json`或改变历史raw；没有用exclude、skip、涨timeout或删除正确断言洗绿。前轮`reportComplete=false`、全局错误和同名对应限制继续按原历史样本保留，不能宣称全仓通过。原14条旧Slide失败未作为整批清零目标，已按计划以正确paint／手势前置保护相应核心行为，没有恢复旧单击编辑。

本轮新增产品增量限6文件（5个格式owner／消费者＋1个Slide owner），测试域11文件。精确集成清单在ignored `output/test-runs/format-core-repair/{appearance,selection,close,c2}-integrated-files.json`，分项结果列各自路径。Root保留了接手dirty副本、各次原始失败、分支候选和用户创作；三个修复工作区保留供审阅，没有为归档创建Git快照提交或删除共享node_modules连接。

已授权范围内未出现必须新增UI／模式／操作路径的决定。后续若需要改变这些可见行为仍先确认；本包完成不自动授权其他旧任务、Python正式配置修改、commit、push或发布。
