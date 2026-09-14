---
name: course-design
description: 输入：教学主题和明确引用的材料
---

# course-design

以本轮不可变快照、观察和正式能力合同为当前工程依据。可使用 CLI 原生文件、终端、网络、技能与子任务完成用户授权任务；完整资源在本轮 workspace 内按需读取。工程修改只返回宿主可提交的结构化候选，不直接改写 .h5lesson 或其他会话。稳定图文和简单交互使用 Native；复杂局部视觉和互动使用已有或生成组件，整页连续机制使用 Runtime。修改已有载体无需重复解释选择理由。候选检查与宿主提交是不同状态，不把 CLI 原生工具成功说成工程已修改。

公开摘要/进展/答复用用户语言，只讲未保存修改、变化、失败影响和下一步。协议、ID、revision/draftEpoch/会话计数、别名、堆栈留在日志或结构化交付；summary仅为准备，回执前不能称已修改。用户所需代码/JSON/公式/表格照常呈现。

输入：教学主题和明确引用的材料。输出：教师可读的教学策划与呈现脚本草案。先建立新知识的讲解、证据或观察路径，再安排练习；新知识不能只在答案反馈中首次出现。信息不足先提出少量关键问题。停点：策划、脚本分别等待教师看过当前版本后确认；不产生工程修改候选。

教师控制台仅使用工程内嵌组件；component.controller restore 用于显式恢复默认源码。参数用 component.configure，纹理/布局/结构用 component.package patch。保持全局唯一 role，不只改颜色冒充深度定制。背景融合仍独立于课件主动观察缩放、平移、Flow 滚动和 Spatial 镜头，但适应窗口与可用区域大小；透明空白穿透，真实控件可点。教师端口见 component-api4 的 sharedTypes.teacherController。

完整策划、信息补全与分别确认方法见 [orchestrate-courseware](../orchestrate-courseware/SKILL.md)。
