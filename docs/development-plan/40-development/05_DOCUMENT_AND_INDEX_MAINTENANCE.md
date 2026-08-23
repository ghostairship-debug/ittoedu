# 唯一真相、文档与索引维护

## 1. 四类真相

只保留：

1. 唯一计划：目标、阶段、模块边界、门禁和升级规则；
2. 任务卡：任务实时状态、dependsOn、Owner、预算和结果；
3. Legacy consumer 台账：consumer、replacement 和 deletion gate；
4. Schema、源码和可复现测试：产品事实最高权威。

任务板和 Handoff 是任务卡的派生视图；Context Pack、验证日志是临时证据，不复制模块或阶段状态。

## 2. 何时更新

必须更新：公共合同/API、owner/依赖边界、Feature current status、Legacy replacement、阶段门禁、用户可见能力和适用范围。

不必更新：局部实现、不影响入口的重命名、普通测试修复、文案/CSS 小修。

## 3. Semantic 与 Generated

Worker 只报告建议和 `indexImpact`。Feature owner/Coordinator 修改少量 canonical files/entrypoints/aliases/status/high-signal consumers/tests/invariants。generated 由 Coordinator 重建，不手工合并 JSONL；Context Pack 不提交。

普通集成后可本地重建以保持下一任务上下文新鲜；达到阶段点再统一提交 generated，避免每卡制造合并噪音。高风险任务若相关输入 stale，自动降级 Bootstrap 或等待 Coordinator 重建。

## 4. 历史材料

历史任务/评估默认不进入 AI 阅读集；不立即删除。关键决策转入当前计划或 ADR，accepted/发布证据保留，当前入口不再指向旧领取状态。

## 5. 一致性检查

计划发布前检查：Markdown 链接、阶段编号、manifest、目标文件、术语状态、规划命令未冒充现有命令、任务状态未在多处重复、consumer 台账 ID 有效。
