# 结构诊断、作者分析、导出预检与错误呈现

## 1. 当前设施

高信号现有模块包括：

- `diagnosticCodes.ts`：诊断码；
- `projectDiagnostics.ts`：专项诊断；
- `projectHealth.ts`：当前综合 Health，主要消费 V8 Project；
- `assetReferences.ts`；
- `componentPackageLifecycle.ts`；
- `teacherControllerConsistency.ts`；
- `informationRelease.ts`；
- `visualDensity.ts`；
- `exportPreflight.ts`；
- `scripts/validate-project.ts`；
- ProjectHealthPanel、导航与 renderer diagnostic install。

目标是重新分层和迁移输入，不从零创建“检查系统”。

## 2. 四层诊断

### Structural

Schema、引用、素材、组件包、互动目标、控制器一致性。适合保存/打开/CLI/导出边界。

### Contextual

普通教师在操作点看到的可行动错误：素材缺失、无效跳转、导出不支持。不得暴露工程内部术语。

### Authoring Analysis

教学流程、信息释放、视觉密度等启发式建议。仅按需运行，不阻断保存。

### Export Preflight

按目标格式分析支持、fallback、大小和静态快照要求。

## 3. 实时计算策略

当前 App 订阅 `state.project` 并每次变化全量 `collectProjectHealth`。迁移目标：

- 编辑时只做局部、廉价、必要检查；
- 打开专业面板时运行完整作者分析；
- 导出时运行目标 preflight；
- 保存/打开时运行 structural；
- 缓存必须由 document revision 和输入 hash 驱动，不成为新真相。

## 4. V9 输入迁移

只有被当前任务实际命中的 Project Health 规则才按以下候选处置分类：

```text
V9 可直接实现
需要 Published/static plan
仅 V8 遗留：retained 或 deletion-candidate
启发式建议
```

不一次性盘点或重写全部规则。只有已复现错误归因/性能问题、真实 consumer 或选定替代目标的规则才建卡；卡内只列受影响的原规则、V9 数据源、消费者、诊断码和目标验证。未准入规则保持现状，deletion-candidate 才要求精确 consumer=0。

## 5. 呈现

- 简洁编辑：操作点提示和导出阻断；
- 专业编辑：完整问题与分析面板；
- 现有 DeveloperTab/调试入口可读取必要诊断；结构化 JSON report 或新 Code Workspace UI 另列可选产品 Epic；
- CLI：稳定 code/path/message/severity；
- 诊断定位使用稳定 authoringAddress，不使用临时 DOM/hit id。

## 6. 诊断不是验收替代

- visualDensity/informationRelease 只能给建议；
- 自动化健康报告不能证明视觉可用；
- 最终仍需要代表工程人工编辑、播放和导出复核；
- 不恢复教师 Hash/审批/Evidence 状态机。
