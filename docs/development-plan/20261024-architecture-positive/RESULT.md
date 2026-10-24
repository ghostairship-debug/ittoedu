# 架构正收益切片结果（2026-10-24）

**P2-D模型结果投影、P5-D内容程序分类、P2-E三项资产库维护定义按需暴露均已完成本次选定切片的开发、最小充分验证与逐项独审，可收口。** 42项不同相关检查通过，完整三段typecheck通过；另2条服务目录旧失败在修改前策略下同点复现，保留未决，不计通过。

依据[原方案§13](../../../output/architecture-audit-20261024/IMPLEMENTATION_PLAN.md#positive-return-next-slices)，按P2-D→P5-D→P2-E逐项开发、验证、独审和记录。现有未提交成果保留，不commit、push、打Portable、发布或部署，不追加其他工作包。

## P2-D：模型结果投影归位

Engine原有programmatic.execute模型摘要／观察完整来源／有界回执接线迁入现有ExecutionContextProjection的 `projectCurrentToolResult`。输入是窄ProgrammaticJournalEntry、只读子记录和可信sourceId；原ProgrammaticToolRunner及modelToolResult仍负责各自专业解释，未复制规则或引入第二执行器。

Engine中上述专业分支退出，保留原始结果、执行／查证、停止／unknown、UI事件／提交顺序、host调用处理、模型消息追加及checkpoint。历史投影、compaction、交付保存和preflight未动。

最小充分验证共21项通过：g20ContextProjection16项、observationTransportModelBoundary1项、真实Engine的HTTP丢ACK及PTC大值／同任务回读2项、ProgrammaticToolRunner原始回执／小值2项。实际Engine用例保留原生消息配对、推理／signature、一次提交／History、Undo、预览清理与原来源回读；未选64项不计通过。Electron noEmit通过。证据为[p2d-projection.log](../../../output/architecture-positive-20261024/p2d-projection.log)、[p2d-engine.log](../../../output/architecture-positive-20261024/p2d-engine.log)、[类型日志](../../../output/architecture-positive-20261024/p2d-typecheck-electron.log)及[p2d.patch](../../../output/architecture-positive-20261024/p2d.patch)。

未参与实现的architecture_review独审通过：原始结果、UI／提交、lookup、stop／unknown、原生配对和checkpoint顺序保持，无新增执行路径；21项和Electron类型检查足够，可进入第二项。收益为职责归位与专业维护位置减少，不扩大为整个P2-D完成或运行提速。

## P5-D：内容程序分类归一

新增轻量共享语义 `isContentProgramImplementation`，输入既有有效implementation，只判断Source／builtin web／html-program；没有运行时依赖、登记表、IR或缓存。World、外层呈现、Published准备及compiled程序子项四处同义决策均改用该owner。各自的root／container／data、可见性、挂接、CSS／factory／native路由保持；只需builtin web的分支未扩大为Source。

新增真实呈现反例覆盖普通image、Source override、Source definition被builtin text覆盖、两种web builtin和非root局部位置，验证viewport与局部frame保持。componentPresentation7项、compiledEffectiveSource3项通过；另1项真实Chromium场景在Published与compiled两种Player中实际挂接、互动、重绑／释放程序原生子项通过，未选5项不计通过。主配置noEmit通过。

证据为[p5d-semantic.log](../../../output/architecture-positive-20261024/p5d-semantic.log)、[真实Player日志](../../../output/architecture-positive-20261024/p5d-player.log)、[主类型日志](../../../output/architecture-positive-20261024/p5d-typecheck-main.log)。[相对本轮before的diff](../../../output/architecture-positive-20261024/p5d-existing.patch)保留World原有dirty，不以HEAD替换；新增共享模块另见源码。

architecture_review独审通过：四处同义规则由唯一轻量helper提供，有效override及各消费者局部条件保持；10项语义、真实Chromium双Player原生子项与主类型证据足够，无须追加生命周期矩阵。收益仅为重复分类规则退出，可进入第三项。

## P2-E：三项资产库维护定义按需暴露

在原ToolRegistration.exposure元数据增加deferred，沿原visibleRunToolNames／loadedNames处理，仅asset.save、asset.import、asset.delete默认延后。tools.load现有说明列出三项名字与适用请求；未创建新family／目录／路由。其他默认策略、schema、注册handler、效果分类、冻结授权和合法按名调用保持。

真实Engine／Gateway新例验证：初始保留asset.search／use／update；三个维护定义可从已有说明发现，经tools.load在同run下一请求出现并调用原服务；重复加载不重复注册，未知名称逐项诊断，缺服务项不暴露，只读run加载后仍不能调用三项写服务。库维护不改变正式正文、revision、History或binding。该新例使用隔离服务fixture验证接线，没有把未配置图片服务当成可用能力，也不把通知sequence增长误认为作者内容修改。

该样本初始真实wire工具定义47,225B，加载三项后49,757B，三项追加定义差2,532B；是同run披露量对照，不是旧版本完整请求／token／费用对照，也不证明真实模型自主采用率。原工具合法按名调用仍通过：已有T02真实隔离资产目录链验证保存所选多对象、导入新版本、搜索／使用／更新／删除、原归档保留、工程不随库删除、Undo及新Host冷开续改。

P2-E共10项不同检查通过：g20ScopedToolCatalog原5项及新增1项、g20ServiceToolDiscovery的3项、T02真实资产库1项；未选项不计通过。证据见[发现初次日志](../../../output/architecture-positive-20261024/p2e-discovery.log)、[既有目录5项通过](../../../output/architecture-positive-20261024/p2e-scoped-final.log)、[新增维护链最终日志](../../../output/architecture-positive-20261024/p2e-maintenance-final.log)、[真实资产库日志](../../../output/architecture-positive-20261024/p2e-library.log)。新例初次对未配置图片和完整snapshot通知序号的错误假设已按实际服务／内容合同修正；没有删除既有正确断言。

g20ServiceToolDiscovery另2项保持失败：初始目录断言漏掉当前asset.search；只读作业／媒体案例期望error而得到read。使用[只读before配置](../../../output/architecture-positive-20261024/p2e-before.config.ts)替换本轮前ToolCatalog／ToolRegistration／AssetSourceTools，同两条原断言仍在同位置失败，见[before对照](../../../output/architecture-positive-20261024/p2e-service-before.log)。未改这些旧测试或相关作业／媒体策略，不把它们称为通过或已修，不将其扩为额外工作包；本次资产库写权限拒绝另有直接通过证据。

组合候选完整运行原npm typecheck三段并0退出，见[最终三段日志](../../../output/architecture-positive-20261024/typecheck-final.log)；package、类型覆盖和检查参数未改。P2-D／P5-D有效证据复用，没有因后续工具披露调整重跑未变Player和执行生命周期矩阵。

architecture_review对P2-E独审通过：仅后移三项schema，授权／服务可用性／效果和合法按名调用保持，发现与实际调用、只读／缺服务、正式内容和真实资产库证据充分；旧2失败非本次引入，可保留未决。10项不同检查与完整三段类型检查足够，无本轮阻断项。不再实施其他工作包。

## 最终边界与保全

三个切片各自记录旧决策退出、新owner和直接消费者，独审逐项完成后才推进下一项；未引入第二writer、执行循环、投影Store、资源／编译平台或权限流程。P2-C、P4、P5-A／B／C及P2-D／P5-D未选部分不附带进入，没有新增运行提速、模型采用率、费用或完整Electron验收结论。

本轮起点dirty patch、全路径清单、涉及既有文件before副本及各项日志均在[证据目录](../../../output/architecture-positive-20261024/)。World等既有dirty使用局部修改并相对before独审，没有reset／stash／clean、覆盖原工程或清理未提交成果；最终路径保全与验证汇总见preservation.json／verification.json。package、tsconfig、测试选择定义和既有正确断言保留，前五轮成果未回退。

本轮主执行者单writer实施，另一执行者仅只读独审，未创建额外active卡；未操作真实用户资产库、调用付费模型或进行Portable／部署。未commit、push或发布。
