# 架构收敛首轮结果（2026-10-24）

P1-A、P1-B、P2-A、P3已完成开发、相关最小充分验证及独立增量评审，可按本轮范围收口。原有未提交成果保留，本轮未commit、push、打Portable、发布或部署。其余工作包未启动。

执行依据为[完善后的原方案](../../../output/architecture-audit-20261024/IMPLEMENTATION_PLAN.md) §5；顺序为构建依赖、纯helper归属、对象插入、Flow运行挂接。以下只签述实际检查覆盖的属性，不把首轮完成写成整个架构方案完成或Owner整体接受。

## 实际改变及旧职责退出

| 包 | 最终职责与直接消费者 | 退出的旧路径及验收结果 |
|---|---|---|
| P1-A | 复用 `prepare-source-launch.mjs` 的既有事实索引，将默认组件源码、Player、Renderer、Electron及原helper组织为有依赖的目标；单独构建入口进入同一准备链。Vitest在实际选定测试文件后，仅为声明读取生产Player包的测试准备该产物。 | 删除无条件 `pretest`／`pretest:product` 及重复 `prebuild:renderer`／`prebuild:electron`；原真实命令移入 `build:*:raw`，builtin检查及样例／fixture链保留。实际Renderer链中生成、Player、Renderer各一次，随后Electron只构建自身；无改再次调用Renderer直接复用。 |
| P1-B | `equalComponentValue`归 `src/shared/componentValue.ts`；插入／复制共用的frame政策归 `src/core/course/courseInsertionGeometry.ts`。全部直接使用方指向实际owner。 | 删除Driver中的等值实现及插入模块中的frame实现，无Facade重导出或第二算法。两组目标value依赖闭环消失，原文本关系／操作与几何行为保留。 |
| P2-A | `planCourseElementInsertion`专业规划正文分割、插入位置／默认、初始外观及点击行为；GUI、Gateway共用。外观专业规则归 `componentAppearanceEdits`，原工具入口只适配目标。 | Gateway中央退出对应专业组装，保留句柄／grant、工作副本、展示状态映射、批处理／CAS／回执；GUI保留前台测量和完整目标适配。分阶段计划仍合为一次Session提交与History，保留index／after／at、命名状态及普通根容器。 |
| P3 | `ComponentRuntimeWorld.attachProjection`拥有挂接身份、延迟采用／释放资格、retained root的parking。Flow只提供宿主、有效作用域与视图清理。 | Flow NodeView不再自行绑定／解绑运行根或决定运行根parking；PM／React仍负责自身DOM／root卸载和可复用host恢复。旧挂接释放不能解绑新挂接；临时detach保活，正式删除／World关闭沿原退役路径。公共Player bind接口未替换，未为形式统一迁移无关consumer。 |

默认组件源码真实依赖renderer交互规则和Player状态规则，所以sources指纹覆盖这些现有目录，并排除自身生成物；未建设新的细粒度缓存系统。构建索引继续承担产物新旧判断，不把Hash作为一般功能正确性的门。

P2-A返回分阶段编辑，是为保持现有命名展示状态映射；没有增加第二writer、History或公开wire协议。最终关系清理由既有Session命令统一结算。P3没有把React、PM或编辑器Store引入World，原存活iframe移动与资源释放实现继续复用。

## 验证与原始证据

原始日志统一在[本轮证据目录](../../../output/architecture-first-round-20261024/)。通过项按实际选中部分计数；重复修后检查不重复累计，未选中用例不计通过。

