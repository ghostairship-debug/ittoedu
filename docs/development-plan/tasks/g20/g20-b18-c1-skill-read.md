# g20-b18-c1-skill-read 按需读取随附 skill

- Status / Owner: queued / 主会话激活后指派 6Sol/xhigh
- Outcome / Evidence: 尚无 `skills.read` 工具，`.agents/skills` 未随包分发，能力清单只内嵌在 `src/shared/generated/courseAgentCapabilities.json`。目标：`skills.read({skill, path?, offset?, limit?})` 按需读取随附 Skill，发现合并进工具描述与现有 `tools.load`（`ExecutionEngine.ts:128` 的 `LOAD_TOOLS`），不新增 `skills.list`。
- Write scope: `src/core/tools/SkillTools.ts`、`src/main/workbench/skills/BundledSkillService.ts`、`tests/unit/g20BundledSkillService.test.ts`、`tests/integration/g20SkillTools.test.ts`（均新）。禁止：`scripts/generate-ai-capabilities.ts`、`src/shared/generated/**`、`ToolCatalog.ts`、`HostToolServices.ts`、`DocumentToolGateway.ts`、`ExecutionEngine.ts`（主会话接线）、`.agents/skills/**`、`courseAgentSkills.ts`（属 M18）。详细边界见 `B18_执行卡.md` §3 C1。
- Write locks: none
- Acceptance: 只消费构建期内嵌的生成物同源 bundle；即使在打包态也禁止运行时读 `.agents` 或猜 asar 外路径；只接受 manifest 规范化 key，拒绝绝对路径、`..`、跨 Skill 引用、未登记文件；返回 `{skill,path,version,content,nextOffset?,truncated}`，分页不切 Unicode 字符；系统提示词（`ExecutionEngine.ts:482`）不含 Skill 正文；工具摘要只有两个 Skill 的名称与 frontmatter 一句话用途；普通改字任务零 Skill 读取，创作任务按需读 SKILL.md 与其直接引用的资料并记入运行事件。
- Validation: `npm run typecheck`；`npx vitest run --config output/tmp/vitest.fsallow.config.mts tests/unit/g20BundledSkillService.test.ts tests/integration/g20SkillTools.test.ts`。门槛：B0-e（工具 effect 分类与服务注入形状）。
