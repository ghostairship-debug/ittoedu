# r11-055-architecture-modularity-gate｜最终审查 Owner 与依赖方向

- Release / Dependencies: 1.1 / r11-054-delete-legacy-modules
- Write locks: `editor-store-history`, `workspace-properties`
- Inventory access: read
- Preservation: PM-01–PM-28

## Outcome / current evidence

全部 Gemini 实施卡完成后，由 Codex 一次性审查最终代码：root 只接线、Feature ports 窄、Workspace/Properties 只路由、无镜像/双写/service locator。此门不在实施中反复运行，也不建设架构评分平台、Hash 或大批人工违规 fixture。

## Review points

- `editorStore.ts`：只实例化、组合、分派和导出命名 selector；无业务 mutation、projection、完整 Facade。
- 三 Surface slice：各自持有 session/selection/history/persist，不交叉写其他 Surface。
- `crossSurfaceCommands.ts`：只组装和分派，无 archive/lifecycle/具体 Surface 实现。
- App 与四个 Feature：只收窄 ports，不 import 完整 Store/`EditorState`。
- Workspace/Properties connector：不读取完整 document 后跨 Owner 拼业务服务。
- 教师控制器：无模块级 mutable bind。

## Write scope

默认只读。只有结构测试与合同不一致时，Codex 可修改 `architectureDependencyRatchet.test.ts`、`readModelBoundary.test.ts` 的最小断言；不得修改产品来迁就测试，也不得用大白名单放行。

## Stop conditions

- 发现产品 Owner 偏差：返回对应 037 小卡，不在 gate 内修产品。
- 只能靠关键词、LOC、文件数量或扩大白名单判断。

## Acceptance

- 上述六项经源码/import graph 审查成立。
- 两个现有结构测试通过且没有弱化合同。

## Focused validation

- `npx vitest run tests/unit/architectureDependencyRatchet.test.ts tests/unit/readModelBoundary.test.ts`

## Rollback / handoff

失败只报告首个 owner、文件和符号，返回最小责任卡。
