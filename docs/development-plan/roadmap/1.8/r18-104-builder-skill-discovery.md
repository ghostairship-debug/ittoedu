# r18-104-builder-skill-discovery：同步Build Skill与Builder发现入口并验证外部课例按需构建

- Release: 1.8
- Dependencies: `r18-096-capability-workspace`, `r18-097-semantic-edit-replacement`
- Optional: 否
- Write locks: `generated-index`, `contracts-schema`
- Gaps: G07, G12

## 结果与现状

仓库Build Skill、受管安装版、发现脚本及Builder Facade使用096同一按需能力体系；任意普通课例目录可以实际构建和增量修订。

本版同时减少Builder完整snapshot与累计回执的重复返回，复用现有构造/验证核心。完整教学、呈现、构建与检查Skill的内置流程归1.9的044和2.0的021，不把外部有效知识缩成短提示来宣称内置完成。

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

同步096的小能力卡、按需源码与097窄编辑语义；构建仍使用API V2正式execute/finish，已有教师工程仍转编辑器canonical target。共用Builder构造/验证能力不等于开放live工程API，本节点不增加附着当前工程的新执行环境或未命名身份，保持当前两稿路径；未命名基础归1.9的042，自动/手动内置流程归044，外部已确认稿路径保留原停点。完整单元构建复用正式工厂和事务，不另造内容DSL或一套字段表。

1. 把Skill入口收敛为启动/发现/按片段构建/验证流程，技术字段与实例迁入按需卡；入口建议≤6KB，必要方法与质量参考保持完整可读，查询直接消费096数据，不手写第二能力表或以删掉教学/设计知识换字节目标。
2. resolve保持任意cwd、明确产品root和无repo环境；Facade增加受管只读发现接口，构建仍走API V2 execute/finish和真实V9工厂，旧consumer兼容按现有合同。
3. 整体理解两份已确认Markdown的教学目标和呈现约束；引用材料按片段读取并保留出处，不能压token而遗漏教学内容，也不改编排确认门。
4. 通过现有installer发布源Skill及受管副本；验证检测个人修改、冲突/备份/恢复与local root文件保留，不一律覆盖用户目录。
5. 在普通外部目录冷启动Native与含组件/Runtime的课例，按需发现→实际构建→打开检查；已有教师工程的增量修订经真实编辑器与canonical target完成。课例模块重建只用于尚未含教师人工修改的构建产物，不能重建覆盖已有工程。
6. 在既有Facade/构建会话内增加实际需要的窄观察与阶段回执读取，按目标或阶段返回必要内容，避免activate/snapshot反复携带整工程、全部源码和累计回执。旧consumer保持兼容并迁移高频调用，构造仍复用原工厂与execute/finish；不为减少输出建立第二Builder、MCP/RPC平台或模型循环。

模板/设计复用沿096同源发现：实际安装Skill在不同材料中选用已有Recipe或组件及设计参考，记录选择依据、来源与最终可编辑产物；不要求先建设大模板库。

课件Skill仅附加专业流程和编辑器连接，不遮蔽用户CLI已有Skills、工具连接和子任务，也不将候选目录规定为CLI全部文件权限。未变材料/源码/能力定义与回执可按正式版本复用；每阶段只取所需内容，但先理解已确认稿的整体目标。常见材料解析/分片Owner由1.9的045负责，本节点不另建材料服务。

## 验收与可信反例

- 应用与外部Builder取得相同能力ID/Schema/限制；小课例不全读技术库，复杂课例按需取得完整协议；产物可编辑、可保存重开、Player/HTML正确，已有工程增量修订保留人工修改。
- 反例：产品root失效、索引版本不一致、个人Skill有修改、缺材料片段、未确认Markdown、未支持的增量动作，均明确停点而不猜路径/跳阶段/覆盖产物。
- 同一构建会话连续操作时窄读取和阶段回执不重复返回未请求整工程/全部源码/累计历史，当前目标与真实回执仍完整，旧consumer不降级；方法和质量参考可按需取得，用户原生Skill/工具发现不被受管内容覆盖。

## 停止条件

Facade未暴露的已有工程打开/增量动作，Skill转正式编辑器入口并明确操作路径；本包不凭空承诺load工程API，也不能静态import内部Store或直接改.h5lesson。安装冲突保留用户版本并报告。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install tsx scripts/generate-ai-capabilities.ts --check
npx --no-install vitest run tests/unit/aiCapabilities.test.ts tests/unit/coursewareSkillsContract.test.ts tests/unit/coursewareSkillsInstaller.test.ts tests/unit/coursewareCaseBuilder.test.ts
```

在两个非Git外部目录由实际安装Skill执行冷启动与构建，记录实际读取文件/字节、窄观察/回执返回量和素材出处；真实打开后手工增加一处内容，再按Skill增量修订并验证保留人工内容。两份Markdown采用已明确确认的课例。只记录本版效率基线，完整内置工作流与标准整课最终速度不前置到104。

## 回退与交接

交付Skill源、生成发现数据、Facade版本、受管安装差异及外部课例证据；失败回退对应受管版本，不碰用户自定义Skill和现有课件。
