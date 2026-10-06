# BASELINE_FIRST_V10 执行计划审查报告 — Muse Spark 评估（2026-10-05）

> 评估者：Muse Spark（本轮独立审查汇总）
> 评估对象：`docs/development-plan/component-platform-refactor/BASELINE_FIRST_V10_EXECUTION_PLAN.md`（约388行）
> 承载仓库：`D:/果铃恢复候选/20261005-authoring`
> 对照材料：AGENTS.md、docs/development-plan/README.md、ARCHITECTURE_CONTRACT.md、WORKING_PROTOCOL.md、原 EXECUTION_PLAN.md 中 N/L 目标定义、候选仓源码抽查
> 状态声明：本轮只研究方案，未执行回退、安装、构建、测试、真实模型调用或发布。027d588a 是 V10 前候选基线，尚未在本轮实机确认稳定。现有源码与未提交成果冻结保留。
> 方法：派出 8 路子智能体并行只读审查（基线保全 / 前端动机 / 端口状态链 / 并发写域 / 正式生命周期 / 验证切换 / N覆盖 / L覆盖）。其中“验证与切换”专项因子权限中途停止，验证深度部分受限，下文已标出。
> 证据口径：凡写“文档内确定”指可由计划文字+合同直接判定；凡写“需源码确认”指需读精确文件行号才能定，不计入问题数，不得声称已核实。

---

## 1. 总结论：修正后可实施，当前不可按原文派发，不需要调整路线

- 路线正确：先恢复 V10 前成熟前端，再沿既有解耦端口渐进替换为 V10，与 AGENTS.md 永久原则一致：最小充分、不全量重写 UI、优先复用、同一文档单一正式 writer、不建 V9→V10 转换器、保留用户原件。
- 不可直接实施：B0 保全缺可执行闭环；无保留清单无法证伪“保完整”；并发写域存在重叠、循环、遗漏 owner；正式切换退出缺文件级指派；N10 / N09 / L26 / L03 / L09 / MCP / 通用素材库无 owner 或严重不足；首条真实用户链被重型集成过度前置。
- 若按原文派发，最可能的结果是：多 writer 争用同一文件、菜单或专业控件静默丢失、保存丢尾字或重开失败、跨文档粘贴误写、旧 consumer 残留导致错写或污染。
- 已有 Astra 审阅结论不应限制本判断；本报告为独立判断。

---

## 2. 必须修正项（按阻断排序，修正前不派发）

1. B0 可恢复 Git 切片可执行化 + worktree 精确验证 + 独立 profile / 样本 / 端口隔离。否则丢当前成果、污染基线、动用户原件。
2. 补保留清单 diff 门 + 端口变更清单 + 菜单矩阵。否则“保完整”不可证伪，漏 consumer。
3. 补焦点契约 + IME 组词中用例 + dirty / single-flight / drain 时序。否则中文链虚验、保存丢字。
4. 拆 F0 为 ACK 边界包 + 收窄 P0b + 划定 player 文件切分 + X1 绑定独立重开门。否则全局回归、风格重写、交付尾断。
5. 明确三 slice 与根装配 owner + 解 flow slice↔view 循环 + 拆 ToolCatalog 锁 + 解 X3↔X4 循环 + 重定义首链去掉 R0 全量 + 补 DAG 缺边 + K0 分片清单。否则多 writer、死锁、空等。
6. 补 V9 桥/视图退出到文件 + 几何单主 + 捕获跨态校验 + 关闭→销毁边 + 回滚一句话。否则错写、误恢复。
7. 补 N10 + L26 混合 owner + D0 强制拆分 + N00b 转正。否则双写、混合交付、专业可用断。
8. 补 L03 / L09 / MCP / 通用素材库窄端口。否则完成定义不可证、外部链与素材链断。

---

## 3. 逐项问题

### 3.1 基线与保全

**P0-1 术语混用“稳定/成熟完整”与“尚未实机验收” — 计划缺陷，影响可运行/可交付误判**

