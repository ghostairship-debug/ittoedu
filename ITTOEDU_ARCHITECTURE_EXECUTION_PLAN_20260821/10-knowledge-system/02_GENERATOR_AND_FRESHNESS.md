# 索引生成器、正确性与新鲜度

---

## 1. 脚本

新增：

```json
{
  "repo:index": "tsx scripts/generate-repo-index.ts",
  "repo:index:check": "tsx scripts/generate-repo-index.ts --check",
  "repo:query": "tsx scripts/query-repo-index.ts",
  "repo:context": "tsx scripts/query-repo-index.ts --format markdown",
  "repo:boundaries": "tsx scripts/check-module-boundaries.ts"
}
```

若边界检查可以复用索引 AST 结果，可由同一个脚本实现，避免重复扫描。

---

## 2. 生成算法

### Step 1：枚举文件

来源：

- `src/**/*.ts(x)`；
- `tests/**/*.ts(x)`；
- `scripts/**/*.ts`；
- 关键 Markdown；
- `package.json`；
- Schema 与合同入口。

应用 exclusions。

### Step 2：TypeScript AST

使用现有 `typescript` 依赖：

- import/export；
- 顶层 function/class/interface/type/const；
- React 组件启发式；
- Zod Schema 声明；
- 测试 `describe/it/test` 名称；
- 行号；
- JSDoc 第一段。

不加入 `ts-morph`，除非 Compiler API 实现成本明显过高。

### Step 3：关系建立

- 相对路径解析；
- tsconfig alias 解析；
- 测试与被导入文件关联；
- 文件与 semantic Feature 关联；
- 公共入口识别；
- deep import 记录；
- Contract 路径识别。

### Step 4：文档检查

检查：

- Markdown 相对链接；
- 索引中的源码路径；
- semantic canonicalFiles；
- tests；
- entrypoints。

失效路径生成错误，不静默忽略。

### Step 5：写入原子生成物

先写到临时目录，再替换 `generated/`，避免半生成状态。

---

## 3. 新鲜度策略

每个生成物包含：

- HEAD；
- 生成时间；
- 输入文件 Hash；
- semantic Hash。

`repo:query` 运行时：

1. 比较当前 HEAD；
2. 若 HEAD 不同，比较受影响文件 Hash；
3. 输出 `fresh`、`partially-stale` 或 `stale`；
4. stale 时仍可查询，但 Context Pack 顶部明确警告。

V1 可以直接按 HEAD 判断，不必先实现复杂增量检查。

---

## 4. 何时生成

### 必须运行

- 新增/移动/删除模块；
- 修改公共入口；
- 修改 Feature 语义；
- 修改测试映射；
- 修改 Schema/协议；
- 阶段结束。

### 不必运行

- 文案；
- 局部 CSS；
- 一个函数内部实现且签名未变；
- 不影响导入和符号的测试修复。

任务交接只需声明 `indexImpact: none | regenerate | semantic-update`。

---

## 5. Check 模式

`--check` 不重写文件，只比较：

- 生成结果；
- 路径有效性；
- semantic 引用；
- manifest HEAD。

日常小任务不必运行；结构性任务和阶段收口运行。

---

## 6. 测试策略

索引生成器只需少量高价值测试：

1. TS import/export；
2. React 组件识别；
3. 测试映射；
4. alias；
5. Markdown 失效路径；
6. stale manifest；
7. Context Pack 排序；
8. exclusions。

不追求覆盖全部 TypeScript 语法。

---

## 7. 性能边界

- 首版总生成若低于 10 秒，保持全量重建；
- 查询应低于 1 秒至数秒；
- 不为“可能将来更大”提前建设 watcher、daemon 或增量图数据库；
- 只有实际超过阈值后再优化。
