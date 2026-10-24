# 果铃全系统架构审计研究包

原架构优化批次已按[§15](IMPLEMENTATION_PLAN.md#architecture-batch-closeout)收口，并提交推送为 `7952cc24`；未选方向仍按原条件暂缓。Claude审查后的本轮实施与当前失败归类见[后续维护结果](../../docs/development-plan/20261024-architecture-review-followup/RESULT.md)。原审计数据及各轮“本次／下一轮／未提交”为历史时点，不回写旧统计；原方案§9—§14保留原位和锚点。Owner本次授权将原有全部未提交成果一并commit并push，发行／Portable／部署仍暂停。

原研究材料按下面入口读取，不据历史阶段建议自动开工。

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
