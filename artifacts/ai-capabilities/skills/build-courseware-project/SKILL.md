---
name: build-courseware-project
description: 将已有第三方或外来 HTML 保真导入可编辑课件；适用于 HTML 转课件，不承担新课创作与已有工程续改。
---

# 从 HTML 交付课件

取得用户指定的已有外来 HTML，保留其内容、样式、资源和互动。直接导入无需重新策划、改写正文或先套模板。新课创作从框架起写入工程内文件，不经过本入口。

调用任务入口 `course.createFromHtml`：

```json
{"sourcePath":"D:/课例/lesson.html","name":"斜抛运动","path":"D:/课例/斜抛运动.h5lesson"}
```

只有 `sourcePath` 必填；`name` 是作品名称，`path` 是用户指定时提供的新工程保存位置。宿主负责建立工程、解析内容、分配身份、绑定资源、选择组合或程序载体、导入和保存。以本次任务结果返回的实际保存路径与状态交付，不再拆成创建文档、寻找内部句柄、导入、保存等模型回合。

普通 HTML/CSS 可以直接输入。可识别的静态内容进入可编辑 Web 组合；需要整体执行的脚本与事件保留为 Runtime。不能把所有程序内部元素宣称为原生对象。局部组件问题按宿主诊断修复，保留原件与其他可用内容，不删除互动逻辑、不截图静态化、不叠加第二套按钮换取成功。

HTML 页面的普通结构、拆页适用条件及共享逻辑边界见 [HTML 输入与分页](references/html-draft-contract.md)；只有需要解释编辑能力差异时再读[承载方式](references/representation-capabilities.md)。不要求第三方源文件添加页编号、可编辑登记表或私有标记，不默认读取完整工程 Schema。

交付回执确认的 `.h5lesson` 路径、已保留的内容与具体诊断。缺资源、局部脚本错误按宿主结果说明占位或组件草稿，不丢弃其他可用页面。创建返回成功并不代表审美或教学验收。导入后续改用 `edit-content` 修改工程，不改外部源 HTML 后整份重导入。导出只在用户要求时进行。

用户明确使用外部 Builder 时读取 [build-method.md](references/build-method.md)，该入口不作为普通导入的前置。
