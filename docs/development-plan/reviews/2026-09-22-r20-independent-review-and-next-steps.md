# R20 独立反过度设计复核与下一步

- 复核日期：2026-09-22
- 审查对象：`D:\果铃工作台`
- 参考材料：
  - 桌面《果铃工作台_反过度设计审查_2026-09-19.md》
  - 桌面《反过度设计审查_果铃工作台_2026-09-19.md》
- 复核基线：两份报告均标记 `main @ bc2072f7`；本文件以当前工作区源码、合同、路线与任务板为准
- 方式：只读核实与方案整合；本次未修改产品代码，未运行付费模型或完整验证

## 结论

两份报告共同指出了真实的维护负担，但不能据此进行一次性“大清理”。产品内核——Course Project V9、Slide / Flow / Spatial、Published V2、导出和原生 CLI 接入——是实际用户能力，不应因为实现规模大而被压缩。

最可信的结论有三类：

1. **重复的表面命令样板值得做小范围试点。** Slide 与 Spatial 的新增节点命令都包含 stale 检查、创建节点、写入对应载体、提交资源感知历史和更新选择的相似骨架；但三种表面的作用域、状态可见性、默认坐标和组件约束不同，不能直接推出一套覆盖五层的统一管线。
2. **部分开发基础设施的维护收益需要重新证明。** `repo-index` 是可选导航缓存，语义文件由人工维护；生成物、证据截图和一次性夹具也应逐项区分“当前运行所需”“测试直接消费”和“历史证据”，不能只按文件名或体积删除。
3. **几个代码热点确实影响后续开发效率。** `SlideLocationWorkspace.tsx` 职责集中，属性绑定包含多个表面和大量命令适配，旧符号扫描器存在固定目录带来的维护负担。这些应按真实 consumer 和 owner 边界收敛，不能用文件数、行数或端口数量单独证明需要重构。

当前 R20 仍有用户链路、真实载体和 Owner 签署方面的阻塞或未验证项。治理清理不能取代这些交付门，也不能把工程候选写成 accepted。

## 两份报告中确认保留的有效线索

### 1. 表面命令的重复是可验证的局部问题

目前可直接看到：

- `src/renderer/course/v9SlideContentCommands.ts` 中的 `addSlideTextLayer`、`addSlideFormulaLayer`、`addSlideComponentLayer`、`addSlideRuntimeLayer` 等命令都完成版本检查、节点构造、载体写入和历史提交。
- `src/renderer/course/spatialEditorCommands.ts` 中的 `addSpatialWorldTextLayer`、`addSpatialWorldComponentLayer`、`addSpatialWorldRuntimeLayer` 等命令具有相似的外层结构。
- 节点工厂和 `sceneNodeToCourseLayerItem` 已经共享；Slide 与 Spatial 的历史提交也分别复用资源感知历史实现。

这证明存在可减少的样板，但没有证明所有节点类型、Flow 正文、Player 宿主和 UI 都应被同一抽象覆盖。下一步只应选择一个低语义差异的节点类型做纵切试点，先验证旧 writer 消失、一次事务、stale 拒绝、Undo/Redo、保存重开和两种表面行为不变，再决定是否扩大。

### 2. `SlideLocationWorkspace` 是维护热点，但拆分不是自动性能优化

`src/renderer/ui/workspaces/SlideLocationWorkspace.tsx` 约 3,025 行，组件函数中同时包含画布、编辑态、发布宿主、试运行、工具区、快捷键和输入处理。拆分为职责明确的 hook / 子组件有维护价值，尤其可以降低后续写锁冲突。

但是拆分组件本身不会自动减少 React 重渲染，也不等于运行速度提升。只有在记录当前渲染路径、提交次数或交互延迟后，才可以提出性能收益。实施时必须保持 `SlideWorkspacePorts` 的稳定边界和唯一 Store / History writer，不得以“拆分”为名建立第二状态源。

### 3. `repo-index` 的收益需要实证，而不是按行数判死

报告正确引用了两个事实：

- `repo-index/generated` 是可缺省的本地缓存，不能阻断实现；
- `repo-index/semantic/features.json`、`modules.json`、`invariants.json`、`exclusions.json` 是人工维护的语义边界。

这说明它存在维护成本，但不说明它一定没有收益。查询器会读取语义边界，并对 source / semantic / config / tool 域做 freshness 判断；删除 `semantic/` 会直接改变查询器契约，不能作为无配套修改的“最小动作”。

后续应先记录实际查询使用、命中率、陈旧提示和人工 bootstrap 次数。若确认无人使用，再保留少量语义文档或迁入正式开发文档，最后才删除查询器、生成器和测试；不能先删再寻找替代。

