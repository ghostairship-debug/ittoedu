# 果铃工作台｜2.0 实施方案与长期路线

**当前修订：v2.1 · Runtime/HTML/Flow 追加收口 2026-09-25；先读[根目录收敛方案](../../果铃2.0收敛方案.md)。** 本包已同步当前决定；原 1.x 路线不限制重构。产品实现已按本包推进，当前工程状态以 [证据状态](evidence/STATUS.md) 的生成统计、`task_registry.json` 和 `acceptance_cases.json` 为准；工程 `verified`/`passed` 不等于 Owner 终局范围审计通过或正式发布。

**2026-09-23 后续扩展边界补充：** 保留自建 harness 主架构，明确文档/非文档能力、分类型成果提交和可选薄 runner；正在开发的部分暂时不动，不新增当前任务、依赖、验收门或发布前置。详见 [L03 后续路线](long_term/L03.md)及[可转发交接词](delivery/AGENT_HANDOFF.md)。既有循环、MCP、受控构建和图片交付仍按原范围完成。

**2026-09-24 分发阶段调整：** 当前先完成产品能力。安装包/便携版、干净 Windows 首次使用、重装卸载及分发资产/许可延期至后续发行准备；M12-T01/T04、REL-T08 保留 `not_run`，不构成当前 2.0 开发完成门或依赖阻塞。可运行产品构建中的连接、受控构建、导入、导出、保存重开、真实用户路径与模型能力验收继续执行；正式发行仍需另验延期项目并由 Owner 签收。

**2026-09-25 2.0追加收口：** 当前旧范围工程验收完成并冻结 baseline 后，新增 M15–M19 五项 2.0 必做任务：Runtime/Component 图文轻编辑与自动发现、Flow 混合画布、HTML 整体 Runtime 高保真机械导入、Slide 有限画布参数化，以及教学设计之后的 Representation Planning。M14-T05 是 Owner 必需的终局范围审计，保持 `not_run` 并排在 M15–M19 完成后，不作为旧 baseline 或 M15 开工前置。M12/M14 工程任务 `verified` 不代表 M14-T05 已通过，也不等于 Owner 终局接受。原有通过证据不回退；新增验收从 not_run 开始。最终 G-2.0 以后述新增批次完成及其后 Owner 终局审计为准。

**2026-09-23 工作台交互收敛：** 左侧资源管理器/会话常驻、中间大画布及底部场景与状态、右侧 AI；工作台补齐基础元素插入与就地属性编辑，保留原有快捷工具条内 AI 修改。专业编辑器只调整右侧工具的按需展开，独立窗口仍待定。见[交互细则与参考图](mid_term/WORKBENCH_EDITOR_LAYOUT.md)和[本轮交接词](delivery/UI_HANDOFF_2026_09_23.md)。本轮只改方案；相关 UI 按当前 M 任务集成，原有测试状态不自动覆盖新布局。

## 产品主线

用户输入与材料 → 自建统一执行器 → 同源文档/构建/图片工具 → 可编辑成果 → 人工接手、停止、撤销、保存重开。教育是首发场景，空间、文件、会话是一级对象。

API 和 Token Plan 等允许的套餐是主要使用方式；OAuth 可选。低成本文本与独立多模态模型可以组合。高能力 GPT 作为开发质量对照不改变用户模型自由。外部 AI/CLI 经统一 MCP 调用果铃，不深度嵌入三套 Agent。

首轮提供 GPT OAuth，开发使用 Owner 当前账号正式登录，前期图片生成使用该连接；独立图片 API 供应商与账号待定。DeepSeek 开发主路由为 TeamoRouter、官方 API 为备用。用户仍可不启用 OAuth 使用 API 文本/编辑主链，实际连接能力按 S05/S14/P5 验证。

## 阅读与维护

- [范围](01_SCOPE.md)、[架构](02_ARCHITECTURE.md)、[能力矩阵](04_CAPABILITIES.md)
- [任务索引](03_TASK_INDEX.md)、[依赖批次](delivery/SEQUENCE.md)、[代码职责地图](delivery/REFACTOR_MAP.md)
- [验收总表](delivery/ACCEPTANCE.md)、[测试方法](delivery/TESTING.md)、[发布门](delivery/RELEASE.md)
- [交接规则](delivery/AGENT_HANDOFF.md)、[合同样例](contracts/README.md)、[证据状态](evidence/STATUS.md)
- [长期方向](long_term/L01.md)、[自有执行器演进](long_term/L03.md)

任务依赖与批次维护在 task_registry.json；验收定义维护在 acceptance_cases.json；需求覆盖维护在 requirements_traceability.json。运行 `python tools/refresh_plan.py` 同步派生任务验收段、索引、总表、阅读器和 manifest，再运行 `python tools/validate_plan.py`。生成工具使用 Python Markdown，版本/安装方法见工具说明。

校验器回归自检运行 `python tools/selfcheck_plan.py`：只在临时副本验证正常基线和三类反例，不写仓库文件。更新 PACKAGE_QA.json 中的实际输出后，再 refresh/validate，使证据与 manifest 一致。任务页非生成叙述、总方案、入口与证据分别按其职责维护，不能手改派生验收和批次表。

打开 index.html 可离线搜索全部 Markdown，根目录收敛稿也嵌入阅读器。合同 TypeScript 仅为可检查的设计样例，不能导入产品后宣称实现。任何文档检查都不是产品测试。
