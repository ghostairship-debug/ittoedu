# Legacy consumer 台账与删除证明

## 1. 分类

| 类别 | 处理 |
|---|---|
| Writable duplicate | 迁 writer/consumer 后删除 |
| Read-only projection | 禁止新增 consumer，按用户风险逐个替换 |
| Compatibility fixture | 评估兼容/benchmark/release 价值 |
| Shared legacy-named primitive | 可保留，不凭名字删除 |
| Historical evidence | 当前入口接管后归档 |
| Dead implementation | 完整证明后删除 |

## 2. 删除八问

1. 还有静态 import/reference 吗；
2. 还有动态、字符串、IPC 或配置 consumer 吗；
3. 还有 Player/Preview/Export consumer 吗；
4. 还有 build/fixture/release consumer 吗；
5. 还有 persisted/Recovery/跨版本兼容义务吗；
6. 替代路径是什么，稳定经过了哪个阶段；
7. 哪些目标行为测试证明替代；
8. cache、异步 flush、生成物或安装包是否仍会调用它。

## 3. 唯一台账字段

```text
legacy symbol/path
owner/status
all consumer categories
replacement
target removal phase
zero-reference evidence
persisted compatibility
target tests/manual behavior
stable-since wave
rollback commit
index impact
```

Legacy consumer 台账是删除状态的唯一真相；任务卡只引用台账记录 ID，不复制另一份 consumer 清单。

## 4. 不可作为删除理由

- 普通教师暂时不用；
- 简洁模式不显示；
- 名字含 V8/legacy；
- 文件过大；
- AI 更常使用另一条路径；
- Catalog 当前为空；
- 新目录已经存在但行为尚未证明。

## 5. 审批规则

对精确删除目标必须 `consumers=0`。若仍有必须保留的兼容类型或 fixture，把它拆成独立 retained 记录，不允许用“0 或明确保留”的模糊条件批准删除。
