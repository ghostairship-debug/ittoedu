# r19-045-material-context：实现课程材料结构化读取、分片发现与可追溯引用

- Release: 1.9
- Dependencies: `r19-040-session-persistence-deletion`, `r15-020-material-tools-citations`
- Optional: 否
- Write locks: `main-preload`, `contracts-schema`, `generated-index`, `workspace-shell`

## 结果与现状

上传材料后可看到原件、读取状态和内容结构；Agent先理解整体，再按页/片段/表格/图片读取并保留出处，自动创作能区分“已上传”和“已成功读取”。

“已读”按本次教学范围判断：原件有效、整体结构可取得，且该范围需要的内容和图像已有实际读取结果。无关附录未读不阻塞当前创作；影响教学正确性的缺页/图示仍需补齐或说明缺口。保留原件/提取/片段的既有状态与版本证据，不新增“全材料理解”状态，也不把范围内已读推断为整份材料全部理解。

当前材料服务只接受TXT/MD/CSV文本、上限2MB；repository搜索返回完整正文，read(id)也经全库搜索。它们尚不能代表PDF、DOCX、PPTX和图片均已可用于自动整课。本节点沿现有材料Owner分阶段补充常见格式与分片，2.0/022完成生产支持边界，不建设向量平台。

## 开始前与阅读入口

依据[产品方案第6节](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)、[开发计划](../../AI_ASSISTANT_DELIVERY_PLAN.md)、[架构合同](../../ARCHITECTURE_CONTRACT.md)、[工作协议](../../WORKING_PROTOCOL.md)和[共同实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)。r15-020的正式规格在[1.5索引](../1.5/README.md)，不是另一个不存在的独立文件。

- [materialContract.ts](../../../../src/shared/materialContract.ts)：当前记录、请求、来源与容量限制。
- [materialRepository.ts](../../../../src/main/materialRepository.ts)、[materialService.ts](../../../../src/main/materialService.ts)：持久材料、导入、搜索和读取。
- [MaterialLibraryDialog.tsx](../../../../src/renderer/ui/MaterialLibraryDialog.tsx)、[ipcTypes.ts](../../../../src/shared/ipcTypes.ts)、[ipc.ts](../../../../src/main/ipc.ts)、[preload/index.ts](../../../../src/preload/index.ts)：现有GUI与窄服务接线。
- [pptxPackage.ts](../../../../src/renderer/project/pptxPackage.ts)、[pptxImport.ts](../../../../src/renderer/project/pptxImport.ts)：可复用的PPTX结构/资源提取，不能把材料读取自动变成工程导入。
- [generationSnapshot.ts](../../../../src/renderer/authoring/generation/generationSnapshot.ts)、[materialCitationTool.ts](../../../../src/renderer/authoring/tools/materialCitationTool.ts)：当前全量材料输入与可携带课程引用。
- [coursewareAuthoringRunner.test.ts](../../../../tests/unit/coursewareAuthoringRunner.test.ts)：材料重启、来源、Save As隔离与删除后的课程引用。

## 允许写域与旧路径退出

既有材料合同/repository/service、格式提取适配和材料GUI/IPC、同源发现数据；原件与派生索引仍属于同一材料域。共享本地身份由042定义，045与042可先按现有正式workspace独立推进，044汇合时使用已完成draft身份，不能各建一份映射。PPTX人工导入和工程事务不因读取材料而触发。

共享身份/材料引用和必要IPC先由唯一集成Owner用短批次定窄合同；随后042做保存/会话生命周期、045做材料repository/service/格式提取，各自隔离叶子可并行。Write locks列出整节点可能写域，实际claim按当前批次的文件和时段取得，不整节点占满。同一粗锁覆盖不同叶子时，由唯一协调Owner在同一协调任务内持锁并委派精确非重叠叶子，不创建两个争用active卡；共享合同、IPC/preload、发现索引和UI入口顺序集成，同一文件不得绕锁并写。接口未就绪只做独立叶子，实际上传/提取/引用和身份集成未完成不能报整节点完成。

