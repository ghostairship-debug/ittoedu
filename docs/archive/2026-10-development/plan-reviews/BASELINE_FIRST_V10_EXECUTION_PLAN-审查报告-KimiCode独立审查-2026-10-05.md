# 《稳定基线恢复与 V10 渐进替换执行计划》独立审查报告

- **评估方**：Kimi Code CLI 主会话（独立第三方审查；非计划作者 Root、非计划审阅者 Astra）
- **评估方式**：15 个只读子智能体并行核查（基线 Git 事实、9 个工作包群源码对照、并发写域、K0 端口与唯一 writer、验证切换机制、N/L 目标覆盖、合同硬边界），全部论断以审查仓库当前树与 027d 基线实际源码为准
- **审查对象**：`D:/果铃恢复候选/20261005-authoring/docs/development-plan/component-platform-refactor/BASELINE_FIRST_V10_EXECUTION_PLAN.md`（REV1，388 行，HEAD b0076bc0 提交版）
- **审查日期**：2026-10-05
- **只读范围**：未修改任何文件、未执行回退/安装/构建/测试/真实模型调用；仅 Read/Grep/Glob 与只读 git（log/status/show/diff/merge-base/cat-file）

## 版本事实（先于结论）

审查期间被审目录曾出现未跟踪的 `BASELINE_FIRST_V10_EXECUTION_PLAN_REV2.md`（593 行，2026-10-05 20:51 创建，自称取代 REV1 并含 C1–C15 修正），约 21:02 被删除。审查结束时复核：工作树回到 25 tracked + 2 untracked、HEAD=b0076bc0 的冻结状态，与被审计划 §2.1 一致。本报告全部结论以 REV1 为准。抽查确认 REV2 的修正实测属实、覆盖本报告约三分之一的问题（X3/X4 措辞、部分孤儿分配、首链过重等），但 P3（phaser/旧后端退出 owner）在 REV2 中仍开口，且 REV2 新引入 crossSurfaceCommands 的 S0/C0 拆分排序风险。若 Owner 拟以 REV2 类修订稿为派发基线，需对其 diff 做一次聚焦复核。

## 结论：修正后可实施

路线本身（先恢复 027d 成熟前端、沿既有解耦端口渐进替换 V9→V10）**方向成立、依据扎实**，计划核心事实层经全部抽查无一失实：

- §2.1 六条 Git 事实全部复验一致（027d 确为 6d93 直接父提交、仅改 4 个 docs 文件、64d97fa2 确为祖先、HEAD 表述精确到"保存本方案前"）；§11 复用表 21 个引用提交全部存在；6d93 实测 654 文件 +50078/−83574，"不能整包 cherry-pick"属实。全文无把旧提交或局部证据称为稳定版本的表述。
- §1 纠偏清单逐条在源码坐实：`FlowWorkspace.tsx:325-365` 确实不传 clipboardContext/clipboardResourcePort；`createFlowDocumentResourcePort`（`flowDocumentResources.ts:26`）零调用；preparedResources 在 `FlowWorkspace.tsx:128-140` 与 `flowAuthoringSlice.ts:103` 两处被丢弃；ACK 为 fire-and-forget（`flowAuthoringSlice.ts:41-48` 未等 ACK 即回 ok）。
- §3.1/§3.2 五端口与真实接口接缝吻合（DocumentHostAPI 定义于 `shared/workbench/desktop.ts:66-83`、16 个 consumer；生命周期端口签名与 `App.tsx:285-297` 接线一致）；唯一 writer 分析成立——两 Bridge 按 kind 抛错（`CourseDocumentBridge.ts:97` / `CourseV10DocumentBridge.ts:133`），结构上排除同文档 V9/V10 混写窗口，§2.3 与 §8.5 无自相矛盾。
- §8 依赖边与实际 import 方向抽查 6/6 一致；X3↔X4 经核实不构成死锁（flowPageBox 为纯 helper，互"先交"的是不同叶文件）。
- 没有任何包只用后端/类型/DOM 证据声称 UI 完成；每个触 UI 的包都挂了具名真实链；IME 缺口处理如实且与完成定义衔接。