### 4. 生成物边界值得收敛，但要区分运行时制品

`artifacts/ai-capabilities/candidate-helper-core.mjs` 确实是由 `scripts/generate-ai-capabilities.ts` 打包生成的文件，适合评估改为构建期或发布制品生成。证据截图和一次性评审 PNG 也不应成为产品源码的默认依赖。

`src/shared/generated/courseAgentCapabilities.json` 则被多个产品模块静态消费，不能仅因为体积大就移除或裁剪。应先设计可靠的生成、构建和开发启动路径，再验证能力索引、Builder、CLI 和 Skills 的字节/语义契约，最后决定是否改变入库边界。

两份报告给出的“`.git` 可降到某个固定大小”“每次都会产生整份大 diff”等数字没有被当前复核确认。近期 helper 产物提交既有大变更，也有小增量，不能用单次最大 diff 推导固定收益。

### 5. e2e 收敛和并行化只能按行为证据进行

按 `r18` / `r19` 命名的测试并不自动等于一次性测试。其间包含会话恢复、文字布局、工作区首存、草稿存续和真实宿主行为，仍可能保护当前用户路径。应按“保护哪个可观察行为”建立目录或标签，而不是按版本前缀批量归档。

Playwright 当前单 worker 是开发成本信号，但开启并行前必须证明 Electron `userDataDir`、端口、临时工程、输出目录、后台窗口和模型门控都能隔离。没有隔离证据时，不能承诺 2–4 workers 或固定的 55%–65% 提速。

## 已核实的报告修正

下列判断不能直接采纳：

| 报告判断 | 核实后的结论 |
|---|---|
| 保全矩阵绑定 1.1、已结束，可删除 | 错。`PRESERVATION_MATRIX.md` 已包含 S1 / S2 行，至少延伸到 PM-38；`check:preservation` 仍是当前行为保全工具。 |
| 架构夹具生成器无人调用 | 错。`tests/unit/buildPublishedCourseV2.test.ts`、`tests/unit/architectureBaselineFixtures.test.ts`、图片变换测试和基线清单仍引用 `scripts/build-architecture-baseline-fixtures.ts`。 |
| `editor10ForbiddenTokens` 可以替代 legacy 棘轮 | 错。该测试直接导入并调用 `check-legacy-consumers.ts`；二者不是独立替代关系。是否收窄或退役必须先迁移 consumer。 |
| `check-development-roadmap` 只检查一份 Markdown | 错。`scripts/check-development-roadmap.ts` 读取路线 manifest、依赖图、规格文件、引用、版本 README 和保全引用；当前 manifest 含 176 个任务。 |
| ProseMirror / CodeMirror 只服务一个小组件，属于纯浪费 | 不成立。`SharedDocumentEditor` 同时被 Flow 工作区和文件文档编辑器使用；是否需要替换依赖要看实际编辑能力和构建成本。 |
| 四套预检各自维护互相矛盾的真相 | 证据不足。`exportPreflight.ts` 已汇总工程健康、打包预检和 Slide 视觉预检，并统一 severity、code、target 和诊断定位。仍可继续检查规则重复，但不能仅按目录数判定为四套独立体系。 |
| 没有 `manualChunks` 就会把 PPTX / PDF 全部塞进首屏 | 错。PPTX 和 PDF 路径已经使用动态 import，构建产物也存在独立相关 chunk。其他静态依赖是否需要继续拆分应由构建测量决定。 |
| `courseProjectHealth.ts` 与同名目录是重构残留 | 不成立。顶层文件是汇总 facade，目录内是按域分项的检查实现。 |
| 任务板当前为空所以机制无用 | 已撤回。历史上承担过集中并行改造；当前工作协议也明确单会话不建卡、多执行者时才启用。 |

报告中的仓库行数、测试行数、跟踪体积和比例只作为当日画像，不能写成当前门槛或收益承诺；已核实的源码关系和行为证据优先于这些快照数字。

## 后续行动顺序

### P0：保持当前 R20 交付边界

- 继续以用户可完成、正确保存、可重开、可运行、可导出的能力为第一优先级。
- `TASK_BOARD.md` 当前有 `r20-contextual-authoring` blocked 卡；该阻塞和真实载体 / Owner 验收不能通过治理删减“解决”。
- 不删除 legacy、保全、roadmap、e2e 或生成物，直到对应 consumer、替代路径和直接验证已经列明。

### P1：做一个命令层试点，不扩成三表面重构

选择 Slide / Spatial 都存在、且不涉及复杂命名状态的文本或形状新增作为试点：

