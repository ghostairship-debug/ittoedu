# M25–M30实施记录（持续更新）

## 开工与授权

2026-09-29 Owner正式授权本会话实施M25–M30，由主执行者统一集成，不受旧“仅改方案/封板后实施”及模型分工限制。单writer、最终CAS、停止屏障、授权根和未知副作用保护继续有效。

语音、视频、音乐本期仅做复用连接/作业/资源/工具的最小扩展框架及必要本地验证；无可用模型明确未配置。先核实既有GPT OAuth/TeamoRouter，已有授权可用通道可接通验证；否则真实生成及端到端闭环延期，不进入当前2.0完成门，不新增采购或索要凭据，不用模拟成功代替接通。图片能力和通用异步作业范围不变。

实际开工HEAD：`fda0ca0ef4e8e35cf7a092b8a2d27a478f24933d`，main，工作树干净；任务板0项。读取AGENTS、根方案、L06全部规格、WORKING_PROTOCOL及本批相关合同。

原38任务/205通过、REL六段/partial和M14-T05原范围接受全部保留；M30-T08不由执行者签署。

## 实施与验证

### B19 / M25 关闭恢复：已实现，最近层验证通过，真实Electron未验

- 窗口使用缓存ID；即使释放帧失败仍释放网络租约并detach，不全局吞异常。
- 孤立会话提交保留历史和unknown，不复活/重发；真正初始化失败允许下次显式重试。文档关闭查询不依赖全局恢复，识别动态授权文档并在barrier内停止。
- 失败草稿可经原生明确确认放弃关闭；取消保留草稿，磁盘原文件不删除，最终CAS保留。
- `output/g20/b19/close-regression.log`：第一次4文件中3文件12用例通过；ExecutionDesktop新增测试字符串转义错误，suite未运行，exit1。已修正测试源码，不改验收标准。
- `output/g20/b19/close-execution-r2.log`：仅重跑受影响ExecutionDesktop及新增窗口反例，2文件19用例通过、exit0。合计5个唯一文件31个用例通过；无skip/付费请求。局部fixture/HTTP验证不表示真实供应商接通。

### B19 / M25 HTML：实现中

- Chromium实际探针`output/g20/b19/nested-frame-probe.mjs`确认原opaque sandbox使父层无法访问自身srcdoc，不能仅添加unsafe-eval消除故障。
- 采用每lease独立随机host的既有courseware-preview协议，origin与256位token匹配；仅预览域许可脚本、Function/Blob和同域内层frame。主编辑器CSP、Node禁用/contextIsolation/进程sandbox保持不变；跨标签/根外/远程脚本仍受CSP、协议与导航约束。
- 不增加持久化合同；旧URL为会话临时租约，本轮刷新后失效，旧记录不迁移。新的CORP same-origin、无通配CORS；实际隔离与播放器功能待Electron验证。
- HTML专属flex链补齐，其他文档保留自然滚动；高度与交互待实际窗口验证。
- 工程边界查阅：Electron官方Security（https://www.electronjs.org/docs/latest/tutorial/security），WHATWG iframe sandbox（https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox）。未因此全局关闭webSecurity或暴露preload。

### 本轮工具阻断：R4历史课件副本

对L06指定 `output/g20/rel-t11/real-rFSkIy/workspace/光合作用互动课件.h5lesson` 的只读ZIP/JSON结构检查被工具安全层拦截（提示无法确定请求安全状态）。该调用未执行，未读取或修改原件、未生成修复副本；不换通道绕过拦截。R4真实历史副本验证当前受阻，其余载体/构建与独立验证继续。

`output/g20/b19/carrier-local-r1.log`：3文件20用例通过，exit0，含修复后的HTML路由断言；新构建载体保护的专项测试尚待补充。

### R3真实载体失败与定位