- 计划章节：标题 L1，L11，L39，L217，L280；对冲句 L7，L22，L30，L40，L304，L351。
- 证据（文档内确定）：ARCHITECTURE_CONTRACT.md:3 §0 为待实现；:86 零降级总则；:137 未提交不得覆盖；AGENTS.md:41 以源码和可复现结果为准。
- 失败链：只记标题“稳定”→误认 027d588a 已验收→跳过 B0 参照与 §9 独立重开→§8.7 替换 Owner 版本时用不可运行候选替掉可用原版。
- 最小修正：全文统一为“V10 前候选基线 027d（有源码依据、本轮未实机验收）”，仅 E3 按 §9 通过后称“已观察候选”。owner：Root 撰写，Astra 审措辞。

**P0-2 B0“可恢复 Git 切片”不可执行 — 计划缺陷，影响可编辑/可保存**

- 计划章节：§2.2 L37，§6.1 L143，§13 L361，L32 冻结基数 25+2。
- 证据（文档内确定）：WORKING_PROTOCOL.md:104-105；ARCHITECTURE_CONTRACT:162-164。
- 失败链：E1 只记清单无第二副本→按 hunk 抽取遗漏→原工作树是唯一载体→清理后 V10 增量永久丢失。
- 最小修正：B0 卡写明 `status --porcelain` + `rev-parse HEAD` + `worktree list` + 归属全量 + `codex/` 备份分支或版本化补丁（含 tracked diff + untracked 清单）+ 恢复可读校验；禁 stash，禁只存 dirty 子集。owner：Root 派发，E1 执行，I/A 确认归属。

**P0-3 worktree 精确验证缺失 — 计划缺陷，影响正确性**

- 计划章节：§2.2 L38，L32 HEAD 063f77e，L355。
- 证据（文档内确定）：WORKING_PROTOCOL:83-84。
- 失败链：复用承载残留简化 UI 或 HEAD 非 027d→E3 参照失真→把简化当成熟带入迁移→违反零降级。
- 最小修正：记录新 worktree `rev-parse HEAD==027d588a` + status 干净 + 路径/分支名；复用仅当精确干净，否则强制新建。owner：E1 记录，Root 核对。

**P0-4 原版 profile / 样本 / 端口隔离欠具体 — 计划缺陷，影响原件保全**

- 计划章节：L33，L39，L42，L274，L253。
- 证据：文档内确定 + 需源码确认（独立 profile 路径、样本路径、实际端口计划未给）。
- 失败链：E3 用 Owner 真实 profile / 真实文件或同端口启动→draft / History 污染原件，或为解端口杀 Owner 进程→中断/丢数。
- 最小修正：B0/E3 卡写明独立 profile 目录 + 样本复制路径 + 端口分配 + 只读原件写副本 + 只关自己实例。owner：Root 定规范，E3 执行。

**P0-5 步骤 5 抽取缺 hunk 级归属 — 计划缺陷，影响单一 writer**

- 计划章节：L41，L314，§5 L120-131，L134。
- 证据：文档内确定为主；6d93 巨提交含简化 UI 范围需源码确认（`git show`）。
- 失败链：无 allowlist / 来源登记→含简化 UI 的 hunks 或 V9Like 影子混入→成熟 DOM 降级。
- 最小修正：每 hunk 登记来源 commit + 文件 + 直接 consumer + §4 五项动机；共享 hunk 回 K0 唯一 owner；维持禁整包 cherry-pick。owner：Astra 定取舍，I 收共享 hunk。

### 3.2 前端保全与修改动机

**P1-1 无保留清单 diff — 计划缺陷，最大，影响功能降级不可证伪**

- 计划章节：§6 各包“保…”列 L146-184；§9.2 L259 推迟自列；§13.2 L376-378。
- 证据：ARCHITECTURE_CONTRACT §2 L82-111 25 组 Must Preserve；旧 UI_REINTEGRATION U0-U13 有精确文件列但新 §6 未 crosswalk（文档内确定）；每包 commands/menus 需源码确认。
- 失败链：无清单→选择性列动作→删控件/隐藏未接线仍自称保完整→E3 抽查只覆盖抽到项。
- 最小修正：Root 补附录，每包交付原 commands/menus/shortcuts/控件 ID 对照 + 未证明明报。owner：Root。

