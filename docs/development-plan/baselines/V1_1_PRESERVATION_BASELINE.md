# 1.1 不可降级行为基线

> 本文件只记录 1.1 的期望、固定 fixture 身份与证据失效闭包。它不是候选报告，也不能被 `accepted` 或 Hash 比较取代。
>
> 机器映射：[`v1.1-preservation-map.json`](v1.1-preservation-map.json)
>
> 检查入口：`npm run check:preservation`

## 1. 固定载体

1.1 候选与 Owner 验收共用下列载体。这里记录语义身份与生成/校验命令，不用 Hash 充当行为证据。

| ID | 路径 | 语义身份 | 生成 / 校验 |
|---|---|---|---|
| `slide-heavy` | `tests/fixtures/architecture-baseline/slide-heavy.h5lesson` | Course Project V9 archive；`projectId = arch-0-slide-heavy` | `npx tsx scripts/build-architecture-baseline-fixtures.ts` / `--check` |
| `flow-heavy` | `tests/fixtures/architecture-baseline/flow-heavy.h5lesson` | Course Project V9 archive；`projectId = arch-0-flow-heavy` | 同上 |
| `mixed-spatial` | `tests/fixtures/architecture-baseline/mixed-spatial.h5lesson` | Course Project V9 archive；`projectId = arch-0-mixed-spatial` | 同上 |
| `render-host-benchmark-v9` | `examples/render-host-benchmark/render-host-benchmark-v9.h5lesson` | 含 Native / Runtime / Component 的 V9 工程 | `npm run refresh:render-benchmark:fixture` / `npm run check:render-benchmark:fixture` |
| `render-host-benchmark-v2` | `examples/render-host-benchmark/render-host-benchmark-v2.html` | 由同一工程生成的 Published V2 离线 HTML | 同上 |

清单与字节身份另见 `tests/fixtures/architecture-baseline/manifest.json` 与 `examples/render-host-benchmark/README.md`。

## 2. 映射合同

`v1.1-preservation-map.json` 必须恰好包含 PM-01 至 PM-28 各一行。每行只允许：

- `id`
- `type`：`automated` 或 `owner-observation`
- `evidenceCommand`（仅 automated）或 `observer`（仅 owner-observation）
- `fixtureIds`
- `inputClosure`
- `invalidation`

automated 行的 `evidenceCommand` 使用 [不可降级矩阵](../roadmap/PRESERVATION_MATRIX.md) 列出的单位 / 集成测试入口。矩阵中的桌面 E2E 与真实视觉/互动观察属于 Owner 发布门，不把 `accepted` 写成 automated pass。

## 3. 检查器行为

`npm run check:preservation` 只读：

1. 以当前 Git HEAD 作为 candidate identity；
2. 若工作树脏文件命中任一行 `inputClosure`，以 `related-dirty` 失败；
3. 执行全部 automated 行；
4. owner-observation 记为 `owner-observation-required`，不阻断 engineering candidate，也不能变成 `accepted`。

只有显式 `--report <path>` 才写入候选报告。报告只能写在 `artifacts/release-evidence/v1.1/<candidate>/` 下，不得覆盖本 baseline 或映射。

下列情况退出非零，且诊断类别稳定：

| 类别 | 含义 |
|---|---|
| `missing-pm` | 映射缺少 PM-01–PM-28 中的某一行 |
| `duplicate-pm` | 同一 PM ID 出现多次 |
| `malformed-map` | 未知字段、非法 type、缺字段、不存在的证据入口或 fixture |
| `stale-candidate` | 报告中的 candidate 与当前 HEAD 不符，或复用证据的闭包已失效 |
| `related-dirty` | 脏文件命中证据闭包 |
| `underlying-failure` | automated 命令失败、blocked 或无法启动 |

## 4. Owner 观察

当前映射中 PM-01 需要 Owner 在固定 suite 上确认桌面核心入口仍可见且可操作。该行未签署不使 automatic gate 假失败或假通过。其余 PM 的视觉/互动复核仍由 r11-062 在同一固定 suite 上签署。
