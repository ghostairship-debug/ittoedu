# IttoEdu 编辑器稳定化与模块解耦总纲

> 计划版本：13.1
>
> 初次激活日期：2026-08-24
>
> 审计吸收日期：2026-08-25
>
> 长期路线：稳定化、统一架构、渐进解耦、自动多智能体执行
>
> 产品 Owner 决策：当前版本不可用；稳定化不等待教师复核，教师 `accepted` 只保留为最终产品与发布结论。2026-08-24～25 深度审计确认的全部 P0/P1/P2、设计缺口、条件性合同能力与性能风险均进入本计划，不只处理 P0。

本文件是仓库唯一长期开发总纲。详细架构、知识索引、阶段任务、自动执行、验证与回滚协议统一位于 [docs/development-plan/](docs/development-plan/README.md)。历史计划、评估报告和 `docs/tasks/editor-1.0/**` 只作 Git 历史或冻结证据，不再派发任务。

本版完整吸收根目录 [Flow / Spatial / Mixed 产品深度审计](PRODUCT_DEEP_AUDIT_2026-08-24.md)。该审计继续作为复现步骤、源码依据和产品裁决证据，但不是第二份开发计划或任务状态表；后续实现状态仍只写入 Policy version 2 任务卡并由任务板生成。

权威顺序：

```text
用户当前明确决定
> 正式 Schema、合同与兼容策略
> 当前源码和可复现运行结果
> 本总纲
> docs/development-plan 详细执行文件
> 自动生成的 repo-index 与任务板
> 历史任务和评估材料
```

索引、计划或任务卡与源码冲突时，先修正索引或任务卡，不按过时文字强改代码。

---

## 1. 产品目标

目标不是继续增加功能数量，而是把已有能力变成真正可用、稳定、可维护的软件：

- 编辑结果可信：不会写错课件、错页面或错对象；
- 撤销、重做、保存、恢复和资源文件保持一致；
- Slide、Flow、Spatial 与 Mixed 往返稳定；
- 试运行、整课预览和各导出读取同一份课程事实；
- 高频能力直接可达，高级能力保留且可发现；
- 高频作者行为必须在真实 Chromium / Electron 中可完成，不能用 Schema、jsdom 或样式字符串通过代替真实选区、命中、布局和媒体结果；
- 所有公开控件、拖拽承诺和成功反馈必须对应真实 canonical 工程变化或真实可用能力；未接通时必须隐藏、禁用或明确说明，禁止静默 no-op、伪成功和底层校验 JSON 直出；
- 后续 Agent 能快速定位正确入口，不再反复全仓读取；
- 软件内部重复状态、重复路径和无消费者旧实现持续减少。

“做减法”的对象是软件复杂度，不是计划细节。详细计划继续保留，但一个事实只能有一个权威落点，状态和生成视图不得人工复制多份。

---

## 2. 当前产品与协议边界

- 作者工程：Course Project V9；仅支持 `schemaVersion: 9`。
- 发布：Published Course V2。
- Runtime：API 2 / Surface Runtime API 3。
- Component：API 4。
- Interaction：Protocol V1。
- V9 Schema 软冻结：已有字段、判别器和语义不得修改；additive 可选字段必须独立合同提交并保持 `.strict()`。
- 不恢复 V8 `.h5lesson` 导入，不借内部重构创建 V10。
- 当前编辑器内没有可见 AI、聊天、Provider 或网络调用；internal/reserved 接口不得被宣称为可用工作流。
- 自动化最多证明 engineering candidate；具体版本是否 `accepted`、是否发布仍由产品 Owner 明确决定。
- 教师控制器的持久化位置、尺寸、样式和按钮只在“全局层（全课）”编辑；Slide、Flow、Spatial 页面作者态只显示无命中预览，不可点选、聚焦、拖动或缩放，事件必须穿透到底层内容；试运行和正式运行中的拖动只改 Session。
- 当前稳定化不实现逐页、逐 `location`、逐 Flow block 或逐 Spatial camera 的控制器位置，也不复制多个控制器再靠显隐模拟。只有现有控制器缺陷全部关闭后仍出现新的教师证据，才重新走独立产品与 additive 合同评审。

`T0–T6`、`P1–P8`、`Q1–Q8`、`F1–F3`、`G0–G3` 已合入 `main`，不得重做。它们的任务卡现为历史证据。

