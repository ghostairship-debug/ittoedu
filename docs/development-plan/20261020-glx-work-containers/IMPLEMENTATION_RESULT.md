# GLX通用作品与容器化实施结果

## 结果与范围

Owner授权的P0—P7按完善后根方案实施。正式目录为D:/果铃工作台，基线HEAD为1af578e57c120210810d8e2996d072efdc50a365；隔离候选为C:/Users/74755/.codex/worktrees/glx-work-containers/果铃工作台。未安装或升级依赖，未commit、push、打Portable、发布或部署；原作品、真实profile、恢复记录、凭据和无关dirty保留。

P0—P7的软件与技术验收已完成。V1旧工程副本、V2纯程序、V3三类混合容器均完成真实互动、局改、Undo/Redo、UI保存、新进程/新profile冷开及公共HTML导出后的断网互动。源码与最终本地构建按本轮清单集成主目录；旧有效构建备份于output/glx-work-containers-20261020/pre-switch-build。主目录加载核验和清单见本报告末尾，不将技术通过扩大为发行或作品质量签收。

## 最终契约、唯一负责人和实际复用

正式作者结构为Project11：rootIds是作品根顺序，entry.rootInstanceId只选起点，instances.childIds是唯一子树拥有关系；实例container保存Slide/Flow/Spatial作者配置，标题复用name。Published4和compiled-course-v2成套消费该结构；Component API5仅作兼容可选扩展。部分内部CourseProjectV10/PublishedV3名称和document kind course-v10沿用，实际wire版本不伪装成旧格式。

componentSurfaces只派生根容器目录，componentSurface解析任意容器，componentContainers用于全部容器的资源/引用遍历。正式变更直接操作真实根和container字段，surfaces不再是作者镜像；派生视图不作writer，不使用Proxy/getter跨序列化伪装。Source根使用真实program-viewport和原Source运行器，没有伪Slide、强加翻页或重复World。

| 事实 | 唯一负责人及直接消费者 |
| --- | --- |
| 作者树、共同正文、单状态覆盖、Source和资源 | DocumentSession/Driver正式事务、最终CAS及同一History；人工Bridge、公开Gateway和文件作者入口共同消费 |
| 根目录、当前根、深入/返回与选择 | 原CourseV10Bridge及编辑ViewState；rootIds目录包含Source，局部深入不改变作品根 |
| 观看进度、状态、平台镜头和基础转场 | 原NavigationOwner按containerId作用域执行；Source正式ports与原生规则进入同一执行者 |
| 程序内部输入、业务状态、Canvas/内部镜头 | 原Source程序自身；需要平台能力时调用正式ports，不保第二份平台状态 |
| 布局、几何、专业属性和文字草稿 | 原Slide/Flow/Spatial算法与专业面板；有效呈现统一为作者模型→全部局部状态→编辑草稿→预览，DOM/World同值 |
| 挂载、inline、活动性和销毁 | 同一World/Runtime；容器边界递归交原adapter，Source沙箱MessagePort桥借用同一实例，释放后归还 |
| 保存、恢复和输出 | 原File/Archive/Session及Published/compiled/静态导出链；未建立第二工程或资源仓库 |

当前V10归档只在正式读取边界转换一次为11，写出只有11。隔离恢复验证将current/saved/past/future及操作记录使用同一身份映射，保revision、operationId、dirty及Undo/Redo关系；原journal先备份再接续。绑定不变的磁盘重读复用映射；只有新对象实际占用旧合成身份时局部重分配，已有11历史不回写。旧恢复原件和真实用户profile未迁移。旧库V1只在读取边界归一化，正式库写出V2。此边界承接本轮当前文件，不建立长期多内核。

保留原三表面人工入口、专业文字/图形编辑、媒体、选择拖缩、Flow段落、Source/COW、资源、快捷键、导航、观察、Undo/Redo及静态导出。退役的是surfaces作者双轨、按裸state.id跨容器映射和错误的surface唯一性假设；成熟算法、专业实现和名字仍旧的有效内部模块继续复用。

## 基础资产与组件更新

沿现有组件库目录交付14个真实条目，覆盖方案基础类别以及环境背景、场景联动背景两种可执行实例，入口见src/core/components/library/workAssets.ts。容器/普通对象按原库插入事务进入单一实例树；背景、转场按usage走附着/导航设置，未将库例子误插作页面。跨项目提炼/插入映射实例、定义、资源、规则和(containerId,stateId)，保留嵌套容器闭包及Source根作用域。

