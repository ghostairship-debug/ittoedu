# r20-020-public-authoring：完成软件内部整课创作闭环与速度质量优化

- Release: 2.0
- Dependencies: `r20-010-cli-setup-ui`, `r20-011-first-use-risk-notice`, `r18-046-stop-undo-stale`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls`
- Optional: 否
- Write locks: `chat-ui`, `store-kernel`, `ai-session`

## 结果与现状

材料处理、教学设计、呈现脚本、生成、局部/整课修改、真实检查修复、保存与导出全部通过软件完成。自动与手动流程、三表面、极简/专业及主聊天/局部AI共享原生CLI和编辑器能力，并在标准课例上取得速度与成品质量证据。

1.8提供可靠编辑反馈，1.9完成工作台、身份与两种流程，021/022提供实际内置方法与材料能力。本节点关闭完整生产路径和主要耗时瓶颈，不能只复测聊天壳，也不能要求外部AI/终端/另一套Builder手工补步骤。

## 开始前与阅读入口

按[产品方案第4–8节](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)、[开发计划第5–6节](../../AI_ASSISTANT_DELIVERY_PLAN.md)、[架构合同](../../ARCHITECTURE_CONTRACT.md)、[工作协议](../../WORKING_PROTOCOL.md)及[共同实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)核对已完成输入和真实写锁。

- [CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)、[App.tsx](../../../../src/renderer/App.tsx)：现有工作台和真实动作接线。
- [generationSnapshot.ts](../../../../src/renderer/authoring/generation/generationSnapshot.ts)、[prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)：当前观察、候选和唯一提交。
- [authoringToolFacade.ts](../../../../src/renderer/authoring/tools/authoringToolFacade.ts)、[coursewareBuilderV2.ts](../../../../src/renderer/course/coursewareBuilderV2.ts)：正式命令、构造与窄读取。
- [harness.ts](../../../../src/main/localAgent/harness.ts)、[profile.ts](../../../../src/main/localAgent/profile.ts)：原生任务续接和按需Skill。
- [useCourseProjectLifecycle.ts](../../../../src/renderer/app/useCourseProjectLifecycle.ts)、[buildCoursePackages.ts](../../../../src/renderer/export/course/buildCoursePackages.ts)：保存/重开和真实交付consumer。

## 允许写域与旧路径退出

Chat/Generation生产流程、现有构造/事务消费和阶段诊断；各Surface、材料或动态宿主缺陷回对应Owner取得锁后修。移除需要教师外部手工补做的正式流程缺口，不新增2.0专用writer、私有History、第二模型循环或性能平台。

## 执行步骤

1. 使用既有真实课程冻结标准任务的材料、规模、输出、模型/强度/有效配置、首次与连续会话和完成口径。包含常见Native局部修改/小单元、代表性Component/Runtime和标准自动整课；不能看到结果后删慢样本或缩小任务追求达标。
2. 从软件上传材料，自动流程以原件有效、整体结构已取得、当前教学范围所需内容已实际读取为开始构建条件，理解整体后优先选适配模板/设计/组件。其余未读页/图片保留缺口，只在影响当前教学目标时阻断；不为无关附录等待全量提取，不另建“全材料已理解”状态。手动流程在软件内详细补全并确认四个当前阶段。生成、查看/改稿、关键提问、停止和继续均可在当前工作台操作，不要求教师安装外部课件Skill。
3. 按完整页面或自洽互动单元产生阶段成果，先验证最高风险片段，再扩展整课。Native、Recipe、已有组件参数使用各自正式快速路径；需要深层机制才读相关源码并走Generated准入，不能强行用大量Native模拟不合适机制。
4. 保留原生CLI实际文件/终端/网络/用户Skills和工具能力及GUI授权往返；默认小上下文不限制按需取更多材料。修改工程仍经正式事务，原生工具成功、候选通过和画布提交分别显示。
5. 从当前结构、实际画面和公开运行结果进行全课QA，查材料准确、知识获得路径、教学推进、文字容量/图示对应、可读性、关键互动/恢复和编辑性；反馈送回同一任务修相关范围，不能靠模型自评或静态准入替代实际效果。
6. 同一课程继续改文字/图片/参数和一次明确共享源码行为，保留教师人工修改、稳定身份和资源；验证实例生命周期、返回/重播、课程状态和既有事件联动。切simple/professional或局部/主聊天不能降级AI能力或复制工程。
7. 沿043/050时间记录定位实际瓶颈，优先减少无关全量输入、重复源码/receipt、无效发现和不受影响的重检。整课计时从原件上传完成且用户启动任务开始，原件解析、必要图像理解、设计、构建、运行检查和修复全部计入，不能等“材料已读”后另起计时；已有有效提取结果复用时明确记录。终点为可用可编辑且必要检查结束。手动教师等待单列，首个画布成果时间另记。
8. 在冻结任务上以Native秒级、代表动态分钟级、标准整课30分钟以内为待验目标，报告实际阶段/总耗时、输入量、往返、返工和失败；小样本不伪造p95，CLI未提供usage字段标未知。未达目标先修直接瓶颈，涉及规模/质量取舍再由Owner决定，不能跳过视觉/互动验证。
9. 在软件内完成保存、关闭重开、Player、离线HTML和课例需要的其他格式导出；失败指出已提交阶段与未完目标，CLI不可用时人工编辑/保存仍有效。外部对照仅归025开发验证，不能作为本流程的生成、检查或修复步骤。

## 验收与可信反例

- 两流程及三表面实际课例含Native/Component/Runtime，材料→设计/脚本→生成→修改→真实QA修复→保存重开/运行/导出全部在软件内完成，教师不需外部AI或手工Builder补步。
- 同等CLI/模型/配置与可达方法下，没有因GUI包装、少读材料/Skill或少给修正机会造成系统性能力/质量下降；实际可编辑产物满足教学和视觉/互动要求。
- 标准任务有可复查速度与质量结果，未达项明确；不以仅首响、第一张预览、静态截图、减少内容、换模型不披露或丢弃失败来宣称达标。
- 当前教学范围材料未读、手动跳阶段、无实际检查、重建覆盖人工内容、失败吞前序成果、隐藏专业AI或将Flow/Spatial强转Slide均不能通过；无关未读页不阻断已具备依据的教学范围，不能以全材料“已理解”布尔值替代实际读取事实。

## 停止条件

当前支持场景中的流程/结果错误回实际Owner修复；超支持carrier/格式明确边界，不以截图后备称可编辑。外部Agent帮忙完成不能解除2.0内部流程阻断；时间目标需要范围取舍时保留原始证据交Owner决定。

## 聚焦验证

准备与证据复用统一遵循[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)。相关产物准备一次后，先直接选择实际改变的构造/事务与跨表面历史，再在真实应用完成标准任务；未变的021/022/1.9证据直接复用。下列E2E只选择现有确认稿整课链作为受影响基线，不代表新自动流程、计时或完整2.0支持已验收；新增命名用例先随实现创建，再列入FILE与--grep，零匹配不得通过，不整文件运行付费矩阵。

```text
npx --no-install vitest run tests/unit/coursewareCaseBuilder.test.ts tests/unit/editorTransaction.test.ts tests/integration/architectureBaselineFlows.test.tsx tests/integration/mixedCrossSurfaceHistory.test.tsx
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep "S3 真实整课：Codex 从确认文档生成、重开与离线逐页运行$"
```

真实内部课例必须覆盖材料、两流程、持续修改和实际效果检查；保留原始时间与失败。先使用主力CLI完成代表纵切，其余三CLI受影响差异由040汇合，不把每次优化都扩成全矩阵。

## 回退与交接

交付内部全流程课例、速度分解、实际质量与失败恢复证据，025用于有限开发对照，040汇合最终范围，050由教师签署。保留PPTX人工线、三表面和既有导出；不发布另一套产物冒充同一候选。