本计划整合前的历史核查基线是 `main @ dbe518e`：产品源码基于父提交 `690411d`，同时 `dbe518e` 还刷新了三份 `artifacts/ai-capabilities/**` 生成物。外部组件目录在核查时可见 4 个实验包，但外部目录状态不是稳定源码事实。本段只解释计划来源，不代表当前 HEAD、当前阶段或待执行任务。

---

## 3. 统一架构的不变量

1. **一个可写工程真相**：所有持久化编辑最终只修改一个 `CourseProjectDocument`。
2. **恰好一个活动编辑会话**：正常产品生命周期中 Slide、Flow、Spatial 三种后端互斥激活，不为“无会话合法 V9”新造旁路。
3. **一次用户操作，一次逻辑提交**：文档、素材字节和组件资源同步进入一条撤销历史。
4. **延迟操作必须认原目标**：文件选择、导入、代码草稿和异步回调不能在切页后写入新页面。
5. **Surface 保留各自语义**：Slide 场景使用 LayerItem；Flow 正文使用 FlowBlock / FlowComponentBlock；Flow 浮层和 Spatial 世界使用各自正确载体。
6. **Preview/Player/Export 只读**：不得从 Player DOM、Canvas、Published payload 或投影反建作者工程。
7. **Core 不依赖具体 Surface**：跨模块动作由应用用例组合，公共入口只暴露窄 selector、command、hook、validator 和 port。
8. **不新增第二套 Store、Session、History 或持久化模式**。
9. **不以目录移动证明解耦**：只有责任、消费者和返工实际减少才算完成。
10. **已有教师能力不得缩水**：低频能力可以渐进披露，但必须可发现、可保存、可撤销。
11. **作者与交付的有效域必须闭合**：任何作者端允许提交和保存的状态，都必须被 Preview、统一画布、Published Player 和适用导出接受；不能再出现“V9 接受、下游拒绝”。
12. **公开入口必须诚实**：属性、复制、粘贴、重复、拖放和错误反馈要么真实改变唯一工程并进入正确历史，要么明确不可用；UI 状态和 toast 不得冒充提交成功。
13. **Surface 语义不可被统一层抹平**：Flow 正文保持文档流和内容顺序，只有真实浮层进入 z-order；Spatial 的 global / surface / world owner 与 viewport / world 坐标不得被通用命令暗中跨越。
14. **控制器作者范围唯一**：页面作者态 inert，全局层是唯一持久化编辑入口，运行态只写 Session；不得自动跳 scope 或新增逐页位置真相。

---

## 4. 目标模块

| 模块 | 负责 | 不负责 |
|---|---|---|
| Editor Core | 唯一工程数据、提交、历史、过期目标保护 | Surface 排版、具体选择、Feature UI |
| App / Persistence | 新建、打开、保存、恢复、文件与桌面边界 | Surface 命令、导出格式实现 |
| Slide | 场景、图层、状态、命中和局部属性 | 组件包和素材文件生命周期 |
| Flow | 正文块、稿纸排版、真实选区与稳定 caret、公式表格、内容大纲、文中媒体、IME、Flow 组件块 | 用通用 z-order 取代正文顺序，或复制 Slide 自由画布模型 |
| Spatial | 世界对象、镜头、路径、关系、owner-aware 选择/属性/复制与自由浏览 | 把运行态相机写回工程，或混用 viewport / world 坐标 |
| Media | 素材元数据、文件字节、导入和替换计划 | 决定各 Surface 的摆放方式 |
| Components | Catalog、工程包、实例资源和作者校验 | 绕过 Surface 创建错误载体 |
| Runtime / Interactions | Runtime、规则、模板、校验和运行边界 | 保存工程或让 Player 反写作者数据 |
| Global Layers / Controller | 全局层、Surface 共享层、有效顺序、全局层唯一控制器作者入口、页面 inert 预览、运行 Session | 复制成每个场景的普通对象，或维护逐页/逐 location 控制器位置 |
| Diagnostics | 结构、作者、导出和恢复诊断 | 实时改写工程 |
| Player / Preview / Export | 只读消费作者工程或 Published 数据 | 写入编辑 Store |
| UI Shell | 页面路由、工具栏、面板与错误反馈 | 领域命令和撤销实现 |
| Repo Knowledge | 开发导航、任务 Context Pack、依赖与验证映射 | 产品运行时能力 |

统一产品链：

```text
用户操作
→ Surface 或 Feature 命令
→ Editor Core 一次提交
→ 唯一工程数据 + 一条历史
→ 保存 / 预览 / 导出只读消费
```

