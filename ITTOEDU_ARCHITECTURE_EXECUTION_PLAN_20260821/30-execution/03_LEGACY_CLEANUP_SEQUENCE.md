# Legacy 与无用代码清理顺序

删除发生在替代路径稳定之后，而不是重构开始前。

---

## 1. 分类

### L0：历史命名

例如 candidate、V8 backend 等已不反映真实架构的名称。

处理：

- 先消除语义误导；
- 可通过 alias/re-export 过渡；
- 不改变行为。

### L1：只读兼容投影

仍被旧 UI 使用，但不应写回。

处理：

- 标记 `legacy-read-adapter`；
- 限制消费者；
- 逐个迁移；
- 最后删除。

### L2：重复写入链

同时更新 V9、旧 project、session/history。

处理：

- 先让 canonical command 完整；
- 切换消费者；
- 加写入路径测试；
- 立即删除旧写入，避免长期双写。

### L3：无消费者实现

全局引用、索引和测试均无消费者。

处理：

- 确认无路线价值；
- 删除源码、测试、文档、样式和 export；
- 重建索引。

### L4：历史任务和评估

不属于产品运行时，但污染 AI 上下文。

处理：

- 提取仍有效决策为 ADR；
- 其余依赖 Git 历史；
- 从默认入口和 Context Pack 排除；
- 可删除或移入 `docs/archive/`，优先删除已完全失效文件。

---

## 2. 删除门槛

删除源码前必须回答：

1. 当前谁导入？
2. 当前谁运行时调用？
3. 是否在 persisted 文件中承载兼容？
4. 是否在 Player/Export/Builder 使用？
5. 是否有长期路线价值？
6. 替代实现是什么？
7. 删除后跑什么最小验证？

---

## 3. 推荐顺序

```text
失效文档路径
→ 无消费者历史 helper
→ 重复 UI 接线
→ 旧写入 action
→ 旧 project/session 字段
→ 旧 projection
→ 旧测试夹具
→ 孤儿 CSS
→ 旧任务与 reviews
```

---

## 4. 不应删除

仅因为以下原因不能删除：

- 简单模式不显示；
- 当前 Catalog 为空；
- 普通教师使用少；
- Code 模式高级；
- AI 可以替代手工；
- 当前没有完整 UI；
- 文件较大。

---

## 5. 清理证据

每个清理任务交付：

```text
Deleted paths
Replacement paths
Reference search result
Persisted compatibility assessment
Tests removed/retained
Index impact
Rollback commit
```

---

## 6. 完成标准

- 无双写；
- 无失效公共入口；
- 无索引指向不存在路径；
- 历史文档不进入默认 Context Pack；
- 删除的是冗余实现而非能力；
- Git 历史仍可追溯。
