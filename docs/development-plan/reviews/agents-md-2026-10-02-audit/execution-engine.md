# 执行引擎过程门 审计报告（AGENTS.md 2026-10-02 原则违反）

来源：子智能体只读审计；运行 ID：ac8a1a55900996264

# 审计报告：src/main/workbench/execution/ 违反 AGENTS.md 2026-10-02 原则的设计

本报告按"直接阻止用户已明确授权的操作 → 过程层冗余但不致命 → 局部摩擦"顺序排列。每条均给出文件绝对路径、行号、原文摘录、违反的原则、对用户的具体摩擦。不提供修复建议。

---

## 一、最严重：直接阻止 AI 完成用户明确请求

### 1.1 `resume-observation-required` 整套过程门（最严重，直接拒绝已授权写入）

**文件**：`D:\果铃工作台\src\core\tools\DocumentToolGateway.ts:340-347`

```ts
requireReadObservation(runId: string): void {
  if (this.run(runId).stopped) throw new ToolError('run-stopped', '任务已停止')
  this.observationRuns.add(runId)
}
private assertObserved(runId: string, snapshot: DocumentSnapshot, targets: readonly ToolTarget[]): void {
  if (this.observationRuns.has(runId) && targets.some(target => !this.readCoverage.has(runId, snapshot, target)))
    throw new ToolError('resume-observation-required', '继续修改前需读取该目标的当前内容；可以分段或分页读取，无需读完无关文档。')
}
```

**出口（"resume-observation-required" 的实际抛出点）**：
- `DocumentToolGateway.ts:346`（唯一字面抛出点）

**触发位置**：
- `DocumentToolGateway.ts:1081`：`this.assertObserved(runId, snapshot, [...targets, ...destinations..., ...layerTargets.flat()])` — 每次 batch 写工具执行前都要先过这一关
- `DocumentToolGateway.ts:344-347` 定义
- `ExecutionEngine.ts:538`：`if (continuation) this.options.gateway.requireReadObservation(runId)` — 每次续跑（continuation）就无条件挂上门

**配套过程层**：
- `DocumentToolGateway.ts:178` 引入 `ToolReadCoverage` 作为状态追踪
- `DocumentToolGateway.ts:449`（`previewTarget`）、`DocumentToolGateway.ts:1603`（`read` 方法内）记录"已读字节区间"
- `D:\果铃工作台\src\core\tools\ToolReadCoverage.ts:36-101` 一整个 class 专门维护"已读覆盖表"
- `DocumentToolGateway.ts:546` `stop()` 里 `this.readCoverage.clear(runId)` + `this.observationRuns.delete(runId)`
- `DocumentToolGateway.ts:713` `this.readCoverage.advance(...)` 在每次提交后还要维护"已读覆盖跟随编辑迁移"

**违反的原则**：
- AGENTS.md §"一致性保护的现实边界"明文写道："**禁止额外加'先 read 再改'、'明确授权才允许改'、'not authorized 层层校验'之类的过程层双保险**——那只源于 AI 对'万一出错'的防御假设。"
- 这一段就是最字面的"先 read 再改"：在每次续跑后、每次 batch 写工具前，用一张主机侧"已读覆盖表"判断 AI 有没有"读过这一段"，没读过就 throw 出 `'resume-observation-required'`。
- AGENTS.md §"模型与软件的职责分工"：职责是"最终 CAS 校验冲突"，而不是"过程层核对 AI 的行为序列"。这一段属于"AI 在 commit 之前显式 read 或 validate 来'防止出错'"，**执行端 CAS（issueTarget 的 epoch 校验、`resolve()` 的 footprint 校验）本来就能防止错写**，但 Gateway 又叠加了一层"先读再改"流程。

**用户摩擦**：
- 用户在一个文档上对 AI 说"接着上一段继续改"——一个完全明确、已授权的请求——只要续跑，就被挂上门。AI 第一次直接 `text.replace` 写从而报 `resume-observation-required`，必须掉头回去 `read` 一次再发起写，多一轮模型往返、多一次 token、多几秒等待。
- `ToolReadCoverage.has()` 要求在 `target.kind === 'document'` 时**读满整个文档 source 长度**（`ToolReadCoverage.ts:88` 的 `to: snapshot.model.source.length`，`:96` 的 `seen && end >= to`）才算"已读"。长文档续写必须整本读完。
- 错误消息"可以分段或分页读取"承认了这是过程仪式而非真实需要——如果真要保护一致性，CAS 就够。

