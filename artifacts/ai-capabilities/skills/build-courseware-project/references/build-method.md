# 构建方法与完整质量标准

映射载体、构建和体验 QA 时必须遵守 [main-progression.md](main-progression.md)：先证明控制器隐藏时的正文主路径，再验证控制器兜底。

以两份当前教学文件为体验真相，以 Capability Index 和源码为工程真相。交付可编辑 Course Project V9（`.h5lesson`）与离线 HTML；不得用旧聊天、旧课件或模板补写缺失内容。

仓库里**没有** `agent-kit/` CLI。不要运行 `courseware-agent-kit.mjs`，也不要虚构 `scaffold` / `graph` / `assemble` / `rig` / `validate --workspace`。

## 软件内 Builder V2 适用范围

软件内阶段任务只在当前产品窗口使用已注入的 Builder V2 `context`：读取 `api`、`documents`、`readAsset`、`encodeBase64`，通过 `api.createCourseProject` 创建工程，并用 `observe`、`createScope`、`execute`、`finish` 完成一次受宿主管理的构建。模块不导入编辑器内部路径，不使用 `Buffer`、`fs`、`process` 或 `require`；候选模块写入工作台指定的暂存路径，正式工程写入由宿主完成。

## 1. 冷启动

1. 直接读取 `01-teaching-plan.md`、`02-presentation-script.md` 和其中引用的材料。
2. 读取用户本轮约束；不继承被否决的设计和无关聊天摘要。
3. 把教师当前目录或明确指定目录作为**课例交付目录**；它可以是任意普通目录，不需要是 Git 仓库，也不得被切换成编辑器仓库。
4. 先运行 `node <skill目录>/scripts/resolve-editor-root.mjs`（确定性脚本，约 0.1 秒）获得 `editorRoot` 与 `capabilityIndex`；脚本失败时再按 [external-case-build.md](external-case-build.md) 的四级阶梯手工解析，并可用环境变量 `COURSEWARE_EDITOR_ROOT` 显式指定。然后读取返回的 `capabilityDiscovery`，按需查询完整能力；`index.json` 保留兼容读取。不要把定位产品依赖转嫁给教师。
5. 若两份文件缺失关键教学内容、表面选择或逐步操作，或实现必须改变教师可感知体验，返回 `$orchestrate-courseware`；不要猜。未确认的策划或脚本不得当作成品输入。

实现页面布局或修复视觉问题时读取 [page-design.md](page-design.md)；使用 PPT 原稿或检查已导入页面时读取 [ppt-import-review.md](ppt-import-review.md)。只读与本次任务有关的参考。

## 2. 发现能力

先读 `discovery.json`，按关键词、Surface、owner 与 carrier 查询，不通读整库。需要解释时再读 [current-capabilities.md](current-capabilities.md)。

```text
<editor-root>/artifacts/ai-capabilities/index.json
```

按查询打开它指向的 `schemas/`、`diagnostics.json`、`limits.json` 或组件快照。索引过期时用 `npm run check:ai-capabilities` 核对，不要手写一份对不上的 JSON。

只使用当前存在且适配需求的能力；计划中的能力不能冒充已发布。`surfaces.types` 为 `slide` / `flow` / `spatial-2d`，状态 `available`。Mixed 由同一工程里的 `locations` / `surfaces` 推导，**不要**写 `projectMode`。P8 已合入：三种表面的编辑与 CoursePlayer 试运行都能挂 Component API 4；缺包才静态后备。索引里 catalog 为空只表示本机没有外部组件目录，不表示宿主不能挂工程内嵌包。

<!-- lesson-authoring-shared:carrier:start -->
## 3. 载体所有权

对照脚本里的表面与「整页动态 / 局部互动」选择载体。Runtime/Component 的文字必须、普通可替换图片应当公开稳定作者目标。

