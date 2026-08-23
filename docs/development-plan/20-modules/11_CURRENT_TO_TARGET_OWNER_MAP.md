# 当前目录到目标 Owner 的迁移地图

本表用于决定职责，不要求一次移动目录。

| 当前路径/热点 | 当前职责 | 目标 Owner | 迁移规则 |
|---|---|---|---|
| `src/renderer/store/editorStore.ts` | 所有状态和 action | Core + Surface/Feature | 先 selector/port，逐 consumer 迁移，最后删字段 |
| `src/renderer/store/history.ts` | V8 patches + resource changes | Core History | 泛化到 V9，复用资源 delta |
| `src/renderer/authoring/courseAuthoringSession.ts` | location/revision/generation | Core Authoring Identity | 演化，不与新 ActiveEditor 并存 |
| `src/renderer/authoring/courseAuthoringScope.ts` | global/surface/scene/world owner | Core identity + Global Layers | 保留 owner 语义 |
| `src/renderer/course/read-model/` | 现有窄读取边界 | Core/Surface facades | 扩展，不另造平行 read model |
| `src/renderer/course/slide*`、`v9Slide*` | Slide commands/views/backend | Surface/Slide | 按职责迁移，不按前缀批量删 |
| `src/renderer/course/flow*` | Flow model/commands/adapters | Surface/Flow | blocks/overlay 明确分离 |
| `src/renderer/course/spatial*` | Spatial command/path/camera | Surface/Spatial | 分 camera/path/relation，但不碎片化 |
| `src/renderer/course/globalLayer*`、`effectiveLayer*` | 跨 scope 图层 | Global Layers | 单一 owner，Surface 只提供本地 items |
| `src/renderer/authoring/*TextEdit*` | draft/IME | 对应 Surface/Feature | 草稿局部，提交走 Core |
| `src/renderer/phaser/*` | Slide 编辑 + Spatial hit adapter | Slide/Spatial | 拆 owner；Phaser 不进 Player |
| `src/renderer/components/*` | package/catalog/runtime | Components | 按四子域整理 |
| `src/renderer/project/*` | archive/assets/recovery | App/Persistence + Media | 保留成熟实现，抽 port |
| `src/renderer/preview/*` | runtime preview | Preview/Runtime | mount 生命周期归 Preview |
| `src/renderer/export/*` | legacy + V2 格式 | Export | producer 与 format adapter 分开 |
| `src/renderer/diagnostics/*` | renderer error/nav | Diagnostics | 与 shared rules 对齐 |
| `src/renderer/App.tsx` | 全局编排 | App Composition | 逐 hook/use-case 提取 |
| `src/renderer/ui/Workspace.tsx` | 三 Surface + run/preview | UI routing | 最后由单一 integrator 降级 |
| `src/renderer/ui/PropertiesTab.tsx` | 全属性 | UI routing + Feature editors | 最后接入 view models |
| `src/renderer/ui/ComponentsTab.tsx` | Catalog/package/details | Components UI | 先纯 UI 拆分 |
| `src/renderer/ui/InteractionEditor.tsx` | rule model + UI | Interactions UI | 先 typed view model |
| `src/renderer/ui/DeveloperTab.tsx` | 现有 Runtime/object/rules/component 代码能力 | Developer Authoring UI | 保留并接 transaction；不借重构新增第三模式 |
| `src/renderer/styles/*` | 全局变量与集中样式 | UI Shell + 对应 Feature | 随真实 Feature 迁移；不为文件大小一次重写 |
| `src/renderer/dev/*` | 开发期注入与 smoke 辅助 | Dev Tooling | 与生产入口隔离；consumer 证明后再清理 |
| `src/main/*` | 窗口/文件/IPC/catalog/security | Main Platform | 按服务整理，不改变 trust |
| `src/preload/*` | desktop bridge | Preload | 维护 channel parity |
| `src/shared/contracts/*` | 权威合同 | Shared Contracts | 相关任务必须读取；非合同任务默认 Forbidden write |
| `src/shared/projectTypes.ts` 等 | V8 类型与部分 V9 复用原语 | Legacy/shared domain | 按 consumer 判断，不能凭 V8 名删除 |
| `src/player/*` | legacy Player + shared runtime | Player | V2 consumer 迁移后再删 legacy |
| `tests/unit` | 单元/组件 | 对应 Feature | 不强制移动进 Feature 目录 |
| `tests/integration` | 跨模块 | Integration | 保留顶层 |
| `tests/e2e` | 用户流程 | E2E | 后续可拆 spec，不急于重组 |
| `scripts/*` | 生成/验证/fixtures/release | Tooling | repo-index 独立子目录 |
| `docs/contracts/*` | 人读合同 | Shared Contracts Docs | repo-index Contract 节点必须摄取 |
| `docs/tasks/editor-1.0/*` | 历史执行与验收证据 | Archive | 已冻结，不再派工；关键决定进入当前权威，原文由 Git 历史保留 |

## 移动文件前必须回答

1. 当前 owner 是谁；
2. 新 owner 是谁；
3. 公共入口在哪里；
4. 所有运行/构建/测试/release consumers；
5. 路径变化如何更新索引；
6. 是纯 move 还是语义改动；
7. rollback 如何执行。

同一任务不要同时做大规模 move 和行为重写。
