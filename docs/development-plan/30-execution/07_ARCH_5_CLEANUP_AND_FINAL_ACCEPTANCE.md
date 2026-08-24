# ARCH-5：证明后清理与最终结果复核

本阶段不再设计新架构，只删除已有替代且消费者归零的旧实现，并完成一次最终完整验证。

ARCH-5 不是“所有 Legacy 符号必须归零”。未达到精确 deletion gate 的兼容入口允许明确保留；没有合格删除目标时允许零张 cleanup 实现卡，直接进入 final-candidate，不为删除旧 adapter 新建另一层 adapter。

## 1. 清理顺序

```text
禁止新增 consumer
→ 新路径至少稳定经过一个完整阶段/波次
→ 逐 consumer 迁移
→ 兼容入口只读并显式告警
→ 精确目标 consumer=0
→ 删除实现
→ 删除仅 Legacy 测试/样式/文档残留
→ 重建索引
```

只有通过 deletion-candidate 准入的目标才按收益、风险、owner 和回滚边界排序；无消费者 helper/adapter、Legacy preview/export、重复 history/session、可写 V8 Project 与孤儿 CSS/tests 只是候选类别，不构成必须清理的队列。可批量安全删除时避免每个 symbol 一张卡和重复全量验证。历史证据只在当前入口接管后归档，不按低频使用删除高级能力。

## 2. 按实际风险并行证据

Coordinator 只为已准入删除目标中实际存在的风险动态分配 consumer 证明、save/reopen/Recovery/cache/async/跨版本检查或产物复核；不固定三名 Worker，也不把未受影响维度补成证据清单。删除写入、回滚边界和最终集成保持单一 Owner。没有 cleanup 卡时直接进入 final-candidate。

## 3. 删除门禁

对正在删除的精确 symbol/path，consumer 必须为 0；“明确保留”适用于尚有真实 consumer、兼容合同或共享原语的目标，不把总符号数归零当作阶段 KPI。每项记录 replacement、最相关目标验证、回滚边界和索引影响；只有自动化不能直接观察结果时才补 manual behavior，只有实际触及持久化/恢复/跨版本时才补对应兼容证据。不能证明删除收益或安全边界时执行 skip condition。

## 4. 最终自动门禁

最终候选显式运行一次合同/能力/索引检查、typecheck、unit/integration/e2e 和 desktop build。不要假定一个聚合命令覆盖新增检查，也不要重复执行已经由同一最终序列覆盖的构建；同一 product commit 上仍有效的 phase-gate 证据直接复用。

必要时单独运行 release、Windows portability 和 component catalog 验证。

## 5. 最终人工结果

三份代表工程逐项检查：新建/打开、三 Surface 编辑、媒体、组件、Runtime/互动、全局/共享层、控制器、undo/redo、保存重开、Try-run/Full Preview、适用导出和现有简洁/专业/DeveloperTab 能力。

输出 pipeline、engineering 和 outcome 三类状态。教师 `accepted` 只能由教师明确给出，不由 ARCH-5 自动生成。
