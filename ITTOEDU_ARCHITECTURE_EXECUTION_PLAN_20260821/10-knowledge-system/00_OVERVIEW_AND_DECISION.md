# 开发侧项目知识系统：决策与总体方案

---

## 1. 为什么需要

IttoEdu 已经达到 AI 每次全量读取不再经济的规模：

- 多 Surface；
- 多种运行协议；
- 多种编辑模式；
- 多条保存、预览和导出链；
- 大量历史任务与评估；
- 多个超大源码文件；
- 功能与测试映射复杂。

纯 Markdown 索引已经出现路径失效和“声明存在但目录不存在”的情况，因此需要自动化。

---

## 2. 选择：静态混合知识图谱

采用：

```text
自动代码图
+ 少量人工 Feature 语义
+ 按任务查询
+ Markdown Context Pack
```

不采用常驻图数据库。

### 自动代码图负责

- 文件；
- 导入；
- 导出符号；
- 函数、类、组件和类型；
- 测试引用；
- Schema/协议入口；
- npm scripts；
- 文件 Hash；
- 最近变更；
- 公共入口和深层导入。

### 人工语义层负责

- Feature 是什么；
- canonical 文件；
- 写入哪部分文档；
- 运行时和导出消费者；
- 模式暴露；
- 核心不变量；
- 关键词和别名；
- Legacy 状态。

---

## 3. 与现有 AI 能力索引的区别

### `artifacts/ai-capabilities/`

用途：

- 告诉课件生成 AI 产品能生成什么；
- Component/Runtime/Interaction 协议；
- 导出能力；
- 生成约束。

### `repo-index/`

用途：

- 告诉编码 AI 某项代码改动应读什么；
- 文件和符号依赖；
- Feature 边界；
- 相关测试；
- 修改影响范围。

两者可以互相引用，但不得合并成一个大索引。

---

## 4. 系统组件

```text
scripts/generate-repo-index.ts
  ├── 扫描 TypeScript/TSX
  ├── 扫描 Markdown 路径
  ├── 扫描测试与脚本
  └── 生成 repo-index/generated/*

repo-index/semantic/*
  └── 人工维护 Feature、模块和不变量

scripts/query-repo-index.ts
  ├── 关键词/别名匹配
  ├── 图关系扩展
  ├── 测试与合同补全
  └── 输出 Context Pack
```

---

## 5. 第一版边界

V1 只实现：

- TypeScript/TSX；
- Markdown 路径；
- JSON/Schema 入口；
- Import/Export 图；
- Feature 语义；
- 相关测试；
- Context Pack。

V1 不实现：

- Embedding；
- 自然语言模型服务；
- 调用图精确分析；
- 运行时动态追踪；
- 增量编译服务；
- Web UI；
- 跨仓库索引。

如果完整生成时间低于 10 秒，不做增量系统。

---

## 6. 成功标准

1. 一个典型任务通过 `repo:context` 可定位 5–15 个高相关文件；
2. Context Pack 默认控制在约 8k Token；
3. 所列路径全部存在；
4. Feature 的写入数据和相关测试清晰；
5. 索引包含生成 HEAD 与文件 Hash；
6. 索引陈旧时给出明确警告；
7. AI 不再默认读取全部历史任务和几个超大文件。
