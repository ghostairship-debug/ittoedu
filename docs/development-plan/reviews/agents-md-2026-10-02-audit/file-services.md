# Agent文件服务 审计报告（AGENTS.md 2026-10-02 原则违反）

来源：子智能体只读审计；运行 ID：a0627eac6ef53d350

# 审计报告：Agent 文件服务对 AI 的过度摩擦

按照严重程度从高到低排序。仅作为只读审计，不修复。

---

## P0. file.write / file.patch 强制"先 read 才能 write"（违反"禁止过程层双保险"）

**位置**:
- `src/main/workbench/execution/AgentFileText.ts:113` 
  ```
  if (!expectedVersion) throw new Error('覆盖文件必须提供读取时取得的版本')
  ```
- 配合 `file.read` 是所有 version 值的唯一来源（`version: document:${documentId}:${epoch}:${revision}` 或文件 hash+size），且没有 second way 获得 version。

**原则违反**: AGENTS.md 第 46 行 — "禁止额外加**先 read 再改**、明确授权才允许改、not authorized 层层校验之类的过程层双保险"。

**用户视角**: 模型基于 system prompt + conversationHome 完全知道当前草稿内容（例如它刚刚通过 file.create + file.write 创建的文件），但下一次想直接 write 替换时必须回到工具轮里再调一次 file.read，仅为了取一个 version 字符串。一次本可以 1-step 完成的写入被强制拆成 2-step (read → write),加倍 LLM 往返延迟和 token 成本。CAS(expectedVersion 比对）本身足够防覆盖错误，"必须由 read 发出"是额外的过程门。

---

## P1. file.read 在"已打开文档"路径上的多层过程校验

**位置** `src/main/workbench/execution/AgentFileText.ts:71-86`:
```
if (current.snapshot) {
  await this.host.tools.attachRunDocument(...)
  const target = await this.host.tools.issueTarget(..., { readOnly: true })
  const receipt = await this.host.tools.execute(...'read' ...)
  if (receipt.kind !== 'read' || receipt.data.text !== current.source.slice(...))
    throw new Error('正式文档观察与文件读取不一致，请重新读取')
  if ((await this.source(filename)).version !== current.version) 
    throw new Error('读取期间文档已改变，请重新读取')
}
```

**原则违反**: 第 39 行"最快读取：模型需要上下文时，软件提供直接的读取通道" + 第 46 行禁止双保险。软件已经拿到了 `current.source`，却又调 gateway 走一遍 read，再字节比较；通过之后又再做一次版本校验。

**用户视角**: 一次普通 read 多走一次 DocumentSession.execute + 两次 source 加载 + 两次字节比对。任何一次不一致就把"请重新读取"砸回给模型，模型必须重试，引入额外的失败轨迹。最典型的高频影响：每次用户在 GUI 看到光标闪烁时 draft 微变，AI side read 就报错。

---

## P2. file.read 对并发打开/关闭的"旧游标失效"过程门槛

**位置** `src/main/workbench/execution/AgentFileText.ts:50`:
```
if (this.live(filename)) throw new Error('文件已在工作台打开，请重新读取当前文档')
```
与 `:64-65`:
```
if (!page || page.runId !== context.runId || !samePath(...) || page.version !== current.version)
  throw new Error('文件分页已失效或版本已改变，请从首页重新读取')
```

**原则违反**: "最快读取 / 失败时 fallback 到下一条通道而不是 reject 整个任务"。

**用户视角**: AI 通过 cursor 浏览到一半，用户只是点开看看，整个分页状态被作废，模型被迫丢弃 cursor、从头重读，不能降级到"按当前最新版本继续给后续 bytes"或"返回最新版内容 + truncated"。

---

## P3. file.create 的 kind 白名单拒绝合理扩展名

**位置** `src/core/tools/AgentFileTools.ts:15`:
```
kind: z.enum(['markdown', 'text', 'html', 'course-v9']).default('markdown')
```
与 `src/main/workbench/execution/AgentFileService.ts:69-70`:
```
const extension = input.kind === 'markdown' ? '.md' : ...
if (input.kind === 'text' ? sourceFileKind(input.name) !== 'text' 
    : path.extname(input.name).toLowerCase() !== extension) 
  throw new Error(`文件名与${input.kind}格式不符`)
```

**原则违反**: 第 54 行 — "导入优先让内容成功进入并使用。能被当前载体解析……不要求 AI 预先遵循特定源文格式"。

**用户视角**:
- 模型生成 JSON 配置文件、CSV 数据、SVG 矢量、XML、`manifest.yaml` → 全部不能通过 `file.create` 走创建通道；必须走 `file.write mode=create` 并祈祷 createFile 支持任意后缀。
- `file.create` 是 AI 引导提示里"创建新文档"的默认工具，却拒绝了一个 AI 高频产生的真实负载（比如把一段 JSON 落到 `data.json`)。
- 即便走 `file.write mode=create` 也必须再确认底层 `createFile` 接受非白名单扩展（`WorkspaceFiles.ts:617` 是 name-conflict，不是 whitelist，这条目前能通，但工具说明书与 create 通道的限制仍然误导模型）。