`electron-html-r1.log`两个真实Electron用例失败，首个错误被旧截图finally覆盖；未通过。随后仅重跑安全用例并保留原始错误和Main进程信息：`electron-security-r2.log`，失败发生在初次预览iframe完成加载之前。目的创建的隔离profile，未调用模型。移除新增但非合同必需的Origin-Agent-Cluster响应头，验证是否是自定义协议跨站frame兼容性问题；iframe隔离、唯一租约来源、Node禁用、来源/授权和导航限制均不取消。当前为假设，不记为已定位原因。

### R3已取得真实隔离通过；R4专项构建守卫通过

- `output/g20/b19/electron-security-r3.log`，重建Main后只跑M23-T01，1/1通过、exit0。目的创建profile：`output/g20/m23/security/run-64PKCf/evidence.json`，status=passed，untested=[]；实际父编辑器/兄弟frame读阻断、Node/preload不暴露、根外/编码/符号链接逃逸404、表单/窗口/顶层导航阻断、撤销一个租约404且另一标签200。不是mock。移除本轮非必需OAC响应头后同一用例通过，其余权限与逐租约隔离保持；不把这个单机观察泛化为所有Electron版本缺陷。
- `output/g20/b19/managed-build-guard.log`，1个命名M25专项通过、exit0；7个未选择用例不计本次通过（这7个的既有通过证据在carrier-local-r1.log）。真实scratch+HTML准备证明格式规范化不重建无变化Runtime，语义更改拒绝且候选保留；变更正文到达准入端口，本地拒绝夹具没有被记为真实准入成功。

### 既有媒体通道核实（工程profile）

`output/g20/b19/existing-connection-catalog.json` / `existing-connection-probe.log`：通过应用主进程正式凭据存储/正常目录接口检查，generationRequests=0。OAuth hasCredential=true，live目录9个coding/review模型；目录本身capabilitiesVerified=false，不能推断不存在目录外能力。当前应用Responses适配只有既有文本/图片协议，没有可验证语音/视频/音乐通道。该工程profile TeamoRouter hasCredential=false；进程TEAMOROUTER_API_KEY及DEEPSEEK_API_KEY均不存在。不替换配置、不导出凭据、不发生成。

官方核对：Codex订阅登录与API key用量分开（https://learn.chatgpt.com/docs/auth）；音频专用API（https://developers.openai.com/api/docs/guides/audio）、视频API（https://developers.openai.com/api/docs/guides/video-generation）要求各自通道，不能将现有Codex OAuth视为媒体API key。继续核实已知默认profile，不搜罗凭据；暂无媒体真实生成可用证据。

### B19真实布局闭合与B20开工

- `electron-layout-r2.log`失败：测试未等待原生setContentSize投影到renderer，连续读取旧viewport；最小高度要求未修改。修复测试同步后 `electron-layout-r3.log` 仅M23-T02 1/1通过、exit0，`output/g20/m23/preview/run-I2sVgv/evidence.json`。实际iframe 572×497→1172×877，固定页面两尺寸均完整适配，分页与点击状态保留。已查看BrowserWindow原生截图fixed-page-native-window.png；正文、边角标记和分页可见，非缺失OOPIF的Playwright整页图。
- `existing-default-connection-catalog.json`：已知默认profile同样OAuth凭据可用/live目录、TeamoRouter凭据未配置；未扫描其他账号或发生成请求。不能将API目录/订阅推断成音视频授权。
- M26开工：统一纯生成三时钟，Engine最多3次有界重试；明确纯生成Provider声明，未知/带服务端副作用Provider默认不重试。每attempt独立requestId（同逻辑轮前缀/attempt编号），沿用请求记录，不增核心持久化格式或每请求工具卡。已报告usage即使后续流失败也保留；媒体unknown不复用。
- provider-retry-baseline.log：53用例45通过8失败，主要旧heartbeat语义、临时新增请求卡干扰工具计数、Stop被后到timeout覆盖；已移除多余卡、对齐新三时钟语义并修复Stop优先。
- provider-retry-r2.log：5文件66用例64通过2失败；2项新增测试误用EventStore.read而非readPage，产品重试/半参数/stop等其它断言已走到。修正测试API后只重跑受影响Engine命名M26用例；未将2项报通过。
- 顺带按HEAD原行尾格式消除本轮Python在Windows意外产生的整文件CRLF差异；只规范本轮修改文件换行，所有实际实现和证据保留，无restore/reset。后续写入固定LF。