定义library.baseline只保留来源implementation/dataSchema/源码文本材料供真实比较；更新显示原来源、当前与传入源码差异。本地共享源码深改须明确选择才替换，取消保留当前稿；实例private override继续保留。最终源码CAS防止对话框期间的人工作业被覆盖；纯程序工程直接更新定义，不造surface。

两类背景均经正式GLX保存冷读、Published沙箱与compiled HTML实际运行：原生输入驱动绑定energy值，Canvas半径4→18、深色像素720→约12650；前景输入保持，离开rAF清零、返回单Canvas/单rAF，销毁pending=0且绘制不再增长。证据见output/glx-work-containers-20261020/background-facts/A07-evidence.md。

源码深改变体已完成真实专业接力：同一形状资产两实例，仅一个实例private Source阴影5→9；Source撤销/重做与兄弟隔离成立。实际PropertiesTab依原shapeDataSchema/专业route改填充，经同一Bridge/Session使真实Chromium沙箱Canvas蓝→红→Undo蓝→保存冷读红→新Host/profile同面板继续改绿；原frame及非空mixed-image.svg资源保全。面板层为JSDOM实际React/正式事务，效果层为真实Chromium，冷开层为磁盘与新Host/profile，不冒充整套Electron面板实操。证据见output/glx-work-containers-20261020/professional-variant-facts/A17-evidence.md。

## 保留行为与实际验证

只验证本轮真实受影响路径，未变有效证据复用；聚焦检查、真实UI、保存冷开和实际产物分别记录。320个受结构变更影响的旧测试文件按实际读取/写入/边界职责迁移夹具；保留原断言，不削弱tsconfig、测试保护或保留可写surfaces镜像。

| 当前能力 | 验证和结果 |
| --- | --- |
| 旧作品人工编辑和布局 | V1真实built软件鼠标打开专业文字编辑、改字、Undo/Redo、另存。仅一个目标实例内容变化，frame、roots及同伴实例不变；新PID/新profile读回同值且dirty=false |
| 三表面/容器编辑 | 原三类workspace、自由坐标、Flow body/overlay、局部状态/背景、深入返回及编辑ViewState针对性检查；V3实际深入Spatial并原生编辑、返回 |
| 正式工具/Source/图片 | 公共project.apply entry.html program.set、HTML/CSS/JS续改、参数、窄授权嵌套Flow、图片、原子失败、程序根复制及Source作用域测试通过；仍走同一Session/History |
| 状态、镜头、动效和输入 | container局部导航、同名兄弟状态、World/inline、观察、取消、活动性、motion属性隔离；V3实际Source/native往返及导出产物验证 |
| 恢复/持久历史 | 原Session/Host23项及新增恢复/磁盘身份反例通过，旧10当前/保存/历史整体转换，可继续编辑；原journal保全，无清空历史 |
| 库/资产/更新 | library闭包、来源真实diff、private override、Source根/嵌套scope、schema资源引用、跨工程及实际背景验证通过 |
| 原有静态输出 | built Main公共document.export实际写PDF/PPTX/DOCX；PDF两页视觉顺序正确，PPTX原生文字/内嵌图片/零外链，Flow DOCX标题/初态/表格/OMML分式保留 |
| 局部模型读取 | 真实Host在1根/1实例与500根/501实例下正文、Source均返回128字符，局部路径9条相同，响应831/834字符，无无关内容泄漏；分页120007字符维持原快照 |

局部读取事实见docs/development-plan/evidence/glx-local-read-facts-20261020.json；未测token节省比例、模型速度或费用，不能据此签收缓存/并行收益。

## A01—A18与方案0.1对照

