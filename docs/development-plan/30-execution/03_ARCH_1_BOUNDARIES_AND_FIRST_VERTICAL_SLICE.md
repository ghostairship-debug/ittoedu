# ARCH-1：无环边界与第一个完整纵切

前置：ARCH-0A 基线与 ARCH-0B 上下文安全门禁已通过。本阶段只证明一个完整用户动作，不为所有 Feature 预建 Facade。

## 1. 边界棘轮

在现有违规基线上只允许下降：Core 不依赖具体 Surface/Feature；Player 不依赖 renderer Store；新 Feature 不 deep import 其他 Feature；新 UI 不新增 legacy Store action；公共入口不导出 raw Store Hook；contracts 对非合同任务只读。

## 2. 纵切选择

默认行为：在 Slide 中替换已选图片，并覆盖文件对话框打开期间切 location/切 project。若 characterization 证明另一项媒体操作具有更清晰边界，可由 Coordinator 自动改选，但一次只能选择一个。

纵切必须覆盖：

- stable AuthoringTarget；
- V9 document change；
- asset bytes/resource change；
- 一条 undo/redo；
- save/reopen；
- Preview；
- 一个适用 Export consumer。

## 3. 自动任务拆分

```text
VS-01 characterization 与已知失败
VS-02 AuthoringTarget/stale guard 纯逻辑
VS-03 最小 transaction/resource plan
VS-04 Surface/Media command
VS-05 App/Store 热点接入
VS-06 desktop end-to-end 与代表工程
```

VS-01～04 可在写锁互不重叠时并行；VS-05 仅 Coordinator 持有热点锁；VS-06 在接入后运行。

## 4. Target 合同

从现有 CourseAuthoringSession 演化，不创建第二个导航 Store。target 至少能区分 project、revision policy、session generation、surface/location/owner 和 item identity。revision 冲突按当前 command 的策略返回显式结果，不默认覆盖。

## 5. Transaction 最小职责

一次获取 canonical V9 document 与资源状态，验证 target，执行一个纯命令，原子应用 document/resource changes，写一条 history，更新 revision/dirty，并返回 selection hint 与用户可行动反馈。

首次实现只服务本纵切；不建设 Command Bus、不泛化所有命令、不扩建 Code Workspace。

## 6. 完成门槛

- 同 target 正常提交；切 location/project、删除 item 后拒绝；
- 图片元数据与字节一起撤销/重做；
- 一个用户动作只有一条历史；
- 保存重开后继续编辑正确；
- Preview 与一个导出使用新结果；
- 旧入口可作为兼容 adapter，但本纵切不双写；
- 目标测试、相关类型/集成与一条桌面流程通过；
- 三份代表工程适用流程无关键回归。

## 7. 停手条件

- 需要修改 V9 Schema；
- Core 必须 import 具体 Surface selection；
- 仍需同时写 V8 Project；
- 需要重写整个 Store；
- 新接口只能通过暴露 raw Store 工作；
- 同一设计连续三次接入失败。

ARCH-1 未完成前不得扩到多个 Feature、三个 Surface 或大规模 Legacy 迁移。