---

## 5. 长期候选路线与状态入口

详细阶段合同见 [执行路线](docs/development-plan/30-execution/00_ROADMAP_AND_GATES.md)。编号使用 `ARCH-*`，不复用历史 P/T/Q/F/G。以下标题只界定候选问题域和依赖，不声明当前阶段；当前任务状态、已完成范围和下一可领取项只看自动生成的 [任务板](docs/development-plan/TASK_BOARD.md)。

### 2026-08-25 审计后稳定化再准入（全部纳入，非任务状态）

根目录深度审计已经使此前关于 Flow、Spatial、Mixed 的用户结果结论失效：既有 ARCH-0～5、V4 和代表工程结果继续作为当时的 pipeline / engineering 历史证据，但不得用来覆盖之后发现的真实用户阻断。修复完成后必须形成一个新的固定候选；在此之前，Flow 与 Spatial 只能称为 `engineering candidate`，Mixed 的常见 Spatial 作者链仍为 `unusable`，三者均不得恢复 `accepted`。

本节完整收录审计发现与处置方向，但不维护实现状态。每项实际工作必须拆成“一个用户行为”的 Policy version 2 任务卡，写入 `docs/development-plan/tasks/stabilization/**` 后再生成任务板；不得直接从审计报告或下表声称 `ready`、`in-progress` 或 `done`。

执行顺序按结果域约束，不按缺陷数量制造大 Epic：

| 顺序 | 必须得到的结果 | 纳入范围 |
|---|---|---|
| A | 恢复核心创建、文本编辑与 canonical 提交真实性 | `CTRL-05`、已确认页面 inert 语义、`MIX-01`、`FLOW-01 / FLOW-10`、`CROSS-04` |
| B | 修正控制器运行态、图层 owner、坐标与跨 Surface 历史 | `CTRL-01～04`、`MIX-02`、`SPATIAL-01～05` |
| C | 补齐 Flow 已公开的核心作者体验 | `FLOW-02～FLOW-09`、`FLOW-11`，以及图片/视频在当前合同内可完成的基础作者能力 |
| D | 统一跨模式承诺、上下文入口和可恢复错误 | `CROSS-01 / CROSS-02 / CROSS-03`、`SPATIAL-06` |
| E | 对合同能力与性能工作分别做独立准入 | `FLOW-12`、图片/视频需新增字段的部分、bundle / source map 性能风险 |

完整覆盖矩阵：

