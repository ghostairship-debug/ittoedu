# repair-exa-02-generation-boundary 修复示例生成与测试边界

- Status / Owner: queued /
- Risk / Hotspot: S1 / none
- Outcome / Why now: 当前 `core.autocrlf=false` 环境中的无写入 check 已通过，但三个生成器直接嵌入 checkout 文本且相关输入没有 EOL 约束；Windows `core.autocrlf=true` 的 fresh checkout 仍可能改变 tracked fixture 字节，lesson/render 两条 check 也未被单测实际执行，因此原 fresh-checkout 验收未满足。
- Write scope / Baseline: baseline `3780090`; `scripts/exampleGenerationBoundary.ts`、`scripts/build-examples.ts`、`scripts/build-interactive-lesson.ts`、`scripts/build-render-host-benchmark.ts`、`.gitattributes` 中仅限三个生成器实际读取的文本输入及三组 `*_OUTPUT_PATHS` 文本输出的确切 path 条目、必要的 package scripts 与直接 unit/integration tests；不得添加全仓 EOL pattern、执行 `renormalize`、迁移/精修课例或批量改写源码换行。
- Acceptance: LF 与 CRLF 输入、`core.autocrlf=true` 与 `false` 的 fresh worktree 生成字节一致；sample/lesson/render 的无写入 check 均由测试实际执行；连续两次 `pretest:e2e` 或等价 prepare/check 后 `git status --porcelain` 不新增差异，check 不修改 tracked 文件。
- Focused validation: `npx vitest run tests/unit/exampleGenerationBoundary.test.ts tests/integration/renderHostBenchmark.test.ts`；在两个可丢弃的临时 clone 中用命令级 `git -c core.autocrlf=true/false` 创建 checkout，不修改源仓库配置；分别执行 `npm run check:examples` 与两次 `npm run pretest:e2e`，比较 `SAMPLE_EXAMPLE_OUTPUT_PATHS`、`INTERACTIVE_LESSON_TRACKED_OUTPUT_PATHS`、`RENDER_HOST_BENCHMARK_OUTPUT_PATHS` 所列全部 tracked outputs 的哈希和前后 Git 状态。
