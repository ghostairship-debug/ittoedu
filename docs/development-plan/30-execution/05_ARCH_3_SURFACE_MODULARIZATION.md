# ARCH-3：Slide、Flow、Spatial 纵向模块化

前置：ARCH-2 公共 Feature 入口稳定。目标是修改一个 Surface 时无需理解另外两个内部实现，而不是追求目录整齐。

## 1. 先串行建立 seam

Coordinator 先为三个 Surface 建立最小公共入口：selector、command、placement、authoring view model、preview/export adapter。只导出真实跨模块消费者需要的符号。

seam 未稳定前，不并行拆三个 Surface。

## 2. seam 后三路并行

- Worker A：Slide——scene/state、LayerItem、Phaser 编辑命中、文本/媒体/组件/Runtime；
- Worker B：Flow——FlowBlock、overlay、layout/wrap、contenteditable/IME、FlowComponentBlock、print/export；
- Worker C：Spatial——world items、camera/path/relation、semantic zoom、session viewport 与手势优先；
- Coordinator：Workspace/Properties/App 接入与热点删除。

Worker 可读热点但只在各自 Surface 范围写入。Workspace、Properties、App、Store 始终由 Coordinator 串行修改。

## 3. Surface 不变量

### Slide

保留场景/状态、图层 owner/order、authoringAddress、Phaser 编辑命中、保存/预览/导出。

### Flow

正文保持文档顺序和嵌套，普通 block 不进入 generic z-order；保留 wrap/paperSpace、公式/表格/代码/标注、DOCX/PDF 阅读顺序、FlowComponentBlock 和 IME。

### Spatial

保留无限/有限边界、自由逛、镜头画面/路径巡游、手势优先和 session camera 不写回。

## 4. UI Integrator

Workspace 只路由 Surface、组合 chrome/Try-run；Properties 根据稳定 authoring address 路由 view model/editor。不得借接入一次性重写所有控件、CSS 或键盘/focus 行为。

## 5. 每个 Surface 的完成门槛

- command/unit；
- UI integration；
- save/reopen；
- Try-run/Preview；
- 一个适用导出；
- 人工 keyboard/focus/DnD/IME/gesture 清单；
- 修改该 Surface 不需读取另两个内部实现；
- Workspace/Properties 只保留路由与组合。

如果拆分只是移动文件、没有降低依赖或任务上下文，则停止该 Surface 的进一步拆分，其他 Surface 可继续。
