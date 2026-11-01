# 关键写入、状态与运行权限的独立复核

日期：2026-10-31。承接仓库根目录《果铃创作问题独立核查与开发方案-2026-10-31.md》。本记录只说明本轮实际修改及其相邻消费者，不将定向通过扩大为全仓或所有旧作品兼容证明。

## 复核分工与证据

三个 ChatGPT 原生子智能体分别承担观察/预览、模块/资源/版本、协作/上下文实现；Root 集中向真实 Windows 仓库做整批哈希前置检查、应用与验证。W2 的 writer 由 W5/W8 实施者另行审阅；W5/W8 的真实 diff 由 Root 审阅；W4 由未实施其核心存储的观察分支审阅。共用的 DocumentToolGateway、ExecutionEngine 与 Runtime 文件由 Root 统一集成。

接手前工作树含既有未提交成果。比较依据是本轮接手快照及每批写前哈希，不是把 Git HEAD 当作无其他修改的开发起点。原作 r10、先前失败候选、旧 copyRoot 和历史报告均保留。整批 preflight 先于任何文件改写；源码与构建结果分别记录。

## 一 模块与依赖保存：保留唯一作者 writer

独立复核读取了模块投影、coordinator、资源准备、AgentFileText、documentSourceResources 与正式保存路径。新增虚拟模块文件只从作者 `data.modules` 派生；地址同时绑定实例与原始模块键。`content`、`edits`、`from` 都落到原 DocumentSession 事务及叶字段期望，不引入第二份作者目录。

新增媒体闭包由内部准备步骤生成，公开 schema 没有增加任意资源写口。资源与模块变更一起进入一次逻辑 History。未知外改仍走已有冲突保护；同任务已知 successor 只有在实际磁盘哈希仍等于已确认末值时才可用，已打开依赖的未保存稿优先。该版本链是进程内辅助信息，冷启动或路径变化可保守恢复为冲突，不宣称自动合并服务。

定向消费者验证了模块局改、相邻模块保全、Undo/Redo、真实磁盘附件和静态 URL 媒体。原作修复也实际通过相同模块入口、正式保存和独立进程冷开。没有为了保存成功移除 journal 的末端保护。

## 二 协作、图片与内部装配：事实投影不扩大权限

Root 审阅了 ExecutionEngine、DelegationJobService、HostToolServices、AgentFileService、HostArtifactDeliveryService 及图像投影相关 diff。

- 回复身份来自既有 job owner；当前 delegatedBy、同树 peer 与 senderRole 是宿主事实。它们不提供父文档 writer，不把授权扩大到其他任务树。
- hostWorkFacts 只消除可辨认轮询中的查询定位字段。未知 receipt、新业务问题、状态变化和原始执行回执仍保留，未知副作用不因投影去重被重放。
- 图片压缩只改变 ActiveRun 的模型 working messages。原图、历史 record、UI/MCP 及显式原图读取保持原字节。派生失败或收益不足回退原图，停止/取消继续传播，没有新的持久图片 owner。
- 当前装配根由宿主按 run 建立；合法续接祖先根只读。实际来源解析用最窄授权 realpath，不以共同 runs 上级或 full 权限读到邻居。显式用户 destination 仍按旧规则；省略 destination 的内部复制标记为 assembly，不冒充交付。
- 原历史副本不迁移、不删除。本轮只调整新装配默认落点，没有以“父完成”或“保存成功”为理由做全量清理。

真实定向验证为 6 文件 25 项通过，后续零费用成本计量保持原始来源和回执可回读。独立 diff 复核没有发现新增阻断项；该结论不替代未来新权限反例的检查。

## 三 学习进度：不成为作者数据或第二个实时状态 owner

观察分支独立核查了 IndexedDB store、World、native bridge 与 compiled adapter，发现并推动修复了两个相邻消费者遗漏：临时观察不应启用持久化；直接 compiled `write(undefined)` 不应意外进入 clear。

最终语义为宿主 URL（去 query/hash）、稳定作品 ID 与作者 namespace 共同分区，异步 read 分清 ready/empty/incompatible/失败。成功读取的 revision 才能用于 write/clear；write 只接有限普通 JSON，null 有效、undefined 拒绝。跨窗口事务 CAS 与清档墓碑阻止旧窗口复活旧档；World 代次、abort 与 reply generation 阻止旧运行回执污染新局。

实时结果仍由原 runtime state 管理，学习快照不写 GLX、DocumentSession 或 History。native 内容继续 `sandbox="allow-scripts"`，没有增加 allow-same-origin。观察和输出捕获显式关闭进度能力。

