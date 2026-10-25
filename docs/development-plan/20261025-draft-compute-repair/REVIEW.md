# 属性草稿与计算测试载体独立审查（2026-10-25）

审查者：`/root/baseline_review`。未参与产品／测试实现；只读核候选相对本轮起点的实际增量、直接 producer／consumer、正确断言、原始结果及报告，仅写本文件。未运行测试、浏览器或类型检查，未改产品、测试、用户作品及历史基线。前轮未变有效证据复用。

**最终结论：本包已审产品、测试、直接行为证据及报告边界通过独立审查。CA246 的 Root 原环境、属性两完整文件、集成主类型及真实 RightSidebar 修后同链均已闭合；曾发现的迟到 ACK／新 IME 阻断已修。未发现剩余本包阻断，不据此签全仓、全部控件或物理 OS 输入法验收。**

## 1. 范围与起点

Owner 已授权修好 Python 开发测试载体、核实三条属性草稿失败并修真实产品问题；没有新增 UI、模式、默认操作路径或 commit／push／发布授权。本轮以 `output/test-runs/draft-compute-repair/start/files/` 的接手事实为准，未把候选相对 HEAD 的全部历史 dirty 算入本包。

属性白名单是三个原产品文件、一个直接测试文件及 `DRAFT_RESULT.md`。原 Boundary／registry、store／DocumentSession、保存服务和前轮格式实现未改；没有冻结整个属性面板、清空旧输入以消除红灯、自动取消原 owner 或增加第二 writer／草稿库。

## 2. Python 原文件已在 Root 通过

`auditAllExportsDevCompute.test.ts` 的增量仅在该一次性测试的真实 Vite `createServer` 中增加局部 `configResolved`，将合并后的 `server.watch` 置 null。该用例不验收文件热更新；全局 Vite／HMR、生产计算源码和原资源／请求策略未变。

原 fullName、60 秒上限、实际 TypeScript module Worker、Python 42 及四处计算／策略断言全部保留：结果 exitCode=0／stdout42／stderr空／未取消；开发环境模块实际被请求；无关开发路径拒绝；正式本地映射不获得开发模块路径。

候选完整原文件 **1/1、0 skip、12,599ms**，实际观测 resolved watch=null、NoopWatcher、getWatched={}。候选 ignored setup 的 `vi.mock('vite')` 仅调用 importOriginal 的真实 createServer、允许 junction 依赖目录的 realpath 并落观测，不替换服务、Worker、Python 或策略结果。该适配只属于候选环境，不能独自签 Root 完成。

Root 集成后沿原 Vitest 配置、没有上述候选 setup，原完整文件 **1/1、0 skip、4,815.6051ms，success=true**，见 [root.json](../../../output/test-runs/draft-compute-repair/compute/root.json)。因此本轮修后的 Root 正式测试载体已通过；前轮 60 秒失败仍保留为原样本，未改成通过。本轮不重新签安装包、所有计算任务或全仓通过。详见 [COMPUTE_RESULT](COMPUTE_RESULT.md)。

## 3. 三条旧草稿失败的语义裁定

直接 producer 是 `usePropertiesAuthoringBinding` 的 JSON 目标键 `[documentId,epoch,root,surface,state,selectedIds,global,fieldIdentity]`；真实入口沿 RightSidebar／PropertiesTab／Router／NativePanel 到 Boundary 与各字段。RightSidebar 的 visited／hidden 子树常驻，不能以“切标签总卸载整个属性根”豁免生命周期。

既有 Boundary 策略是普通换目标显示新控件，原 raw／已接纳 ACK 在 registry 停放；仅真实 composition 保留原 DOM 至 compositionend。flush 对卸载 owner 不重放命令，返回 true 不自动表示 raw 已写入或丢失。不能为旧测试恢复冻结旧面板，也不能只翻转 flush 预期。

| 原例 | 本次测试维护及保护目标 |
|---|---|
| dirty target／refuses retarget save | 原 `'first'/'second'` 不是正式可归属目标键，且强求非 IME 原 DOM。现用真实 JSON 身份，核 B 活控件、A raw 仍在原 binding、不调用 A／B commit、返回 A 恢复、在活 A Esc 取消。没有以卸载清掉 raw 代替保全 |
| formula target switch | 原例对已断开的 A input 操作并要求停放后 flush=false。现核 B 仍原公式、A x+1 登记和 Main durable authoring record、Main 全实例及 History 零变，回活 A 恢复／取消。原不误写邻公式的目标保留 |
| IME／original canvas owner | 新增真实 blur→blur-pending 再换选，compositionend 的最终中文必须留在 A binding；合成期间保同 DOM，结束后 B 显示原文，回活 A 恢复最终中文并 Esc 取消原 A owner；Main 全实例及 History 零变。不是将断开的旧 input 当作当前控件 |

