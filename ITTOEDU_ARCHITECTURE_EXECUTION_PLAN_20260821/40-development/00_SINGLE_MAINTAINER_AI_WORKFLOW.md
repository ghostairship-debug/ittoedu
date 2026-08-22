# 单人维护 + AI/Vibe Coding 开发流程

该流程以低沟通成本和高可回滚性为目标，不模拟大型团队流程。

---

## 1. 每个任务的标准闭环

```text
明确任务
→ 生成 Context Pack
→ 填任务卡
→ 小范围读取源码
→ 实现
→ 目标验证
→ 更新索引（需要时）
→ 写交接
→ 小提交
```

---

## 2. 任务开始

### 必做

```bash
git status --short
git rev-parse HEAD
npm run repo:context -- "<任务描述>"
```

然后阅读：

- Context Pack；
- 任务对应模块文档；
- 相关测试；
- 目标源码符号。

### 不必做

- 全仓库扫描；
- 阅读全部历史任务；
- 运行完整验证；
- 重新评估整个产品架构。

---

## 3. 任务卡

任务卡必须明确：

- 一句话目标；
- 用户可感知行为；
- canonical data；
- write path；
- allowed/read-only/forbidden files；
- 不变量；
- 最小测试；
- index impact；
- 删除/迁移策略。

模板见 `50-templates/TASK_CARD_TEMPLATE.md`。

---

## 4. 实现方式

### 优先

- 复用现有纯命令；
- 先加 facade 再迁移消费者；
- 小提交；
- 不改 persisted Schema；
- UI 与业务分开；
- 删除旧路径与切换新路径尽量在同一小闭环完成。

### 避免

- “顺便优化”；
- 同时改多个 Surface；
- 同时改架构与产品功能；
- 复制现有逻辑到新目录后长期保留两份；
- 新建通用框架解决一个局部问题。

---

## 5. AI 阅读策略

AI 应先问：

1. Feature 是什么？
2. canonical data 在哪里？
3. 当前 write command 是什么？
4. UI、Player、Export 谁消费？
5. 哪个测试最接近用户行为？

而不是先读大文件全部内容。

---

## 6. 多 Agent

只有当任务文件防火墙不重叠时并行。

父任务/整合者负责：

- 分配文件；
- 确认依赖；
- 合并；
- 跑阶段验证；
- 更新索引。

子 Agent 不自行扩大范围。

---

## 7. 提交

推荐提交粒度：

```text
refactor(index): ...
refactor(core): ...
refactor(components): ...
refactor(flow): ...
test(core): ...
docs(repo-index): ...
```

每个提交应：

- 可独立理解；
- 可独立回滚；
- 不混入大规模格式化；
- 有最小验证说明。

---

## 8. 阶段收口

阶段整合者：

1. 合并所有小提交；
2. 解决公共入口；
3. 更新 semantic index；
4. 运行阶段验证；
5. 记录尚存 legacy；
6. 不在收口时新增功能。