**但按现状派发会在实施中期撞上系统性阻断。** 主导缺陷是一类——**写域欠枚举**：约 50–60 个"合同变化时必改"或"切换时必须退出"的共享文件不在任何包独占写域内，而 §5:120 单 writer 规则 + §13.1"仅写独占路径"使这些文件无人能合法修改。外加 3 处用户功能退化缺口（HTML 导入、答题组件数据分离、单 HTML 双模式）、若干验证绑定缺口与协调缺口。这些全部是"补映射/补绑定"级修正，不动摇路线，故判定**修正后可实施**。

---

## 逐项问题

### P1【功能退化/实施阻断】整份 HTML 导入管线无 owner 且硬编码 course-v9（三个子代理独立命中）

- **计划位置**：§6 全表无 htmlImport；§12（plan:340）却将 L19 归 H0/H1/M0/C0/L0、L20 归 Q2/K0/A0/H1，形成"已覆盖"假象。
- **源码证据**：`main/workbench/htmlImport/HtmlImportService.ts:127,217,235` 硬编码 `kind==='course-v9'`；`prepareHtmlCourseCandidate.ts:69` 直接 throw"只能导入 Course V9"；三条活入口——内置 Agent `ExecutionEngine.ts:1641`、外部 MCP `ExternalMcpService.ts:342`、桌面 UI `main/ipc.ts:446-456`；而 `DocumentHostService.ts:61` 现只注册 course-v10 driver。合同义务：ARCHITECTURE_CONTRACT.md:77 钉定 `course.createFromHtml`；AGENTS.md 的 build-courseware-project Skill 依赖它。
- **失败链**：V10 切换后导入仍产出 V9 candidate → host 无 V9 writer → UI/MCP/Agent 三入口同时坏；若保留 V9 管线则构成第二写路径违反 §2.3；最终交付才发现"从 HTML 建课"消失。
- **最小修正**：Root/Astra 二选一——扩域 H0/H1 接管 htmlImport/**（导入后端改经 M0 测量/H0 装配/K0 提交，旧 U13 边界可直接复用），或明确退役并同批同步合同与 Skill。补一条"UI/MCP 导入 HTML→V10→保存重开"真实链证据。

### P2【数据错误/实施阻断】rename/reopen 续作 ENOENT 的真实修复文件无 owner（三个子代理独立命中）

- **计划位置**：§10（plan:291）分派"K0 权威路径、A0 生命周期、H1/X1 消费 saved 事实"；§6.3 X1 行（plan:179）。
- **源码证据**：真实失败链在 `main/workbench/execution/`——`ExecutionEngine.ts:600-601` 保存时记录 `SavedCourseIdentity.path`、`savedDocumentBinding.ts:20-30` 按 pathKey 匹配续作、`ExecutionDesktopService.ts:605-607` 失配后 open 旧路径 ENOENT；改名机器层在 `WorkspaceFiles.ts:269`、`workspaceFilesDesktopService.ts:189`（relocate）、`DocumentFileCoordinator.ts:11,70-80`、`lessonProjects.ts:21`。上述文件均不在 K0/A0/H1/X1 任一写域；前轮管线计划 P3b 曾正确圈定，本计划取代后丢失。
- **失败链**：该"已有真实失败"无 writer 可修 → 只能消费侧打补丁（改名后重开仍失败）→ 带病进入最终切换。
- **最小修正**：派发时把 `execution/{ExecutionEngine,ExecutionDesktopService,savedDocumentBinding,DocumentSaveEvents,continuationTargets}.ts` 与 rename 机器层四文件绑定给单一 owner（建议归 H1 扩展或 K0），其余三方保持现域。

### P3【实施阻断/硬边界】N10 旧 consumer 退出与 phaser 族无 owner（REV2 同病）

- **计划位置**：§8.7"旧 consumer 同切换退出"（plan:217）、§2.3、§13.5；旧计划 EXECUTION_PLAN.md:506 原有"I 最后清理残余"兜底条款，本计划删掉了。
- **源码/合同证据**：当前树仍存活且无主的旧 consumer——旧 Slide/Flow 后端约 16 文件（`course/v9Slide*`、`slideAuthoringBackend.ts`、`effectiveLayer*`、`globalLayerCommands.ts`、`store/{slideEditorProjection,v9LayerMutations,legacyEditorStoreKernel}.ts`、`slices/legacyFlowAuthoringSlice.ts`、`authoring/{flowTextEdit,flowOverlayAuthoring}.ts` 等）；`renderer/phaser/` 8 文件仍被 `crossSurfaceCommands.ts:6`、`v9LayerMutations.ts:27`、`slideEditorProjection.ts:14`、`InteractionEditor.tsx:31` 等活代码 import；旧 Player surfaces（`player/surfaces/{slide,flow,native,mixed,runtime}/**`、`CoursePlayer.ts`）；旧导出 `export/course/**` 16 文件；V9 contracts/driver/`core/tools/` 约 60 个模块；`precommitDynamicFallback.ts:90` 与 `CourseDocumentBridge.ts:231` 仍 `new CourseV9Driver()`。合同 §2.4 要求"新几何 owner 接管并同批退出 Phaser 主编辑路径"。
- **失败链**：最终切换时无人被授权删除这些文件 → 越域删除违反"仅写独占路径"，不删则 V9 工具仍经 ToolCatalog 触达、旧 CoursePlayer 仍可构建 → §13.5"旧 owner 随切换退出"不可判定，唯一几何 owner 硬边界无法达成。
- **最小修正**：恢复旧计划式残余清理兜底（K0/I 顺序清理）+ 按族退出映射（旧 Slide/Flow 后端→S0/F1 同批、phaser 族→G1/S0/W0、旧 Player surfaces→R1/R0、旧 export/course→X1–X4、V9 contracts/driver→K0、V9 tools→H1），并声明 legacy-inventory 锁。Owner：Root 修订，K0/I/A 执行。

### P4【实施阻断】系统性写域欠枚举：必改/必退出的共享文件无 owner（最大的一类，合并 7 个子代理的发现）

- **计划位置**：§5 K0 独占清单（plan:122-130）、§6 全部写域列；§5:134"派发时绑定真实文件"不足以兜底——这些不是可选叶子，而是变化合同的直接 consumer。
- **源码证据**（按目录，均经 Grep 反查 importer）：
  - K0 的 `courseV10Operations.ts` 签名一变即红的无主 consumer：`renderer/project/pptxImportTransaction.ts:4`、`recipes/applyRecipe.ts:6`、`authoring/backgroundPreview.ts:3`、`authoring/productivity/*`、`core/tools/componentImageApplication.ts:10`、`execution/ElementChangeTracker.ts:9`、`surfaces/flow/model.ts`。
  - 执行/MCP/AI 工具链无主：`main/workbench/execution/*`、`external/ExternalMcpService.ts`、`renderer/authoring/{tools,generation}/*`、`workbench/elementCards/*`（K0 动 capture/ToolTargets/ACK 即全部失配，H1 的"真实UI与MCP写同Session"证据条无法自证）。
  - `ui/flow/` 18 文件只列 2 个；`FlowBlockQuickActions.tsx`（§10 快捷栏修复落点）、`FlowMediaCropEditor/CaptionEditor`、`flowInsertCommands`、`surfaces/flow/{FlowSurface,model,readingAnchor,documentSelection}.ts` 无主。
  - `renderer/document/` 21 文件 16 无主（含 `fileDocumentResources.ts`、`flowRuntimeSpaceProjection.ts`、4 个 documentAdapter 直接 consumer）。
  - `store/slices/` 9 文件只分 4 个；`editorShellSlice/courseStructureSlice` 被 K0 的 `editorStore.ts:8,10` 直接注册、`slideOwnedCommands.ts` 经 `editorStore.ts:19` 再导出——无主。
  - `components/web/` 6 文件 3 无主：`resources.ts` 被 R0 与 R1 同时 import、`data.ts` 被 X0/P0/validateComponentData import、`authoredDocumentBootstrap.ts` 被 R0 import。
  - `renderer/runtime/*`（试运行内编辑，UI5/UI6 需要）与 `renderer/interactions/*`+`ui/InteractionEditor.tsx`（互动编辑）无主。
  - `renderer/media/{commitCourseMediaAuthoring,courseMediaLibraryImport}.ts` 媒体提交 helper 无主，被 A0/L0/F1 至少 6 方消费（含 V9 CourseProjectDocument 残留 import）。
  - X 系共享 helper 无主：`pptxShared/pptxTextAndShape/pptxTableAndChart/pptxShapeGeometry`（X2 的 style 缺口修复点）、`course/pdfPrintHtml.ts:15`（硬编码 `@page`，PDF 页型缺口的自然修复点）、`flowPrintPlan/flowDocxProjection/drawingMlShapeGeometry`（X3）、`exportSize/loadPlayerBundle/coursePackagePreflight`（X1）。
  - G1 独占的 `stageViewportTransform.ts`（531 行，027d→HEAD 未变）有 9+ 个无主 consumer（phaser/*、spatialEditorView、pptxTextAndShape 等）——G1 改签即构建红且无人能修。
  - 零散：`renderer/composition/*` 组合编辑族、`TeacherControllerAuthoringChrome.tsx`（API5 scope 直接 consumer）、`player/componentPlatform/{entry,index}.ts`、`player/surfaces/publishedCourseState.ts`、`chart/table editor.tsx`（D0 写"editor 归 N0"但 N0 未列）、`library/{archive,index}.ts`（L0 的 bytes 闭包载体不在 L0 域）、`builtin-source` 再生成步骤（D0 改源码后无人负责重跑生成器，运行时仍读旧 artifact）。
- **失败链**：合同/签名变化 → 无主 consumer 失配 → 单 writer 规则下无人能合法修 → 派发时停摆补手续、或被迫越域写入/复制 DTO（两者都被计划明文禁止）→ 滚动释放节奏崩溃。
- **最小修正**：派发前做一次文件级归位映射（把上述清单按消费关系并入 §6 各包写域或显式标"随旧 consumer 退出"），成本是一次计划修订，不需要新机制。Owner：Root/Astra。

### P5【协调阻断】旧 active 卡 9 锁与新写域全面碰撞，计划只要求"核对"未给处置

- **计划位置**：§13.1.1（plan:359）。
- **证据**：TASK_BOARD.md:11 `unified-mature-ui-authoring`（active）持 contracts-schema、store-kernel、store-slide、store-flow、workspace-shell、authoring-slide、authoring-flow、app-save-recovery、published-dynamic 九锁，逐一撞上 K0/F1/A0/S0/W0/C0/X1/R0/R1 主写域；WORKING_PROTOCOL:83 同一写锁只能属一个 active 任务。
- **失败链**：不释放旧锁，第二波全部 UI 包无法合法取锁开工，派发时必然停摆。
- **最小修正**：§13.1 补一句——B0 同批由 Root 将该卡标记被本计划取代、释放 9 锁并按 §6 重分配，E1 记录。Owner：Root/E1。

### P6【验证失真→数据错误】D0 互动答题组件丢失"运行答案不写作者工程"证据绑定

- **计划位置**：§6.2 D0 行（plan:171）"不逐组件全矩阵"；§9.2 六链（plan:261-268）；§12 L18→D0/R0/F0。
- **源码/合同证据**：原 L18（EXECUTION_PLAN.md:401-408）明确要求"运行答案不写作者工程、输入不抢导航键、核心分支实际点击"；ARCHITECTURE_CONTRACT.md:70/:165 钉定该属性。现六链中无任何一条断言它（UI5 的"play 不写作者 frame"仅指教师控制器）。
- **失败链**：input/choice 移植后类型/build/算法全绿 → 没有任何链实际作答 → 切换后教师试运行作答写回实例 data → 污染正式工程并落盘 → 用户数据错误且无证据能事前证伪。
- **最小修正**：混合样本须含至少一个答题组件；R0 共证链断言"试运行作答→回编辑后作者工程不变，undo/save/独立重开正确，文本输入不抢导航键"。Owner：Root 修订措辞；D0/R0 执行。

### P7【验证失真】L26/N09 混合样本无产出 owner（两个子代理独立命中）

- **计划位置**：§12 L26→"Z0＋E2/E3"；§6.2 R1 行"与 X1 共用一份混合样本"；§6.3 X0 行。
- **证据**：`tests/fixtures/`、`scripts/quality/component-platform/` 下无现成 V3 混合样本；§5 禁止多作者改同一测试文件；Z0 是最晚的文档包。原 L26 本是 Sol/high 实现任务（EXECUTION_PLAN.md:474-480），本计划把它降格为纯验证而无作者。
- **失败链**：R1/X0/X4 互相等待或各自造样 → §9.2"四格式分别实际打开一次"无输入 → 导出证据整块缺失或不可比对。
- **最小修正**：指派一个产出 owner（建议 X1 或恢复 L26 实现角色），任务专名落 fixtures，其余包只读消费。Owner：Root。

### P8【功能退化/验证失真】P0"不改通用 JSON"措辞歧义，按字面执行会固化 §1 自己点名的退化

- **计划位置**：§6.1 P0 行（plan:153）；对照 §1（plan:17）"专业属性控件曾被通用 JSON 字段替代"。
- **源码证据**：现树 `ComponentPropertiesEditor.tsx` 仅 75 行、对象/数组落裸 JSON textarea；`componentDefinitionPresentation.ts:13-19` 只映射 5 个内置 key；基线 027d 同文件是 307 行中文专业 PropertyField，`NodesTab.tsx` 由 719 行降至 384 行（分组渲染器 6 处→2 处）。
- **失败链**：执行者把"不改通用 JSON"读作"保留现有 JSON 控件"→ chart series/appearance 等字段维持裸 JSON → UI2"专业值↔画布"无法成立 → §4"不得降低操作能力"被架空。
- **最小修正**：改为明确指令——专业字段按 027d 控件恢复（读取端原位适配 V10，不重写控件），裸 JSON 只留无 schema 的真实边角并给诊断。Owner：Root/Astra 定恢复深度，P0 执行。

### P9【验证失真】§10 两条反例相对 HEAD 可能已过时或缺指针

- **计划位置**：§10（plan:294）"Spatial 通用创建 ports、Flow 图片快捷栏 unavailable"。
- **源码证据**：Flow 图片快捷栏替换链在 HEAD 已静态接通（`FlowBlockQuickActions.tsx:33-44`→`FlowWorkspace.tsx:256-259`→`App.tsx:756-757`→`commitCourseMediaAuthoring.ts`）；Spatial 创建门控在基线是"如实标 unavailable"（027d `ElementsTab.tsx:95-128`）、现树被删成全放行——两棵树缺陷形态相反，计划行文无法区分修哪一个，且 `ElementsTab.tsx`/`CourseLightToolbar.tsx`/`commitCourseMediaAuthoring.ts` 均无 owner。
- **失败链**：按过期反例派发 → 对已接通的链做无信息"修复"甚至回退可用实现（§9.3 禁止）；或无法定位真实入口。
- **最小修正**：派发前 E3 实机核实具体不可用入口并写入行内（文件+症状+修复方向），三文件绑定 owner（建议 ElementsTab/CourseLightToolbar 归 A0，媒体端口在 F1/L0 间指定唯一 owner）。Owner：Root。

### P10【验证失真】A0 最低证据链不覆盖本包三块实际改动面

- **计划位置**：§6.1 A0 行（plan:146）最低链仅"新建→编辑→Ctrl+S→关闭→重开"，保留行为却列了"切文档、草稿、文件目的地和媒体输入"。
- **源码证据**：媒体导入整链（`useMediaImport.ts:63-153`）不在任何 UI 链内；多文档 `drainAllCourseDocuments`（027d App.tsx:343,942-949）与未完成输入 flush（`beforeSave`/`preserveBeforeClose`）在最低链中零触达。
- **失败链**：接线把媒体捕获/drain/多文档切换接错也可"通过"A0 → 用户丢媒体插入或未提交正文，缺陷推迟到更晚链路暴露。
- **最小修正**：A0 最低链补两个条件（一次真实媒体导入；一次"未提交输入+Ctrl+S"与"切文档后落盘重开"），与现成 surface 链合并共证，不扩矩阵。Owner：Root 修订；A0/E3 执行。

### P11【功能退化，待取舍】单 HTML 双模式语义在 V10 导出路径丢失

- **计划位置**：§6.3 X0/X1 行均未提及。
- **源码证据**：成熟 UI 有 offline-portable/online-lightweight 两模式（`ExportMenu.tsx:46,50`）；`useCourseDelivery.ts:107` 收下 mode 但从未传入构建，`core/publish/componentPlatform/` 内无 mode 概念。
- **失败链**：按现 V10 代码接线 →"在线轻量"模式静默失效 → 与 §1"保留交付流程"冲突。
- **最小修正**：X1 行补一句"双模式保全或明确产品取舍"。Owner：Root/Astra 取舍，X0/X1 执行。

### P12【进度/协调，中低】验证串行瓶颈与三处执行口径

- **E 角色串行**（§5 plan:114-118、§8.6）：约 20 包 × 6 链 + 独立重开 + 4 格式实际打开全部经单一 E3/E2，21 槽容量下未允许多实例。修正：明文允许"同一 E 角色多实例按固定 cut/UI 链分区并行"，或明文接受验证为关键路径。
- **首链范围未标可选**（§8.5）："复制（C0）"与"R0"把 L0/F0、Q1/M1/T0/R1-nav 两棵子树拉进首真实 Main，闭包约 14 包。依赖边本身属实、非人为门，但建议写明首链范围可裁剪（去掉复制/运行可先达首 Main），避免派发时被当成固定前置。
- **Sol 分级无判据**（§5 plan:113）：全文无 medium/high/xhigh 划分标准，错配时无调整依据。补三行判据（耦合面/ACK 深度/验证链长度）即可。
- **E1"可恢复 Git 切片"机制未钉**（§2.2 plan:37）：Luna 只能执行确定动作，切片形态（侧分支/bundle/路径）必须在 B0 派发时给定。

### P13【轻微】IME 现场抽查无时间锚点

§9.2（plan:272）如实安排"自动支路+Owner 抽查、不伪造通过"，与完成定义衔接成立；但 §8.7/§13.5 均未把抽查列为切换前事项，理论上可到切换日仍未观察。修正：§8.7 加半句"最终切换前完成已记录的 IME 抽查，或明确移交 Owner 接受门"。

---

## 必须修正项（派发前）

按优先级，全部是计划修订级改动，无路线变更：

1. **P4 写域归位映射**：对约 50–60 个无主文件逐一点名 owner 或标"随旧 consumer 退出"（含 P1/P2 的文件绑定）。
2. **P1 HTML 导入**：接管（H0/H1 扩域 + 一条导入真实链）或明确退役并同步合同/Skill。
3. **P3 N10 退出**：恢复残余清理兜底 owner + 按族退出映射（含 phaser 族，满足合同 §2.4）。
4. **P5 旧卡 9 锁**：§13.1 补"取代旧卡、释放锁"步骤。
5. **P6 答题组件证据绑定**：混合样本含答题组件 + R0 链断言工程不被运行答案污染。
6. **P7 混合样本产出 owner**。
7. **P8 P0 措辞改为明确恢复指令**。
8. **P9 §10 两条反例实机核实 + 文件/症状指针 + owner**。
9. **P10 A0 最低链补媒体导入与未提交输入两条件**；**P11 单 HTML 双模式取舍一句话**。

## 修正后首条真实用户链的关键依赖顺序

1. **派发前置**：P5 放锁 + P4 归位映射中首链相关部分（Slide 几何主链、slices 余量、ui/flow 与 document/ 余量、media helper、components/web）+ E1 切片机制钉定（P12）。
2. **B0**：E1 核对冻结材料并切片 → 从 027d 建独立承载 → E3 在原版实例做一次 UI1–6 参照（全部"恢复成熟行为"断言的证据基线，先于一切 UI 改动）。
3. **K0 分片**（五端口，I/Astra 独占）‖ 并行纯叶：G1 几何、F0 PM 异步 ACK 协议、T0 纯 UI、D0 叶、Q1 compiler、R1 导航小片、M0/M1。
4. **S0/N0/P0** 在 K0+G1 就绪后接线（S0 先承接 slide barrel 与 coursePlayerTryRun/controllerDisplayBounds 归位）。
5. **R0**（K0+Q1+M1+T0+R1 导航小片就绪后）。
6. **A0 首真实 Main**：新建→编辑→属性→undo→Ctrl+S→正常关闭→独立重开，外加 P10 的媒体导入与未提交输入两条件；若先裁剪掉复制/运行（C0/R0 子树），首 Main 可显著提前——建议计划中把此标为可选。
7. **F1/W0 就绪即并入同一 V10 文档**；随后 C0/L0/Q0/Q2/H0/H1（含 P1 导入链）/X0→R1→X1–X4（依赖 P7 样本先行）；最终按 P3 完成旧 consumer 退出后切换。

## 核查局限

- 027d 基线侧少量对照（如 SlidePhaserNode 在基线的确切形态、无主文件在基线中的对应物名称）标为"待确认"，不影响上述发现成立——它们在当前树的 import 事实均已直接核实。
- Flow 快捷栏替换链与 Spatial 创建端口的**实机可用性**未验证（本轮只读，不运行应用）；P9 正是要求派发前补这一步。
- 计划 §10 已如实列出的已知待修产品缺陷（Flow Max-depth、clipboard ACK 增量等）按计划登记处理，未计入本报告的计划缺陷。