### 后续局部验证与工具阻断（继续记录）

- `output/g20/b20/provider-retry-r3.log`：仅选择三个命名 M26 Engine 用例，3 通过；28 个未选择旧用例不计本轮通过。结合 r2 中未受影响用例，相关 5 个文件共 66 个唯一用例都有通过证据。
- `typecheck-main-r1.log`：误用了仓库不存在的 tsconfig.main.json，TS5058，未构成类型检查。随后读取实际 package.json，运行真实配置。
- `typecheck-electron-r1.log`、`typecheck-renderer-r1.log`、`typecheck-e2e-r1.log`：实际三个配置均 exit 0。
- 后续 R6 大块修改工具调用被安全检查拦截，没有执行，不得将拟议的 cursor/区间观察/ACK 续柄改动记为已实现；当前转向独立分支。两次只读 REPL 状态检查同样被拦截，未通过其他通道规避。
- 已实现的 M25 与 M26/R5 工作树修改及历史验证保留；M25、M26 整体验收仍未通过，M27–M30 尚未完成。Owner 验收未代签。

### M26-T01 登记依据；其余整体验收不变

M26-T01 的定义为两 Provider 三时钟与有限普通生成重试（允许本地假 fetch/SSE/时钟）。`provider-retry-r2.log` 中 64 项通过，另 2 项仅测试读取 EventStore 的方法名错误；修复后 `provider-retry-r3.log` 三个命名 M26 用例全部通过。合计 66 个唯一用例具备通过证据，含半参数不执行、旧工具不重放、unknown 保留、3 次上限、429 长等待不提前重试、退避停止、已报告 usage 保留、未知/有副作用 Provider 不重试。登记此一用例 passed，不等于 M26/R5 全部完成；图片角色级冷却、显式继续时的等待约束及 R6–R8 尚待处理。

### 最新真实关闭验证：2 项失败，未记为通过

`output/g20/b20/build-electron-r3.log` 重建 Main 成功。随后 `output/g20/b19/electron-close-lifecycle-r1.log` 两项失败、exit 1：
- S02-T04 在重载后查找旧标签“正文源文编辑”失败；真实快照中“正文编辑”textbox 已显示未保存正文，此前 Main 文档/History/任务身份断言已通过，但最后恢复响应完成断言未跑到。需要更新测试的当前 UI 定位后重跑，不能用前半段通过代替整例通过。
- M02-T04 在真实选区后等待“当前编辑目标 / AI 指令”输入框超时，尚未走到模型请求和关闭/迟到提交断言。需核对当前元素卡入口与选区状态，再局部修复、重跑；目前不能判定纯测试过期，也不能宣称关闭边界已通过。
失败截图、trace、error-context 保留在 test-results 及该次 output/g20 目的创建目录中。此处不追改旧 205 项历史验收为新的通过证据。

### 继续实施：恢复事实和当前写入

本次续接核对实际 HEAD 仍为 fda0ca0ef4e8e35cf7a092b8a2d27a478f24933d，全部上一轮修改保留，diff --check 为 0。当前连接设备 MAGICBOOK0923。新读取的工作协议为结果驱动版，任务卡用六个 Markdown 字段，真实生成器是 scripts/generate-task-board.ts；旧 .internal/tasks/JSON 说明不能作为实际入口。创建跨会话协调卡的调用被安全检查拦截，卡没有生成；保持本记录为已落盘的续接证据，不以换路径绕过。

已回读 output/g20/b19/electron-close-lifecycle-r2.log：2 个真实 Electron 用例通过（S02-T04 重载重订阅、M02-T04 关闭停止与已提交修改保全）。此结果补充而不删除上一节 r1 两次失败历史；两例保留原有停止、迟到写入和保存重开断言，仅对齐旧 UI 定位。

