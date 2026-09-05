# r12-050-native-closure｜统一补齐诊断、Capability、无障碍、Published 与导出 preflight

- Release / Dependencies: 1.2 / r12-005-flow-native-authoring-parity, r12-007-input-response-delivery, r12-011-table-authoring-delivery, r12-021-chart-authoring-delivery, r12-030-line-authoring, r12-040-background-authoring, r12-045-flow-docx-fidelity
- Write locks: `generated-index`, `diagnostics`, `published-producer`
- Inventory access: none

## Outcome / current evidence

本节点的启动前提是所有依赖纵切逐项通过 Acceptance；[2026-09-05 本地复审](../../reviews/1.2-local-review-2026-09-05.md) 仍存在 F1–F5、L1–L6，不能沿用“所有功能已交付”的结论。上游修复及真实 carrier 证据齐备后，本节点只做跨功能 health/preflight、键盘可达、能力声明与 Published 完整性闭合，不接管上游实现或重写合同。

## Read first

- `src/shared/courseProjectHealth.ts`
- `src/shared/courseProjectHealth/catalog.ts`
- `src/shared/courseProjectHealth/interaction.ts`
- `src/renderer/export/course/buildPublishedCourse.ts`
- `scripts/generate-ai-capabilities.ts`
- `tests/unit/courseProjectHealth.test.ts`
- `tests/unit/buildPublishedCourseV2.test.ts`
- `tests/unit/aiCapabilities.test.ts`
- `tests/unit/courseSlidePreflightParity.test.ts`
- `tests/integration/courseExportPreflightApp.test.tsx`

## Write scope

只允许修改 health/diagnostics、Published producer 的跨功能遗漏、能力生成器/生成制品和现有目标测试。上游节点的 UI、commands、renderer、Schema、DOCX/PPTX 只能返回原责任节点修复；不得在 closure 加兼容 shim、silent fallback 或第二套校验。

## Execution

1. 用 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §10 建一张内部测试矩阵，逐项检查 Table/Chart/input/Line/Background/Flow DOCX 的结构、语义、carrier 与 export disposition；已有诊断复用，不创建平行 catalog。
2. 补齐 health：Table ID/矩阵、Chart ID/长度/值、input 容器/key/target/family、Line kind、Background asset/owner。每条定位到 surface/location/layerItem/field path。
3. 构建 Published fixture，断言所有合法新 Native 与背景字段进入 payload，越界/非法项阻断而非过滤；旧 V9/Published fixture 仍通过。
4. 对每个静态导出检查“保留、明确静态后备、可见占位、明确拒绝”恰有一个结果；DOCX 报告逐 item，PPTX input/elbow 的 warning 稳定。
5. 检查可见入口与键盘路径：Table Tab/Shift+Tab、Chart 数据表、input Tab/Enter/Esc/IME、Line handles、Background owner selector；修复只能落 diagnostics/producer 范围，UI 缺陷返回上游。
   按复审编号核对完整退出证据：L1 的真实内容/样式/历史增量；L2/L3 的 base/两个 named state/surface 隔离；F1 的真实 input 双键原子提交/规则族；L5 的末格单事务与焦点；L6 的独立填充/边框 alpha；F3–F5 的完整圆环、类型图元、裁切、轴/标签/四向图例；L4/F2 的合法 HEX 取消与真实 consumer 连续预览。对应反例须进入正式目标测试，ignored 临时测试不作交接前置。现有常用色/统一入口继续保全；发现缺口返回原责任节点。
6. 更新能力生成器的 source evidence 覆盖 `src/shared/contracts/**`，在所有上游稳定后仅生成一次最终能力索引；结果必须确定性且与真实 UI/carrier 一致。

## Stop conditions

- 缺陷根因在上游 command/UI/renderer/export owner，必须越过本节点写锁才能修。
- 需要弱化 Schema、过滤非法项或用 warning 代替已承诺 carrier 才能全绿。
- 能力索引只能靠手改 JSON 或声明当前产品没有的能力。

## Acceptance

- 所有 1.2 新能力有精确 health/preflight，合法 Published 不漏项，非法项不静默通过。
- 键盘入口达到实施合同，无障碍摘要/名称可读取；旧人工编辑与导出基线不退化。
- 能力索引由生成器产生、source evidence 完整、连续生成确定且检查通过。
- 复审 F1–F5、L1–L6 各有修复 diff 和对应行为证据，真实创建/后续编辑、保存重开、Undo/Redo、Player/HTML 与适用导出齐全后才交给 release；不把测试文件存在、70 项旧测试通过或 build 成功当作这些反例已关闭。
- 1.2 能力声明仍明确 Chart 仅 Slide，input 仅 Slide scene；Flow/Spatial 后续规划不能生成当前支持声明。只有真实交付的能力进入索引。

## Focused validation

- `npm run test:product -- tests/unit/courseProjectHealth.test.ts tests/unit/buildPublishedCourseV2.test.ts tests/unit/courseSlidePreflightParity.test.ts tests/unit/aiCapabilities.test.ts`
- `npm run test:product -- tests/unit/coursePrintArtifacts.test.ts tests/unit/coursePptxExport.test.ts tests/integration/courseExportPreflightApp.test.tsx`
- `npm run check:ai-capabilities`

## Rollback / handoff

按 diagnostic rule、producer repair、generator/output 成对回滚。若发现上游缺陷，交接必须写明 node、fixture、首个失败 assertion 与应返回的 r12 task，不在 closure 越锁修复。
