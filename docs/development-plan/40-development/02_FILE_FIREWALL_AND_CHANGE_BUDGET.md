# 文件防火墙、读取权与变更预算

## 1. 四态范围

### Allowed write

任务可修改的精确路径/符号，仍只能服务当前 Goal。

### Required read

必须读取、不可修改的合同、调用者、消费者、测试和热点上下文。

### Forbidden write

任务禁止修改的路径/符号。Forbidden write 不等于禁止读取；当正确性需要时可以读取并引用，但不得修改。

### Do not read unless needed

为控制上下文默认不读的历史、生成正文和无关模块；证据不足时可扩读并记录原因。

## 2. 默认规则

非合同任务默认把以下设为 Required read 或 Forbidden write，而不是禁止读取：

```text
src/shared/contracts/**
artifacts/contracts/**
docs/contracts/**
```

非依赖任务禁止写 package-lock；非索引任务禁止写 generated repo-index；非发布任务禁止写 release/electron builder。产品任务可读取这些路径核对消费者和发布影响。

## 3. 热点符号锁

任务卡除路径外列具体 Hotspot locks，例如 Store 的 selector/transaction/history、App 的 save/publish、Workspace 的 Surface routing。相同 symbol/lock 同时只有一个 Owner。

## 4. Change Budget

S1/S2 均必须写明：

- 主要源码文件上限/预期范围；
- 新文件与移动文件范围；
- 公共导出上限；
- 是否允许删除；
- 是否允许依赖/lockfile 变化；
- 是否允许 UI 文案/行为变化；
- Schema/合同变化是否允许；
- generated diff 是否允许；
- 目标测试数与预计验证时长；
- 最大实现重试次数；
- 允许持有的热点锁。

预算阻止范围蔓延，不追求机械的最少代码。超过预算时 Worker 不自行继续，由 Coordinator 缩卡、拆卡或提升风险等级。

## 5. 越界申请

Worker 发现必须修改 Forbidden write 时提交：requested path/symbol、现范围为何不足、最小新增范围、风险和验证变化。Coordinator 仅在仍属于原产品目标且热点可独占时更新卡；否则新建 dependsOn 任务。

## 6. 依赖棘轮

现有 deep import/raw Store 违规先建立 baseline，只允许下降。禁止通过 re-export 整个 Store、复制内部 slice 或建立平行 adapter 层绕过棘轮。
