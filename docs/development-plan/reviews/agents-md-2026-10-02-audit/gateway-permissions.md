# Gateway与权限 审计报告（AGENTS.md 2026-10-02 原则违反）

来源：子智能体只读审计；运行 ID：a31a149f41d8830e9

The `writableRun()` is called on EVERY service-type tool call in HostToolServices (job cancel, runCompute, runDelegate, mediaStart, workspaceImageScope) — they all do `run.grant.fileAccess?.permission === 'read-only'` checks at each tool invocation. But since the run is frozen at beginRun and the grant never changes for the lifetime of the run, this is redundant re-checking of a frozen fact.

Now I have enough to write the report.

# 权限中间层审计报告（只读分析）

## AGENTS.md 关键原则（用于对照）

- **模型职责**：不判断是否授权（Owner 2026-10-02）
- **软件职责**：机械导入 / 无摩擦通道 / 最快读取（Owner 2026-10-02）
- **禁止**"明确授权才允许改"、"not authorized 层层校验"的过程层双保险
- Owner 9-24 四档：完全访问（可读写工作空间外，发送前不弹服务说明）/ 完全访问·工作空间（默认）/ 修改前询问 / 只读。档位随任务冻结

---

## 按严重程度排序的发现

### 1. 完全访问档被错误降级——`file.open` / `file.write` 拒绝 workspace 外（违反 Owner 9-24）

**文件**: `D:\果铃工作台\src\main\workbench\execution\AgentFileService.ts:140`
```ts
writable: context.permission !== 'read-only' && (context.permission === 'full' || isInsideRoot(context.workspaceRoot, filename)),
```
**文件**: `D:\果铃工作台\src\main\workbench\execution\AgentFileText.ts:146-147`
```ts
if (context.permission !== 'full' && !isInsideRoot(context.workspaceRoot, filename))
  throw new Error('已打开的工作空间外文档需取得正式文档写授权，单次文件批准不会扩大后续文档权限')
```

**违反原则**：完全访问档 Owner 9-24 已明确"完全访问档可读写工作空间外文件，发送前不弹服务说明"。但 `AgentFileText.commit()` 在 workspace 档下打开 workspace 外的 markdown/文本文件就硬抛"需取得正式文档写授权"——这把"完全访问"与"工作空间"的边界写进了工具层，而且把单次批准 (`approvedOutsidePaths`) 不当成正式授权。

**用户视角摩擦**：用户在「完全访问（工作空间，默认）」档让 AI 改一个 workspace 外的笔记，AI 同意了，最后一步写入却硬错，"需取得正式文档写授权"——用户已经明示改这个文件，软件层还把它当成不可写；用户不知道还有什么"正式授权"没给。

### 2. `resume-observation-required` 是 AI 对"状态过期"的事先防御（纯过程门）

**文件**: `D:\果铃工作台\src\core\tools\DocumentToolGateway.ts:340-346`
```ts
requireReadObservation(runId: string): void {
  if (this.run(runId).stopped) throw new ToolError('run-stopped', '任务已停止')
  this.observationRuns.add(runId)
}
private assertObserved(runId: string, snapshot: DocumentSnapshot, targets: readonly ToolTarget[]): void {
  if (this.observationRuns.has(runId) && targets.some(target => !this.readCoverage.has(runId, snapshot, target)))
    throw new ToolError('resume-observation-required', '继续修改前需读取该目标的当前内容…')
}
```
**触发点**: `D:\果铃工作台\src\main\workbench\execution\ExecutionEngine.ts:538` — `if (continuation) this.options.gateway.requireReadObservation(runId)`

**违反原则**：AGENTS.md 明确说"**禁止额外加'先 read 再改'**'明确授权才允许改'…之类的过程层双保险"。这正是"先 read 再改"的实现：continuation 一开始就在 run 上加了 observation 强制门，**不管模型是否已经在 prompt 里看过选区内容**——`previewTarget` 已经在 line 561 给 selection 喂了内容，但 `readCoverage` 只记录 `previewTarget` 那一次调用；如果 frozen writable target 范围大于 selection（典型场景），继续就 throw。

这条注释自己承认"**Not a new permission**"——但既然不是新权限，它就是 AGENTS.md 禁止的过程层。

**用户视角摩擦**：用户对 AI 说"继续上次未完成的修改"，AI 心里清楚要改哪段，但工具链强制它先 read 一遍——是无效往返；一旦忘记 read，AI 报"resume-observation-required"，用户不知道为什么继续任务还要"重新读"。

### 3. `not-authorized` / `canWrite` 在每次 mutation 都被重新求值——任务级权限在 mid-flow 被反复检查

