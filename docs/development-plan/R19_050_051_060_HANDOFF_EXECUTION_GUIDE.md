# 1.9 收口执行手册（050 retry 证明 · V05 复制实证 · 诚实 060）

写给下一个执行者的工作单。日期：2026-09-18。基线：`main` @ `bc2072f7`，保留全部未提交实现与文档勘误。

> **本文件是执行指令，不是任务卡。** 不要放进 `docs/development-plan/tasks/`：任务板生成器会把该目录下任何 `.md` 当任务卡解析，字段不全就直接让 `npm run check:task-board` 报错。

---

## 0. 先读这五条（违反任何一条，本轮工作作废）

1. **不 reset、不 clean、不 checkout。** 当前工作树里有上一会话大量未提交实现，丢了就补不回来。
2. **不重开已确认的产品决定。** 会话归目录、文件是发送时冻结的编辑目标、单一自动目标、不强制四阶段、Luna Fast、Claude 走 DeepSeek——全部已定，不要再问用户。
3. **不为追绿换模型。** Codex/OpenCode 只用实际目录里的 Luna；Claude 通道用 DeepSeek。额度已授权，不用再申请。
4. **不允许假通过。** 零匹配、`test.skip`、mock `navigator.clipboard`、拿聊天正文当应用成功——都不算通过。失败就写失败原文。
5. **本文件只覆盖三件事**：① 050 retry 的真凭实据 ② V05 复制的真凭实据 ③ 一份诚实的 060。**不要顺手扩范围**，不要碰 2.0/S4。

---

## 1. 现在的真实状态（已由上一轮验证，不要再重复验证）

上一轮已在**同一次 capture** 里跑通两条 050：

```
npx --no-install playwright test tests/e2e/r19TaskDrivenTeacherChain.spec.ts --grep "r19 050" --workers=1
```

结果 **2 passed (4.3m)**：
- `r19 050 task-driven path ...` — ok (2.2m)，stdout：`050 archive marker "闭合电路探究" title="未命名课件"`
- `r19 050 review-first path ...` — ok (2.1m)，stdout：`050 archive marker "审阅闭合电路" title="未命名课件"`
- 路由：`{"id":"gpt-5.6-luna","effort":"medium","serviceTier":"priority","fast":true}`

日志原文在 `C:\Users\74755\AppData\Local\Temp\grok-goal-cae8406681b7\implementer\r19-050.log`。

**不要重跑这两条去"确认"。** 它们已经绿了。重跑只会烧 Luna 额度，不能增加任何信息。

**同时注意**：那次跑通**没有触发 retry 分支**（日志里 `050 retry apply` 出现 0 次）。也就是说，绿是因为 CLI 一次成功，不是因为 retry 好用。这正是下面第 2 节要解决的事。

---

## 2. 任务 A：给 050 retry 补一条真凭实据（最高优先级）

### 2.1 为什么要做

`tests/e2e/r19TaskDrivenTeacherChain.spec.ts` 的 `ensureCommittedApply()` 里有一段「失败后重试」逻辑（约 167–193 行）：

```ts
if (attempt > 0) {
  if (Date.now() + 4 * 60_000 > deadline) throw new Error(`050 apply did not commit and no time budget is left for retry ${attempt}`)
  // Terminal failure leaves 停止 disabled already; a still-busy task is stopped first so 会话 becomes selectable.
  if (await stop.isEnabled().catch(() => false)) await stop.click({ force: true })
  await expect(stop).toBeDisabled({ timeout: 60_000 })
  const session = chat.getByLabel('会话')
  await expect(session).toBeEnabled({ timeout: 30_000 })
  await session.selectOption('')
  await typeAndSubmit(chat, instruction)
  await expect(stop).toBeEnabled({ timeout: 30_000 })
}
```

这段是为了修上一会话遇到的 `Timeout: <select aria-label="会话" disabled> because busy` 而写的。**它从来没有在真实运行中被执行过。**

它依赖三个宿主事实，任何一个变了它就会静默退化成 30 秒超时：
1. 点「停止」之后 `GenerationTaskController.stop()` 会把 `busy` 置为 `false`（`src/renderer/authoring/generation/generationTaskController.ts:437`，`update({ busy: false, phase: 'cancelled', ... })`）。
2. 会话 `<select aria-label="会话">` 的 `disabled` **只**依赖 `busy`（`src/renderer/ui/chat/CourseChatPanel.tsx:416`）。若有人改成 `disabled={busy || preparing}`，retry 就废了。
3. `selectOption('')` = 选「新对话」，且 `selectSession('')` 在 `!record` 时安全空返回（`CourseChatPanel.tsx:359`）。

