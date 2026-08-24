# ARCH-4：Preview、Player、Export 与 Legacy consumer 迁移

目标是保护 Published V2 主路径，并让实际准入的用户可达交付路径读取明确的 V9/Published/static plan，不把缺失编辑会话当作回退到 V8 的理由。

本文件只界定候选交付问题域，不要求为每种格式建立迁移卡。每个格式先以当前可复现结果、真实 consumer、明确替代目标和 skip condition 独立准入；没有合格风险的格式可以保持现状或记录为 `retained`，不因阶段标题施工。

## 1. Sessionless V9 是编辑错误状态

在打开的 V9 编辑工程中，导出/预览需要当前有效 authoring session/snapshot。若会话缺失或过期：

- 返回可行动错误并允许重建当前会话；
- 不读取 `state.project` 或 V8 projection 继续导出；
- 不静默选择另一个 nullable session；
- 不把错误状态描述为“合法的 sessionless 编辑主路径”。

独立 headless/script 场景必须显式接收合法 V9 document/archive input；它与编辑器缺失 session 是两种不同合同。

## 2. 候选格式域与准入

以下分组只用于盘点独立风险和写入热点，不是固定波次或完整施工清单。

### W4-A Preview / HTML / Web

若实际改动 Preview / HTML / Web，必须保护 V2 producer、component/runtime bytes、size warning 和错误反馈。只有已证明可达且已选择替代或删除的 V8 fallback consumer 才进入迁移；仍有兼容用途和明确 Owner 的入口可以保留。

### W4-B 静态格式

- PPTX：仅在已复现格式错误或选定旧 consumer 时使用现有 V9/static export plan 做最窄修复，保持适用的文本/图形可编辑性；
- PDF/preflight：仅处理已复现的 Published/print 输入或目标格式 warning 缺口；
- DOCX：默认保持现有 Flow 适用范围；没有具体缺口时不生成迁移卡，也不扩大范围。

### W4-C Diagnostics / Fixtures / Release

只对已选定的 Project Health 旧输入、V8 fixture、benchmark、release verifier 或仅 Legacy 测试做 consumer 盘点，并明确选择 `retained`、迁移或 deletion-candidate。盘点本身不承诺迁移或删除。

三个候选域都允许零张实现卡；一个格式的准入、跳过或保留不构成另一格式的依赖。

## 3. 仅对已准入卡并行

Coordinator 只为已准入且写入范围独立的格式动态分配最多三个 Worker；不预留固定的 Preview、PPTX 或 PDF 工作流，也不为了占满并发创建任务。Published producer、App export orchestration 或其他热点仍由 Coordinator 单写者接入。

Published producer 同一时间只有一个 Owner；不同格式 adapter 可在 producer 只读时并行。

## 4. 完成门槛

- Save 与 Published V2 主路径未被无意重写；
- 若本阶段改动缺失/过期 session 行为，该行为显式失败且不回退 V8；
- 只有已准入或实际修改的格式需要证明其目标输入和行为；未准入格式引用 skip/retained 结论；
- 三份代表工程只在本阶段改动使对应格式证据失效时运行适用子集，否则复用最近有效证据；
- 发生 Legacy 迁移时，精确 consumer 起始数、迁移数和剩余数可复核；`retained` 项只记录用途、Owner 和重访触发条件；
- 只有输出视觉或可编辑性发生变化且 focused 自动化不能直接观察结果时，才增加对应目标格式人工复核。

不同格式不互相作为阶段阻塞：一个格式未准入、明确保留或无法安全迁移时可跳过或 `parked`，但不得伪造已完成或删除其旧消费者。
