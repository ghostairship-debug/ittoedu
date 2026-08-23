# 项目知识系统：范围、裁决与索引前 Bootstrap

## 1. 为什么需要 repo-index

当前仓库已经超过手工 Markdown 导航长期可靠的舒适范围，并将由多个 Agent 自动持续执行。**静态 repo-index 是必要开发基础设施**；它不是可选文档优化，也不是产品运行时能力。仓库仍是单仓、单人 Owner 维护的小型产品，因此不需要常驻知识服务。repo-index 的目标不是“理解全部代码”，而是回答：

- 修改这个 Feature 应先读什么；
- canonical contract 和公共入口在哪里；
- 哪些文件是写路径、运行/导出消费者和相关测试；
- 哪些路径是 Legacy，替代路径是什么；
- 当前索引是否与源码一致。

## 2. 与产品能力索引分离

```text
artifacts/ai-capabilities/
  回答：课件生成 AI 现在可以生成什么

repo-index/
  回答：编码 AI 修改某项能力应读取什么
```

二者可互相引用摘要，但不得合并为一份真相。

## 3. V1 选型

采用：

```text
确定性静态生成事实
+ 少量人工 Feature/Module 语义
+ CLI 查询
+ 小型 Markdown Context Pack
```

不采用：

- Neo4j 或其他图数据库；
- 向量数据库/Embedding；
- daemon/watcher；
- 函数级完整调用图；
- 自动推断全部业务 reads/writes；
- 跨仓源码索引。

外部 `../courseware-components` 不纳入 V1 源码图。可读取当前 ai-capabilities 中的 Catalog 摘要，但不能声称可以导航外部仓库实现。

## 4. 历史 repo-index 底稿

本地 Git 对象 `0c12bb0d69268a00d407cddd9ea06c75ba202898` 当前可读，其中包含 `repo-index/{README,manifest,modules,features,tests}` 底稿；它不在当前 main，也不是现行实现。处理规则：

- 只可人工摘取 modules/features/tests 的分层和高信号语义作为参考；
- 其中路径、任务状态、V8、Agent Kit 和 Player 事实已经过时，不得 cherry-pick 或整体恢复；
- 不把它当成当前事实、现行 schema 或必须恢复的实现；
- 新 schema 和确定性合同以本修订版为准；
- 不因复用旧底稿阻塞、缩减或绕过 ARCH-0B 的生成、freshness 与黄金任务门禁。

## 5. 索引前 Bootstrap

在 `repo:index` / `repo:context` 尚未落地时，任何任务使用以下手工流程：

### Step 1：确定合同与 carrier

先读相关 `src/shared/contracts/**` 或公共类型，确认数据语义，尤其区分 FlowBlock 与 LayerItem。

### Step 2：定位精确符号

使用项目搜索查函数、类型、action 或 UI 文案，不先读整个上帝文件。

### Step 3：读取四类证据

1. canonical writer；
2. 直接消费者；
3. 相关测试；
4. 保存/预览/导出链中的一个端点。

### Step 4：形成手工 Context Note

任务卡记录：

```text
Start here
Canonical carrier
Write path
Runtime/export consumers
Must preserve
Minimal validation
Unknowns
```

### Step 5：限制扩读

默认不超过：

- 8 个主要源码文件；
- 4 个测试文件；
- 1 份合同文档；
- 1 个相邻 Feature。

超过前必须说明为什么现有证据不足。

## 6. 切换条件

只有 ARCH-0B 的生成、确定性、新鲜度和首批 15 个黄金任务门禁通过后，`repo:context` 才可用于受控试运行；扩展到 25 个黄金任务并达到质量门槛后，才可支持广泛多智能体派工。查询失败、索引 stale 或低置信时必须显式降级到 Bootstrap，而不是默默输出错误的“确定答案”。