1. 写出共享输入和表面 adapter 的窄类型；
2. 保留各自 scope、坐标、层顺序、状态可见性和错误码；
3. 迁移一个节点类型并删除对应旧重复 writer，不保留双写；
4. 验证一次历史、stale 拒绝、选择更新、保存重开和代表性 Player / 导出消费；
5. 若没有减少复杂度或产生 owner 混淆，停止扩大。

### P1：拆分 Slide 工作区的职责，不改变状态归属

先只抽出通信、快捷键/输入和工具区中边界清楚的部分，保留 `SlideLocationWorkspace` 作为组合层。提交前检查：

- 没有第二 Store、Session、History 或 writer；
- `SlideWorkspacePorts` 和公开行为不变；
- 真实画布、试运行、预览和选区路径仍可观察；
- 性能结论只在有前后测量时写入。

### P2：建立治理与产物的“保留 / 归档 / 退役”清单

对每个候选项记录：直接 consumer、package/CI 入口、文档合同、替代路径、历史用途、删除后的失败方式和最小验证。分类规则如下：

- **保留**：仍保护当前行为，或是可复用的通用协调器；
- **归档**：只剩历史证据，但尚未证明无 consumer；
- **退役**：目标永久结束、工具不可复用、consumer 为零，并完成最小替代检查。

优先核查：

- legacy scanner 是否应收窄固定查询目录，而不是直接删除；
- repo-index 是否真实减少定向阅读量；
- candidate helper 与评审截图是否能转为构建/附件制品；
- `measure-architecture-baseline.ts` 等被报告称为“死代码”的脚本是否有文档、测试或历史回归 consumer。

### P2：按行为重新整理 e2e，不按版本名批量处理

为每个候选 spec 写出一行用户行为和最低 carrier。只有以下条件同时满足才可归档或删除：

- 行为已有更近层、等价或更强的直接证据；
- 原 spec 不再承担独特的真实宿主 / 保存 / 导出 / 恢复路径；
- 默认 run、付费模型门和人工验收的边界已重新登记；
- 归档后跑一次受影响的 focused check，且没有 zero-match 假通过。

并行化另立小试验：两个互不相干的 spec 使用隔离 profile、临时目录和端口运行，比较失败类型和总时间；试验失败就保留单 worker。

## 完成与停止条件

本审查的后续工作只有在以下证据齐备时才可称为完成：

1. 删除或归档项的直接 consumer 已查清，替代路径已在当前合同下成立；
2. 结构重构迁移了真实 owner / writer，未形成双写、第二历史或完整 Store facade；
3. 与改变属性对应的 focused check 通过，保存、重开、Player、导出或真实宿主路径按影响范围验证；
4. 所有收益数字都来自同一命令、同一环境的前后测量，不能由行数或文件大小推导；
5. 剩余问题被标成未验证、环境阻塞、Owner 决策或长期路线，不写成已完成。

如果下一步不能改变产品决定、实现边界或验收可信度，就停止继续盘点。治理清理不应建立新的评分平台、任务仪式、兼容层或第二套工程真相。

## 证据索引

- 产品与执行边界：[COURSEWARE_DEVELOPMENT_PLAN.md](../../../COURSEWARE_DEVELOPMENT_PLAN.md)、[ARCHITECTURE_CONTRACT.md](../ARCHITECTURE_CONTRACT.md)、[WORKING_PROTOCOL.md](../WORKING_PROTOCOL.md)
- 当前协调状态：[TASK_BOARD.md](../TASK_BOARD.md)
- 路线校验：[scripts/check-development-roadmap.ts](../../../scripts/check-development-roadmap.ts)
- 保全矩阵：[PRESERVATION_MATRIX.md](../roadmap/PRESERVATION_MATRIX.md)
- legacy 检查：[scripts/check-legacy-consumers.ts](../../../scripts/check-legacy-consumers.ts)
- repo-index 说明：[repo-index/README.md](../../../repo-index/README.md)
- 命令试点候选：[v9SlideContentCommands.ts](../../../src/renderer/course/v9SlideContentCommands.ts)、[spatialEditorCommands.ts](../../../src/renderer/course/spatialEditorCommands.ts)
- 工作区热点：[SlideLocationWorkspace.tsx](../../../src/renderer/ui/workspaces/SlideLocationWorkspace.tsx)
- 共享编辑器：[SharedDocumentEditor.tsx](../../../src/renderer/document/SharedDocumentEditor.tsx)
- 导出预检汇总：[exportPreflight.ts](../../../src/renderer/export/exportPreflight.ts)


