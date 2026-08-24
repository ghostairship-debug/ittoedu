# Published Producer、Player、Try-run、Preview 与 Export

本文件记录当前边界和候选收口方向，不是格式迁移清单。只有可复现交付风险、真实 consumer 或明确替代/删除目标通过任务准入时，才改变对应路径；其余路径保持现状并复用未失效证据。

## 1. 当前真实双轨

### V2 主路径

```text
active CourseProjectDocument + assets + components
→ buildPublishedCourseV2Payload
→ CoursePlayer / Surface Hosts
→ Try-run / Full Preview / HTML / Web package
```

该路径已经存在，必须保护。

### Legacy fallback

当前初始化、新建和打开都会建立一个活动 V9 session；“无活动 session 的合法 V9 工程”不是正常产品状态。App 中无 publish sources 的 HTML/Web fallback 必须先做可达性证明：正常入口不可达则封死或删除，不得新建 sessionless V9 read model。特定静态导出分支仍可能：

```text
projectCandidatePreviewDocument / state.project
→ buildExportPayload / PublishedLesson V1
→ legacy PlayerApp / HTML/Web/PPTX/PDF capture
```

本轮目标是迁移消费者，不是重建 V2 Producer。

## 2. Player 边界

- CoursePlayer 是 V9 正式运行入口；
- SlidePublishedAdapter / FlowSurfaceHost / SpatialSurfaceHost 负责 Surface 运行；
- Phaser 只保留 Slide 编辑；
- legacy PlayerApp 在消费者清零前保留；
- player 永不导入 renderer store；
- mount/destroy/generation 属 Preview/Player owner。

## 3. Mount helper

当前已有 `beginSerializedSessionMount` 一类轻量 helper。只有已准入的 mount 行为需要且现有局部使用无法满足时，才提升或扩展这个最窄 helper，并只覆盖实际受影响的能力：

- cancel；
- generation guard；
- idempotent destroy；
- onReady/onError；
- 不新增通用状态机框架。

没有第二个真实 consumer、可复现生命周期错误或旧入口替代目标时，不创建统一 mount 任务。

## 4. Producer 串行 Owner

`buildPublishedCourseV2Payload` 的输入和语义只有一个 owner。Runtime/Component/Surface 任务只能提供字段 adapter，不各自建立 producer。

## 5. 导出状态矩阵

| 格式 | 当前 | 候选处理与准入条件 |
|---|---|---|
| Full Preview | V2 主路径 existing | 受影响时保护；无缺口不建卡 |
| Try-run | V2 主路径 existing | 受影响时保护；无缺口不建卡 |
| Single HTML | V2 主路径 + legacy fallback | 先证明 fallback 可达性和风险，再选择 retained、替代或 deletion-candidate |
| Web package | V2 主路径 + legacy fallback | 按自身 consumer 独立判断，不继承 Single HTML 的施工结论 |
| PPTX | Mixed/非纯 Slide V2；Slide-only legacy | 只修已复现格式问题或迁移已选 consumer；不预建统一 adapter |
| PDF | V2 print + legacy raster fallback | 只处理已复现输入/fallback 风险；保留项记录 Owner |
| DOCX | Flow-only V2 路径 | 保持现有范围；只有具体回归才施工 |
| Preflight | PDF/PPTX 等部分覆盖 | 只为已准入目标格式补 actionable 结果，不为矩阵整齐扩展 |

矩阵行不是任务。一个格式可以在其他格式推进时保持 `retained`、跳过或 `parked`。

## 6. Legacy 处置决策

只对任务卡选定的精确 symbol/path 执行以下决策，不要求一次盘点或清零整个 Export/Player Legacy 面：

1. 证明该目标的真实运行、构建、fixture、release 和文档 consumer；
2. 选择 `retained`、迁移或 deletion-candidate；
3. `retained` 记录兼容用途、Owner 和重访触发条件，不伪造 replacement；
4. 迁移目标只实现当前格式所需的最窄 V9/Published/static 输入，并在同卡接入真实 consumer；
5. deletion-candidate 只有在替代路径稳定且精确 consumer 为 0 后才删除；
6. 只同步受该处置影响的 fixture、release verifier、测试、合同说明和 generated 索引。

HTML/Web、PPTX、PDF/preflight 和 Player payload union 互不构成固定迁移顺序。Legacy producer/Player 仍有真实 consumer 或兼容责任时可以保留。

## 7. 不变量

- Preview/Export 不写作者 Store；
- 相同 V9 输入的 Preview 与 HTML/Web 行为一致；
- Component/Runtime 使用同一保存字节；
- static export 降级有明确报告；
- 生成失败不破坏工程；
- 实际修改的格式 adapter 使用自己的 focused 证据，不把全部格式塞进一个任务，也不验证未被本卡使失效的格式。
