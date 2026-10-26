# P1 普通办公人工—AI 共编结果（2026-10-26）

**本批完成。** 集成主树中的普通 HTML 图文文档已走通人工编辑与加粗 → AI 读取当前未保存稿并局部修改 → 继续人工编辑 → 跨人工与 AI 撤销重做 → 保存 → 独立新进程冷开 → 离线 HTML 交付。实际 Electron 用例 1/1 通过，耗时 40.530 秒；这是真实产品链的自动化耗时，使用确定性本地模型服务，不是实际模型创作速度或质量成绩。

## 解决的问题

AI 卡片冻结一个语义字段后，正式 `read` 会返回该字段的新句柄。原 `StreamingEditArguments` 直接比较句柄字符串，将新句柄误判为编辑目标改变，导致模型按真实读取回执继续 `text.replace` 也失败。该阻断在完整 Electron 消费链中复现：读取内容精确等于人工新稿，随后编辑被拒绝为 `invalid-tool-arguments`，消息为“工具调用的编辑目标已改变”。

修复由已有三个 owner 各承担自己的职责：

- `DocumentToolGateway.sameEditTarget` 用既有句柄、Session 与 `resolve(write=true)` 核实同一 run、文档、epoch、当前 lease，以及两个仍可写的精确语义目标；只读、冲突或其他目标不被接受。
- `StreamingEditArguments` 仅在不同句柄字符串之间调用宿主提供的等价判断；没有宿主判断时保留原严格行为。模型不能自行声明别名。
- `ExecutionEngine` 的流式与最终参数解析共用这一接线。实际工具参数仍保留模型采用的读取回执句柄，不偷偷换回旧句柄。

没有新增别名注册表、授权来源或 writer。`prepareInput`、草稿投影、正式 Gateway 提交、最终 CAS、停止屏障与 History 保持原路径。Root 与另一未参与实现的原生子智能体独立审查生产边界，通过。

## 验证结果

| 验证 | 结果与证明范围 |
|---|---|
| 参数解析与真实 Engine/Gateway | 47/47：36 项参数解析、11 项 bound-content 集成。新增覆盖真实 `read` 别名、target-first/content-first/final-only 三种参数顺序，以及邻文、更大范围、其他文档/run、只读、未签发、撤权重附加、停止、人改冲突和跨进程恢复旧句柄拒绝。content-first 确认草稿先用冻结默认句柄开始，尾分片才出现读取别名，仍只有一个预览组和一次 History |
| 最终主树 Electron 连续任务 | 1/1；3 次确定性模型请求，正式 `read`、`text.replace` 各 1 次，provider errors 为空。人工正文、加粗及范围外段落、图片、链接、页脚样式保留；后续人工修改与双向撤销重做通过 |
| 保存与冷开 | 保存时 revision=8、undoDepth=4；磁盘源文等于当前正式 Session。另一 profile、新 Electron 进程获得新 documentId，revision=0、dirty=false，源文完全相同，文字、格式与图片保留 |
| 独立交付 | 新 Chromium 直接打开保存的 HTML，HTTP(S) 网络已阻断；正文、格式、图片解码和原有按钮交互全部通过，page errors 为空 |
| 类型 | 主配置、Electron、E2E 三份类型检查全部通过。`sequence` 的可选类型使用显式数值守卫，没有放松运行断言 |

原始证据：

- [定点 47 项报告](../../../output/product-execution-20261026/worktrees/p1/output/product-execution-20261026/validation/p1-target-alias-final.json)。
- [最终 Electron 报告](../../../output/product-execution-20261026/validation/p1-coediting-final.json)、[stdout](../../../output/product-execution-20261026/validation/p1-coediting-final.stdout.log)、[stderr](../../../output/product-execution-20261026/validation/p1-coediting-final.stderr.log)。
- [连续链事实与阶段计时](../../../output/product-execution-20261026/p1-coediting/run-l77S7C/evidence.json)、[保存前界面](../../../output/product-execution-20261026/p1-coediting/run-l77S7C/coediting-before-save.png)、[独立冷开](../../../output/product-execution-20261026/p1-coediting/run-l77S7C/independent-cold-open.png)、[离线交付](../../../output/product-execution-20261026/p1-coediting/run-l77S7C/standalone-html.png)。
- [可复现连续任务](../../../tests/e2e/ordinaryHtmlCoediting20261026.spec.ts)。隔离 profile 和本地 provider 由测试自行创建；可用 `GUOLING_P1_APP_PATH` 指向当前私有 Electron 构建。

## 基线与测试修正

复用 10 月 25 日已通过的 [HTML 编辑与当前稿捕获](../20261025-html-edit-repair/RESULT.md)、[快捷键](../20261025-html-shortcuts/RESULT.md)和[格式/保存冷开](../20261025-format-core-repair/RESULT.md)证据，没有重做整批修复。本轮新增连续任务把这些能力接到真实 Engine 与同一次交替编辑流程。

初期测试的旧模型设置文案、HTML 工具栏作用域、AI 卡片上下文分支选择均按当前真实 UI/协议修正；这些属于测试适配，不计作新产品缺陷。原 bound-content 测试另有只读任务结束后要求整个 snapshot 不变的旧断言，已在未修改生产基线上复现同样失败：正式 stop 会记录文档 lease 并使恢复日志 `sequence` 增加 1。现精确断言该增量及 `stoppedRuns` 唯一新增记录，其余 snapshot 字段仍完全相等，保留内容、revision、History、dirty 与绑定保护。

## 交付边界

本批验证代表性普通 HTML 图文办公共编，不扩展完整 Office 兼容层，也不宣称全部文件、物理 IME 或全部 GUI 已验收。HTML 交付复用现有保存及原始文件运行能力，没有新增导出协议。实际模型创作质量和原生 GLX 采用由本轮其他工作线独立验证。正式源码已由 Root 集成，未执行 commit、push、发布或重启用户窗口。
