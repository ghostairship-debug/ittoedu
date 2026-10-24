# 本轮验证、失败诊断与证据边界

日期：2026-10-24。对象为当前工作树，HEAD `2376311b3372cb0ebc4ad2915e463d8a753def71`。本报告记录研究中实际执行的验证，不代表产品正式发版验收。

## 1. 未修改产品的核对

[source-integrity-after.json](source-integrity-after.json)对研究起点的1,681个源码文件重新计算SHA256与长度：changed=[]、missing=[]、added=[]，HEAD相同，Git状态字符串完全相同。包括起点已有dirty文件，没有覆盖其内容。

只在output/architecture-audit-20261024写分析脚本、隔离构建、日志和报告；本地诊断副本保留原断言，不编辑src或tests原文件。没有调用本机Codex/Claude Code/OpenCode，也没有运行真实付费模型。模拟Engine测试使用fixture provider和loopback；Sandbox状态回声测试使用独立临时Electron profile。

这一证明针对测量过的源码集合和Git状态，不声称整个电脑的缓存、日志和应用状态逐字节未变。

## 2. 运行结果

| 验证 | 结果 | 精确范围 |
|---|---|---|
| 主/renderer noEmit | 通过，31.2966秒 | 当前源码与配置，不执行npm prehook |
| electron noEmit | 通过，10.3806秒 | 当前Main/preload依赖 |
| e2e noEmit | 通过，10.1791秒 | 类型检查，不等于执行E2E |
| Player Vite | 通过，13.7186秒 | 独立输出目录，当前生成输入 |
| Renderer Vite | 通过，12.8163秒 | 独立输出；官方插件读取当前既有dist-player |
| Electron tsc emit | 通过，15.8553秒 | 独立输出，不删当前dist-electron |
| compiled Player内存构建 | 通过，0.4193秒 | 原生产esbuild参数+metafile+write:false |
| 默认组件源码生成比对 | 通过，3.2695秒，零差异 | 20逻辑定义、19入口；不写生成源码 |
| 原有针对性测试 | 99项，85过/14失败，95.736秒 | 七个文件，maxWorkers=2；不通过npm test预构建 |

构建探针不包含全新helper编译、打包、发行，也不宣称重新生成Player之后完成了整套Renderer/主进程正式验收。单次墙钟时长受到机器并发活动影响，不能将各项加总当成每个普通功能的固定成本。

## 3. 七文件测试明细

| 文件 | 总数 | 通过 | 失败 |
|---|---:|---:|---:|
| tests/unit/g20DocumentSession.test.ts | 18 | 18 | 0 |
| tests/integration/componentPlatformSession.test.ts | 4 | 4 | 0 |
| tests/unit/flowLateAckOwnership20261023.test.tsx | 3 | 3 | 0 |
| tests/unit/resourceContentArchive20261024.test.ts | 6 | 6 | 0 |
| tests/unit/sandboxStateEcho20261017.test.ts | 1 | 1 | 0 |
| tests/unit/publicWriteReceipt20261020.test.ts | 10 | 4 | 6 |
| tests/integration/g20ExecutionEngine.test.ts | 57 | 49 | 8 |
| 合计 | **99** | **85** | **14** |

原始汇总：[focused-test-summary.json](focused-test-summary.json)。完整Vitest JSON与日志位于远程同一研究目录。通过项为单writer、平台操作、迟到回执、资源归档和跨realm旧state回声等重要底座提供证据，不能扩大为所有编辑/保存/播放路径通过。

## 4. Engine八个红例的裁定

没有修改原测试使其转绿。先定向复跑四类确定性失败，再用独立测试副本在原断言前输出实际状态；副本仍失败，目的是观察它究竟失败在哪里。后者4个命中测试的过滤运行约11.27秒。

| 红例 | 观察到的事实 | 结论与下一步 |
|---|---|---|
| 同任务祖先作业取消 | 仍拒绝取消，实际code=invalid-operation，消息明确只能读原成果不能取消；测试期望job-not-authorized | 错误码合同分歧。没有证据发生越权取消；需决定对外稳定code，而非删除授权 |
| 压缩后native round角色 | 多出user消息内容为宿主当前文档变化；测试过滤器只识别旧system格式。实际可写文档revision1/一次Undo，只读文档revision0 | 明确测试过滤条件漂移。保留原工具轮和授权校验，更新的是合适的测试识别边界 |
| incomplete参数不得进入消息 | 字面“未完成”命中原有系统推进说明；executeCalls=0，tools=[]，revision0，draft保留在请求记录 | 明确假阳性，不是残缺参数执行。应匹配特定残缺payload而非泛用词 |
| programmatic子调用间用户steer | 只执行read；text.replace为not-started/steering，revision0/Undo0；programmatic结果cancelled，任务最终completed而测试期望partial | 内容保护成立；完成状态合同需明确。不能称为已修/旧夹具，也不能说用户改口后仍写入 |
| HTTP流式预览/lost ACK | 原运行失败记录为STACK_TRACE_ERROR/等待超时表现，定位测试433行 | 尚未收敛根因；需要独立复现其等待条件、请求/ACK和收口，不据此改停止/CAS |
| M15异部位预览并发写入 | 同类STACK_TRACE_ERROR/等待超时，定位555行 | 尚未收敛；需区分fixture等待、上下文变更与实际竞争 |
| 两种cooldown都可停止 | 1040行预期布尔true而false | 尚未收敛；需核实际调度/停止时点，不能只延长timeout |
| OAuth完整轮归档 | 1531行数值断言收到undefined | 尚未收敛；需核compaction触发与实际wire，不应假定泄漏或无害 |