M26/R7 元素卡分支：已实际运行经读取核对的 patch-element-partial.mjs，partial 不再映射 completed，并纳入终态查询已应用修改；局部测试补入 g20M15ElementCards.test.tsx，尚待运行验证。无业务数据/付费调用或历史 run 改写。

### R7 卡片局部通过 / R6 分段实施

`output/g20/b20/element-partial-r1.log`：1 文件 7 用例全部通过，含新增 partial 显示、部分交付提示、终态撤销可用；这是实际 React 组件与本地端口 fixture，不冒充真实供应商或整项 M26-T03 通过。

R6 已写入：分页身份绑定 run/document/epoch/revision/target/method/content，不再绑一次性句柄；稳定目标可重新只读查看，不能借派生子柄重新获得写权。新增临时 ToolReadCoverage 记录实际返回的文本区间；恢复门移至 Gateway 解析后的本次修改目标，file.open/只读诊断不再被其他文档挡住。当前代码正在近层回归，尚未登记 M26-T02。

R6 后续 ACK 续柄、Undo 和插入依赖的合并修改调用被工具安全检查拦截，未执行；该子分支仍未完成，不改安全设置或换通道绕过。此前写入 helper 中的 ACK 区间工具尚未接到写入路径，不视为能力完成。先核对当前读链路的编译与行为，再继续独立工作。

### 已落盘的增量证据（续接）

- R6：`output/g20/b20/r6-read-r2.log` 两文件 44 用例通过；`r6-typecheck-r2.log` electron 类型检查通过。含 9999/10001 字分页、新句柄续页、Undo 后同字节不同版本拒拼、相关范围观察/V9 对象正文门。ACK 续柄、Undo 写柄失效和插入依赖仍未完成，不能晋升整个 M26-T02。
- A1：`output/g20/b21/generic-source-pages-r1.log` 两文件 22 用例通过，`types-r1.log` 通过。JSON/CSV/代码/无后缀使用既有 TextDriver 与文档 owner，dirty/History 保留并实际保存重开、BOM/CRLF 字节一致；二进制/办公文件不伪装文本；目录/搜索保留中途位置并拒绝跨查询和过期 cursor。write/patch/grep/组织链尚未全部完成。
- R8 显示：`output/g20/b20/display-buffer-r1.log` 三文件 39 用例通过。60ms/32KiB 有界显示批次走真实 EventStore.batchAppend，队列反压；原始提交/停止/终态及 checkpoint 仍等待真实落盘。含事件日志重开顺序、Stop、磁盘失败反例。
- R8 工作上下文：原始 run 消息、图片字节保留于原 RunStore，只投影给模型的工作副本归档旧图片和长工具/过程文本；新增 context.read 按原运行和明确续接链重读，先收齐原生工具回执再补所选图片。当前专项修复/验证中，未计整项通过。

### R8 上下文与 A5 Skill 增量验证确认

R8 工作副本测试：`context-engine-r2.log` 新增两个投影单测及一个真实 Engine context.read 测试通过；当时另两项压缩回归失败，后续 r3 的 S05 大上下文通过、r4 的 Engine 事实压缩通过（r4 为 1 个选中通过，31 个未选中不计通过）。原始消息和图片保持原 RunStore，不再把“删除全部原生工具消息”作为旧测试的通过条件，改验完整 assistant/tool 配对、实际已提交/失败事实、原文保留和可追溯重读。`context-types-r3.log` 类型检查通过。初始跨轮历史的递归图片投送仍需 A4 接线，M26-T04 整项暂不晋升。

A5：新 ScopedSkillService 复用内置 Skill 端口，从应用专属用户目录和当前授权工作区 .agents/skills 按需读取；索引只看 YAML 名称/简介，正文/引用/脚本文本按需读取且不授予执行权限。`scoped-skills-r1.log` 3 文件 10 用例通过，含实际 Gateway 与临时文件、版本分页、撤权、目录 junction 越界、二进制拒读和停止边界。类型检查 r1 的可选/必选 catalog 重复签名已合并为既有必选接口加可选 runId；`scoped-skills-types-r2.log` exit 0。脚本隔离执行及二进制素材读取尚未完成，A5 不记整项通过。

