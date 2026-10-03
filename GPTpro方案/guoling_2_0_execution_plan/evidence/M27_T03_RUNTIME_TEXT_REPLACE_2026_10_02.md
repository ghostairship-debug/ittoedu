# M27-T03 Runtime/Component 图文及 HTML 补丁 — text.replace 扩展验收记录

日期：2026-10-02
范围：扩展 `text.replace`，允许 AI 直接对 `content.targets` 发现的 Runtime/Component 文字字段短句柄执行文字替换；dispatch 走同一 admission + CAS + undo pipeline，复用 `DynamicContentEditPlanner` 的 fallback/校验/契约校验，不新增 ToolTarget.kind 或独立编辑服务。

## 实现要点（最小充分）

- `src/core/tools/DocumentToolGateway.ts` `invoke()`：`text.replace` 的目标字符串若存在于 `this.contentTargets`（即 `content.targets` 已发现），则要求 `field.kind` 以 `text` 结尾或为 `runtime.value`，否则以 `invalid-input` 拒（图片字段继续走 `content.update`），并调用现成的 `updateContent()` 事务。该事务包含 `resolve(source, true)` 的句柄 CAS、`planDynamicContentEdit` 的 admission/locked/locked-state/fallback-capture、`session.execute({ type: 'command', command: { type: 'course.replace', project, resources } })` 的 DocumentSession 最终 CAS 与 History，以及 `recordAppliedFootprints` 的 acknowledgement 链路。
- `src/core/tools/ToolCatalog.ts`：`text.replace` 描述补充"也接受 content.targets 为 Runtime/Component 对象发现的文字短句柄"。`manual.targetKinds` 不变（`markdown-range` / `course-object` / `flow-block` / `flow-range`），因为短句柄不是新 ToolTarget kind。
- 不新增 ToolTarget、handle 机制或 admission planner；不修改 Runtime 源码、不动 DynamicContentEditPlanner、不动 SoftwareDriver/TextDriver。

## 集成测试（真实 V9 fixture surface-runtime.h5lesson）

`tests/integration/g20M27RuntimeTextReplace.test.ts`（2 passed）在同一份正式 DocumentSession 上：

1. **一次正式事务可撤销保存重开，图文保态，Runtime source 不改**
   - `registry.create(surface-runtime model)` → `gateway.beginRun` → `issueTarget(course-object)` → `content.targets` → 取 `runtime.value: title` 的短句柄。
   - `text.replace({ target, content: '听录音，选出你听到的图片' })` → `status: 'applied'`；revision 0→1，runtime.source 字节不变，runtime.content.values.title 已替换。
   - `session.undo` → values.title 回到原声明文字；`session.redo` → values.title 回到新文字；source 仍不变。
   - `registry.save(documentId, file binding)` → `course.load(磁盘字节)`，重开项目 values.title 为新文字、source 持久字节不变。

2. **旧短句柄明确失败，不误拒提交**
   - 已 `applied` 后用同一短句柄再 `text.replace` → `kind: 'error'`（target-conflict 或 stale），绝不在新快照上静默复放。
   - `inspect` 新对象句柄 → `content.targets` 再次发现 → 第二次 `text.replace` 在同一份 DocumentSession 上 `status: 'applied'`，最终 values.title 为第二次文字；source 字节不变。

3. **伪 target 与 image 字段**
   - `'c-not-a-handle'`（不在 contentTargets 也不在 handles)→ `code: 'invalid-target'`。
   - 对 `kind: 'image'` 的短句柄执行 `text.replace` → `code: 'invalid-input'`，提示图片字段需走 `content.update`，不让 AI 把图片数据静默改成纯文本。

## 受影响既有测试

- `tests/integration/g20ToolGateway.test.ts`（35 passed，不变更）—— Markdown/plain-text/course text.replace 主链路仍走原有 markdown-range/native-text 分支。
- `tests/integration/g20DynamicContentEditPlanner.test.ts`（4 passed，不变更）—— Runtime/Component text/image planner 真实 fixture 事务及 fallback 身份校验仍独立覆盖。
- `npx tsc --noEmit` 零错误。

预存在的 `tests/integration/g20ScopedToolCatalog.test.ts` 两项失败（bytes 超 10000 与 names 不符）已在 HEAD 上验证为既有问题，与本批 text.replace 扩展无关。

## 覆盖 M27-T03 验收点

- 一次正式事务可撤销保存重开：同 session.execute（DocumentSession 唯一 writer + final CAS）→ undo → redo → registry.save → course.load from disk，图文与源代码字节均按预期。
- 图文保态、脚本明确重跑：`planDynamicContentEdit` 不变；`runtime.source` 不动；fallback 依旧由 host capture port 走（测试注入 fake port）。
- 第二路提示且不误拒提交：旧短句柄冲突路径返回 `kind:'error'`（target-conflict），不报 applied；重新发现后的事务正常 applied。
- 非选中 HTML 图文样式/第二路预览占用：宿主端 renderer/preview 已有机制不变，本批只扩展 text.replace 的 target 范围与 admission 检查，未触动预览占用 admission/lifecycle。