## 执行步骤

1. 在当前材料记录之上定义版本化原件、来源和可重建提取结果：文件类型、提取版本/状态、目录、页或幻灯片、段落/表格/图片的稳定片段位置及未读取原因。保留原件，旧文本记录继续可读；具体容量限制按原件与提取结果分别校验，不通过静默截断通过读取门。
2. 先迁移已有文本读取，再复用现有PPTX结构；按真实教学材料逐类接入PDF、DOCX和图片/图示。可复用原生CLI文件/视觉工具或已有解析器，但教师上传后处理与查看均在软件内完成；不得要求外部AI先做预处理。图文、公式、扫描页不能只凭纯文本抽取成功标为完整读取。
3. 搜索返回摘要、匹配位置、读取状态及引用入口，单条读取直达目标记录；片段读取支持页/段/表格/图片与邻近上下文。整体目录可供形成教学主线，正文按当前片段展开；不能只把若干搜索命中当整份教材。
4. 缓存匹配原件实际版本和提取版本；同名更新、重导入、部分失败、删除与重启后重新核对。已读事实能说明读取了哪些页/图片及缺口，不声称理解未读取内容。
5. 应用与Builder发现沿096/104同一语义，提供实际可读片段与出处；自动流程核对有效原件、整体结构及本次教学范围必要内容/图像的真实读取事实。未读附件、空文件或相关范围失败提取不得变成虚构课程材料；无关附录不成为整课启动前的强制全读条件。
6. 课程中正式使用的内容/素材/来源经既有工具和资源事务保存；会话材料缓存和读取轨迹不进.h5lesson、Published或导出。取消默认引用影响后续默认输入，不能假装它同时撤销了原生CLI已有的历史或通用文件权限。

## 验收与可信反例

- 1.9在文本材料及至少一类实际使用的常见复合文档上完成上传→结构目录→局部文字/真实图示读取→带出处引用；该版明确声明的每一种格式都须有真实材料结果。尚未完成的PDF/DOCX/PPTX/图片分支逐项交022，不能泛称全格式可用。
- 一份用于教学主线整体理解，另一份用于精确引用/换图；查询只返回所需范围，引用可定位原件，必要完整正文/原图仍能取得。
- 空附件、坏文件、缺页、扫描页无可用提取、同名更新、超限、跨工程同名材料、旧缓存和删除中的读取，均明确缺口而不串数据、静默截断或虚报成功。

## 停止条件

不能可靠读取影响教学正确性的部分时保留原件并显示待补内容；格式尚不支持时提示范围，不生成占位材料绕过。只有真实解析或查询瓶颈成立才扩展索引实现，不先引入向量库、通用搜索服务或第二材料库。

## 聚焦验证

先在实际材料测试补记录迁移、片段定位、版本失效和读取失败；使用现有PPTX夹具时仅证明提取语义，不冒称所有格式已支持。

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)完成一次适用准备，直接运行以下命名文件，避免test:product排除aiCapabilities.test.ts。现有E2E只证明原材料库基线；新格式/分片/读取范围行为先随实现加入命名用例，再精确grep选中，零匹配不算通过，不运行整个stabilizationCoreUsability真实付费矩阵。

```text
npx --no-install vitest run tests/unit/coursewareAuthoringRunner.test.ts tests/unit/aiCapabilities.test.ts
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep 'S2 材料库：导入检索、可携带引用和另存为隔离$'
```

真实应用上传两份不同结构的教师材料，至少一份含实际图示，核对整体目录、页/片段/原图、失败状态与来源。记录实际读取文件/字节；新格式专属测试随实现建立后补入入口，不为本节点重复三CLI完整矩阵。

## 回退与交接

交付材料合同、已支持格式和缺口、片段读取/缓存规则及真实样本证据。044消费读取事实，022补齐生产格式/引用/删除控制；回退不得删除原件或已进入课程的素材和引用。
