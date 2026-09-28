---
name: build-courseware-project
description: 从教学策划和整课框架 HTML 做后置表示规划，按页导入组装、视觉精修并交付可编辑 Course Project V9；支持默认两次确认与明确的自动创作模式。
---

# 构建互动课件工程

读取课例目录中的 `01-teaching-plan.md`、`02-course-frame.html`、一页 `02-presentation-script.md`、原始材料和本轮约束。默认模式要求教师已看过并分别确认教学策划与框架 HTML；用户明确要求“根据材料自动创作”时跳过确认与提问，中间文件仍须写出并继续到保存好的成品。以这些当前文件为体验真相，以正式能力为工程真相。用户明确要求按材料实现时不得省略、简化或换成静态图；做不到时，默认模式先用弹窗询问，自动模式交付时逐条说明原因。

## 1. 后置表示规划

框架 HTML 确认前不读编辑器能力、能力卡、Schema 或课件工具族，也不生成素材。到这一步才读取一次 [representation-capabilities.md](references/representation-capabilities.md)（不超过 1,500 字符），逐个顶层 `<section>` 写 `03-representation-plan.md`：页序与教学作用、固定画布 / 流式长页 / 镜头编排、演示页 / 流式讲义 / 无限画布，以及原生 / 素材 / 互动页表示和必要的 Runtime 引擎。简单独立且常改的内容可原生，纯视觉为素材，复杂联动区域优先互动页。这是一次可执行的薄规划，不增加评分 Agent、多轮技术审查或新的教师确认门。

## 2. 导入与组装

规划后才按需定位产品、查询正式工具卡。调用当前产品的 `html.import` 按 `<section>` 机械拆页，一页进入一个位置，不把整课挤进一个场景，也不让模型照 HTML 重写整件作品。固定画布页进 Slide；自然排版长页进 Flow，不适合自然排版时用原生对象重建；镜头编排用 Spatial 原生区域与镜头重建，复杂区域放互动页。按无 `src` 占位描述生成或放入素材，补必要原生对象；图片按显示区域与比例准备，通常长边 512–1024 像素、小插图争取 100–300 KB，文字或细节图保留必要原分辨率。未获授权时不启用新收费图片路径；音频没有用户提供素材或已授权能力时保留占位并说明。

课例目录可以是任意普通目录。外部案例需要时运行 `node <skill目录>/scripts/resolve-editor-root.mjs` 定位产品，按 [external-case-build.md](references/external-case-build.md) 使用 `build:courseware-case` 与 Builder V2；不得要求教师切换仓库或从课例模块静态导入编辑器内部路径。仓库没有 `agent-kit/` CLI。Builder V2 使用 `api.discover()` / `api.readCapability()` 按需读完整卡，用 `api.createCourseProject()` 开会话，`observe()`、`createScope()`、`activateScope()`、`execute()` 提交，逐步核对 receipt，按需 `readReceipts()`，最后原样 `return await session.finish()`。不直接改工程文件、拼装返回值或凭旧字段猜 Schema。修改已有工程走稳定目标与正式事务，不用空白工厂全量重建覆盖。

## 3. 视觉精修与交付

组装后逐页看真实画面，包括非当前页；修排版、字号、对齐、溢出与配色。会话模型不能看图时用设置里的视觉模型；两者都不可用则写明缺口，不能声称视觉精修通过。原生对象用正式编辑工具修改；互动页改源码后重新过编译、协议、依赖与真实宿主准入。保存、重开，核对真实互动与适用导出，然后交付项目、假设和未做到的要求。自动化最多证明 `engineering candidate`；教师验收才是 `accepted`。

按需阅读 [build-method.md](references/build-method.md) 的载体所有权、资产与任务图、最高风险纵切、增量构建、可编辑性与验证方法；推进遵守 [main-progression.md](references/main-progression.md)，先证明控制器隐藏时的正文主路径，再查控制器兜底；布局看 [page-design.md](references/page-design.md)，PPT 来源看 [ppt-import-review.md](references/ppt-import-review.md)，最终检查看 [validation-boundaries.md](references/validation-boundaries.md)。稳定图文与简单点击走 Native；局部复杂互动先匹配或新建 Component；整页连续机制才用 Runtime。Flow 保留语义正文，Spatial 保留世界和镜头。Runtime/Component 中的普通图文由宿主自动发现，AI 不登记文案表、图片编号或编辑目标。

缺关键教学内容或必须改变已确认体验时，默认模式返回 `$orchestrate-courseware`；自动模式保留可完成部分并在交付时列出精确缺口。技术参数不让教师猜。工具回执、保存重开和真实画面分别核对，不能把候选成功当作完整教师验收。
