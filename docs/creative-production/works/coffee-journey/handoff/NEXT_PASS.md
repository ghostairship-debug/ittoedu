# 接续交接｜《一杯咖啡的远行》r179

更新：2026-10-22；本文件只描述**当前正式版本、已签范围和下一步**。历史操作和旧软件 bug 不再逐轮叠加到当前交接。

## 单一当前版本

- [正式 GLX](../design/v05/native/coffee-journey-v05.glx)：**Project 11 / revision 179**，SHA-256 `e3303319b283afe4284628adb07a06e00251435569cd37268ad9171426e5ab90`。
- [正式单 HTML](../design/v05/native/coffee-journey-v05-offline.html)：14,986,940 字节，SHA-256 `c434a3a392d012373720747d4564dddfc217a46b32656d4c3f7cfa27e6adc237`。
- 上述文件来自经验证的冻结原件：`output/structured-coffee-fidelity-20261021/full-final-20261021/workspace/coffee-journey-v05-delivery.glx`，及 `output/independent-repair-20261022/ui-final/coffee-journey-r179-reverified-offline.html`。两份备份与当前副本字节一致；任何新创作从当前 GLX 的**新命名副本**开始。
- [交付 manifest](../design/v05/DELIVERY_MANIFEST.json)；[总入口](../README.md)。独立网页 [index.html](../design/v05/index.html) 是设计/浏览器参考，不代表 GLX 作者事实。

## 确认有效的现状

七章已装配：1 Flow，7 原生 group，62 原生文字，8 原生标题块，8 原生图片，7 背景形状，3 局部 HTML 程序。更新后的生产构建中，目标编辑、Undo/Redo、保存、新进程冷开、离线 HTML 导出以及 1440/390px 的章节导航、三段互动和图片解码均有实测。详见 [软件修复收口](../../../../development-plan/20261022-unified-edit-performance/REPAIR_RESULT.md)。

**不再当作当前阻断**：旧版挂载 append 祖先循环、全篇 390px 缩小、内置源码分发导致新建/导出失败、嵌套文字属性失联、父组没有普通间距控件。历史证据已独立保留。大 HTML 保存仍可能较慢；部分固定作者画幅和局部程序内部在小屏可能缩小，不等同于“整篇重排失败”。

## 下一轮最小充分创作收口

1. **优先 U06**：提高杯、滤杯、物质迁移和稀释的动态图解美术与移动端标注可读性，保持既有计算与操作行为。
2. **其次 U03**：让比较模式直接可见各状态组织保留差异，提升矢量层区分与小屏图例。
3. **U05**：只做少量最后画面检查，保留已通过的关键帧；不重新大规模生图。
4. **复用验收**：把固定溶质稀释引擎带入另一主题的 GLX，用正式事务改配置并完成保存、冷开、离线输出。
5. **[背景 Runtime 与创作收口执行方案（待实施）](COFFEE_RUNTIME_AND_CLOSEOUT_PLAN_20261022.md)**：按最新决定优先采用**唯一 Global Underlay** 接管全篇背景：先在实验副本中打通 Flow 纸面/章节及局部程序透明化，再验证真实 Flow 阅读进度→一份 Source Runtime→三锚点移动。前景对象均在 Underlay 上方，允许轻微视觉重叠；U04/U05/U06 浅深背景交界重点查文字对比度。Codex 当前软件修复期间不启动创作代码或装配；背景目前没有实现。
6. 收尾后刷新 manifest、代表性截图、[参考案例索引](../design/v05/REFERENCE_CASES.md)，再宣布参考样本收口。Owner 最终接受与发行另议。

## 执行边界

普通标题、正文、图注和图片保留原生身份；U03/U05/U06 拥有各自最小完整交互状态。必须用当前工程的 `project.read` / `project.list` 找真实实例地址，沿统一 Session 事务修改；局部源码文件的变化不自动同步入 GLX。检查目标和邻居、撤销/重做、保存冷开及实际离线导出。操作 ID 唯一；若提交结果未知，先查询原 operationId，避免重复写入。

本文件不授权自动推送、发行、调用付费模型或启动背景动画产品架构重构。历史版本和过期交接已撤出默认资料树，归档账本在 `output/coffee-document-cleanup-20261022/`。
