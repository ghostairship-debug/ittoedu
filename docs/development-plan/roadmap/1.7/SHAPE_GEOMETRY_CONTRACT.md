# 1.7 Native Shape 路径与线性渐变增量合同

对应 `r17-042-pptx-shape-geometry`。本提交只定义兼容可选字段及 V9 / Published V2 对等解析；消费者与导入 writer 未完成前不宣称可用，不产生这些字段。

`NativeShapeContent.pathGeometry` 为可选的 `{ paths }`。每条路径保存 `fill`、`stroke` 与 `commands`；指令仅含 move / line / quadratic / cubic / close，点为相对于外层 frame 的坐标。控制点允许超出框外（范围 -100–100），不得夹到 0–1。每条路径须先 move，close 后须重新 move；最多 64 条路径，每条最多 4096 指令。填充采用 nonzero 规则，子路径独立决定是否使用形状填充及描边。

自由路径仅使用既有 `shapeType: rectangle` 载体；字段存在时路径是唯一几何，rectangle 不作为后备绘制，也不另存源预设、调整公式或 XML。不得同时指定 lineGeometry 或其他预设。字段缺省的既有矩形与线段语义不变。预设括号的参数化扩展另行定义，不用自由路径覆盖已有预设参数。

`style.fillGradient` 可选值为 `{ kind: linear, start, end, stops }`；start/end 是同一 frame 坐标，必须不同。2–64 个色标按 offset（0–1）非降序排列，重复位置保留硬分界。每个色标保存六位 HEX color 与 opacity（0–1）。渐变存在时替代 fillColor；色标透明度再乘既有 fillOpacity 和外层 opacity。缺省仍使用原纯色，不读取时自动物化字段。纯色字段保留供教师切换填充模式，不能作为不支持渐变时的静默回退。

V9 与 Published V2 复用同一 strict Native content schema；未知字段、未知指令、非有限数、错误顺序、冲突载体均拒绝。旧文件缺省读取不变，旧 strict reader 对新增字段明确拒绝。保存、状态覆写、作者同步、Player 与导出只消费这一份几何/填充数据。PPTX 源路径需在导入时转换为该表达；未知公式与无法表达的渐变须明确报告，不保存 XML 或第二几何模型。

## 括号参数增量

`braceGeometry` 仅允许既有 brace-left / brace-right，值为 strict `{ curvatureRatio, midpoint }`。curvatureRatio 在 0–100，表示端部椭圆纵半径相对于 min(width,height) 的比例；实际半径上限为 `height * min(midpoint, 1-midpoint) / 2`。midpoint 在 0–1，表示尖点相对于形状高度的位置。右大括号为左大括号的水平镜像。不得与 pathGeometry / lineGeometry 并存。参数只定义描边几何，既有括号不填充语义不变。

缺字段时继续旧固定括号外观，不自动物化。参数存在时所有消费者按同一参数解析；导入 OOXML leftBrace/rightBrace 的 adj1/adj2 分别除以 100000，保存的参数是唯一几何，不能同时保存求值路径或源 XML。PPTX 导出回写预设调整；作者/Player 的椭圆弧采用统一曲线求值。未知调整公式明确拒绝。

本增量须先独立提交再交付消费者。合同解析测试不证明消费者、样本三个括号与一个标注的视觉闭环已完成。