新增依赖仅 yaml@2.9.1 精确版本，`yaml-install.log` exit 0，使用 --ignore-scripts，未运行包生命周期脚本、未管理员安装或增加持续费用。package.json 增 1 行，锁文件增 12 删 1，diff --check 通过。

B0 最后复核：docker version 仍无法连接 dockerDesktopLinuxEngine 管道，docker desktop status=stopped；未尝试替代为不受限主机/WSL执行。现有 WSL 发行版运行不等于隔离后端可用；PATH 无 deno/wasmtime/uv。本分支真实后端接通仍受阻，其他工程继续。

### A2/A4 最新实现与尚未闭合的验证

已接入 ConversationHistoryIndex：后续轮只保存宿主冻结的 sourceId、指令摘要和附件来源索引，不递归重发旧图片；原 RunStore 保留完整消息。context.read 只允许本运行/明确继续链或冻结的精确历史引用，仍核对同会话，不凭模型给出的任意 runId 扩权。已有视觉角色选择仍支持历史图片按需重读，初始 manifest 不把尚未重读的图片算已发送。

新增 material.list/material.read 复用 AttachmentService：目录不代表正文已读；文本回读返回实际范围、原件/表示摘要与 locator；图片按真实原始表示字节进入下一完整模型轮，不在原生工具回执中间插入，不改变初始附件 manifest。尚未增加新来源打开/新页异步提取，A2/B1 范围未完成。

history-index-r1.log：8 个既有 Desktop 用例通过，扩展双图用例因后台回复索引更新与下一次发送的预期 revision 竞态失败；修改测试等待实际会话回复 ACK，没有放宽 CAS。history-material-r2/r3 中两个后续轮的薄历史断言已走过，但按需材料 HTTP 夹具遗漏响应 id/model，被严格 Provider 拒为 invalid-completion-chunk；已补齐夹具真实协议字段，未改 Provider 的拒绝规则。

随后定向重跑 g20TwoImageExecution 的工具调用被安全检查拦截，命令未执行；history-material-r4 不能视为存在通过证据。该测试目前待重跑，不通过其他入口绕过拦截。新增材料代码的 material-types-r1.log 类型检查 exit 0。独立 PDF 真实载体新增页码/原图/分块范围断言，尚待运行。

### 2026-09-29 后续集成进度（以本节更新较早的“尚待验证”描述）

