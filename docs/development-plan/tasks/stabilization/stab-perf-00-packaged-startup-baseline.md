# S1 Task Card — Final-candidate Performance Measurement Disposition

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: docs
- Necessity / skip condition: 当前只有构建 chunk 警告，没有证据表明值得在稳定化期间单独拆包；本卡只需明确一次非重复的测量时机和失败后的准入规则，不得为了收集基线提前重复完整构建。
- Complexity delta: subtractive
- Validation ceiling: V0
- Validation budget: 5 minutes
- Reviewer budget: 1
- Evidence reuse: 该处置绑定当前构建脚本、最终候选规则和根计划；只有这些输入、Electron Builder 配置或发布性能指标要求变化时才重审，普通产品修复不使处置失效。
- Invalidating paths: `package.json`; `electron-builder.yml`; `COURSEWARE_DEVELOPMENT_PLAN.md`; the next ARCH-5 final-candidate task card
- Task ID: `stab-perf-00-packaged-startup-baseline`
- Phase / wave: `post-audit stabilization / E-contract-performance`
- Status: `done`
- Owner / Reviewer / Integrator: `Stabilization Integrator / Performance Reviewer / Stabilization Integrator`
- Claimed at / released at: `2026-08-25 / 2026-08-25`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `planning workspace; bind product measurement to the future final-candidate commit`
- Depends on: `none`
- Blocks: `stab-audit-closure-gate`

## Product outcome

性能风险不会因为 500 kB 警告触发一次额外的完整测试和打包；下一次固定 ARCH-5 最终候选只打包一次，并从同一产物采集冷启动、首个可编辑画布、峰值内存、安装包体积和 source map 入包事实。

## Decision and boundaries

- 当前 Windows 分发脚本会先经过完整 build/typecheck/test/desktop build；稳定化阶段单独运行会与之后的最终候选 V4 重复。
- 下一张 ARCH-5 final-candidate 卡必须把五项性能指标与 source map 清单附着在其唯一打包产物上，并沿用 ARCH-0A 的同机、样本、隐私和不挑选好结果协议。
- chunk 警告只作诊断，不以提高 warning limit 或只写 `manualChunks` 关闭风险。
- 如果最终候选指标越过登记阈值，停止发布结论，再根据测量选出的一个 exact boundary 新建窄 implementation 卡；当前不预建 lazy loader、测试文件或多边界优化计划。
- 本卡不修改产品代码、配置、依赖或生成产物，也不声称性能已经通过。

## Minimal validation

- 静态核对 `package.json` 的 build/dist 调用链、根计划的单次最终候选规则和本卡处置一致；运行 `git diff --check`。

## Result and rollback

- Result: 已选择“复用下一次最终候选唯一打包产物”的处置；独立 `stab-perf-01` 不再有准入依据。
- Evidence boundary: 这是验证去重决定，不是性能结果；实际指标和 pass/fail 只能由未来固定候选产物给出。
- Rollback: 若发布工具链或最终候选流程改变，恢复本卡为 `draft` 并重新选择一次测量入口；不恢复无证据的优化任务。
