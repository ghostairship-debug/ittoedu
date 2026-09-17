# 1.8 真实使用修复集成记录

2026-09-12。对应 [修复方案 G1–G12](../R18_USER_EXPERIENCE_REPAIR_PLAN.md)。**本轮 1.8 开发和受影响工程验证已完成，形成 engineering candidate。** 下文按各门的实际载体记录证据，保留首次失败、修复复验及未验边界。既有 B0/B1 未提交工作保留，所有真实课件操作使用隔离副本。Owner S3、accepted 标签和正式发布尚未执行。

## 交付行为

- 背景目标、能力卡和正式背景命令共用有效域；明确“本页背景”优先于默认段落选区，未指定背景属性保留。快捷操作失败能回到同一原生任务，基础素材/背景能力保持可发现。
- 补齐已有图层排序、保留原对象的复制、选中说明后新增插图。生成请求携带宿主捕获的 strict 窄动作，排序/复制复用已有正式命令；新增图片绑定真实父容器和 after 锚点，不放开整页写入。
- 失败续轮原子交接观察与请求；结果在原生确认接收前保持待送。停止、人工修改、草稿和工程替换继续阻止旧结果写入。询问状态保留当前目标/预览，明确继续恢复实际编辑目标与结果。
- Flow 合法输入正常失焦应用，画布内外空白随后清选；取消、无效公式与 IME 延迟遵循原草稿 Owner。Native 表格末格 Tab 增行作为一次提交，并同步扩大框架，避免新增行被裁掉。
- V9/Published V2 增加 strict 可选 `layout.widthMode`。新 Flow 默认 fluid，旧缺字段保持 reading；编辑、试运行、整课预览和 HTML 共用宽度和媒体布局。全局正文横幅可设稿纸定位，教师控制器仍用视口定位；预览栏移至内容区之外。
- 聊天保留公开消息、候选说明、实际应用结果和用户补充/回答，移除原生事件列表。按原生消息身份合并增量，配置可折叠；错误使用可读说明，原始日志继续保存在本地。
- 真实开发宿主验证发现图片 URL 在 StrictMode effect 重放后被提前撤销；Flow/Spatial 改用同一 effect 创建与释放 URL，保留严格图片解码检查。

## 门与证据

| 门 | 本轮证据与边界 |
|---|---|
| G1 | 背景与已有文字/公式/换图入口保留原证据；D07/D08 的8种载体及 I03 的 Slide基础态/命名态、Flow嵌套正文、Spatial世界已从真实 snapshot 经正式事务、Undo/Redo和归档重开验证。T04沿已有段落编辑追加完整例子。新动作26项、旧拒绝路径6项通过，另有2项strict合同检查；图片解码在该组模拟，不冒充真实模型/视觉或全部60项执行。 |
| G2 | 原 Mixed/Spatial 工程 Flow 页、原指令、Codex Luna/medium：实际狗图、一次正式提交、保存、Undo/Redo、重开和离线 HTML 均通过。详见下表。 |
| G3 | 素材发现修复后真实复验通过：首轮选对已有狗图，快捷路径被受控拒绝；记录确认诊断 delivered，第二轮改用 `owner.background`，复用同一 asset 正式提交。保存、Undo/Redo、重开与离线 HTML 均正确。第一次错选1×1原图仍保留为失败。 |
| G4–G5 | 任务/桥接/Main 目标测试覆盖失败待送、记录失败重试、部分提交、显式继续、状态询问、Stop、内容变更与真正 stale。真实 UI 失败注入链通过：修复一次、无进展停止、取消、人工撤销、再次发送、Save As 会话隔离、迟到结果零写入。 |
| G6 | 原问题工程真实纸张空白和外围空白：合法输入应用、选择清空、一次必要 History、Undo/Redo，无修改时无空历史。 |
| G7 | Native 表格 blur/Esc/Tab/末格新增，正文/页面浮层/全局浮层公式的合法失焦、无效输入保留、取消和保存重开通过真实窗口；IME 用聚焦 DOM 组合事件检查，没有冒称物理输入法测试。 |
| G8 | 原工程验收副本，实际内容宽 1603/1203 px 的编辑、试运行、预览、HTML；正文每行框、媒体和横幅相对坐标差≤1.5 px。截图已查看。最终副本真实重开后1203 px内容区、四个正文行框及稿纸横幅坐标与保存前一致。 |
| G9 | fluid 在 1280×720/1440×900 的滚动、200% zoom、resize、恢复、互动状态、保存、Undo/Redo、HTML 通过真实 E2E（5.4 分钟）。旧缺字段按 reading 解释；fluid/旧reading 实际 DOCX 的 A4 页框、正文/横幅、图片关系与页内绘图解析通过，warnings为空。 |
| G10 | Codex/Claude/OpenCode 三 CLI 四份完整实际记录逐原生消息身份核对、挂载 DOM 和复制文本一致；另有本轮真实继续/提问链。没有用最后一段摘要替代完整公开内容。 |
| G11 | 正常提交、失败后修正、提问回答与历史链实际可读；聊天没有原生事件入口、机器候选或原始异常。最终G3候选/结果中文清楚，未再公开报内部版本计数。Codex公开摘要仍可能用英文和技术术语；忠实保留原文，不伪造、删除或另调模型重写摘要。 |
| G12 | 宿主结果决定应用状态。下面分别记录首轮、修正、终态与验证干预，不以模型自述或任务完成标记证明图片正确。 |

