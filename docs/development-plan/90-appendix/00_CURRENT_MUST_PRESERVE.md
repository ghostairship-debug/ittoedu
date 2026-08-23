# Current Must Preserve：当前已经成立的硬约束

以下是现状中已经正确、任何阶段都不得破坏的能力。

## 协议与工程

1. Course Project V9 是唯一受支持的作者工程格式。
2. 不导入 V8 `.h5lesson`。
3. V9 已有字段、判别器和语义软冻结。
4. Published Course V2、Runtime API 2/3、Component API 4 的版本边界保留。
5. 项目 `id` 与单调 `revision` 语义保留。
6. `globalLayerItems`、`surfaceLayerItems` 和三 Surface 保留。
7. 不新增 persisted `projectMode`。

## 产品能力

8. Slide、Flow、Spatial、Mixed 均可创建和编辑。
9. Flow 普通正文保持 FlowBlock 文档流。
10. FlowComponentBlock 保持稿纸组件 carrier。
11. Spatial 运行时可自由逛并支持镜头巡游，会话相机不写回。
12. Phaser 保持 Slide 编辑能力，不重新成为 V9 运行主路径。
13. 高级编辑、组件、Runtime、互动、媒体和代码能力不被删除。
14. 全局层入口保持可发现。
15. 教师控制器保持全局单份；运行态会话拖拽不写回工程。

## 保存与运行

16. Save 从活动 V9 document、asset sidecar 和 component files 构建 archive。
17. 保存 single-flight 与“保存期间继续编辑仍为 dirty”行为保留。
18. RecoveryWriteCoordinator 的 debounce/cancel/snapshot 语义保留。
19. V9 Try-run/Full Preview 的 CoursePlayer + Published V2 主路径保留。
20. HTML/Web 的 V2 主路径保留。
21. Player 不导入 renderer Store。
22. Preview/Export 不反向写作者数据。
23. Component/Runtime 在保存、Player 和导出中使用一致的工程字节。

## 编辑一致性

24. stable authoringAddress 不被临时 hitId 取代。
25. global/surface/scene/world owner 语义保留。
26. contenteditable/IME composing 时不被无提示提交或切页覆盖。
27. 拖拽只在明确结束时形成逻辑提交。
28. 简洁/专业只是 UI 能力披露，不是不同工程真相。
29. DeveloperTab 已有代码能力不得因模式整理消失。

## 工具与治理

30. contracts 和 ai-capabilities 生成/check 保留。
31. read-model boundary 与 forbidden-token 棘轮保留并扩展。
32. `.agents/skills` 的两个课件工作流入口保留。
33. 自动化最多证明 engineering candidate。
34. 未经明确教师验收不得宣称 accepted/发布。
35. 用户未提交修改不得被自动回退或覆盖。