---

## P4. preflightMutation + requireMutationScope：写操作走两层权限检查

**位置**:
- `src/main/workbench/execution/AgentFileService.ts:74` `preflightMutation()` 完整 zod parse + 真实路径解析 + 权限检查
- `src/main/workbench/execution/AgentFileService.ts:117` `requireMutationScope()` 又再做一遍 mayWrite 检查
- `AgentFileService.execute()` line 165-180 对每个 mutation 同时调用两者

**原则违反**: 第 46 行 — "not authorized 层层校验"是被明确禁止的双保险。

**用户视角**: 每次 file.write/file.patch/file.trash/file.move 在 Engine 里跑一次 complete preflightMutation(`realpath` + `lstat` + `isInsideRoot`)，然后在 execute 里再跑 rerun requireMutationScope。FileMove 5 个文件时，preflight 是 `Promise.all(realpath)` 10 次 + requireMutationScope 5 次重复。机器开销可测，但更重要的是每多一道门就多一类失败（文件在两次 IO 间被外部改变会让 preflight 通过、execute 又失败的"race 不一致"报错）。

---

## P5. file.open 后 ExecutionEngine 强制走 issueTarget + previewTarget

**位置** `src/main/workbench/execution/ExecutionEngine.ts:1538-1550`:
```
if (outcome.opened) {
  ...
  await this.options.gateway.attachRunDocument(...)
  const target = await this.options.gateway.issueTarget(..., { kind: 'document' })
  const snapshot = await this.options.registry.get(...).drain()
  const preview = isSourceDocumentModel(snapshot.model) 
    ? await this.options.gateway.previewTarget(...) : null
  ...
}
```

**原则违反**: 第 36 行"无摩擦通道：模型返回内容后，让软件自动完成 attachRun → issueTarget → write → CAS 校验 → 提交"应当由软件隐藏；但这里 file.open 已经返回了 snapshot/documentId,Engine 又进一步 issueTarget + previewTarget 给 AI 返回 preview。这是合理的"attachRun → issueTarget"机械化，但同时为 file.open 强制嵌入了 target stack Entry；后续每次 read/write 都强制要求 issueTarget 后才能 execute(P3 已述）。这把"机械通道"重复实现为多步公开工具，AI 会感知。

---

## P6. organize 循环里 file.copy 对未保存 dirty 的硬失败

**位置** `src/main/workbench/execution/AgentFileService.ts:259-261`:
```
if (name === 'file.copy' && this.host.registry.list().some(snapshot => 
    snapshot.binding.kind === 'file' && snapshot.binding.path.toLowerCase() === source.toLowerCase() 
    && snapshot.dirty))
  throw new Error('源文件有未保存修改；请先保存或明确复制磁盘版本')
```

**原则违反**: "导入优先让内容成功进入并使用。局部不支持或可修复缺口提供清楚诊断和后续修复入口，不据此拒绝整份可用内容"。

**用户视角**: AI 想 copy 一个被 GUI 打开并有未保存草稿的文件，直接整体失败。合理行为是：默认复制磁盘版本（结果含 `copied:'disk-version'` 标志）、或自动先保存再复制，然后告知 AI。这里把决策反弹回模型 → 多一轮读 → 保存 → 复制。

---

## P7. file.trash / file.move 在 organize 内单独逐项调用，有序、无并行

**位置** `AgentFileService.ts:257-275`:
```
for (const [index, source] of sources.entries()) {
  try {
    ...await this.host.files.trash(...)
    items.push(...)
  } catch (error) { items.push(...) }
}
```
（注意 `file.copy`/`file.move`/`file.trash` 均共享此 for 循环。)

