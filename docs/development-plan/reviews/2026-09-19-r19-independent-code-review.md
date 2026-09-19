# 1.9 独立只读评审：代码与进度（2026-09-19）

评审人：Claude（只读，不改产品代码、测试或历史记录）。评审对象：`main` @ `bc2072f7` 之上的全部未提交工作树（另一 AI 会话在 09-18 至 09-19 推进的开发轮次），以及其自述的三份执行记录与签收包。本文件是新增记录，不改写任何既有记录；不放入 `docs/development-plan/tasks/`。

## 0. 结论摘要

- **总体判定**：与签收包自评一致，1.9 处于「工程候选成立、DoD 未达标」状态，**不建议签 accepted**。开发方的记录诚实度高：经交叉审查后出了 v2 修订，撤回了两处过度声明（「原文在册」、「全部为既有漂移」），并披露了误派发付费请求与 17 张证据图被覆盖。
- **我独立复核为真**：`typecheck` 三 project 全 0；受影响的 20 个单测文件 329 passed / 0 failed；`check:ai-capabilities`、`check:task-board`、`check:contracts`、`check:development-roadmap`、`check:legacy-inventory` 全绿；scratch 目录中的 `f-npm-test.log`（440/440）、`f-v-specs.log`（8 passed）、`r3-sweep.log`（56/10/27/1）与签收包数字一致，且 04:44 全绿之后 `src/` 与 `tests/unit/` 无任何文件再改动，该全绿结果对当前源码仍然有效。
- **必须先处理的三件事**（详见 §3）：① 「本轮引用」下拉框被移进默认折叠的 `<details>`，至少 21 个 e2e 文件会在 `selectOption` / `toBeVisible` 处失败，本轮任何扫描都没有覆盖到；② `scripts/verify-release.ts` 与 `verify-w3-windows-portability.ts` 仍点击已删除的「专业」按钮，`verify:release` 链已断；③ `editor.spec.ts` 27 条用例 0 通过，加上另 8 个文件 18 条确定性红，核心编辑器回归覆盖实际处于失效状态，且未做逐条归因，不能排除产品回归。
- **治理层面两点请 Owner 亲自确认**：CopyMove 两个测试文件的删除依据是 AI 撰写的任务书中「Owner 已拍板」一句；Codex 通道 4 次真实回合实际跑在 `gpt-6-astra · xhigh`（机器默认）而非 AGENTS.md 规定的 Luna，虽已如实披露，但属于未授权模型额度消耗。
- **最大工程风险**：165 条工作树变更（约 3.5k 行增删 + 3.1k 行新文件）持续未提交已超过一天，任何 reset/checkout 失误都不可恢复。建议 Owner 审阅后尽快按主题分批提交。

## 1. 评审范围与方法

| 项 | 内容 |
|---|---|
| 基线 | `bc2072f777a2ca36e545979e3b67d782d105fce6`（2026-09-18 00:02） |
| 工作树 | 165 条：132 条已跟踪改动（+1904 / −1605）、2 条已暂存删除、33 条未跟踪新文件（3136 行，其中 src/tests 1581 行） |
| 源码面 | `src/main` 8 文件（+239/−90）、`src/renderer` 13 文件（+366/−143）+ 新增 `ChatComposerMenus.tsx`、`src/shared` 7 文件（+75/−13）、`scripts` 2 文件 |
| 测试面 | e2e：34 改、1 删、11 新；unit：13 改、1 删、6 新 |
| 文档面 | `docs/development-plan` 45 改（+557/−756）、13 份新记录；AGENTS.md、总纲、设计说明、roadmap manifest 9 个节点标题 |
| 我读了 | 全部 src/scripts diff；全部新增 e2e/unit 文件；三份 09-19 记录、签收包、任务书、交接手册、三份 09-18 记录；AGENTS.md 与合同相关条目 |
| 我跑了 | `npm run typecheck`；`npx vitest run` 20 个受影响文件；7 条 `check:*` 门；对 scratch 日志与 `output/` 证据目录做存在性与数字核对 |
| 我没跑 | 任何 Playwright e2e（会覆盖 `test-results/` 与 docs 下证据图）；`check:preservation`（会执行 27 条 evidence 命令）；任何付费模型 |

## 2. 进度对照

### 2.1 本轮实际完成的事（按记录 + 源码核对）

**产品源码（可核）**

