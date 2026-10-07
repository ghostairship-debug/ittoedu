# R-A1 独立结构审查（滚动）

审查者：R-A1，未参与所审产品实现或测试断言编写。工作区仅写本文件，未修改产品、测试或 R0 记录。

基线：`afc65c9e`。第一轮证据 cut：`c234c618`；随后仅跟进相关增量，不因新 cut 重跑未变证据。发行继续暂停。

## 当前结论

- I 的 K02/K03/K06（`63f5a40c`，集成 `b74bd96b`）、A01（`8610bd8d`/`4bf903e7`/`ace258e6`）、U K04（`9edc3c6b`）、固定 A 的 A06/A07（`536d9dbc`/`ba23baef`，另含 `7f740d94`）在本次 writer、身份、资源与 History 范围内可推进。未发现需要新增审批门、第二 owner 或平台的依据。
- TE01 的 `c234c618` 存在独立 T03 已复现的未完成输入恢复问题；`e41184a6`（集成 `d98d22a7`）按原合同补存 `resumeRequired`，静态路径对应原失败，等待同一反例的最新执行结果。
- 新发现一个不同的生命周期反例：面板先挂载、恢复稿后到达时，恢复 owner 替换 cache 对象，但已挂载 textarea 仍引用原对象。已交 Root 安排独立 T03 按该次序验证；未把此源码推导冒称已执行失败。
- 当前 GUI/tool 保存与 close 的完整草稿收集由 U 的后续接线承担；高级草稿 port 已有最近层测试，并不单独证明真实 Ctrl+S、正常关闭、冷开链已完成。

## 审查依据与实际边界

已读本轮 EXECUTION_PROMPT、README、VALIDATION_REVIEW 的 R1/T01/T03/T10、WORK_PACKAGES 对应结果，以及开发入口、当前状态、任务板、WORKING_PROTOCOL §1.1/§3.1 和 ARCHITECTURE_CONTRACT 的当前 V10/资源/唯一 writer 条目。

审查使用实际 baseline/diff、直接 producer/consumer 与原独立失败；未把作者摘要当验收，未运行构建、付费调用或重复矩阵。

### I：内容绑定、富文本与能力默认可用

检查 `DocumentToolGateway.ts`、`ToolTargets.ts`、`ToolCatalog.ts`，以及 SelectionContextController、elementCardController、ExecutionEngine 的直接 consumer。

- 内容提取仍以宿主冻结目标为准；富文本保留链接、混合样式和公式表示，软件维护公式身份。返回内容经同一 `text.replace`、捕获字段期望、Driver 和 DocumentSession；没有绕过正式事务。
- 富文本长度变化使用实际解析后文本长度计算 splice，不把 HTML 字符数当选区长度。范围外 inlines、frame 与样式未被整对象替换。
- 目录展示与实际授权分离后，执行仍检查当前 allowed 集、具体目标授权、停止状态和最终 CAS；已经提交的回执在重放时优先读取，不重新执行已知成功写入。
- `applyBoundContent` 的真实 ExecutionEngine 接线另有 `e5b8626e`；仅 Gateway 的绿测试不证明真实模型协议，真实 wire/receipt 问题由 R-S1 独立跟进。

### A01：分页观察、Flow 正文身份

检查 coordinator 的 remember/read/acknowledge/canonicalComponentFileEdits、Markdown lexer/identity map，以及 `flowDocumentEdits` 的实际实例 consumer。

- 连续分页固定原 capture，后续页不会把未读的教师修改变成新基线；明确从 offset 0 重读才取得当前观察。
- ACK 投影与真实 Session capture 有区别；正式写入仍比较原字段期望，不因观察缓存共享而提升权限或吞掉人工变更。
- Flow 普通正文的 markerless 修改以位置映射保身份；显式 opaque 对象身份优先。局部不支持片段给诊断并保存源文，避免整正文退化为 HTML 后丢失活对象。
- `flowDocumentEdits` 从现有实例扩展专业数据并保留人工 frame/style，删除与移动仍经 canonical commands。

原失败 `e/output/e-initial-tests.txt`：分页尾片从 blue 被换成教师 cyan；Flow interaction 变为新 UUID。`c234c618` 的独立 T01 对这两个原反例已通过，并含 undo/redo、保存与新 Host 冷开。