**案例**：用户在 Chapter 末尾说"继续给这一章再写两段"。AI 上一轮已经读到 N 行，本轮 continuation 触发 `requireReadObservation(runId)`；文档可能这期间被用户在编辑器里改过几个字，CAS 本来会识别 footprint 不一致并合理报 `target-conflict`——但这一层先把 `resume-observation-required` 抛出来，AI 必须先完整 read 一遍才能动手，用户视角就是"AI 卡顿、变慢、变笨"。

---

### 1.2 `file.write mode=replace` 的 `expectedVersion` 强制门（"先 read 再改"在文件层的等价物）

**文件**：`D:\果铃工作台\src\main\workbench\execution\AgentFileText.ts:100-114`

```ts
async write(context: AgentFileContext, filename: string, content: string, mode: 'create' | 'replace', expectedVersion: string | undefined,
  operationId: string): Promise<AgentFileOutcome> {
  ...
  if (!expectedVersion) throw new Error('覆盖文件必须提供读取时取得的版本')
  return this.replaceExisting(context, filename, content, expectedVersion, operationId)
}
```

**文件**：`D:\果铃工作台\src\main\workbench\execution\AgentFileText.ts:117-128`

```ts
async patch(context: AgentFileContext, filename: string, expectedVersion: string, oldText: string, newText: string, ...
  ...
  if (current.version !== expectedVersion) throw new Error('文件版本已改变，请重新读取后修改')
```

**文件**：`D:\果铃工作台\src\main\workbench\execution\AgentFileText.ts:132-140`

```ts
private async replaceExisting(...): Promise<AgentFileOutcome> {
  return this.host.fileCoordinator.withFileOperation(async () => {
    await this.host.assertFileAvailable(filename)
    const current = await this.source(filename)
    if (current.version !== expectedVersion) throw new Error('文件版本已改变，请重新读取后覆盖')
    ...
```

**违反的原则**：
- `expectedVersion` 在 AI 侧只有通过"先 read"才能获得。这就是把"先 read 再 write"硬编码成**接口前置条件**：AI 根本不可能在没 read 的情况下写出合法的 `expectedVersion`。
- AGENTS.md §"一致性保护的现实边界"已经明确说"唯一 writer / 最终 CAS"——CAS 由宿主侧 (`current.version !== expectedVersion`) 对比已经是真正的最终 CAS，没错。但**在 API 契约上要求 AI 必须先调用 read 拿到一个 version 字符串**，等于把"先 read"作为必要条件。 `replaceExisting` 里再做一次"current.version !== expectedVersion" 是合法 CAS；`write()` 里 `if (!expectedVersion) throw` 就是纯粹的过程门。

**用户摩擦**：
- 用户对 AI 说"把 X 文件改成下面这段内容"——路径和内容都明确。AI 想直接 `file.write mode=replace` + 新内容，被"覆盖文件必须提供读取时取得的版本"拦下；被迫先 read 整个文件、把 version 抄回来、再发 write。多一次模型往返，多一次 token，无谓延迟。
- 错误消息"请重新读取后修改/覆盖"在模型提示里又把"先 read"再强化一次（`ExecutionEngine.ts:639` system prompt "selection 条目若带 content…可直接据此修改…不必先读取"其实只对 selection 放行，普通文件路径仍走 read）。

---

### 1.3 `updateContent` / `resolve` / `attachRunDocument` 的 `not-authorized` 校验（在已合法授权路径上仍抛）

**文件**：`D:\果铃工作台\src\core\tools\DocumentToolGateway.ts:727`

```ts
if (write && !handle.writable) throw new ToolError('not-authorized', '目标不在本次任务的可写范围')
```

**文件**：`D:\果铃工作台\src\core\tools\DocumentToolGateway.ts:743`

```ts
if (write && !this.canWrite(run, snapshot, target)) throw new ToolError('not-authorized', '目标不在本次任务的可写范围')
```

**文件**：`D:\果铃工作台\src\core\tools\DocumentToolGateway.ts:883`

```ts
if (!mapped.writable) throw new ToolError('not-authorized', '动态图文目标不在本次任务的可写范围')
```

**文件**：`D:\果铃工作台\src\core\tools\DocumentToolGateway.ts:199,203,576`（图片目标、`run.epochs.has` 读权限）

