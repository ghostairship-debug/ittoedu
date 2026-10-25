# Runtime-first 资产短索引 · v1.0（2026-10-25）

先按需求选择条目，再读相应详细资料。无需读取整份咖啡工程。所有条目可拒绝、修改或自由组合；不要求固定章节数、素材数量、主题色或模板。

| 名称 / 关键词 | 能力与适用 | 预览 / 深读 | 成本、前提、状态 |
|---|---|---|---|
| 连续阶段背景 · 事件绘制；Runtime、色彩连续、可逆进度 | 手动/Flow/共享数值驱动任意数量颜色关键点 | [契约与真实采用](assets/continuous-background/README.md)；[源码](assets/continuous-background/view.js) | 约3.5KB源码，零主题素材；需要明确背景归属。正式库保存/检索/跨工程插入与联动已验；完整新主题待验 |
| 连续变量联动；滑杆、线性变量 | 软件既有continuous-variable-v1配方，线性值与图形反馈 | asset.search query“连续变量联动”；读取真实slots | 现有surface.recipe，一次正式装配；须用listChildren取得页面句柄，不能用整文档句柄。复杂非线性实验自行创作 |
| Runtime核心函数；事件绘制、关键点采样 | createInvalidator、prepareStops/sampleColor、phaseFromStops，可直接融入自创API5程序 | [runtime-core.js](assets/continuous-background/runtime-core.js) | 零依赖，小模块；非宿主新接口；progress/几何来源由作品决定 |
| Runtime-first职责与艺术方法 | 原生/Runtime边界、阅读与主体节奏、色彩归属、响应式和实验设计 | [方法](METHOD.md) | 参考，不是强制模板；静态图文/空间作品可选其他组织 |
| 咖啡最终案例 | 统一主体材质、47原生文字、三个局部实验及完整真实验用 | [冻结案例](../design/v08-runtime-first/final-20261025/README.md) | reference。14项咖啡素材、七章和完整场景源码为主题专属，不默认复制 |

正式组件 packageId：`library_e6a82cca-55c4-48ef-a4b5-d5a845a17afb`，version 1.0.0。检索入口是现有asset.search；详细文件用file.read按路径读取。本索引属于外置等价方法资料，未另建Skill执行器或组件/文件/保存系统。方法通过本索引或file.search/file.grep发现，软件已有skills.list/read继续用于内置及已安装方法。

实际采用后写入FEEDBACK.md：使用/修改/拒绝的资产、原因、起止时间、失败重试、质量/编辑性/保存导出与证据。状态区分reference、candidate、usable、recommended；跨不同主题或结构的真实采用证明价值后才推荐。单次成功不推断通用性能。