1. **原生节点 + 声明式交互**：稳定文案、公式、图片、形状、视频、教师控制器；以及点击、显隐、切场景、播媒体等简单稳定行为。
2. **组件**：稍复杂的局部互动（拖拽、配对、本地多步控件）。先匹配工程已有包和（若目录可用）可导入包，能小改就复用；没有合适的就允许新建 Component API 4 包并嵌入本课。不要因为「只这一课用」而改用整页 Runtime 去仿一个控件。不要把空 catalog 当成禁止新建。
3. **场景 / 世界 Runtime**：整页或整块世界的动画、特效、连续耦合机制；尽量少放可教文字。不要把局部拖拽器做进场景 Runtime。
4. **无限画布**：脚本若要求空间漫游，运行态必须同时支持自由逛（会话平移/缩放，不写回工程）和镜头画面/路径巡游。手势与组件、Runtime、视频、教师控制器冲突时，被占用的交互优先。
5. **课程状态与导航守卫**：跨页的进度门槛（"完成本页练习才能进下一页"）。状态是课程级键值（boolean/number/string/null + 默认值）；守卫只有 `block` 一种效果——拦截并显示作者写的提示，不跳转、不执行代码。守卫只拦跨位置的 go/next/previous；重播不检查；重新开始绕过守卫并把状态重置为默认值；教师控制器操作可绕过（课堂接管是特性，不是缺陷）。Published `node.click` 的声明式窄切片可用 `course-state.exists` / `course-state.compare` 读取状态，并以同步 `course-state.set` 写状态；Runtime/Component 仍可通过 `ctx.courseState` 读写。当前没有判题结果自动分支或自动写状态桥。

脚本里任何「对/错/条件/按学生行为改变走向」的体验，动手前必须映射到三者之一，并可对索引核对：① `interactions.publishedPlayback` 声明的可执行切片；② 课程状态 + 导航守卫（由 `node.click` 的 `course-state.set` 或组件/Runtime 写状态）；③ 组件/Runtime 内部逻辑（为本课新建组件也算）。三者都装不下、或映射会改变教师可感知体验时，停止并返回 `$orchestrate-courseware`。不得写播放器不执行的交互种类交差。选 ③ 时逻辑进代码，教师改阈值就要再改代码：能用 ② 表达的门槛优先用 ②，并让组件把可调参数公开为可编辑内容。

分类与排序必须分开选载体：分类可用“选中项目→选中目标组”的声明式点击/状态路径；需要真实改变可见顺序的排序使用 Component，并公开项目、正确顺序与反馈参数。不要把排序降级成分类，也不要为它私自增加拖放/放置触发器或顺序动作。只有 Capability Index 已声明相应 Recipe 可用时才能直接选用计划中的 `classify-sort-v1`；否则按当前已有 Component 能力实现一次性课件组件。
<!-- lesson-authoring-shared:carrier:end -->

<!-- lesson-authoring-shared:mapping:start -->
## 4. 资产与任务图（动手前）

不要从空白一次写出整课。Coordinator 先在内部列出（不必给教师第三份合同文件；成功后删掉临时笔记）：

1. 资产：脚本引用了什么；哪些已在材料中；哪些可生成；哪些必须向教师要原件。
2. 逐段核对已确认呈现脚本，列出“片段 → 学生动作 → 可见反馈与恢复 → Surface / owner → carrier / tool”。没有互动的片段明确写静态；已约定互动不得省略或以说明文字替代。对每个实际使用的工具和 Recipe 先读当前完整能力卡的适用域、inputSchema、references 与示例，不能从旧印象补字段。
3. 执行顺序：为纵切准备的资产 → 最高风险真实片段 → 其余页 → 集成验证。
4. 资产生成失败或必须改体验时，停下来回编排改脚本，不用占位图把课做完。
<!-- lesson-authoring-shared:mapping:end -->

## 5. 用产品 API 写工程

权威工程是 `CourseProjectDocument`（`schemaVersion: 9`），不是 Agent Kit 语义 DSL，也不是 Project V8。

