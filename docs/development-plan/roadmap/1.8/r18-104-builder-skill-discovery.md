# r18-104-builder-skill-discovery：同步Build Skill与Builder发现入口并验证外部课例按需构建

- Release: 1.8
- Dependencies: `r18-096-capability-workspace`, `r18-097-semantic-edit-replacement`
- Optional: 否
- Write locks: `generated-index`, `contracts-schema`
- Gaps: G07, G12

## 结果与现状

仓库Build Skill、受管安装版、发现脚本及Builder Facade使用096同一按需能力体系；任意普通课例目录可以实际构建和增量修订。

仓库/个人Skill约14.6KB，索引约16.1KB；已有按需参考文字但缺查询与分片闭环。不得把应用127KB请求误写为Builder索引大小。 API V2目前只创建新构建会话；打开已有教师工程并非已暴露的Facade能力。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [.agents/skills/build-courseware-project/SKILL.md](../../../../.agents/skills/build-courseware-project/SKILL.md)
- [.agents/skills/build-courseware-project/references/current-capabilities.md](../../../../.agents/skills/build-courseware-project/references/current-capabilities.md)
- [.agents/skills/build-courseware-project/references/external-case-build.md](../../../../.agents/skills/build-courseware-project/references/external-case-build.md)
- [.agents/skills/build-courseware-project/scripts/resolve-editor-root.mjs](../../../../.agents/skills/build-courseware-project/scripts/resolve-editor-root.mjs)
- [scripts/courseware-builder-v2-host.ts](../../../../scripts/courseware-builder-v2-host.ts)
- [src/renderer/course/coursewareBuilderV2.ts](../../../../src/renderer/course/coursewareBuilderV2.ts)
- [src/renderer/course/coursewareCaseBuilderApi.ts](../../../../src/renderer/course/coursewareCaseBuilderApi.ts)
- [scripts/install-courseware-skills.ps1](../../../../scripts/install-courseware-skills.ps1)
- [.agents/skills/orchestrate-courseware/SKILL.md](../../../../.agents/skills/orchestrate-courseware/SKILL.md)

## 允许写域与旧路径退出

仓库Build Skill及必要references/resolve脚本、现有Builder Facade发现入口、受管installer和相应测试；直接编辑个人安装副本不作为发布方式。编排Skill仅在链接/发现约定受影响时同步引用，不改阶段确认门。

## 执行步骤

1. 把Skill入口收敛为启动/发现/按片段构建/验证流程，技术字段与实例迁入按需卡；入口建议≤6KB，查询直接消费096数据，不手写第二能力表。
2. resolve保持任意cwd、明确产品root和无repo环境；Facade增加受管只读发现接口，构建仍走API V2 execute/finish和真实V9工厂，旧consumer兼容按现有合同。
3. 整体理解两份已确认Markdown的教学目标和呈现约束；引用材料按片段读取并保留出处，不能压token而遗漏教学内容，也不改编排确认门。
4. 通过现有installer发布源Skill及受管副本；验证检测个人修改、冲突/备份/恢复与local root文件保留，不一律覆盖用户目录。
5. 在普通外部目录冷启动Native与含组件/Runtime的课例，按需发现→实际构建→打开检查；已有教师工程的增量修订经真实编辑器与canonical target完成。课例模块重建只用于尚未含教师人工修改的构建产物，不能重建覆盖已有工程。

## 验收与可信反例

- 应用与外部Builder取得相同能力ID/Schema/限制；小课例不全读技术库，复杂课例按需取得完整协议；产物可编辑、可保存重开、Player/HTML正确，已有工程增量修订保留人工修改。
- 反例：产品root失效、索引版本不一致、个人Skill有修改、缺材料片段、未确认Markdown、未支持的增量动作，均明确停点而不猜路径/跳阶段/覆盖产物。

## 停止条件

Facade未暴露的已有工程打开/增量动作，Skill转正式编辑器入口并明确操作路径；本包不凭空承诺load工程API，也不能静态import内部Store或直接改.h5lesson。安装冲突保留用户版本并报告。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run check:ai-capabilities
npm test -- tests/unit/aiCapabilities.test.ts tests/unit/coursewareSkillsContract.test.ts tests/unit/coursewareSkillsInstaller.test.ts
npm run test:product -- tests/unit/coursewareCaseBuilder.test.ts
```

在两个非Git外部目录由实际安装Skill执行冷启动与构建，记录实际读取文件/字节和素材出处；真实打开后手工增加一处内容，再按Skill增量修订并验证保留人工内容。两份Markdown采用已明确确认的课例。

## 回退与交接

交付Skill源、生成发现数据、Facade版本、受管安装差异及外部课例证据；失败回退对应受管版本，不碰用户自定义Skill和现有课件。
