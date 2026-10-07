# R-S4 低项覆盖补审

结论：固定 integration `6f00b84732c3a10631d63b8b8286f2198b5d1457` 仍有五项未收口事实，另有日志分页规范化已由 Root/H 接续。下面是既有包的覆盖缺口，不是新增审计或重新派发建议；I/G/H/X 的滚动候选可能在此 cut 后关闭它们。没有依据把这些全部定为当前可用性 P0/P1。

本 reviewer 未参与下列被审实现、设计落地或测试断言。此前本人实施的 TE04/TE05/TE06 全部排除，也不引用此前报告对这些包的签收。本次只读取固定 Git 对象、主目录计划及既有 R-S 报告；没有修改产品、测试或执行 trace，没有运行测试、构建、真实模型或 GUI。原50主题、新131记录、旧641来源主张及20补充项是来源、候选、保留及处置，不相加作为缺陷数。发行继续暂停。

## 最短剩余清单

| 既有项 | 固定 cut 的直接证据与剩余结果 | 归属及最低收口证据 |
|---|---|---|
| OPT01 / O06 终态保留 | `ExecutionEngine.ts:797–798,2279–2285` 已移除 active/displayBuffers、释放文件分页、停止 Gateway；`DocumentToolGateway.ts:574–583` stop 仅清 images/cursors，handles、callDigests、runs 仍保留。`HostToolServices.ts:172–179,524–540` 的 runs/results/jobs/reissuedImages 也未见终态清理。`ExternalMcpService.ts:380` 已清已送达 operation.result，但 `operations` 摘要仍累计；切空间只重置 children（262），operations 跨 run 保留。O06 不能据这些已有释放声称全部完成，也未测内存/卡顿幅度。 | 沿 I/G/H 既有 owner。只需对已结束 run 的不可再用目标及已送达摘要给实际结构计数/处置；保留正式 lookup、unknown、pending、未送达回执真正需要的数据。不是要求删除全部 maps、增加 TTL 或数量停止门。维度是维护/保留成本，尚无当前用户性能故障证明。 |
| O05 公共磁盘协调 | `DocumentHostService.ts:309–335,450–451` 已有真实 observeFile/reconcileFile 和磁盘版本核对。固定 cut 对 `src/core/tools`、`src/main/workbench/execution`、`src/main/workbench/external` 的 `observeFile/reconcileFile` 直接消费检索只有无关文件搬移观察；公开 AgentFileTools/ToolCatalog 未接同 owner 的采用磁盘/保当前/合并入口。GUI 已有协调，不能写成产品永久死锁；缺的是 Agent 同任务同路径接续。 | TE03/K05/I 既有接线。最低一条真实磁盘外改→公开 Agent observe/reconcile→同任务 save 的直接反例，验证保人工结果及冲突版本。GUI 或队列恢复绿例不能代替这一属性，不要求新 force 平台。 |
| O18 三个便利输入子域 | `WorkbenchServiceTools.ts:25` 仍 `z.url()`；`publicHttp.ts:83–86` 仍 `new URL(raw)`，裸公网域未归一。`courseAgentCapabilities.ts:75–88` 保持五组精确枚举、semanticVersion、limit/ID 校验，未见本项独立处置结论。Flow 当前 `schema.ts:37,43` 明确正文宽度 content-width/wide/full-width 与页面 fluid/reading；直接 Flow consumer 未见 auto/fit-content 的对应持久语义，不能把 CSS 词形便利直接变成新布局模式。 | OPT02/I 的既有候选处置。分别记录：支持的裸公网域是否可规范化；五组 enum/版本/limit/ID 是否已有具体失败；auto/fit-content 在当前 carrier 是否有已支持且等价含义。没有等价语义的项可依据现合同关闭为不支持/反证，不批量删除版本门，也不扩新布局能力。当前是便利性/候选处置缺口，不是所有网页或 Flow 不可用。 |
| A09 一次实际生成交付 | `scripts/generate-contracts.ts:26–82,196–210` 正确消费 V10/V3 schemas、声明 API5 runtime source，并在 main 内只生成一次后选择 write 或 check；复用旧 R-S 对同实现的内存语义检查，不重跑。然而固定 cut 的 `artifacts/contracts/contract-manifest.json` 仍列 V9/V2/component-v4 原产物；源码生成器正确不等于 tracked 制品已生成。公开 V10 validator 的切换已在前报告审阅，本次无新增 finding。 | A09/I/RootE 按共享 Schema 最终相关 cut 实际生成一次，直接查看 manifest 的 protocols、当前 schema 名及退役产物处理即可。不要生成后紧跟同义 --check；本报告没有执行生成，也没有断言安装产品消费了旧制品。 |
| S09 公共 PPTX 实际 producer | `renderer/project/pptxCourseCreation.ts:31–50` 的人工路径真实执行 parsePptxImport→planPptxImportTransaction→CourseV10Driver→archive，并保源输入。固定 cut 的公共 DocumentDeliveryTools/DocumentDeliveryService 仅 save/export；在 core tools/main/workbench/shared workbench 中没有 `createCourseFromPptx/pptxCourseArchive` 公共导入 consumer，只有 read-pptx 字节读取。材料提取和导出 PPTX 均不能代替导入可编辑课件。 | S09/X/I 已有公共 consumer。最低一份含文字/图片 PPTX，经公共入口调用同 converter→V10 保存重开、保原件/可解析页与诊断，且 ACK unknown 不重导。不是要求重写转换器。 |

## 已覆盖与正在接续，勿重复派发

- O17 辅助 metadata：`ExternalMcpService.ts:346–371` 已将可选非空字符串关联票据与业务 schema 分开；中文/超200字符票据转内部摘要令牌，非字符串不冒充操作身份，read 自编号。原 ASCII/长度拒绝分支已消除；未知业务输入仍走原 schema。本次无新增 finding，也没有声称外部模型兼容已实测。
- O07 日志全文：`ComputeJobService.ts:210–211,247–249` 已保 backend 实际 stdout/stderr 全行及全文，backend 已截断会明确标示；本地原前100行/每行2000字符截断已消除。真实 backend 的产生日志能力仍受已有环境条件限制。
- O08 日志 page：固定 cut 的 `WorkbenchServiceTools.ts:15` 和 `ComputeJobService.ts:269–274` 仍双重拒 limit>100。Root 已明确 H/I 正在按页规范化，本项仅列为待合接续，不能再派重复 writer 或要求取消分页。
- A09 的生成器语义、V10 validator、显式历史检查边界复用 `r_s/R_S_REVIEW.md` 的未参与实施证据；本次只补 tracked 制品未更新这一交付区别。这里没有将源码候选、生成文件、近层检查、真实产品呈现或 Owner 接受混为一层。

停止条件：上述各项由既有 owner 给对应直接 consumer/处置或最低证据后定点关闭；无关已绿证据继续复用。本补审不要求全树红债清零、再跑完整矩阵或发布。