- 当前仍在同一 `main` 工作树、HEAD `fda0ca0ef4e8e35cf7a092b8a2d27a478f24933d` 上实施，保留已有脏树；下列日志的局部通过不自动等于整项签收。
- M25：`output/g20/b19/electron-close-lifecycle-r2.log` 两个真实 Electron 关闭用例通过；`electron-security-r3.log`、`electron-layout-r3.log` 分别证明当时租约隔离与两个视口；`historical-carrier-e2e-r5.log` 1/1，在指定历史课件的修复副本里图文轻改、Undo/Redo、保存重开、交互复播与离线导出。M25 复核发现后续 iframe sandbox/租约实现变动命中旧 HTML 证据，真实窗口销毁重开、失败草稿 UI、孤立任务恢复也未由上述用例覆盖；正在补聚焦 Electron 验证，T01–T03 暂不晋升。
- M26：R6 相关观察、分页、ACK 后范围续接、人工重叠编辑与 Undo 失效已进入 Gateway；`output/g20/b20/gateway-service-integration-r2.log` 35/35、`r6-read-r2.log` 44/44。R7 完成/部分完成按同一请求的可核实交付与未知副作用判断；`output/g20/b20/r7-rel-replay-r1.log` 5/5，直接读取旧 REL-T11 RunStore，旧记录工具回执无未决失败而最后模型请求 unknown，原 partial 历史不改写。`g20ExecutionOutcomeR7.test.ts`、`g20ExecutionEngine.test.ts` 新增 artifact.save 与计算成果交付反例，局部通过；原始 RunStore 与图片不因工作上下文缩减被删除。
- M27：`output/g20/b21/files-m27-integration-r5.log` 26/26 证明通用文本/代码/JSON/CSV/无后缀读写、精确 patch、grep 分页、组织与保存重开；`material-history-skill-m27-r1.log` 7/7、`material-location-m27-r1.log` 1/1、`scoped-skills-m27-r2.log` 3/3 证明材料来源定位/Skill 冻结与撤权近层。`m27-light-batch-r7.log` 5/5 证明 native.insert→object.update→interaction.compose 用同一 `$result` 后向引用、一次 ACK/Undo、前向及跨文档零提交、ask 档单组审批且非法引用不先弹审批；`m27-batch-gateway-regression-r1.log` 40/40，TypeScript 主项目通过。Runtime/Component 内置 AI 动态轻编辑入口仍在实施，不能据旧 renderer 事务把 T03 记通过。
- M28：`output/g20/b22/compute-backend-r4.log` 5/5 实际固定 Podman 映像执行，检查文件、网络、子进程边界，持久作业回执、等待/取消/成果回读；`compute-recovery-r2.log` 2/2（新增并发/撤权后需最终命中复跑）。图片与构建原 owner 保留 unknown/停止边界，job.* 共用登记。`output/g20/b24/m30-html-action-electron-r1.log` 1/1 实际 Electron iframe 的 html.observe→html.click→html.errors，点击后 URL `#done`，第二轮 live 截图与错误回执可用；该用例由本地严格 HTTP 模型 fixture 驱动，不代表真实视觉模型修正。
- M29：`output/g20/b23/m29-owned-final-r1.log` 17/17；`managed-browser-public-r3.log` 真实 Edge 公网 302、子资源经受管代理、截图、Stop 干净退出；`managed-browser-proxy-r2.log` 覆盖上传下载/审批/停止。WebRTC/进程级全部出站尚未证明。`web.search` 当前无可靠授权 provider，正在尝试现有 Edge 受管连接上的真实公网搜索；Codex CLI 写策略阻断产品内首个写委派，未设置 write-verified 标志或把无写输出伪作已验证成果。语音/视频/音乐为未配置的最小框架，真实生成保留 media-followup。
- M30：`output/g20/b24/m30-real-compute-r5.log` 1/1：无 V9 的同一用户会话读取真实 CSV，写入并在固定 Podman 执行 `chart.py`，产生 `computed.json` 与 `chart.svg`，两个 artifact.save 分别交付，HTML 引用 SVG；保存重开后正式 HtmlPreviewService 按相对 URL 返回 SVG 200 与一致字节，原 CSV 不变、Run completed。r2–r4 的失败是新增 Vitest `arrayContaining` 对含摘要字段的对象误用严格元素相等，保留失败历史。`m30-review-fork-electron-r3.log` 1/1 为四文件审阅、检查点、分叉草稿不自动发送的真实 UI；`m30-html-mode-ack-unit-r2.log` 11/11 修复预览编辑模式 ACK 时序。上述计算与浏览器用例仍是本地模型 fixture；已确认默认 GPT OAuth `gpt-6-luna` subscription 的隔离 profile 凭据预检，唯一真实 scratch 模型 T1 正在执行，未先登记通过。

### 2026-09-29 实质可用性收口与登记

Owner 明确要求停止以模型格式微瑕和瞬态 UI 毫秒竞态作为交付门。执行器现在保留早期 `invalid-tool-arguments` 失败历史，但在后续正式交付已取得回执时不单凭它降为 partial；未完成的指定写入、未回收的异步作业和未知外部副作用仍不会被无关成功掩盖。`output/g20/b20/r7-substance-r1.log` 11/11。构建检查签名已包含指定 buttonCheck 意图，同一源码检查不同按钮不误触“无进展”；`output/g20/b21/m27-button-check-r1.log` 选中 1/1。