## 真实 CLI 样本

| 样本 | 实际配置 | 结果、时间与修复 |
|---|---|---|
| G2 原背景请求 | Codex 0.154.0；gpt-5.6-luna / medium；服务档未从记录确认 | 同任务 2 原生回合，约 102.4 秒至正式完成。首候选 `fit:cover` 被真实拒绝；第二轮改 contain，复用同一张 1536×1024 狗图，一次 commit。属于参数修正后成功，非首轮通过。 |
| G3 首个受控样本 | 同 Codex/Luna/medium；开发宿主在首次 `media.apply` 准备时注入一次可恢复拒绝 | 诊断送达、基础命令兜底机制执行；图片选择错误，未通过内容验收。没有再次生成图片。此前开发宿主 URL 解码失败发生于模型启动之前，单独保留。 |
| G3 素材发现修复后 | 同 Codex 0.154.0、Luna/medium，同已有狗图与请求；没有提高模型/强度 | 约57.5秒完成，2原生回合、1次受控拒绝、1次正式commit。首轮`media.apply`选择正确a1；第二轮`owner.background`复用原1536×1024狗图；没有生成新图片，保存/Undo/Redo/重开/HTML通过。该时间不与G2生成图片时间直接比较。 |
| OpenCode 提问/编辑 | openai/gpt-5.6-luna / medium；记录未确认 resolvedModel | 第一轮只读讨论约 20.1 秒、零写入；第二轮约 43.9 秒，同原生会话，一次标题文字提交，保存与 Undo/Redo 正确。原生内部发生脚本引号修正，不冒称零工具修复。 |
| Claude 提问/编辑 | Claude CLI 2.1.268 的实际本机 default 路由为 deepseek-flash[1m]，强度默认 | 第一轮原生提问后由验证操作回答，零工程写入；第二轮同原生会话，一次正式修改当前命名状态标题并保存。不是 Fable/Opus 模型证据。验证脚本最初错误地只检查基础态，随后按冻结目标独立核对正确；该样本未执行 Undo/Redo。 |

G2 原始验证脚本在已完成提交/保存恢复后，被离线教师控制器的内部 button actionability 定位阻断；改用真实鼠标点击该按钮中心后完成 HTML 验证。没有改产品输入路径、强制事件或再次调用模型。Claude 提问的验证操作延迟约 135 秒，包含在用户等待记录中，不计作纯模型生成耗时。

## 可复核制品

