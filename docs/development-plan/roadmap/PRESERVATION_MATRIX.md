# 不可降级产品行为矩阵

本文固定 1.1→2.0 路线必须持续保留的当前产品行为。它与[当前开发总纲](../../../COURSEWARE_DEVELOPMENT_PLAN.md)、[架构合同](../ARCHITECTURE_CONTRACT.md)和[工作协议](../WORKING_PROTOCOL.md)共同使用；路线任务必须在规格中引用受影响的 `PM-*` 行。

## 使用规则

1. “最低有效证据”是该行为受改动时至少要保留或重新取得的最近层证据。未改变实现、依赖、验证定义和关键环境时，可按工作协议复用既有通过证据；发生相关变化时才重跑。
2. 结构测试不能替代可见行为，快照或 Hash 不能替代交互、保存重开和真实导出。表中标注人工检查的行，自动化最多给出 engineering candidate，固定候选仍需 Owner 实际查看或操作。
3. 任一任务若无法保持对应行，必须停止并回滚到上一个可运行点；不得删除入口、删除测试、改弱断言、吞掉错误、改成 no-op 或用静态占位制造通过。
4. 本矩阵只描述已经实现并被当前候选接受的行为，不把未来 Table、Chart、AI 或新发布制品提前写成已实现能力。每个版本发布节点必须把本版实际交付的用户行为、正式 producer/consumer 和命名验证晋升为新的稳定 `PM-*` 行；下一版本从晋升后的矩阵出发，不重新维护第二份保全表。
5. 普通任务只引用并重验受影响行；版本候选检查所有新增/受影响行与结构棘轮，不要求无关 PM 行在输入未变时重复执行。

## 行为矩阵

