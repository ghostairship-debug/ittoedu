# 确定性、新鲜度与 Git 策略

## 1. 严格新鲜度合同

```json
{
  "schemaVersion": 1,
  "generatorVersion": 1,
  "sourceTreeHash": "sha256:...",
  "semanticHash": "sha256:...",
  "configHash": "sha256:...",
  "toolHash": "sha256:...",
  "fileCount": 0,
  "symbolCount": 0,
  "edgeCount": 0
}
```

权威判据：

```text
sourceTreeHash + semanticHash + configHash + toolHash + schemaVersion + generatorVersion
```

HEAD 不写入 manifest 或任何 committed strict generated 文件，也不参与字节比较。CLI 可以在运行时把当前 HEAD 打印到控制台诊断，但不得持久化进严格产物。否则“在 HEAD A 生成、提交为 HEAD B”会让生成物立即 self-diff。

## 2. Hash 输入

四个 Hash 的输入域按 [数据模型](01_DATA_MODEL_PROVENANCE_AND_FILES.md#3-输入域与-hash-单一归属) 划分，彼此互斥。每个域都包含排序后的：

- 规范化相对路径；
- 规范化内容 hash；
- 输入域标识。

文本输入在计算内容 hash 前统一为 UTF-8、无 BOM、LF；generated 输出也统一 LF。二进制输入保持原始字节。`configHash` 必须覆盖三个 tsconfig；`toolHash` 必须覆盖生成/查询器源码、package/lockfile 和实际解析器版本。一个路径若被两个域重复收入，`--check` 失败。

必须排除：

- `repo-index/generated/**`；
- contexts；
- 构建产物；
- Git HEAD、当前时间、绝对路径和机器用户名。

## 3. 状态不持久化

`fresh / partially-stale / stale` 是查询时根据当前输入计算的结果，不写成静态“真相”。

- fresh：所有严格 hash 相同；
- partially-stale：任务相关文件未变，但全局输入变化；仅作提示，不允许在高风险 S2 中无条件使用；
- stale：相关输入或 semantic 已变。

## 4. Dirty worktree

同一 HEAD 也可能有未提交源码或外部输入变化。查询器应：

- 计算当前输入 hash；
- 检测 relevant dirty files；
- 在 Context Pack 顶部列出；
- S2 任务若相关输入 dirty，要求先由维护者决定是否纳入基线。

## 5. 字节确定性

相同输入两次生成必须逐字节一致：

- JSON key 顺序固定；
- 数组按规范化路径/ID 排序；
- 换行统一 LF；
- UTF-8 无 BOM；
- 路径统一 `/`；
- 不写当前时间；
- 不写 Git HEAD；
- 不写绝对路径；
- 临时目录原子替换。

## 6. Generated 入 Git

`generated/` 建议入 Git，原因是云端 Agent 可直接读取。规则：

- 标记为 generated；
- 合并冲突不手工拼接，以当前源码重建为准；
- 只有阶段整合者或单一 owner 更新；
- 子 Agent 只报告 `indexImpact`；
- PR 中 generated diff 与 semantic diff 分开审阅。

## 7. Check 模式

`repo:index:check`：

- 在临时目录重建；
- 比较严格生成物；
- 校验 semantic 路径；
- 校验 Markdown 链接；
- 校验无自引用和非确定字段；
- 校验 source/semantic/config/tool 四个输入域互斥且无遗漏；
- 校验三个 tsconfig 的覆盖、共享文件去重与 LF 归一；
- 校验严格产物不含 HEAD、时间、绝对路径或机器信息；
- 不修改工作树。

结构任务和阶段结束必须运行；普通 S0 不运行。
