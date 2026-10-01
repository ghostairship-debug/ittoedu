---
name: build-courseware-project
description: 将已有教学 HTML 机械导入为可编辑课件并真实保存；默认交付初稿，选页精修由用户发起。
---

# 导入并交付初稿

读取当前框架和用户有效约束，保留已确认的页序、文字、图示和互动。使用正式文件、HTML 导入与保存工具；载体按用户要求和页面性质选择，简单映射交给宿主。不要求教师切换到编辑器仓库；只有外部案例构建才按需读 [外部 Builder](references/external-case-build.md)。

框架遵循 [短 HTML 合同](references/html-draft-contract.md)。复用 HTML Runtime 的图文轻编辑能力，不为可编辑性把整页重写成 Native，也不在原 HTML 按钮上覆盖第二套原生按钮。共享脚本无法等价拆页时保留源码，说明具体依赖；不删除互动逻辑或隐藏问题页换取准入通过。必要时读 [短能力简介](references/representation-capabilities.md)，不默认创建表示规划文件。

走 `file.create → html.import → file.save`。导入成功后立即保存目标 `.h5lesson`，使用本任务的整文档正式句柄；不传路径充当 target，不使用只读选区或正文写句柄保存整份文档。以保存回执的 savedRevision/currentRevision、dirty 状态为准。使用正式文件字节回读核对场景、资源和持久化版本；仅打开已有标签不是磁盘重开证据。

复用宿主编译、闭包和真实运行准入；默认不展开逐页 AI 视觉精修、全树遍历、未被请求的导出或旧文件清理。出现具体功能失败，或用户明确要求高质量成品/精修时，按需使用 `view.observe/html.observe`，复用本任务已有有效证据，不为少报错取消这些能力。用户要求导出时可更新本任务未被修改的同名输出；其他文件保留，不能先清空、删除再导出。

交付初稿位置、已完成内容和待精修／缺失项。核心教学呈现必须存在，不能把空骨架或失效互动称为完成；不声称未经验证的视觉或教学验收。初稿交付后由人选页、选对象，再用画布或元素 AI 卡局部修改；完整精修只在用户要求时进行。

按用户用途区分[教学推进](references/main-progression.md)。只有外部 Builder 或用户要求完整工程时再展开 [build-method.md](references/build-method.md)，不把它的完整 QA 义务施加给默认初稿。
