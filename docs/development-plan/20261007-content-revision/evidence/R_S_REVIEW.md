# R-S 普通叶滚动独立 review

## R-S1 结论

Reviewer 未参与本批实现、方案落地或断言编写。基线 afc65c9e；按实际提交 diff、直接 producer/consumer 和独立 T 定义审阅。发行暂停。review 结论与测试运行、GUI视觉/互动、Owner accepted 分开。

TE09 ae84a390、TE01 149a5555/695f41ae、TE02 6487052c/de66da10、TE06 aff67a60/fb1810eb 的普通叶代码审查目前无未关闭的新增产品 finding。G f81acc7b/e448aa3e/eea4d5c2 查到一个具体事实压缩缺陷，已由 3c105de4 修正并通过原失败的最低成本纯函数复现。此结论不覆盖 G 正式 writer/History 迁移（归 R-A），也不表示未运行的独立 T 或真实 GUI 已通过。

## 已关闭 finding：供应商工具名导致长回执丢事实

- 原位置：eea4d5c2 的 src/main/workbench/execution/ExecutionContextProjection.ts:58；第79-90行 receipt 提取分支。直接 producer 是 OpenAIChatProvider.ts:309，保留 assistant.tool_calls.function.name 的 provider spelling；ExecutionEngine 原第2237行原样存 assistant。
- 原行为：project.apply 实际 wire 名是 project_apply，而 contentApplyFact/saveFact 只接受 project.apply/project.save/file.save。大回执压缩按 assistant 名取事实，因此 commit/usability/diagnostics/save 被漏掉。
- 用户影响：长任务模型上下文不能可靠看到已提交但 unusable 的事实及诊断，容易给出错误的完成判断或失去继续修复依据。正式记录仍在，但当前压缩视图丢失本次要求保留的事实。维度：用户可见事实错误，非正式数据损坏。
- 最便宜复现：node --import tsx 调 projectExecutionContext('review', messages, 1, 0)，assistant call-1 分别用 project.apply 和 project_apply；同一 tool JSON 是 kind:read，data 包含 commit:committed、usability:unusable、delivery:not_requested、diagnostics:[error/cannot run]、insertedIds:[] 和9000字符 padding。原输出 canonical receipt 含三项事实，wire receipt 只有 kind:read。无模型调用，无测试断言或产品文件改动。
- 修复 3c105de4：对三个实际 receipt 工具用既有 modelToolWireName 建立反查；不泛化猜测任意 authored read 名。实现相关变化后原样复跑一次，两种名称都保留 commit/usability/diagnostics。该 finding 关闭。独立 T 若补 case，应使用 provider 的实际 assistant 名；不用重跑无关矩阵。

## 保留行为与当前证据缺口

| 普通叶 | 实际源码核对 | 最窄剩余证据 |
|---|---|---|
| TE09 | 删除12个按钮 UI门；readTeacherControllerConfig 不截断数组，实际 guoling.navigation consumer 仍由原属性 owner 修改。母版 initial/thumbnail 通过既有 nullable state writer，不新增13动作合同。 | 实际属性 UI 从12添加第13个，并在真实 Player 点第13按钮、save/reopen；母版设初始/缩略图及 undo 的最近层行为即可。未运行，不能写通过。 |
| TE01 | source/JSON 草稿按 bridge/document/epoch/scope 绑定；blur/IME结束自然应用；未改 source 捕获可释放；workspace 非改文件和二进制保留；prepare/preserve/restore 交现保存 consumer。 | 独立 advancedVisibleDraft 第一条覆盖实际V10 source+object JSON、换选择、保存冷开；尚无本文认领的执行输出。真实 Ctrl+S/关闭/冷开由 TE03 汇合证明，源码实际运行另证。 |
| TE02 | 数值输入改为保存 raw 的 text/spinbutton，不再空值转0或无声 clamp；chart 用 draftRef 取最新值，自然 blur/Enter/删除提交；dirty registry 保面板卸载输入，并按实际 binding 匹配恢复。 | propertyInputRecovery 的 '-'、空值及 IME近层case；chart 自然结束+一次 canonical+undo及非法 cell保稿，应有实际V10 consumer证据，不能只接受 registry mock。尚未认领新测试通过。 |
| TE06 | 材料选集带 extractionVersion；captureMaterials 在发送时取当前课例选集并查版本/片段，课例切换明确失败；刷新更新列表、删材料清理选集、过期材料提示重选。 | U/ExecutionAssistant 必须实际消费 captureMaterials 并进入提交材料字段。采样的 integration 仍只看到 host prop producer，Assistant尚未接收该prop；这是已派发汇合未完成的证据缺口，不把叶子 port当最终完成。最便宜一条选择片段→实际 submit payload→共同material reader事实即可。 |
| G note/facts | 未定位的 advisory note 引用给诊断，provider/internal callId映射归同源；task.note失败不降级完成，诊断仍显式；修正同path读取可解除原失败，unknown副作用分支仍先保留。事实helper搬迁不改变 document-operation/保存回执合同。 | g20TaskNote旧 toThrow断言与Owner advisory诊断目标冲突，可有依据地更新到保内容+diagnostics；不得把新语义放宽为 task.note 可证明任务已完成。executionOutcome/压缩原case的结果由统一E记录。 |