如果不动手，将来任何一次 CI 上的真实 CLI 抖动都会让这条用例超时 30s 失败，而没人知道根因是这三条哪一条坏了。

### 2.2 用什么工具

仓库里**已有**一个确定性失败注入夹具：`tests/e2e/chatFailureFixture.ts`，导出 `installChatFailureFixture(app, runRoot)`。

它的工作方式（**必须先读懂再动手**）：它把一个假的 `codex` CLI 写到临时目录并改写 `process.env.PATH`，让应用以为那就是真的 Codex。假 CLI 读取 `COURSEWARE_CANDIDATE_ROOT/request.json`，然后在原生协议层按 `mode.txt` 的内容**故意返回坏结果**。

可用的 mode（`fixture.mode('...')`）：
- `repair` — 第一次返回不支持的节点类型，被宿主拒绝后修复轮返回正常候选
- `no-progress` — **每次都返回同样的坏候选**，连续两轮无进展后任务**终态失败**（`harness.ts:354` 抛「连续两轮没有进展，请调整要求后重新发送」）
- `format-repair` / `format-repeat` / `missing-candidate` — 非法 JSON / 缺通道 / 缺候选文件
- `delayed` — 延迟 2500ms 返回，用来测「停止」
- `discussion` — 只回复文本、不改课件

**`no-progress` 就是你需要的那个**：它能让一次任务以**不可修复的终态失败**收场，而不是宿主内部的自动修复。

### 2.3 特别注意（这是本任务最容易踩的坑）

**夹具模式下不能用 `configureLuna()`。** 夹具假 CLI 只报一个叫 `fixture-model` 的模型：

```js
if(rpc.method==='model/list') {send({id:rpc.id,result:{data:[{id:model,model,displayName:model,isDefault:true,...}]}});return;}
```

而 `configureLuna()`（`r19TaskDrivenTeacherChain.spec.ts:56` 定义，第 **59** 行是那条断言）里有一行：

```ts
expect(luna, 'Actual native catalog must offer Luna').toBeTruthy()
```

在夹具下这句会直接断言失败。**你的新用例不要调 `configureLuna()`**，让它用夹具的 `fixture-model` 就行——本任务验证的是**宿主重试逻辑**，不是模型路由能力。

参考 `tests/e2e/stabilizationCoreUsability.spec.ts:608` 那条「S3 聊天失败注入」用例，它是目前唯一正确使用这个夹具的范例，照它的结构写。

### 2.4 要写什么

**不改**现有 `r19TaskDrivenTeacherChain.spec.ts`（它已经能用，而且它的 `configureLuna` 依赖真实目录）。**新建一个独立规格**，例如 `tests/e2e/r19ChatApplyRetry.spec.ts`。

要求这个新用例走**完整的真实链路**：真实 Electron 窗口 → 真实 `CourseChatPanel` → 真实 `GenerationTaskController` → 夹具假 CLI。不要 mock 掉中间任何一层。

用例要做的事，按顺序：

1. 启动应用，像 `stabilizationCoreUsability.spec.ts:619` 那样 `installChatFailureFixture(app, runRoot)`。
2. 打开工作空间 / 建目录会话 / 保存第一个 `.h5lesson`（照抄 `r19TaskDrivenTeacherChain.spec.ts` 里的 `openWorkspaceAndSession` + `firstSave`）。
3. 打开 `创作助手`，取到 `chat = page.getByRole('complementary', { name: 'CLI 创作助手' })`。
4. `fixture.mode('no-progress')`，然后发送一条编辑指令。
5. **等第一个终态失败**：`await expect(chat.getByRole('alert')).toContainText('连续两轮没有进展')`。同时断言「停止」已 disabled、「会话」已 enabled——这两条是 retry 的前置条件，单独断言它们就能定位是三条依赖里的哪一条坏了。
6. **切走这个 mode**：`fixture.mode('repair')` 或任何能成功的 mode。
7. **手动执行 retry 的三步**（这就是被测逻辑）：
   - 如果「停止」还 enabled 就先点它，然后 `await expect(stop).toBeDisabled({ timeout: 60_000 })`
   - `await expect(session).toBeEnabled({ timeout: 30_000 })` ← **这一步是上一会话超时的地方，必须有**
   - `await session.selectOption('')` 然后重新发送指令
8. **断言第二次真成功了**：只认 `[aria-label="实际应用结果"] strong` 等于「已应用课件修改」（参考 `readApplyState()` 的判定方式），**不要**用 `chat-scroll` 里的文本，**不要**用用户提示词。
9. 保存 → `unzipSync` 读 `project.json` → 断言正文里含标记词。
10. 收尾清理：`fixture.restore()`、销毁窗口、`rmSync` 临时目录。