| 审计项 | 计划结果 | 准入与边界 |
|---|---|---|
| `CTRL-05`：控制器越界后统一画布失败 | 统一作者安全边界、`pointercancel` 零提交、旧数据重置；Flow→Slide、保存重开、统一画布和 Published Player 均可接受 | P0 首批；不关闭 V8 校验、不把 controls 改成 `none` |
| 页面控制器决策 / `CROSS-04` | Slide / Flow / Spatial 页面作者态不可点选、聚焦、拖动或缩放，事件穿透；只有全局层能持久化编辑 | 已由产品 Owner 确认；不自动跳全局层，不新增逐页位置 |
| `MIX-01`：第二个 world item 的有效 order 冲突 | 默认 Slide→新增 Spatial 后可连续插入不同 world item，保存重开后有效 order 仍唯一 | P0 首批；修分配单一事实源，不放宽 Schema |
| `FLOW-01`：鼠标不能拖选 | 真实 pointer drag 产生非空 Selection，格式只影响选区，IME 与撤销不回归 | P0 首批；真实 Chromium 行为，不只测逻辑 selection |
| `FLOW-10`：空块 caret 错位 | 空编辑根有稳定非零几何，caret 正确，首字符前后不跳 | 与 Flow 文本波次相邻、同热点串行；不新增文本模型 |
| `SPATIAL-03`：公开属性静默 no-op | 每个可见属性都真实修改 canonical 工程并进入一次历史；否则隐藏、禁用或明确不可用 | P1 首批；禁止只断言 UI 值或 toast |
| `SPATIAL-04`：复制/粘贴/重复伪成功 | duplicate / Ctrl+C/V/D 真实改变 Spatial 工程，ID、owner、选择和历史正确；失败时零写入 | P1 首批；App / Store 热点串行 |
| `SPATIAL-01 / SPATIAL-02`：插入路由和可见但不可选图层 | 当前可见且公开承诺的 owner/type 进入正确 carrier，可操作行具有真实可达选择和稳定 authoringAddress | 不为矩阵对称新增 surface scope；无真实入口时隐藏、只读或记录 skip |
| `MIX-02`：切 Surface 丢失撤销 | Spatial 编辑后切 Slide 再返回仍可 undo / redo 同一 canonical 工程；运行相机继续是 Session | 不新增第二套 History 或通用工作流状态机 |
| `SPATIAL-05`：跨 owner 拖放混用坐标 | 在没有可靠 world↔viewport 换算前禁止不安全拖放并解释原因；只有真实需求再实现换算 | P2；不预建通用坐标转换系统 |
| `CTRL-01`：折叠透明大命中区 | 折叠命中 footprint 接近可见胶囊，透明区域允许底层点击和 Spatial 画布手势 | 在默认折叠前完成 |
| `CTRL-02`：Flow TOC 裁走恢复入口 | TOC 开关后折叠入口始终留在 1280×720 安全区并可展开 | 不靠逐 Flow block 偏移补偿 |
| `CTRL-03`：Mixed 运行 Session 分裂 | 折叠状态跨 Surface 连续；位置按已确认的 Surface 运行 Session 保留；restart 完整重置且不写工程 | 不把运行 Session 变成作者数据 |
| `CTRL-04` 与默认折叠 | 作者态真实预览；只把新建和缺失后恢复的控制器默认折叠，保留现有工程显式值 | 依赖 `CTRL-01～05` 与页面 inert；不做覆盖式迁移 |
| `FLOW-11`：公式正文双击失效 | 首次点击重渲染后，第二次真实 click 仍稳定进入公式编辑，并有明确“编辑公式”入口 | 与行内公式合同分开，不用合成 dblclick 冒充用户行为 |
| `FLOW-02`：Paragraph 工具栏跳变 | 选中/编辑切换时主工具几何稳定、不遮挡目标；低频格式渐进披露 | 不把工具栏扩成常驻大面板 |
| `FLOW-06 / FLOW-09`：正文图层与定位术语混乱 | 侧栏明确拆分“内容/大纲”和“浮层”；正文按块顺序/嵌套管理，只有浮层进入 z-order；owner 与定位空间分开命名 | 不把 Flow 正文塞进 canvas 图层 |
| `FLOW-07 / FLOW-08`：富文本入口与选区状态不真实 | Properties / 工具栏反映 caret、range、整块和混合值；现有 runs 能力稳定可达 | 依赖 `FLOW-01`；禁止用第一个 run 冒充当前选区 |
| `FLOW-03`：媒体宽度伪差异 | 编辑器与 Player 的正文/较宽/全宽实际 bounding rect 可区分 | 测实际布局，不只断言 style 字符串 |
| `FLOW-04`：视频作者能力不足 | 先补当前合同内的预览、controls、替换和基础配置真实性 | poster、自动播放、循环、静音、起止时间等若需新字段，转入独立 additive 准入 |
| `FLOW-05`：图片作者能力不足 | 定义并补齐文档流图片的高频内容编辑与即时反馈 | 缺失字段单独走合同；不改成 Slide 自由节点 |
| `FLOW-12`：正文不能夹杂公式 | 独立评审 inline formula atom 的稳定 ID、AST、可访问文本及编辑/保存/Player/打印/PPTX 纵切 | 正式纳入计划但保持 `additive-exception / product-decision`，不得与 `FLOW-11` 或通用编辑器重写捆绑 |
| `CROSS-01 / CROSS-02`：拖入承诺与载体语义不一致 | 不支持 drop 的 Surface 移除伪承诺，或接通真实 drop；卡片/反馈明确自由节点、文档块、浮层和世界元素 | 先选最短真实路线，不强求三 Surface 机制相同 |
| `CROSS-03`：Interaction Properties 不可发现 | 选中真实 carrier 后提供不丢目标的 Automation 上下文入口 | 必须有真实 consumer；没有则记录 skip，而不是造空面板 |
| `SPATIAL-06`：底层 Zod JSON 直出 | 教师看到具体、可恢复的提示，完整 reason 留给日志/Diagnostics | 不丢诊断信息，也不暴露原始结构 |
| bundle / source map P2 | 从下一次固定最终候选的唯一打包产物采集同机冷启动、首个可编辑画布、峰值内存、安装包和 source map 入包事实；只有越过阈值才新建一个 exact lazy-boundary 卡 | 不提前重复完整测试/打包，不预建优化卡，也不用提高 warning limit 或只写 `manualChunks` 宣称完成 |
| 验证层级错配 | 每卡 focused 检查 + 最多一条能直接守住行为的真实纵切；热点合并和最终候选再扩大 | 不建 dashboard、Evidence 状态机、全模式组合矩阵或逐卡全量 E2E |