**违反的原则**：
- AGENTS.md §"过严的权限拒绝"列明确列出"not-authorized 层层校验"。这一组 `not-authorized` 出现的位置是执行链路里多个不同关卡，而非单点的"最终 CAS"。
- `handle.writable` 由 `issueTarget` 时通过 `canWrite(run, snapshot, target)` 决策——它已经把"是否在本次 grant 内"在签发那一刻定型了。`resolve()` 又对同一 handle 再查一次 `canWrite(run, snapshot, target)`：同一份 grant 被"consult 两次"。

**用户摩擦**：
- 用户让 AI 改一张图，AI 在 `dynamic.content` 流程里先 `discoverContent` 拿到一个 `writable=true` 的目标句柄，紧接着 `updateContent` 时 `mapped.writable` 又被查一遍；若主会话跨 epoch 或 `dynamicCandidates` 与 `contentTargets` 之间任何一次状态微抖，就抛 `not-authorized`。用户视角是"AI 明明拿到句柄、却不能写"——典型的 **"AI 变笨"**。
- AGENTS.md 的判断是"软件应该精准执行、不要层层校验"：frozen grant + CAS 已经足够；同一份数据被多次以"权限"名义拒绝属于无摩擦原则的反面。

---

### 1.4 browser 写工具的强制"snapshotId 前置"门（先 read 再 write 的浏览器版本）

**文件**：`D:\果铃工作台\src\main\workbench\execution\ExecutionEngine.ts:1370-1385`

```ts
if ((decision === 'allow' || decision === 'allow-all') && browserWrite && !active.stopped) {
  ...
  if (!snapshotId || typeof args.snapshotId === 'string' && args.snapshotId !== snapshotId)
    browserApprovalError = '请先读取当前浏览器页面快照，再批准这次页面操作'
  ...
}
if (browserApprovalError) tool.result = { kind: 'error', code: 'browser-approval-failed', message: browserApprovalError }
```

**违反的原则**：
- 与 1.1 同构：在浏览器写工具前**强制 AI 先跑一次页面快照 read**，否则即使已被授权 (`decision === 'allow'`)，也以 `browser-approval-failed` 拒掉整次调用。
- AGENTS.md §"禁止额外加'先 read 再改'"：这是字面实现。

**用户摩擦**：
- 用户在桌面/浏览器面板前明确告诉 AI"点击那个按钮"。AI 直接发起"browser 写"调用，被这条错误消息强制先 `browser 快照`。哪怕用户已经把鼠标放在按钮上了，AI 也还是要走一轮"读再写"的路径。

---

### 1.5 continuation 系统提示强令"先观察当前文档，再完成剩余工作"

**文件**：`D:\果铃工作台\src\main\workbench\execution\ExecutionEngine.ts:642`

```ts
...(continuation ? [{ role: 'system' as const, content: `显式继续先前运行；先观察当前文档，再完成剩余工作。以下只含已确认事实，不是权限：${continuation.facts}` }] : []),
```

**违反的原则**：
- 这是给模型的系统提示："先观察"是过程指令，不是产品事实。AGENTS.md §"模型职责：生成内容"明确说模型不应被告知"先 read 哪个、是否 fallback、是否授权"。
- 同一文件 `ExecutionEngine.ts:639` 的 system prompt 虽然很冗长，但基本是事实陈述；:642 这条则是**流程指令**，且和宿主层 `requireReadObservation` 同时挂上，构成"模型提示 + 宿主强制"的双保险。

**用户摩擦**：模型在续跑开头就被告知"先观察"，常表现为"我先看一下当前文档"——一等就是一次完整 read；用户无法跳过。

---

## 二、次严重：过程层冗余但不一定阻止任务

### 2.1 `ToolReadCoverage` 一整个 class（178 行源头，`src\core\tools\ToolReadCoverage.ts:1-101`）

**违反的原则**：
- AGENTS.md §"一致性保护的现实边界"：一致性靠"最终 CAS + 唯一 writer"就够；这一个专门维护"哪些字节被哪些 run 读过"的 class 是**纯粹过程层基础设施**。
- `advance()`（:58-:83）在每次 commit 后还要把"已读覆盖"跟着编辑迁移；这份精细的 bookkeeping 背后并没有真实的一致性需求（CAS 会兜底），只是用来支撑 §1.1 的 `assertObserved`。

