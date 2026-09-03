# r11-054-delete-legacy-modules｜按精确清单分组删除旧模块

- Release / Dependencies: 1.1 / r11-053-legacy-inventory-reconciliation
- Write locks: `legacy-inventory`, `editor-store-history`, `published-producer`
- Inventory access: write
- Preservation: PM-01–PM-28

## Outcome / current evidence

只删除 053 清单中的零 consumer 文件。按 Shared contract、Player/payload、Export/diagnostics、Archive/test helper 最多四张卡执行；每组一个提交，失败只回滚该组。

## Execution

1. 把 053 的本组 exact paths 原样写入当前任务卡；没有路径的组跳过。
2. 删除精确文件，并清理仅因文件不存在而失效的 import、barrel 或 config 行。
3. 不创建 alias、re-export、no-op、fallback 或新 replacement。
4. 运行本组最近层测试和 `npm run typecheck`；不运行全量、Legacy zero、preservation 或 Hash。
5. 最后一组完成后运行一次 `check:legacy-inventory`，用 scanner 给出的删除后 product digest连同相应 `removed` 状态一次更新 inventory；最终 zero 只在 060 运行。

## Write scope

严格等于 053 删除清单、本组直接失效的 import/barrel/config 行和唯一 inventory。禁止删除清单外文件、修改产品行为/Schema、弱化测试或刷新无关生成物。

## Stop conditions

- 删除后需要新实现或兼容桩才能编译。
- 找到任何未登记 consumer。
- 最近层 replacement 测试失败。

## Acceptance

- 本组精确旧文件和失效入口不存在，清单外文件未删除。
- replacement 仍通过，无兼容桩。
- 最终 inventory 只把实际删除项标为 `removed`，并保存 scanner schema 强制的删除后 product digest；不另算文件 Hash。

## Focused validation

- 每组一条由 053 卡写明的 replacement 测试命令。
- `npm run typecheck`

## Rollback / handoff

每组单独回滚；不恢复已通过的其他组。