- M25：本轮最终 `m25-final-close-e2e-r6.log` 真实 Electron 3/3 覆盖窗口销毁重开、失败保存后取消/放弃且磁盘保全、孤立终态恢复；`m25-final-html-e2e-r1.log` 2/2 为**当前代码**的 iframe 租约隔离与视口回归。`historical-carrier-e2e-r5.log` 继续证明指定历史课件修复副本的图文轻改、保存重开与离线交互导出。M25-T01/T02/T04 登记 passed；T03 的错误栏/隐藏恢复几何未精确验，按 Owner 优先级停止追逐瞬态断言，整项保持未验完，不冒充 passed。
- M26：R6 分页/续柄/最终 CAS、人工重叠编辑与 Undo 失效，R7 同一请求终态，R8 原始消息/双图保留与工作副本投影均有聚焦通过。M26-T01–T04 登记 passed；旧 REL-T11 历史 partial 不改写。
- M27：通用文件写补丁与搜索/整理、PDF/DOCX/PPTX 材料定位、用户/工作区 Skill 撤权、创建结果三步 Batch 与 buttonCheck 有直接证据；T01/T02/T05/T06 登记 passed。动态图文桥接 `dynamic-content-bridge-electron-r1.log` 1/1：M15 Runtime 文案/Component 图片经 renderer→Main→外部 MCP 发现，Runtime 文案正式 ACK、revision 0→1、画面与回读一致。`dynamic-fallback-electron-r2.out.log` 的真实 Electron 隔离候选 Published 截取 720×400 精确层 PNG，文案改变后像素改变，正式一次 ACK/Undo 且 V9 保存重开保留源码和新后备图。Spatial/命名状态明确不支持；非选中 HTML/第二路预览与压缩后动态 dirty 稿全链未验完，T03/T04 保持开放。
- M28：固定 Podman 后端真实文件、网络与子进程边界、作业持久回执和停止/恢复，T01/T02 登记 passed。独立图像真实生成/编辑缺已确认可用的模型路由，T03 blocked。HTML 观察点击在真实 Electron 和本地严格模型 fixture 下 1/1 可用，真实视觉模型修正未验，T04 保持开放。
- M29：受管 Edge 网页读写/上传下载与外部 MCP 协议已有真实局部回执，T02 登记 passed；语音/视频/音乐最小框架的未配置、权限、停止边界 17 项集成集中覆盖，T05 登记 passed，真实生成 T03 仍为 media-followup。M29-T01 的可授权搜索连接未配置；现有 Codex CLI 写策略使 T04 薄委派无法核实外部写成果，均登记 blocked，不放宽写验证标志。
- M30：`m30-real-compute-r5.log` 的 Podman 图表/数据/HTML 保存重开是完整**本地模型 fixture**链。唯一真实 GPT OAuth `gpt-6-luna` scratch Run 有 11 次完成响应，240 秒 Stop 时第 12 次 aborted/unknown；写出 Python、JSON、HTML、CSS，HTML 可关闭重开，但 `computed.json` 和 `chart.svg` 未封存，图表引用缺资源，**T04 实质未完成并登记 failed**。`m30-real-model-r2-send.log` 及 `B24_M30_INDEPENDENT_MATRIX_2026_09_29.md` 记录了测试脚本未保留 compute job 正文和隔离 profile 的证据限制；没有追加同因付费请求。T01–T03 局部实现与验证存在但尚未覆盖整项，T05–T07 受搜索/图像/外部写连接阻断；T08 留给 Owner。

23 份小体量关键日志已复制到本包 `evidence/logs/`，作为本次提交可携带的聚焦证据；原 `output/g20/` 日志保留在本机。上文早期“尚待测试”和“Docker 未就绪”是实施过程快照，以本节及现行 `task_registry.json`、`acceptance_cases.json`、`PACKAGE_QA.json` 为准。
