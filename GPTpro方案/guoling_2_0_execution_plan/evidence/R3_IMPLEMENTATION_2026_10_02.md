# R3 续接工程与验收增量（2026-10-02）

基线 `main@28bdd7f5`，保留中断工作树，未提交／推送。完整实施、失败去向、实际资源和剩余边界见[实施记录](../../../docs/development-plan/reviews/2026-10-02-harness-production-convergence-implementation.md)。本文是当前增量证据，不改写 B19–B24／旧 REL 或 Owner 接受。

| 用例 | 本次状态 | 证据与实际覆盖 |
|---|---|---|
| M29-T01 | passed | DeepSeek 官方 `deepseek-flash`、既有 API 计量账号，真实搜索→正文分页→引用报告；合法无摘要来源和换 URL／版本的恢复边界已覆盖。日志 `r3-traces/real-native-final.txt`、`r3-traces/resumed-real-continuation-complete.txt`、`r3-traces/resumed-context-final.txt` |
| M30-T04 | passed | 真正零 V9 数据任务，实际 Podman 执行新 Python，20／22／31 合计 73；Python／JSON／SVG／CSS／HTML 全部落盘，报告局部修改保存重开，原 CSV 及其余成果保留。日志 `r3-traces/resumed-real-compute-complete.txt` |
| M29-T04 | not_run | 原 CLI 写入阻断消除；Codex 0.159.3／gpt-6-luna／priority／ChatGPT 的真实有界副本产生精确结果，父 JobService 回读、根外哨兵保留。`r3-traces/runner-exact-live.txt`。完整父模型采用成果并继续未运行，取消／unknown 是近层测试证据 |
| M30-T05 | not_run | 真实搜索、32k 窗口研究压缩、来源回读和显式修复续接完成；原报告／输入保留，原 partial 日志保留。完整 PDF／DOCX／PPTX＋用户 Skill＋换源组合未运行，不能登记整项 passed |
| M30-T01 | passed（工程） | 真实引擎链（本地桩 provider、真实 `ExecutionEngine`＋`DocumentHostService`＋`AgentFileService`＋`ExecutionChangeReviewService`）驱动多文件写→receipt 自动入库→inspect only 真实变化；alpha 单独 revert、beta 完整保留（逐项部分回退、非全局伪原子）；用户后改与 after-version 不符即 `conflict` 拒回退且不覆盖。测试 `tests/integration/g20ChangeReviewEngineChain.test.ts`＋`g20ChangeReview.test.ts`（重进不替换 before／新建文件删前保全）＋手动 Electron 日志 `output/g20/b24/m30-review-fork-electron-r3.log`；证据 `output/g20/m30/change-review-engine-chain-20261002/` |
| M30-T02 | passed（工程） | 真实 `runToolRoundInOrder`（引擎第 1982 行唯一调用点）补充断言：慢读 settle 前 write 连 `execute` 都未发起，按序回填；并行启动／按序／四并发上限／写屏障由 `tests/integration/g20ReadOnlyParallel.test.ts` 覆盖；fork 重新授权不带旧 grant／陈旧源拒绝／聊天与内容恢复分离由 `g20CheckpointFork.test.ts` 覆盖；fork 用户侧真实 UI 子流程见同一手动 Electron 日志。长期压缩后完整回溯链未单跑，由 S05 压缩续接证据复用 |
| M18-T06 | passed（工程） | R3 按目标持续创作指导、Skill 与发布资源同步；`r3-traces/final-regression.txt` 中 Skill 合同／同源检查，既有六页 Runtime 导入保存证据继续有效；不证明真实模型教学质量或 Owner accepted |

研究压力原运行 `native-live-7180f3aa-f6cf-4b7e-9525-bf6d9a22d742` 保持原 `partial`；新继续运行 `native-live-368e0d01-041e-43ee-914e-11bf2a9866ca` 为 `completed`。不能写成首轮清洁成功。数据工作区 `native-live-6284bcde-1074-4375-b06a-12d4c2e97fe4/workspace`，全部实际产物仍在仓库 `output/g20/r3/` 下。

本次模型账号实际扣费金额未知；没有发布凭据。表中的真实服务证据、fixture、渲染检查和计划一致性分开使用；验证数量有重叠，不相加。保留单 writer／CAS／冻结授权／停止／unknown 边界，没有新的执行内核或额外平台。

最新三端类型、两端构建，以及代码变化对应的 26 个恢复／投影／结算检查与 2 个真实 Electron 创作检查通过；相关无密钥日志保存在 `r3-traces/`。M25–M30 未全 verified，完整组合和 M30-T08 Owner 接受仍在权威登记中待完成。
