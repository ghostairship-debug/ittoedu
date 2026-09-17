---
name: visual-craft
description: 输入：页面内容、Surface 和视觉要求
---

# visual-craft

以本轮不可变快照、观察和正式能力合同为当前工程依据。可使用 CLI 原生文件、终端、网络、技能与子任务完成用户授权任务；完整资源在本轮 workspace 内按需读取。工程修改只返回宿主可提交的结构化候选，不直接改写 .h5lesson 或其他会话。稳定图文和简单交互使用 Native；复杂局部视觉和互动使用已有或生成组件，整页连续机制使用 Runtime。修改已有载体无需重复解释选择理由。候选检查与宿主提交是不同状态，不把 CLI 原生工具成功说成工程已修改。

公开摘要/进展/答复用用户语言，只讲未保存修改、变化、失败影响和下一步。协议、ID、revision/draftEpoch/会话计数、别名、堆栈留在日志或结构化交付；summary仅为准备，回执前不能称已修改。用户所需代码/JSON/公式/表格照常呈现。

输入：页面内容、Surface 和视觉要求。先建立标题、解释、图示和操作的层次，保证字号、行距、对比和留白可读，避免遮挡与溢出。Flow 保留正文语义，Spatial 保留世界与镜头语义。只输出现有可编辑载体；未取得实际截图时将视觉检查明确列为待验证，不能仅凭元素存在宣称通过。

模型负责图像内容、风格和构图，按显示区域与宽高比调用实际可用图像工具，只用正式支持的参数。取得真实图像后优先用media.apply交付，宿主统一解码并优化副本、导入和应用；失败后可在原授权范围内组合正式基础命令。图片通常长边512–1024像素，小插图争取100–300KB，清晰度优先；文字图、大图细节需要原分辨率时明确preserveResolution:true。宿主保留透明度、比例和完整内容，不覆盖原图。生成式重绘必须使用真实原图和可用图像工具，不能伪造像素变换。图片交付用media.apply，input={kind:"image",source:{$candidateFile:"resources/image.png"}}；背景用pages.backgrounds目标和placement:"background"。仅需新图时启动原生生图工具，等待时准备布局。结果只取路径/元数据，以原生图片通道看图；禁重复打印完整工具对象或base64。用request.json的fileAccess.mediaDelivery交付，或直接输出本轮resources；可复用reusableMedia。失败后组合正式基础命令或文件兜底，保留未指定字段与已提交成果。无需手写复制、压缩、编码脚本。

完整构建、视觉、推进、互动与交付方法见 [build-courseware-project](../build-courseware-project/SKILL.md) 及其引用资料。
