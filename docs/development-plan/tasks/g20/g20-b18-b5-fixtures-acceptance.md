# g20-b18-b5-m23m24 夹具与真实 Electron 验收

- Status / Owner: queued / 主会话在四切片冻结后指派 6Luna/max
- Outcome / Evidence: M23 三项（T01 security、T02 electron、T03 electron）与 M24 四项（T01/T02/T04 integration、T03 electron）均为 `not_run`。目标：造夹具、跑真实验收、写证据。本卡不实现产品代码。
- Write scope: `tests/e2e/helpers/g20M23Harness.ts`、`g20M23Fixtures.ts`、`g20M24Harness.ts`、`g20M24Model.ts`（均新）、`tests/e2e/g20M23HtmlPreview.spec.ts`、`g20M23HtmlLightEdit.spec.ts`、`g20M24Tools.spec.ts`、`g20M24Observe.spec.ts`（均新）、`tests/fixtures/g20-m24/three-sections.html`、`remote-script.html`、`flow-sections.html`（均新）。禁止：修改任何 `src/**`、既有 helpers 的通用 launch 语义、既有 spec 的断言。夹具/证据产物写 `output/g20/m23|m24/<spec>/run-XXXXXX/`（每次 `mkdtempSync`，不覆盖）。计划/正式证据只草拟交主会话审核。详细边界见 `B18_执行卡.md` §5。
- Write locks: none
- Acceptance: 七个用例的必需反例逐条实际执行并通过，见执行卡 §5 表。M23-T01 必须真 Electron（node mock 不算）；M24-T03 必须解码假服务实收的图像字节核对渲染目标，不能只看到 URL 字符串。每个 spec 的 `finally` 写 `evidence.json`（当前 DOM/frames、canonical snapshot 摘要、实际 URL/网络计数、模型请求与回执、console/pageerror），并保留 shots，**必须打开 PNG 确认画面与断言一致**。窗口错误数必须为 0。
- Validation: 先按源码变化准备一次 `npm run build:renderer`（改 main/preload 再加 `build:electron`）；随后串行运行 `npx playwright test tests/e2e/g20M23HtmlPreview.spec.ts`、`g20M23HtmlLightEdit.spec.ts`、`g20M24Tools.spec.ts`、`g20M24Observe.spec.ts`；回归 `g20M15ElementCards.spec.ts`、`g20M21QuickBar.spec.ts`、`g20M20Files.spec.ts`，M17 导入载体变化时加 `g20M17HtmlImport.spec.ts`。同一时间只跑一组。零匹配不算通过。