**文件**: `D:\果铃工作台\src\core\tools\DocumentToolGateway.ts`
- L727 `if (write && !handle.writable) throw new ToolError('not-authorized', '目标不在本次任务的可写范围')`
- L743 `if (write && !this.canWrite(run, snapshot, target)) throw new ToolError('not-authorized', '目标不在本次任务的可写范围')`
- L199, L203 `resolveImage` 的同样两次连续 not-authorized
- L883 `if (!mapped.writable) throw new ToolError('not-authorized', '动态图文目标…')`

`canWrite` 实现（L579-621）每次都对 `run.grant.documents[].writable` 做 `mapMarkdownRange` + `targetFootprint` + `containsTarget` 全套求值。

**违反原则**：run grant 在 `beginRun` 已冻结（L307-336）：每个 `doc.writable` 里的 target 都在 task 开始时 `readTarget` 验证过、`rangeFootprints` 已存盘。mid-flow 重新跑 `canWrite`，是为了复用 `expectedFootprint`/`actualFootprint` 的比较；但 L736-741 已经做过了 footprint 一致性检查（CAS 已存在），`canWrite` 这层只是权限二次验证，不防错写，只输出 "not-authorized" 让用户困惑。

AGENTS.md 强调"**禁止**…not authorized 层层校验"——这正是层层校验之一。

**用户视角摩擦**：用户冰冻任务时给了 `{ kind: 'course-surface', surfaceId: 's1' }`，AI 后面要改 s1 内的某个 layer——already 在授权范围内却会被 `canWrite` 因 `targetFootprint` 已变化（**因为本任务自己刚改过文档**！）而拒绝，错误信息是"目标不在本次任务的可写范围"——典型的"用户明确说改这个，AI 报 not-authorized"。

注意 L668 自己也识别了"`handle.expectedFootprint !== handle.footprint` → 本任务已修改"分支，但走错分支还是兜底抛 not-authorized。

### 4. `describeRun` 在每个模型轮次被全量重算（性能+过程层）

**文件**: `D:\果铃工作台\src\main\workbench\execution\ExecutionEngine.ts:1836`
```ts
while (!active.stopped) {
  …
  await this.refreshTools(active)   // 每个模型请求前都调
```
`refreshTools` → `runTools` → `describeRun(runId)`。

**文件**: `D:\果铃工作台\src\core\tools\DocumentToolGateway.ts:233-256`

每次 `describeRun`：
- `for (const doc of run.grant.documents) { const snapshot = await this.registry.get(doc.documentId).drain(); … }` —— 每轮对所有授权文档 drain 一遍
- 重算 `runScope`、`writableKinds`、`selectRunToolNames`、`visibleRunToolNames`
- 重新生成 `describeTools(names, {…})` 并 `structuredClone`

**违反原则**：run grant 是冻结的（L307-336），`grant.documents` 在 run 生命周期内除了 `attachRunDocument` 之外不变。这等于每个模型轮次都做一次"重新冻结"——CPU、I/O 全部浪费。可在 `beginRun`、`attachRunDocument`、`loadToolFamilies` 时失效缓存，模型轮次时直接复用。

**用户视角摩擦**：响应速度下降（违背"响应速度"原则）；100 个工具 × 每个请求 drain N 个文档 + structuredClone = 显著延迟。

### 5. `assertWriteTasksAllowed` 在 `attachRunDocument` 内被二次调用（mid-flow 重新检查）

**文件**: `D:\果铃工作台\src\core\tools\DocumentToolGateway.ts:312, 331, 357`

- L312 `beginRun` 检查一次
- L331 `beginRun` 在 `hostTools.beginRun(grant)` 之后再检查一次"generations"
- L357 `attachRunDocument` 又检查一次

**违反原则**：run 已经在跑（mid-flow），用户在任务进行中打开一个文件，工具层要重新走"任务开始时是否被允许"的逻辑。如果此刻 host 在做 `withWriteTaskBarrier`（保存导入），AI 已经表态要打开的文档就被阻塞，"document-write-tasks-blocked"——属于"任务级权限 mid-flow 重新检查"。

**用户视角摩擦**：用户在 AI 跑任务时点了一下保存，AI 在 file.open 时报"文档正在关闭或处理文件变更，请完成后重新发起编辑任务"——用户得整个任务重来。

### 6. `writableRun()` 在每个 host tool 调用前重复检查 read-only

