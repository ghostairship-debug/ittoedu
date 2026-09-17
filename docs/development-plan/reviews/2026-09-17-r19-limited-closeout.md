# 1.9 有限收尾完成

2026-09-17，按 Owner 收窄后的范围结束本轮工作。本结论只覆盖下述修改，不代表 1.9 完整版本验收通过；050/060 及原电路课例 revision 27 的错误返回入口仍未闭合。没有继续真实模型调用、修改原课例、全量回归、提交、标签或发布。

## 最终改动

- `projectDocumentTool` 只阻止相对原工程新增的互动健康错误。已有错误按稳定 owner/rule/action 身份比较，普通编辑或规则重排不再因无关旧错误被阻断；删除原来有效的目标所产生的新悬空引用仍被拒绝。原 Schema、资源闭包与动态准入边界保持。
- 全局 Native 点击检查覆盖本次改变的 global interaction，按实际 Slide composition 和正式点击绑定规则匹配局部或全局 Native 元素，真实检查精确目标到达。运行期条件、非 Native 及 Flow/Spatial 起点仍保留既有未覆盖/跳过边界，不推断为通过。
- 既有 `location.go` / `goToLocation` 实现及其作者、引用、Player 接线保留，复用已经通过的精确导航、复制删除与作者事务证据。此次没有追加导航功能。

## 本轮验证与停止点

1. `projectDocumentFallback.test.ts -t 'limited closeout|invalid global'`：4 项通过，11 项未选中。证明旧错误及重排不阻止提交、新增场景/位置错误与删除目标后的悬空引用零提交。日志 `output/r19-final-20260917/limited-gate-tests.log`。
2. `r19NativeInteractionCompletion.spec.ts --grep 'global Native click enumeration checks Slide to Flow and rejects a wrong destination in Chromium'`：1 项通过，22.9 秒。同一用例证明 global rule 可枚举局部 Native、global overlay 实际点击到 Flow 为 checked/navigation-terminal，以及注入错误目的地后返回 failed。
3. Renderer 与 E2E TypeScript 检查、同源能力生成、Renderer 构建及变更空白检查通过。日志 `limited-renderer-types.log`、`limited-e2e-types.log`、`limited-capabilities.log`、`limited-renderer-build.log` 位于上述 output 目录。构建保留 chunk 大小提示，没有据此追加优化；未改变的 Player/Main 构建证据复用。

类型首轮发现此前中断代码中的 trigger 闭包 narrowing 错误，在同一文件提取 nodeId 后检查通过。未扩大检查范围。以上即本轮停止点，不启动原课例模型修复或剩余版本验收。
