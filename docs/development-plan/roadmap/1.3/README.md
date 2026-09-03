# 1.3：Recipe 与设计生产力

## 结果与边界

教师可以用高频页面 / 互动 Recipe 快速得到普通、可继续编辑的 V9 内容，并能复用参考页骨架、批量替换内容、应用 Design Token 和快速定位问题。Recipe 只是一组产品命令，不成为第二套 DSL，不保留隐藏运行时；容量不足时换档、拆页或切换 Flow，不默认无限缩小文字。

发布制品只有源码 tag，不发布 HTML 或安装器。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r13-000-recipe-contract` | 定义 Recipe 输入、普通 V9 展开结果、槽位与容量策略 | `r11-062-owner-release` | 否 | `contracts-schema`, `generated-index` | 六个 recipe ID 与版本在一个正式 registry/catalog 中固定，UI、Builder、Capability 只投影它；同一输入产生可解析的普通 V9 命令结果；展开后删除 Recipe 元数据不改变行为；超容量返回“换档/拆页/Flow”建议而不是继续缩字；禁止第二 recipe registry 或运行时 DSL |
| `r13-010-cover-recipe` | `cover-v1` 生成可编辑封面骨架 | `r13-000-recipe-contract` | 否 | `editor-store-history`, `generated-index` | 标题、副标题、署名和视觉槽位可单独编辑；一次应用只产生一个历史事务；保存重开后无 Recipe 专用节点；在固定长短标题输入下不遮挡主操作区 |
| `r13-011-concept-recipe` | `concept-v1` 生成概念讲解骨架 | `r13-000-recipe-contract` | 否 | `editor-store-history`, `generated-index` | 概念、解释、例证和视觉槽位展开为普通 V9 内容；删除 / 重排任一对象不破坏其余对象；长内容触发结构化容量建议而非字体小于现有可读下限 |
| `r13-012-worked-example-recipe` | `worked-example-v1` 生成分步例题骨架 | `r13-000-recipe-contract` | 否 | `editor-store-history`, `generated-index` | 题干、步骤、结论和提示均可直接编辑；步骤可增删重排并 Undo / Redo；新知识不只存在于答案反馈；保存重开和 Player 保持顺序 |
| `r13-020-step-reveal-recipe` | `step-reveal-v1` 生成声明式逐步揭示互动 | `r13-000-recipe-contract` | 否 | `editor-store-history`, `generated-index` | 至少三步内容可编辑、重排并设置初始状态；Player 逐步操作顺序确定，返回起点可复现；键盘可触发；展开结果不依赖 Recipe 运行时 |
| `r13-021-choice-feedback-recipe` | `choice-feedback-v1` 生成选择与反馈互动 | `r13-000-recipe-contract` | 否 | `editor-store-history`, `generated-index` | 题干、选项、正确性与反馈可编辑；选择后显示对应反馈并可重置；答案一致性诊断能定位缺答案 / 多答案配置；保存重开与 Player 一致 |
| `r13-022-classify-sort-recipe` | `classify-sort-v1` 生成分类 / 排序互动 | `r13-000-recipe-contract` | 否 | `editor-store-history`, `generated-index` | 分类项、目标组和正确映射可编辑；指针和键盘均可完成一次互动；错误 / 正确反馈与重置确定；缺组、孤立项和重复稳定 ID 被拒绝且零部分写入 |
| `r13-030-reference-clone` | 从参考页复制可编辑骨架而非复制隐藏状态 | `r13-000-recipe-contract` | 否 | `editor-store-history`, `workspace-properties` | 克隆后对象、资源和交互引用获得无冲突身份；修改副本不改变原页；保存重开、Player 与适用导出无悬空引用；一次克隆可整体撤销 |
| `r13-040-batch-replace` | 在明确范围内预览并批量查找替换 | `r13-000-recipe-contract` | 否 | `editor-store-history`, `workspace-properties` | 可选择当前页 / Surface / 整课范围；预览逐项显示 old / new 与 target；确认后仅修改勾选项并产生一个事务；stale 预览拒绝提交；Undo 恢复全部原值 |
| `r13-041-token-apply` | 将 Design Token 应用于明确对象范围 | `r13-000-recipe-contract` | 否 | `editor-store-history`, `workspace-properties` | 预览列出受影响对象与属性；确认后只写所选范围；不支持属性保持原值并报告；保存重开和 Player 使用同一 token 解析结果；整体可撤销 |
| `r13-050-fast-diagnostics` | 提供面向教师的快速诊断入口与可定位结果 | `r11-062-owner-release` | 否 | `generated-index`, `workspace-properties` | 从可见入口启动后，结果按严重度和 Surface 分组并能跳转到对象；健康工程显示零错误；构造的悬空资源、答案不一致和容量问题分别被精确定位；诊断不改工程 |
| `r13-060-release` | 固定课例通过六种 Recipe 与生产力工具人工闭环并发布 1.3 源码 tag | `r13-010-cover-recipe`, `r13-011-concept-recipe`, `r13-012-worked-example-recipe`, `r13-020-step-reveal-recipe`, `r13-021-choice-feedback-recipe`, `r13-022-classify-sort-recipe`, `r13-030-reference-clone`, `r13-040-batch-replace`, `r13-041-token-apply`, `r13-050-fast-diagnostics`, `r12-060-release` | 否 | `none` | Owner 在固定课例应用六个 Recipe、修改展开内容、克隆、批量替换、Token、诊断、保存重开和 Player；把已验收 Recipe/生产力行为晋升到保全矩阵，证明 Recipe 只产 canonical commands、无第二模板状态/registry、无 UI deep import 后签署 `accepted` 并发布源码 tag |

并行 frontier：六个 Recipe、参考页克隆、批量替换、Token 应用和快速诊断可在各自依赖满足且写锁可取得时并行。`r13-060-release` 等待 1.2 发布只为保持版本发布顺序；1.3 的实现节点不因此等待。

## 接口与数据合同

- Recipe 标识固定为 `cover-v1`、`concept-v1`、`worked-example-v1`、`step-reveal-v1`、`choice-feedback-v1`、`classify-sort-v1`；执行结果是一组现有 V9 命令和普通 Native / 声明式交互内容。
- Recipe 输入包含明确 target、槽位值、设计 token 引用和 revision 前提；执行回执包含创建对象身份、诊断与新 revision。Recipe 名称不进入 Player 必需状态。
- 参考页克隆必须重映射对象、交互和资源引用身份；批量替换与 Token 应用必须先产生可审核 preview，再按 preview revision 原子提交。
- 容量结果固定为成功、建议换档、建议拆页或建议 Flow 四类；自动缩字不得越过现有字体可读性下限。
- 快速诊断只读权威工程并返回可定位 target；不维护第二份健康状态。

## 精确验证入口

实现任务应在以下现有测试文件中增加明确用例，并按最小相关集合执行：

```text
npm run test:product -- tests/unit/coursewareCaseBuilder.test.ts tests/unit/coursewareAuthoringRunner.test.ts tests/unit/editorTransaction.test.ts
npm run test:product -- tests/unit/designTokens.test.tsx tests/unit/assessmentEvaluators.test.ts tests/unit/courseProjectHealth.test.ts
npm run test:product -- tests/unit/courseProjectRoundTrip.test.ts tests/unit/v9SlideContentCommands.test.ts
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

版本候选再执行总路线的统一验证与发布门。视觉、容量与互动结果必须在固定课例中由 Owner 实际观察。