## T03 半截 source 新断言需与有效合同对齐

独立 advancedVisibleDraft.test.tsx 第二条用 compositionStart 保留 `export const value =`，然后 cold Bridge restore 清 composing，最后期望 prepare ready:false。实际 source prepare 只检查缺入口/UTF-8等可保存属性，CourseV10Driver检查 schema/resources/professional data，不把源码语法当存储门。因此该断言可能失败。

但 TE01 精确 WORK_PACKAGES 条目明确“当前有效稿与未完成JSON、缺入口、IME、新文件名”“保存源码与运行通过分别表达”“源字符串允许保全”。不能仅凭新增断言反推需要源码静态语法阻断。应由 T 依据原失败/有效合同澄清此case：恢复原字符和无自动副作用应保留；后续显式prepare/save能保存源码与运行诊断分开证明。本文不把它定为产品blocking finding，不设计新语法门，也未修改断言。

## 执行与范围

本轮仅只读源码/git/文档和上述纯函数反例，写本文到 reviewer 自己 worktree。未运行付费模型、完整矩阵、构建、真实GUI或独立T文件；未修改产品与测试。后续 R-S2/R-S3 普通消费者及 R-S4 A09 范围待 Root 指定，旧未变证据复用。

## R-S2 / R-S3 普通消费者与 R-S4 A09

后续派发审阅：maintenance 735972ca/8dff0b57；TE07 9c58e329/8ff1717b；TE08 eca6492c + I fa3a872d 的实际 consumer 接口；S07 dc781bda/da48e7fd/786af45a/1057f62b/935f1673/5141e6b0；TE05 8e715dba/08c3604f。核对 Root 给定 integration c2dbcd1f，读取期间 integration 继续滚动；本节只认领上述提交与明确指出的实际接线。未介入 R-A3 对正式 writer/资源 owner 的结构审查。G 3c105de4 未变证据复用，未重跑。

### 当前用户行为 gap：TE05 新请求与现 Schema/文件 owner 未汇合

- WorkspaceFilesTree 新提交对所有 copy 均发送 sourceVersion，包括默认 disk；c2dbcd1f 的 src/shared/workbench/workspaceFiles.ts:97 copy request 仍 strict 且没有该字段。
- 最便宜证据已运行：纯函数 workspaceFilesRequestSchema.safeParse 同一个 type:copy、workspaceId、operationId、sourceEntryIds、targetDirectoryId。原请求 success:true；加 sourceVersion:disk 和 current 均 success:false，unrecognized_keys:[sourceVersion]。无文件修改或模型调用。
- 因此不只是当前稿功能尚未交付：GUI 对话框的原默认磁盘复制也会被拒绝。这是已派发 I 合同/文件 owner pending join，直接影响现有用户操作。相关候选汇合前需由原 owner 接回受支持请求并保 disk 行为；无关工作继续。
- AgentFileService 当前原第334-348行仍把 flushFirst=true 当先保存要求，且未消费 sourceVersion；WorkspaceFiles 当前也尚无 current snapshot 路径。这与 TE05 工具说明的新语义仍未汇合，不能把新文案当行为通过。
- 最窄剩余证明：真正 dirty V10或文本副本，经 GUI/AgentFile current copy 冷开目标得到眼前内容；源磁盘仍旧值、源dirty，并保默认 disk copy。不用字节/Hash一般正确性门，不跑无关文件矩阵。

### TE06 / S07 材料链更新

- 原 R-S1 的选集 consumer gap 在本次采样已关闭为代码接线：ExecutionAssistant captureMaterials→submit.materials→ExecutionDesktopService snapshotSelectedLessonMaterials 已存在，重试/接续保冻结选集。T09 selectedLessonMaterialInput 尚无本文认领的运行输出，代码接线不是行为 accepted。
- snapshotSelectedLessonMaterials 复用真实 LessonMaterials manifest/identity/read；只展开选中片段、对应assets与出处，DOCX按段落、PPTX按slide、PDF按page；图示局部失败给缺口，保正文和原件；不生成 writable target。未见普通叶新增 finding。
- WebResearchService公开文件分支复用 AttachmentService.receivePublicFile，原件先保存、提取失败保 original，坏图片只给局部gap；取消会阻缓存返回和晚提取结果。MaterialTools共享注册复用现 immutable source owner，没有第二资料平台。
- 尚有真实 composition gap：c2dbcd1f workbenchToolServices.ts:142 仍 new WebResearchService() 不传 materials，实际公开PDF/Office返回 needs-material-reader；独立leaf测试自己传 materials 只证明叶子。交 I 复用现附件owner接入，之后一条 publicMaterialDelivery +实际同源admit/read 足够，不新增下载平台或收费模型。
- T09 real CPU canvas/真实PDF页图候选尚未执行，不能以DOCX、mock extractor或准备图片代替真实页图证明。图示准备和模型理解分开；缺运行环境只限制该属性。

