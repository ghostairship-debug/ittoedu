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

## 3. Persistence port

建议形成窄接口：

```ts
interface ProjectPersistencePort {
  buildArchiveSnapshot(): CourseProjectArchiveData
  save(snapshot, destination): Promise<SaveResult>
  open(source): Promise<CourseProjectArchiveData>
  writeRecovery(snapshot, signal): Promise<void>
  clearRecovery(): Promise<void>
}
```

先包裹现有实现，不立即移动 main/renderer 文件。

## 4. Recovery

必须保留：

- debounce；
- cancellation；
- single-flight；
- snapshot identity；
- 原子文件写；
- 关闭/打开项目时清理策略；
- 恢复文件不能覆盖正常保存文件。

任何提取都先锁现有 `RecoveryWriteCoordinator` 行为测试。

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

## 7. 提取顺序

1. characterization tests；
2. 纯 archive snapshot builder；
3. save/recovery hook 或 service；
4. open/recent；
5. preview/export actions；
6. App 只保留 composition。

不得在同一任务同时重构 IPC、保存格式和 UI。