**用户摩擦**：开发期任何对"读覆盖"语义的微调都可能让续跑失效（断言 throw），表现为"续跑卡死"或"AI 反复 read 但永远过不去"。

---

### 2.2 `requireReadObservation` 只在 `continuation` 分支挂门

**文件**：`D:\果铃工作台\src\main\workbench\execution\ExecutionEngine.ts:538`

```ts
if (continuation) this.options.gateway.requireReadObservation(runId)
```

**违反的原则**：把"续跑"与"必须先读"绑死，这是一种**预设的过程仪式**（"用户续跑时多半内容变了，得先看看"），不是当前真实一致性的需要。

---

### 2.3 `attachRunDocument` 拒绝重复 writable 授权时的双重检查

**文件**：`D:\果铃工作台\src\core\tools\DocumentToolGateway.ts:350-369`

- `:357` `this.assertWriteTasksAllowed({ ...run.grant, documents: [...] }, new Map([[documentId, generation]]))`
- `:358-360` 若 `run.epochs.has(documentId)` 则 `this.authorizeDocument(run, snapshot)` 后再 return

**违反的原则**：检查"文档是否已经在 grant 里"+"是否已写过"是幂等合法的；但 `:357` 的 `assertWriteTasksAllowed` 同一个调用在前面 `beginRun` 已经做过一次（`DocumentToolGateway.ts:312` 与 `:331`），这是同一道门挂两次。

---

### 2.4 `AgentFileService.preflightMutation` + `requireMutationScope` 同一权限被查两次

**文件**：`D:\果铃工作台\src\main\workbench\execution\AgentFileService.ts:74-108, 117-122, 124-181`

```ts
async preflightMutation(...) {
  if (context.permission === 'read-only') throw new Error('只读任务不能修改文件')
  ... full mayWrite/mayRead checks for every path ...
}
private async requireMutationScope(context, paths, copySources = 0) {
  if (context.permission === 'read-only') throw new Error('只读任务不能修改文件')
  for (let i = 0; i < paths.length; i++) {
    if (i < copySources && await this.mayRead(context, paths[i]!)) continue
    if (!this.mayWrite(context, paths[i]!)) throw new Error('工作空间外修改需要当前操作的明确批准')
  }
}
async execute(...) {
  ...
  const scope = await this.preflightMutation(context, name, input)
  await this.requireMutationScope(context, scope.paths)
  ...
```

**违反的原则**：
- 同一组路径的 `mayWrite` 检查在 `preflightMutation` 里 (`:85` `await this.filename(context, input.path, 'write', true)`，`:88` `:95` 等) 已经跑过一次，然后 `requireMutationScope` 又跑一遍——同一权限决策被**重复验证**。
- AGENTS.md §"not authorized 层层校验"：这是字面例子。`preflight` 本来用于 UI approval 卡展示，`execute` 阶段再做一次是合理的 CAS，但这两个函数都把 `mayWrite` 用 throw 的方式表达为独立 reject 路径，没有"看一遍就够"的去重。

**用户摩擦**：AI 想在工作空间内改名一个文件，两次相同的 `mayWrite` 校验都过，性能无问题；但只要 sign atPoint where realpath/lstat 抖动（被外部文档刚保存触发）就可能第二次挂——用户视角是"AI 在文件名明明没改的路径上忽然失败"。

---

### 2.5 `file.list / file.search / file.open / file.grep` 每次调用 realpath + lstat（Go 式防御但实质是路径授权）

**文件**：`D:\果铃工作台\src\main\workbench\execution\AgentFileService.ts:42-64, 127-163`

```ts
private async directory(context, raw?, allowOutside = false) {
  ...
  try { directory = await fs.realpath(wanted) }
  ...
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('目标不是可访问文件夹')
  if (!allowOutside && !await this.mayRead(context, directory)) throw new Error('当前权限不允许访问工作空间外文件夹')
  ...
}
```

**违反的原则**：
- 符号链接 + 工作空间外访问的授权决策被分散到 `directory()`、`filename()`、`filenameOrDirectory()` 三处，每次 read/list/search/open/grep 都重复跑同一套。
- AGENTS.md §"软件职责：最快读取"——模型需要上下文时应该走直接通道；而这里每次 list 一个目录就要做 2~3 次 FS 系统调用（realpath、lstat、可能 realpath readOnlyRoots）。读取路径上的摩擦被"防御符号链接"这个动作代价化了。

