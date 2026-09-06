# Native Chart 条形方向合同

Owner 已批准的 1.7 常见图表交付增加 V9 / Published V2 对等可选字段 `style.barDirection: 'vertical' | 'horizontal'`。只允许 `chartType: 'bar'`；其他类型携带该字段必须明确失败。缺省保持既有竖向柱状图，不在读取旧文件时补写字段。两种方向均为分组条形，不引入堆积语义。

横向图以数值轴从左向右递增、分类按持久化顺序从上向下排列；负值向零基线左侧延伸，显式数值范围裁剪与竖向一致。分类、系列和数据点身份不变，切换方向是一条 canonical 内容命令并可撤销。切换为其他类型时 writer 必须移除方向字段。

编辑器三 Surface、Published / HTML 共用 Native Chart SVG；PPTX 输出可编辑 `barDir=bar`，分类轴方向与上述顺序一致。PPTX 导入把受支持的横向分组条形图映射到此字段，不保存源 XML 或第二图表真相。Flow DOCX 沿用既有 Chart 导出载体。

正式 schema 保持 strict；旧 reader 遇到新增字段明确失败。合同提交本身不表示 consumer 已交付，完成须有方向、负值、类型切换与保存/导出的行为证据。
