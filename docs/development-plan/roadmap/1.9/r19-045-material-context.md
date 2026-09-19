# r19-045-material-context：材料直达、结构化读取与出处

- Release: 1.9
- Dependencies: `r19-040-session-persistence-deletion`, `r19-042-draft-workspace-continuity`, `r15-020-material-tools-citations`
- Optional: 否
- Write locks: `main-preload`, `contracts-schema`, `generated-index`, `workspace-shell`

日期：2026-09-18。当前实施见[主方案 F04/F07、V08](../../R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md)。已有效格式证据复用，重点补路径/@/粘贴入口和目录归属；本轮不执行测试。

## 结果与现状

材料通过目录已有文件、路径、@、附件或粘贴进入任务，无强制导入/采用步骤。按任务需要读取正文、必要图示和出处，整理成果需要独立交付时写真实目录，再按页/片段/表格/图片读取；已独立整理材料不依赖共享原件继续存在。区分已引用、实际读取、已用于创作。归属遵循[目录与文件合同](../../R19_LESSON_DOCUMENT_WORKSPACE_CONTRACT.md)，消费042目录作用域与真实文件引用，不要求lesson标识，不另建材料库或旧缓存迁移。

“已读”按本次教学范围判断：原件有效、整体结构可取得，且该范围需要的内容和图像已有实际读取结果。无关附录未读不阻塞当前创作；影响教学正确性的缺页/图示仍需补齐或说明缺口。保留原件/提取/片段的既有状态与版本证据，不新增“全材料理解”状态，也不把范围内已读推断为整份材料全部理解。

