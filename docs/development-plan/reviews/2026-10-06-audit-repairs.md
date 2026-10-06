# 2026-10-06 三路创作审计修复结果

本轮软件必需闭环已按 Owner 最新范围完成：内容真实提交、模型结果投影、对象路径编辑、表单语义保真、目标页观察、按首次访问挂载，以及恢复续编、保存冷开和两个工程各自导出。结果为 **engineering candidate**；未运行新的模型质量对比，未发布，不代替全课教学验收或 Owner accepted。

## 实际版本与制品

- 实施基线：`db5cdf1f9ed451e734574718f4e68617f8a48408`；唯一集成树为 `D:/果铃恢复候选/20261005-v10-migration`，Owner 主工作台未改写。
- 实际产品源码与同源生成物 cut：**`652db727aabcc80a82780293bed65eef6529d47d`**。实质集成提交依次为 `6795898b`（Editor）、`67df2854`（内容目标）、`da9a305b`（结果事实/投影/路径）及 `652db727`（语义作用域与能力制品）。
- 能力生成一次，exit 0。Main 实际构建 exit 0，4228 ms；Renderer 实际构建 exit 0，5621 ms，入口 `dist-renderer/index.html` 使用 `assets/main-Bq-_CNMX.js`。相关 Player 源与 consumer 未变，复用既有制品；未重复 builtin sources 或旧 V9 合同生成。
- 后续 SVG 回归用例与本结果文档不改变产品源码、生成物或上述制品，不使已有对应证据失效。

构建与生成原始记录：[integration-build](D:/果铃恢复候选/20261006-audit-fix-evidence/integration-build)、[integration-generation](D:/果铃恢复候选/20261006-audit-fix-evidence/integration-generation)。

## 修复及最低充分证据

| 范围 | 当前行为 | 已有直接证据 |
|---|---|---|
| W1 空内容目标 | HTML `content` 无目标时在原件/资源 edits 准备前返回 `no-content-target/not_committed`，保输入并提示显式 insert；合法资产、主题和源码操作不受通用空 edits 门阻挡 | [content](D:/果铃恢复候选/20261006-audit-fix-evidence/content)：真实 Gateway/Session 1/1；content/from 零正式变化，insert/read/等价 unchanged/一次 Undo。测量几何固定，未冒称视觉证明 |
| W1 正式结果 | 嵌套 commit、可用性和保存事实进入既有执行状态；unknown 按原 operationId 只读 lookup，确认后解除屏障，不重放；rename/Save As 不否定历史已证保存 | [outcome](D:/果铃恢复候选/20261006-audit-fix-evidence/outcome)：初片 38/38 含四个真实 Engine/Gateway/Session 用例；保存补片纯结算 35/35。未变 unknown 四例沿用 |
| W2 模型投影 | 四种提交状态及无 receipt 均移除模型副本中的正文、bytes、完整 edit 值，保留决策事实；原 ToolResult 不变，既有 run/事务/恢复路径及显式读取不受本投影裁切 | [projection](D:/果铃恢复候选/20261006-audit-fix-evidence/projection)：unit 9/9、历史 T23/T31；[公共出口](D:/果铃恢复候选/20261006-audit-fix-evidence/integration-model-output)：真实主题链 1 pass，后续四状态 4 pass/1 skip，exit 0；skip 是已通过主题链 |
| W3 HTML 语义 | form owner、label/control、radio 和状态 CSS 的共同范围保留原 HTML/CSS；不另建可见后代碎片。越界关系/状态布局影响后文时保完整输入；独立文字继续原生化 | [semantics](D:/果铃恢复候选/20261006-audit-fix-evidence/semantics)：真实 Electron 1/1，标签/复位、原与导入表单 440×206、独立文字、局部改文/Undo/save/新 Host 与新窗口重开；auto-height 后文与 form 外关联均覆盖 |
| W4 路径局部编辑 | `object.update {project?,path,properties}` 从已观察路径捕获原实例；effects/preflight/direct/batch 共享本次捕获，沿原权限、锁、最终 CAS 和 canonical writer | [path](D:/果铃恢复候选/20261006-audit-fix-evidence/path)：真实 Gateway 1/1，direct/batch/Undo/stale/no-frame/locked/捕获后重排。正常应用的实际移动与 Undo 另由直接 MCP 链覆盖 |
| W5 观察 | 当前非首页、另一页及修改后目标都返回正确画面，观察窗口释放，Main 继续服务 | [observe](D:/果铃恢复候选/20261006-audit-fix-evidence/observe)：1/1、蓝/红/绿三张 PNG 直接查看；未给产品新增 OCR、像素白色比例、Hash 或 readiness 门 |
| W6 Editor | 首次只挂当前页与 global，已访页保留 realm/input/局部状态，关闭释放所属实例 | [既有 Editor 原生用例](D:/果铃恢复候选/20261006-evidence/creation-editor-lazy-surfaces-runtime) 1/1 复用；最终大样本初页 16 iframe，首访旧 pg4 总 58，局部重做后 A16+pg4 1 共17；回访保同一 realm 与揭示状态 |
| W9 能力说明 | 工程虚拟路径与磁盘路径、两种分页、编辑意图、frame 和语义源文编辑入口与实际接口一致 | 同源生成已提交；最终公开 `skills.list/read` 真实读到完整路径/frame 参考，不把准备好的 model-smoke 客户端记为已调用 |

