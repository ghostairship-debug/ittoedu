# r12-045-flow-docx-fidelity｜让 Flow 作者浮层按转换矩阵进入连续 DOCX

- Release / Dependencies: 1.2 / r12-005-flow-native-authoring-parity
- Write locks: `export-docx-print`, `published-flow`, `app-save-recovery`
- Inventory access: none

## Outcome / current evidence

当前 Flow DOCX 复用不含浮层的 print plan，只输出“省略 N 个浮层”；`r12-005-flow-native-authoring-parity` 交付的作者内容会因此丢失。按 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §9 建 DOCX 专用 Published 投影：一个 Flow surface 一份连续 Word，逐项保留、后备、占位、排除或拒绝，PDF/打印不变。

## Read first

- `src/renderer/export/course/flowDocx.ts`
- `src/renderer/export/course/flowPrintPlan.ts`
- `src/renderer/export/course/buildCoursePrintArtifacts.ts`
- `src/renderer/app/useCourseDelivery.ts`
- `src/shared/contracts/published-course-v2/types.ts`
- `src/player/surfaces/flow/FlowSurfaceHost.ts`
- `tests/unit/coursePrintArtifacts.test.ts`
- `tests/integration/courseExportPreflightApp.test.tsx`
- `tests/integration/coursePdfExportApp.test.tsx`

## Write scope

允许修改 DOCX projection/OOXML helpers、print artifact DOCX 分支、delivery 调用签名、必要的只读 Published Flow composition helper 与现有目标测试。禁止把 `FLOW_PRINT_INCLUDES_FLOATING_LAYERS` 改为 true、改变 PDF/print plan、修改作者工程 schema 或添加 DOCX 运行时 UI。

## Execution

1. 把 DOCX 入口改为完整 Published payload + target Flow surface ID，创建内部 projection union 和实施合同固定的逐 layer report；PDF 仍走原调用与 false 浮层常量。
2. 按 block 顺序构造连续正文与稳定 paragraph anchors；实现 include/exclude/all 的一次落位、空 Flow 首段、paper 最近 block、viewport 首段与普通 global 只落一次。
3. 唯一重复例外只认 global teacher-controller + visibility all + includeInStaticExports true，并放 footer；其他 global 即使全程可见也只一次。
4. 实现 96-DPI→EMU、clamp、rotation、behindDoc/relativeHeight 与稳定排序；每个位置转换在报告保留 source/output frame。
5. 按矩阵逐类实现正文、text box、preset shape/connector、image、formula、video、Component、Runtime、controller、background、非法 input/table/chart 与 session UI；没有 fallback 的动态项必须生成可见身份占位。
6. 测试解压 DOCX 并解析 document/header/footer XML、relationships/content types，断言 editable carrier 与逐 item report；普通 global 只一次，controller 只 footer。
7. 使用固定 fixture 比较 PDF/print 的页数、文本、图片与浮层排除行为不变；不以 DOCX/PDF 字节 hash 代替结构行为。

## Stop conditions

- 需要打开共享 PDF 浮层开关、改变 FlowBlock 排版或按 location 拆 Word。
- 任一作者 item 只能静默遗漏或只汇总数量，或普通 global 必须复制到每页。
- 当前 OOXML 路径无法生成可解析的 anchored text/shape/picture，且必须引入新大型依赖；先升级 Owner。

## Acceptance

- 一个 Published Flow surface 产出一份连续 DOCX；矩阵每类都有 carrier 与逐 item disposition，无静默丢失。
- text、支持的 shape 和 picture 以可编辑 DrawingML/图片对象存在；无 fallback 项有可见占位。
- PDF/打印 fixture 行为不变。自动化证明 engineering candidate；Word 实际选择/另存留到 S1 accepted，不在本节点虚假宣称。

## Focused validation

- `npm run test:product -- tests/unit/coursePrintArtifacts.test.ts tests/unit/courseProjectHealth.test.ts`
- `npm run test:product -- tests/integration/courseExportPreflightApp.test.tsx tests/integration/coursePdfExportApp.test.tsx`
- `npm run typecheck`

## Rollback / handoff

DOCX signature、projection、OOXML与调用点整体回滚，PDF 分支始终不动。交接 `r12-050-native-closure` 时附多-location fixture、每类 report、解包 OOXML 断言与 PDF 不变证据；若环境有 Word/LibreOffice，可附加打开证据但不冒充 S1 签署。
