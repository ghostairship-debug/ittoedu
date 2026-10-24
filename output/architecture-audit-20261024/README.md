# 果铃全系统架构审计研究包

日期：2026-10-24。项目：D:\果铃工作台。原研究以当时dirty工作树为对象；后续实施事实以各轮唯一结果为准。

Git交付：Owner现已授权本批commit／push。版本化本目录四份方案／审计文本和逐轮结果，原始运行日志、before副本及隔离试验保留本地；相关相对链接用于本机追溯。其他未提交成果保留，发行／Portable／部署继续暂停。

**整体收口评估：本批可以结束。** 原P0—P6及各子包的当前完成边界、历史未决和重启条件统一见[IMPLEMENTATION_PLAN §15](IMPLEMENTATION_PLAN.md#architecture-batch-closeout)。全部已选范围收口，P5-A计量后不采用；未选广义重构暂缓，不安排默认下一轮。原14红例中4项有后续原例关闭证据，其余10项不计已绿，也不等同10个当前缺陷；§13另遇两条目录失败已由§14维护关闭。本次仅文档核对，未改代码／测试／配置或运行验证，现有dirty及发行暂停保持。下述各轮“最新／下一轮”保留历史时点。

**§14执行结果：** 目录预期、只读提交与取消归属夹具及真实持久消费者已维护，见[唯一结果](../../docs/development-plan/20261024-architecture-service-discovery/RESULT.md)。7项不同相关检查、主类型与独审通过；未发现实际越权，产品源码／权限／检查配置未改。本批选中架构优化收口，其余历史未决保留、不自动追加；现有dirty保全，未commit／push／发布。下述“本轮后再评估”保留执行前时点。

**本轮后再评估（仅方案）：** 最新取舍、两条服务发现旧失败定性及下一轮标准见[IMPLEMENTATION_PLAN §14](IMPLEMENTATION_PLAN.md#next-round-after-positive)。三个正收益切片收口；下一轮仅优先维护内置asset.search／当前jobs目录预期和只读提交／取消所属作业的夹具，真实归属需定点验证，不预先修改产品权限。其他架构包暂缓，本次未改代码／测试／配置或运行测试与构建；下述各轮说明保留历史时点。

**§13执行结果：** 三个正收益切片已按P2-D→P5-D→P2-E完成并逐项独审，见[唯一结果](../../docs/development-plan/20261024-architecture-positive/RESULT.md)。42项相关检查及完整三段类型检查通过，实际双Player／资产库冷开覆盖；服务目录2条既有失败经before策略对照保留未决。未追加包、commit／push／发布，既有dirty保全；下述§13方案已执行，不自动重启。

**正收益部分接续方案（本次仅方案）：** 最新选择见[IMPLEMENTATION_PLAN §13](IMPLEMENTATION_PLAN.md#positive-return-next-slices)：P2-D模型结果投影归位→P5-D内容程序分类归一→P2-E三项资产库维护工具按需暴露。当前源码提供明确职责／重复规则位置；收益与验收分别记录，不预签模型或运行提速。P5-B／C等保留具体证据候补；本次未改代码／测试／配置或执行验证，不启动任务与发布动作。

**第五轮执行结果：** Electron／e2e noEmit增量已分别采用，暖完整3.13／5.18秒对无改增量0.55／0.79秒；确定错误诊断及恢复、最终精确参数无cache执行通过，独审通过。见[第五轮唯一结果](../../docs/development-plan/20261024-architecture-fifth-round/RESULT.md)。三段检查及正式emit保持，未测新的全链耗时，未追加其他包；现有dirty保全，未commit／push／发布。§12建议已执行，不自动重启。

**第四轮后再评估（本次仅方案）：** 最新取舍与验收见[IMPLEMENTATION_PLAN §12](IMPLEMENTATION_PLAN.md#next-round-after-fourth)。已实施切片、两条夹具维护及P5-A不采用决定可收口；若继续下一轮，仅优先P1-C剩余noEmit入口，先Electron、后e2e，各自有收益才采用。P2-D等结构方向暂缓，M15／OAuth保留未决，不按历史红例逐项扩面。本次仅维护方案和导航，未改代码／配置或执行新验证；下述早期“最新／下一轮”保留历史时点。

**第四轮执行结果：** 停止和丢ACK两条红例均为夹具漂移，已等价维护；原行为及同操作查证、两项选中检查／主类型检查／独审通过。见[第四轮唯一结果](../../docs/development-plan/20261024-architecture-fourth-round/RESULT.md)。产品源码未改，未启动P2-D整体重构或追加矩阵，现有dirty保全，未commit／push／发布。下述§11建议已按此范围执行。

**第三轮后再评估（本次仅方案）：** 最新取舍、下一轮范围及验收见[IMPLEMENTATION_PLAN §11](IMPLEMENTATION_PLAN.md#next-round-after-third)：先裁定冷却期间停止，再裁定正式提交后ACK丢失，必要时修复各自实际断点；P2-D结构迁移暂缓。P1-C其他配置为条件候补，P5-A按当前计量停止，其余包等待具体证据。本次只维护方案和导航，未改软件／测试／配置，未执行新验证。下述各次“本次／下一轮”保留为历史时点。

**第三轮执行结果：** 主类型检查增量已采用，P5-A计量完成、收益不足未采用优化，见[第三轮唯一结果](../../docs/development-plan/20261024-architecture-third-round/RESULT.md)。实际三段检查及独审通过；现有dirty保全，未commit／push／发布。下文“仅方案”为前次评估时点。

**第二轮后评估（本次仅方案）：** 剩余工作包及P1-C／P5-A进入条件统一见[IMPLEMENTATION_PLAN §10](IMPLEMENTATION_PLAN.md#next-round-after-second)。两包可进入小范围试验；优先P1-C主配置增量与诊断对照，随后P5-A同次Source解析计量，各自证实收益才局部采用。未运行试验或修改代码／配置，其他包暂缓。

**第二轮执行结果：** P2-B与Source正确性修复已完成，20项选中检查、相关类型／构建及独审通过，见[第二轮唯一结果](../../docs/development-plan/20261024-architecture-second-round/RESULT.md)。广义P2-C优化未实施，其他候补未启动；原有dirty保全，未commit／push／发布。下述“仅方案”说明保留为前次评估时点。

**首轮后接续评估（本次仅方案）：** P1-A／P1-B／P2-A／P3已完成，见[首轮结果](../../docs/development-plan/20261024-architecture-first-round/RESULT.md)。剩余包取舍、下一轮顺序与验收统一见[IMPLEMENTATION_PLAN §9](IMPLEMENTATION_PLAN.md#next-round-after-first)：先定性Source单条红例，以P2-B为主，P2-C按正确性／可删重复的实际证据进入；P1-C及P5-A为后续候补。未启动下一轮代码、测试或构建。

**2026-10-24 方案评估后修订：** 已在原[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)中明确工作包边界、依赖、验收与停止条件。该文件为唯一实施顺序入口；专项报告保留原研究定位与证据，其工作包建议按修订版映射，不作为另一套开工清单。本轮只改方案及导航，没有实施代码、测试、构建、GUI或模型验证。

首五轮及§13选中切片已收口。P0按包裁定相关红例，P6随包退出旧路径；其余条件方向保留，不自动启动。World继续不接管PM／React视图树或输入。

## 阅读顺序

1. [主报告 REPORT.md](REPORT.md)：结论、真实架构、六大系统、Runtime-first案例、成本、路线选择。
2. [实施方案 IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)：评估后修订版；§5为逐包范围/依赖/验收，§6为并行与采用，§7为验证选择，§8为收益证据。
3. [真实故障 BUG_CHAINS.md](BUG_CHAINS.md)：12条需求→故障→修复→结构原因，区分架构、实现与验证/集成。
4. [验证 VALIDATION.md](VALIDATION.md)：85/99通过与14红例的准确含义、源文件完整性和未测范围。
5. A/B [DOCUMENT_COMPONENTS.md](DOCUMENT_COMPONENTS.md)、C/D [SURFACES_RUNTIME.md](SURFACES_RUNTIME.md)、E [COMPILE_DELIVERY.md](COMPILE_DELIVERY.md)、F [AGENT_HARNESS.md](AGENT_HARNESS.md)、[DEVELOPMENT_COST.md](DEVELOPMENT_COST.md)。

## 原始数据

- source-metrics.json：规模、依赖、Git历史/状态/工作树、构建入口。
- boundary-evidence.json：实际跨层边、值环、热点方法。
- typecheck-timings.json / build-timings.json：单次测时及条件。
- compiled-and-generation-metrics.json：compiled闭包和默认组件生成比对。
- tool-profile-metrics.json：目录与合成GLX能力投影，字节不是token。
- focused-test-summary.json：七文件99项测试原基线。
- probe-*.json：原断言前捕获的Engine实际状态。
- runtime-first-artifacts.json / runtime-first-content-comparison.json：真实1.9/5.13MB产物拆账与资源哈希。
- source-integrity-after.json：1,681源文件与Git状态前后相同。
- evidence/：本轮核读的近期结果、验收JSON和部分源码快照。路径中的__对应原仓目录分隔符。不是另一份维护中的产品源码。

完整构建输出和部分大日志保留在电脑上的同一研究目录，不打进下载包。原作品、生产dist和tests源文件没有被该审计替换。

`DELIVERY_MANIFEST.json`、`report-save-verification.json`和`source-integrity-after.json`保留为原研究交付时的快照，不改写其历史结果；前两者的原报告字节/Hash不代表本次修订文件仍与旧版相同。原始验证与测量文件未因方案修订重新执行或洗绿。

## 复现脚本

请在D:\果铃工作台使用项目已安装依赖执行，输出进入output/architecture-audit-20261024。脚本不会调用模型；测试有fixture和独立临时Electron。

| 脚本 | 作用 |
|---|---|
| source-metrics.mjs | AST依赖/规模/Git/源码基线。再次运行会更新before基线，复测前先另存原始研究目录 |
| inspect-boundaries.mjs | 提取跨层边、环和方法尺寸 |
| measure-typechecks.mjs | 三套noEmit，跳过npm prehook |
| measure-isolated-builds.mjs | Player/Renderer/Electron独立输出，不替换现用dist |
| measure-compiled.mjs | write:false生产compiled构建与组件生成比对 |
| tool-profile-metrics.mjs | 纯能力目录投影，不运行模型/文档写入 |
| measure-focused-tests.mjs | 执行本报告七个原有测试文件 |
| probe-engine-failures.mjs | 四类失败的定向诊断复跑 |
| observe-engine-failures.mjs | 自动生成独立诊断测试副本，在原断言前输出状态，原断言保留 |
| inspect-runtime-first-artifacts.mjs | 实际GLX/HTML的大小、hash、脚本/style和Base64统计 |
| compare-runtime-first-content.mjs | 正式/独立HTML图片、字体及JSON载体对照 |
| verify-source-integrity.mjs | 与before基线逐文件比较，不重建基线 |

研究和本次方案修订均不是代码实施授权。后续按Owner明确目标选取修订版工作包；没有预填节省人日或提速比例，不新建全局平台、必读文档体系或常驻台账，也不为方案修订修改当前任务板/发行状态。
