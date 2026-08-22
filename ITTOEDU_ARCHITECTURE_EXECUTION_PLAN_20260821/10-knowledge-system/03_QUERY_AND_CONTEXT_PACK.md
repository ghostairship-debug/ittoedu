# 索引查询与 Context Pack 规范

---

## 1. 命令接口

```bash
npm run repo:query -- "组件目录版本更新"
npm run repo:context -- "修复 Flow 图片替换后保存重开丢失"
npm run repo:context -- --feature components --budget medium
npm run repo:context -- --symbol updateCourseSound --expand 1
npm run repo:context -- --changed HEAD~1
```

---

## 2. 查询流程

### 2.1 解析任务

提取：

- Feature 名称；
- Surface；
- 模式；
- 操作动词；
- 数据对象；
- 运行/编辑/导出阶段；
- 明确路径或符号。

### 2.2 建立种子

优先级：

1. 精确 Feature alias；
2. 精确路径；
3. 精确符号；
4. 测试名称；
5. 关键词匹配；
6. 最近相关变更。

### 2.3 图扩展

默认一层：

- Feature canonical files；
- public entrypoints；
- 直接 imports/imported-by；
- tests；
- contracts；
- writes/reads；
- runtime/export consumers。

只有 `--expand 2` 才扩第二层。

### 2.4 评分

示意：

```text
精确 Feature         +100
精确 Symbol          +90
canonical file       +80
writes target        +70
direct test          +65
public entrypoint    +60
direct dependency    +35
recent related diff  +20
historical/legacy    -50
excluded docs        -100
```

---

## 3. Context Pack 格式

```markdown
# Task Context

## Task
修复 Flow 图片替换后保存重开丢失

## Index Status
fresh @ <sha>

## Matched Features
- media-assets
- flow

## Canonical Data
- CourseProjectDocument.assets
- Flow block media reference
- CourseAssetSidecar

## Start Here
1. path — reason — relevant symbols/lines
2. ...

## Write Path
UI → command → document transaction → history → save

## Runtime/Export Consumers
...

## Invariants
...

## Relevant Tests
...

## Adjacent Risks
...

## Do Not Read Unless Needed
...

## Suggested Minimal Validation
...
```

---

## 4. 预算控制

### small

- 3–7 个文件；
- 1 个 Feature；
- 相关测试；
- 不展开最近 Commit。

### medium

- 5–15 个文件；
- 1–2 个 Feature；
- 一层依赖；
- 合同、不变量和测试。

### large

- 10–25 个文件；
- 2–4 个 Feature；
- 两层依赖；
- 最近变更；
- 适合跨 Surface 或核心架构任务。

Context Pack 不嵌入完整源码，只给出目标符号与行区间。

---

## 5. 查询失败处理

若没有高置信结果：

1. 输出候选 Feature；
2. 标记缺失的 semantic alias；
3. 推荐一次有限源码搜索；
4. 任务结束后补充 alias 或 Feature 元数据。

禁止因为查询失败自动全仓库读取。

---

## 6. AI 默认工作协议

```text
1. 生成 medium Context Pack
2. 阅读 Start Here
3. 检查 canonical data 和 write path
4. 读取相关测试
5. 仅在必要时扩展一层
6. 实现
7. 跑 Suggested Minimal Validation
8. 结构变化时重建索引
```

---

## 7. 示例：组件库任务

任务：

```text
完善内置组件库的版本更新和工程安装逻辑
```

Context Pack 应区分：

- Catalog source；
- Installed package；
- Canvas instance；
- Component authoring；
- 保存 sidecar；
- 运行态挂载；
- 导出静态后备。

不能只返回 `ComponentsTab.tsx`。

---

## 8. 示例：模式任务

任务：

```text
让代码模式修改组件属性后简单模式立即同步
```

Context Pack 应返回：

- mode UI composition；
- component command；
- canonical document；
- selector；
- code draft；
- history；
- relevant tests。

这正是知识图谱相对普通全文搜索的价值。