**P1-2 F0 写域过宽 — 计划缺陷，影响全局 IME / 选区 / 草稿**

- 计划章节：L150，L197，§10 L290。
- 证据：`src/renderer/document/SharedDocumentEditor.tsx:127,326-327,471-472` 已有 Promise 分支（源码抽查确定）；合同只要求真实 Promise ACK。
- 失败链：整文件接管→触 plugins/preview/IME→回归，但后端单测仍绿→用户无法输入/丢选区。
- 最小修正：拆 F0a ACK 边界必需 + F0b 插件非必需；I 先出旧→新签名表；验收 UI3 最小拒绝保 draft。owner：I/K0，F0 执行。

**P1-3 P0 混入无 ID 的 CSS / 命令优化 — 计划缺陷，影响专业控件简化**

- 计划章节：L153（含 `lessonWorkspaceShell.css` 整文件、`slideLightCommands`），L200，§4 L96-100。
- 证据：binding 已窄，但 CSS 无冲突 ID 引用（源码抽查确定）；合同 §6 L216。
- 失败链：宽 CSS 覆盖人工 frame / 隐藏动作→以整齐通过→enum/color/step 丢失。
- 最小修正：拆 P0a 绑定必需 + P0b 需失败截图/用例 ID；CSS 按选择器白名单 patch；删命令列 ID + 替代路径。owner：P0 提证，A 裁决。

**P1-4 R0/R1 `player/` 交叉 — 计划缺陷，影响并发写坏**

- 计划章节：L161，L162，§5 L120，L132。
- 证据：`src/player/` 同父目录（源码抽查确定）；公共 host vs camera/graph 切分需源码确认。
- 失败链：R0 改公共 host + R1 改 camera/graph→lifecycle 分叉→双 lifecycle/旧实例残留。
- 最小修正：I 做文件级切分，公共 host 归 R0，camera/graph 归 R1。owner：I。

**P1-5 X1 横跨 renderer+main 且 rename/reopen ENOENT 未修 — 已知产品缺陷 + 计划协调不足**

- 计划章节：L179，§10 L291，§9 L249。
- 证据：计划自认真实失败未修（文档内确定）。
- 失败链：只换 producer 端口→未修 K0 权威路径/A0 生命周期→改名后续作 ENOENT→重开旧 revision。
- 最小修正：X1 验收绑独立重开 + rename 回归；缺口由 K0/A0 修。owner：K0/A0/X1。

**P1-6 §6 预填 A + §4 评估后置 — 计划缺陷，影响重写可审计性**

- 计划章节：§4 L88-94，§6 L146-172，§7 L190，§13.1 L370。
- 证据（文档内确定）：任务卡模板无五项落点；§5 L120 禁复制合同但无检查点。
- 失败链：先全量改写再补理由→事后追认。
- 最小修正：Root 在任务卡明确五项填写位；A 仅在整模块重写主张时介入。owner：Root/A。

### 3.3 端口与状态链

**P2-1 无静态穷尽端口清单 — 计划缺陷，影响漏 consumer**

- 计划章节：§3.1 L59-68，§3.2 L72-84，§4 L88-104，§5 L122-130。
- 证据：仅定性词，无签名表（文档内确定）；`src/shared/workbench/` 43 文件、`src/main/workbench/` 50 项映射缺失；`editorSession:45-48` 三件套易漏（源码抽查确定）。
- 失败链：派发 S0/F1/W0 漏 clipboardContext/resourcePort→跨文档粘贴抛尚未连接→无声失败。
- 最小修正：K0/I 补附录端口变更清单，每行绑文件 + owner，批后才派 UI 包。owner：I + Root。

**P2-2 菜单/快捷键无中央清单 — 计划缺陷，影响编辑第一步即断**

- 计划章节：S0 L148 / F1 L151 / W0 L152 / P0 L153 / C0 L155；§9.2 L259。
- 证据：`SlideLocationWorkspace:465-466`、`Spatial:254-255`、`SharedDocumentEditor:382-404,886-907`、`useEditorKeyboardRouter:53-113`（源码抽查确定）。
- 失败链：C0 换 router 而 F1 未同步 objectMenu→右键菜单空→无法选中对象→链断。
- 最小修正：C0/A0 先交菜单×快捷键×surface 矩阵，E3 点检。owner：C0/A0 + E3。

