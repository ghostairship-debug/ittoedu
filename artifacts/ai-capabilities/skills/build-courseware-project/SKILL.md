---
name: build-courseware-project
description: 将已有本地 HTML 或创作好的 HTML 新建为可编辑课件并保存；适用于第三方页面导入、HTML 转课件和课件创作后的交付。
---

# 从 HTML 交付课件

取得用户指定或本任务已经生成的 HTML 文件，保留其内容、样式、资源和互动。直接导入第三方 HTML 时无需重新策划、改写正文或先套模板。

调用任务入口 `course.createFromHtml`：

```json
{"sourcePath":"D:/课例/lesson.html","name":"斜抛运动","path":"D:/课例/斜抛运动.h5lesson"}
```

只有 `sourcePath` 必填；`name` 是作品名称，`path` 是用户指定时提供的新工程保存位置。宿主负责建立工程、解析内容、分配身份、绑定资源、选择组合或程序载体、导入和保存。以本次任务结果返回的实际保存路径与状态交付，不再拆成创建文档、寻找内部句柄、导入、保存等模型回合。

普通 HTML/CSS 可以直接输入。可识别的静态内容进入可编辑 Web 组合；需要整体执行的脚本与事件保留为 Runtime。不能把所有程序内部元素宣称为原生对象。局部组件问题按宿主诊断修复，保留原件与其他可用内容，不删除互动逻辑、不截图静态化、不叠加第二套按钮换取成功。

HTML 页面的普通结构、拆页适用条件及共享逻辑边界见 [HTML 输入与分页](references/html-draft-contract.md)；只有需要解释编辑能力差异时再读[承载方式](references/representation-capabilities.md)。不要求第三方源文件添加页编号、可编辑登记表或私有标记，不默认读取完整工程 Schema。

交付实际保存的 `.h5lesson` 路径、已保留的主要内容与具体缺口。核心教学呈现必须存在；创建任务返回成功并不代表全部页面已经通过审美或教学验收。用户只要求导入时保留原有设计；要求创作或重新设计时使用 `orchestrate-courseware`；已有工程的局部修订使用 `edit-content`。导出只在用户要求且当前环境提供相应能力时进行。

用户明确使用外部 Builder 时读取 [build-method.md](references/build-method.md)，该入口不作为普通导入的前置。
