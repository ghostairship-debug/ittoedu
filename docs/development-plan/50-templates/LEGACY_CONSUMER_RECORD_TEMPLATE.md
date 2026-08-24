# Legacy Consumer Record

- Record ID:
- Legacy symbol/path:
- Owner:
- Status: writable-duplicate | read-projection | fixture | shared-primitive | historical-evidence | dead
- Disposition: retained | deletion-candidate
- Evidence baseline:

## Consumers

`retained` 只列支撑保留结论的当前 consumer/兼容义务；`deletion-candidate` 才穷尽以下适用类别。

### Static imports/references
### Dynamic/string/config/IPC
### Runtime/Preview/Player/Export
### Build/Fixture/Release
### Tests/docs/generated

## Persisted/Recovery/cross-version compatibility

只记实际存在的兼容义务；不为空类别制造检查。

## Retained branch

`Disposition: retained` 时只填本节；不填 replacement、target removal phase、zero-reference evidence 或 delete approval。

- Retain reason / current consumer or compatibility obligation:
- Owner 使用记录顶部的唯一字段，不在本节复制。
- Revisit trigger: 例如 consumer 消失、兼容合同变化或真实用户风险出现
- New-consumer policy: 默认禁止新增；共享原语若允许新 consumer，写明理由

## Deletion-candidate branch

`Disposition: deletion-candidate` 时填写以下内容；可按同一 owner 和回滚边界批量留证，不按每个 symbol 制造任务或提交。

- Replacement:
- Target removal phase:
- Stable since wave:

### Migration order and dependsOn

### Zero-reference evidence

### Target behavior tests; manual flow only when automation cannot observe the result

### Applicable cache/async flush/install package check

### Rollback commit

### Delete approval

- [ ] exact deletion target consumers = 0
- [ ] replacement stable for required wave
- [ ] 适用的 package/recovery/manual 证据已通过或按 Invalidating paths 复用
- [ ] Semantic index impact 与 Generated refresh 已记录；实际 generated 重建留到 wave-gate 统一执行
