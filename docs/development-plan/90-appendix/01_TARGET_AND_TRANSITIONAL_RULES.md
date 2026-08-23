# Target Acceptance 与 Transitional Allowances

## A. Target Acceptance：阶段完成后必须成立

1. Store 只有一个可写 CourseProjectDocument。
2. 正常生命周期始终恰好一个活动 Surface session；canonical document 不再由“哪个 session 非空”决定。
3. CourseAuthoringSession 演化为唯一活动导航/过期目标身份；Surface selection、scope token 与 stable authoringAddress 各自保持局部职责。
4. 所有异步持久化提交有 stale-target guard。
5. 新持久化命令使用统一 transaction/history 语义。
6. asset/component resource delta 与 document patch 一条逻辑历史。
7. Legacy V8 writer 为零。
8. HTML/Web/PPTX/PDF/preflight/Health 不读 V8 Project。
9. V2 Producer 只有一个 owner，Player/Export 不各建 producer。
10. Core/Surface/Feature/App 依赖无环。
11. 公共 Facade 不导出 raw Store Hook。
12. Workspace/Properties 主要是路由和组合。
13. repo-index 相同输入逐字节一致，严格 freshness 不依赖 HEAD。
14. Context Pack 在黄金任务上达到质量门槛。
15. 当前事实、目标和迁移例外在 semantic 中明确区分。
16. Legacy 删除有 consumer/build/release/persisted 证据。
17. 三份代表工程通过保存、播放和适用导出人工复核。

## B. Transitional Allowances：迁移期允许但必须下降

| 允许存在 | 条件 | 删除/复核阶段 |
|---|---|---|
| `state.project` | 不新增 writer；consumer 清单持续下降 | ARCH-5 |
| V8-shaped projection | 只读、显式 legacy、无新增 consumer | ARCH-1～5 |
| 三 Surface history/session | 恰好一个活动；新命令不新增依赖；每域迁移后减少 | ARCH-1～5 |
| Slide sidecar/component snapshots | 仅旧命令；新纵切使用 resource delta | ARCH-2 |
| Legacy HTML/Web/PPTX/PDF fallback | V2 主路径保持默认；逐格式做可达性与迁移 | ARCH-4～5 |
| Legacy Player payload | 仅现有 fallback consumer | ARCH-5 |
| raw `useEditorStore` | 旧 UI 允许；新 public API 禁止 | ARCH-1～3 |
| deep imports | 建立基线，只允许下降 | ARCH-1～5 |
| 现有 DeveloperTab | 能力保留并接统一 transaction；不扩建第三模式 | ARCH-2 |
| 历史 task/review | 默认不读，证据由 Git 历史保留 | ARCH-0A |
| manual Bootstrap | repo-index stale/低置信时继续使用 | 长期降级路径 |

## C. 迁移例外登记

任何新增例外必须包含：

- 为什么不能立刻达到目标；
- 允许哪些 consumers；
- 禁止新增什么；
- owner；
- 删除或复核阶段；
- 检测它是否增长的棘轮。