- `../../../output/playwright/r18-ux-20260912/background-2026-09-11T18-39-53-963Z/native-records.json`（历史链接目标未保留）、`../../../output/playwright/r18-ux-20260912/offline-2026-09-11T18-53-36-036Z/result.json`（历史链接目标未保留）。
- `../../../output/playwright/r18-ux-20260912/native-fallback-2026-09-11T19-04-28-312Z/native-decisions.json`（历史链接目标未保留）。
- `../../../output/playwright/r18-ux-20260912/native-fallback-2026-09-11T19-22-45-492Z/result.json`（历史链接目标未保留）、`../../../output/playwright/r18-ux-20260912/native-fallback-2026-09-11T19-22-45-492Z/native-decisions.json`（历史链接目标未保留）。
- `../../../output/playwright/r18-ux-20260912/flow-2026-09-11T18-41-35-491Z/measurements.json`（历史链接目标未保留）、`../../../output/playwright/r18-ux-20260912/flow-2026-09-11T18-42-39-771Z/measurements.json`（历史链接目标未保留）、`../../../output/r18-089/fluid-2026-09-11T19-01-50-381Z/preview-1440x900.png`（历史链接目标未保留）。
- `../../../output/playwright/r18-ux-20260912/opencode-question-2026-09-11T19-00-08-034Z/result.json`（历史链接目标未保留）、`../../../output/playwright/r18-ux-20260912/claude-question-2026-09-11T18-54-06-222Z/verified-result.json`（历史链接目标未保留）。
- `../../../output/playwright/r18-ux-20260912/leaf-evidence/g7-table/result.json`（历史链接目标未保留）、`../../../output/playwright/r18-ux-20260912/leaf-evidence/g7-formula/result.json`（历史链接目标未保留）、`../../../output/playwright/r18-ux-20260912/leaf-evidence/g8-reopen/result.json`（历史链接目标未保留）、`../../../output/playwright/r18-ux-20260912/leaf-evidence/g9-docx/docx-verification.json`（历史链接目标未保留）、`../../../output/playwright/r18-ux-20260912/leaf-evidence/g10-replay/full-record-replay.json`（历史链接目标未保留）。必要叶子结果已汇合，完整私人原生日志不进入仓库。
- `../../../output/r18-ux/failure-injection-2026-09-11T19-14-47-658Z/after-eighth-send.json`（历史链接目标未保留）。新增回归先证明资源事务 Undo 后 CourseAuthoringSession 残留已删除 ID，再修复为后端有效 selection；scene/global 两例和最终 E2E 均通过。
- [G1 窄合同](2026-09-12-r18-g1-selection-contract.md)、[真实目标与正式事务用例](../../../tests/unit/generationSelectionActions.test.ts)。独立 Reviewer 核对单次动作消费、父容器、同 owner/plane、命名态及晚步失败零写入，无阻断发现。

Flow 同宽副本显式切换 fluid、将共享横幅改为 paper；横幅原框架 x=40 与正文边距36保持4 px固定关系。为避免原横幅 y=12 与标题重叠，在验收副本插入空首段；这是明确的内容准备，未静默修改原文件或其他 Surface 的共享框架。

## 有效检查与未验边界

最终汇合检查：`npm run typecheck` 三套检查通过；G1合同/行为与素材发现合计32项通过；完整提示预算/卡片发现/无关能力增长7项通过，13项因具名过滤未执行且不计通过；最新 Renderer/Electron 构建通过，Player 使用本轮已验证且未被后续改动影响的构建。能力制品最终生成72个文件，索引16115/16384字节。Schema生成和其余聚焦检查覆盖实际桥接、背景正式事务、strict宽度、Flow/表格/公式、三CLI消息投影与URL生命周期。各批测试有重叠，不累加成唯一用例总数。

素材复用热输入只增加有1536B上限的真实名称/类型/尺寸及别名，完整库存仍按需读取。去除重复说明与同值能力版本后，旧普通图片编辑完整提示的12KiB门恢复：Codex12096B、Claude12279B、OpenCode12281B，阈值未改；这是固定输入预算，不是所有任务的总模型上下文或整体速度承诺。

旧证据只按未变依赖复用；未重开 050/051/052/083/087 整批，也未重复三套付费图片矩阵。原“100 passed + 24 conditional skipped”保持原义；60 项/296 变体是定义，不代表已经执行或达到某覆盖率。

本轮没有物理触控/输入法、完整 29 页逐页教师视觉复核、本机 Word 排版验收或 Owner S3 签署。这些界限与本轮工程开发结论分开，不由任务板或自动化代签。
