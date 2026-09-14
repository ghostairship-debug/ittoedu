# r18-common-tasks-v1

本目录冻结 [常规任务方案 5.1/5.2/7/8](../../../docs/development-plan/AI_COMMON_TASK_EXECUTION_PLAN.md) 的 60 项输入定义，**没有 AI 执行成绩**。完整原始指令、入口、必选变体、预期可观察结果、保持条件和前提均以 [definitions.ts](definitions.ts) 为单一来源；D/T/I 属 B1（1.8），其他任务保持 B2–B4（1.9）。所有变体通过才给该任务计 1 分，核心 20 项必过；当前缺包和其他阻断仍在分母。

`createR18TaskInput(task, variant)` 从三个已有 ARCH-0 档案加小型确定输入生成 V9 文档、素材字节与组件文件。固定新增目标均使用 `r18-任务号-角色`，并确实由 [fixtures.ts](fixtures.ts) 创建。`resolveR18VariantTargets` 按 owner、scene/state、Flow block 或浮层解析它们。目录不储存 60 份大型课件，也不提供另一套 AI 执行器或计分平台。

执行者从定义中选择待运行项，在独立 run 目录用现有 `createCourseProjectArchive` 保存返回的 `project/assetFiles/componentFiles`，将 `materials` 写成同名文件并通过既有材料入口准备；按 `locationId`/`targetIds` 建立 UI 上下文，使用软件内 Codex Luna/medium 与自动应用发送 `taskInstruction(task, variant)`。不得将测试生成器、ID 列表或 schema 说明作为补充工程提示发给模型。实际模型和服务档由原生记录确认，未知档位不得猜为 standard。

I01 的首要两个变体使用 **实际用户文件副本**：`C:/Users/74755/Documents/HTML课件编辑器/tests/fixtures/architecture-baseline/slide-heavy.h5lesson`，原失败会话 `19571d28-5daf-4929-a7f3-1be3bd0c2af6`，revision 1，`slide-intro-callout`（shape），`slide-location-intro` / `slide-state-base`。原始文本逐字为“帮我将这个形状替换为卡通小狗图片”。当前隔离副本已核实同样的工程、选区和状态；实际运行必须从上述 root 再只读复制，不能将其他新增 Surface 变体或简化夹具成功外推为原失败成功。新会话和固定只读前置轮后的连续会话分别记录。源路径、原指令、模型和选区不由 fixture 的新 ID 规则替换。

输入素材是真实图片、1 秒 PCM 音频和两个 320×180 的运动视频。PNG 由本目录两份 SVG 及固定 3200×1800 大图定义生成；SVG 为有两个 x 轴交点的抛物线、两个红点、细线、标签与透明背景，供换图、清晰度和原图语义编辑使用。视频是现有 Edge 的 Canvas/MediaRecorder 录制物（各约 4 KB），已由浏览器解码；`generate-media.mjs` 仅是显式重建素材的帮助脚本，不在测试中自动录制。声音和视频需在真实课件执行时另外证明实际播放。其他 ordinary 输入将 ARCH-0 的微型图片探针换为该图；I01 原始副本完全不做此预处理。

保留的缺口：

- C01–C05：当前 `component-catalog.snapshot.json` 只有拼音、朗读、图片框、文字容器四包。选择题、排序、拖拽、计时和单摆均标记 `missing-product-leaf`。固定题干/参数与载体不变，B3 补正式包再留存初始实例准备证据。C05 的文本锚点是规格，**不是伪造的实验实例**；缺包或缺实例不能计成功。
- Q02：输入故意缺少独占 `r18-missing` 素材字节。文档可以解析，资源闭包故意不成立；如果当前加载入口拒绝，记录“准备阶段产品阻断”，不能注入 Store 或先把图片补好再计时。它仍在分母。
- Q01：正文长文本、固定高度与临近图片是溢出检查输入。实际渲染需先记录每个 Surface 是否存在溢出；正常自适应的 Flow 正文可以报告无需修复，但不能把没有失败的变体冒称已修复。
- L04 的“已确认脚本”是固定场景前提，不代替真实教师确认或 S3。Q04 按固定格式分成离线 HTML、在线 HTML、Slide PPTX 与 Flow DOCX 变体，不把格式另计任务数。

聚焦定义检查：`npx vitest run tests/unit/r18CommonTaskDefinitions.test.ts`。它只证明 60 项/核心名单、载体边界、输入 Schema/精确目标/字节引用和素材基本解码；不证明任何自然语言任务首次正确、真实交互、保存重开、导出或教师接受。
