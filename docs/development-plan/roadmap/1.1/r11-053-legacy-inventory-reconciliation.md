# r11-053-legacy-inventory-reconciliation｜重算 Legacy 台账并给出删除清单

- Release / Dependencies: 1.1 / r11-052-supported-test-migration
- Write locks: `legacy-inventory`
- Inventory access: write
- Preservation: PM-01–PM-28

## Outcome / current evidence

037 与 052 完成后，用现有 scanner 重算唯一 `legacy-consumers.json`，只产出确有 replacement 且 consumer 为零的删除清单。本节点不删除文件、不计算文件 Hash、不写第二份台账或 release report；只保留 inventory schema 强制的一次 product digest。

## Execution

1. 运行一次 `npm run check:legacy-inventory`，读取 structured summary 与 `currentProductTreeDigest`。
2. 对仍有 consumer 的记录保留为 active，不靠改名、排除或删测试减数。
3. 对 consumer 为零且 replacement 测试存在的旧文件，写出：`LEG ID / exact path / replacement test`。
4. 一次更新唯一 inventory 的当前明细、计数、当前 HEAD 与 scanner 给出的 product digest；不另算文件 Hash或候选报告。
5. 运行 `check:legacy-ready`；通过后按实际非空 owner 组实例化 054a–054d，空组不建卡。

## Write scope

只允许修改 `docs/development-plan/inventories/legacy-consumers.json` 与下一张 054 任务卡。禁止修改产品、测试、scanner、生成物或排除项。

## Stop conditions

- 任一拟删文件仍有静态、动态、Player/Export、fixture 或测试 consumer。
- replacement 测试不存在或已经失效。
- scanner 本身报解析错误；该错误交给 Codex 最终复查，不现场重写 scanner。

## Acceptance

- inventory 与当前扫描结果一致。
- 删除清单只含 consumer=0 且 replacement 明确的精确文件。
- 除 inventory schema 强制的一次 product digest 外，没有文件 Hash、第二报告或手抄终端全文。

## Focused validation

- `npm run check:legacy-inventory`
- `npm run check:legacy-ready`

## Rollback / handoff

只回滚 inventory 更新；054 不得扩大清单。
