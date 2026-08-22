# 完成标准、回滚与交接

---

## 1. 工作包 Definition of Done

一个工作包完成必须满足：

1. 目标行为实现；
2. 没有降低计划保留的能力；
3. canonical data 与 write path 符合模块文档；
4. 无无意的第二写入路径；
5. 最小验证通过；
6. 索引影响已处理；
7. 旧入口删除条件已更新；
8. 有清晰交接；
9. 提交可回滚。

---

## 2. 阶段完成标准

- 所有工作包已合；
- 公共入口一致；
- 阶段验证通过；
- semantic index 与 generated index fresh；
- Legacy 列表更新；
- 下一阶段依赖明确；
- 没有阶段内临时双写留到不确定未来。

---

## 3. 回滚策略

### 结构迁移

按三个提交：

```text
1. add new facade/implementation
2. migrate consumers
3. remove old path
```

若第 2 步失败，可回滚消费者；若第 3 步失败，可恢复旧入口。

### 数据迁移

本轮尽量不改 persisted Schema。若必须：

- 独立提交；
- migration 可重复；
- 保存前保留原文件；
- fixture 覆盖。

### UI 重组

保留命令不变，回滚仅影响组合层。

---

## 4. Handoff 内容

```text
Summary
Baseline/Final SHA
Changed files
Behavior preserved
Behavior changed
Canonical data/write path
Tests run
Index impact
Remaining legacy
Out-of-scope findings
Rollback commit
```

---

## 5. 不算完成

- 只移动文件但旧逻辑仍双份；
- 新 facade 仍把整个 Store 暴露出去；
- 测试通过但模式间行为分叉；
- 删除 UI 后高级能力无替代入口；
- Context Pack 仍指向旧路径；
- “之后再删”但没有删除任务；
- 依赖全量人工试用才能知道基本正确性。