- 目录会话身份闭环：`LessonConversationRepository` 新增 `requireOwned` / `rebindProjectTarget` / `recordFrozenTarget` 与 `conversation-index-v1.json` 索引（含缺索引时全量重建）；`service.ts` 改为先 `requireOwned` 再派生 agent scope；`bind-project` 支持 `owner` 归属，目录会话可首存与另存（`lessonDesktopService.ts:183-202`）。
- 冻结目标：`frozenEditTargetSchema` 三态（directory / document / courseware）进入 `lesson-start` / `lesson-resume` 合同；`resolveSendFrozenTarget` 明确「不把 lastFrozenTarget 当不可见锁」，与 09-18 决定一致。
- 文档 AI 修改扩展到普通文件：`lessonDocumentAiTask` 的 ref 变为 `lesson | file` 判别联合，`assertDocumentAiRefMatchesWorkspace` 对 file ref 做目录闭包检查（`path.relative` 拒绝 `..` 与跨盘）。
- 路径规范化统一入口 `normalizeWorkspacePath`（去尾斜杠、Windows 盘符小写、renderer 非 win32 也按盘符判定），main/shared 六处改用。
- 聊天：`/` 与 `@` 菜单（`ChatComposerMenus.tsx`）、单一自动目标提示、`user-select: text` 放开、`clipboard-sanitized-write` 权限白名单（`security.ts:109`）。
- 工作台：编辑器焦点改为同一聊天实例的 CSS 投影（不再卸载/换向）；内容区与聊天区改为「隐藏不卸载」；`contentDockResizeSign` 抽出并单测；「查找会话」历史检索；CopyMove UI 与 `openLesson(asCopy)` 死代码删除；`createProject` → `createLessonProject` 改名以通过 legacy 台账。
- 三处 V 缺口修复：`flushAll`/`stopAllAiEdits` 改为入口快照遍历并补 orphan-dirty 拒绝分支；焦点投影下布局条让位；`create-file` 返回文件夹 realpath（HEAD 返回的是文件 realpath，renderer 再 `join(…, name)` 会得到错误路径，本次修复正确，记录中「返回真实路径」的措辞不准确）。
- `harness.ts` 协议错误从裸 `'protocol'` 改为带原因的消息；`courseware-builder-v2-host.ts` 改为按需懒启动 Vite + Chromium。

**测试与治理**

- 新增 11 个 e2e（含共享入口 `lessonWorkspaceEntry.ts`、`r19ChatSpecSupport.ts`）与 6 个单测；25 个同源 e2e 改用共享 Ctrl+N 入口并清除「专业/简洁」locator（tests/ 内已归零，scripts/ 未清）。
- 全量 `npm test` 从 11 文件/28 例红 → 440/440 绿（三次全量，中间一次 EBUSY 抖动）。
- 门：`check:preservation` 由红转绿（诊断码表对齐 + 4 处 legacy 改名）、`check:ai-capabilities` 重生成后绿。

### 2.2 V01–V15 我的独立判读

| ID | 签收包状态 | 我的判读 | 备注 |
|---|---|---|---|
| V01 | 实跑 | 认可 | `directoryConversationIdentity`(4) + `r19DirectoryConversationReopen` 证据链完整 |
| V02 | 实跑（部分） | 认可，但 `preserveAll` 仍含同类隐患 | 见 §3 P2-1 |
| V03 | 实跑（部分） | 认可为部分 | 全屏单实例未单列 |
| V04 | 单测实跑 / e2e 复用 | **降级为缺口** | 「本轮引用」控件位置已变，e2e 未重跑；见 §3 P1-1 |
| V05 | 复制/粘贴实跑；IME、/、@ 缺口 | 认可 | 剪贴板走 Electron 主进程读回，无 mock；IME 人工单已备未执行 |
| V06 | 实跑 | 认可 | 最近列表同会话不刷新为已知产品缺口 |
| V07 | 实跑（部分）+ 门控缺口 | 认可 | 三条真实 AI 门控未跑 |
| V08 | 实跑 | 认可 | |
| V09 | 复用 09-18 | 认可复用 | 记录明令不重跑以省额度，合理 |
| V10 | 实跑（部分） | 认可 | `data-editor-focus` 唯一编辑器模式断言仍在门控 spec |
| V11 | 复用；接续缺口 | 认可为缺口 | |
| V12 | 复用；入口类部分实跑 | 认可 | Word 仍为 09-15 COM 证据 |
| V13 | 实跑（媒体片段） | 认可 | |
| V14 | 等价反例 | 认可 | 原 revision 27 样本仍缺 |
| V15 | 本包 | 基本认可 | 见 §3 治理项 |

### 2.3 付费三链与整课链