重要源码边界由未参与实现的独立 Reviewer 读取 actual diff、直接 consumer 和原始证据后闭合；没有以作者摘要替代 review。W5、交付和后续 SVG 判定均未发现需要新增产品修复的当前反例。

最终现场证据也已独立窄审：公开 SDK 原 receipt、UI Undo 前后几何、恢复与新 Main 冷开事实、两个独立导出的阶段/版本、实际互动 DOM/PNG 和正常退出证据相互对应，无本轮软件闭环 blocker。该结论不扩大为任意 HTML/SVG、全课视觉质量或原生故障根因已解决。

## 最终公开 MCP 链

[完整记录](D:/果铃恢复候选/20261006-audit-fix-evidence/direct-mcp/verification.md)使用真实 Resident MCP SDK/HTTP、独立 profile 和最终 Main/Renderer。27 次 `tools.call`、0 `isError`、零模型调用；新建两页、HTML from 插入、对象路径单项与双对象 batch 移动、真实 UI 一次 Undo、页面观察、原生 label/reset 和正式保存闭环通过。保存为 current/saved revision 6，dirty false。

| 操作 | 本次软件 wallMs |
|---|---:|
| 两次 HTML insert | 213 / 236 |
| 单项 frame / 双对象 batch | 145 / 135 |
| 六次 view.observe | 单次 681–773 |
| project.save | 135 |
| 27 次工具调用累计 | 5875 |

这是本机小样本的实际调用耗时，不是整回合时长、模型耗时或普遍性能承诺。表单实际尺寸、内容、排列和揭示/复位与裸输入对照保真，未主张像素相等。原生 DOM label/reset 动作不扩称 Windows OS 指针验收。Main 与启动器正常 exit 0，所属 PID 与端口已释放。

## 恢复、冷开与两个独立导出结果

[W7 完整事实、阶段日志与图像](D:/果铃恢复候选/20261006-audit-fix-evidence/delivery/W7-result.md)：只使用副本，原 journal 与原工程只读。

MCP journal 的 rev32/saved24 通过现有 unbound 入口恢复到真实编辑器，特有内容读回；局部文字修改、Undo/Redo 后另存 rev36，正常关闭 Main。新 Main 冷开 rev36，继续编辑、保存到 rev37，dirty false，再公开导出同一 revision 37 的独立 HTML。独立 HTML 的揭示与复位通过。pg4 使用已保全单页程序作人工局部重做，保外框和其他页；这不是 CSS-only 原稿的自动修复或全课重生成。

