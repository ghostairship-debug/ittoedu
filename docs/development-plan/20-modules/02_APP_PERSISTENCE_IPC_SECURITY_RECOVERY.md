# App Shell、保存恢复、IPC、安全与主进程边界

## 1. 已存在并保护的保存链

当前 `currentCourseArchiveData()` 已读取：

```text
active CourseProjectDocument
+ selectMediaAssetFiles
+ componentPackagesToArchiveFiles
```

`handleSave` 已有：

- single-flight；
- 保存启动时同时保留 document、sidecar 与 component packages 的快照身份；当前源码比较对象身份而不只比较 revision，迁移后应改成显式 snapshot/resource generation token，不能退化成只看文档 revision；
- 保存期间继续编辑后的 dirty 反馈；
- recent project 刷新；
- recovery 清理。

本轮不从零重建 Save。

## 2. App 的目标职责

App 层只负责编排：

- new/open/recent；
- save/save-as；
- recovery；
- preview/export action；
- Catalog 文件操作；
- dialog、status、error feedback；
- 跨 Feature use case composition。

具体格式、Surface 命令、package lifecycle、diagnostic rule 留在各模块。

## 3. Persistence 边界与按需 Port

现有保存链可以继续由当前实现承担，不因目标目录或接口整齐而抽 Port。只有出现可复现保存/恢复错误、第二个真实 consumer、明确旧入口替代目标或可量化上下文下降时，才考虑形成完成当前行为所需的最窄接口，例如：

```ts
interface ProjectPersistencePort {
  buildArchiveSnapshot(): CourseProjectArchiveData
  save(snapshot, destination): Promise<SaveResult>
  open(source): Promise<CourseProjectArchiveData>
  writeRecovery(snapshot, signal): Promise<void>
  clearRecovery(): Promise<void>
}
```

该接口只是候选形状，不是待建合同。新增时必须在同卡接入首个真实 consumer 或替代指定旧入口，并写明退出条件；否则直接局部修复，不移动 main/renderer 文件，也不新建 Service、Coordinator 或平行生命周期。

## 4. Recovery

必须保留：

- debounce；
- cancellation；
- single-flight；
- snapshot identity；
- 原子文件写；
- 关闭/打开项目时清理策略；
- 恢复文件不能覆盖正常保存文件。

只有提取实际影响 `RecoveryWriteCoordinator` 边界或现有行为不清时，才补对应 characterization；局部且已被 focused 测试直接观察的修复不重复建立整套行为基线。

## 5. Main / Preload / IPC Owner

### Main

- 文件对话框和路径；
- project persistence；
- preview window；
- PDF；
- component catalog scan；
- diagnostic log；
- security/trust；
- application identity。

### Preload

- 只暴露最小 desktop API；
- 每个 channel 与 shared IPC type 对齐；
- 不向 renderer 暴露 Node/Electron 任意能力。

### Shared IPC

- request/response 类型；
- error shape；
- 文件字节与路径合同。

## 6. 安全边界

架构重构不得削弱：

- component path/trust 检查；
- protocol 限制；
- 文件扩展名与 archive 校验；
- hash/完整性在组件包中的既有用途；
- window isolation；
- renderer 无直接文件系统权限。

repo-index 不进入产品运行时，也不通过 IPC 暴露。

## 7. 已准入行为的候选步骤

每个保存、恢复、open/recent 或 preview/export 行为独立准入，不构成固定提取序列：

1. 先用当前源码和 focused 结果证明具体风险、consumer 或复杂度收益；
2. 能局部修复时直接修复，不先抽层；
3. 只有当前行为需要时才提取最窄 snapshot builder、hook 或 Port，并在同卡接入首个 consumer；
4. 其他行为只有各自通过准入才迁移，不因前一项已抽接口而自动跟进；
5. 旧入口只有在精确 consumer 为 0 且回滚边界明确时才删除，兼容用途成立时可以 retained。

一个候选域没有合格实现目标时允许零改动。任何已准入任务仍不得同时重构 IPC、保存格式和 UI。
