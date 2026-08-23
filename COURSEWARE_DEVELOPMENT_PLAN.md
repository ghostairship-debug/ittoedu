# IttoEdu 编辑器稳定化与模块解耦总纲

> 计划版本：13.0
>
> 激活日期：2026-08-24
>
> 当前主线：立即稳定化、统一架构、渐进解耦、自动多智能体执行
>
> 产品 Owner 决策：当前版本不可用；稳定化不等待教师复核，教师 `accepted` 只保留为最终产品与发布结论。

本文件是仓库唯一长期开发总纲。详细架构、知识索引、阶段任务、自动执行、验证与回滚协议统一位于 [docs/development-plan/](docs/development-plan/README.md)。历史计划、评估报告和 `docs/tasks/editor-1.0/**` 只作 Git 历史或冻结证据，不再派发任务。

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

`T0–T6`、`P1–P8`、`Q1–Q8`、`F1–F3`、`G0–G3` 已合入 `main`，不得重做。它们的任务卡现为历史证据。

本计划整合前的核查基线是 `main @ dbe518e`：产品源码基于父提交 `690411d`，同时 `dbe518e` 还刷新了三份 `artifacts/ai-capabilities/**` 生成物。外部组件目录在核查时可见 4 个实验包，但外部目录状态不是稳定源码事实；ARCH-0A 必须记录计划落盘后的新 HEAD 并重新检查。

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

---

## 4. 目标模块

| 模块 | 负责 | 不负责 |
|---|---|---|
| Editor Core | 唯一工程数据、提交、历史、过期目标保护 | Surface 排版、具体选择、Feature UI |
| App / Persistence | 新建、打开、保存、恢复、文件与桌面边界 | Surface 命令、导出格式实现 |
| Slide | 场景、图层、状态、命中和局部属性 | 组件包和素材文件生命周期 |
| Flow | 正文块、稿纸排版、公式表格、IME、Flow 组件块 | 用通用 z-order 取代正文顺序 |
| Spatial | 世界对象、镜头、路径、关系与自由浏览 | 把运行态相机写回工程 |
| Media | 素材元数据、文件字节、导入和替换计划 | 决定各 Surface 的摆放方式 |
| Components | Catalog、工程包、实例资源和作者校验 | 绕过 Surface 创建错误载体 |
| Runtime / Interactions | Runtime、规则、模板、校验和运行边界 | 保存工程或让 Player 反写作者数据 |
| Global Layers / Controller | 全局层、Surface 共享层、有效顺序、教师控制器 | 复制成每个场景的普通对象 |
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

## 5. 当前激活路线

详细阶段合同见 [执行路线](docs/development-plan/30-execution/00_ROADMAP_AND_GATES.md)。编号使用 `ARCH-*`，不复用历史 P/T/Q/F/G。

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

按两批自动推进：

1. Media、Components、Runtime / Interactions；
2. Global Layers / Controller、Diagnostics、Save / Recovery。

每批只迁真实用户行为；热点由单一 Integrator 串行接入，Legacy consumer 数量必须单调下降。

### ARCH-3：三种 Surface 模块化

- 先串行建立稳定 Surface seam；
- 再由三个 Worker 并行处理 Slide、Flow、Spatial 内部；
- Workspace、Properties、App、Store 始终由单一 Integrator 接线；
- 如果只是移动文件、没有降低耦合或返工，停止继续拆分。

### ARCH-4：Preview、Player、Export 与 Legacy 收口

- HTML/Web/Preview、PPTX、PDF/preflight 可分线处理；
- Published producer 保持单一 Owner；
- 先证明 fallback 是否真实可达，不为不可达状态新造模型；
- 每个旧 consumer 都有替代路径和删除门。

### ARCH-5：清理与最终复核

- 只有精确 consumer 为零且新路径至少稳定一个完整波次后才删除；
- 检查 Recovery、IPC、动态引用、fixtures、scripts、release 与打包版；
- 最终运行一次完整工程验证和三份代表课件流程；
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

- Worker：差异卫生、1–3 个目标检查、一个最小用户行为；
- Integrator 接入：受影响类型/集成检查，必要时一个桌面 smoke；
- 产品代码阶段：三份代表课件与本阶段相关保存、预览、导出；纯治理/索引阶段只运行自身文档、生成、查询和确定性检查；
- 最终候选：合同、类型、单元/集成、E2E、桌面构建和人工核心流程完整运行一次。

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
- 新增 raw Store 公共旁路和跨模块深层依赖：0；
- Legacy consumer 只降不升，删除时精确目标为 0；
- 核心操作性能不超过阶段登记的回归阈值；
- 已有教师能力缩水：0；
- 热点并行写冲突：0。

达到稳定化指标即可停止后续纯整理，不以完成所有目录移动作为成功定义。

---

## 9. 当前立即执行项

```text
ARCH-0A：治理、三份代表课件、事实/consumer/owner 基线
    ∥
ARCH-0B：知识索引适配 spike、当前模块/旅程语义、生成/check/context
    ↓
ARCH-1：图片替换完整纵切
```

当前任务状态只能来自最终计划中的任务卡与自动任务板；根 README、历史任务和评估报告不得再声明另一套“当前阶段”。
