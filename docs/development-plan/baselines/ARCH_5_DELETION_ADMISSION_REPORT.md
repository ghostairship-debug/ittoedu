# ARCH-5 删除必要性准入报告

> 日期：2026-08-24（Asia/Shanghai）
>
> 产品基线：`2834f26`；任务领取基线：`d80830f`
>
> 结论：两个候选均准入，并合并为一张 subtractive cleanup 卡

## 1. 第一性原理结论

本阶段目标不是把 Legacy 名称清零，而是在不改变教师行为、V9 合同或发布语义的前提下，移除已经没有消费者的重复机制。两个候选都满足这一门槛：

- `src/renderer/project/validateProjectArchive.ts` 不是仍需兼容的 API，而是 V9 CLI 接管后遗留的完整 V8 校验模块；其所有导出都没有外部消费者，因此应删除整文件，而不是只删一个函数留下孤立 report 层；
- `appendBlankFlowPage` 从引入起就没有生产消费者，唯一可执行 consumer 只证明旧 helper 会因缺少 `mixedPrintPlan` 同步而失败；支持路径 `addCourseFlowPage` 已稳定跨越 ARCH-1～ARCH-4，并已有正向结构断言。

两项可在一个回滚边界内批量删除。它们不需要迁移 consumer、兼容 adapter、新抽象或用户可见变化。

## 2. 八类删除门禁：V8 archive validator

精确删除目标扩展为整个 `src/renderer/project/validateProjectArchive.ts`，因为 `validateProjectArchiveBytes` 之外的 report types、serializer、exit-code 与 error helpers 也只在文件内部互相引用。

| 类别 | 当前证据 | 裁决 |
|---|---|---|
| 静态 import/call/re-export/type | `src/** scripts/** tests/** examples/**` 中精确 symbol 共 `1`，只有导出定义；无 barrel；repo-index 对 symbol 只有 contains/exports，file/symbol incoming consumer 均为 `0` | pass |
| 动态/string/reflection/generated invocation | 对 symbol、module stem/path、`import()`、`require()`、property lookup、Reflect/global 与 JSON/YAML/config 未发现调用；docs/index 命中只描述候选 | pass |
| tests/fixtures/examples/scripts/package/config | 无正向 consumer；`tests/unit/aiCapabilities.test.ts` 只是“不得进入能力源”的负向 ratchet；两个 package validation 命令均指向当前 `scripts/validate-project.ts` | pass |
| IPC/preload/Recovery/cache/session | main、preload、IPC types、Recovery、cache、session 与异步入口均无引用；旧函数只是同步无头 V8 archive validator | pass |
| build/release/package/copied artifacts | electron-builder 只打包 dist、资源与 package；当前 dist symbol/path 为 `0`；现有 app.asar 无源模块 entry 或 bundle literal；private package 无 exports | pass |
| public API/contract/compat owner | 无公共 package/合同/下游 owner；V9 compatibility policy 只接受 schema 9，当前 V9 CLI 对 V8 明确报 unsupported | pass |
| semantic/golden/generated | LEG-010、`feature:legacy-release` 与 GT-023/GT-016 含当前候选事实，必须在删除后改成 removed/V9 replacement 并统一重建 generated index；ARCH-4 历史报告不改写 | required sync |
| replacement/stability/test/rollback | `validateCourseProjectArchiveBytes` / `runValidateProjectCli` 与 package 命令自 `2ad9be7` 接管；九个 current V9/CLI 场景覆盖有效、V8 拒绝、schema、缺资源、exit code 与不写输入；旧模块自接管后未变 | pass |

Git 历史补证：旧模块在 `79ee981` 引入时曾由旧 CLI/测试消费；`2ad9be7` 把 CLI 与行为测试迁到 Course Project V9 后，精确引用降到定义单点。该历史说明它是完成迁移后的遗漏，不是尚未建立 owner 的潜在入口。

## 3. 八类删除门禁：`appendBlankFlowPage`

| 类别 | 当前证据 | 裁决 |
|---|---|---|
| 静态 import/call/re-export/type | production incoming consumer `0`；唯一 import/call 位于 `tests/unit/courseLocationCommands.test.ts`；定义移除后 `createFlowCourseProject.ts → slideEditorCommands.ts` 的最后一条 Flow-named Slide edge 同时归零 | pass |
| 动态/string/reflection/generated invocation | 无动态 import、字符串 dispatch、reflection、global property 或生成调用 | pass |
| tests/fixtures/examples/scripts/package/config | 唯一测试分支只断言 obsolete helper 会 throw；同一测试已有 supported path 的 `ok`、两个 Flow surfaces、两个 print entries 与 schema parse 正向断言 | pass after rewrite |
| IPC/preload/Recovery/cache/session | 无任何对应入口或延迟 consumer | pass |
| build/release/package/copied artifacts | private package 无 export/barrel；当前 renderer bundle 无 runtime symbol，source-map sourcesContent 只是可重建派生产物 | pass |
| public API/contract/compat owner | 仅文件级 direct export，无 package API、合同或 downstream owner；从 Git 引入起也没有生产 consumer | pass |
| semantic/golden/generated | 当前 repo-index 会随定义、test 名称和 direct edge 删除而变化；无需创建新的 Legacy record，只在 cleanup/phase 报告记录 exact delta | required refresh |
| replacement/stability/test/rollback | `addCourseFlowPage` 在 canonical Course location command 中一次 revision 同步 surface/location/`mixedPrintPlan`，已有 focused test，并稳定经过多个完整 ARCH 波次；删除提交可直接 revert | pass |

删除测试中的旧 throw 断言不会丢失产品保护。应把测试改名为 supported behavior，保留全部正向断言；旧 helper 的已知缺陷没有兼容价值。

## 4. 准入任务与停止条件

准入一张卡：`arch-5-01-remove-dead-validator-and-flow-helper`。

最小产品 diff：

- 删除整个 `src/renderer/project/validateProjectArchive.ts`；
- 从 `createFlowCourseProject.ts` 删除 `appendBlankFlowPage` 与仅由它需要的 Slide mutation import；
- 删除 `addCourseFlowPage` 中提及旧 helper 的注释；
- 把 `courseLocationCommands.test.ts` 的 obsolete-negative characterization 改成 supported-path positive test；
- 产品提交后同步 LEG-010、semantic feature、GT-016/023，并统一重建 repo-index。

停止并 retained 的条件是发现任何新的 production/dynamic/IPC/release/public consumer，或 current V9 validator 无法独立覆盖 package validation command。当前审计未触发这些条件。

## 5. 验证边界

本准入是 V0，只做静态、Git、配置、包清单与现存 bundle/asar 的只读证据；没有运行产品 test、build、E2E 或最终 V4。

Cleanup 只运行一组 combined focused tests、root TypeScript、exact deletion scan 与知识索引维护检查。完整 unit/integration/E2E/desktop build 和三份代表课件保留给同一个最终候选的一次 V4。

独立 deletion-admission reviewer 结论：`APPROVE`，无阻断项。审阅者确认整文件删除、obsolete-negative 测试改写、单卡批量边界与 V1/V4 分界合理，并把 LEG-010、semantic feature、GT-016/023 与 generated refresh 列为 cleanup 闭环的必做同步项。
