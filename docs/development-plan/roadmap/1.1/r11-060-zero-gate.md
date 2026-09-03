# r11-060-zero-gate｜证明可执行作用域零遗留

- Release / Dependencies: 1.1 / r11-054-delete-legacy-modules
- Write locks: `generated-index`
- Inventory access: read
- Preservation: PM-01–PM-28

## Outcome / current evidence

机器可重现地证明 `src/**`、`tests/**`、`scripts/**`、`examples/**`、`artifacts/**`、fixture 与正式生成制品没有旧模块、独立旧 token、Schema 8 作者样本或 V8 Player/Export/archive 工具链；Markdown 历史、最终评估、Git 历史、node_modules 与 cache 明确排除。

## Integrator audit / repaired-scanner prerequisite（2026-09-03）

本 gate 只有在 r11-002 的 false-pass、identity、file/symbol expectation、`.h5lesson` 与 `--report` 回归全部成立，且 r11-054 已在最终 post-delete closure 原样重跑并通过完整 r11-055 gate 后才可运行。它只调用 `npm run check:legacy-zero -- --report <path>`，由唯一 scanner 原子写 `artifacts/release-evidence/v1.1/<candidate>/legacy-zero.json`；不手抄计数、不解析终端文本、不实现第二 scanner。报告目录从 product digest 排除，写报告不得使同一候选 identity 自失效。contracts/capabilities/examples 不属于 Legacy scanner 报告，统一由 r11-061 的候选门验证。

失败分类仍固定：真实 consumer/target → 053/054 或对应 generator owner；误报、identity/scanner 错 → r11-002。本 gate 不改裁判、不加排除项。零 token 报告不是 PM 行为通过证据。

## Read first

- `docs/development-plan/inventories/legacy-consumers.json`
- r11-002 建立的 inventory 驱动零检查实现
- `tests/unit/editor10ForbiddenTokens.test.ts`
- `tests/unit/readModelBoundary.test.ts`

## Write scope

只允许通过 scanner 原子写 `artifacts/release-evidence/v1.1/<candidate>/legacy-zero.json`；报告 schema 固定为 candidate identity、scanner version、scope/exclusions、inventory schema/canonical digest、record/expectation identity、每个 LEG 计数、target-definition、旧 module/token/schema sample 命中、退出码和证据失效条件，不含 generator checks。禁止手写/后处理报告，也禁止修改 scanner、inventory、测试、产品、排除目录或生成产物；`--report` 能力缺失或错误退回 r11-002，其他漂移退回 r11-053/054 或实际 consumer owner。

## Execution

1. 固定 product candidate 与 clean 依赖闭包；执行 `npm run check:legacy-zero -- --report artifacts/release-evidence/v1.1/<candidate>/legacy-zero.json`（唯一 inventory 驱动）。scanner/version/scope/exclusions 与当前 inventory schema/canonical digest 必须和 r11-053/054 最终状态一致；不得另写扫描器或重定向终端文本冒充报告。
2. scanner 只在 zero 成功时原子落盘；任一命中按已固定类别报告。真实 consumer/target 返回 053/054 或对应 Owner；误报、report 原子性或 scanner 错误返回 r11-002，当前 gate 不修裁判。
3. 检查独立 token `ProjectDocument`、`SceneDocument`、`SceneNode`、`ExportPayload` 时不得误伤 `CourseProjectDocument` 等合法名称。
4. 验证 confirmed/unknown/new/unmatched token 与 target-reference 全为 0，所有 `file-absent` / `symbol-absent` target expectation 满足，target-definition 为零，Schema 8 作者样本与 `.h5lesson` 为零。
5. 仅在全部为零时写固定路径 JSON；报告绑定当前 candidate 和输入闭包，不把零 token 当作 PM-01–PM-28 行为通过证据。

## Stop conditions

- 任一真实旧 consumer、Schema 8 样本或 legacy module 仍存在。
- 需要新增排除项、删产品入口/测试/产物或改名掩盖命中。
- inventory 计数与扫描结果不能闭合。

## Acceptance

- 规定作用域真实零命中，inventory confirmed consumer 总数为 0。
- confirmed/unknown/new/unmatched 与 target-reference 均为 0，file/symbol expectation、Schema 8 sample、archive 与正式生成物检查全部满足；报告内容来自 scanner schema 2 structured output。
- 排除项只含已批准历史/缓存范围，扫描器无第二 allowlist。
- 固定 schema 的 legacy-zero 报告同时绑定当前 product candidate 与唯一 inventory schema/canonical digest；product 未变但 inventory 变化时旧报告也必须失效，重跑完全相同输入只允许确定性覆盖同一路径。

## Focused validation

- `npm run check:legacy-zero -- --report artifacts/release-evidence/v1.1/<candidate>/legacy-zero.json`
- `npx vitest run tests/unit/editor10ForbiddenTokens.test.ts tests/unit/readModelBoundary.test.ts`

## Rollback / handoff

零门失败时不改任何实现或裁判；删除不成立的报告，按首个稳定类别退回 r11-002、r11-053、r11-054 或 generator owner。交接只包含候选 identity、报告路径和命中类别。
