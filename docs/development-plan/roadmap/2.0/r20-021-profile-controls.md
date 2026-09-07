# r20-021-profile-controls：完善内置Skills选择与助手Builder共用发现的生产控制

- Release: 2.0
- Dependencies: `r20-000-public-governance`, `r18-050-three-cli-benchmark`, `r18-104-builder-skill-discovery`
- Optional: 否
- Write locks: `generated-index`, `workspace-shell`

## 结果与现状

教师可理解和选择内置Skills、上下文范围与CLI配置；应用和外部Build Skill继续使用同一按需能力定义，升级后不会漂移。

1.8的096/104已完成技术发现与Skill迁移；2.0完善可理解的产品选择与版本兼容，不能再复制工具表。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/profile.ts](../../../../src/main/localAgent/profile.ts)
- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)
- [scripts/generate-ai-capabilities.ts](../../../../scripts/generate-ai-capabilities.ts)
- [.agents/skills/build-courseware-project/SKILL.md](../../../../.agents/skills/build-courseware-project/SKILL.md)
- [scripts/install-courseware-skills.ps1](../../../../scripts/install-courseware-skills.ps1)

## 允许写域与旧路径退出

内置profile/Skill元数据、Workspace选择与说明、生成能力消费；源Skill通过受管installer更新，个人副本冲突继续保留。

## 执行步骤

1. 只显示版本兼容的内置Skill及用途/适用范围，不要求教师理解内部carrier/Schema才可开始任务。
2. 可查看本次实际CLI/模型/意图/Skill/引用与读写范围，切换后由同一090/091合同确认；不更换产品工具Schema。
3. 验证应用profile和安装版Build Skill取同一能力卡，能力变化时同步版本、失效缓存和必要引用。
4. 无效Skill明确原因和恢复入口；不提供任意Main/OS/secret权限开关。

## 验收与可信反例

- 教师可按目的选择Skill并看到真实生效；同一能力在应用/Builder的scope/输入/限制一致，简单任务继续按需读取。
- 反例：Skill版本错配、个人副本有修改、隐藏能力、切CLI后旧profile残留，不得静默用旧Schema或覆盖用户Skill。

## 停止条件

缺少适用Skill时先使用明确通用工作流，不虚构支持；新产品能力仍先走正式工具合同。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run check:ai-capabilities
npm test -- tests/unit/aiCapabilities.test.ts tests/unit/coursewareSkillsContract.test.ts tests/unit/coursewareSkillsInstaller.test.ts
```

实际设置选择并用一项Native与一项动态任务验证读取轨迹；外部普通目录再次核对受管Skill版本，未变构建证据可复用。

## 回退与交接

交付生产Skill/profile说明与兼容证据给025/030；发现入口保持单一源。