### TE07 方法发现与独立参考文件版本

- ScopedSkillService去掉ASCII目录名限定后中文目录仍使用实际authorized root/realpath；没有增加授权。courseAgentMethodSkills增加研究/数据方法到已有生成目录。
- 读取某参考文件只钉该文件版本；SKILL.md或其他资料改变不再隐式废弃该参考页，当前文件改变且调用带旧version仍明确拒绝拼页。Bundled同样按注册文件独立版本，不猜任意路径，不执行脚本。
- 近层纯函数证据：两个 BundledSkillService实例，SKILL.md与bundle version不同，references/guide.md均为ABCD。先读AB，带其version在第二实例读CD，sameReferenceVersion:true。这直接证明所改属性，无磁盘写入。
- 旧 g20BundledSkillService 把 reference.version写死成bundle.version；旧g20ScopedSkills要求未携带文件version也因SKILL正文改变而抛 skill-changed，均与本轮明确目标冲突。T可有依据更新到当前文件的分页一致性/独立reference保留，不恢复全Skill版本门。中文目录和actual Gateway读取的最窄case尚待E统一cut执行。

### TE08 普通图片卡

- 实际 Card已筛 course-v10，使用当前V10 surface布局建议；替换只接受完整guoling.image实例，排除dataPath/文本range/flowLayout。点击时先prepare再捕获当前document/epoch/revision和原手动选区，插入course-surface，替换course-instance。
- Desktop service复用现resource/action lookup、同action unknown不重放，frame适配为V10矩阵；I fa3a872d接media.insert到既有 prepareComponentImageApplication/driver。这只是直接consumer核对，正式writer/资源/History关节归R-A3。
- 未见新增普通叶finding。剩余证据是实际V10 ready Card插入、完整图片替换、人工frame/effects保留、undo/save/reopen。现g20ImageResultCard第二case仍CourseV9Driver，不证明新入口；优先迁该聚焦case到真实V10，不需要重跑供应商付费链。GPT OAuth能力/计费验证另归已授权代表样本。

### A09 维护 review

- public validator从旧V9 schema/codec转为CourseV10Driver，共享真实可开包/资源/专业数据检查，只报告canOpen，不假称导出或运行通过。旧格式保原件并明确unsupported；旧case builder/benchmark/test已显式引用historical validator，不加V9生产兼容层。
- V10/V3合同生成复用正式Zod schemas；component runtime函数语义指向API5正式runtime.ts，未把JSON schema当运行证明。近层只在内存调用generateContractArtifacts，实际生成五项：course-project-v10、published-course-v3、component-definition、component-catalog、contract-manifest；project schema const:10，manifest protocols={project:10,publishedCourse:3,componentRuntime:5}。未写tracked artifacts。
- roadmap/preservation默认明确“历史检查未执行、不能证明V10”，显式--historical才运行原资料检查，函数consumer保留。普通叶无需历史矩阵前置；没跑不计通过。实际发行verify仍不在本次授权结论。
- 删除core/tools/spatialStructure.ts与spatialGatewayInputSchema已核基线git grep：planSpatialStructure/spatialReferenceHandles只在该死模块自身定义，schema仅由它消费。Renderer仍使用的spatialStructureToolInputSchema完整保留。源码/scripts/tests无被删symbol消费者，未见动态注册入口；不因old命名新增历史兼容平台。
- historicalSchemas仅维护尚有实际历史Renderer consumer的原schema，并标明历史；其余deprecation/无效表达式简化保持行为。当前T11 Main-saved V10 validator case尚未认领执行；E可选这一条，生成制品按相关变更准备一次即可，不紧接同义重验。
- 本维护范围暂无未关闭新增finding，可按所列边界推进；不表示整包类型债清零或核心产品完成。

### 本轮证据状态

只运行三类近层纯函数：TE05 request解析反例、Bundled reference分页、合同生成内存输出；生成输出没有写磁盘。首次generator探针误用manifest.json，按实际key contract-manifest.json纠正；首次reference探针用了仍在baseline的skill_image worktree，其false结果不计候选，改在已包含8ff1717b的integration读取实际候选后得到true。这些是reviewer探针选取纠正，不是产品失败或重试矩阵。

无产品/断言修改，无付费模型、build或GUI执行。当前需汇合的实际用户行为gap仅阻TE05 copy和S07公开材料该消费者；其余review可推进。真实T运行、载体证明与Owner accepted仍分别记录。