Published native、Compiled native、Compiled semantic 三条真实离线单 HTML 消费者通过保存、刷新、整浏览器关闭重开、多窗口竞争、清档、无效输入与作者数据不变检查。原 r10 的自动续玩另外在正式修复副本中验证，不能用夹具替代作品主线。

## 四 OAuth affinity：只作传输提示，鉴权 owner 保持原样

四次真实固定正文 ABBA 样本支持当前正式 OAuth 通道接受 session-id，并显示该样本中的缓存关联。采用接线前，另核 Engine 会话、NativeTaskRunner 子会话、冻结连接版本、OAuth credentialRef 与普通 refresh CAS 的职责。

正式头只在原 OAuth 凭据解析、账号一致性与 token 格式检查通过后添加。范围包含宿主会话及用途、连接 ID/revision、账号、credentialRef、精确端点/协议与模型；确定性 UUID 只用于不透明命名，不承担鉴权。普通 token refresh 不换会话范围；新登录/新配置版本隔离。公共 API 原 `prompt_cache_key` 不变，正文没有增加私有缓存参数、response continuation 或会话状态。

新增 Provider 回归验证 body 字节不变、prepare 冻结、各身份维度分离、撤销/账号不匹配不能发送。连同真实 ExecutionSettingsStore、OAuthDesktopService 和刷新诊断回归，最终 6 文件 57 项通过。发现的一条旧测试将没有 machineError 的非 JSON 401 一律期望“重新登录”；仅纠正测试并补 invalid_grant、refresh_token_reused、invalid_client 分支，生产诊断合同未改变。

真实确定性头的正式消费者结果、安装包消费与新创作结论见同目录 RESULT。缓存比例、字节减少与一次任务墙钟分别记账，不能互相替代。

## 五 复核边界

本轮没有给通用 Harness、跨设备学习平台、全量历史清理或全仓测试作完成承诺。原作实际音频已录制，当前模型输入接口明确不支持音频听辨；解码、播放、字幕及数字削波结果不能充当听感或逐字口播核验。此能力边界在总结果中保留，不因其他测试通过被抹去。

## 最终接续直接复核（2026-10-31）

本阶段由接续者直接核查，没有新增调用子智能体。已读 Source imports 共同 owner、lease 接管/幂等释放及只读参考根，结合实际集成反例与包内消费者核实；未改相关产品源码。温室共享身份和注释之外业务语义、人改保全、History、冷开和交互相互对应。

验收脚本只将响应头/内容/工具前的 transport unknown 与同逻辑请求、同 payload 的成功重试关联，不容许错误模型、错连接、未恢复失败、换正文或部分响应蒙混通过；8 项检查通过。原 failed 报告保留并另写证据复核，不重新请求模型刷成功。最终包内 3 项 UI 和 Portable 冷启动/原生图片解码/正常退出通过，1,244 个包内构建文件匹配。并发结果先读取再合并，原稿保留。

最终证据索引为 `output/creation-execution-20261031/finalization-20261031/final-acceptance.json`。声音听感/逐字、一般速度目标、未知网络责任及跨设备范围不由这些结果外推。

## 接续复核补记：共享身份与最终打包消费

主 Agent 核对了原作人改后 AI 局改的原结果，没有重复该模型任务。温室 r17 的实际 import 闭包指向同一作者模块，业务源码除首行注释外字节一致，AST 相同；旧两份相同源码和真实常量变化的反例仍被拒绝。正式 History、冷开、离线五组动作和人改图片像素分别有证据，不能由单一源码哈希代替。

包内只读 AI 的失败原报告继续保留。请求证据区分同正文/同连接/同模型的成功重试与未知失败尝试，8 项正反例通过；启动占位标签与实际稳定工作区的哈希分别核查。03 消费者与另外发现的 final 消费者各有 6 次尝试，不合并费用、不额外运行模型刷通过。03 的复核通过真正打包 App 回读原公开事件及完整投影日志，原配置恢复，未声称看见未公开的 wire payload。

目录包的实际 UI 和内置资料消费通过，1,244 个随包构建文件匹配当前构建。Portable 在新配置下实际可见、解包代码与参考资料一致，自己的进程关闭；此前调试握手与关闭回执失败保留为夹具失败。原作听感/逐字、一般生产力目标和传输失败责任仍未获得证明。完整终态及保全见 resume-20261031/final-closeout.json 与 RESULT 第九、十节。
