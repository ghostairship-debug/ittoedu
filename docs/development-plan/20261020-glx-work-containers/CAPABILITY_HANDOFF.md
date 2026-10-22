# 通用作品与容器能力交接

2026-10-20。供下一轮开发和创作接续使用；本页记录本轮已实现的能力及证据边界。P0—P7结果和主目录集成事实见 [IMPLEMENTATION_RESULT.md](IMPLEMENTATION_RESULT.md)。

正式目录为 `D:\果铃工作台`，隔离验证候选和原失败证据保留于 `C:\Users\74755\.codex\worktrees\glx-work-containers\果铃工作台`。本轮未 commit、push、打包发行或调用收费创作服务，原有效构建有本地备份。

## 作品现在怎样承载

- 新写入格式为 **Project 11 / Published 4 / Component API 5**。作品目录使用真实根实例 `rootIds`，入口为 `entry.rootInstanceId`；子对象顺序只有实例 `childIds` 这一份事实。Flow、Slide、Spatial 的作者配置属于该实例的 `container`，标题仍是实例名称，没有另一份可写 `surfaces`。
- 完整 HTML 程序可以直接成为 Source 根，使用真实可用视口；不自动套 Slide、固定画幅或默认翻页控件。程序仍可拥有可见的原生子对象，HTML 与这些对象各自保留。
- 三种容器继续复用成熟编辑器、布局与播放算法；可以在作品中嵌套并深入编辑。普通编组保持自己的自由布局，不因处于 Flow 内便改造成 Flow。局部状态、镜头、规则和输入归最近的实际容器，兄弟容器相互隔离。
- 2026-10-22 修正：场景呈现状态仅供 Slide；Flow 章节／标题、Spatial 镜头／路线是对应的内部导航层级。两种编辑模式、原生与程序动作均保持此边界。旧 V11 技术样本中的非 Slide 状态原件保留，当前读入会明确指出冲突容器，不能据10月20日的扩域测试继续创作这种结构。
- 现行 **Project 10 只在归档读入及恢复边界转换**，原文件和原恢复记录保留；后续保存写 11。内部 `CourseV10Driver`、文档 kind 或历史类型别名仍可能带旧名称，不能据此判断磁盘格式。Published 4 和库格式 2 是新输出；旧库 1 只在读取边界归一化。此边界不表示任意更老格式均可读。

直接实现：[工程合同](../../../src/shared/contracts/component-platform/project.ts)、[归档读入](../../../src/core/drivers/codecs/courseProjectV10Archive.ts)、[库合同](../../../src/shared/contracts/component-platform/library.ts)。

## 从现有公开入口继续工作

完整程序沿现有 `project.apply` 创建或更新，不需要第二种工程或专用万能工具：

```json
{"path":"entry.html","intent":"program.set","content":"<!doctype html><html>…</html>"}
```

也可使用已经获准读取的输入文件：`{"path":"entry.html","intent":"program.set","from":"实际输入路径"}`，并可提供 `content`。软件沿既有输入与资源服务处理 HTML、CSS、本地模块及媒体依赖。失败前不留下空入口或半个新根；已有作者根保留。只会收起严格未编辑的工厂空白初始页。再次修改当前程序复用同一入口实例；显式选择其他根时，不会借整文档授权改写全局入口。

续改先从当前目标的 `read` / `project.list` 取得 `authoring.project` 和实际文件路径，再用同一 selector 调 `project.read` / `project.apply`：

| 要改什么 | 当前正式文件与行为 |
| --- | --- |
| 完整程序正文、CSS、页内脚本 | `entry.html` 与对应 `roots/*.content.html` 指向同一实例；普通 `content` 或 `edits` 续改即可 |
| 参数、专业数据和样式 | 当前目标的 `*.data.json` / `*.style.json`；保留该专业组件已有数据合同 |
| Source 实现及依赖 | 当前目标的 `*.view.js` / `*.view.ts` 及返回的依赖文件；局部私有修改沿已有 Source 隔离，不覆盖其他实例 |
| 嵌套阅读或空间内容 | 实际范围内的 `*.body.html` / `*.body.md` / `*.spatial.json` / `*.container.json`，继续使用既有专用源文规划器 |
| 原生图片、复制和控件 | 实际容器或程序根的子对象面；图片沿同一资源准备和事务插入，不默认改写用户 HTML |

