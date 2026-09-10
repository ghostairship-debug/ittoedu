# r18-060-release：Owner验收S3可用AI创作与Builder并发布v1.8.0 accepted源码标签

- Release: 1.8
- Dependencies: `r18-050-three-cli-benchmark`, `r18-051-pptx-editable-diagrams`, `r18-052-pptx-legacy-equations`, `r18-083-surface-integration-exit`, `r18-087-navigation-level-exit`, `r18-103-ai-usability-exit`
- Optional: 否
- Write locks: `none`

## 结果与现状

Owner在同一候选实测可用AI创作、外部Builder与既有人工/PPTX行为后签署S3，再发布v1.8.0 accepted源码标签。

2026-09-11：[同候选最终工程验收](../../reviews/2026-09-10-final-acceptance.md)已执行并修复实际失败：原范围 E2E 100 通过、24 专项条件跳过，新增三 CLI 恢复与持久隔离两项通过；最终类型、构建、能力清单及相关示例检查通过。修复后候选 `r18-final-20260910-02` 已对应源码／构建身份，[S3 复核入口](../../reviews/2026-09-10-s3-review-entry.md)已更新。原付费 CLI／PPTX／Builder 证据按未变范围复用，首次失败保留。当前工程验收完成，Owner 教学／实际体验签署及记录中的未验边界仍独立；不宣称 accepted 或发布。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [docs/development-plan/AI_ASSISTANT_DELIVERY_PLAN.md](../../AI_ASSISTANT_DELIVERY_PLAN.md)
- [docs/development-plan/WORKING_PROTOCOL.md](../../WORKING_PROTOCOL.md)
- [docs/development-plan/PPTX_IMPORT_ENHANCEMENT_PLAN.md](../../PPTX_IMPORT_ENHANCEMENT_PLAN.md)
- [docs/development-plan/roadmap/PRESERVATION_MATRIX.md](../PRESERVATION_MATRIX.md)

## 允许写域与旧路径退出

发布证据/Owner验收清单与保全矩阵按工作协议更新；无产品源码写锁，发现缺陷回到对应Owner。源码标签只在本节点获得实际发布授权后创建。

## 执行步骤

1. 确认所有依赖的真实证据仍有效，尤其103双入口可用性与原050/051/052/083/087；不重复未变门，也不外推旧局部成功。
2. 在同一候选完成S3教师清单：自然编辑/观察/纠正/恢复、三CLI、本地数据隔离、三表面、生成载体、PPTX、本地人工与导出。
3. Owner看过当前真实结果并明确签署后，将已验收1.6–1.8行为晋升保全矩阵/Owner ledger，记录未支持边界。
4. 依据同一候选验证与发布授权创建v1.8.0源码标签；不发布HTML或安装器，不把入口默认可见写为验收证据。

## 验收与可信反例

- 103及既有PPTX两线/三表面/导航均通过，当前候选经Owner明确S3签署；人工保存重开/Undo/Player/导出正常。
- 反例：缺少一个CLI、Flow控制器不可达、Build Skill未同步、图片/替换失败、仅自动化全绿或旧截图均阻止accepted。

## 停止条件

无Owner当前制品签署或任一必选门失败不得发布；保留候选和具体未完成项，不新造豁免。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run verify
git diff --check
```

Owner直接按S3清单复核当前课件；自动化/代理复核不能代签。上述 `verify` 保留为发布入口。本次已实际执行版本级检查的分解入口，首轮失败按影响域修复复验；命名范围、跳过与有效旧证据以最终报告为准，未把整条 `verify` 伪记为一次全绿。

## 回退与交接

交付签署记录、同一候选身份、复用证据索引与源码标签；1.9从该已签署基线开始。
