---
name: orchestrate-courseware
description: 使用果铃正式工程创建和续写可编辑作品；说明内容采用、组件与 Runtime 组合、局部修改、保存和交付的已有能力与边界。创作方法、视觉和素材参考按任务需要读取，外来 HTML 导入与已有作品短修改走对应入口。
---

# 创建与续写正式作品

本入口说明果铃能力及使用边界。需要策划、视觉、素材、互动或质量判断时，按需读取[创作方法](references/creation-method.md)及其中所需参考；不先通读全部资料。已有成熟策划直接采用，工具参数以宿主当前发现结果为准。

普通构图可用整段 HTML/CSS；局部互动放同目录 iframe/srcdoc，或用 `project.apply.operations` 同批表达普通片段与程序片段。外层可执行脚本会使共同范围整体保源，普通 Next 用正式对象的 `click:{action:"scene.next"}`，不必给正文附公共脚本。按需见[实际装配入口](references/material-assembly.md)。具有共同排版关系的局部可用 `data-gl-layout="stage"` 声明软件适配，示意和限制见[局部布局](references/web-composition-examples.md)；不声明的内容仍正常采用。

写回执保提交、路径、版本和诊断，完整正文与资源留在原 owner；只有实际交付的短软件入口可有 `content/complete:true`。大查询按回执 `nextOffset` 或原来源继续，`full:true` 超本轮容量时仍会分页，不表示已看过完整文件。媒体沿成果 `source` 或同目录资源采用，无需搬音频 Base64。

模型负责内容、构图、视觉、操作反馈与所需局部程序；软件负责身份、正式目标、资源、测量装配、事务、History及保存。从第一个正式片段起沿同一工程推进，人和AI读取当前内容、数据及源码，保留人工位置和修改。新建或明确重做的自由范围可用普通HTML/CSS整体表达构图，由现工程入口测量并装配可保真独立内容，不要求逐对象手写坐标或维护身份。局部内容可随采用传入设计区域，软件把区域尺寸用于测量视口、位置交给正式frame；已有对象续改保留当前外框。共享计算、控制和排版关系的局部实验保合理整体，独立讲解和素材不被脚本吞并；复杂表达不为可抽取而降级。分素材可批量生成与装配，子任务返回的成果来源可直接采用并由软件收齐依赖；首段入工程后续改当前工程内容，不另写整课HTML反复重导覆盖。

普通修改通过当前正式目标及事务提交，保留范围外内容、人工布局和已有资源；不覆盖外部整作再重导。读取当前稿，不要求先保存来同步人工与 AI 上下文。首次生成文件沿宿主既有初次保存流程，后续落盘按用户要求与实际回执；恢复稿、GLX 保存和 HTML 导出分别说明，不能相互替代。用户要求保存重开、预览或离线交付时，沿相应真实入口验证承诺的编辑和交付能力。按需见共享[工程文件](../workbench-usage/references/project-files.md)、[运行与观察](../workbench-usage/references/observation.md)与[文件及保存](../workbench-usage/references/files-and-delivery.md)。

续作读当前有关对象及资源，内容程序优先改实际 `.content.html`／`.data.json`，复用成熟实现的更新与清理。只有需要宿主端口或改变实现时才读 `.view.*`／`.source/…`；短入口保留真实 import、`...implementation` 和原 `mount` 返回的实例，不为普通正文、样式或脚本重写完整 API5 实现。已知源文短改用已有 `project.apply.edits`，不为改一句话重抄长源码。普通短修改走 `edit-content`，已有第三方HTML保真导入走 `build-courseware-project`。完整局部机制参考见[表达范例](references/web-composition-examples.md)，用于理解操作、反馈与构图，不是所有作品必套模板。
