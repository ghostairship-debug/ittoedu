> 原始审计/方案：已由当前实施结果承接；原意见和当时事实不表示当前未修缺口。完整辅助材料见本目录索引。

> 本文已完整整合至 [剩余问题统一执行方案](./20261006-剩余问题统一执行方案.md)。后续本批修复以统一文件为唯一执行入口；本文保留为历史依据。

# Antigravity MCP 实测核实与可执行修复方案

日期：2026-10-06。当前承载：D:/果铃恢复候选/20261005-v10-migration，源码 cut bc4628bd。
状态：只读核实与方案收敛；未修改产品代码，未重新启动应用，未调用产品模型。本文补充既有《存量与崩溃修复收敛执行方案》，不重启全面审计。

## 1. 结论与 Gemini 提示词的修正

两个实际修复包是：L，修复 HTML 拆解后的层叠关系；M，提供无需 Playwright、无需加载工作台主界面的正式 MCP 启动与连接入口。客户端样例的工作目录、保存与关闭事实作为 M 的同包修正。

Gemini 描述的方向有价值，但归因需要改写：

| 说法 | 本次核实 | 修正 |
|---|---|---|
| MCP 深度依赖可见主窗口，Token 只能由 UI 获取 | Resident 服务、Token store 和 DocumentHost 均由 Main 持有；UI 状态可为空。当前启动根仍总建主窗口，观察入口 URL、导出 Renderer port 也从该根取得 | 修启动根和渲染服务接缝，复用现服务；不是重新建设 MCP/文档平台 |
| auto=0 导致背景 z1 覆盖前景 | 最新输入的前景父 DIV 已 position:relative、z-index:5；拆解时该无 paint 的 wrapper 被 flatten，后代丢掉父上下文 | 保留真实 stacking context，再在正确上下文内决定顺序 |
| 全屏、DOM 靠前的 img 应自动降为背景 | CSS 中正 z-index 的图片本来可以合法覆盖普通内容；全屏尺寸和 DOM 位置不能判断作者意图 | 不采用“全屏图片强制置底”启发式 |
| body 背景色没有继承，画布退回白色 | browserCapture 已有 html 透明时继承 body 背景；两次恢复稿的 rgb(2,6,23) 深色根都保留 | 本例不立“底色丢失”缺陷；Surface 底色 promotion 单列体验改进 |
| 核心链路完全闭合 | theme/redo 有 committed、usable 回执，observe 确有 PNG；但没有保存调用，关闭尾部也没有完成记录 | 已证明应用与观察；未证明保存、冷开和正常退出 |

