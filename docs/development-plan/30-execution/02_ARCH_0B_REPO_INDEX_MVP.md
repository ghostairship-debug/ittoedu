# ARCH-0B：轻量 repo-index 与 Context Pack 安全门禁

本阶段与 ARCH-0A 并行，不修改产品运行时代码。目标是让三个 Worker 在广泛并行前获得可靠、可检查、低维护的任务上下文；不是建设代码知识平台。

## 1. 最小范围

V1 只回答：从哪里开始、合同/carrier 在哪里、直接写路径与高信号消费者、相关测试、索引是否新鲜。

V1 不做函数级完整调用图、业务读写全自动推断、向量检索、数据库、Watcher、外仓源码图或百科式 semantic。

## 2. IDX-00 Parser Spike

先验证当前 TypeScript 版本下的薄适配层能稳定提取文件、static/type/dynamic import、export/re-export、顶层高信号符号和测试名称。若不稳定，自动改用锁版本的轻量解析器或 scanner，并记录技术裁决；不阻塞其他 ARCH-0A 工作。

## 3. IDX-01 Deterministic Facts

生成最小 files/symbols/edges/tests/contracts/scripts manifest：

- 相同输入逐字节一致；
- 路径相对仓库且统一 `/`；
- 不写时间、用户名和绝对路径；
- 生成物不自引用；
- check 模式在临时目录比较，不改工作树；
- source/semantic/config/generator hash 能识别 dirty 或 stale 输入。

## 4. IDX-02 Context Pack

支持 feature、symbol、path、changed 和保守自由文本查询。输出：freshness、confidence、当前状态、合同/carrier、Start Here、写路径、高信号 consumers/tests、must preserve、minimal validation、unknowns。

低置信不得伪造确定答案；自动降级到手工 Bootstrap，并把 unknowns 写入任务卡。

## 5. IDX-03 黄金任务与 ROI

先用至少 15 个真实历史任务完成生成、查询和低置信降级的受控试运行；扩展到至少 25 个并通过准确性门禁后，才允许 ARCH-2 起的广泛多智能体派工。任务至少覆盖三 Surface、媒体、组件、Runtime/互动、保存/预览/导出、三个 tsconfig 和桌面边界。门禁：

- 关键 canonical/contract 起始文件命中率达到约定阈值；
- 关键消费者或测试漏读为 0；
- 高置信错误为 0；
- 相同输入排序稳定；
- 查询满足交互使用；
- 相比 Bootstrap，定位时间或上下文体积有可观察改善；
- 一次普通合并后的维护成本可接受。

完整函数调用图、更多 semantic 和重型检索只有 ROI 成立后再扩；它们不是派工门禁。ARCH-1 的单一纵切可在 15 个任务受控试运行或完整人工 Bootstrap 下先行，但 25 个黄金任务是广泛自动派工门禁。

## 6. 并行派工

- Worker A：parser spike 与 fixtures；
- Worker B：deterministic generator/check；
- Worker C：历史任务盲测、Bootstrap 对照与 Context Pack；
- Coordinator：schema、semantic 单一 owner 和集成。

generated 只由 Coordinator 在波次门统一更新；Worker 分别报告 `Semantic index impact` 与 `Generated refresh`，不得把“无需 semantic 更新”写成“源码不影响 freshness”。

## 7. 广泛多智能体开发前门禁

项目知识索引是本轮自动开发的必要基础设施，不因 parser spike 困难而取消；spike 失败时只能更换为更朴素、确定性的解析方式。ARCH-1 的第一个受控纵切可在完整人工 Bootstrap 和单一 Integrator 下先行，但 ARCH-2 起的广泛多智能体迁移必须等待 25 个黄金任务及上述门禁通过。不得在索引失真、Context Pack 高置信误导或合同路径未知时广泛派发产品代码任务。