| 项目 | 实际结果与证据 |
| --- | --- |
| A01 通用入口 | V2 public program.set → 真实输入/Canvas rAF → HTML/CSS/JS局改 → UI Undo/Redo → GLX保存/新进程冷开/离线互动；无Slide |
| A02 根与容器 | 三类原容器、递归投影与World/inline lease定点通过；V1旧工程及V3 Flow内两Spatial实际深入/返回、保存冷开 |
| A03 布局归属 | 原三表面编辑/Flow段落与浮层针对性回归；V3目标外实例不变；glxSharedContentStates20261020实证局部frame、根/身份/兄弟保全 |
| A04 状态范围 | 旧10两个合法同名state读入/恢复统一映射；V3两Spatial各overview/detail，目标与兄弟独立，作者稿不写观看进度 |
| A05 状态与镜头 | V3 Source与原生控件交替操作同一状态/平台镜头；另程序自管Canvas变换e=8、兄弟e=0且平台镜头不变 |
| A06 转场取消 | 真实公共导出a06-agIo0E：左旧fade返回false并保持overview，右独立fade返回true到detail；Source各点击/结算1次、原生动作1次、剩余动画0，断网0请求/0pageerror |
| A07 背景联动 | 两类背景各在Published沙箱与compiled HTML实际输入、绘制、离开/返回和销毁，2/2；A07-evidence.md |
| A08 持久局改 | V2静态字/数据/JS重绘后真实输入维持；V3原生文字、A17 Source+参数多轮实际重新编译/重绘 |
| A09 Undo/隔离/资源 | V3 UI Undo/Redo；A17 private Source和专业面板Undo、兄弟/frame/非空图片资源保全、实际GLX冷读 |
| A10 保存/冷开/恢复 | V1/V2/V3新PID+新profile；隔离10恢复当前/保存/持久Undo/Redo及映射冲突反例、原journal备份；不清历史或改真实profile |
| A11 实际产物 | V1/V2/V3经公共document.export写独立HTML并在断网Chromium真实互动，0公网请求/0pageerror |
| A12 库与基础条目 | 14条目类别/schema及正式跨项目插入/闭包共享机制、混合模板、背景实跑；glxWorkLibrary6/6。不宣称14条逐一UI深改 |
| A13 来源更新 | glxLibraryUpdate6/6实际来源文本diff、本地共享深改显式决策、private保留、最终workspace CAS、纯程序定义更新；App使用同一review结果。此层为producer/Driver/真实UI接线复核，不冒充逐个弹框实操 |
| A14 按需读取 | 真实Host 1与500根局部正文/Source均128字符、同9路径；full分页120007字符保持原捕获快照；数字见evidence JSON |
| A15 当前能力保全 | 本报告保留行为表、V1真实专业编辑/保存/离线及公共PDF/PPTX/DOCX产物；成熟人工入口保持，已知旧失败另列 |
| A16 同对象多状态 | glxSharedContentStates1/1：一个对象共同正文+detail-only frame，overview/detail切换、两步Undo/Redo、GLX保存读回，兄弟/身份不变 |
| A17 深改后专业编辑 | A17真实专业面板→Source Canvas像素→Undo→保存新Host/profile冷读→同面板续改，见A17-evidence.md及其分层说明 |
| A18 一致目标解析 | 公共工具合法/冲突/窄scope、Source根无绑定演示能力、最近容器/state token和图源文测试通过；错误明确、无静默补Slide或回退全局 |

方案0.1八项对应：①A01；②A02/A03/A04；③A05/A06；④V2自管rAF与A05程序内镜头；⑤A08/A17；⑥A09/A10/A11；⑦A07/A12/A13；⑧A14。基础软件范围完成后，不据此签收首件精品作品、模型质量或效率。

## 最终载体与产物

以下相对路径均位于output/glx-work-containers-20261020；首次失败现场仍保存在隔离候选，不覆盖为成功。

- V1：final-ui/v1-PSIZQD；从原有效V10技术工程只读复制，workspace/v1-saved.glx、workspace/v1-offline.html及facts.json/offline-facts.json。断网真实feedback、音频到ended、Formal Next第二页，0公网请求/0pageerror。
- V2：final-ui/v2/run-rOXBWm；workspace/v2-saved.glx、workspace/v2-offline.html和facts.json。真实UI CtrlZ回到局改前实例、CtrlShiftZ回到局改后，真实输入结果4和rAF持续；新PID新profile冷开与离线同值、0公网请求/0pageerror。
- V3：final-ui/v3/run-JqNi7M；workspace/v3-saved.glx、workspace/v3-offline.html及facts.json。实际Flow→Slide→Flow、两个Spatial同名状态/平台镜头Source与原生往返、程序自管Canvas变换8与兄弟0。原生专业编辑/Undo/Redo/返回/另存后只改变left/overview的left-note数据覆盖，基础正文、frame、其他状态和同伴保持。PID25068→55708、新profile冷开模型相等且dirty=false，断网产物同交互通过。快速转场另见final-ui/v3/a06-agIo0E。
- 静态交付：final-static/run-6mo7po/workspace及artifact-facts.json，PDF/PPTX来自V1正式保存结果，DOCX来自最小正式Flow。格式固有限制诊断保留；PDF图面不冒充可编辑文字，程序不冒充Office原生互动。
- 背景：background-facts内ambient/scene.verified.glx、published.html、compiled.html、facts.json及截图；scene.before-fix现场保留。

