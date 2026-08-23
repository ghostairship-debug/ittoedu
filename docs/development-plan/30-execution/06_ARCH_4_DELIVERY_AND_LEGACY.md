# ARCH-4：Preview、Player、Export 与 Legacy consumer 迁移

目标是保护 Published V2 主路径，并让所有用户可达交付路径读取明确的 V9/Published/static plan，不把缺失编辑会话当作回退到 V8 的理由。

## 1. Sessionless V9 是编辑错误状态

在打开的 V9 编辑工程中，导出/预览需要当前有效 authoring session/snapshot。若会话缺失或过期：

- 返回可行动错误并允许重建当前会话；
- 不读取 `state.project` 或 V8 projection 继续导出；
- 不静默选择另一个 nullable session；
- 不把错误状态描述为“合法的 sessionless 编辑主路径”。

独立 headless/script 场景必须显式接收合法 V9 document/archive input；它与编辑器缺失 session 是两种不同合同。

## 2. 迁移波次

### W4-A Preview / HTML / Web

保护 V2 producer、component/runtime bytes、size warning 和错误反馈；移除 V8 fallback consumer。

### W4-B 静态格式

- PPTX：使用 V9/static export plan，尽量保持文本/图形可编辑；
- PDF/preflight：使用 Published/print plan，按目标格式给 actionable warning；
- DOCX：保持现有 Flow 适用范围，不伪造全面支持。

### W4-C Diagnostics / Fixtures / Release

迁 Project Health 的旧输入；逐个决定 V8 fixture、benchmark、release verifier 和仅 Legacy 测试的替代或保留价值。

## 3. 自动并行

- Worker A：Preview/HTML/Web adapter 与测试；
- Worker B：PPTX static plan；
- Worker C：PDF/preflight/diagnostics/fixtures 中一张独立卡；
- Coordinator：Published producer、App export orchestration 和热点接入。

Published producer 同一时间只有一个 Owner；不同格式 adapter 可在 producer 只读时并行。

## 4. 完成门槛

- Save 与 Published V2 主路径未被重写；
- 缺失/过期 session 显式失败且不回退 V8；
- Preview、HTML/Web、PPTX、PDF/preflight 的目标输入明确；
- DOCX 适用范围准确；
- 三份代表工程的适用格式行为一致；
- Legacy consumer 起始数、迁移数和剩余数可复核；
- 输出视觉/可编辑性变化经目标格式人工复核。

不同格式不互相作为阶段阻塞：一个格式无法安全迁移时可 `parked`，但不得伪造已完成或删除其旧消费者。
