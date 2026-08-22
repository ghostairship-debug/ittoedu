# 全局架构与产品不变量

以下规则是重构期间最重要的正确性护栏。

---

## 数据

1. Course Project V9 是唯一 persisted 作者工程协议。
2. 本轮默认不创建 V10。
3. 一个当前工程只能有一个可写 `CourseProjectDocument`。
4. 投影、View、Workspace snapshot、Published payload 均只读。
5. 不从 Player DOM/Canvas 反建作者工程。
6. Stable ID 不用数组下标、DOM ID 或临时 hit ID 代替。
7. Asset metadata 与 bytes 必须可对应。
8. Component metadata 与 package bytes 必须可对应。
9. 保存只读取 canonical document 和 sidecars。
10. 代码模式不能绕过 Schema 和统一 command。

## 历史

11. 一次用户操作形成一条逻辑 history。
12. 拖拽只在结束时提交。
13. 文本/代码草稿提交时进入 history。
14. Document patch 与 binary delta 同事务。
15. Undo/Redo 后保存重开语义一致。

## 模式

16. 简单、专业、代码模式不维护不同文档。
17. 模式只影响展示和编辑层级。
18. 高级能力可隐藏但不可无替代删除。
19. 模式切换不清空 history。
20. 模式切换不重建项目。

## Surface

21. Slide、Flow、Spatial 内部模型不强行统一。
22. 三 Surface 共用 Editor Core transaction/history。
23. Workspace 只负责 Surface 路由。
24. Properties 只组合当前 Feature 编辑器。
25. Surface 切换不复制 document。
26. Spatial 运行态相机默认只改 session。
27. Flow authoring 与导出读取同一模型。
28. Phaser proxy 不成为保存真相。

## Component/Runtime/Interaction

29. Catalog、Installed Package、Instance、Authoring 是不同概念。
30. 三 Surface 共用 package lifecycle。
31. Runtime 和 Component 保持既有协议。
32. 简单动画最终生成标准 InteractionRule。
33. 专业/代码模式共用同一 rule/runtime command。
34. Player 执行只改运行会话。

## Player/Export

35. Try-run 与 Full Preview 共用 Published producer。
36. Player 不导入 Renderer Store。
37. Export 不修改作者文档。
38. 导出预检按目标运行。
39. Component/Runtime 静态导出使用明确 fallback/capture。

## Diagnostics

40. Structural error 与 authoring advice 分离。
41. Visual density 不作为硬错误。
42. 普通教师只看到上下文可行动提示。
43. 专业和代码模式保留完整分析能力。
44. 不随每次编辑重算全部分析。

## Knowledge System

45. 索引低于源码和 Schema。
46. 自动图不存完整源码。
47. 产品能力索引与开发代码索引分离。
48. Context Pack 默认一层依赖。
49. 历史任务默认排除。
50. 索引结构变化后必须重建或明确 stale。