独立观察文件：

- [probe-job-cancel.json](probe-job-cancel.json)
- [probe-native-round.json](probe-native-round.json)
- [probe-incomplete.json](probe-incomplete.json)
- [probe-child-steer.json](probe-child-steer.json)
- [engine-observation-summary.json](engine-observation-summary.json)

这些观察证明相应失败点的实际状态，不替代原测试后续尚未执行的全部断言。未裁定的四个Engine红例应作为相关执行边界重构的前置，而非整个系统所有工作一律暂停。

## 5. 公开写回执六个红例

这六项不能根据报错中出现applied等文字就解释为提交失败。三项大小/数量样本及内部回执测试的失败发生在检查完整值形状；public applied、revision、小回执及此前断言已经通过。

当前源码：

- CourseV10Driver.ts:30–34使用describeComponentOperationChanges；
- courseV10Operations.ts:1137–1166将data.set的html变化细化为路径`instances / id / data / html`，value为字符串；
- DocumentSession.ts:299–303原样克隆内部回执，不会把该字符串自动包装成`{html: ...}`。

原测试112行的三项样本、227行内部回执仍按`changes[0].value.html`断言，因而在正确写入后失败。Gateway257行需结合最终专项诊断核对同一形状；Source198行的files缺失需读实际diagnostics，不能推成授权或持久化失败。

源码判读与未决项见[DOCUMENT_COMPONENTS.md](DOCUMENT_COMPONENTS.md)。四例为确定的形状假设漂移，Gateway第五例高度疑似同因但未追加实证，Source文件列表缺失仍未定性。对内部完整回执与公开紧凑回执，应分别验证其职责：前者保留确切变更，后者不携带MB级正文但能查证版本/目标/效果。

## 6. 作品和交付证据

### 本轮实际重新测量

- Runtime-first独立HTML、正式r249–r263、offline别名和GLX的大小、SHA256、同gzip6。
- 正式HTML物理脚本/style分段；字面Base64内容哈希去重；与独立HTML14张图片逐字节对照。
- 当前compiled bundle的235个input模块、bytesInOutput及输入依赖归属。

对应文件：runtime-first-artifacts.json、runtime-first-content-comparison.json、compiled-and-generation-metrics.json；原始metafile在远程研究目录。

### 历史真实验收复核

- Runtime-first正式参数编辑保存revision254→257，新profile冷开保持caption/image/color。
- r263桌面/移动运行交互、相位正反、空闲无多余绘制；桌面仍有83.4ms长帧。
- 原v08资源/字体/Player优化的正式导出、HTTP/file字体与Canvas修复记录。
- 10月23–24真实输入、Main恢复、保存冷开记录。

这些是项目已有结果文件，本轮未再次启动整个作品验收。保存冷开34,659ms与交付ready约1.16/1.19秒来自不同阶段，不作性能A/B。

## 7. 尚缺的测量与建议

| 未直接测量 | 为什么不编造 | 可重复办法 |
|---|---|---|
| 普通单功能平均修改文件/owner数 | 当前Git大提交是集成批次 | 固定三类普通任务，记录实际职责和变更集合 |
| 纯启动/HMR/增量成本 | 未重启主窗口或修改源码制造样本 | 独立副本测首次/无改/叶子变化，记录构建identity |
| 模型token与推理时间改善 | 本轮未跑真实模型对照 | 复用任务trace，区分模型等待、工具、构建、验证与返工 |
| 全套GUI/IME/旧作品回归 | 本轮是研究，已有针对性覆盖与历史真实结果 | 后续按受影响owner选择已有直接消费者用例 |
| 新桥拆分或新缓存收益 | 仅有可量化候选，无实施 | 先测实际字节、初始化、生命周期和资源保持，再决定 |

本轮没有把外部RDC调用等待算入果铃构建/运行成本。一个额外诊断尝试曾因测试配置include继承范围过宽被停止，只终止本轮自己启动的诊断子树；随后改为精确include和直接文件过滤，形成11.27秒的四例观察。原99项基线不受该诊断覆盖。