**原则违反**: 第 12 行核心立场"响应速度、使用低摩擦"。

**用户视角**: 模型给 5 个文件 trash，软件严格串行执行 entryId lookup → host.files.trash。每次 entryId 都要逐级目录 list(line 218-235 `entryId` for-loop)，每个源都要独立 async round-trip。10 个文件的 trash 在用户感知上是 10 倍单文件延迟，尽管 IO 上是独立可并行的。

---

## P8. file.create 对目录预检竞态的"位置已改变"报错

**位置** `AgentFileService.ts:186-187`:
```
const { directory, fallback } = await this.directory(context, input.path, true)
if (directory !== preflight.directory) throw new Error('目标文件夹已改变，请重新确认')
```

**原则违反**: "失败时 fallback 到下一条通道而不是 reject 整个任务" + 禁止过程层双保险。

**用户视角**: preflight 时目录是 A,execute 时 realpath 算出 A'(例如符号链接同一目录），直接抛错让模型重新发工具。普通做法：信任 execute 时的 fresh `directory`,preflight 只用于批准 outside-write。

---

## P9. file.create 在工作空间外的双批准门槛

**位置** `AgentFileService.ts:188-190`:
```
if (preflight.outside && context.permission !== 'full' 
    && context.approvedOutsideDirectory !== directory
    && !(context.approvedOutsidePaths ?? []).some(approved => isInsideRoot(approved, ...)))
  throw new Error('工作空间外新建文件需要明确批准')
```

**与** `requireMutationScope` (line 121) 重复。

**用户视角**: 用户在弹窗"批准这次创建"后，仍可能因为 `approvedOutsideDirectory !== directory` 而失败，因为 approval 授予的是 preflight 时的目录、而 execute 拿到的是 fresh 目录。这是 P4/P8 的复合症状。

---

## P10. PageState 对 tool 调用范围的 runId 硬绑定

**位置** `FileBrowsePages.ts:20`、`FileGrepPages.ts:25`、`AgentFileText.ts:46/64`。

cursor 强绑定 `runId`,cursor 不能跨 continuation/retry 沿用。

**用户视角**: 任务因 budget 炸出后用户点 retry,AI 的 grep/file.read cursor 全部作废。新版本必须重扫，浪费 tokens。恢复执行链路时这是真实可感的回归。

---

# 总结：最值得优先打磨的 3 个

按"用户每秒感受到的摩擦密度 × 修复成本"排序：

1. **P0 file.write 强制 expectedVersion 必须来自 file.read** — 直接撞 Owner 2026-10-02 明确的"禁止过程层双保险"条款；影响每次写文件。
2. **P3 file.create 的 kind 白名单** — 直接撞"导入优先让内容成功进入并使用"。一个简单的 `file.create` 通道应当默认接受"任意 UTF-8 文本"，扩展名交给 sourceFileKind 做 post-validation，而非 4 项死的 enum。
3. **P1 file.read 已打开文档路径上的双重 source 校验 + gateway 字节比较** — 这是最容易让用户在 GUI 里无意触发"AI 老是报'读取失败请重试'"的根源。

P4 / P7 / P9 是次要但容易被忽视的复合负担：每多一道防御性检查，就多一类 race /不一致；Owner 原则明确反对的是这些过程层。