# repair-exa-02-generation-boundary 修复示例生成与测试边界

- Status / Owner: queued /
- Risk / Hotspot: S1 / none
- Outcome / Why now: `pretest:e2e` 无条件重写 tracked V8 examples，造成工作树漂移；但简单忽略产物又会破坏 fresh checkout 上依赖固定路径的测试。
- Write scope / Baseline: baseline `b967c96`; `package.json`、`scripts/build-examples.ts`、相关 example prepare/check 脚本、`.github/workflows/**` 和直接生成边界 tests；本卡不迁移或精修任何旧课例内容。
- Acceptance: 测试准备不再无条件修改 tracked 文件；存在显式 `refresh:examples` 与无写入 `check:examples` 或等价最小入口；fresh checkout 能自动取得测试所需 fixture；连续两次准备后 `git status --porcelain` 不新增差异。
- Focused validation: `npx vitest run tests/unit/exampleGenerationBoundary.test.ts`; 连续执行两次新的 prepare/check 命令并比较 `git status --porcelain`。
