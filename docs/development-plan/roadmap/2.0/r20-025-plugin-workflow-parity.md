# r20-025-plugin-workflow-parity：实测原生能力与课件质量对等并关闭GUI引入的差距

- Release: 2.0
- Dependencies: `r20-020-public-authoring`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls`
- Optional: 否
- Write locks: `chat-ui`, `cli-adapters`, `workspace-shell`
- Gaps: G01, G02, G03, G04, G05, G06, G07, G08, G09, G10, G11, G12

## 结果与现状

通过已有有效外部基线与有限新增实测，核对软件中的原生CLI能力和课件成品质量没有因GUI包装下降，并关闭实际差距。Codex/Claude的真实VS Code插件比较保留，OpenCode按自身原生CLI能力比较，不把三家压成最小交集。

外部CLI/插件是开发对照，不进入教师创作路径。2.0的材料、设计、生成、检查修复和导出都须通过软件完成，不能由外部Agent先做成品或追加检查补齐内部流程。官方文档/协议可行性和按钮相似不能代替真实能力与质量结果。

## 开始前与阅读入口

核对[产品方案第3/8节](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)、[开发计划第6节](../../AI_ASSISTANT_DELIVERY_PLAN.md)、[对标评估T01–T12](../../AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md)、[工作协议](../../WORKING_PROTOCOL.md)与[共同实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)。088/103/1.9和020–022未失效的实际证据先复用。

- [adapter.ts](../../../../src/main/localAgent/adapter.ts)、[process.ts](../../../../src/main/localAgent/process.ts)、[profile.ts](../../../../src/main/localAgent/profile.ts)：有效配置、工作目录/环境与产品Skill组合。
- [codexAppServer.ts](../../../../src/main/localAgent/codexAppServer.ts)、[claudeProcessTransport.ts](../../../../src/main/localAgent/claudeProcessTransport.ts)、[openCodeAcp.ts](../../../../src/main/localAgent/openCodeAcp.ts)：原生能力与授权/工具/子任务事件。
- [harness.ts](../../../../src/main/localAgent/harness.ts)、[CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)：GUI请求/回答、连续任务与真实结果。
- [generationSnapshot.ts](../../../../src/renderer/authoring/generation/generationSnapshot.ts)、[courseAgentSkills.ts](../../../../src/shared/courseAgentSkills.ts)：当前工程观察与实际加载方法。

## 允许写域与旧路径退出

有限对照驱动、实际证据及Chat/adapter/workspace内已定位缺口修复；材料、Skill内容、事务/宿主缺陷回020–022或相应Owner取得锁。不建立评分平台、不增加全量重复矩阵、不修改样本或成功标准消除失败。

## 执行步骤

1. 冻结可比CLI/插件版本、模型/强度、有效配置、材料/目标、工作上下文与预算。先列哪些既有外部结果仍有效，仅对配置/能力/工作流变化补真实对照；没有可比历史证据时取得有限新样本，不能假定同模型自然等质。
2. 分开核对能力与成品质量。能力检查实际文件/终端/网络、用户已有工具连接、原生Skills/子任务、问题与授权允许/拒绝/取消、纠正/停止及原生上下文恢复；GUI保留其有效授权，不默默提权。空配置数组或本地对象字段不能证明真实原生能力。
3. 质量检查使用020的代表性Native、动态机制或整课课例，核对材料准确、知识获得路径、教学推进、视觉/图示可读、实际互动、可编辑、保存重开及导出。查明内置是否因少给材料、方法、工具或修正机会而变差；不要求随机模型产物逐字/逐像素一致。
4. Codex与Claude实际对应插件的适用工作流保留双方结果；OpenCode使用其原生CLI。GUI不必复制IDE专有Git/worktree/云面板，但不能据此裁剪CLI已配置的工具或MCP连接。当前工程观察的结构/画面/运行优势须有实际输入和结果，不能仅靠文档宣称。
5. 记录双方真实步骤、有效配置、结果、失败与阶段耗时，将宿主开销和模型/网络耗时分开。外部操作只用于开发对照；内部课例完全从软件入口开始并在软件内检查、修复、交付。
6. 差距按当前可用性与实际成品影响排序，回原Owner修复后只复核受影响项。不能平均总分掩盖核心失败，也不能换模型、加外部人工补救或删除失败样本冒充对等。

## 验收与可信反例

- 适用于课件的既定基线有真实可比证据，GUI不产生原生能力/控制缺口；同等条件下没有因内置工作流造成的系统性成品质量下降。
- 020内部全流程独立完成，外部Agent不是教师的生成、检查或修复前置。三家供应商本身的差异和未提供能力准确显示。
- 仅比按钮/提示长度、只引用官方资料、拿其他产品代替指定插件、未确认实际配置、外部AI预制成品、平均分遮盖失败，均不能称对等达标。

## 停止条件

缺少真实插件或可比配置时明确未完成的对照，其他内部功能继续验证；不能把无证据写成通过。有限对照已足以定位或证明结果时停止，未经相关变化不继续重复付费调用。

## 聚焦验证

准备与证据复用统一遵循[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)。相关产物准备一次后，按发生差异的adapter直接选择目标测试，UI路由变化再补命名E2E；测试模拟不替代真实原生行为和课例质量。下列明确列出当前聊天/源码的三CLI用例组，仅在该组受影响或缺证据时运行；其他主题按实际名称选择，禁止无选择地整文件执行。新增用例先随实现创建，再列入FILE与--grep，零匹配不得通过。

```text
npx --no-install vitest run tests/unit/codexAppServer.test.ts tests/unit/claudeProcessTransport.test.ts tests/unit/openCodeAcp.test.ts tests/unit/coursewareSkillsContract.test.ts
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep "S3 (真实聊天：(codex|claude|opencode) 生成候选、继续修改、单次撤销与保存|真实组件源码：(codex|claude|opencode) 读取既有包并连续修订)$"
```

实际Codex/Claude插件与本产品的适用比较保留为开发门，未变项复用已有证据；OpenCode实际差异按其原生支持记录。上述命名自动化不替代既定T01–T12、真实插件比较与课例质量范围；只有受影响项按原成功标准补证，不给每项新功能重建三CLI完整矩阵。040直接消费这里未失效的结果，不因进入最终门重复付费对照。

## 回退与交接

交付有效外部基线、内部独立完成证据、配置差异和已关闭/未关闭缺口，供030/040/S4使用。不得把开发对照步骤写进教师日常操作说明。