**文件**: `D:\果铃工作台\src\core\tools\HostToolServices.ts:161-165`
```ts
private writableRun(runId: string) {
  const run = this.builtInRun(runId)
  if (run.grant.fileAccess?.permission === 'read-only') throw new Error('只读任务不能提交外部作业')
```
被 `jobCancel`、`runCompute`、`runDelegate`、`workspaceImageScope`、`mediaStart`、`readComputeArtifact` 多次调用。

**违反原则**：`grant.fileAccess.permission` 在 `beginRun` 已冻结（L307 的 `structuredClone`），永不变；工具目录早已按该档位过滤（`selectRunToolNames`/`visibleRunToolNames`），模型根本看不见 read-only 不能用的工具。这里再 throw 是冗余双保险。

**用户视角摩擦**：低（模型层根本走不到），但是 AGENTS.md 明确禁"not authorized 层层校验"。

### 7. issueTarget + previewTarget 链路对 readOnly 句柄做双重捕获

**文件**: `D:\果铃工作台\src\core\tools\DocumentToolGateway.ts:382-389, 441-454`

`issueTarget` → `capture` 已读 `targetFootprint`、`readTarget`；`previewTarget` 又会 `readTarget(snapshot.model, target)` 一次（L447）。

随后 ExecutionEngine.ts:548-567 又对每个 writable target 走 `issueTarget` + 每个 selection target 走 `issueTarget(readOnly)` + `previewTarget` + `issueWritableTargetWithinGrant`（第二遍 `canWrite`）+ 可能第二次 `issueTarget`。

**违反原则**：模型只看见文档，软件应该"无摩擦通道"——同一文档同一片段只该解析一次。现在每个 frozen scope 至少 2-3 次 snapshot 读取。

**用户视角摩擦**：首次响应延迟；不会出现拒绝，但是是纯冗余。

### 8. `approveAll` 在 permission==='workspace' 且 outsideFiles 时报"力量询问"——表面上对，实际把 workspace 档变成"ask outside"门

**文件**: `D:\果铃工作台\src\main\workbench\execution\ExecutionEngine.ts:802-805`
```ts
if (active.permission === 'ask') return 'ask'
if (fileMutationNames.has(name)) return null
if (active.permission === 'workspace' && active.outsideDocuments.size) {
```
文件 mutation 工具（fileMutations）在 workspace 档直接跳过询问（"return null"），走 `AgentFileService.preflightMutation` + `requireMutationScope`（L121 `throw new Error('工作空间外修改需要当前操作的明确批准')`）。

**违反原则**：这条不直接违反——但配合 finding 1，workspace 档下用户一旦要改 workspace 外文件，预期是"问一次"，实际是 AI 报"工作空间外修改需要明确批准"——模型看到这错误信息没头没尾；用户没看到 UI 弹批准卡（只有 outside path + 经过 `preflight` 时才有 approval card 出去的通道，L1314-1318）。

**用户视角摩擦**：workspace 档下用户对 AI 说"改 D:\notes\x.md"（工作空间外），AI 报"工作空间外修改需要当前操作的明确批准"，但用户界面上可能根本没出现"批准"按钮（取决于 `preflightError` 路径）；用户不知道为什么没被问。

---

## 次级发现（仅记录）

- **`recoverRun`** (`DocumentToolGateway.ts:372-379`)：恢复时 `writable: []`，然后 run.stopped=true；但 `stop()` 里 `for (const doc of run.grant.documents)` 会访问 `stopped` run 的 grant——逻辑安全但显示"writable 全空"被视为合理表示，模型不感知。
- **`watchDocument`** (L561-574)：监听 undoDepth/redoDepth 比对推断"用户撤销"，把整文档标 `invalidatedDocuments`，从而使所有 handle 失效 (`canWrite` 返回 false) — 极端防御：如果用户在本任务外部撤销自己的一次手动修改，AI 后续任何 write 都被 reject 为 not-authorized 而不是误用旧版 CAS——CAS (revision) 已经能防错写，这层是冗余人肉防御。
- **`batch` 调用的 `cross-document-batch` 限制** (L804, L1048-1067)：批量工具强制单文档，AGENTS.md 说"模型生成的内容→机械导入"，这条人为限制意味着若想跨 surface 改名/同步图层必须分多个模型轮次；属于软件层强加的模型行为限制。

---

## 建议处理优先级（对 owner）

1. **Finding 1** —— 违背 Owner 9-24 决定，最高优先
2. **Finding 2** —— 字面违反 AGENTS.md 明确禁令
3. **Finding 3** —— not-authorized 错误信息无意义、`.expectedFootprint` 分支已能区分
4. **Finding 4** —— 响应速度
5. **Finding 5, 6, 7, 8** —— 次级过程层，可一并整理