### A06/A07：恢复隔离、资源共享与 History

检查 DocumentSession 全部变更路径、CourseV10Driver、courseV10Operations、资源 helper、archive codec 与 documentJournal。

- 不可读日志只占用可证明属于它的 document/path；未知 owner 不封锁全部 workspace。短日志没有任何已提交恢复点时保留原件，不能按可修复尾部截断。
- Session `nextState` 只复制可变容器；V10 operation 复制 project，资源新字节进入时复制，未变字节在 Session 所有快照中共享。公开 read/commit event/persistence 输入仍脱离内部别名。
- History amendment 替换 entry 对象，避免 append 失败时污染已确认 head；模型只在持久 append 成功后成为正式 state。
- 去掉的是重复 project/resource 深拷贝和已验证 snapshot 的重复验证；candidate project 仍由 applyComponentOperation parse，资源闭包与专业数据仍在 Driver 检查。withRevision 仍保整数和单调要求。

独立 T10 `historyResourceOwnership.test.ts` 覆盖输入/public-read 字节不能回写正式状态、正文 History 的共享资源、asset replace→undo→restore→redo→save→cold-open。`c234c618` 无 T10 失败。原短损坏日志反例的期望修改有依据：短文件原来落在 torn-tail 分支；完整坏 header 用于证明未知 owner 隔离，短文件保原另有独立补例，二者不混作同一失败。

### TE01/TE02：草稿与正式写入关节

检查 courseDraftLifecycle、ComponentSourceEditor、DeveloperTab 及 PropertyControls 的 prepare/preserve/restore 注册合同；普通控件内容行为由 R-S1 审查。

- 草稿缓存保存原目标/原输入；正式写入只走 Bridge 的 captured edit，DocumentSession 仍是唯一 History。
- 自然边界和保存准备复用 single-flight Promise；未变 JSON 不制造 History。保存源码与运行通过是两个结果，不能因为任意源码尚不能运行而补通用存储门。
- 独立 T03 已证明源码与对象 JSON 在原对象上应用、一次正式 History/操作、保存冷开；未完成输入必须保持原状态而不自动提交。

## 精确问题与最低剩余证据

### R1-F1：恢复未完成 IME 后，prepare 曾提交原未完成源码

证据：`c234c618`，`e/output/e-focused-c234c618.txt`，`advancedVisibleDraft.test.tsx` 的第二例。操作是 compositionStart→输入→preserve→新 Bridge restore→prepare；原文保持，但 prepare 返回 ready=true，原期望 ready=false。

根因：restore 保留了 raw，却把 composing 清除后没有保存“上次输入尚未结束”的语义。此结论不要求禁止保存任意语法错误源码。

候选修复：`e41184a6`/`d98d22a7` 把 saved.composing 变为 resumeRequired；prepare 拒绝自动提交，preserve 再次保留，用户继续编辑后清除，release/reset 清理。边界正确，最低证据就是原 T03 反例在含该补丁的固定 cut 通过，无需新矩阵。

### R1-F2：恢复晚于面板挂载，cache 对象与可见编辑器可能分离

源码路径：`sourceLifecycle.restore` 和 `codeLifecycle.restore` 使用 `cache.set(key, freshDraft)`；ComponentSourceEditor 的 draftRef / CodeDocumentEditor 的 current ref 只在 key 改变时切换。相同 key 的面板已经挂载时，会继续使用旧对象；restore 未通知旧对象的 listeners。

当前等级：有直接源码依据、待独立最小动作确认。当前 T03 覆盖 restore→render，没有覆盖 render→restore。

最便宜证伪：沿用现有 fresh Bridge fixture，先 render 相同对象的 Source/对象 JSON，随后 restore 同 target 的 raw，断言 textarea 显示 raw、History/revision 未变。若失败，仅该恢复关节须修复，不阻 A01/I/A06/A07。

### 尚未冒称完成的实际集成属性

- U 完成草稿收集接线后，复用一条真实 GUI Ctrl+S→正常关闭→新进程冷开链，含高级有效稿和一项保留原字符的未完成输入；port 测试不能代替 UI/磁盘持久恢复。
- 富文本 ExecutionEngine 最近层测试可证明内容绑定接线；实际模型 wire/协议和正式 receipt 另用该路径的已有独立证据，不由本审查泛化为所有模型通过。