**用户摩擦**：在工作空间里 `file.list` 一个目录，每次都付出多次 FS 调用的延迟；列表大时体验明显。

---

## 三、较轻：不必要的 reject / 责任上抛

### 3.1 `EditSessionService.begin/start/snapshot` 的 reject 链

**文件**：`D:\果铃工作台\src\main\workbench\execution\EditSessionService.ts:82-90, 96-117, 167-184`

```ts
if (!request.editId || !request.runId || !request.targetHandle) return Promise.reject(new EditSessionError(request.editId, 'invalid-edit', '编辑组缺少宿主身份或授权目标'))
const existing = this.entries.get(request.editId)
if (existing) return this.active(existing) && this.sameRequest(existing.request, request)
  ? Promise.resolve(structuredClone(existing.snapshot))
  : Promise.reject(new EditSessionError(request.editId, 'edit-id-used', '编辑组编号已使用，不能重启或更换目标'))
if (this.cancelled.has(request.editId)) return Promise.reject(new EditSessionError(request.editId, 'edit-aborted', this.cancelled.get(request.editId)!))
const pending = this.beginnings.get(request.editId)
if (pending) return this.sameRequest(pending.request, request) ? pending.promise
  : Promise.reject(new EditSessionError(request.editId, 'edit-id-used', '等待授权的编辑组不能更换目标'))
```

**违反的原则**：
- AGENTS.md §"不必要的 Promise reject"：软件本可以部分 resolve 并备注局限。
- 同 `editId` 进来但 `sameRequest` 不一致就整条 reject 为 `'edit-id-used'`——这是一种状态机洁癖。软件本可以返回"existing 句柄"+"你给的参数不一致"的 resolve，由 AI 决定要不要换 editId；但实际设计让 AI 在 catch 里只能说"无法编辑"。
- `'edit-aborted'` 也是同样模式：哪怕 pending 已经不存在，只要 cancelled 集合里留过名，后续任何同 editId 调用都被判死刑。

**用户摩擦**：AI 一旦某次编辑组被 abort（可能因为底层文档某一次短暂保存），这个 editId 永久不能复用，AI 就得教用户"重新开始一次编辑"——把内部状态机暴露给用户。

---

### 3.2 `AgentFileText.read` 对打开文档的"二次验证"（先以文件读，再用 Gateway read 校验一致性）

**文件**：`D:\果铃工作台\src\main\workbench\execution\AgentFileText.ts:71-86`

```ts
if (current.snapshot) {
  try {
    await this.host.tools.attachRunDocument(context.runId, current.snapshot.documentId, ...)
    const target = await this.host.tools.issueTarget(context.runId, current.snapshot.documentId, { kind: 'markdown-range', from: offset, to: end }, { readOnly: true })
    const receipt = await this.host.tools.execute(context.runId, `${operationId}:source-observation:${randomUUID()}`,
      { name: 'read', input: { target, limit: Math.max(1, Math.ceil((end - offset) / 100)) } })
    if (receipt.kind !== 'read' || (receipt.data as { text?: unknown }).text !== current.source.slice(offset, end))
      throw new Error('正式文档观察与文件读取不一致，请重新读取')
    if ((await this.source(filename)).version !== current.version) throw new Error('读取期间文档已改变，请重新读取')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'unknown-run')) throw error
  }
}
```

**违反的原则**：
- 一个简单的"file.read"被升级为"先 read file → attachRunDocument → issueTarget → 再执行一次 Gateway read → 比较字符串 → 再读 source 比较 version"。
- AGENTS.md §"软件职责：最快读取。失败时能 fallback 到下一条通道而不是 reject 整个任务"：这里读完文件本来可以直接交付，但又叠加了"和 gateway 看到的文档字节必须一致"的二次校验，不一致就 throw "正式文档观察与文件读取不一致"。

**用户摩擦**：读取一个打开的 .md 文件，本来 30ms 的操作变成几次 round trip + 字符串比较；任何短窗口内的内存/磁盘差都会导致 reject。

---

### 3.3 `EditSessionService.abort` 后 `cancelled.set` 保留 `"已 abort"` 终身标记

**文件**：`D:\果铃工作台\src\main\workbench\execution\EditSessionService.ts:193-200`

