# 架构第四轮结果：停止与丢ACK红例定性（2026-10-24）

**两条历史红例均确认是测试夹具漂移，已等价维护并恢复行为验证；没有需要修改产品源码的证据。** 冷却停止和真实HTTP流式预览／丢ACK查证用例分别通过，主配置类型检查通过。本轮未启动P2-D整体重构，未commit、push、打Portable、发布或部署，原有未提交成果保留。

范围依据为[原方案§11](../../../output/architecture-audit-20261024/IMPLEMENTATION_PLAN.md#next-round-after-third)。唯一代码增量在 [g20ExecutionEngine.test.ts](../../../tests/integration/g20ExecutionEngine.test.ts) 的两条用例；该文件本轮开始前没有未提交改动。Engine、重试策略、Gateway、EditSession、共享refsOf helper、生产配置和依赖均未改。

## 冷却期间停止

原用例复现失败于长冷却等待条件：它要求事件label等于“等待服务冷却”；当前Engine对短／长等待统一发出 `status: retrying, phase: retry`、label“等待重试”。短冷却停止及无替代请求断言已先通过，长冷却尚未进入stop断言。见[原始失败](../../../output/architecture-fourth-round-20261024/stop-baseline.log)。

本轮将两次等待都限定为当前run的结构化重试事件，不以展示文案判定功能。原短／长停止终态、长等待期间running、请求次数等断言保留，并补充60秒rate-limit事实、正式正文／revision／Undo未变、预览为空及没有document.commit事件。

[候选日志](../../../output/architecture-fourth-round-20261024/stop-candidate.log)证明：两种等待均可中止，最终stopped；各run仅一次模型请求，两run合计两次；没有正式修改或预览残留。60秒是供应商retry-after输入，不实际等满60秒，也未增加测试timeout或缩短产品等待。该结论不扩为所有停止／恢复路径新验收；已提交内容与终态保护实现未变。

## 正式提交后ACK丢失

原用例先在本地HTTP服务筛选工具时抛出 `Cannot read properties of undefined (reading 'content')`，随后等待预览超时：它用 `tool.function.parameters.properties.content` 识别目标工具，假定遍历到的所有schema都有properties。此时尚未到预览／提交，不能归因于丢ACK恢复。见[原始失败及未处理异常](../../../output/architecture-fourth-round-20261024/ack-baseline.log)。

本轮改为在真实请求暴露的工具中查找 `modelToolWireName('text.replace')`，保持真实Provider wire别名和广告能力；未改工具定义、参数schema或HTTP流。原消息位置提取在本次实际wire正常，未顺便改共享refsOf或其他夹具。

原用例先调用真实Gateway完成提交，再注入lost ACK异常。原有正确断言全部保留，并补显式spy证明：最后一次查证使用同一run／call／输入，返回document-operation applied。提交前已有一次查重，异常后另有一次查证；约束一次正式执行及恢复事实，不把只读查询次数作为产品义务。

[最终日志](../../../output/architecture-fourth-round-20261024/ack-final.log)证明以下原链路实际触达并通过：

- 未完整参数先进入预览，正式正文和Undo不变；完整参数只执行一次，模型请求共两次。
- 丢ACK后查证原操作成功，精确保留Unicode／换行／转义文本；另一文档不变，只有一次History和document.commit事件。
- 模型续接保留原生reasoning、signature、tool-call关联和applied工具回执；显示文本顺序正确，工具结果不夹带推理。
- 结束时预览清空，一次Undo恢复原正文。

没有改写真正unknown的处理，也未把无法查证的副作用转为成功；本轮证明的是当前可查证提交用例。中途新增的“lookup仅一次”断言不符合已有提交前查重行为，已按源码证据撤去，改验最后查证身份及applied结果；不是产品缺陷或放宽一次写入断言。

## 最小充分验证与独审

| 变化／属性 | 实际验证 | 结论 |
|---|---|---|
| 停止夹具与原停止行为 | `node node_modules/vitest/vitest.mjs run tests/integration/g20ExecutionEngine.test.ts -t 'stops both short and long same-task cooldowns' --reporter=default` | 1项选中通过；长短分支都执行。未选56项不计通过。 |
| ACK夹具与完整原行为、原操作查证 | 同文件 `-t 'streams real HTTP arguments into previews' --reporter=default` | 最终1项选中通过，无未处理异常；未选56项不计通过。 |
| 改动测试的类型覆盖 | `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit --incremental --tsBuildInfoFile output/typecheck-cache/main.tsbuildinfo` | 0退出，见[日志](../../../output/architecture-fourth-round-20261024/typecheck-main.log)。主配置包含tests/integration；未改变第三轮三段检查义务。 |
| 夹具等价性及范围 | 未参与本轮实施的architecture_review只读独审实际diff、原失败与最终证据 | 独审通过：两条夹具漂移的等价维护，正确行为未放宽；无须产品修复或追加M15／其他矩阵。 |

两条用例分步通过后，后续只增补ACK查证断言，因此只重跑ACK；停止证据继续有效。产品和共用helper未改，无新增直接consumer需要回归；未跑M15、OAuth归档、公开回执剩余项或其他全矩阵，未跑GUI／Player／构建／付费模型。它们没有获得新的通过结论。

## 保全与收口

本轮前的dirty patch、路径清单、目标测试副本和原始失败保存在[证据目录](../../../output/architecture-fourth-round-20261024/)。没有reset、stash、clean或覆盖工程；导航采用增量更新，保留既有结果。本轮单writer、单会话实施，未创建额外active任务；只读独审不持写锁。

两条红例的定性与等价维护已完成，不标记为P2-D结构迁移完成，也不追加其他架构优化。原审计[VALIDATION](../../../output/architecture-audit-20261024/VALIDATION.md)保留其历史14红例，不能从本次两项通过推断其余已绿。P1-C其他配置仍为条件候补，P5-A保留原实现，其余包按原条件暂缓。