CSS 依据：stacking context 对父上下文是原子整体，z-index 只在所属上下文内比较。auto 与显式 0 也不是相同的上下文语义。[W3C 层叠上下文](https://www.w3.org/TR/CSS22/visuren.html#z-index)、[W3C 绘制顺序](https://www.w3.org/TR/CSS22/zindex.html)。

## 2. 本次样本与落盘事实

直接读取：
- D:/果铃工作台/scratch/optics-mcp-authoring/build-page1.mjs
- 同目录 observe-page1.png、sources/page1-intro.html、启动和连接探针脚本。
- C:/Users/74755/.gemini/antigravity-cli/brain/f1a3bb61-4752-407c-8974-8b0e2fb7645c/.system_generated/tasks/task-1024.log 和 task-1005.log。
- 测试 profile 的 journal binding、最新恢复记录与正式磁盘包。

最新脚本实际送入的是内联模板，不是 sources/page1-intro.html。其根 DIV 为 1280×720、深色底；背景 img z1、渐变 DIV z2；前景父 DIV z5。

只读恢复记录证明：前景 wrapper 已消失，深色内容根下面的有序项为三个前景 Web 内容组，最后才是 1280×720 背景图片。这个顺序直接对应截图遮挡。

两次任务均 latest revision=2、savedRevision=0。实际文件 binding 是：
D:/果铃工作台/scratch/optics-mcp-authoring/profile/workbench-v2/space/光的折射与透镜奇境.h5lesson

该正式包仍是 revision=0、首页面 childIds 为空、1267 字节，修改时间为台北 16:43:07。用户提供的 workspace 当前只有 assets，没有同名课件包。相对 file.open 使用的是宿主工作空间，不是脚本 cwd 或媒体所在目录。

两份日志都停在 PNG 成功写盘之后；脚本随后是 client.close、app.close，但没有分别记录其完成，亦没有 project.save。不能据此认定某个 close 阻塞，更不能认定本次发生原生崩溃。

完整只读对比：[journal-disk-comparison.json](D:/果铃恢复候选/20261006-followup-diagnostics/antigravity/journal-disk-comparison.json)。未执行 restore/recover，也未改写原工程。

## 3. L：保留真实层叠语义，修复页面遮挡

优先级：当前用户可见结果错误，P1。单一 owner 为现 HTML 测量/装配链；自由画布仍只保存果铃 frame、编组和 childIds 顺序。

直接写域：
- src/core/contentApply/assembly/htmlAssembly.ts
- src/main/workbench/contentApply/measurement/browserCapture.ts（仅补实际需要的临时测量输入）
- src/main/workbench/contentApply/application/html.ts
- 必要的现 componentPlacementStyle/专业节点投影接缝及聚焦测试。

实施：
1. 测量和拆解时保留真实 stacking context 边界。本例前景 position:relative+z5 不能按“无 paint 的布局 wrapper”丢掉。软件将该上下文转换为正式编组，其后代的局部 z-index 不参与父层数字比较。
2. 将需要与内容交错的装饰参与同父绘制顺序。本例应是 bg image z1 → gradient z2 → foreground context z5。当前 decorationHtml 把装饰统一放入父 iframe，无法表达这个交错；仅补“不 flatten z5 DIV”仍不完整。
3. 复用现 Web/原生对象和有序项装配，不新增持久化 z-index 平台。布局 order 不是全局绘制序；DOM 父关系也不自动等于 CSS stacking context。本次修已证的上下文与交错装饰，不顺带重写所有 painter；其他非 context wrapper 的投影问题待具体样本再处理。
4. 遇到本次范围内现投影不能拆分保真的共同绘制关系，保留最近必要的 Web 源码范围。保留交互与源码，不静态化整页，也不默认把所有 HTML 收成一整页 Web。共同 opacity/filter 的后代合成问题不另扩大为本次 P1；后续有实际样本时，仍须保留共同合成效果，不能只涂空 shell 或逐个复制 alpha。
5. 保持普通独立文字/图片的可编辑性；本次页面 redo 可重新装配，已有对象局部文字修改不能触发整页重排。

最低验证：
- 用本次 z1/z2/z5 结构的聚焦样本，证明前景父 context 没丢、三个层次顺序正确。
- 一个正 z 的全屏前景图/蒙层反例，证明没有“全屏图片一律置底”。
- 修复后通过直接 MCP 对同内容的独立工程副本 apply、observe，再与裸 HTML 实际呈现对照：不透明卡片遮住底图、渐变位于正确层、文字可读且仍可编辑。保存和冷开与 M 的同一闭环共用，不重复整套矩阵。

Surface 底色 promotion 不作为本例 P1 的前置。若随本包做体验改进，只在明确整 Surface redo 时，将测得的文档 canvas 非透明颜色通过同一次 canonical transaction 写入 Surface.background；局部 insert/edit 不改变整页背景。已承载的渐变、图片、半透明和裁切不能因 promotion 丢失或重复合成，不按全屏 DIV/img 尺寸猜背景。

## 4. M：正式后台启动/连接入口

优先级：外部创作主流程摩擦，P1。推荐复用 Electron Main 和已有服务，不拆纯 Node 宿主；HTML 测量和真实观察本来需要 Chromium。

目标命令形态（计划接口，当前尚未实现）：

    npm run mcp:server -- --workspace "<绝对目录>" --port 45888 --ready-json
    electron . --headless-mcp --workspace "<绝对目录>"

现产品默认端口为 45123；本次 profile 配置为 45888。CLI 必须输出实际 endpoint，客户端不能硬编码样本端口。

实施边界：
1. Node launcher 复用已有 prepareElectronLaunchEnvironment，删除继承的 ELECTRON_RUN_AS_NODE，然后启动同一个 Electron composition root。复用既有构建制品；不为每次连接重新构建全产品。
2. headless 分支启动 Main DocumentHost、Resident MCP、资源/文件服务与权限根，不创建或挂载工作台主 App。仅把主窗口 show:false 隐藏仍会加载整个工作台，不算完成这一目标。
3. 测量沿现一次性隐藏 BrowserWindow；观察复用现 Published worker，并把 observation.html/renderer 资源入口解析从 mainWindow 生命周期中解开。仅需要观察时创建 worker，完成后清理。Electron 支持隐藏窗口绘制，但隐藏整工作台并不会消除其渲染成本。[Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)。
4. 导出保留现冻结快照与 DocumentExportPort/build 行为，抽出现 buildDocumentExport 的构建部分供必要隐藏 worker 消费；不另建 Store/History。它已接收 Main 快照、compile 与 prepareDrafts 参数，可沿现服务端口拆开。
5. GUI 宿主导出继续执行原 UI 草稿 drain。独立 headless 宿主没有 UI 草稿，此阶段为空，但正式 Session.drain、epoch/revision/资源快照与事务等待仍必须保留。attach 到已运行 GUI 时不能套用“无 UI 草稿”分支。
6. CLI 的 workspace 参数必须绑定现授权根和文件服务，ready 返回 resolved workspace、permission、endpoint、PID、profile/mode。相对文件名从该根解析；返回回执保留实际绝对路径，不能把 cwd 默认为宿主空间。
7. 同 profile 已有 owner 时连接该 resident，不能启动第二个 DocumentHost/writer。attach 返回既有宿主的真实 workspace；与请求不同时明确报告，不默改 GUI 的空间或扩大既有授权。凭据由显式连接配置或现 owner 控制的本地交接取得；不再通过 firstWindow.evaluate，也不新开无认证 HTTP 取 token 接口。
8. 首版沿用现 OS 加密持久 Token，由显式 ready/连接信息命令交接 MCP Token。现 GUOLING_MCP_TOKEN 只是客户端配置约定，不能声称已支持服务端覆盖；本包不需要额外实现服务端 Token 环境覆盖。普通日志不重复输出 Token，更不能输出 Provider Secret。
9. 只有 listener 和授权根确实 ready 后才在 stdout 输出机器可读 ready；诊断放 stderr。启动失败/端口冲突返回明确状态，不以进程已创建称 ready。服务协议仍是 HTTP MCP；如果客户端只能用 command/stdio，再加薄连接器，打印 JSON 本身不是 stdio MCP。
10. headless 不弹工作台模态确认。授权 workspace 内复用现权限；必须另行交互授权的操作明确返回原因，不能自动放权。隐藏 worker 关闭不触发 window-all-closed 停驻留服务。
11. SDK client 断开只结束自己的连接；attach 模式不关闭共享宿主。launcher 自己拥有的专用宿主退出经现 stop、事务/journal flush、service close 和 worker dispose；保持未保存恢复事实，不强杀通用 electron.exe 或静默丢稿。

直接写域：scripts/launch-electron.ts 及启动辅助、package.json、src/main/index.ts/现窗口生命周期、externalDesktopService/ExternalMcpService/ResidentMcpSettings、workbenchToolServices 的真实观察/导出接缝、DocumentExportRenderer 构建部分与必要 worker entry。共享 composition root 由一个 writer 汇合；不要建立新服务平台。

导出接缝已核：courseDeliverySnapshot 是纯 snapshot 投影；buildComponentPublished/Html/WebPackage 已只接 snapshot、compile port，不读编辑器。DocumentExportRenderer 静态导入 Store 并默认 prepareRootDrafts，因此仅传空 drain 回调仍会加载 Store，必须分离 GUI adapter 与构建叶子。Vite Player bundle 入口沿现构建复用；源码 compile 继续归 Main compilation owner，由必要服务端口交接，不向 worker 开放完整桌面 API。

最低验收共用一条零模型 SDK 链：后台启动 → 显式工作目录打开/创建 → tools.load → HTML apply → observe → project.save → HTML 导出 → 正常退出 → 冷开保存结果。分别检查真实提交事实、saved=current/dirty=false、保存绝对路径与结果画面。另做一次同 profile attach，证明复用同一 owner、断开不会结束原宿主。仅在有真实失败时扩大检查，不跑付费模型或全矩阵。

## 5. 同包修正 Antigravity 示例，不给模型加簿记

修改启动/创作样例：
- 从 ready/正式连接配置取 endpoint/token；显式传 workspace，或在 file.open 使用已授权的绝对路径。
- 读取 structuredContent/result 内实际 commit、usability、receipt/revision；不只以 isError=false 打印 APPLIED，也不截断唯一提交事实。
- 用户要求保存的端到端样例显式 project.save，核对绝对目标与 savedRevision；保留“恢复稿已提交”和“正式包已保存”的不同含义。
- 给 client detach、owned host stop 分别记录完成；只停止自己拥有的宿主。闭环失败准确报告已经完成的阶段，不把未观测的 close 判成原生崩溃。
- 软件提供现成可运行连接样例；Skill 只说明创作调用和何时保存，不要求模型管理 PID、Token 提取、端口发现或包装编号。

## 6. 执行顺序与停止点

L 与 M 可以按不重叠写域并行；L 内测量、装配、正式投影由同 owner 连续处理，M 的共享 Main/IPC/入口由一个集成 writer 处理。先完成两个包的最低证据，然后复用一次真实 optics 内容闭环收口。

本次两份日志不支持新增“native crash 已复现”结论。此前大工程崩溃/targets fanout 的证据和修复包继续独立有效，不把本次启动、保存尾部和图层错误混作同一崩溃根因。现有存量 UI 方案照旧，不扩大本包。

独立方案复核已确认：层叠包必须同时处理 context 与交错装饰；后台包不挂载主工作台，保正式 Session.drain 和 GUI 草稿边界、既有 owner 与授权根。代码实现后只按实际改动和直接 consumer 进行聚焦复核。
