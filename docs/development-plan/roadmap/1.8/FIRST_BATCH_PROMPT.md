# 1.8下一批实施启动说明

2026-09-09按[统一方案](../../../../AI编辑最短路径产品决策报告.md)更新。本说明供后续明确启动产品实施时使用，本轮仅改计划。完整边界、非重叠写域和验证选择见[当前执行包](FIRST_BATCH_EXECUTION.md)，公共语义见[共同实施合同](IMPLEMENTATION_CONTRACT.md)。

先核对当前路线、任务板、相关源码/合同/测试与未提交改动，保留用户报告和已有实现；不reset/clean/stash或从旧HEAD覆盖当前版本。089–104已集成，9月8日四修不再是全部下一批。复用其未受影响证据，当前任务是关闭已核实剩余缺口。

090先定义配置创建、usage等当前公共增量；不依赖新字段的图片、帮助和消息修复同步开始。A/B/C/D沿用统一方案命名；C的既有patch接线随A/B推进，实测未触发的深化不阻塞D。

1. **A批：正确性与最小观测。** 修有效PNG正例并保留原坏输入负例；复用图像copy-on-write及局部引用事务，贯通首候选诊断。091/092修创建前模型选择、分阶段确认、同模式稳定Schema、真实last/total usage和typed消息；094分段定位目录/解析/配置并复用缓存。095/096/099/104修选区必要卡、help、operation/mode域和旧full shared revise提示，一次发现取得可用完整卡。
2. **B批：短操作与可靠结束。** 090稳定短操作/终结尚需的增量strict合同；097将当前request别名展开为完整正式candidate，保持精确身份/范围与唯一事务。100/101/102贯通finish、正式unchanged与必要observe/continue到main/renderer/AiTask持久化和UI；preview待应用不算完成，成功无需额外总结推理。回执保存失败只重试记录，原生待送不伪装已送，跨崩溃未知不重提事务。已有20分钟绝对预算覆盖观察至提交前，等待不延期，无进展按失败基线后连续两次停止。
3. **C批：复杂编辑效率。** 先用已有patch/多步候选完成整页与互动修改；重复观察/检查/资源传输只有实测为主要瓶颈才深化，后续连续优化归099/1.9-050。
4. **D批：有限真实汇合。** 先一家CLI纵切共用链，再由103汇合三家和双入口。精确编辑与整页/多步/实例及共享组件/真实Runtime互动分别验收，完整失败证据保留。固定effective model/effort/service tier，区分首次正确可用结果、任务终态、auto/preview、冷/热和用户等待；不以坏输入、3次P95或推测百分比冒充速度改进。

一个协调Owner持有共享合同、harness/repository、generationTaskController、IPC与公共测试；codexAppServer和generationSnapshot分别各一个writer。独立叶子按执行包分配精确文件到隔离工作区，共享变更顺序集成；窗口/输出/工程写入串行。现有172节点、依赖和写锁不改，不复活旧W包或批量创建active卡。

沿用V9、Published V2、三Surface、原生CLI循环/文件/终端/工具/Skills和真实授权、唯一工程与资源事务。短传输不是新live工程API或第二Schema真相；不建应用模型循环、MCP/通用RPC、第二任务/History。当前完整观察与UI按实际实现验证，只有实际有限generation-snapshot分支继续preview边界。Native/Recipe/Existing Component按自身门，Generated Component/Runtime保持真实准入；smoke不代替任务语义与教师验收。

每个变化选直接命名检查，依实际制品变化准备一次；新增行为先补用例再选择，0匹配不算通过。执行包列的是测试导航，不是全量运行清单；局部不得整文件隐式触发stabilizationCoreUsability三CLI付费矩阵。旧恢复/退出/Flow路径仅因相关变化或新失败补检。

完成获授权的具体批次后交付实际结果、证据及未完成项。原103与050、051/052、083/087、060/S3保留，不标accepted或自动发布。1.9继续042未命名/首存、045材料、044自动/手动流程、041工作台及043/050连续任务；2.0软件内完成全部QA/修复/导出。条件优化按实测触发，不自动启用Auto、换模型、直连API或新付费服务。