**P2-3 焦点无契约 — 计划缺陷**

- 计划章节：L11/L371，UI1 L263，N0 L149。
- 证据：`useSlideNativeTextEditor:36-40,82-92,150-151`，`SharedDocumentEditor:578-625`，`editorSession:382-394`（源码抽查确定）；合同 §0.2 L26。
- 失败链：重建失连→blur 误提交半截组词→工具栏偷焦点→草稿丢。
- 最小修正：N0+K0 补 focus/commit/cancel/豁免/失连规则；UI1 加用例。owner：N0 + K0。

**P2-4 IME 组词中互锁未验收 — 计划缺陷，影响中文链虚验**

- 计划章节：N0 L149 / F0 L150 / UI1 L263 / L272。
- 证据：`editorSession:52,144-145,209,356,474` guard 齐但未绑验收（源码抽查确定）。
- 失败链：组词中 publish 取半截→ACK 推进 baseline→二次写入→Max-depth/光标跳。
- 最小修正：UI1/UI3/UI6 加组词中→切焦点→Ctrl+S→拒 ACK 用例；DAG 补 Owner 现场抽查节点 + 日期。owner：N0/F0 + E3 + Root。

**P2-5 草稿/dirty/single-flight/drain 缺失 — 计划缺陷，影响保存丢尾字**

- 计划章节：A0 L146 / K0 L76 / L74-80 / §9.1。
- 证据：合同 §2#7-9；`SharedDocument:206,316-333,502/576`，`DocumentHostService:60-80` 未全读（部分需源码确认）。
- 失败链：800ms 内 Ctrl+S 未 flush→archive 旧 content→重开旧 revision→运行/导出旧字节。
- 最小修正：K0/A0 补时序 + drain 断言 + dirty-while-saving 测。owner：K0 + A0。

**P2-6 剪贴板三路分叉未闭合 — 计划缺陷，影响跨文档污染**

- 计划章节：C0 L155 / F1 L151 / L80 / UI4 L266 / §8 L214 / §10 L292。
- 证据：`documentClipboard:31-88`，`editorSession:183-204,243-260`，`LessonDocumentEditor:202`（源码抽查确定）。
- 失败链：await 切页→捕获过期未 discard/误写当前页→同名覆盖→undo 拆批→重开图裂。
- 最小修正：C0/L0/F1 同批闭合冻结→stale 零写→同名不覆盖→原子历史。owner：C0/L0/F1 + K0。

**P2-7 undo/History 分组未定义 — 计划缺陷，影响 Flow undo 分裂**

- 计划章节：F0 L150 / F1 L151 / UI3 L265 / §10 L290。
- 证据：`editorSession:53,62,65-67,207-217,356-381`（源码抽查确定）；合同 §3 L160-165。
- 失败链：未证唯一根因猜修→同 intent 重复→一条变多条→Ctrl+Z 回不到锚。
- 最小修正：先定位禁猜修；UI3 加无重复 intent 断言。owner：F0/F1 + K0 + A 评审。

### 3.4 并发可执行性

**P3-1 三 slice + 根装配归属矛盾 — 计划缺陷，影响首链排队**

- 计划章节：L129 vs L132/L148；`editorStore:70-74` flow/spatial 复用 slide；`courseStructureSlice` 无主。
- 证据：`editorStore.ts L62-75,111`，`flowAuthoringSlice:17`，`slideAuthoringSlice:12-13`（源码抽查确定）。
- 失败链：任一改提交语义必改 K0 锁根→三 surface 排队。
- 最小修正：A 案三 slice 归 S0/F1/W0、K0 只持根，或 B 案全归 K0，二选一写死；补 structure/shell/design/CoursePlayer owner。owner：Root/A。

**P3-2 flow slice↔view 循环 — 计划缺陷**

- 计划章节：F1 L151。
- 证据：`flowAuthoringSlice:17` import `ui/FlowWorkspace`，反向消费 store（源码抽查确定）；违合同 §4 L191。
- 失败链：F1 无稳定小接口→F0/C0/L0 等待。
- 最小修正：slice 禁 import view，下沉 ports 注入。owner：F1，A 裁决。