依赖主链：

```text
页面 inert + 全局层安全边界 / MIX-01 / Flow 文本基础 → 核心行为门
核心行为门 → 控制器运行 Session、Spatial 五个独立行为与 Mixed history（热点接入串行，任务不互相假依赖）
核心行为门 → Flow 公式、格式/大纲、媒体；与 Spatial/Controller 域并行，只有 FlowWorkspace 热点串行
核心行为门 → 跨模式承诺与可恢复错误；CROSS-03 无真实 carrier 时直接 skip
合同候选只做独立批准/拒绝/延后；下一最终候选唯一打包产物 → 性能测量 → 越阈值时才生成优化卡
全部已准入行为与处置关闭 → V0 audit closure → 新最终候选
```

同一结果域内允许调查、纯命令和目标测试并行；文件热点锁只控制接入时刻，不得伪装成任务级产品依赖。`FlowWorkspace.tsx` 的文本、控制器、公式和工具栏接入必须串行，Spatial owner / Properties / Clipboard / History 的 Store 接入必须串行，控制器跨 Host/Published 接入和任何获批合同提交各保持单一写入者。真实 Chromium 只集中在核心、控制器/Spatial、Flow 三个 V2 门；低风险跨模式结果直接进入 V0 audit closure。

明确排除：逐页/逐 `location` 控制器坐标、多个控制器副本、V10、放宽有效 order 唯一约束、第二套 Store/Session/History、通用工作流状态机、Flow Word 化、Spatial 完整白板化、大规模 Workspace/Properties 重写、验证平台扩建，以及只为消除 chunk 警告的配置调整。

### ARCH-0A：治理、基线与事实重算

- 本总纲与详细计划成为唯一当前路线；
- 固定可回退提交和三份合法 V9 代表课件；
- 记录数据安全、跨 Surface、预览导出的已知成功与失败；
- 建立 writer、consumer、owner、热点和最小验证矩阵；
- 历史 Editor 1.0 任务包冻结，不再派发。

### ARCH-0B：项目知识索引

- 建设静态、确定、可检查的开发导航索引；
- 覆盖 renderer/player、main/preload 和 e2e 三套 TypeScript 工程；
- 自动收集文件、顶层符号、import/export、合同、脚本和测试；
- 人工只维护少量模块 Owner、用户旅程、不变量和 Legacy 关系；
- 为任务生成小型 Context Pack，低置信时自动降级到源码核查；
- 不建设图数据库、向量数据库、常驻服务或函数级完整调用百科。

ARCH-0A 与 ARCH-0B 可并行，但广泛多智能体迁移必须等待知识索引通过准确性门禁。首个高风险纵切可在严格人工 Bootstrap 下提前准备。

### ARCH-1：边界与首个完整纵切

- 建立窄 Core、Surface、Feature 公共入口和依赖棘轮；
- 用“替换已选图片，同时在文件对话框期间切页”验证完整链；
- 覆盖延迟目标、素材字节、一次撤销、保存重开、预览和一个导出；
- 若需要双写、V9 Schema 变化或重写全部 Store，立即回滚并重审设计。

### ARCH-2：跨 Surface 公共能力解耦

按两批候选域检查，而不是按批次配额制造任务：

1. Media、Components、Runtime / Interactions；
2. Global Layers / Controller、Diagnostics、Save / Recovery。

只有可复现缺口、真实 consumer 或用户行为证据才生成实现卡；已经成熟且只需保留的能力允许零张实现卡。热点由单一 Integrator 串行接入，发生迁移时 Legacy consumer 数量必须单调下降。

### ARCH-3：三种 Surface 模块化

- 不预建通用 Surface seam；只有当前用户行为或真实 consumer 需要时，才建立能解除该阻塞的最窄 seam；
- Slide、Flow、Spatial 仅在各自存在已证实任务且写入范围独立时并行，允许某个 Surface 本阶段零改动；
- Workspace、Properties、App、Store 始终由单一 Integrator 接线；
- 如果只是移动文件、没有降低耦合或返工，停止继续拆分。

