# 文档阅读矩阵

本文件用于控制后续 AI 的阅读量。除架构总任务外，不应默认读取整个文档包。

---

## 1. 所有任务的最小阅读集

任何任务只强制阅读：

1. 根目录 `README.md`；
2. 当前任务卡；
3. `repo:context` 输出的 Context Pack；
4. 下表指定的 1–3 份模块文档。

源码、Schema 与可复现结果始终高于本文档。

---

## 2. 按任务类型选择文档

| 任务类型 | 必读文档 | 选读文档 |
|---|---|---|
| 项目索引/知识图谱 | `10-knowledge-system/00_OVERVIEW_AND_DECISION.md`、`01_DATA_MODEL_AND_FILES.md`、`02_GENERATOR_AND_FRESHNESS.md`、`03_QUERY_AND_CONTEXT_PACK.md` | `40-development/00_SINGLE_MAINTAINER_AI_WORKFLOW.md` |
| Store、history、selection | `20-modules/01_EDITOR_CORE.md` | `00-foundation/03_TARGET_ARCHITECTURE_AND_DIRECTORY.md`、`90-appendix/00_GLOBAL_INVARIANTS.md` |
| App、保存、恢复、IPC | `20-modules/02_APP_SHELL_PERSISTENCE_IPC.md` | `20-modules/01_EDITOR_CORE.md` |
| Slide/Flow/Spatial | `20-modules/03_SURFACES_SLIDE_FLOW_SPATIAL.md` | `20-modules/01_EDITOR_CORE.md`、`07_PLAYER_PREVIEW_EXPORT.md` |
| 组件库/组件实例/组件代码 | `20-modules/04_COMPONENTS.md` | `00-foundation/04_CAPABILITY_MODES.md`、`09_UI_COMPOSITION_AND_MODES.md` |
| Runtime/互动/动画 | `20-modules/05_RUNTIME_INTERACTIONS_AUTOMATION.md` | `20-modules/08_DIAGNOSTICS_ANALYSIS.md` |
| 素材、图片、视频、sidecar | `20-modules/06_MEDIA_ASSETS.md` | `20-modules/01_EDITOR_CORE.md` |
| 试运行、整课预览、导出 | `20-modules/07_PLAYER_PREVIEW_EXPORT.md` | 对应 Surface 文档 |
| 工程检查、教学分析、视觉密度 | `20-modules/08_DIAGNOSTICS_ANALYSIS.md` | `00-foundation/04_CAPABILITY_MODES.md` |
| 简单/专业/代码模式 | `20-modules/09_UI_COMPOSITION_AND_MODES.md` | 对应 Feature 文档 |
| 清理 Legacy | `30-execution/03_LEGACY_CLEANUP_SEQUENCE.md`、`40-development/02_CODE_CLEANING_POLICY.md` | 相关模块文档 |
| 创建执行任务 | `30-execution/01_PHASE_WORK_PACKAGES.md`、`40-development/01_TASK_PROTOCOL_AND_FILE_FIREWALL.md` | 模板文件 |

---

## 3. Context Pack 阅读预算

推荐提供三个预算：

| 预算 | 目标 | 内容 |
|---|---|---|
| `small` | 约 4k Token | Feature 摘要、公共入口、核心文件、相关测试 |
| `medium` | 约 8k Token | 加入一层依赖、关键符号和不变量 |
| `large` | 约 16k Token | 加入相邻 Feature、最近变更和更多代码片段 |

默认使用 `medium`。只有当任务跨越两个以上 Feature 时使用 `large`。

---

## 4. 默认不读取的内容

除非 Context Pack 明确引用，不读取：

- `docs/tasks/editor-1.0/**` 中已经完成的历史任务卡；
- `docs/reviews/**` 的旧阶段评估；
- 历史 V8 迁移方案；
- 生成的完整 Schema JSON；
- 全量 `artifacts/ai-capabilities/**`；
- 大型示例产物和二进制；
- 整个 `editorStore.ts`、`App.tsx` 或 `Workspace.tsx`。

对超大文件应先读取：

1. 导入区；
2. 目标符号附近；
3. 直接调用者和测试；
4. 只有仍不能判断时才扩展。

---

## 5. 文档权威顺序

```text
用户当前要求
> persisted Schema / 当前源码
> 可复现测试与运行结果
> 当前 Feature 语义元数据
> 本方案模块文档
> 历史任务与评估
```

索引与方案冲突时，不允许按索引强行修改源码；应先修正索引或记录 ADR。