| 待证明属性 | 最小检查及结果 | 证据 |
|---|---|---|
| 构建图、独立目标、无改复用、输入／安装变化失效 | `windowsSourceLaunchContract.test.ts` 8/8通过；覆盖sources／Player／Renderer顺序、单独Electron、未选目标索引保留，以及renderer／Player来源改变时重建。真实Renderer、Electron构建均0退出，无改Renderer不再执行生成或build raw。 | [任务图检查](../../../output/architecture-first-round-20261024/p1-production-tests.log)、[Renderer](../../../output/architecture-first-round-20261024/build-renderer.log)、[Electron](../../../output/architecture-first-round-20261024/build-electron.log)、[无改复用](../../../output/architecture-first-round-20261024/build-no-change.log) |
| 生产bundle真实消费 | 通过npm测试入口，设置 `CREATION_BOUNDARY_USE_DIST_PLAYER=1`，选择 `creationWarningConsumer20261020` 的 retained nonblocking diagnostic 用例；实际读取生产compiled-player包并在Chromium中挂载，1项通过，另2项未选。准备链复用已建产物。 | [实际consumer](../../../output/architecture-first-round-20261024/p1-real-bundle-consumer.log) |
| helper依赖与保留行为 | Babel解析62个可达模块的相对TS value import／re-export，排除type-only，两组均无互达环；`coreExperienceSemanticOperations`定向选择世界frame、命名状态、canonical paste等3项通过，另14项未选。 | [依赖方向](../../../output/architecture-first-round-20261024/p1b-dependencies.json)、[行为](../../../output/architecture-first-round-20261024/p1b-behavior.log) |
| 插入及挂接最近层行为 | `auditGatewayInsertionLayout20261023`、`nativeInsertAppearance`、`flowBodyInsertion20261023`、`projectionAttachment20261024` 共4文件29/29通过。包含GUI普通根目标、Flow caret分割／after、外观／点击／后续修改混合batch、单次Undo、命名状态保留、真实Main存盘重开，以及同host迟释放／取消延迟挂接／子树parking。 | [修后聚焦结果](../../../output/architecture-first-round-20261024/p2-p3-focused-repair.log) |
| Gateway紧凑回执、lookup、幂等及非法输入 | `publicWriteReceipt20261020`只选Gateway相关用例，1项通过，另9项未选。精确读取 `instances/web/data/html` 路径上的字符串值，保留内部完整事实与小回执断言。 | [回执](../../../output/architecture-first-round-20261024/gateway-receipt.log) |
| P3真实DOM／iframe／输入／保存生命周期 | 新 `architectureFlowAttachment20261024` 与原 `flowProjectionUnmount20261022` 共3/3通过。Chromium 149.0.7827.55中正文↔浮层、Undo/Redo和视口变化保持同一iframe realm、同一对象及counter=7；继续双击编辑PM正文，保存／关闭／重开后作者内容保留、运行瞬态按合同重新初始化。原关闭用例覆盖StrictMode开／关。 | [浏览器日志](../../../output/architecture-first-round-20261024/p3-browser.log)、[行为记录](../../../output/architecture-first-round-20261024/flow-browser.json)、[实际画面](../../../output/architecture-first-round-20261024/flow-retained.png) |
| 组合候选类型与差异卫生 | `tsc -p tsconfig.json --noEmit`最终0退出，包含移入scripts的测试前置；Electron真实构建0退出。Git diff检查按仓库现有CRLF识别方式通过。未跑无关全矩阵。 | [类型日志](../../../output/architecture-first-round-20261024/typecheck-final.log)、[差异检查](../../../output/architecture-first-round-20261024/diff-check.log) |

未采用前的第一次聚焦候选有2项失败：[原日志](../../../output/architecture-first-round-20261024/p2-p3-focused.log)。其中真实回退为把命名状态下的初始外观平铺后误映射到base，已改为逐阶段映射并复验；另一项为新增测试把点击规则误认成正文子节点，按实际interactionRules owner修正。没有放宽原有正确断言。

## 原有红例及证据边界

1. 原审计的14项失败仍按[原验证记录](../../../output/architecture-audit-20261024/VALIDATION.md)保留。本轮只核实并等价维护其中Gateway回执相关断言：当前receipt记录的是精确字段路径／字符串，而旧断言从第一项 `value.html` 读取。未顺带更改Engine、Source观察及其他未选回执用例，不将它们写成通过。
2. 为核实生产测试前置运行过 `g20CourseDeliverySnapshot.test.tsx`，初次3项失败；临时诊断运行时1过2失败，不能称全文件通过。[诊断](../../../output/architecture-first-round-20261024/delivery-diagnostic.log)和[第一项等待生成完成后的诊断](../../../output/architecture-first-round-20261024/delivery-first-diagnostic.log)显示：jsdom缺少 `Image.decode`，图片编码产生 `asset-encoding-warning`，无告警直接导出的旧预期不再成立；第二项取消／切文档用例诊断时已通过，初次失败还含异步时序影响。相关交付producer本轮无产品增量。诊断finally已恢复测试，只留下正式的bundle前置header，原断言未改。这些检查不计为交付行为通过；实际生产包消费者另有上表直接证据。
3. 新浏览器证据来自真实Chromium与实际Flow组件／Store／Bridge；保存重开由测试transport承接，另有原 `nativeInsertAppearance` 的真实Main文件存盘重开。它们不等于完整Electron壳层、物理IME、全部旧作品或Owner整体接受。构建通过不替代这些更高层验收。
4. 本轮证明重复构建节点与错误依赖退出、专业规则归属和运行挂接责任收敛；没有可比全流程计时，不宣称普遍开发提速、冷启动提速或稳定帧率。后续P1-C、P2-B～E、P4、P5继续按各自进入条件选取。

## 独立评审与保全

由未参与实施的 `architecture_review` 只读核实际增量及直接消费者，并在修后相关证据齐备后确认“独立增量评审通过，可收口首轮P1-A、P1-B、P2-A、P3。未发现剩余代码阻断”。其确认实际bundle声明、builtin检查及样例／fixture准备义务未削弱，globalSetup迁移未改变测试选择范围。评审不计为另跑了一轮测试。

实施前已保留51个tracked dirty的[原始差异](../../../output/architecture-first-round-20261024/preexisting.patch)、[状态清单](../../../output/architecture-first-round-20261024/preexisting-status.txt)、[未跟踪清单](../../../output/architecture-first-round-20261024/preexisting-untracked.txt)及重叠写入文件的before副本。前一轮交互成果、咖啡作品和恢复数据未删除、reset、stash或clean；没有执行Git提交或对外发布。任务卡随本轮收口删除，任务板仅保留真实待接续任务。