| ID | 当前必须保留的行为 | 最低有效证据 | 禁止的降级方式 |
|---|---|---|---|
| PM-01 | 桌面核心 UI 可启动；新建、打开、最近工程、元素浏览、属性区可用；简洁/专业模式和专业开发工作台仍按权限面呈现。 | `npm run test -- tests/unit/simpleEditorMode.test.tsx tests/unit/developerMode.test.tsx tests/unit/editorActionRouting.test.ts`；涉及真实桌面 wiring 时复用或运行 `npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts`，并人工确认主要入口可见且可操作。 | 不得隐藏或删除人工编辑入口来减少迁移面；不得让专业能力泄漏到简洁模式，也不得让开发工作台变成无动作占位。 |
| PM-02 | Course Project V9 是唯一当前作者工程；严格 Schema 拒绝未知字段，稳定 ID、Runtime/Component discriminator 和版本语义不变；V8、未来版本与损坏包明确失败。 | `npm run test -- tests/unit/courseProjectCoreContract.test.ts tests/unit/courseProjectArchive.test.ts tests/unit/projectFormatIsolation.test.ts`。 | 不得创建 V10、宽松 passthrough 或 silent fallback；不得通过重新开放 V8 导入、丢弃未知内容或伪装成 V9 来清零旧代码。 |
| PM-03 | Slide Surface 可创建场景、选择/命中、插入、编辑、复制粘贴、删除、重排、导航，并保留当前画布与属性行为。 | `npm run test -- tests/unit/v9SlideProductIntegration.test.tsx tests/unit/v9SlideActionCommands.test.ts tests/unit/v9SlideViewportAdapter.test.ts`；画布交互改动再运行 `npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts`。 | 不得把 Slide 只保留为只读 Player 输入；不得用静态截图代替选择、编辑、动画或命令历史。 |
| PM-04 | Flow Surface 保留语义正文块、富文本、媒体、公式、浮层、纸张设置、正文/浮层转换、目录导航及保存重开。 | `npm run test -- tests/unit/flowProductIntegration.test.tsx tests/unit/flowEditorCommands.test.ts tests/unit/flowUnifiedLayers.test.tsx`；真实编辑/Player 改动再运行 `npm run test:e2e -- tests/e2e/stabilizationFlowAuthoring.spec.ts`。 | 不得把 Flow 正文投影成 generic layer、纯文本或 Slide；不得删除块级编辑、浮层或目录行为来简化迁移。 |
| PM-05 | Spatial Surface 保留无限画布、world owner、camera、path、relation、semantic navigation、全局/Surface/world 图层选择及保存重开。 | `npm run test -- tests/unit/spatialProductIntegration.test.tsx tests/unit/spatialCameraCommands.test.ts tests/unit/spatialPathPipeline.test.ts`。 | 不得裁成固定 1280×720 Slide、丢弃镜头/路径/关系，或把 world item 写入错误 owner。 |
| PM-06 | Mixed 课程按课程顺序跨 Slide、Flow、Spatial 导航；切换失败可恢复，跨 Surface 仍只有一个 canonical history。 | `npm run test -- tests/integration/mixedCrossSurfaceHistory.test.tsx tests/unit/mixedCourseNavigatorBeforeNavigate.test.ts tests/unit/courseProjectRoundTrip.test.ts`；整课改动再运行 `npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts`。 | 不得把 Mixed 拆成互不一致的工程/Store/History，不得跳过失败 Surface、重排课程顺序或在失败后留下半切换状态。 |
| PM-07 | Text、Formula、Image、Video、Shape 等现有 Native 内容继续可创建、编辑、渲染、保存和进入适用 Player/导出。 | `npx vitest run tests/unit/v9SlideContentCommands.test.ts tests/unit/formulaNode.test.ts tests/unit/coursePptxExport.test.ts tests/unit/publishedInteractionController.test.ts tests/integration/publishedInteractionSlideHostIntegration.test.ts`。 | 不得因移除旧 Scene 类型而删掉 discriminator、丢样式/布局/动画，或把可编辑 Native 静态化为图片。 |
| PM-08 | global、Surface、Scene/world/Flow 浮层的存储 owner、Underlay/Overlay plane、稳定 order、命名状态 override 与可见合成保持确定。 | `npm run test -- tests/unit/courseLayerComposition.test.ts tests/unit/globalLayerUi.test.tsx tests/unit/sceneStateUi.test.tsx`。 | 不得展平 owner、忽略 plane 或命名状态，不得用 DOM z-index 等同作者稀疏 order，也不得在读取时回写持久化数据。 |
| PM-09 | 声明式互动、课程状态、导航守卫和教师控制器跨 Surface 工作；拒绝或异常导航零错写，控制器权限不泄漏给公共导航。 | `npm run test -- tests/unit/interactionAuthoringCommands.test.ts tests/unit/courseStateStore.test.ts tests/integration/teacherControllerMixedSession.test.ts tests/unit/mixedCourseNavigatorBeforeNavigate.test.ts`。 | 不得把互动预计算成静态答案、绕过 guard、复制第二 CourseState，或让教师控制器失败后仍报告成功。 |
| PM-10 | 新建、打开、保存、另存为、dirty 提示、焦点草稿提交和保存后重开保持正确；并发编辑期间只确认实际落盘修订。 | `npm run test -- tests/unit/courseDraftPersistence.test.ts tests/integration/draftSaveTransaction.test.tsx tests/unit/courseProjectIo.test.ts`；真实键盘/文件流改动再运行 `npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts`。 | 不得在磁盘写失败或较新草稿出现时清 dirty，不得让 Save As 覆盖原文件，也不得靠丢弃活动编辑器内容完成保存。 |
| PM-11 | Recovery 仅写 V9 恢复副本；连续编辑合并到最新修订，过期写入取消；启动时能恢复或明确丢弃，不接受 V8/未来版本副本。 | `npm run test -- tests/unit/recoveryWriteCoordinator.test.ts tests/unit/projectFormatIsolation.test.ts tests/unit/productArchiveTimezone.test.ts`。 | 不得让过期异步结果覆盖新恢复副本，不得把取消当成功或把恢复数据悄悄并入错误工程。 |
| PM-12 | Undo/Redo 覆盖 Native、Flow、Spatial、互动、Runtime/Component 和资源 sidecar；一次用户原子操作形成一个历史步，分支清 future，stale 写入为零。 | `npm run test -- tests/unit/historyResourceChanges.test.ts tests/unit/crossSurfaceResourceHistory.test.ts tests/integration/mixedCrossSurfaceHistory.test.tsx`。 | 不得建立第二 History、只撤文档不撤资源、通过清空历史掩盖迁移，或让一次命令产生不可解释的多步。 |
| PM-13 | 素材导入、引用、替换、缺失字节修复和资源历史保持 project-scoped、目标稳定、可撤销并可保存重开；冲突或 stale 零写入。 | `npm run test -- tests/integration/courseMediaLibraryImportVerticalSlice.test.ts tests/integration/imageReplacementVerticalSlice.test.ts tests/unit/assetReferences.test.ts`。 | 不得覆盖同 ID 不同字节、把素材状态移出事务、遗失 Published closure，或以静态占位代替实际素材。 |
| PM-14 | Component API 4 包可导入、校验、实例化、替换、回滚和保存重开；版本/作用域/manifest 不兼容时明确拒绝，现有可信宿主能力保留。 | `npx vitest run tests/unit/componentProtocolV4.test.ts tests/unit/courseComponentPackageTransactions.test.ts tests/integration/courseComponentPackageReplacementVerticalSlice.test.ts`。 | 不得把所有包压成单一 component ID、跳过 package 校验、直接改第三方源码，或在替换失败后保留旧画面却返回成功。 |
| PM-15 | Runtime API 2/3 的源码、模板、内容/属性 authoring、素材事务、pause/visibility/resize 生命周期和全局/Surface owner 保持可用。 | `npx vitest run tests/unit/runtimeTemplateLifecycleIntegration.test.ts tests/unit/runtimeHostV2.test.ts tests/unit/publishedRuntimeAuthoringMounts.test.ts tests/unit/publishedGlobalCanvasRuntimeOwnerLifecycleIsolation.test.ts tests/integration/publishedRuntimeSlideHostIntegration.test.ts tests/integration/courseRuntimeAssetReplacementVerticalSlice.test.ts tests/integration/runtimePropertyAuthoringVerticalSlice.test.tsx tests/integration/runtimeContentTextAuthoringVerticalSlice.test.tsx tests/integration/courseRuntimeSourceAuthoringVerticalSlice.test.tsx`。 | 不得删去真实 Runtime consumer、降成静态图片、建立独立 Store/Session，或在生命周期失败后继续使用未隔离旧实例。 |
| PM-16 | 已审核可信 Runtime/Component 的正式宿主范围与精确 `network.connectOrigins` 能力保持一致；预览和 Published 只租用声明 origin，仍不暴露 Provider Secret、原始 Electron Main 或任意 OS 命令。 | `npm run test -- tests/unit/previewNetworkPolicy.test.ts tests/unit/courseProjectCoreContract.test.ts tests/unit/coursePackageExport.test.ts`。 | 不得把 opaque-origin 当永久权限边界或全面禁网来规避迁移；也不得借“不降级”向扩展新增 Secret、主进程或未声明网络能力。 |
| PM-17 | 当前页试运行使用当前 V9/Published 数据、当前 location/state、实际本地素材和声明网络；挂载、尺寸适配、失败反馈和销毁可观察。 | `npm run test -- tests/unit/coursePlayerTryRunFit.test.ts tests/unit/tryRunLocationMode.test.ts tests/unit/spatialLocationTryRun.test.ts`。 | 不得改成与作者状态脱节的静态快照，不得吞掉无来源/挂载失败，也不得泄漏上一次试运行 Session。 |
| PM-18 | 整课预览和 Published Course V2 Player 保留 Slide/Flow/Spatial/Mixed 顺序、状态、互动、Component/Runtime、前后导航与可见失败。 | `npm run test -- tests/unit/publishedCourseProtocol.test.ts tests/unit/publishedCourseNavigation.test.ts tests/integration/publishedRuntimeSlideHostIntegration.test.ts`；真实 Player 交互再运行 `npm run test:e2e -- tests/e2e/sampleV9.spec.ts`。 | 不得让 Player 接受旧 ExportPayload、丢 Surface、静态化互动，或用部分成功掩盖宿主/素材失败。 |
| PM-19 | 离线便携单 HTML 内嵌 Player、字体、工程内素材、Component/Runtime 依赖，无网络仍能打开和互动。 | `npm run test -- tests/unit/coursePackageExport.test.ts tests/unit/offlineRemoteUrlAssertion.test.ts`；固定制品再运行 `npm run test:e2e -- tests/e2e/sampleV9.spec.ts`。 | 不得把远程 URL 留在离线制品、把离线与在线模式合并、删除动态载体，或仅验证 HTML 字符串存在。 |
| PM-20 | 在线轻量单 HTML 保留已声明的精确 HTTPS/WSS 远程依赖，生成匹配 CSP；未声明、wildcard、带凭据或不安全地址在产物前失败。 | `npm run test -- tests/unit/coursePackageExport.test.ts` 与 `npm run test:e2e -- tests/e2e/publishedOnlineSingleHtml.spec.ts`。 | 不得静默扩宽 `connect-src`、把未声明地址塞入制品，或谎称在线轻量文件可完全离线。 |
| PM-21 | Web Package 生成可离线解压的安全 ZIP，Player 与发布数据引用包内相对路径，资源闭包完整且路径不能越过包根。 | `npx vitest run tests/unit/coursePackageExport.test.ts`。 | 不得退化成依赖开发服务器的目录、写入路径穿越条目、遗漏素材，或用单 HTML 冒充 Web Package。 |
| PM-22 | PPTX 从 Published V2 页列表生成；受支持文字、图形、图片保持适用可编辑表达，Spatial 使用镜头视口，unsupported/static fallback 有中文报告。 | `npm run test -- tests/unit/coursePptxExport.test.ts tests/unit/renderPptxComponentSnapshots.test.ts tests/unit/renderPptxRuntimeSnapshots.test.ts`。 | 不得恢复旧 V8 Slide 分支、把整课无说明地栅格化、裁错 Spatial，或省略静态化/素材缺失警告。 |
| PM-23 | PDF 对 Slide、Flow、Spatial、Mixed 生成覆盖完整的 Published V2 打印输入；缺页或 source 消失时 fail closed，不回退旧 V8 raster。 | `npm run test -- tests/unit/coursePrintArtifacts.test.ts tests/integration/coursePdfExportApp.test.tsx tests/unit/playerCapture.test.ts`。 | 不得在缺页时仍称导出成功、恢复旧投影快照，或悄悄跳过 Surface/场景。 |
| PM-24 | Flow DOCX 从语义正文生成可编辑 Word 讲义，保留适用富文本/表格/素材并报告遗漏；非 Flow 或无正文时明确不可用。 | `npm run test -- tests/unit/coursePrintArtifacts.test.ts tests/unit/flowRuntimeToc.test.ts tests/unit/batchFileDialogs.test.ts`。 | 不得把 Flow 截图塞入 DOCX、导出运行态目录抽屉/浮层为正文，或从 UI 删除 DOCX 来缩小路线。 |
| PM-25 | GUI Project Health、导出预检、定位/保存报告、CLI 诊断使用稳定 code/target 和诚实严重度；阻断项不可继续，CLI 非法工程返回稳定非零退出。 | `npm run test -- tests/unit/courseProjectValidationDiagnostics.test.ts tests/unit/exportPreflightUi.test.tsx tests/unit/validateProject.test.ts`。 | 不得拆成互相矛盾的诊断真相、吞错降级为 warning、让 invalid 输入退出 0，或只输出无法定位的自由文本。 |
| PM-26 | V9 `.h5lesson` archive 对 Schema、素材字节和 Component 文件原样 round-trip；无界面校验只读输入并输出机器可读报告。 | `npm run test -- tests/unit/courseProjectArchive.test.ts tests/unit/courseProjectRoundTrip.test.ts tests/unit/validateProject.test.ts`。 | 不得改变 wire、丢 sidecar、写回被校验文件，或借迁移任务重新接受 V8 作者工程。 |
| PM-27 | 外部 Builder 可在非 Git 普通课例目录经产品 Facade 调用真实 V9 工厂/命令，生成 `.h5lesson` 与离线 HTML；Builder Skill 不要求静态导入编辑器内部路径。 | `npm run test -- tests/unit/coursewareCaseBuilder.test.ts tests/unit/coursewareAuthoringRunner.test.ts tests/unit/coursewareSkillsContract.test.ts`。 | 不得恢复不存在的 `agent-kit` CLI、把内部 module bag 扩散给课例、要求教师切到产品仓库，或只生成不可编辑 HTML。 |
| PM-28 | Capability Index、合同与生成示例和当前协议/源码一致，生成/check 字节确定；stale、缺失和额外文件均非成功。 | `npm run check:ai-capabilities` 与 `npm run test -- tests/unit/aiCapabilities.test.ts tests/unit/exampleGenerationBoundary.test.ts`。 | 不得手改生成制品、忽略 stale provenance、删掉真实能力条目来通过体积门，或把 internal/reserved 接口宣称为可用工作流。 |
| PM-29 | Flow 文字就地编辑中，非空真实选区可通过能取得焦点的原生控件设置字体、字号和局部格式；折叠插入点可设置仅属当前会话的待输入样式，只在随后输入时物化为非空 run。结果在 Undo/Redo、保存重开、当前位置试运行、整课 Player、单 HTML、Flow 语义打印与 DOCX 中读取同一持久化 runs。 | `npm run test:product -- tests/unit/flowBlockContextToolbar.test.tsx tests/unit/flowInlineTextEditor.test.tsx tests/unit/flowEditorCommands.test.ts tests/unit/coursePrintArtifacts.test.ts`；`npm run test:e2e -- tests/e2e/stabilizationFlowAuthoring.spec.ts`；发布候选执行 `npm run verify`。 | 不得阻止原生字体/字号控件取得焦点、在 caret 处禁用格式、持久化 pending style、生成零长度 run、让选区漂移或被过期草稿覆盖，也不得在 contenteditable 提取或 delivery 投影中丢弃字体/字号 runs。 |