### ARCH-4：Preview、Player、Export 与 Legacy 收口

- HTML/Web/Preview、PPTX、PDF/preflight 可分线处理；
- Published producer 保持单一 Owner；
- 先证明 fallback 是否真实可达，不为不可达状态新造模型；
- 只有明确选择迁移或删除的旧 consumer 才要求替代路径和 deletion gate；仍有真实用途、兼容责任和明确 owner 的 Legacy 可以保留。

### ARCH-5：清理与最终复核

- 只有明确选择删除的 Legacy 目标，才要求其精确 consumer 为零且新路径至少稳定一个完整波次；有保留理由和 owner 的 Legacy 可以继续存在；
- 检查 Recovery、IPC、动态引用、fixtures、scripts、release 与打包版；
- 最终候选只运行一次完整工程验证和三份代表课件流程；被完整套件包含且同一候选已通过的 focused suite 不再重复；
- 分别报告 pipeline、engineering、outcome 和 `accepted` 状态。

---

## 6. 自动多智能体执行

默认使用一个协调者和三个 Worker：

- **协调者 / Integrator**：维护任务板、依赖、热点锁、分支、合并、回滚、阶段验证和产品化汇报；
- **Worker A/B/C**：领取依赖已满足、写入范围互不重叠的最高风险任务。

高并行用于调查、纯模块、目标测试、consumer 迁移和独立格式适配；以下热点始终只有一个写入者：

- Editor Store / History；
- App、保存和恢复；
- Workspace / Properties；
- Published producer；
- contracts / Schema；
- main / preload；
- generated repo-index。

审计后稳定化的额外文件防火墙：

- Mixed order allocator、Flow 文本基础和 Player 控制器 footprint 可由三个 Worker 并行调查或修改独立模块；
- `FlowWorkspace.tsx` 按“真实选区/空块 → 页面控制器 inert → 公式入口 → 工具栏/媒体”串行；
- Spatial owner、Properties、Clipboard 和跨 Surface History 只由同一个 Store Integrator 依次接入；
- 控制器的 Authoring、三个 Player Host、Published producer 和默认 factory 不得由多个 Worker 同时写；
- V9 / Published 合同只在获批的 additive-exception 卡中由单一合同 Owner 修改，普通 Flow/媒体修复只读合同。

任务自动流转、有限重试、独立诊断和回滚规则见 [自动执行工作流](docs/development-plan/40-development/00_SINGLE_MAINTAINER_AI_WORKFLOW.md)。用户无需逐任务监督。

只有以下情况升级给产品 Owner：

- 需要修改 V9 Schema、创建 V10 或迁移真实用户数据；
- 两项现有教师能力无法同时保留；
- 需要改变用户可见工作流、导出语义或视觉结果；
- 需要付费工具、重大依赖、网络服务或新安全权限；
- 代表课件显示真实数据损坏风险；
- 性能只能通过能力缩水恢复；
- 工期或资源预计超出已登记预算 50% 以上；
- 最终发布或 `accepted` 决策。

---

## 7. 最小充分验证

详细规则见 [验证策略](docs/development-plan/40-development/03_VALIDATION_STRATEGY.md)。

- Worker：差异卫生，以及 1–3 个最相关目标检查；只有自动化不能直接观察结果时，才补一个最小用户行为；
- Integrator 接入：受影响类型/集成检查，必要时一个桌面 smoke；
- 产品代码阶段：复用仍有效的任务/波次证据，只补被本阶段改动使失效的代表课件、保存、预览或导出链路；纯治理/索引阶段只运行自身文档、生成、查询和确定性检查；
- 最终候选：合同、类型、单元/集成、E2E、桌面构建和人工核心流程完整运行一次。

审计项的真实行为门禁：