```ts
abort(editId: string, reason: string): void {
  const entry = this.entries.get(editId)
  if (!entry) { this.cancelled.set(editId, reason); return }
  if (!this.active(entry)) return
  entry.snapshot.status = 'aborted'; entry.snapshot.reason = reason
  this.release(entry)
  this.emit({ type: 'edit.aborted', snapshot: entry.snapshot })
}
```

**违反的原则**：
- `cancelled` 集合在整个 service 生命周期内单调增长，**不被清理**。一旦 abort 过，任何 BEGIN 同 editId 都返回 `'edit-aborted'`。
- 这是典型的状态机洁癖——本来"abort 之后"清理状态让下次 begin 自然重来就足够；现在反而把它做成黑名单。

**用户摩擦**：用户连续做完两个改动，第二次复用前一次的 editId 会被拒，AI 只能开始一个新的 editId——把内部 id 管理的约束外泄给了用户对话。

---

### 3.4 `ExecutionEventStore` 参数边界 reject

**文件**：`D:\果铃工作台\src\main\workbench\execution\ExecutionEventStore.ts:213, 216, 279, 297`

```ts
if (!inputs.length || inputs.length > 5000) return Promise.reject(new RangeError('一次事件写入需要 1 至 5000 项'))
if (parsed.some(input => input.conversationId !== conversationId)) return Promise.reject(new Error('一次写入只能属于一个会话'))
if (!Number.isSafeInteger(after) || after < 0 || ...) return Promise.reject(new RangeError('事件分页参数无效'))
if (!query || query.length > 500 || ...) return Promise.reject(new RangeError('历史搜索参数无效'))
```

**违反的原则**：
- 调用方传 5001 项可以分批；调用方 query 为空白可以返回空结果。这里整条 reject，必须由上游捕获。

**用户摩擦**：影响间接——AI 的一次查询因为 query 格式小错就整轮 fail，而不是降级返回空。

---

## 四、出口汇总：`resume-observation-required` 的所有出口

字面错误码 `'resume-observation-required'` 全仓库只有一处创建：

| 位置 | 触发 |
|---|---|
| `D:\果铃工作台\src\core\tools\DocumentToolGateway.ts:346` | `assertObserved` 抛 `ToolError('resume-observation-required', ...)` |

到达该错误码的运行时路径：

| 上游 | 行号 | 说明 |
|---|---|---|
| `DocumentToolGateway.executeCall → invoke → (具体 mutation 实现)` | `:1081` | batch 写工具执行前的统一闸口 |
| `DocumentToolGateway.assertObserved` | `:344-347` | run 在 `observationRuns` 集合里就生效 |
| `ExecutionEngine`（挂门的源头） | `:538` | 每个 continuation run 都进入 `observationRuns` |

清理位置：

| 位置 | 行号 |
|---|---|
| `DocumentToolGateway.stop` | `:546-547`（`readCoverage.clear` + `observationRuns.delete`） |

---

## 五、需要重点注意的架构级违反

### 5.1 "observation / coverage" 这一整套概念是过程层的 over-engineering

- `D:\果铃工作台\src\core\tools\ToolReadCoverage.ts` 整文件
- `DocumentToolGateway.ts:178,449,546,713,1603` 对它的所有调用
- `DocumentToolGateway.ts:340-347,1081` 唯一的消费者
- `ExecutionEngine.ts:538` 唯一的生产者

这四层契约（追踪器、记录点、迁移逻辑、闸口）服务的行为本身——"续跑后必须先读再改"——就是被 AGENTS.md 2026-10-02 明文禁止的"先 read 再改"。如果删掉这条行为，整套 ToolReadCoverage 都成了死代码。换言之，这不是"实现太复杂"，而是**"实现了一个被禁令点名的行为"**。

### 5.2 system prompt 同时承担"事实陈述 + 流程指令"

`ExecutionEngine.ts:639` 这条提示长达 1500+ 字，其中：
- 事实陈述（例如"已授权文件 + 权限"、"已签发的 selection 短句柄"）是合规的
- 流程指令（"先读取需要的事实"、"固定文档中的 selection 句柄只供读取"配合 `:642` 的"先观察当前文档"）则把"该不该 read"硬塞给模型层

这违反 AGENTS.md §"模型不判断、不决策软件的内部机制：用哪条模型路由、先 read 哪个、是否 fallback、是否授权、如何调用底层接口组合"。

---

## 报告完

以上诊断未给出修复建议。如需整理解决优先级或映射到具体改造任务（B/M 系列），请进一步指示。