# U01–U10 常规任务改进工程记录

基线：`74a1776bd0592a9e981ef354db3d2616c90c7315`。2026-09-17 按 Owner 授权以隔离工作树滚动并行，ROOT 单写共享合同及集成。Luna/high 执行边界明确的提示、静态解析与校验迁移；Sol/high 执行文本、布局和差异/反馈；Astra/high 执行 Player 生命周期。没有新增真实模型调用，没有提交、标签或发布。

## 已接通的结果

| 包 | 工程结果与直接证据 |
|---|---|
| U01 | Native 多区间保真、Unicode 字素/code-point 映射、原文/上下文精确替换；属性输入捕获实际 beforeinput/IME 选区，Canvas 显式 runs 保持。歧义保稿、失败零提交。6 项 U01 命名检查及 8 项受影响旧行为通过。 |
| U02 | 正常 helper 一次校验并交付；按需标题/控制台说明，失败反馈与已提交结束边界。4 项 U02 检查通过。 |
| U03 | Controller→session→检查器使用关联运行终态，删除时长累计；正常导航卸载与 Stop/重触发/错误目的地分开。3 项命名单元与 1 项真实 Chromium 通过。 |
| U04 | renderer 从同一冻结工程输出 shared componentProps 字段/当前值/可写原因、完整适用位置索引及按需布局关系；首次请求与续轮观察共用，main 只裁剪/运输。3 项字段、冻结身份及 12 KiB 小请求检查通过。 |
| U05 | 正式 compose 与 helper 预检复用唯一 ID/label resolver；partial、前序增删改名/全局影响及未知变更延迟正式宿主解析。3 项命名行为通过，额外前序影响反例通过。 |
| U06 | 手动与 AI 共用正式多选布局规划；精确目标、平面、锁定、旋转、具名状态，候选多步 targets 重绑定后一次正式事务。2 项命名行为、1 项既有多选检查及真实三列画面通过。 |
| U07 | Markdown/math/附件校验迁至唯一只读宿主入口；CLI 仅包装。3 项命名检查通过。 |
| U08 | 阶段格式/附件诊断在正式写入前返回原生会话；修复请求保留原期限且无原生身份时不新开替代任务，文件 Owner 写前再次校验同 source/ticket。3 项阶段命名检查通过；真实原生/材料全链不由协议夹具代替。 |
| U09 | 正式实体按 Owner+稳定 ID 对齐，普通数组保序；资源、比较范围、遗漏及值截断明确。3 项命名检查通过。 |
| U10 | 同一实际差异从 candidate preparation 进入预览、commit receipt、持久化及 native feedback；运行证据保留来源/起点/终点/checked/skipped/failed，不推断教学目标成功。3 项命名检查通过，既有控制器结束/修复/Stop 行为复用。 |

## 集成验证

- `generationTaskFacts`、`generationShortCandidate`、`generationTaskController`、`lessonAuthoringDesktop` 合流检查最终 78 项通过。首次 4 项双路径回执比较因新摘要暴露真实 updatedAt 差异而失败；固定测试时钟后只重验这 4 项并通过，未放宽事务断言。
- 主工程、Electron、E2E TypeScript 检查通过；`build:desktop` 的 Player/Renderer/Electron 构建通过。生成能力制品与最终正式工具、Skill 源一致；未改根 V9/Published Schema。
- `r19NativeInteractionCompletion.spec.ts --grep U03-real-player-navigation`：状态切换、跨场景、错误目的地、取消及作者输入保全；截图与事实在 `output/u03-real-player-navigation/2026-09-16T17-16-15-246Z/`。
- `r19CommonEditingLayout.spec.ts --grep U06-real-layout`：冻结请求→先改文字/属性再对齐/分布→一次事务→序列化重开→真实 Player。三图与说明同列、等距、比例、边界及文字溢出检查通过；截图在 `output/u06-real-layout/2026-09-16T17-24-46-042Z/`。初次夹具 92px 说明框确有溢出，改成 112px 后通过；这是夹具修正，不是产品修复或首次通过。
- 当前 checkout 的相邻组件目录缺失，首次能力生成报告 unavailable；已用本地 junction 连接现有 `C:/Users/74755/Documents/courseware-components` 并重新生成 available 制品，没有删除正式组件能力。junction 不属于版本控制。
- 集成追加 `U08-preserved-native-budget` / `U08-write-guard`：原生 external id 和原 startedAt/deadlineAt 保持、到期与 Stop 拒绝；异步 guard 在 rename 前执行，拒绝时正式文件零覆盖，普通非法源文仍可保存。首轮揭示旧观察计时引用不能跨本地任务复制，以及完成后 Stop 需读取 stoppedSessions；修复后原预算用例通过。旧计时/输入计量仍留原记录，不伪造成新观察。
- 最终合流重新执行两项受依赖变化影响的真实 Chromium 检查均通过，证据更新至 `output/u06-real-layout/2026-09-16T17-30-57-229Z/` 和 `output/u03-real-player-navigation/2026-09-16T17-30-59-791Z/`。小请求与 bundled helper 的新生成输入检查通过。文本超过可靠歧义检查上限且存在格式时明确保稿，追加大重复文本反例通过。

- 最终软件内 Builder 方法按同源明确章节投影，保留载体、片段映射、可编辑性与真实体验核对；缺标记明确失败。两项 U08-stage-input 通过；最终受影响 Renderer/Electron 构建、主工程类型检查通过，能力制品已重新生成。

## 结论边界

本批是 U01–U10 的 engineering candidate，不是 1.9 accepted。没有新的自然模型耗时对照，不宣称整体提速百分比或首次自然任务全部正确。已有电路通过证据不重跑；050 从真实材料及四稿开始的完整普通教师链、060 与 Owner 签署仍独立未完成。Runtime 工作副本助手、具体组件列表结构与动态采样优化未出现本次所需触发证据，依既定方案不扩面。