## 1.1 删除准入补充

Legacy 删除只能以现有[唯一消费者台账](../inventories/legacy-consumers.json)为事实源，并遵守“先交付等价 V9/Published consumer，再删除旧 consumer”。每个 1.1 规格必须列出受影响的矩阵 ID、最近层检查、停止条件与回滚点。单纯的符号归零、模块删除或全量测试绿灯，均不能替代本矩阵对应的行为证据。

## S1 已签署的增量行为

Owner 的 2026-09-06 整体验收见 [S1 记录](../acceptance/S1-authoring.md)。以下只晋升 1.2–1.3；1.4 工具与 1.5 材料另见下方 S2 晋升。

| ID | 当前必须保留的行为 | 最低有效证据 | 禁止的降级方式 |
| --- | --- | --- | --- |
| PM-30 | 六种 Recipe 展开为普通 V9；选择反馈、逐步揭示、分类及真实 Component 排序可连续操作；参考页克隆重映射本地身份并保留外部跳转；批量替换与项目色先预览后一次提交。 | `tests/unit/recipes.test.ts`、`tests/unit/productivity.test.tsx` 与 1.3 复核中的真实连续操作。 | 不得持久化隐藏 Recipe DSL、把排序改成分类、按同名状态误改外部导航，或跳过 preview revision。 |
| PM-31 | Flow 正文与 Spatial world 可创作五类 Chart 和 Table；三 Surface 共用内容操作，编辑、历史、保存重开、Player / HTML 保留数据；Flow DOCX 表格可编辑，图表图面及 Spatial 相机页明确静态。 | `tests/unit/crossSurfaceTableDelivery.test.ts`、`tests/unit/v9TableCommands.test.ts` 及 `tests/e2e/stabilizationCoreUsability.spec.ts`；真实图表 DOCX 证据见 1.3 复核。 | 不得用截图替代作者数据、丢正文顺序，或把支持范围扩至未批准的 shared / global / input。 |
| PM-32 | Chart、Table、Component 与共用 Native 文字控件的合法活动草稿参与 dirty、保存准备和恢复；不失焦保存可重开，取消 / IME / stale 不误写，一次作者操作对应一次历史。 | `tests/unit/courseDraftPersistence.test.ts`、`tests/unit/chartCanvasDraft.test.tsx` 及桌面“活动文字草稿：Slide、Spatial、Flow 不失焦保存并可重开”。 | 不得只在 blur 保存、用播放临时状态代替作者属性持久化，或恢复时改写当前活跃历史。 |
| PM-33 | Flow 原生文字 / 图片 / 图形浮层进入连续 DOCX；Slide input 原子写答案和有效性后求规则；六 owner 背景与连续调色遵循唯一有效值解析。 | 1.2 修复复核中的命名用例、`tests/unit/effectiveBackground.test.ts`、`tests/unit/courseBackgroundCommands.test.ts` 和真实桌面 Flow / ownership 回归。 | 不得混淆 viewport 浮层与正文，重复导出普通浮层，拆分 input 双键提交或重建第二套背景继承。 |