PDF、DOCX、PPTX及文本已有分项实现与证据，见[共用编辑方案历史证据](../../R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md#4-剩余范围与滚动批次)。旧“仅文本/2MB”的入口描述不能代表当前全部能力；开工核对实际 lessonMaterialDesktopService/lessonMaterials 及本次入口，复用未受影响格式，不重建提取器。三格式原件各自读取和真实创作消费仍为必选。2.0/022 继续完善其他承诺格式与生产数据控制，不能承接本节点尚未完成的 PDF/DOCX/PPTX 基本支持，不建设向量平台。

## 开始前与阅读入口

依据[产品方案第6节](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)、[开发计划](../../AI_ASSISTANT_DELIVERY_PLAN.md)、[架构合同](../../ARCHITECTURE_CONTRACT.md)、[工作协议](../../WORKING_PROTOCOL.md)和[共同实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)。r15-020的正式规格在[1.5索引](../1.5/README.md)，不是另一个不存在的独立文件。

- [materialContract.ts](../../../../src/shared/materialContract.ts)：当前记录、请求、来源与容量限制。
- [materialRepository.ts](../../../../src/main/materialRepository.ts)、[materialService.ts](../../../../src/main/materialService.ts)：持久材料、导入、搜索和读取。
- [MaterialLibraryDialog.tsx](../../../../src/renderer/ui/MaterialLibraryDialog.tsx)、[ipcTypes.ts](../../../../src/shared/ipcTypes.ts)、[ipc.ts](../../../../src/main/ipc.ts)、[preload/index.ts](../../../../src/preload/index.ts)：既有材料库 GUI 只作回归基线，**不是**本节点必经入口；新必选是路径、@、附件或粘贴。
- [pptxPackage.ts](../../../../src/renderer/project/pptxPackage.ts)、[pptxImport.ts](../../../../src/renderer/project/pptxImport.ts)：可复用的PPTX结构/资源提取，不能把材料读取自动变成工程导入。
- [generationSnapshot.ts](../../../../src/renderer/authoring/generation/generationSnapshot.ts)、[materialCitationTool.ts](../../../../src/renderer/authoring/tools/materialCitationTool.ts)：当前全量材料输入与可携带课程引用。
- [coursewareAuthoringRunner.test.ts](../../../../tests/unit/coursewareAuthoringRunner.test.ts)：材料重启、来源、Save As隔离与删除后的课程引用。

## 允许写域与旧路径退出

材料合同/repository/service、格式提取适配和材料GUI/IPC、同源发现数据由同一材料Owner负责。需要独立整理的资料由实际提取形成真实目录中的材料集，042提供目录及文件引用，045不使用假课例或draft映射；不另建第二材料库。PPTX人工导入和工程事务不因读取材料而触发。

共享身份/材料引用和必要IPC先由唯一集成Owner用短批次定窄合同；随后042做保存/会话生命周期、045做材料repository/service/格式提取，各自隔离叶子可并行。Write locks列出整节点可能写域，实际claim按当前批次的文件和时段取得，不整节点占满。同一粗锁覆盖不同叶子时，由唯一协调Owner在同一协调任务内持锁并委派精确非重叠叶子，不创建两个争用active卡；共享合同、IPC/preload、发现索引和UI入口顺序集成，同一文件不得绕锁并写。接口未就绪只做独立叶子，实际上传/提取/引用和身份集成未完成不能报整节点完成。

与051共用的pptxPackage.ts/pptxImport.ts由唯一writer维护，材料提取适配可通过稳定只读端口并行开发。三格式读取与目录/文件接口先供044消费；首次真实创作消费可在044/050组合链中验证并回链为045最终证据，不因这项下游组合验收让044与045互相等待。读取成功本身仍不能冒充已完成创作消费。

## 执行步骤

1. 定义本版本原件/来源与提取结果：文件类型、提取版本/状态、结构目录、页或幻灯片、正文/表格/图示的稳定片段位置及缺口。有效正文、必要图示和出处索引真实保存到任务真实目录的材料位置；不迁移旧记录。原始资料保持，容量限制按原件与提取结果分别校验，不静默截断。
2. 接通新记录的文本读取并复用PPTX结构，按真实教学材料逐类接入PDF、DOCX和必要图示。可复用原生CLI文件/视觉工具或已有解析器，但添加后处理与查看均在软件内完成，不要求外部AI预处理。图文、公式、扫描页不能仅凭纯文本抽取成功标为完整读取。
3. 搜索返回摘要、匹配位置、读取状态及引用入口，单条读取直达目标记录；片段读取支持页/段/表格/图片与邻近上下文。整体目录可供形成教学主线，正文按当前片段展开；不能只把若干搜索命中当整份教材。
4. 提取记录匹配本次采用的原件版本和提取版本；同名更新、重导入、部分失败、删除与重启分别核对。共享原件后来移动/删除不使已经独立保存的已整理材料失效；明确更新材料时才替换来源版本。已读事实说明已读取的范围和缺口，不声称理解未读内容。
5. 应用与Builder发现沿096/104同一语义，提供实际可读片段与出处；自动流程核对有效原件、整体结构及本次教学范围必要内容/图像的真实读取事实。未读附件、空文件或相关范围失败提取不得变成虚构课程材料；无关附录不成为整课启动前的强制全读条件。
6. 课程中正式使用的内容/素材/来源经既有工具和资源事务保存；会话材料缓存和读取轨迹不进.h5lesson、Published或导出。取消默认引用影响后续默认输入，不能假装它同时撤销了原生CLI已有的历史或通用文件权限。

## 验收与可信反例

- PDF、DOCX、PPTX 三类材料及已有文本材料均完成软件内通过路径/引用/附件提供→结构目录→局部文字/必要真实图示读取→带出处引用→创作消费。三类分别使用真实材料验收，不能只用一类、纯文本抽取或独立解析器成功替代。普通教材/教案的必要图示、公式与扫描页按实际图像读取；无法可靠读取关键内容时本次创作明确未完成，不伪报材料支持。独立图片等其他承诺格式由022继续完善，不将三类基本支持延期。
- 一份用于教学主线整体理解，另一份用于精确引用/换图；查询只返回所需范围，引用可定位原件，必要完整正文/原图仍能取得。
- 空附件、坏文件、缺页、扫描页无可用提取、同名更新、超限、跨工程同名材料、旧缓存和删除中的读取，均明确缺口而不串数据、静默截断或虚报成功。

## 停止条件

不能可靠读取影响教学正确性的部分时保留原件并显示待补内容；格式尚不支持时提示范围，不生成占位材料绕过。只有真实解析或查询瓶颈成立才扩展索引实现，不先引入向量库、通用搜索服务或第二材料库。

## 聚焦验证

先在实际材料测试补已整理材料落盘、片段定位、版本失效和读取失败；Owner明确本次无兼容需求，不测试旧缓存迁移。使用PPTX夹具时仅证明提取语义，不冒称所有格式已支持。

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)完成一次适用准备，先核对 package.json 和目标文件，再选择下列相关命名用例；当前 test:product 排除 aiCapabilities.test.ts，该检查应使用直接命名入口或 test:capabilities。`S2 材料库：导入检索` 只证明旧库回归，**不算**路径/@/附件/粘贴直达通过。新入口与分片/读取范围行为先随实现加入命名用例，再精确 grep 选中，零匹配不算通过，不运行整个 stabilizationCoreUsability 真实付费矩阵。

```text
npx --no-install vitest run tests/unit/coursewareAuthoringRunner.test.ts tests/unit/aiCapabilities.test.ts
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep 'S2 材料库：导入检索、可携带引用和另存为隔离$'
```

真实应用分别通过路径、@、附件或粘贴提供 PDF、DOCX、PPTX 教师材料（对话框不是必经），每类核对整体结构、正文、适用的表格/公式/图示、原图与出处，再由软件内创作流程实际消费；覆盖图文 PDF 和扫描页的必要内容读取，保留文本材料回归及相关失败反例。可以复用同一课题的三种材料，但不能由开发者在软件外预先提取成文本后冒充原格式通过。记录实际读取事实；新格式专属测试随实现建立后补入入口，不为本节点重复三CLI完整矩阵。

## 回退与交接

交付材料合同、已支持格式和缺口、片段读取/缓存规则及真实样本证据。044消费读取事实，022补齐生产格式/引用/删除控制；回退不得删除原件或已进入课程的素材和引用。
