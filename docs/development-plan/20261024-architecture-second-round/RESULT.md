# 架构收敛第二轮结果（2026-10-24）

**P2-B完成，Source单条红例已定性并修复；广义P2-C优化未实施。** 开发、最小充分验证及独立增量评审已完成，现有未提交成果保留。未commit、push、打Portable、发布或部署。

执行依据为[原方案§9](../../../output/architecture-audit-20261024/IMPLEMENTATION_PLAN.md#next-round-after-first)。本轮先复现Source缺口并做局部正确性修复，再完成Bridge单文档准备。未启动P1-C、P5-A、Engine／工具暴露或资源／编译扩面。

## Source红例定性与修复

原 `publicWriteReceipt20261020` 的“retains the useful complete generated Source entry…”单例在[原运行](../../../output/architecture-second-round-20261024/source-original.log)失败于 `inserted.files.find`。新增临时诊断且保留原断言后，得到[实际回执](../../../output/architecture-second-round-20261024/source-diagnostic.log)：

- commit为committed、receipt为applied、revision为1，实例已插入；不是写入或持久ACK失败。
- diagnostics为 `content-paths-unavailable`，原因是默认组件 `guoling.html-program` 的完整源码尚未准备。
- `contentReceipt`列出结果Source元数据后，复制／读取惰性Source属性时触发同步getter；该异步回执入口此前没有像 `project.read` 一样先等待既有源码加载。异常被捕获，整份files未返回，用户无法从回执直接发现并续改生成Source。

在 `src/core/projectFiles/componentPlatform/coordinator.ts` 的结果文件选择后，复用 `prepareComponentProjectFileSource`，只准备本次结果文件需要的builtin闭包，再复制／回送Source。别名共享原加载缓存；没有新缓存、第二writer或跨revision基线合并，没有重放原提交。

原单例修后完整通过，包含Source入口／路径、complete、revision／currentRevision、后续人改不回送未读正文、旧观察继续修改明确冲突及人工值保留。**该测试与本轮开始时的内容一致，原断言零修改**；诊断已在finally恢复。另有实际Gateway私有Source修改／Undo／冷开与共享Source元数据／资源保存重开消费者通过。

`remember`的同版本snapshot共享、单ACK按snapshot复用、不同历史已读基线和Source COW规则均保留。未发现需要新增复用机制的证据，因此不将本次正确性修复称为完成整个P2-C性能优化。

## P2-B实际改变与收益边界

`src/renderer/documents/CourseV10DocumentBridge.ts`继续拥有派生视图准备：

1. Projection普通状态订阅携带documentId，编辑上下文只整理该文档。激活、展示状态、深入／退出、保存和关闭入口也传入已捕获文档；省略 `save()` 参数时使用 `projection.documentId`。
2. 全局documents／views列表与必要通知仍维护，无关文档复用原条目；不再因A的一次输入／ACK整理B的上下文并重建B的内容视图。修前反例确认B被准备，修后同场景normalize共5次均属于A，B为0。
3. 正式／草稿project与presentationStates未变时，纯选择复用现有editingProject；真正切展示状态仍重建。失效状态改为复制状态映射，避免原地修改使复用判断漏掉状态变化。
4. 普通state订阅保留，pending、composition、error、保存binding／dirty等同revision变化仍传播。保留草稿可继续进入project／editingProject；retainedDraftOnly时runtimeProject及views的model仍采用committed，不合并三路语义。

本轮删除的是无关专业准备与展示投影重算，没有新建Bridge、投影Store或事件总线，也未重写DocumentProjection／Session。全局列表迭代和必要listener通知仍存在；不宣称全部通知消失、每次输入只产生一次事件或普遍提速。

## 验证与证据

20项选中检查通过；重复运行不重复累计，未选用例不计通过。原始证据位于[本轮目录](../../../output/architecture-second-round-20261024/)。

| 属性 | 结果与范围 | 证据 |
|---|---|---|
| Bridge准备范围、命名状态、composition／迟ACK／保存 | 新 `bridgeScopedPreparation20261024` 3/3通过；A变化时B准备为0、B条目身份保持，纯选择复用展示投影，展示状态变更有效；省略参数保存、composition和背景ACK均覆盖。 | [最终聚焦结果及调用计数](../../../output/architecture-second-round-20261024/bridge-final.log) |
| 既有输入／恢复／关闭消费者 | `flowLateAckOwnership20261023`、`projectionFeedbackLifetime20261023`、`coreExperienceViewLifecycle` 共13/13通过；覆盖迟ACK续写、重叠外部修改／原稿保护、错误归属、IME、保存期间新输入及正式关闭前未确认输入保留。 | [生命周期结果](../../../output/architecture-second-round-20261024/bridge-lifecycle.log) |
| Source真实回执与实际保存／新宿主冷开 | 原Source单例、`a05AuthorSourceGateway20261014` 的私有编辑／Undo／冷开、`componentSourceQ0` 的共享定义元数据／资源及独立重开，共3项通过；另17项未选。 | [直接消费者](../../../output/architecture-second-round-20261024/source-consumers.log) |
| 实际界面输入与迟ACK前台 | 新 `architectureBridgeInput20261024` 1项通过。真实Chromium149中A提交被延迟时切B、实际双击进入PM输入；A后到不抢前台，B继续输入，Undo／Redo、保存关闭后新Session打开均正确，无页面错误。 | [浏览器运行](../../../output/architecture-second-round-20261024/bridge-browser.log)、[行为记录](../../../output/architecture-second-round-20261024/bridge-browser.json)、[实际画面](../../../output/architecture-second-round-20261024/bridge-input.png) |
| 类型及实际构建 | 最终主 `tsc -p tsconfig.json --noEmit` 0退出；最终Renderer及Electron构建入口0退出。 | [主类型](../../../output/architecture-second-round-20261024/typecheck-final.log)、[Renderer](../../../output/architecture-second-round-20261024/build-renderer-final.log)、[Electron](../../../output/architecture-second-round-20261024/build-electron-final.log) |

修前Bridge有效反例为[无关文档准备](../../../output/architecture-second-round-20261024/bridge-before.log)及[命名状态纯选择重算](../../../output/architecture-second-round-20261024/bridge-selection-before.log)。新增fixture初次还存在API名称和JSON类型录入错误，已修正；前者不计为产品反例。首次类型日志保留，最终成功退出为收口证据。

真实浏览器使用实际组件／Store／Bridge和测试transport，新Session重开不冒充完整Electron壳层；另由既有Main消费者提供真实文件及新宿主冷开证据。P3接口与挂接时序未变，首轮相关有效证据继续复用。未跑无关全矩阵、物理IME、旧整作或付费模型。

## 独立评审、保全及剩余

未参与实施的 `architecture_review`只读核本轮before差异、直接消费者和证据。其指出省略save文档参数仍会全域准备，已改为捕获projection身份并补最近层验证；指出的新fixture类型问题已修。最终确认“本轮独立评审通过，无剩余阻断项”，收口为P2-B完成、Source正确性修复完成；广义P2-C优化未实施。

本轮开始时103个tracked dirty、36个未跟踪文件均保留；[原差异](../../../output/architecture-second-round-20261024/preexisting.patch)、原状态／未跟踪清单、直接重叠文件before副本和[保全核对](../../../output/architecture-second-round-20261024/preservation.json)留在证据目录。没有reset、stash、clean、原件迁移或恢复稿删除。

原审计14红例中，Gateway相关1项在首轮核实，本轮Source相关1项修复；其余没有获得新的全量通过结论。旧delivery夹具问题保留，未借本轮修改断言。后续P1-C／P5-A仍按原方案测量后选择，不自动启动。