### 2.5 完成判据

- 新用例 `passed`，且日志里能看到「失败 → 停止 → 会话可选 → 再发送 → 已应用课件修改」这条完整路径。
- **必须能看到第 5 步的失败态**。如果它没失败，说明夹具没生效，用例是假通过，不算完成。
- 把 stdout 完整写到 scratch：`{SCRATCH}\r19-chat-apply-retry.log`。
  本机 scratch 目录：`C:\Users\74755\AppData\Local\Temp\grok-goal-cae8406681b7\implementer\`

### 2.6 备选（如果夹具路线太难走通）

退而求其次，写一条**单元测试**锁住依赖 #2，放在 `tests/unit/courseChatPanel.test.tsx` 里（该文件已有完整的 mock 端口脚手架，见文件头部 `vi.mock` 段）：

- 让 controller 报告 `busy: true`，断言 `screen.getByLabelText('会话')` 是 `disabled`；
- 让 controller 报告 `busy: false`，断言它 `enabled`。

这条测试**不能**证明 retry 能用，但能防止有人把 `disabled={busy}` 改成别的东西。**这是降级方案，只有 2.4 走不通时才用**，并在报告里注明你走了降级路线。

---

## 3. 任务 B：V05 复制的真凭实据

### 3.1 为什么要做

验收矩阵 V05 明确要求：「消息／代码块可选择、复制、**实际粘贴**；……**不能 mock clipboard 后声称系统剪贴板通过**」。

现在的实际覆盖只有 `tests/unit/chatClipboardPermission.test.ts`，它断言了两件事：
- `isAllowedRendererPermission('clipboard-sanitized-write') === true`（主进程权限白名单）
- CSS 里 `.chat-message { user-select: text }` 覆盖了全局的 `body { user-select: none }`

**这两条都没碰到真正的复制动作。** `src/renderer/ui/chat/SafeChatMessage.tsx:52` 里那句真代码：

```ts
void Promise.resolve().then(() => navigator.clipboard.writeText(text)).then(() => setCopyStatus('已复制')).catch(() => setCopyStatus('复制失败，请选择原文复制'))
```

……没有任何测试执行过它。V05 现在是一条**证据缺口**，不是造假，但也远没达到「真实可用」的判据。

### 3.2 好消息：仓库里已有现成的读剪贴板手法

不要自己发明。`tests/e2e/` 里已经有四处正确用法：

```ts
// 读系统剪贴板（tests/e2e/r19FileAiRecoveryLuna.spec.ts:44）
const viewedSource = await app.evaluate(({ clipboard }) => clipboard.readText())

// 写系统剪贴板（tests/e2e/r19FileAiReopenUndo.spec.ts:51）
await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), text)

