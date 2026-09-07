# r18-096-capability-workspace：交付助手与Builder共用的精简发现查询和按需资源读取

- Release: 1.8
- Dependencies: `r18-095-authoring-observation`, `r18-092-codex-interactive-adapter`, `r18-093-claude-interactive-adapter`, `r18-094-opencode-interactive-adapter`
- Optional: 否
- Write locks: `generated-index`, `ai-session`, `cli-adapters`
- Gaps: G07, G12

## 结果与现状

同一正式能力源生成精简发现入口、查询与完整能力卡，应用CLI和外部Builder都能按当前任务展开相关能力及资源。

选区请求约127KB且含完整tools/dynamic描述；Build Skill虽写按需参考，入口/索引仍重且没有共用查询机制。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [scripts/generate-ai-capabilities.ts](../../../../scripts/generate-ai-capabilities.ts)
- [artifacts/ai-capabilities/index.json](../../../../artifacts/ai-capabilities/index.json)
- [src/renderer/authoring/tools/authoringToolFacade.ts](../../../../src/renderer/authoring/tools/authoringToolFacade.ts)
- [src/renderer/authoring/generation/generationCapabilities.ts](../../../../src/renderer/authoring/generation/generationCapabilities.ts)
- [src/main/localAgent/profile.ts](../../../../src/main/localAgent/profile.ts)
- [scripts/courseware-builder-v2-host.ts](../../../../scripts/courseware-builder-v2-host.ts)
- [src/renderer/course/coursewareBuilderV2.ts](../../../../src/renderer/course/coursewareBuilderV2.ts)

## 允许写域与旧路径退出

唯一能力生成器、派生发现数据/本地查询消费层、CLI profile/不可变资源workspace；正式工具Owner保持定义源。外部Build Skill具体迁移归104。

## 执行步骤

1. 从正式工具/Schema/支持矩阵生成能力ID、适用Surface/carrier/scope、必要依赖和按需完整Schema/示例/验证卡，保留index.json既有consumer兼容。
2. 查询按关键词/任务类型/Surface/carrier过滤，输出稳定ID和可读位置；CLI原生文件工具与Builder正式发现入口消费同一语义版本，不建第二手工目录或live RPC。
3. 请求初始仅放目标、观察索引、适用发现入口和所需Skill摘要；材料/源码包/动态协议按任务闭包展开，资源和技术说明分开计费。
4. 定义版本变化和scope变化的缓存失效；移除profile内联整套Skills/动态catalog的旧路径，验证离线发现与未知能力明确失败。

## 验收与可信反例

- 简单选区任务初始技术说明≤12KB、精简发现入口≤8KB，必要完整合同仍可取；小任务不读取无关Runtime/Component资料。
- 反例：工具更名/版本变化、未知Surface、隐藏能力、缺失依赖、错误scope查询不得生成虚假支持或使用陈旧Schema。

## 停止条件

若压缩需要丢失必要字段、教学目标或依赖闭包，优先保持正确性并给出超预算原因；不能手写第二清单满足字节目标。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run check:ai-capabilities
npm run test:capabilities
npm run test:product -- tests/unit/coursewareSkillsContract.test.ts tests/unit/coursewareCaseBuilder.test.ts
```

同一Native小任务和动态任务分别记录CLI读取轨迹与Builder查询结果；验证逐层展开真实发生，读到完整输入定义后可执行。

## 回退与交接

交付唯一生成入口、数据版本/失效规则、查询API、兼容consumer名单和104迁移说明；生成产物与consumer同批切换。
