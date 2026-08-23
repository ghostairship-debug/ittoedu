# 查询、Context Pack 与质量门禁

## 1. 优先确定性查询

以下命令是 ARCH-0B 的目标接口；在 package scripts 真正落地并通过门禁前，使用 Bootstrap，不得把示例当成当前可用命令：

```bash
npm run repo:context -- --feature components
npm run repo:context -- --symbol buildPublishedCourseV2Payload
npm run repo:context -- --path src/renderer/App.tsx
npm run repo:context -- --changed
npm run repo:context -- --query "Flow 图片替换保存重开"
```

优先级：feature/symbol/path/changed > 自由文本。

## 2. 自由文本策略

自由文本仅做：

- Feature alias；
- 符号/路径子串；
- 测试名称；
- 少量旧术语映射。

输出必须带：

- confidence；
- 命中的候选 Feature；
- 未确定点；
- 是否建议手工 Bootstrap。

没有高置信结果时不输出伪确定的单一路径，也不得自动派发修改任务。输出候选、缺失证据和 `bootstrap-required`，由自动执行器转入手工 Bootstrap；补足证据后再生成任务卡。

## 3. Context Pack 结构

```markdown
# Task Context

## Freshness / Dirty Inputs
## Matched Feature and Confidence
## Current Status
## Canonical Contract and Carrier
## Start Here
## Write Path
## Runtime / Preview / Export Consumers
## Related Tests
## Current Must Preserve
## Transitional Legacy
## Do Not Read Unless Needed
## Suggested Minimal Validation
## Unknowns
```

## 4. 读取预算

使用字节和行数，不假装精确 token：

- small：12–20 KB；
- medium：30–50 KB；
- large：70–100 KB。

Context Pack 不复制完整源码，仅提供短摘要、路径、符号、少量片段和读取顺序。

## 5. 黄金任务

ARCH-0B 首批至少 15 个真实历史任务，用于证明生成、确定性查询和低置信降级基本可用，覆盖：

- Slide、Flow、Spatial；
- 组件包与实例；
- 媒体保存重开；
- Runtime/Interaction；
- Try-run/Preview；
- PPTX/PDF/HTML；
- main/preload/IPC；
- 三个 tsconfig 与共享文件去重；
- 诊断；
- 现有 DeveloperTab 稳定接线。

15 个任务通过后，只允许受控试运行和少量低风险卡。扩展到至少 25 个、覆盖全部主要模块并达到下列门槛后，才允许广泛多智能体派工或让 S2 迁移默认依赖 Context Pack。

## 6. 质量门槛

- canonical file Hit@5 ≥ 90%；
- 必需合同/高信号测试 Recall@15 ≥ 85%；
- P95 查询 < 2 秒；
- 全量生成 < 10 秒；
- 同输入逐字节一致；
- 无高置信结果时正确降级；
- 外部 Catalog 查询不声称覆盖外仓源码。
- 25 个黄金任务门禁未通过时，不进入广泛自动派工。

## 7. 验收方式

黄金任务的 expected 只记录“必须出现”和“禁止高排位”的路径/合同，不要求唯一排序。这样既可量化，又不会因合理的次序变化制造脆弱测试。
