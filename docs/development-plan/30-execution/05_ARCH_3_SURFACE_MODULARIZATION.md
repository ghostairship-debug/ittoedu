# ARCH-3：Slide、Flow、Spatial 纵向模块化

前置：ARCH-2 公共 Feature 入口稳定。目标是修改一个 Surface 时无需理解另外两个内部实现，而不是追求目录整齐。

## 1. 先证明需要，再按行为抽 seam

Coordinator 先分别盘点 Slide、Flow、Spatial 的真实修改行为、跨模块 consumer 和任务上下文成本。没有可复现问题、真实跨边界 consumer 或可量化理解范围下降的 Surface，记录 skip condition，不创建模块化任务。

不得预先为三个 Surface 补齐 selector、command、placement、authoring view model、preview/export adapter 矩阵。具体行为首次跨越边界时，才抽取最窄 seam，并在同卡接入首个 consumer 或替代一个指定旧入口；未被消费的接口不进入公共入口。

每个 Surface 可独立证明和推进，不以“三个 seam 全部建立”作为其他 Surface 的前置。

## 2. 仅对已准入行为并行

Coordinator 按实际已准入且写入范围互不重叠的 Slide、Flow 或 Spatial 行为动态分配最多三个 Worker；不为三个 Surface 各预留一条施工线，也不要求三路同时存在。Worker 可读热点但只在各自 Surface 范围写入。Workspace、Properties、App、Store 始终由 Coordinator 串行修改。

## 3. Surface 不变量

### Slide

保留场景/状态、图层 owner/order、authoringAddress、Phaser 编辑命中、保存/预览/导出。

### Flow

正文保持文档顺序和嵌套，普通 block 不进入 generic z-order；保留 wrap/paperSpace、公式/表格/代码/标注、DOCX/PDF 阅读顺序、FlowComponentBlock 和 IME。

### Spatial

保留无限/有限边界、自由逛、镜头画面/路径巡游、手势优先和 session camera 不写回。

## 4. UI Integrator

Workspace 只路由 Surface、组合 chrome/Try-run；Properties 根据稳定 authoring address 路由 view model/editor。不得借接入一次性重写所有控件、CSS 或键盘/focus 行为。

## 5. 已修改 Surface 的完成门槛

- 对实际修改行为适用的 command/unit、UI integration、save/reopen、Try-run/Preview 和导出验证；
- 对受影响交互适用的 keyboard/focus/DnD/IME/gesture 清单；
- 修改该 Surface 不需读取另两个内部实现；
- Workspace/Properties 只保留路由与组合。

如果拆分只是移动文件、没有降低依赖或任务上下文，则停止该 Surface 的进一步拆分，其他 Surface 可继续。若三个 Surface 均无合格实现目标，ARCH-3 可以零张实现卡结束；阶段门只证明当前边界与代表流程，不为满足标题造 seam。