**P3-3 ToolCatalog 根争用 — 计划缺陷**

- 计划章节：H1 L167 vs K0 L122-130。
- 证据：`ToolCatalog:1-7`，`DocumentToolGateway:12-13`（源码抽查确定）。
- 失败链：H1 改内容触根→影响全族→K0 回归排队。
- 最小修正：K0 持根，H1 只持内容叶。owner：K0/I。

**P3-4 X3↔X4 helper 双向等 — 计划缺陷，影响交付死锁**

- 计划章节：§6.3 L181-182，§8 L214，L180。
- 证据：`document/index(X3):2-3` 需 flowPageBox(X4)，`print/index(X4):10-11` 需 reading(X3)，三文件均已存在（源码抽查确定）。
- 失败链：互等整包→X1 延迟→全线后移。
- 最小修正：只读冻结 helper，各写自文件，删互等表述。owner：X3/X4 + Root。

**P3-5 首链前置混淆 — 计划缺陷，影响首链无限等**

- 计划章节：§8 L215 vs L239；R0 L159 全量。
- 证据：`CourseV10RuntimeView:3-8` 需 Q1/R1/M1 齐备（源码抽查确定）；AGENTS L40。
- 失败链：编辑/属性/复制/undo/save 被 World 全量拖住。
- 最小修正：首链重定义为 K0 分片 + G1 + S0/P0/C0/A0 窄接口；R0 仅最小挂载占位。owner：Root/A。

**P3-6 隐含依赖未进 DAG；遗漏 owner；K0 分片缺失；App 注入争用；W0/R1 camera 矛盾 — 计划缺陷组**

- 计划章节：§8 L212-217，§5 L122-134，A0 L146，X1 L179，W0 L152。
- 证据：`slideAuthoringSlice→C0/L0`，`editorStore` 复用 slide，`reading→D0`，`spatialAuthoringSlice:5` import R1 graph（源码抽查确定）；N0 公式文件、Q0 单 writer、lock 争用、21 槽容量需源码确认。
- 失败链：误派发→运行时缺 definition→返工；A0/X1 同改 App→违反单写锁；W0 改 camera→R1 返工；S0/F1 不知等 K0 哪片→空等或猜层。
- 最小修正：补 `D0小片→S0/F1/R0/X2/X3/X4`、`L0→C0→S0/F1`、`slide ports→F1/W0`；K0 按五端口映射到文件；App 只 A0 写；Player camera 只 R1 写。owner：Root/K0/I/A0/R1。

### 3.5 正式内容与生命周期

**P4-1 V9 桥/视图退出缺文件指派 — 计划缺陷，影响双投影**

- 计划章节：§5 L122-130，§6.1，§7。
- 证据：`DocumentHostService:61` 无 V9 driver vs `CourseDocumentBridge:59,97` 硬校验 course-v9，`CourseDocumentView:53-60` 仍构造 V9（源码抽查确定）。
- 失败链：双入口 + 双 selection→能打开不能编辑/静默不可用，或误把 V9 大声失败当 V10 修。
- 最小修正：补 V9 退出 owner + 删除条件；过渡期标未就绪不可达。owner：Root/Astra 定，A0 执行。

**P4-2 几何单主分裂 + override 遮蔽 frame — 计划缺陷**

- 计划章节：§3.2 L78，§6.1 G1/S0 等。
- 证据：`project:85,204-207` override 可替 frame（源码抽查确定）；Phaser mount 仍在仓。
- 失败链：frame vs override.frame vs pose 三可变→取错值→邻项误改。
- 最小修正：K0 明确唯一写入口 + 派生校验；G1 收口前禁自建 helper。owner：K0 + G1。

**P4-3 捕获映射 + 跨态 stale 不足 — 计划缺陷，影响跨页误写**

- 计划章节：§3.2 L75 vs K0 L129。
- 证据：`CapturedCourseTarget L11-21` 缺 container/revision；`editCaptured L178` 仅比 epoch（源码抽查确定）。
- 失败链：await 切页/切 state 后 paste→未拦→误写当前页，违 UI4 禁令。
- 最小修正：K0 发映射表 + 补 surface/state 世代校验。owner：K0，C0/L0/F1 共证。

