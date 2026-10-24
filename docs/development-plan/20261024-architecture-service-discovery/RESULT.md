# 服务发现与作业归属夹具维护结果（2026-10-24）

**按原方案§14顺序完成目录预期、只读作业提交和取消归属夹具维护。7项不同相关检查及主类型检查通过，独立评审通过，可收口；产品源码／权限／检查配置未改。** 没有发现需要修产品owner的实际越权证据。前轮成果及原始失败保留，暂不commit、push或发布。

依据[原方案§14](../../../output/architecture-audit-20261024/IMPLEMENTATION_PLAN.md#next-round-after-positive)。本轮仅修改两份测试与结果／导航；不追加其他工作包，不实施Engine、资源、编译或权限重构。

## 服务发现目录

原旧例的初始服务清单漏掉合法的`asset.search`。现按准确集合保留`media.discover`与内置检索；空任务、Markdown和无fileAccess任务均实际调用内置柱形图查询并取得真实能力条目、目录不可用诊断。Markdown作者revision／Undo／Redo保持，查询不调用生成或写服务。无fileAccess时加载jobs／media也无法解析或执行计算、委派、媒体提交，服务零调用；未配置连接仍不被暴露。

原jobs家族9项预期维护为当前13项准确名称与数量，补齐delegate.agent／models／resume／message。首次执行还发现此前未运行到的media家族旧数量1实际为4：media.start及media.apply／media.insert／course.media三个文档工具。按当前完整名称与数量核对；家族目录包含文档工具不等于授予宿主作业权限。没有隐藏工具、从被测注册表自动推导全部期望或把精确集合放宽成任意包含。

目录维护首次执行在media数量断言失败，见[原始日志](../../../output/architecture-service-discovery-20261024/directory.log)；准确维护后目标单例通过，见[目录日志](../../../output/architecture-service-discovery-20261024/directory-final.log)。未选4项不计通过，后续完整文件验证另计。

## 只读提交与取消归属

先对旧夹具记录全部四项结果再保留原断言执行，确认compute.run／delegate.start／media.start均在提交前返回“只读任务不能提交外部作业”，唯一read来自job.cancel，旧服务调用只有job.cancel。见[逐调用旧夹具日志](../../../output/architecture-service-discovery-20261024/readonly-before-fixture.log)。这不是只读创建作业成功；旧jobView只是按请求回显runId，没有任何真实作业。

维护后的目录fixture只记录通过start创建的作业owner／kind和状态；查询、日志、取消、委派回读均查原owner，未知job返回unknown-job，跨run返回job-not-authorized，拒绝在服务效果计数之前发生。只读提交用例将三项分别执行到并验证拒绝、全部start零调用和冻结权限不变；取消单列新增反例，验证加载job.cancel不授予跨run取消权、未知引用不被承认、原作业仍running、合法owner取消为cancelled，reader权限仍为read-only。

原5项完整保留，新添1项取消归属反例，完整目录文件6项通过，见[最终目录日志](../../../output/architecture-service-discovery-20261024/discovery-final.log)。原合法作业status／wait／logs／cancel、委派回读、外部缺连接及外观／文字范围检查继续通过。无skip／删除用例或改变共享测试过滤。

## 真实持久作业直接消费者

选取既有ni02的计算成果接续单例，穿过当前HostToolCoordinator→HostJobService→真实ComputeJobService与隔离磁盘记录；只有计算backend受控，不启动真实Python、外部模型或CLI。

该单例首次在旧取消错误码预期失败：接续已获成果读取后，Coordinator在取消服务之前明确抛出“接续任务可读取原任务成果，但不能取消原任务的作业”，并非旧期望的带job-not-authorized码异常。见[原始直接消费者日志](../../../output/architecture-service-discovery-20261024/durable-before-maintenance.log)。只维护这条直接相关断言，未修改生产错误协议。

补证包括：真实owner对自身已完成作业的取消合法返回原ready回执；冷重建owner后，无关运行和只读reader在未获接续读取前取消均由真实owner拒绝；获接续读取后仍不可取消原作业，ComputeJobService.cancel零调用。原成果status／wait／读取、实际CSV保存及lookup、原作业ready／未stopped／owner、单次backend执行、只读／外运行／停止后保存拒绝及无错误文件均保留。已完成作业的合法取消是原终态no-op，不冒充本次验证了真实进程停机。

该选中单例最终通过，见[直接消费者日志](../../../output/architecture-service-discovery-20261024/durable-final.log)；其余6项未选、不计通过，不附带清理图片／媒体等无关历史用例。

## 验证、独审与保全

不同相关检查共7项通过：目录文件6项＋真实持久作业接续1项。首次失败与逐调用probe保留，不算新增通过。两份测试均在主配置include内，最终原参数主noEmit增量检查通过，见[主类型日志](../../../output/architecture-service-discovery-20261024/typecheck-main-final.log)。Electron／e2e及产品源码／依赖／配置未变，复用前轮完整三段类型与42项相关有效证据，不声称本次新跑三段或全产品测试。现有package三段及所有检查定义、正确行为保持。

未参与实现的architecture_review独审通过，无阻断项、无需追加验证：准确目录与注册owner一致，加载没有替代授权；fixture与真实持久消费者共同证明所属／未知／跨run／接续只读取消边界。错误码改为既有明确拒绝消息是等价维护，取消零调用、状态／保存／lookup／单次backend及禁止错误文件断言保持，未掩盖真实权限问题。7项及主类型检查足够；终态取消no-op、未选6项等限制已准确记录。评审者只读，未编辑或运行验证，原结论见[独审记录](../../../output/architecture-service-discovery-20261024/independent-review.md)。

证据目录[architecture-service-discovery-20261024](../../../output/architecture-service-discovery-20261024/)保留初始全dirty diff／路径清单、两份测试before副本、最终[测试diff](../../../output/architecture-service-discovery-20261024/tests.patch)、全部执行日志及verification.json。产品跟踪差异在前后保持一致，未更改src、脚本、package、tsconfig或vitest配置；保留原有未提交成果，不reset／stash／clean。测试仅使用隔离临时目录，不改真实用户文件、资产库或正式GLX。

未追加其他工作包，未执行build／GUI／付费模型／Portable／部署，未commit、push或发布。M15／OAuth及其余历史未决不因本轮维护而变绿，原三切片结果保持原统计与限制。

§14选中维护与直接消费者证据已闭合，本批架构优化收口；其他条件性方向不自动启动，不宣称全仓测试全绿或完整产品验收。