| 风险面 | 最小必守纵切 |
|---|---|
| Mixed 创建 | 默认 Slide → 新增 Spatial → 连续插入两个不同 world item → 保存重开；无错误且 effective order 唯一 |
| Flow 文本 | 真实 pointer drag 产生非空 Selection；空 contenteditable rect 非零、caret 正确、首字符前后几何稳定；IME 不回归 |
| Flow 公式 | 依次发出两次真实 click，首次选择触发重渲染后仍进入公式编辑；不得只派发合成 dblclick |
| 教师控制器作者态 | Slide / Flow / Spatial 页面都不可点选、聚焦或变换控制器，事件命中其下方内容；全局层仍可编辑 |
| 教师控制器安全与运行态 | 四边越界、画布外松开、`pointercancel`、旧数据重置、折叠 footprint、Flow TOC、Mixed Session 和 restart；跨作者端/Player 的卡必须覆盖保存重开与真实 Player |
| Spatial 真实性 | 当前公开且可操作 owner 的选择和插入归属正确；公开属性与 duplicate / clipboard 必须改变 canonical 工程；切 Surface 返回后 undo / redo 有效；不为 surface 对称性新增入口 |
| Flow 媒体 | 编辑器与 Player 比较实际 bounding rect 和真实 controls / 预览，不用 style 字符串代替结果 |
| 性能 | 复用下一次最终候选唯一打包产物测冷启动、首个可编辑画布、峰值内存、安装包和 source map；越阈值才建优化卡，验收看指标而非警告 |

这些是风险到证据的映射，不要求每张卡都各建一条 E2E。相同 invalidating paths 可在波次门合并成不超过三条贯穿行为；未受影响证据继续复用。

禁止每个小任务或每个阶段重复运行全仓 `verify`、完整 E2E 或全量打包；全仓完整套件只在最终候选或明确的跨系统高风险门运行。失败不得通过弱化断言、无限 retry、复制第二套数据或叠加长期兼容层来掩盖。

---

## 8. 总体成功门槛

- 可写 Course Project 真相：1；
- 正常活动编辑会话：恰好 1；
- 异步操作写错项目/页面/对象：0；
- 一个用户操作的逻辑历史：1；
- 新增 V9 既有字段语义变化：0；
- 三份代表课件：3/3 可打开、保存重开、播放；
- 适用导出无关键回归；
- 审计已确认且已准入的 P0 / P1 未关闭数：0；P2 必须完成、以明确测量结论关闭，或按本计划条件留下可复核 skip / product-decision，不得无记录消失；
- 作者工程可保存但 Preview、统一画布、Published Player 或适用导出拒绝的状态：0；
- 默认 Mixed 创建链连续插入两个不同 world item 的有效 order 冲突：0；
- Flow 真实鼠标拖选、空块 caret 与公式编辑入口：全部通过真实 Chromium 行为；
- 页面作者态可命中、聚焦或变换教师控制器：0；全局层仍为唯一持久化作者入口，运行拖动回写工程：0；
- 公开属性、复制、粘贴、重复、拖放或成功提示的静默 no-op / 伪成功：0；
- Spatial 跨 Surface 返回后丢失既有撤销权：0；global / surface / world 的公开 owner 入口与 canonical 归属一致；
- 新增 raw Store 公共旁路和跨模块深层依赖：0；
- 发生迁移时，卡内精确 Legacy consumer 目标必须下降且不得新增旁路；只有明确删除的目标要求 consumer 为 0，已说明 owner/用途的保留项不以归零为 KPI；
- 核心操作性能不超过阶段登记的回归阈值；
- 已有教师能力缩水：0；
- 热点并行写冲突：0。

合同和性能候选不能用“尚未实施”伪装成遗漏：行内公式、图片/视频新增持久化字段必须有独立 additive-exception 裁决；bundle 风险必须先明确复用唯一最终候选产物的测量处置，并在发布结论前以该产物决定新建优化卡或用证据关闭。它们不阻止先修 P0，但在领取新的最终候选前必须有明确裁决或测量安排。

达到稳定化指标即可停止后续纯整理，不以完成所有目录移动作为成功定义。

---

## 9. 当前状态与领取入口

当前任务状态、阶段位置、依赖与下一可领取项只能来自任务卡及自动生成的 [任务板](docs/development-plan/TASK_BOARD.md)。本总纲、根 README、阶段说明、历史任务和评估报告不得静态声明另一套“当前阶段”或“立即执行项”；任务板没有合格实现卡时，按阶段准入规则允许只读盘点、满足 skip condition 或直接进入适用门禁。

吸收本次审计时，不回写或重新打开已经 `done` 的 ARCH-2～5 历史任务；它们提供可复用的命令、边界和验证基础，但不代表新发现已被覆盖。新工作使用 `tasks/stabilization/**` 的新卡承载，完成全部已准入审计行为后执行一次 V0 audit-closure 文档门，再在同一固定产品候选上执行一次必要的最终 V4、唯一打包/性能测量与人工结果复核；不得沿用审计前候选直接宣称 outcome 或 `accepted`。