三条 fullName 保留。正常数值／公式停放另有修前真实 Sidebar 证据；文字同链则确有实际丢稿，不能因旧测试假设过期而将它豁免。修前 B admission 红例与真实 Sidebar 的 A 最终中文丢失分开记录，见 [DRAFT_RESULT](DRAFT_RESULT.md) 和 [DRAFT_PATH_RESULT](DRAFT_PATH_RESULT.md)。

## 4. commit 结果、raw、ACK 与取消

原断点是 begin 失败仍返回 void，commit 又经通用 run 吞掉失败／Promise，而 Textarea 在调用前已将 baseline 设成 raw／phase 设 idle。因此出现“flush=true、Main／History 未写入、raw 却不再登记”。本轮消除的是该错误成功合同，而非把 B 自动接到 A 的 owner。

- `textCommands.commitEdit(text?)` 核原 textSession、当前选择、已被原 owner 接纳的正文，返回原 update／writer 的 Promise；失败不提前清 textSession，ACK 只退休同一份已提交输入，新输入或新 composition 保留。
- Textarea 将本次 raw 传给原 callback；同步 void 本地 stage 仍合法，Promise 等真实 ACK。拒绝时 raw／baseline／原 owner 保留；pending 暴露给原 registry 并可 resume，不因重挂重复提交，pending 期间 Esc 不提前清输入。
- `CompositionProfessionalEditor` 是直接同步 stage 消费者，外层“应用到作品”才等待正式 onEdit。本轮保留其合同和 UI／阶段路径，没有把所有 void 当失败。
- B 被原 A shared owner 拒绝时保留 B raw，不能假确认／误写邻对象或自动取消 A。现有回 A 完成／取消、再回 B 恢复和应用路径保持。

独审曾阻断一个候选增量：A pending→B→A resume→新 IME 刚开始但 raw 尚未变时，旧 ready ACK 可将新 phase 写成 idle。最终 restore 回调加入当前 composing／blur-pending 保护，binding 也不在新 composition 中退休 textSession。新增单一反例核旧 ACK 后仍 composing、flush=false、换选保原 DOM，最终中文可回 A 恢复，仅调用 A 的原取消 callback，旧 commit 只有一次。没有用更长等待或全局暂停绕过它。

## 5. 直接证据与当前收口状态

[after-final.json](../../../output/test-runs/draft-compute-repair/draft/after-final.json)为两个完整文件 **44/44、0 fail／skip**：componentPlatformProperties 30（原 26＋新 4）、未改 propertyDraftOwnership 原 14。首轮 43/43 和修前红例 raw 保留，不能覆盖历史失败。新增四例分别证明：

1. B 拒接纳时 A／B raw 同时保留、Main／History 零写；回 A 取消后 B 恢复真正提交，一 History，GLX 保存后独立新 Host 完整模型冷开一致。
2. 延迟 ACK 时 flush 未提前结束；拒绝后原 baseline／raw／owner 保留，重试两个 proposal 只有一条成功 History，邻对象不变。
3. 同步本地 stage 正确接纳，一次 callback，未改外层应用语义。
4. pending 停放／恢复后新 IME 不被旧 ACK 清成 idle，原 DOM／raw／取消归属保留。

这些是 mounted 控件／Bridge／真实 Main 与保存等各自明确的证据；新迟到 ACK 相位例本身为控件 owner 协议级，不能冒充 Windows 物理输入法。

Root 已按白名单集成，提供执行记录：`npx tsc -p tsconfig.json --noEmit --incremental --tsBuildInfoFile output/typecheck-cache/main.tsbuildinfo`，session 88947，exit 0。本审查者未重复运行类型。

Root 当前集成代码下同一真实 RightSidebar 浏览器链已补：[root-after.json](../../../output/test-runs/draft-compute-repair/draft-browser/root-after.json)为 **完整 1/1、0 skip、约 10.54 秒**，[facts.json](../../../output/test-runs/draft-compute-repair/draft-browser/root-after/facts.json)明确 sourceRoot=`D:/果铃工作台`、osIme=false。探针挂当前真实 Sidebar／Nodes／属性根，共用当前 Store／Runtime／Bridge 和真实 Main 文档；图层与 Nodes 为真实浏览器点击，引发原 textarea blur，composition 由 DOM 协议事件驱动，不是直接 store 换选替代该时序，也不是 Windows 系统输入法。

新增 raw 已独立核对：合成期间原 A DOM 保留；结束后原 shared owner 仍是 A、composing=false，A 最终中文 raw／原 baseline 仍在 A binding。B 首次 flush=false，A／B 两份 raw 均在；分别回 A／B 能取回正确内容。沿现有 Esc 取消 A 后，返回 B 恢复，原 flush／drain=true；最终 Main A 为原文、B 为新正文且 frame 不变，History=2（先前公式 1＋本次文字 1），pageerrors=[]。数值与公式的停放／恢复／持久 raw 前段也实际到达；修前失败 raw 未覆盖。

该包独审收口，不要求重复已有效范围。产品／正式测试没有在这些验证后继续改动；浏览器及自有进程已停止。未 commit、push、发布或修改用户工程，原历史基线继续保留。