// 轮询等待（tests/e2e/r19ManualLessonApply.spec.ts:56）
await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(source)
```

这条走的是 **Electron 主进程的 `clipboard` 模块**，和渲染进程的 `navigator.clipboard` 权限无关，所以不会被 `configureRestrictedSession` 的权限白名单挡住。

### 3.3 要写什么

新建一条 e2e 用例，例如 `tests/e2e/r19ChatCopyPaste.spec.ts`（或加进已有的 r19 聊天规格，但要确认它不会因为共享状态互相干扰）。

要求：

1. 真实 Electron 窗口，打开 `创作助手`。
2. 让它产生一条**可复制的助手消息**——最简单的办法是用夹具的 `discussion` mode（它只回复文本、不改课件，不烧真实模型额度）：

   ```ts
   const fixture = await installChatFailureFixture(app, runRoot)
   fixture.mode('discussion')
   ```

   注意 `fixture.mode()` 必须**在发送之前**调用，且要在应用窗口起来之后（夹具改写的是 `process.env.PATH`）。`stabilizationCoreUsability.spec.ts:802` 就是这个顺序。

   > **写规格时选哪种启动方式**：`stabilizationCoreUsability.spec.ts` 用的是**现场 vite dev server**（`createServer({ configFile: 'vite.renderer.config.ts' })` + `launchEditor(url)`），这样改渲染层代码可以立即生效；而 `r19TaskDrivenTeacherChain.spec.ts` 用的是**已构建的 `dist-renderer`**（`VITE_DEV_SERVER_URL: ''`）。两条路都能用。如果你选 dist 路线，**改了 `src/renderer/**` 就必须先 `npm run build:renderer`**；如果你选 dev-server 路线，就不用 build，但要在 `finally` 里 `await server.close()`。别混用。
3. **先清空系统剪贴板**，写一个独特的哨兵值进去，例如：
   ```ts
   await app.evaluate(({ clipboard }) => clipboard.writeText('SENTINEL-NOT-COPIED-' + Date.now()))
   ```
   这一步很重要：**不清空的话，剪贴板里可能残留上一次测试的内容，断言会假通过。**
4. 点击该消息下方的「复制原文」按钮（`SafeChatMessage.tsx:52` 起，`<button>复制原文</button>`）。
5. 断言复制状态变成「已复制」（`SafeChatMessage.tsx:53` 的 `<span role="status">`）。

   **注意 locator 精度**：`role="status"` 在这一屏里有**两处**——复制状态 span，以及 `CourseChatPanel.tsx:423` 的任务状态行 `<p role="status">{notice}…</p>`。直接用 `page.getByRole('status')` 会 strict-mode 报错或匹配错元素。必须限定在消息内，例如：
   ```ts
   const message = chat.locator('.chat-message').filter({ hasText: '要复制的正文' }).last()
   await message.getByRole('button', { name: '复制原文' }).click()
   await expect(message.getByRole('status')).toHaveText('已复制')
   ```
6. **从系统剪贴板读回并断言内容真的变了**：
   ```ts
   await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).not.toBe(sentinel)
   ```
   并断言读回的内容**等于那条消息的正文**（而不是仅仅 "变了"）。
7. **绝对不要**在测试里 mock `navigator.clipboard`。只要出现 `Object.defineProperty(navigator, 'clipboard', ...)` 或 `vi.stubGlobal('navigator', ...)`，这条测试就不算数。

### 3.4 完成判据

- 用例 `passed`，且第 3 步的哨兵值断言是有效的（即如果复制没发生，测试确实会红）。
- **自检方法**：临时把 `SafeChatMessage.tsx:52` 的 `navigator.clipboard.writeText(text)` 改成 `Promise.resolve()`，重跑，确认用例**变红**。然后改回来。不做这一步，你无法证明这条测试真能证伪。
- scratch 日志：`{SCRATCH}\r19-chat-copy-paste.log`。

---

## 4. 任务 C：写诚实的 060

### 4.1 先做这个

**在跑任何 verify 类命令之前，先读 `package.json`。** 已读过的结论如下，但你要自己再确认一遍，因为它可能已经变了：

```
typecheck   = tsc --noEmit && tsc -p tsconfig.electron.json --noEmit && tsc -p tsconfig.e2e.json --noEmit
test        = pretest(build:player) && vitest run
test:e2e    = pretest:e2e(build:player, check:examples, 两个 fixture, build:renderer, build:electron) && playwright test
verify      = check:ai-capabilities && typecheck && test && test:e2e
```

**`npm run verify` 会拉起全量 Playwright**，其中包含大量**付费的真实模型门控**（Luna、DeepSeek）。**不要盲跑。** `npm run dev` 也不能当证据。

### 4.2 跑什么

上一轮已经在做的「等价拆分」，你要**继续沿用并如实记录**，不要为了好看去跑全量：

1. `npm run check:ai-capabilities`
2. `npm run typecheck`（三个 project 都要 0）
3. `npx --no-install vitest run <实际受影响的文件>`（不要跑全量 `npm test` 除非你确认了成本）
4. 命名的 Playwright 用例，逐个跑，记录每条的耗时和结果

每一条都要在 060 记录里写清：**它覆盖了 `verify` 的哪一段、哪一段没覆盖**。

### 4.3 V01–V15 逐条给状态

**关键要求**：每条必须同时给「证据路径」和「本轮是否重跑」。禁止把「复用旧证据」写成「已通过」。

格式示例：

| ID | 状态 | 证据 | 本轮是否重跑 |
|---|---|---|---|
| V01 | 复用 | `tests/unit/LessonWorkspaceShell.test.tsx`（Picks older conversation） | 否 |
| V02 | **本轮实跑** | `r19DirectoryFirstSave` passed 9.8s | 是 |
| … | | | |

**特别提醒三条**（上一轮把它们标成「复用旧证据，本轮未重跑」，但它们的 consumer 代码在本轮被改过，按第 6 节「仅变更 consumer 重验」的口径，属于**必须标注为缺口**的项）：

- **V06**（项目／会话管理）— `App.tsx` 的 `onProjectSaved` 目录绑定分支、`applyDirectoryBinding` 是本轮新改的。
- **V07**（MD 文件 AI）— `openFile` 的分流逻辑（目录会话下 `.h5lesson` 走 `onOpenProject`、MD 走真实 file ref）是本轮新改的。
- **V10**（两种编辑位置）— 编辑器焦点改成同一 `.lesson-workspace-chat` CSS 投影，是本轮新改的。

对这三条，**要么真跑一次，要么在 060 里明确写「consumer 本轮变更，证据未重跑，是缺口」**。不要沉默地复用。

### 4.4 必须写进去的「未做」

- 未跑 `npm run verify`
- 未跑全量 `npm run test:e2e`
- 未跑从材料起的整课 AI（`tests/e2e/r19CurrentTeacherAutomaticLuna.spec.ts`）
- 未跑 Claude DeepSeek generate、OpenCode generate
- Word 未新实测（复用 2026-09-15 证据，保持标注为未新测）
- `r19LessonCopyMove.spec.ts` 仍 `test.skip`
- 原电路 revision 27 样本 `output/r19-current-teacher-luna` 本机缺失

### 4.5 绝对不能做的事

- **不签 accepted**，不打 `v1.9.0-rc.N` 标签
- **不建安装器**
- **不改 PM-01 保全矩阵正文**（晋升要等 060 通过后由 Owner 决定）
- **不把旧失败改写成绿色**。历史评审和执行记录保持原样，新事实**追加**一份新记录。

---

## 5. 完成后要更新什么

1. **新增一份执行记录**：`docs/development-plan/reviews/2026-09-18-r19-<你的主题>.md`（或当天日期）。内容必须含：
   - 源码 / 未提交范围
   - 当前包与下一动作
   - **通过 / 失败原文**（粘贴 stdout，不要转述）
   - 文件 / 目标 / 会话身份
   - 构建准备状态（跑没跑 `build:renderer`）
   - 明确模型路由
   - 剩余门与**未跑命令清单**
2. **更新主方案状态行**：`docs/development-plan/R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md` 第 3 行的状态段。只改事实，不改口径。
3. **修正 `2026-09-18-r19-skeptic-gaps-closed.md`**：它里面「任务式 passed 1.4m / 先审 passed 1.7m 独立重跑」的写法**是准确的，不需要改成「2 passed」**（不要反向夸大）。但如果本轮拿到 2 passed 的合并日志，应**追加**一句说明。

---

## 6. 容易踩的坑清单

| 坑 | 后果 | 怎么办 |
|---|---|---|
| 改了 `src/renderer/**` 或 CSS 却没重新 build | e2e 跑的是旧 `dist-renderer`，测了个寂寞 | 先 `npm run build:renderer`（注意：e2e 用 `dist-renderer`，不是 dev server） |
| 在夹具用例里调 `configureLuna()` | 断言 `Actual native catalog must offer Luna` 直接失败 | 夹具模式下用 `fixture-model`，不要配 Luna |
| 用 `chat-scroll` 或用户提示词判断应用成功 | 假阳性——提问本身就含标记词 | 只认 `[aria-label="实际应用结果"] strong`，再核对 `project.json` / HTML 正文 |
| 复制测试不清空剪贴板 | 残留内容导致假通过 | 先写哨兵值，再断言读回值变了且等于消息正文 |
| 把「复用旧证据」写成「通过」 | V06/V07/V10 的 consumer 变了，等于漏验 | 明确标注「未重跑，是缺口」 |
| 盲跑 `npm run verify` | 拉起全量付费模型矩阵，烧额度 | 读 `package.json`，做等价拆分并记录 |
| 把 `.md` 放进 `docs/development-plan/tasks/` | `check:task-board` 报错，任务板生成失败 | 放 `docs/development-plan/` 下 |
| 用 `--grep` 零匹配当成通过 | 根本没跑 | 确认 runner 输出里有实际的用例名和 `passed` |

---

## 7. 命令速查

```bash
npm run build:renderer
```

```bash
npm run typecheck
```

```bash
npx --no-install vitest run tests/unit/<你的新测试>.test.ts
```

```bash
npx --no-install playwright test tests/e2e/<你的新规格>.spec.ts --workers=1
```

```bash
npm run check:ai-capabilities
```

**不要**跑：`npm run verify`、`npm run test:e2e`（全量）、`npm run dev`。

---

## 8. 交付物清单

- [ ] `tests/e2e/r19ChatApplyRetry.spec.ts`（或单元降级方案 + 说明），stdout 存 scratch
- [ ] `tests/e2e/r19ChatCopyPaste.spec.ts`，含「改坏源码会变红」的自检记录
- [ ] 060 记录（等价拆分 + V01–V15 表 + 未做清单）
- [ ] 一份新的 `reviews/` 执行记录
- [ ] 主方案状态行更新

**再次强调：不要重跑已经绿了的 050 合并用例。不要扩范围。不要签 accepted。**