内置原 rev30 副本的两处有限 SVG 源文修改分别提交到 rev31/rev32，其他 data、frame/style、邻项、definitions 和 surface 结构保持。保存与独立 HTML 导出均为 current revision 32；独立 HTML 的并联9V读数及复位串联6V分别实测通过，不由 MCP 工程替代。

| 工程 | 保存事实 | 导出事实 | 本次耗时与交付文件 |
|---|---|---|---|
| MCP 恢复续编 | saved=current37，dirty false | written，exported=current37，warnings[] | 保存1032ms、导出854ms；[工程](D:/果铃恢复候选/20261006-audit-fix-evidence/delivery/artifacts/MCP-恢复续编.h5lesson)、[HTML](D:/果铃恢复候选/20261006-audit-fix-evidence/delivery/artifacts/MCP-恢复续编-rev37.html) |
| 内置有限修订 | saved=current32，dirty false | written，exported=current32，warnings[] | 保存664ms、导出468ms；[工程](D:/果铃恢复候选/20261006-audit-fix-evidence/delivery/artifacts/内置路线-局部修订.h5lesson)、[HTML](D:/果铃恢复候选/20261006-audit-fix-evidence/delivery/artifacts/内置路线-局部修订-rev32.html) |

MCP 导出 drain/build 分别242/255ms，内置分别118/126ms；均使用默认共享实现，没有 component:compile 请求或截图调用。历史构建超时本次未复现，没有延长 timeout、取消 CAS 或改交付源码。大样本局部内容操作约1.8–3.6秒，不能将小样本速度外推；恢复整体启动未设置端到端计时。两次业务 Main 均正常 exit 0，最后所属 PID 已释放。

## 保留的边界和失败记录

- 在产品 cut `652db727` 执行的广域 `tsconfig.json` 检查仍为失败。db5cdf 产品基线与该 cut 均有4030条诊断；只归一化诊断坐标及类型中 checkout 绝对前缀后，消息、代码、文件及次数新增0、减少0。[原日志与比较](D:/果铃恢复候选/20261006-audit-fix-evidence/integration-build/types-diagnostic-comparison.json)。这是既有迁移/旧测试维护问题，不称全仓类型检查通过，不扩大成当前软件不可用或本轮重写任务。
- 原 Main `c000001d` 与 renderer/GPU 故障因果仍未定位；本次零模型确定性链未复现，不宣称根因已修。
- pg4 操作保留 `unsupported-dynamic-url-sink` 可修复诊断和原源文；当前互动与导出通过，未用诊断抹掉已发生的提交，也未静默静态化。
- 内置封面现存 R₁/R₂ 图面缺项，在带全部 computed styles 的实际已保存 SVG 源独立打开时同样存在，因此不归作本次 export 丢失。当前 fresh SVG rect/text 真实 insert 最小反例未复现：裸/载体 bbox、fill 相同，R1 清楚可见，读回源独立打开也可见；[三图与原始值](D:/果铃恢复候选/20261006-audit-fix-evidence/semantics/svg-652-painted)和新增回归用例保留。未为单一历史源问题改 producer、盲删 styles 或扩大整课精修，也不据一例承诺任意 SVG。
- 两轮模型出口测试夹具失败（漏必填名称、JSON 持久载体中的 bytes 形态）、W3 外 frame/内投影夹具错误、取图未等待 paint、QA stdin 管道关闭与缩放坐标不符均保留原记录；只修对应夹具/控制方式，未削弱业务断言。隐藏窗口一次 Playwright screenshot 超时单列，原生 capturePage 成功补图；公开 view.observe 没有该失败。
- 没有删除 History/规范回执、改 journal 编码或设置体积门；没有清理共享 node_modules junction、干扰旧 idle driver、改模型路由或发布。有限人工内容附件在 [content-artifacts](D:/果铃恢复候选/20261006-audit-fix-evidence/content-artifacts)，不作为软件闭环的高标准内容门。

本轮新 evidence 位于 `D:/果铃恢复候选/20261006-audit-fix-evidence`，未变历史证据按上文原路径复用。协调卡完成后移除，任务板由生成器更新；旧 timed-usability 历史卡保留且写锁为 none。
