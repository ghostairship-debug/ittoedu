# 目标、原则与非目标

## 1. 一级目标

### G1 能力不降级

重构前可达的编辑、组件、Runtime、互动、媒体、全局层、教师控制器、预览和导出能力，重构后仍可达并可继续增强。

### G2 高可用性

核心流程在重复操作、切页、撤销、保存重开、预览和导出中行为稳定，不再依赖“正好同步成功”的多套状态。

### G3 唯一可写作者真相

所有持久化编辑最终修改同一个 `CourseProjectDocument`；任何 V8-shaped Project、Published payload、Workspace snapshot 和 Player input 都只能派生。

### G4 无环模块边界

Core 不依赖具体 Surface/Feature；Surface/Feature 通过窄 ports 使用 Core；App/use-case composition 组合跨模块操作。

### G5 AI 按需认知

建立必要的静态 repo-index；编码 AI 先读取可确定、可检查的 Context Pack，只在证据不足或低置信时显式降级到 Bootstrap 并扩展读取。

### G6 单人可维护

不引入需要专职平台团队维护的框架、服务或流程。每个任务可以小范围修改、独立验证和回滚。

### G7 软件做减法

先删除无消费者旁路、重复真相和无必要中间层，再考虑新抽象。架构工作不以目录数、Facade 数、文档数或新模式为成果，以用户动作更可靠、旧路径更少和认知负担下降为成果。

## 2. 实施原则

1. 先保护已经正确的 V2 主路径，再迁移剩余 Legacy consumer。
2. 先建立公共缝隙和依赖棘轮，再移动实现。
3. 先做一个端到端纵切证明 Core 设计，再扩大到所有命令。
4. Surface-specific carrier 不为“统一”而丢失语义。
5. 当前事实、目标验收和迁移期例外分别记录。
6. 只有两个以上真实消费者才抽公共抽象。
7. 迁移期旧接口必须显式 `legacy`、只允许减少消费者。
8. 复杂验证集中在阶段收口，不在每个小任务重复。
9. 删除以 consumer 清零和行为替代为证，不以文件名或使用频率判断。
10. 文档和索引服务开发，不成为新的主要维护负担。
11. 当前正常生命周期恰有一个活动 V9 Surface session；架构统一不以构造第二个导航真相或 sessionless V9 为手段。
12. `src/shared/contracts/**` 默认只读；稳定化内部重构不通过改合同规避边界问题。
13. 自动多智能体只能从 exactly-one-active 总纲、详细子计划和任务板领取工作；旧计划、评估与历史卡不参与当前调度。

## 3. 非目标

本轮不做：

- 新功能路线扩张；
- V10 或破坏性 V9 变更；
- 重写全部 UI 或视觉系统；
- 迁移到 Redux、事件溯源、CQRS、Command Bus 或微前端；
- 图数据库、向量数据库、Embedding、Daemon、Watcher；
- 函数级完整调用图或“自动理解全部业务”；
- 一次性拆完 Store/Workspace/Properties；
- 为所有文件强制行数上限；
- 每次提交跑完整 E2E/desktop/verify；
- 清空历史任务和评估证据；
- 把代码工作区写进 persisted V9。
- 新建第三 Toolbar 模式、新 Code Workspace 入口或扩展一套 IDE 式产品路线；现有 DeveloperTab 只做保留与稳定接线。
- 为索引建设图数据库、常驻服务、完整函数调用图或第二套 CI。

## 4. 成功结果

最终应出现以下可观察结果：

- 一个用户动作只产生一条逻辑历史；
- 切 location 后过期异步回调无法写错页面；
- 保存重开与撤销/重做不丢素材或组件字节；
- Slide、Flow、Spatial 修改互不要求理解对方内部实现；
- App、Workspace、Properties 主要承担编排和路由；
- Legacy producer/Project consumer 有明确剩余数并持续下降；
- AI 修改一个 Feature 时通常只需读取数十 KB 上下文；
- 阶段完整验证通过，代表工程和人工核心流程可用。