**P4-4 资源冲突码不统一 — 计划缺陷，中，影响 UI4 口径**

- 计划章节：§3.2 L77，§9.3 L277。
- 证据：`CourseV10Driver:33` 通用 Error vs `component.files.set` 用 Conflict；`rebuildComponentDraft:164-180` 仅捕获 Conflict（源码抽查确定）。
- 失败链：同名并发→调用方难区分重试 vs 丢弃→证据口径分裂。
- 最小修正：重复 asset 改抛 Conflict 进同一 retain-draft 路径。owner：K0。

**P4-5 运行关闭→销毁边缺失 — 计划缺陷，影响退役后污染**

- 计划章节：§3.2 L78，§8 R0 边。
- 证据：`Session.close L398-410`，`Projection.dispose L548-558`，`Bridge.close L203-215`（源码抽查确定）；close→World destroy 调用点需源码确认。
- 失败链：关/切 doc 后 motion 未退役→污染观察/截图→UI5 不成立。
- 最小修正：R0 补边入 DAG 或书面确认覆盖 + 调用点。owner：R0 + A0。

**P4-6 V9 保存回执残缺；原件回滚口径需收口 — 计划缺陷**

- 计划章节：§9.1，§2.2 L37-44，§9.3 L277-282，§13 L370。
- 证据：`DocumentHostService.saveToPath:289` 仅 course-v10 设 savedBinding；`sourceFileKind:4-11` 无 V9 映射（源码抽查确定）；源码多处保留原件正确。
- 失败链：过渡期 V9 绑定存活→保存成功但查证缺身份→ENOENT 无法定位；迁移失败分不清回代码还是恢复文件→动 Owner 区。
- 最小修正：V9 入口下线不可达，或补回执/打开指引；派发正文加一句无转换器故无数据回滚，代码回上证候选、用户文件以原件 + 副本丢弃为准。owner：A0 + K0，Root/Z0。

### 3.6 验证与切换（深度受限说明）

- 验证专项因子权限中途停止，未能独立闭合 §9 逐批验证对照。本节结论以文档内确定为限。
- 文档内确定的正面：§9.1 L245-256 明确提交/类型/build/后端 unit/DOM 只证明各自属性；§9.2 L272 禁伪造；§10 L290-298 登记 Max-depth/rename-ENOENT/clipboard-ACK 等反例；§2.3 L48-53 单 writer；与合同 §2 零降级一致。
- 文档内确定的风险：L312 压缩句式易被反读为许可（NativeText 退出 1 可当 green 等）；G1/Q1 复用缺属性限域；D0 不逐矩阵需防以算法复用代输出验收。失败链是误读→把后端 green 当前端可用→真实聚焦/IME 未验。
- 最小修正：Z0/Root 将 L312 改显式禁止句；K0/G1/Q1 注明复用属性 + cut + 环境。owner：Root/Z0。
- 待补：§9 最小充分/复用/回滚逐批对照需补读 `tests/**` 证据结构后确认；本报告不代为判定通过。

### 3.7 N 目标覆盖（N00a/N00b、N01–N10）

- 基本覆盖：N00a、N01、N02、N03、N06、N07、N08 有实际 consumer、owner、交付路径，未缩水为症状修复。
- 部分覆盖：N05 专业压缩为单 D0 medium + 不逐矩阵；N04 Flow 互动 L18 折入 D0 无联合归属；N00b G0 条件化 + A 决策节点缺失。
- 缺失：N10 无专包无 owner；N09 L26 解散为 Z0 docs，无混合集成 owner。
- 未发现“修少数症状便称整体完成”的正面表述；风险是 D0/G0/六链抽样被扩大解释，需 §13.1 派发正文显式限缩单样本≠整目标通过。

**N10、N09、N05、N00b、N04 的失败链与修正见第 2 节第 7 项及 3.5/3.4 相关条目。owner：I + 原叶；Root/Astra 定混合与选型；Sol 拆 D0；F1 牵头 Flow。**

