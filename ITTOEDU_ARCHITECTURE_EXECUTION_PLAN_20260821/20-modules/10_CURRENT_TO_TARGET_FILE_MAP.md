# 当前路径到目标模块的迁移地图

本文件用于帮助 AI 在重构期间判断“现有代码最终应该归到哪里”。路径变化后由 `MAP-01` 和索引生成器更新。

| 当前路径 | 当前主要职责 | 目标归属 | 迁移方式 |
|---|---|---|---|
| `src/renderer/App.tsx` | 生命周期、素材、Catalog、Preview、Export、Diagnostics | `renderer/app/*` + 各 Feature | 先提取 hooks，再迁移数据来源 |
| `src/renderer/store/editorStore.ts` | 所有状态与命令 | `renderer/core/*` + Surface/Feature commands | 先 facade，再 canonical transaction，最后删除旧字段 |
| `src/renderer/ui/Workspace.tsx` | 三 Surface、试运行、画布接线 | `renderer/surfaces/*` + `preview` | Surface 先独立，Workspace 最后降级路由 |
| `src/renderer/ui/PropertiesTab.tsx` | 所有节点/Surface 属性 | 各 Feature `ui/*Properties` | 建路由骨架，逐类迁移 |
| `src/renderer/ui/RightSidebar.tsx` | 模式与 Tab 组合 | `renderer/app/EditorShell`、UI composition | 元数据化 Tab，不复制业务 |
| `src/renderer/ui/TopToolbar.tsx` | 工程操作、模式、检查、导出 | App Shell + mode config | 保持命令，减少条件分支 |
| `src/renderer/ui/ComponentsTab.tsx` | Catalog、包、详情、筛选、更新 | `features/components/*` | 按四子域拆分 |
| `src/renderer/ui/DeveloperTab.tsx` | Runtime/对象/规则/组件代码 | Code Mode + Runtime/Interactions/Components | 草稿、Diff、统一 command |
| `src/renderer/ui/AutomationTab.tsx` | 规则 UI 与诊断 | `features/interactions/ui` | 使用 facade |
| `src/renderer/ui/InteractionEditor.tsx` | 完整互动表单 | `features/interactions/ui` | 拆触发器/条件/动作组件 |
| `src/renderer/ui/ProjectHealthPanel.tsx` | 多种检查和分析 | `features/diagnostics/ui` | 分 structural/authoring/export，按需执行 |
| `src/shared/projectHealth.ts` | 引用/协议/建议混合 | shared validation + diagnostics authoring | 先分类再移动 |
| `src/shared/informationRelease.ts` | 教学流程分析 | diagnostics/authoring | 保留能力 |
| `src/shared/visualDensity.ts` | 视觉密度 | diagnostics/authoring | 保留能力，按需 |
| `src/renderer/ui/FlowWorkspace.tsx` | Flow 全部 UI | `surfaces/flow/ui` | block/overlay/text/toolbar 拆分 |
| `src/renderer/course/flow*` | Flow model/commands/views | `surfaces/flow/model|commands|selectors` | 保持纯函数 |
| `src/renderer/course/spatial*` | Spatial model/commands | `surfaces/spatial/*` | 按 camera/path/relation 拆 |
| `src/renderer/course/slide*`、`v9Slide*` | Slide model/commands | `surfaces/slide/*` | 移除 candidate/V8 语义 |
| `src/renderer/phaser/*` | Slide 作者命中与几何 | `surfaces/slide/phaser` | 不接回 Player |
| `src/renderer/components/*` | Component 包与目录工具 | `features/components/*` | 先 re-export |
| `src/renderer/project/*` | archive、asset、recovery | `renderer/project` + media | 保留项目层，拆 asset 业务 |
| `src/renderer/export/*` | 各格式导出 | `renderer/export` | producer 与格式 adapter 分开 |
| `src/player/*` | Published 运行 | 保留 `player` | 去除 renderer store 依赖 |
| `src/player/surfaces/*` | Surface runtime host | `player/surfaces/*` | 与作者模块通过 shared contract 对接 |
| `PROJECT_COGNITION_INDEX.md` | 手工认知入口 | `PROJECT_INDEX.md` + `repo-index/` | 精简手工内容、路径自动化 |
| `artifacts/ai-capabilities/*` | 产品能力 | 保留 | 不与开发索引合并 |
| `docs/tasks/editor-1.0/*` | 历史执行任务 | Git 历史/少量 ADR | 默认排除，阶段后清理 |
| `docs/reviews/*` | 历史评估 | Git 历史/ADR | 提取仍有效决策 |
| `tests/e2e/editor.spec.ts` | 大型 E2E | 按生命线/Feature 拆分 | 跟随模块迁移逐步拆 |

---

## 迁移规则

- 表中目标路径是职责方向，不要求一次性移动；
- 迁移期间旧路径可 re-export；
- 不因移动路径改变产品协议；
- 每次移动后更新 `repo-index`；
- 只有旧消费者归零后删除旧文件。