| 通道 | 签收包结论 | 我的核对 |
|---|---|---|
| codex | R4e 1 passed 3.4m，路由 `gpt-6-astra · xhigh` | `output/playwright/r18-cli-codex/result.json` 三个 run：completed/committed 0→1、completed、completed/undone，与记录一致。**但该模型不是 Luna**，见 §3 治理-2 |
| claude | 未登录，0 计费 | `failure-records.json` 存在；本机 `~/.claude/.credentials.json` 为 06-11，属环境项 |
| opencode | 两次有界尝试失败，转缺口 | `failure-records.json` 563KB 存在；未复核内容 |
| 整课链 | 缺 teacher-action 驱动，1.2h 后超时 | `output/r19-current-teacher-luna/2026-09-18T22-28-08-643Z/` 含 7 份 stage JSON 与 `actual-native-route.json`；目录名为 UTC 时间戳，实际为 09-19 06:28 起 |

## 3. 代码评审发现（按优先级）

### P1（签收前必须处理）

**P1-1 「本轮引用」下拉框移入默认折叠的 `<details>`，至少 21 个 e2e 文件将失败，且无任何扫描覆盖。**
`src/renderer/ui/chat/CourseChatPanel.tsx:445-451` 把 `<select aria-label="本轮引用">` 放进 `<details className="chat-target-more"><summary>其它目标</summary>`，而它本身又在 `chat-task-settings` details 内。Playwright 对折叠 `<details>` 内元素判为不可见：`selectOption` 需要可见性，`tests/e2e/r18LocalPerformance.spec.ts:151` 更直接 `await expect(reference).toBeVisible()`。全仓 21 个 e2e 文件引用该 label，26 处 `selectOption`；R3 的 43 文件扫描只含其中 `r18-089-flow-viewport`，且该文件在此之前的行已红。`r18LocalPerformance` 无 env 门控却未进扫描清单。单测 `courseChatPanel.test.tsx` 通过是因为 jsdom 不实现 details 折叠可见性。
建议：在 `r19ChatSpecSupport` 增加「展开其它目标」共享步骤并让相关 spec 调用；或让 `<select>` 在有明确目标时才折叠。新增一条零模型 e2e 覆盖「点开其它目标 → 切换 → 摘要变化」。

**P1-2 发布验证脚本仍引用已删除的「专业」模式。**
`scripts/verify-release.ts:526` 与 `scripts/verify-w3-windows-portability.ts:415` 各有一处 `getByRole('button', { name: '专业' }).click()`。`editor-mode-switch` 已在 `bc2072f7` 移除，`verify:release` 与 W3 便携性验证链在到达该行时必红。签收包已登记为待办，但这是 rc 标签的前置门，不能拖到发布当天。

**P1-3 核心编辑器回归覆盖实际失效，19 条确定性红未逐条归因。**
`editor.spec.ts` 为 `test.describe.serial`，第 1041 行断言「简洁模式」tab 期望 0 实得 1 后级联，27 条 0 通过，其中含 :1126 专业模式、:1195 当前位置试运行、:1962 IME 合成事件。另 8 个文件 18 条确定性红（`image:615` 被 `#embedded-editor-properties` 拦截指针、`spatial:297` `global-layer-entry` 不可见、`stabilizationOwnershipController:696` `新增其他类型页面` 不可见、`v9PreviewNetwork:245` Ctrl+O 后标题未切换、PPTX 家族 4 条等）。签收包 v2 已把归因从「全部既有漂移」降级为「未做隔离实验」，这是正确的，但意味着**当前不能排除产品回归**：`#embedded-editor-properties` 与「面板/按钮不可见」族都与本线 R19 引入的布局改动有交集。
建议：按签收包三簇分工，每簇先做一条 HEAD 对照（`git stash` 不可用，可用 worktree 检出 `bc2072f7` 跑同一 spec）判定是 spec 漂移还是产品回归，再决定改 spec 或改产品。

### P2（本版内应修）

**P2-1 `preserveAll` 仍在 `await` 中遍历活 Map。**
`useDocumentTabsController.ts:90` `for (const [filename, editor] of documents.current) { if (!(await editor.session.preserveDraft())) … }` 与已修复的 `flushAll`/`stopAllAiEdits` 是同一模式。根因是 `LessonWorkspaceView.tsx:1018/1031` 的内联 `ref={(editor) => tabs.registerEditor(tab.path, editor)}`：每次重渲染先 `delete` 再 `set` 同键，键序移到末尾，迭代器无限回访。快照遍历只是止血；建议把 ref 回调改为按 `tab.path` 缓存的稳定函数（`useCallback`/Map），并同改 `preserveAll` 一行快照。记录 R-c 已登记此项，建议本版收。