### 3.8 L 目标覆盖（L01–L26、L23a/L23b）

- 首链设计正确：§8 波次只定就绪顺序不设等齐屏障；首真实 Main 为 A0+K0/R0+一条 surface；不存在把首 Slide 链拖到全部 L 完成的硬性要求。防草率勾 done 有声明（§9.1 L245-256，§10 反例，§13.5 L365）。
- 缺失：L03 无独立 owner；L09 binding 层 orphan；L26 无独立包；L20 MCP server 部分缺失；L24 通用素材库部分缺失；L07 fragmented；L21/L22/L23b 重叠或循环；L16/L17 Flow vs Native 未分。
- 与 AGENTS L69 复用方向一致但落地不足：各包未给窄复用端口/负边界，存在误重写或无 consumer 两极风险。
- 最小修正：单列 L26 包；L03 preview 归 H1；binding 归 K0/F0 唯一；MCP 切换归 H1；media 窄端口归 L0 复用；解 X3↔X4 单向先交 + 补 D0→格式边；定 Published/HTML 归属 + Spatial 静态页。owner：Root/I + 各叶。

---

## 4. 待确认疑点（需源码确认，不计问题数）

- 027d 是否为 6d93 直接父、是否仅文档改等同 5f6f9d7：需 `log --graph` + `show --stat` + `diff`。
- 64d97fa2 是否为 027d 祖先及对照价值：需 `merge-base --is-ancestor` + 失败 consumer 文件。
- 当前冻结 25+2 真实清单：实施时重取 `status --porcelain` + `stash list` + `worktree list` + `rev-parse HEAD`。
- 6d93 / f61a / ce27 复用 hunk 与简化 UI 边界：需按文件 `show`。
- N0 公式真实文件、D0 真实根（`src/components` vs `src/renderer/components`）、Q0 单 writer、slideLight 归属、lock 争用、21 槽容量与 E2 重限流、B0 参照粒度。
- DocumentHost save/drain 全实现、OS 剪贴板桥、Spatial 空 ports、Max-depth 根因、Teacher footprint、PDF/DOCX/PPTX 缺口、027d 成熟行为。
- `webEditor/binding/**` 是否存在；`buildSingleHtml` 与 X1 `buildHtml` 语义；MCP 默认指向；MediaTab 真实 consumer；G0 精确文件；capabilities 生成物归属；X3↔X4 时序单向化。
- 验证专项未闭合部分：`tests/**` 证据结构、每批真实 Main 操作/可见状态/正式数据/保存重开对照。

---

## 5. 修正后首条真实用户链关键依赖顺序

1. B0 精确 027d worktree + 干净校验 → E3 原版行为快照（布局/菜单/焦点/拖选/试运行）。
2. K0 分片先行：capture / edit / ACK / drain / binding + 映射表 → G1 纯几何 helper 早交。
3. S0 Slide 视图 + P0a 绑定 + N0 窄字段 / C0 窄复制 + A0 lifecycle 闭合编辑/属性/复制/undo/save。
4. 独立进程重开比对 revision/bytes。
5. R0 最小挂载 tryRun 占位 → R1 导航小片 → Q1 编译 / Q2 文件 / L0 库小片。
6. X0/X1 交付 + MCP 同 Session E2E。
7. D0 按族拆分与 X2/X3/X4 共证 → F1/W0/V0/T0 后续 surface。
8. L26 混合 J1-J5 → 旧 consumer 同批退出 N10。
9. 全程禁整包 cherry-pick、禁猜层、禁动 Owner 区。

---

## 6. 缺口—失败对照总览

- N10 缺失断全链（错写/污染）；N09 缺失断跨 surface 编辑→混合运行→混合导出→资产复用。
- N05/N04 部分断专业编辑→专业运行→可编辑导出（退化为静态图）；N00b 条件化断拖动/输入/IME→提交→撤销。
- L26 缺失则完成不可证；MCP 缺失则内外分叉；通用库缺失则 UI4/L14/导出断；L09 缺失则编辑 ACK/history 断；X 循环则表格/图表输出断。

本次只提交审查报告，不重写计划。
