# 文档阅读矩阵

目标是让 AI 只读取完成当前任务所需的最小上下文。稳定化已经激活；任务不再等待另一次“是否启动”决策，但仍须遵守当前合同和教师验收状态。

## 1. 按风险选择最小阅读集

任何任务先读当前任务卡。S0 局部小修默认只再读：

1. Allowed write 中的精确文件或源码；
2. 直接复现问题的 focused 测试、文档检查或最小行为；
3. 只有实际触及公共合同或边界时才读对应片段，并升级为 S1。

S0 不默认读取根计划、详细 README、阶段文档、主模块全文或 Context Pack。若局部源码和测试不能确定边界、需要热点锁或出现跨模块 consumer，不通过增加阅读仪式补偿模糊范围，而是升级为 S1。

S1/S2 默认读取：

1. 仓库根 `COURSEWARE_DEVELOPMENT_PLAN.md` 与本计划 `README.md`；
2. 当前任务卡；
3. 属于某个 `ARCH-*` 候选域时读取对应阶段文档；`tasks/stabilization/` 的当前局部修复不因旧 ID/目录推断阶段；
4. 下表指定的 1 份主模块文档；
5. repo-index 通过准确性门禁后读取一份 Context Pack；未通过、过期或低置信时执行 Bootstrap 手工定位。

不要默认读取整个文档包、整个 `editorStore.ts` 或全部历史任务。`src/shared/contracts/**` 默认只读；若任务确实需要合同变更，必须停下并转为独立合同提交。

## 2. S1/S2 按任务类型选择主文档

下表仅在任务确实需要模块边界上下文时使用，不反向给 S0 增加 Required read。

| 任务 | 主文档 | 必要时补读 |
|---|---|---|
| 治理、激活、重基线 | `01_AUTHORITY_ACTIVATION_AND_BASELINE.md` | `30-execution/01_ARCH_0A_GOVERNANCE_AND_REBASE.md` |
| repo-index | `10-knowledge-system/00_SCOPE_DECISION_AND_BOOTSTRAP.md` | 同目录 01～04 |
| Store、Session、History | `20-modules/01_EDITOR_CORE_STATE_TRANSACTION_HISTORY.md` | `90-appendix/01_TARGET_AND_TRANSITIONAL_RULES.md` |
| App、保存、恢复、IPC | `20-modules/02_APP_PERSISTENCE_IPC_SECURITY_RECOVERY.md` | Core 文档 |
| Slide/Flow/Spatial | `20-modules/03_SURFACE_CARRIERS_AND_PLACEMENT.md` | `30-execution/05_ARCH_3_SURFACE_MODULARIZATION.md` |
| 组件 | `20-modules/04_COMPONENTS.md` | Surface carrier、媒体文档 |
| Runtime、互动、动画 | `20-modules/05_RUNTIME_INTERACTIONS_AUTOMATION.md` | Player/Export 文档 |
| 素材和 Sidecar | `20-modules/06_MEDIA_ASSETS_AND_SIDECARS.md` | Core transaction 文档 |
| 全局层、共享层、控制器 | `20-modules/07_GLOBAL_LAYERS_AND_TEACHER_CONTROLLER.md` | Surface carrier 文档 |
| 预览、Player、导出 | `20-modules/08_PLAYER_PREVIEW_EXPORT.md` | `30-execution/06_ARCH_4_DELIVERY_AND_LEGACY.md` |
| 诊断与分析 | `20-modules/09_DIAGNOSTICS_AND_ANALYSIS.md` | Validation 文档 |
| 简洁/专业模式、Workspace、Properties、现有 DeveloperTab | `20-modules/10_UI_COMPOSITION_AND_CODE_WORKSPACE.md` | Capability Modes |
| 文件归属和移动 | `20-modules/11_CURRENT_TO_TARGET_OWNER_MAP.md` | Module Map |
| Legacy 删除 | `30-execution/09_LEGACY_CLEANUP_AND_DELETION_PROOF.md` | S2 模板 |

## 3. Context Pack 大小

V1 不依赖精确 tokenizer，按 UTF-8 字节和行数控制：

| 档位 | 预算 | 内容 |
|---|---:|---|
| small | 12–20 KB、约 200–350 行 | Feature、入口、核心文件、目标测试 |
| medium | 30–50 KB、约 500–800 行 | 加一层依赖、合同、不变量、Legacy consumer |
| large | 70–100 KB、约 1000–1600 行 | 跨两个以上 Feature 或迁移纵切 |

S1 默认 `medium`；只有 S2 跨域迁移才使用 `large`。S0、纯文档和已有明确测试的局部修复不生成 Context Pack。

## 4. 默认不读取

除非任务卡或 Context Pack 点名：

- 已完成的 `docs/tasks/editor-1.0/**`；
- 旧评估全文；
- 大型生成 Schema；
- `examples/**/*.html`、大二进制和构建产物；
- 全量 `artifacts/ai-capabilities/**`；
- 全量 E2E 大文件；
- 整个上帝文件。

超大文件读取顺序：导入区 → 目标符号 → 直接调用者 → 目标测试 → 仍无法判断才扩展。

## 5. Bootstrap 例外

S1/S2 在 `repo:context` 尚未通过门禁，或索引过期/低置信时，任务卡中的 `Context Pack` 字段填 `bootstrap-manual`，按以下顺序定位：

1. 查公共类型/合同；
2. 查精确符号；
3. 查直接 import/export；
4. 查同名测试；
5. 查一个运行或导出消费者；
6. 限制阅读文件数后开始修改。

S0 直接使用卡内精确源码/测试定位；只有仍无法判断边界时才升级 S1 并使用上述 Bootstrap。

详见 `10-knowledge-system/00_SCOPE_DECISION_AND_BOOTSTRAP.md`。