课例实现放在 `<case-dir>/implementation/build.ts`，由编辑器仓库的正式外部案例入口加载。新课例导出 `apiVersion = 2`，不得用相对路径、绝对路径或路径别名导入编辑器内部源码。从 `context.api.createCourseProject({ surfaceType, title })` 创建产品管理的浏览器工作会话；用 `observe()` 读取当前 scope 和少量 canonical targets、`activateScope()` 切换位置 / owner / 状态、`createScope()` 获取插入地址、`execute(tool, input, destination)` 提交正式工具调用。上述调用均须 await。 布局前读取 observe({includeContent:true})：surfaceGeometry 给出当前表面实际画布/排版/镜头事实，items 是原始可编辑内容，effectiveLayout 是当前 owner 对象应用当前状态后的外框、可见性与层序，componentDefinitions 给出对应组件正式尺寸与公开参数。按分页读取所需对象，依据这些事实安排外框并检查边界；组件内部文字与控件仍须真实呈现检查。每步检查 receipt，失败按 diagnostics 修正该工具输入；最终直接 `return await session.finish()`，不能修改返回文档或拼装输出对象。

工具清单由 `session.tools` 提供，输入以能力索引指向的正式工具 Schema 为准。新建 Native / Flow 内容、页面 / 状态 / 互动、Spatial 镜头 / 路径 / 关系、全局设置 / 背景 / 网络、Recipe、资源及 Component / Runtime 都经此 Facade。动态代码候选由产品自动完成 Published 闭包和真实宿主准入；模块不能传入成功标记或替换宿主。可参考仓库 `tests/fixtures/builder-v2-case/build.mjs` 的公开 API 用法；该示例共用单 context、encodeBase64、observe/activateScope 与 Flow content.inlines，具体工具输入仍以本轮完整卡为准。下列 Owner 源码仅用于能力定位，不能成为课例模块的 import。未标版本或 `apiVersion = 1` 的旧课例仍兼容旧工厂 Facade，入口会提示迁移；不再为新课例选择 V1。

从任意工作目录调用：

```text
npm --prefix <editor-root> run --silent build:courseware-case -- --case-dir <case-dir> --builder implementation/build.ts --project <case-relative-output.h5lesson> --html <case-relative-output.html>
```

两个输出路径都必须相对课例目录。只有明确要替换已有交付物时才追加 `--force`。入口在写文件前完成 V9 打包、保存重开、当前 `validate:course-project` 语义检查、Published V2 构建和离线 HTML 构建；失败时不得留下半套新交付物。不要再用 `npx tsx <case-dir>/implementation/build.ts` 直接执行，也不要在课例脚本中写 `../../../<editor-repo>/src/...`。

三种表面统一由 `api.createCourseProject({ surfaceType, title })` 选择；同一课通过 `course.navigation` 添加其它表面，仍属于同一个工程。正式工具与底层 Owner 的区别见 [current-capabilities.md](current-capabilities.md)，不要把源码工厂名当成 V2 的 `context.api` 方法。

`finish()` 只结束会话并返回受管结果；最终归档、校验与交付写入由 `build:courseware-case` 负责。静态检查通过仍不等于真实视觉与互动通过，交付证据按本文件 §9 取得。

若当前产品没有对应命令或宿主，停止并报告产品缺口，不自造影子 Project DSL。

## 6. 先做最高风险纵切

选择最可能推翻载体、视觉、互动、编辑或导出的最小真实片段。必须使用真实内容、真实 Player、真实作者目标和真实保存路径；占位机制不能证明方案成立。

试运行与整课预览走 CoursePlayer：`FlowSurfaceHost`、`SpatialSurfaceHost`、`SlidePublishedAdapter`。禁止把已删除的旧 Phaser 播放器接回 Mixed / Flow / Spatial 试运行。Phaser 只服务 Slide **编辑**命中。

纵切失败时修正底座或载体，再扩展；不要在错误机制上批量生成。

## 7. 增量构建与 Worker

Coordinator 是唯一能写权威 Project 和共享接口的人。小型强耦合课件由 Coordinator 分段完成。

仅当边界清楚且能独立验收时使用干净 Worker。每个 Worker 只得到：本单元脚本、共享视觉/接口简报、相关能力卡、输入输出路径和验收命令。Worker 输出独立模块或建议补丁，不直接改权威 Project，也不修改别的单元。

每合入一个单元就重跑受影响的最小验证；完成共享层后再做整课集成。动态代码保存在普通模块中；禁止在构建脚本里手写巨型 Runtime/Component 字符串。

<!-- lesson-authoring-shared:editable:start -->
## 8. 保持可编辑