## S2 已签署的增量行为

Owner 于2026-09-06接受当前1.4–1.5范围，见[S2记录](../acceptance/S2-tools-and-materials.md)。PPTX真实样本仍有67次复杂内容遗漏；签署不扩大支持范围，不声称逐项人工测试全绿。下列证据在相关实现、依赖、fixture、验证定义或关键环境变化时才失效。

| ID | 当前必须保留的行为 | 最低有效证据 | 禁止的降级方式 |
| --- | --- | --- | --- |
| PM-34 | Authoring Facade 通过 canonical target / scope 和 revision 提交一次文档与资源事务；动态 Component/Runtime 经真实宿主准入，失败、超时与迟到结果零写入。 | `tests/unit/authoringSurfaceTools.test.ts` 与[1.4复核](../reviews/1.4-tools-builder-2026-09-06.md)中的动态浏览器准入及失败隔离证据。 | 不得开放私有写入口、复制第二历史、绕过真实宿主或将未支持的Spatial world Runtime描述为可用。 |
| PM-35 | Builder V2 经产品管理的 Chromium 会话调用同一工具，正式工厂创建工程，仅接受已登记finish结果；工程可重开，适用离线内容可连续操作。 | `tests/unit/coursewareCaseBuilder.test.ts`、`tests/unit/coursewareAuthoringRunner.test.ts` 与1.4复核中的真实CLI、archive和HTML纵切。 | 不得建立第二命令实现、接受未登记结果，或用mock声称动态宿主已通过。 |
| PM-36 | 材料缓存按projectId与规范化路径隔离；导入、搜索、可见引用和删除可用；Save As新身份不复制旧缓存，删除材料不删除已写入工程的引用。 | [1.5复核](../reviews/1.5-materials-content-2026-09-06.md)中材料事务与桌面材料库证据。 | 不得把缓存/trace写入工程或导出，跨工程串库，或删除已持久化正文引用。 |
| PM-37 | PPTX预览明示遗漏，经确认后原子导入可编辑普通图文、线条、分组、裁剪图、占位符与未合并表格；共享装饰按位置可见，整体Undo/Redo、保存重开与适用导出保持一致。有限正数小框可同步，源允许的自动扩框保留正文。 | `tests/unit/courseProjectArchive.test.ts`、`tests/unit/coursePptxExport.test.ts`、`tests/unit/playerAuthoringProtocol.test.ts` 与 `tests/e2e/stabilizationCoreUsability.spec.ts` 的母版/表格、线条和真实29页用例；本机原始样本不是仓库fixture。 | 不得静默丢普通受支持对象、混淆共享与实例owner、将取消/坏包/stale提交为成功，或恢复自动图片后备和外部渲染依赖。复杂对象继续明确提示，不承诺全保真。 |
| PM-38 | Remix从受支持普通Native参考页重映射身份并替换明确文字槽位，预览后单事务提交；内容QA只读返回四类带目标与依据的finding。 | `tests/unit/courseProjectArchive.test.ts`、`tests/unit/courseProjectHealth.test.ts` 及1.5复核中的PPTX/Remix与内容QA桌面证据。 | 不得复制隐藏动态状态、绕过缺槽/超长/stale检查，或由QA自动改写答案和正文、宣称任意学科正确性。 |

## 后续版本保全晋升

1.2–2.0 的 `release` 节点在签署候选前执行一次原子晋升：只把该版本已经通过人工/真实 carrier 验收的能力追加为稳定行，并记录最低有效证据、禁止降级方式和证据失效闭包。未完成、可选未采用或仅有 mock 的能力不得晋升。

同一 release 节点还必须证明四项轻量结构结果：没有新增 raw Store consumer；没有新增跨 Owner deep import 或运行时依赖环；没有第二 Store/History/Session/writer；没有复制已有 registry/catalog。证据落在现有 dependency ratchet、`FEATURE_CONSUMER_OWNER_LEDGER` 和最近层行为测试中，不建设独立治理平台。