路径由软件生成并随当前内容发现，不要求模型维护编号或猜测路径。局部 selector 只获得其真实范围；Spatial 图句柄提供同范围的可编辑源文，不借此开放其他图、页面或资源。普通叶对象、文字字段仍不能充当可插入容器。

实现入口：[项目文件协调器](../../../src/core/projectFiles/componentPlatform/coordinator.ts)、[文件投影](../../../src/core/projectFiles/componentPlatform/projection.ts)、[工具 Gateway](../../../src/core/tools/DocumentToolGateway.ts)。正式 Host/Session 行为证据见 [程序入口](../../../tests/integration/glxProgramEntry20261020.test.ts)、[输入与资源](../../../tests/integration/glxProgramSourceAdmission20261020.test.ts)、[窄授权目标](../../../tests/integration/glxProgramTargetTools20261020.test.ts)、[程序图片](../../../tests/integration/glxProgramImageApplication20261020.test.ts)、[Flow 插入](../../../tests/integration/glxFlowCanonicalOwnerInsert20261020.test.ts)、[空程序根复制](../../../tests/integration/glxEmptyProgramCopy20261020.test.ts)。这些聚焦证据不等于所有界面均已实测。

## 人工、工具和库使用同一当前稿

程序接入平台状态、镜头和转场使用现有 `context.teacherController`，按软件返回的真实容器身份取得 `forContainer(containerId)`；没有该可选端口时应明确诊断。以下调用在 V3 技术载体使用同一个执行者，默认作用域是实例绑定的最近容器，显式 `containerId` 可指定合法目标：

```js
const slideNav = context.teacherController.forContainer?.(slideContainerId) ?? context.teacherController
await slideNav.execute({ type: 'scene.go', containerId: slideContainerId, sceneId: slideContainerId,
  targetStateId: 'detail', transition: { effect: 'fade', durationMs: 1200 } })
const spatialNav = context.teacherController.forContainer?.(spatialContainerId) ?? context.teacherController
await spatialNav.execute({ type: 'camera.present', containerId: spatialContainerId,
  pose: { x: 350, y: 160, zoom: 1.15 }, motion: { durationMs: 0 } })
```

`nav.read()` / `subscribe()`观察同一观看事实；订阅在dispose释放。原生规则的 `presentation.set` / `scene.go`操作同一状态和镜头。纯程序未绑定的演示能力会明确失败，不自动补Slide；程序自己的Canvas坐标与循环仍由程序管理。背景使用现有 `scope.state` 的get/set/subscribe，读取实例stateBindings指向的真实键，资源经 `context.resources.url`，离开/返回和dispose沿原生命周期释放rAF、监听与订阅。可复用实际[两类背景源码](../../../src/core/components/library/workAssets.ts)，不要求另建控制器。

人工专业编辑、工具局改、Source 续改、资源插入继续进入同一个 DocumentSession、事务、History、保存与恢复链。没有并行工程或第二 writer。目标授权、最终 CAS、Stop 和回执仍由原服务维护；人工修改后工具应读取当前事实再继续。命名状态下的撤回恢复该状态的原覆盖，不把它写入基础态；Undo/Redo、邻居内容与人工布局按原语义保全。

组件提炼、跨项目插入、参数与源码深改、来源更新仍沿原库归档与插入事务。软件映射根、子对象、状态、规则和资源身份。更新可查看来源文本差异，并保护本地共享源码及实例私有覆盖；程序根也可更新，不要求先存在页面。库条目现可说明容器、程序、展示、镜头、背景、转场、模板或内容用途，供现有发现和插入入口使用。

现有 14 个基础条目覆盖三种容器、程序、展示、镜头、两类可执行背景、转场及混合模板等用途。两类背景真实接收前景参数或状态，继续使用原生输入、Source 生命周期与清理；没有另建背景注册平台。相关实现：[库插入](../../../src/core/components/library/insert.ts)、[来源更新](../../../src/core/components/library/updateSource.ts)、[基础条目](../../../src/core/components/library/workAssets.ts)。聚焦验证见 [库闭包](../../../tests/unit/glxWorkLibrary20261020.test.ts)、[库更新](../../../tests/unit/glxLibraryUpdate20261020.test.ts)、[更新回归](../../../tests/unit/glxLibraryReviewRegression20261020.test.ts)。

## 已有实证与下一轮边界

