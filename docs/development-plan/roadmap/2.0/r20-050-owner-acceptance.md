# r20-050-owner-acceptance：Owner 验收 S4 AI 产品并签署 v2.0.0 accepted 候选

- Release: 2.0
- Dependencies: `r20-030-docs-accessibility`, `r20-040-three-cli-acceptance`, `r20-041-pptx-production-acceptance`
- Optional: 否
- Write locks: `none`

## 结果与现状

Owner在同一候选完成S4生产AI、插件工作流及PPTX复核，签署v2.0.0 accepted并冻结固定课例HTML身份。

自动化最多建立engineering candidate；2.0必须有教师看过真实结果后的明确签署，不能由代理/文档代签。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [docs/development-plan/AI_ASSISTANT_DELIVERY_PLAN.md](../../AI_ASSISTANT_DELIVERY_PLAN.md)
- [docs/development-plan/WORKING_PROTOCOL.md](../../WORKING_PROTOCOL.md)
- [docs/development-plan/roadmap/PRESERVATION_MATRIX.md](../PRESERVATION_MATRIX.md)
- [docs/development-plan/ARCHITECTURE_CONTRACT.md](../../ARCHITECTURE_CONTRACT.md)

## 允许写域与旧路径退出

S4逐步验收清单、签署/制品记录与已验收行为保全矩阵/Owner ledger；无产品源码写锁。

## 执行步骤

1. 汇合030/040/041与025有效证据，形成教师可操作的“步骤+预期+通过/不通过”，覆盖完整1.9–2.0新增范围。
2. Owner在当前真实课例复核三CLI、模型/模式、实时观察/图片/Runtime、纠正/历史/长任务、三表面、保存重开/Player/导出与人工回退。
3. 从同一候选准备examples/render-host-benchmark/render-host-benchmark-v2.html，Owner断网打开真实检查，记录制品身份后不再生成。
4. 明确签署后晋升已验收行为与维护边界；任何修复使相关签署/制品失效时重新复核受影响部分。

## 验收与可信反例

- Owner对当前候选明确S4签署；完整AI与PPTX支持范围成立，固定HTML真实断网运行且身份冻结。
- 反例：仅green CI/代理评审、未实测插件却称达标、签旧制品、HTML重生成后沿用签署都不通过。

## 停止条件

任一核心失败或缺少Owner明确签署不得accepted；先给具体可复核结果和剩余项，不用预授权替代审阅。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run verify
```

Owner实际执行S4清单并打开被冻结HTML；verify中的生成必须在冻结前完成，签署后不得再跑会重生成HTML的流程。

## 回退与交接

交付S4签署、候选/固定HTML identity、有效证据和发布授权状态；060只发布同一制品。