合成顺序固定为**全局 Underlay → 当前 Surface 内容 → 全局 Overlay**；全局内容不能与本地内容任意交错。教师控制器是一份全局 Overlay，场景/世界编辑时 inert，不复制进 scene `layerItems`。Flow 正文是语义文档与一个正文合成边界，浮层按正文下方/上方编排；不要把每个段落当普通 z-order 图层。仅在所属平面与载体允许的范围内调整顺序。

稳定内容尽可能是 Native；动态载体公开可编辑内容、素材、关键参数和可选择区域。

首次构建后保留稳定 project/surface/scene/layerItem/binding ID。教师手工编辑后不得全量重建覆盖。定位目标只用跨保存稳定的 `authoringAddress`，不要用会话 `hitId`。

增量修改：打开工程、改稳定地址上的字段、保存。revision 冲突或地址失效时重新读取工程，不猜测合并。
<!-- lesson-authoring-shared:editable:end -->

正式编辑器入口是 `src/renderer/App.tsx`（不要写 `ProductApp`）。1.8 起普通内部生产构建显示创作助手与 CLI 聊天；具体能力仍以当前正式命令和已完成版本门为准。`courseAiHandoff` / `courseAiPatch` 是 internal/reserved、未挂载。不要把不存在的 `npm run current:course-selection` / `npm run patch:course-project` 写成工作流。

新课例用 V2 `session.tools` 中的正式工具；已有工程的 GUI/Store 入口只用于定位真实产品实现，不是外部课例的 API。不要为修订已存在的教师工程调用空白工厂再全量替换。

仍不要做：稿纸绕排/float；持久化 `projectMode`；打开或导入 V8 `.h5lesson`。外部组件 catalog 在索引里可为 `unavailable`；那只挡住「从目录挑现成包」，不挡住为本课新建或导入 `.h5component`。未过许可/维护人/质量门槛的目录包不要宣称为已发布内置库。

交互后返回编辑的当前画面是会话检查点，不自动写成默认答案；只有教师显式保存为命名状态时才持久化。无限画布运行态的平移/缩放同样只改会话相机，不写回 `camera.home`。

## 9. 验证与交付

运行 `validate:course-project`，并按 [validation-boundaries.md](validation-boundaries.md) 检查本课实际使用的行为、真实编辑保存重开、CoursePlayer、默认离线 HTML 和要求交付的其它格式。增量修改复用未受影响的证据；只补受影响的行为与必要回归，不因使用 Skill 默认跑全仓测试或所有导出格式。

<!-- lesson-authoring-shared:experience:start -->
工程检查通过后，逐项回看前述片段映射，确认每个已约定动作、反馈和恢复在产物中都有对应实现；不能以工具回执全部成功代替脚本内容完整。再由全新上下文做一次只读体验 QA。自动化最多 `engineering candidate`；具体课例未经真实视觉/互动复核不得称 `art candidate`；`accepted` 必须来自教师明确验收。不得宣称 Editor 1.0 已发布。
<!-- lesson-authoring-shared:experience:end -->

只保留两份教学 Markdown、真实 Project、默认 HTML 及用户要求的交付物。成功后清理 Worker 任务、临时副本、截图和中间报告。

## 停止条件

- 两份教学文件不一致或缺少必须由教师决定的内容；
- 当前能力不能实现且需要可感知降级；
- 载体内部文字、普通图片或关键参数无法满足约定的编辑性；
- 稳定地址、revision 或目标字段已经失效；
- 真实 Player、保存重开或交付格式缺少足够证据。

停止时说明最早应返回的阶段和最小缺口，不用下游代码掩盖问题。

### 软件内与外部 Builder V2 共用字节编码

V2 构建函数接收一个 `context` 参数（例如 `async function build({ api, documents, encodeBase64 })`）。用 `context.encodeBase64(value)` 编码字符串或 `Uint8Array`；字符串统一按 UTF-8。软件内模块在现有浏览器窗口执行，没有 `Buffer`、`fs`、`process` 或 `require`，需要读取课例字节时使用产品提供的 `context.readAsset(relativePath)`。不通过 Node 全局或另起构建进程绕过当前窗口。