| 属性 | 当前有效证据 |
| --- | --- |
| 既有作品的实际编辑、Undo/Redo、保存、新进程冷开和断网互动 | [V1 facts](../../../output/glx-work-containers-20261020/final-ui/v1-PSIZQD/facts.json)；[断网事实](../../../output/glx-work-containers-20261020/final-ui/v1-PSIZQD/offline-facts.json)。实际鼠标打开专业文字编辑，目标外实例和布局保留；新进程可继续编辑；断网反馈、音频和正式翻页可用 |
| 完整程序局改后继续输入、动态绘制、保存冷开和离线输出 | [V2 facts](../../../output/glx-work-containers-20261020/final-ui/v2/run-rOXBWm/facts.json)。真实 UI 撤销后实例恢复局改前、重做后恢复局改后；编辑、冷开、断网均有真实输入及 rAF 增长；最终断网无公网请求、无 pageerror。屏幕外窗口造成的早期输入失败已另留现场 |
| 两类可执行背景与生命周期 | [A07 真实运行证据](../../../output/glx-work-containers-20261020/background-facts/A07-evidence.md)。实际库插入、GLX 保存冷读、Published sandbox 与 compiled HTML 两种载体；前景可输入，离开取消动画，返回只有一份 Canvas/rAF，最终释放 |
| 局部读取不会随无关工程展开 | [A14 数字及复现命令](../evidence/glx-local-read-facts-20261020.json)。1 根/1 实例与 500 根/501 实例，同一局部正文与 Source 各返回 128 字符，总长分别 831/834，续读位置均 128，局部目录均同 9 条；未带入无关根正文。显式 full 分页继续保持首次捕获快照，人工续改后报告 stale，不拼接不同版本 |
| Source 深改后继续专业编辑 | [A17 分层证据](../../../output/glx-work-containers-20261020/professional-variant-facts/A17-evidence.md)。实际 PropertiesTab/Session 改色，真实 Source Canvas 蓝→红→Undo蓝→保存新Host/profile冷读红→同面板续改绿；Source private、兄弟、frame及非空图片资源保全。面板是JSDOM实际React，运行是真实Chromium |
| 同对象共同正文与单状态布局 | [实际Bridge/Session验证](../../../tests/unit/glxSharedContentStates20261020.test.ts)，共同正文与detail frame分别修改、切换、Undo/Redo及GLX保存读回，身份和同伴保全 |
| 公共静态导出 | [实际导出事实](../../../output/glx-work-containers-20261020/final-static/run-6mo7po/facts.json)、[制品检查](../../../output/glx-work-containers-20261020/final-static/run-6mo7po/artifact-facts.json)。实际 Main 公共入口导出 PDF/PPTX，正式 Flow 保存后导 DOCX；PDF 代表图面已目视，PPTX 原生文字与内嵌图、DOCX 标题/表格/公式已核。格式固有限制和诊断保留 |

V3 混合工程完整链见 [最终facts](../../../output/glx-work-containers-20261020/final-ui/v3/run-JqNi7M/facts.json)：Flow/Slide/Spatial同工程，Source与原生控件交替操作同一局部状态和镜头，程序自管Canvas变换独立；专业编辑、Undo/Redo、UI保存、新PID/新profile冷开及断网导出均通过。当前overview编辑只写该状态的left-note覆盖，保基础值、其他状态、frame和同伴。

A06 [实际导出facts](../../../output/glx-work-containers-20261020/final-ui/v3/a06-agIo0E/facts.json)：左旧fade取消并保持overview，右独立fade正常到detail，Source与原生动作各只执行一次、无剩余动画；断网无公网请求或pageerror。[完整技术索引](../../../output/glx-work-containers-20261020/final-ui/MIXED_ACCEPTANCE.md)保留失败与最终证据。

本轮技术载体证明软件入口、局改、保存冷开及上述运行/输出属性；不证明新作品的内容质量、真实模型创作效率、速度或 token/费用收益，也不替代独立 EXE、设备/云端及 Owner 签收。下一轮创作仍需在同一正式作品中完成内容、互动和交付验收；不因本页重启历史收费验证或发行。

保存保留作者初态、源码、资源和状态定义；观看进度及任意程序内存不等于持久化游戏存档。复杂程序继续通过参数与源码修改，不承诺每个内部对象都有人工专业面板。Office输出沿其既有适用范围，程序互动的实际交付载体是HTML/Web。
