# 互动课件创作路由

- 教学主题、教材、教案、题目、课程标准或既有课件先交给仓库内的 [orchestrate-courseware](.agents/skills/orchestrate-courseware/SKILL.md)。它只维护教师可直接阅读和修改的 `01-teaching-plan.md` 与 `02-presentation-script.md`。默认先写中等详细的策划并确认，再写呈现脚本；不得两份一起交。教师已给出足够清楚的对应文件时才跳过该步。与教师交互优先用少量选项按钮，不要连珠开放问答。
- 两份当前 Markdown 经教师确认后，使用 [build-courseware-project](.agents/skills/build-courseware-project/SKILL.md)。Builder 从文件冷启动，按需查询 [能力索引](artifacts/ai-capabilities/index.json)，先盘点资产并拆任务，再用产品工厂与 V9 命令写入 Course Project V9（Slide / Flow / Spatial / Mixed）：高风险纵切，再增量装配、局部修复和验证。仓库没有 `agent-kit/` CLI。
- 通用 Skill 不规定课型、场景数、教学法或视觉风格。呈现脚本必须按片段选择表面（演示页 / 流式讲义 / 无限画布），并写细布局与操作。Native、Runtime 与 Component 是实现载体：稳定图文与简单点击/切场/播媒体走 Native 与声明式交互；稍复杂的局部互动（拖拽、配对等）走组件——先匹配已有包，允许新建；整页动画、特效、连续机制走场景/世界 Runtime，少放文字。
- 本产品是 AI-native 轻量课件编辑器，不是重型手工 PPT、文档、白板或 IDE；“轻量”指默认界面克制、低学习成本和渐进披露，不得删减或禁用 V8 已经可用的编辑能力。高频能力必须直接可达，低频能力可以收进高级面板或右键，但必须可发现、可保存、可撤销。
- 纯 Slide、纯 Flow、纯 Spatial 与 Mixed 的界面从现有 `locations` / `surfaces` 自动推导，不新增持久化 `projectMode` 或“四模式”字段；新建工程和课程结构必须提供三种 surface 的直接创建入口，不能只靠外部导入形成。无限画布在编辑与运行态都是可自由逛的世界，同时也支持镜头画面与路径巡游；运行态拖拽/缩放只改会话相机。与组件、Runtime、视频或教师控制器手势冲突时，被占用的交互优先。
- `globalLayerItems` 与 `surfaceLayerItems` 继续作为 V9 引擎和发布能力；全局/共享编辑范围与 Mixed 页面类型正交。在统一有效图层尚未完整支持 ownership-aware 排序、锁定、隐藏、复制和删除前，保留 V8 表面的全局与 surface 共享作者入口，不启动 V10 大迁移。
- 所有 Native、Runtime、Component 与教师控制器都进入统一图层。画布文字必须可命中，普通可替换图片应可命中；临时 `hitId` 不得代替跨保存稳定的 `authoringAddress`。
- 教师工作流不使用 Hash、签名、审批状态机、候选等级或 Evidence 清单。工程仍必须通过当前 Schema、类型、保存重开、真实 Player、导出和体验复核。P8 已合入：三种表面可挂 Component API 4。外部组件目录缺失只表示没有现成目录包，不表示不能为本课新建或导入组件。

当前产品协议是 Course Project V9、Published Course V2、Runtime API 2/3 兼容与 Component API 4。不打开、不导入 V8 `.h5lesson`；非 `schemaVersion: 9` 的工程一律视为不受支持。Course Project V9 作者工程 Schema 已**软冻结**：已有字段、判别器和语义不得改；允许 additive 可选字段（单独合同提交、保持 `.strict()`）；不承诺旧编辑器打开含新键的课。当前编辑器内没有可见 AI：无复制引用、Clipboard、Patch 应用、聊天、模型、Provider 或网络调用；`courseAiHandoff` / `courseAiPatch` 只是未挂载纯接口（internal/reserved），不得把接口预留宣称成可用工作流，也不得新增调用点。

长期开发方向只看根目录 [唯一计划](COURSEWARE_DEVELOPMENT_PLAN.md)；其第 5 节“审计收口与生产减负”已收口；当前 Ready 工作只看[任务板](docs/development-plan/TASK_BOARD.md)（2026-08-26 Owner 重新立项“编辑画布与试运行统一到同一套 Published 宿主”），其余 5.4 节剩余问题仍由 Owner 按证据定级后启动。详细执行文件统一在 [docs/development-plan/](docs/development-plan/README.md)。历史材料不再派工；默认直接读任务卡点名的源码、合同与目标测试。repo-index 只是可缺省的本地导航缓存，只有确能减少阅读量时才先显式生成并查询，不能阻断实现或覆盖源码事实。

开发执行使用精简生产模式（[工作协议](docs/development-plan/WORKING_PROTOCOL.md)）：默认路径是"确认问题 → 实现一个行为 → 最小充分验证 → product commit → 合入"，领取与关闭不产生独立提交。并发三层：调查无限并行；实现按互斥写入范围并行（隔离 worktree）；Store、App、Workspace/Properties、Published producer、合同、main/preload 与 generated index 等热点始终单写入者。完整 E2E、打包与 `verify` 只在集成/发布门运行。只有 Schema/V10、用户数据迁移、教师能力取舍、用户可见流程或导出语义变化、付费/重大依赖、安全权限、真实数据损坏风险和最终发布结论升级给产品 Owner。

任务风险只有 S0/S1/S2 一个维度：S0/S1 默认不建卡；S2、并发协调、热点写入、跨会话或交接才建最多 7 字段任务卡（状态仅 queued/active/blocked，完成即删卡）。只为前置已满足的 Ready 工作建卡，`Write scope / Baseline` 必填，不预建未来依赖卡。Reviewer 按风险触发，验证同 SHA 去重。实现任务的准入依据有五类：可复现风险、真实 consumer、可量化复杂度下降、**已完成论证的架构性偏差**（技术分析明确、影响面清楚，即使失败尚未在测试中显形）、**Owner 决定**；可复现失败只是其中一条，不是唯一硬门（2026-08-26 Owner 修订，起因见总纲第 3 节不变量 15）。"Owner 决定"须可指向当前对话的明确指令或既有权威记录，任务卡自称不算，执行者不得代 Owner 立项。五者皆无时不创建实现任务；只有阶段名称、架构理想或未来可能性时同样不能立项。

Runtime/Component 都是经过审核的可信扩展；外部导入只是分发方式，不是不可信边界。不得因为代码不内置就强制其进入 opaque-origin sandbox，也不得永久禁用其真实需要的宿主、父页面、本地或网络能力。现有 sandbox iframe 可为视觉合成、生命周期和会话竞态保留，但不是必须继承的权限安全边界；真实 consumer 需要宿主能力时，使用稳定宿主接口或同宿主执行语义接入，不建权限审批平台。远程图片、音视频、HTTP API、WebSocket 与未来 AI API 是正式能力；工程网络声明用于预览、发布、CSP 和诊断语义，不用来推导作者代码不可信。远程脚本暂不开放；长期 Provider Secret 不得写入工程、Published payload、组件包或导出 HTML。单 HTML 必须区分离线便携与在线轻量两种导出语义。

V9 合同说明在 [docs/contracts/](docs/contracts/)。当前产品事实以源码、Schema、能力卡和可复现结果为准。自动化最多证明 `engineering candidate`；`art candidate` 与 `accepted` 仍必须来自真实产品复核，但不再作为启动稳定化的技术前置。
