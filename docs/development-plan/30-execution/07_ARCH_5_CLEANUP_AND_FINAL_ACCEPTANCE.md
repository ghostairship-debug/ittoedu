# ARCH-5：证明后清理与最终结果复核

本阶段不再设计新架构，只删除已有替代且消费者归零的旧实现，并完成一次最终完整验证。

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

优先批次：无消费者 helper/adapter → Legacy preview/export → 重复 history/session → 可写 V8 Project → 孤儿 CSS/tests。历史证据只在当前入口接管后归档，不按低频使用删除高级能力。

## 2. 三路并行证据

- Worker A：static/dynamic/string/IPC/build/fixture/release consumer 证明；
- Worker B：save/reopen/Recovery/cache/async flush 与跨版本风险；
- Worker C：打包版、性能和代表工程人工流程；
- Coordinator：逐批串行删除、回滚提交和最终集成。

## 3. 删除门禁

对正在删除的精确 symbol/path，consumer 必须为 0；“明确保留”只适用于不删除的兼容类型或共享原语。每项必须记录 replacement、target tests、manual behavior、persisted compatibility、rollback commit 和索引影响。

## 4. 最终自动门禁

最终候选显式运行一次合同/能力/索引检查、typecheck、unit/integration/e2e 和 desktop build。不要假定一个聚合命令覆盖新增检查，也不要重复执行已经由同一最终序列覆盖的构建。

必要时单独运行 release、Windows portability 和 component catalog 验证。

## 5. 最终人工结果

三份代表工程逐项检查：新建/打开、三 Surface 编辑、媒体、组件、Runtime/互动、全局/共享层、控制器、undo/redo、保存重开、Try-run/Full Preview、适用导出和现有简洁/专业/DeveloperTab 能力。

输出 pipeline、engineering 和 outcome 三类状态。教师 `accepted` 只能由教师明确给出，不由 ARCH-5 自动生成。
