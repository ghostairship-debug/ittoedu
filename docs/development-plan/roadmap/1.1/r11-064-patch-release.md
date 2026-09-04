# r11-064-patch-release｜Owner 验收并发布 1.1.1 Flow 文字格式维护版

- Release / Dependencies: 1.1 / r11-063-flow-text-format-hotfix
- Write locks: `none`
- Inventory access: read
- Preservation: PM-01–PM-29

## Outcome / current evidence

把 r11-063 的同一固定候选从 engineering candidate 提升为 Owner accepted 的 `v1.1.1` 维护版。`v1.1.0` 标签和既有发布身份保持不可变；本节点不修改产品来制造通过或替代真实操作，只有本节点通过后才解除 1.2 依赖门。

## Read first

- `docs/development-plan/roadmap/1.1/r11-063-flow-text-format-hotfix.md`
- `docs/development-plan/roadmap/PRESERVATION_MATRIX.md`
- `docs/USER_GUIDE.md`
- `tests/fixtures/architecture-baseline/flow-heavy.h5lesson`
- `examples/render-host-benchmark/render-host-benchmark-v9.h5lesson`
- `examples/render-host-benchmark/render-host-benchmark-v2.html`

## Execution

1. 锁定 r11-063 已通过的源码候选和由该候选生成的固定课例离线 HTML，不在验收过程中修改实现、测试或 fixture。
2. Owner 用真实 Electron 界面分别验证非空 range 的字体下拉/字号输入、折叠光标 pending style、Undo / Redo、保存重开、当前页试运行、整课 Player、单 HTML 与适用 Flow DOCX。
3. 任一结果失败即退回 r11-063；全部接受后，把已验收行为作为新的 PM 行晋升到保全矩阵，创建新的 `v1.1.1` 源码标签，并记录固定 HTML 身份。
4. 只有上述签署与新标签完成，r12/r13/r14/r16 以 1.1 为直接基线的根节点才解除依赖门。

## Write scope

仅允许 Owner 写验收记录、保全矩阵新行和经明确批准的版本/标签元数据。禁止移动或重写 `v1.1.0` 标签，禁止在本节点修产品或测试，禁止生成安装包。

## Acceptance

- Owner 对同一固定候选的 range、caret、history、保存重开和 delivery 结果明确签署 `accepted`。
- 新保全行写明可见行为、最低有效证据和禁止降级方式，下一版本能直接引用。
- 创建新的 `v1.1.1` 源码标签并固定对应课例离线 HTML；`v1.1.0` 仍解析到原提交。
- 未签署、制品不一致或任一真实操作失败时，不 tag，不解除 1.2 依赖门。

## Focused validation

- 人工按 Execution 第 2 项操作固定候选；自动化直接复用 r11-063 对同一候选已通过的证据，不因进入 Owner 节点重复运行。

## Rollback / handoff

验收失败时不创建 `v1.1.1` 标签、不晋升保全矩阵并退回首个可复现步骤；已签署的 `v1.1.0` 不受影响。

## Acceptance record（2026-09-04）

- 决定：`accepted`。用户已授权在无外部阻塞时自主作 Owner 决策；同一候选通过真实 Electron 的 range 字体/字号、caret pending style、Undo/Redo、保存重开、当前位置试运行与整课 Player 验收，适用 HTML / DOCX 投影由产品测试验证。
- 保全：新增 PM-29；PM-01–PM-28 的全量产品与桌面回归保持通过。V9 / Published V2 Schema 与版本号未改变，未增加第二 Store、History、Session 或 writer。
- 固定制品：`examples/render-host-benchmark/render-host-benchmark-v2.html`，3,391,060 bytes，SHA-256 `5927950f7830152ca067aaf3b84dd70758bf59440b3d9ed1dae544a97bd919f0`。
- 自动证据：发布门的同一源码候选通过 269 个 Vitest 文件 / 2261 项测试；57 项 Playwright E2E 由连续短分片完整覆盖。`check:ai-capabilities`、三套 TypeScript 检查、Player/Renderer/Electron 构建、示例字节一致性和真实发布载体互动均通过。
- 发布身份：本记录所在提交创建 annotated `v1.1.1` 源码标签；既有 `v1.1.0` 标签保持原对象不变。1.2 直接依赖门解除。