最终主库npx tsc --noEmit、E2E npx tsc -p tsconfig.e2e.json --noEmit通过；Main构建使用同一tsconfig.electron完成类型编译。最终Player/Renderer/Main构建日志分别为build-player-v3-a06-owner-final.log、build-renderer-v3-a06-owner-final.log、build-main-v3-a06-owner-final.log，均exit0。Main buildId为2026-10-20T14-18-27-202Z-1af578e57c12；HEAD仍为基线，当前未提交代码由integration-manifest.json列明。合同/能力生成与检查已通过，最终任务板由生成器更新；重要结构及最终真实缺口均有未参与该实现者的增量独审。V1/V2/静态输出/背景/深改的未受影响有效证据复用，没有机械跑全矩阵。

## 实际检查发现与修正

真实产品链先后暴露并修复：派生Zustand selector不稳定导致React185；容器外层flex使原absolute画布高度为0；程序workspace继承居中使真实viewport宽0；原生规则先ready、DOM晚到时漏补Document点击监听。均沿原selector/布局/事件owner修复，没有重做Source、专业编辑器或导航器。

混合实际链还修复：Run原生指针误走作者选择使工具条收缩、点下与抬起错位；Flow正文容器平铺后代绕过相机注册，改接同ContainerPreview并保正文外框、图注及当前模型更新；旧投影晚退出清新编辑绑定，沿World现default map按旧DOM身份归还，inline借用中也不回到断开DOM；编译HTML缺组件标记使Spatial误捕指针，补成熟同标记并限定手势只认本视口内部组件，保背景拖动/缩放及Space/中键。导航/取消算法没有因此重写。ProseMirror只读切换同步现props，保选区、草稿和编辑器身份。

归属复核还修复：Flow浮层菜单/paragraphAnchor按最近Flow；健康与AI卡定位按root→container→scope→selection；HTML锚点遇容器停止、普通group继续；命名状态卡撤回用原state inverse；motion属性隔离兄弟/Source；库剪贴板state-only家族与资源闭包；目录包括程序根。实际Source.inline经沙箱MessagePort、几何/裁剪/释放接原sameWorld，未以same-realm替代正式跨realm。

V2早期离屏Electron/OOPIF鼠标无效来自验证载体HWND位于-16384且未show，改为正常坐标、透明showInactive后同一真实输入完整通过。原Source代际实现保留；没有把工具载体故障变成一次软件重写。

## 既有缺陷、支持条件和交付边界

以下在未改原主线亦复现、保留原断言与现场：旧g20M21默认导航台预期、r1Published四项stub/输出预期、auditAllTextLibrary未使用声明的CA040预期。不以新默认控制台或静态fallback洗绿，不宣称历史全库测试全绿。此前真实作者作品质量、耗时与费用的失败/未签结论保持；本轮没有启动付费作者或修原作品。

当前10文件可一次读入，保存为11；需要继续使用旧软件时保留原10副本。原三表面默认体验与成熟能力沿用，新增深入/返回和程序入口是本轮可见增量。没有Owner待决的新能力取舍；发行继续暂停。源码与本地开发构建交付不等于独立Windows发行、精品作品质量、模型采用效果或Owner整体接受。

下一轮按CAPABILITY_HANDOFF.md使用短入口；本轮不自动启动首件创作。



## 主目录集成与收口事实

源码按integration-manifest.json白名单集成D:/果铃工作台，保留原有docs/creative-production未跟踪工作；四份退役生成schema及原根方案在pre-switch-files保全。三个旧有效构建在pre-switch-build保全，验证后的dist-player/dist-renderer/dist-electron成套切换；对应local-build-switch.json。

切换后又用主目录实际程序、新独立profile只读打开已保存V2：Project11、dirty=false、无Slide、修后正文可见，真实Canvas ticks8→36、0pageerror，进程53556已关闭。Main buildId与V3/A06验证版完全一致；事实见output/glx-work-containers-20261020/main-integration-facts.json和main-integrated-program.png。此次仅核主目录相对路径/实际加载与运行，未重复整个P6或启动模型。

完成卡已删除，沿现生成器更新任务板。失败与隔离profile保留在附着候选中；主目录只补对应技术制品和结果，不迁移真实profile或将失败覆盖为成功。未完成的历史作者质量/耗时与发行边界继续按原日期保留。本方案软件实施与技术验收已收口。