**P2-2 测试把截图写进已跟踪的 docs 目录。**
`r19FrontendSpecialPathA/B/C.spec.ts` 与 `r19WorkspaceNavHierarchy.spec.ts` 的 `evidence` 常量指向 `docs/development-plan/reviews/2026-09-17-frontend-special-evidence/`，导致 17 张 09-17 历史证据 PNG 在 09-18/09-19 两轮被覆盖，git status 中 17 条 ` M` 即此。建议：`git checkout -- docs/development-plan/reviews/2026-09-17-frontend-special-evidence/` 恢复历史图，spec 输出改到 `output/` 或按日期新建目录；否则「历史记录只追加」在图片上永远不成立。

**P2-3 「当前编辑目标」按钮无行为。**
`CourseChatPanel.tsx:441` `<button type="button" aria-label="当前编辑目标" disabled={busy}>` 没有 onClick。设计说明 §5.1 要求「一个可点开的提示，展开才出现整文件/目录/其它目标」；现在点击无效、展开靠旁边的 `其它目标` summary，且摘要文字在按钮和 `<small aria-label="本轮引用摘要">` 出现两次。单测只断言存在。建议按钮点击即切换 `chat-target-more` 的 open 状态，删除重复摘要。

**P2-4 `ChatComposerMenus` 与设计 §5.5 的差距。**
无方向键/Enter/Esc 键盘导航；`role="listbox"` 下放 `<button role="option">`；`/` 正则 `(?:^|\s)\/([^\s]*)$` 会把「参考 /workspace/a.md」这类空格后的 POSIX 绝对路径当命令查询并弹「没有匹配的命令」；`@` 只列当前目录顶层文件，不递归、不含目录；组合输入（IME）期间的 `/`、`@` 触发无守卫，只能靠人工验收单。功能可用，但与「支持方向键、Enter、Esc、中文输入法、空结果及同名路径辨认」的既定要求有明显距离，建议在 060 前明确降级说明或补齐。

**P2-5 路径比较有三套实现。**
`shared/workspaceIdentity.normalizeWorkspacePath`（去尾斜杠）、`useDocumentTabsController.ts:152` 的旧 `normalized`（仅替换分隔符+小写）、`LessonWorkspaceHost.tsx:66-67` 与 `LessonConversationChat.tsx:31-32` 的内联 `.replace(/\\/g,'/').toLowerCase()`；后两处还重复计算了同一个 `bound`。当前输入都无尾斜杠所以结果一致，但这是下一次「同名不同目录」类缺陷的温床。建议统一到 `normalizeWorkspacePath`，`bound` 只算一次由 host 传入。

### P3（可延后）

- `service.ts:65` `if (requested.kind === 'directory' && conversationOwner.kind === 'lesson') throw …` 是死分支：`requireOwned` 内 `conversationOwnerMatchesAgentWorkspace` 已对该组合返回 false 并抛错。
- `LessonConversationChat.tsx:189` 用 `api?.localAgent` 而同文件其它处直接 `api.localAgent`，风格不一致。
- 新索引文件每次 `write()` 都整读整写 `conversation-index-v1.json`；当前规模无问题，记录数上千后可考虑按 owner 分片。缺索引自动重建与 `clearAllRecords` 同删索引都做对了。
- `harness.ts` 协议错误消息改为带原因：已核对 src/tests 无对 `'protocol'` 字面量的全等比较，`toThrow('protocol')` 子串匹配不受影响，改动安全且有价值。
- `security.ts` 仅放开 `clipboard-sanitized-write`，与「不默默提权」边界一致。
- `courseware-builder-v2-host.ts` 懒启动：`started ??= startWorker()` 同步赋值，并发首调安全；失败路径自清理正确。
- `R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md` 第 3 行状态段已累积成约 2000 字的单段落，五轮状态串在一句里。建议只保留当前一句 + 指向最新记录的链接，历史状态留在 reviews。
- `lessonWorkspaceEntry.ts` 注释大量引用源码行号（`LessonWorkspaceView.tsx:1316` 等），下次改动即失效；建议改为引用符号名。

### 治理与流程

