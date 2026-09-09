# r20-050-owner-acceptance：Owner验收S4内部全流程并签署v2.0.0 accepted

- Release: 2.0
- Dependencies: `r20-020-public-authoring`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls`, `r20-025-plugin-workflow-parity`, `r20-030-docs-accessibility`, `r20-040-three-cli-acceptance`, `r20-041-pptx-production-acceptance`
- Optional: 否
- Write locks: `none`

## 结果与现状

Owner在同一候选实际复核软件内部完整课件创作、三CLI能力与成品质量、标准任务速度和PPTX，明确签署S4后形成v2.0.0 accepted；固定课例离线HTML与源码身份保持一致。

自动化最多engineering candidate。签署必须来自教师看过当前实际结果之后，不能由代理评审、预授权或文档代签；本版是内部生产交付，不表示向不受信公众发行。

## 开始前与阅读入口

核对[产品方案](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)、[开发计划第6节](../../AI_ASSISTANT_DELIVERY_PLAN.md)、[工作协议](../../WORKING_PROTOCOL.md)、[架构合同](../../ARCHITECTURE_CONTRACT.md)、[共同实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)和[保全矩阵](../PRESERVATION_MATRIX.md)。

- [020内部全流程](r20-020-public-authoring.md)、[021实际内置Skill](r20-021-profile-controls.md)、[022材料支持](r20-022-materials-privacy-controls.md)：教师实际操作范围。
- [025有限开发对照](r20-025-plugin-workflow-parity.md)、[040三CLI证据](r20-040-three-cli-acceptance.md)、[041 PPTX验收](r20-041-pptx-production-acceptance.md)：有效支持、质量/速度和独立人工能力。
- [CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)、[useCourseProjectLifecycle.ts](../../../../src/renderer/app/useCourseProjectLifecycle.ts)：当前入口与真实保存生命周期，用于将清单对应到候选实现。

## 允许写域与旧路径退出

教师可执行的S4步骤、签署/制品记录及已验收行为保全矩阵/Owner ledger；无产品源码写锁。发现问题回正式Owner修复，不能在验收现场绕过软件流程补成品。

## 执行步骤

1. 显式汇合020/021/022/025/030/040及041仍有效的最终证据，形成简短“动作→预期→实际/待确认”的清单，覆盖完整1.9–2.0新增范围和原S3/PPTX/三表面保全。030可随稳定界面提前开发，但必须已消费最终界面与025结论，不能靠早期部分完成解除本门；不要求Owner重复实施者全部技术矩阵。
2. Owner从软件聊天首页复核自动材料流程与手动详细流程：材料成功读取和出处、教学/呈现阶段、首个完整成果后显示画布、已有工程打开、连续生成与局部/整课修改、实际检查修复和交付。整个教师路径不依赖外部AI窗口、终端、手工Builder或另一Agent补检查。
3. 在极简/专业、主聊天/对象局部AI之间操作，复核原生工具/授权控制与模型/模式、当前结构/画面/运行观察、三CLI持续任务、停止/首存/恢复/删除及人工交替。原生CLI安装/登录可用软件设置辅助，不把“内部完成”解释为离线本地推理。
4. 查看真实课例的材料准确、知识获得路径、教学节奏、视觉可读与一致性、实际互动、可继续编辑、保存重开、Player/适用导出结果，以及025的有效能力/质量对照。PPTX人工导入/修改/导出独立复核，不能由AI成功替代。
5. 将020/040冻结标准任务的实际速度、质量和失败/限制交给Owner判断；首成果时间与整课完成、模型/网络与宿主耗时、手动等待分别呈现。未达目标或需范围取舍必须明确，不能把未测试目标或删除慢样本后的统计当通过。
6. 固定课例examples/render-host-benchmark/render-host-benchmark-v2.html在同一候选构建/检查阶段生成；Owner真实断网打开，核验内容、互动与来源后记录制品身份。冻结后不再次生成不同HTML沿用签署。
7. Owner明确签署后才晋升已验收行为/维护边界并创建accepted标签；修复改变相应实现或制品时仅重核受影响签署范围。060只发布同一源码与冻结HTML，不重新生成另一套交付物。

## 验收与可信反例

- 当前候选内部全流程、真实三CLI范围、标准任务速度/质量结论和PPTX成立，Owner明确S4签署；固定HTML断网运行并与源码身份冻结。
- 仅green CI/代理评审、缺真实对等证据、教师还需外部补步骤、未达目标却称达标、签旧产物或签后重生成HTML，均不构成accepted。
- 真实视觉/互动和教师判断决定art candidate/accepted；自动化不能自动晋升。

## 停止条件

任一当前核心失败、必要支持/质量证据缺失或没有Owner明确签署，不得accepted。交付具体可审阅结果与未完项，由实际Owner修复或裁决范围；不以事前授权替代当前审阅。

## 聚焦验证

本节点属于集成/签署门，保留既定完整release检查。[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)规定局部准备与证据复用，不削减本门。当前候选已有有效完整验证时直接引用；只有相关实现/依赖/关键环境变化才补受影响检查，所有会生成固定HTML的动作必须在冻结前完成。

```text
npm run verify
```

Owner实际在软件执行S4清单并断网打开冻结HTML。verify只提供工程证据，外部对照由025开发阶段完成，不能要求教师去外部再生成或复核一轮。

## 回退与交接

交付S4明确签署、候选/固定HTML身份、真实支持与速度质量结果及发布授权状态。未签署保持候选，060只能发布同一已签署制品，不绕过PPTX或改变发布列车。
