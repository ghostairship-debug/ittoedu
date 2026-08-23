# Published Producer、Player、Try-run、Preview 与 Export

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

当前已有 `beginSerializedSessionMount` 一类轻量 helper。目标是提升并统一使用：

- cancel；
- generation guard；
- idempotent destroy；
- onReady/onError；
- 不新增通用状态机框架。

## 4. Producer 串行 Owner

`buildPublishedCourseV2Payload` 的输入和语义只有一个 owner。Runtime/Component/Surface 任务只能提供字段 adapter，不各自建立 producer。

## 5. 导出状态矩阵

| 格式 | 当前 | 目标 |
|---|---|---|
| Full Preview | V2 主路径 existing | preserve |
| Try-run | V2 主路径 existing | preserve |
| Single HTML | V2 主路径 + legacy fallback | fallback 迁到 V2 后删除 |
| Web package | V2 主路径 + legacy fallback | 同上 |
| PPTX | Mixed/非纯 Slide V2；Slide-only legacy | 建统一 V9/static plan adapter |
| PDF | V2 print + legacy raster fallback | 移除 V8 作者输入 |
| DOCX | Flow-only V2 路径 | preserve，不扩大范围 |
| Preflight | PDF/PPTX 等部分覆盖 | target-specific；未支持 DOCX 时明确标注 |

## 6. Legacy 退役顺序

1. 列出 `buildExportPayload`、PublishedLesson V1、legacy payload union 的全部 consumers；
2. 先证明 HTML/Web no-source fallback 的正常入口可达性；不可达则封死/删除，可达才建立显式 V9 输入；
3. 迁 Slide-only PPTX；
4. 迁 PDF/preflight；
5. 处理 fixtures/release benchmark；
6. 同步修正 `docs/PUBLISHED_LESSON_V1.md` 与真实 producer/退役状态，不能继续声称 V1 必然经 V2 producer 产生；
7. Player payload union 消费者清零；
8. 才删除 Legacy producer/Player。

## 7. 不变量

- Preview/Export 不写作者 Store；
- 相同 V9 输入的 Preview 与 HTML/Web 行为一致；
- Component/Runtime 使用同一保存字节；
- static export 降级有明确报告；
- 生成失败不破坏工程；
- 每种格式 adapter 各自测试，不把全部格式塞进一个任务。