**治理-1 CopyMove 退役依据需 Owner 亲自确认。**
`tests/unit/lessonWorkspaceCopyOpen.test.tsx`（82 行）与 `tests/e2e/r19LessonCopyMove.spec.ts`（109 行）已 `git rm`，依据是 `R19_SIGNOFF_PUSH_BRIEF.md` §4.1「Owner 已拍板」。该任务书由另一 AI 会话于 09-19 01:55 写入。删除本身可从 HEAD 恢复，但请 Owner 确认这确是你的决定，且底层 `asCopy` 能力（三条单测保留）是否仍是 1.9 承诺。

**治理-2 Codex 通道真实回合跑在非授权模型上。**
AGENTS.md「Codex / OpenCode 通道只使用 Luna」。R4b/R4c/R4d/R4e 四轮 `S3 真实聊天：codex` 用例不自配模型，实际走机器 `~/.codex/config.toml` 的 `gpt-6-astra · xhigh`（rollout 原文已被记录引用）。开发方在附二/附四如实更正并标注「非 Luna 通道证据」，但仍消耗了未授权模型的额度，且 R3 期还有一次误派发。建议：该 spec 加 `configureLuna()` 或在 spec 内显式配置；付费用例统一加显式模型断言，杜绝「机器默认」路由。

**治理-3 `check:legacy-ready` / `check:legacy-zero` 仍红。**
我复跑输出 `legacy:stale-inventory: product digest 已偏离台账`。记录标注为 Owner 持 legacy-inventory 写锁待 reconciliation，与我观察一致。

**治理-4 大量未提交变更。**
165 条变更自 09-18 00:02 起未提交，三份记录反复强调「不 reset、不 clean」正说明风险已被感知。建议 Owner 审阅本报告后按主题拆成 4–6 个提交（身份/冻结目标合同、聊天 UI、工作台布局、测试入口重构、文档、生成物），至少先做一次 WIP 提交保住工作树。

## 4. 我独立复核的结果

| 检查 | 结果 | 说明 |
|---|---|---|
| `npm run typecheck` | 三 project EXIT 0 | 本机 09-19 重跑 |
| `vitest run` 20 个受影响文件 | 20 passed；329 passed / 2 skipped / 0 failed | 含 6 个新文件与 `localAgentHarnessV2`、`courseChatPanel`、`LessonWorkspaceShell` 等 |
| `check:ai-capabilities` | 绿（索引 16275/16384 字节） | |
| `check:task-board` | 绿（Tasks: 0） | |
| `check:contracts` | 绿（4 产物） | |
| `check:development-roadmap` | 绿（176 节点 / 22 规格） | manifest 9 个标题改动无副作用 |
| `check:legacy-inventory` | 绿（tokenHits 0） | |
| `check:legacy-ready` / `zero` | 红（stale-inventory） | 与记录 R-7 一致 |
| `check:preservation` | 未复跑 | 引用 `r3-gates.log` EXIT:0、27 automated pass |
| 全量 `npm test` 440/440 | 未复跑，日志核对为真 | `f-npm-test.log` 尾部原文一致；04:44 后 `src/`、`tests/unit/` 无改动 |
| V 组 8 例 e2e | 未复跑，日志核对为真 | `f-v-specs.log` 8 passed (3.3m) |
| R3 扫描 56/10/27/1 | 未复跑，日志核对为真 | `r3-sweep.log` 尾部原文一致 |
| 付费证据目录 | 存在且结构与记录一致 | `output/playwright/r18-cli-*`、`output/r19-current-teacher-luna/…` |
| 反作弊 grep | tests/ 内 `专业/简洁` locator 0；`[probe]` 残留 0；新增 spec 无 `test.skip/only`；无 mock clipboard | scripts/ 两处「专业」见 P1-2 |

## 5. 建议的下一步（按顺序）

1. Owner 确认治理-1（CopyMove）与治理-2（Codex 路由）两项决定；先做一次 WIP 提交保住工作树。
2. 修 P1-1：共享「展开其它目标」步骤 + 一条零模型 e2e；顺带处理 P2-3 让按钮真正可点。
3. 修 P1-2 两处 scripts locator；跑一次 `verify:release` 的静态部分确认不再命中。
4. P1-3 三簇归因：每簇一条 HEAD 对照，产出「spec 漂移 vs 产品回归」清单后再修。
5. P2-1 内联 ref 稳定化 + `preserveAll` 快照，一并回归 `r19DraftSurvival`。
6. P2-2 恢复 17 张历史 PNG 并改 spec 输出目录。
7. 环境项：Claude CLI 登录并确认 DeepSeek 路由；补 teacher-action 驱动后重跑整课链；IME 人工验收单执行回填。
8. 以上完成后再评估 DoD 第 6/7/9 项，决定是否签 accepted 与 `v1.9.0-rc.N`。
