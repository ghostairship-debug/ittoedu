# r11-053-legacy-list Legacy 台账重算与精确删除表

- Status / Owner: active / Codex
- Outcome / Evidence: 在 037z 与 052d 完成后的当前树上只运行一次 Legacy inventory 扫描，按 structured output 原子更新唯一台账的明细、计数、当前提交和 schema 强制的 product digest；在台账中形成 `LEG ID / 精确路径 / 当前 consumer=0 / replacement 测试` 删除表，不删除产品文件、不生成第二报告或文件 Hash。
- Write scope: `docs/development-plan/inventories/legacy-consumers.json`，以及按实际非空删除组实例化的 `docs/development-plan/tasks/1.1/r11-054a-*.md` 至 `r11-054d-*.md` 与任务板。禁止修改产品、测试、scanner、排除项或生成物。
- Write locks: legacy-inventory
- Acceptance: 台账与当前 scanner 的 records/summary/currentProductTreeDigest 一致；只把 consumer 为零且 replacement 测试存在的精确文件列入 Shared contract → Player/payload → Export/diagnostics → Archive/test helper 删除组；四个已裁定的 LEG-011 孤儿模块必须在零 consumer 时纳入，任一仍有删除闭包外 consumer 则停止。完成时删除本卡，只把首个非空 054 组置为 queued，后续非空组保持 blocked。
- Validation: 更新前仅运行一次 `npm run check:legacy-inventory` 取得事实；更新后仅运行 `npm run check:legacy-ready`。

> 2026-09-04 首次扫描曾发现 193 条 confirmed observation 与 34 处 target definition；052 系列已把该前置条件收敛为 `confirmedObserved=0`、`targetDefinitions=17`、`targetReferences=0`，现进入唯一台账重算。
