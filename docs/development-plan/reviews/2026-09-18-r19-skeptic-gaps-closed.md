# 1.9 执行记录：skeptic 缺口闭合后的 050/060 工程候选

日期：2026-09-18。集成人唯一执行。状态：**可审阅 engineering candidate。未签 accepted，无 `v1.9.0-rc.N`，无安装器，无固定课例 HTML。** 本记录追加在 [先前候选记录](2026-09-18-r19-f00-f08-050-060.md) 之后，不把该记录里未跑的「从材料起整课」改写成已跑。

工作树：`main` @ `bc2072f7`，保留全部未提交文档勘误与实现。未 reset/clean。任务板 Tasks: 0，未建卡。

## 1. 源码 / 未提交范围

本轮针对 verifier 四条 skeptic 缺口：

- `src/renderer/App.tsx`：仅当既无课例会话也无目录会话时挂载 `CourseChatEntry`。
- `useLessonWorkspaceController` / `LessonWorkspaceView`：激活目录会话时清 leftover lesson；打开 MD 为 `kind:file`。
- 编辑器焦点：同一 `.lesson-workspace-chat` CSS 投影，不另开第二个 `CourseChatPanel`。
- 布局「展开内容区」走 `toggleContentClosed()`（先前 `setContentClosed(!contentOpen)` 是空操作）。
- 侧栏重开条改为 flex 列，不再 `position:absolute` 盖住聊天勾选。
- `CourseChatPanel` 先审勾选/文稿补 `aria-label`。
- 新增 `tests/e2e/r19DirectoryFirstSave.spec.ts`（V02 真实 UI 首存）。
- 新增 `tests/e2e/r19TaskDrivenTeacherChain.spec.ts`（050 任务式 + 先审，保存/重开/预览/导出）。
- 命名单测：leftover-lesson MD file ref；目录先审暂停后再 `whole-course`。

未写入：保全矩阵 PM-01 正文、安装器、发布标签、accepted。

## 2. 当前包与下一动作

当前包：050 代表教师链已用命名 e2e 跑通；060 按 `package.json` 等价拆分记录。下一动作（需发布授权才做）：`v1.9.0-rc.N`、Owner 审阅、PM-01 晋升。S4/2.0 不提前。

## 3. 通过 / 失败原文

通过（本轮命名）：

- 单元 11 文件 130 项，含 `opens Markdown as a file ref after switching from a lesson to a directory conversation`、`pauses a directory 先审 edit until plan and script are reviewed, then sends whole-course`、`rejects a Flow location id written into scene.go`。
- `r19DirectoryFirstSave`：`r19 V02 directory conversation first-save uses the Save button without a pre-bound archive` **1 passed (9.8s)**。
- `r19TaskDrivenTeacherChain`（收紧后：应用回执 + 工程/HTML 正文标记，不用聊天提示词）：
  - 任务式：**passed (1.4m)**，`project.json` native text `闭合电路探究`，导出 HTML 含该字符串。Codex `gpt-5.6-luna` medium Fast。
  - 先审：**passed (1.7m)** 独立重跑；一次合跑曾在 8.2m 出现 `CLI 未完成（读取原生事件）：protocol` / `本阶段未应用`，不记通过。
  - 工具栏工程标题仍为 `未命名课件`（生成链无 `renameProject` 目的地）。无「开始自动创作」。
- `tsc --noEmit` / `tsc -p tsconfig.electron.json --noEmit` / `tsc -p tsconfig.e2e.json --noEmit` 均为 0。

失败保留（不改写为已修旧课例）：

- 原电路 revision 27 样本：`output/r19-current-teacher-luna` 本机缺失。V14 用当前等价反例（Flow ID 写入 `scene.go` 必须失败可见）。

## 4. 文件 / 目标 / 会话身份

目录会话按规范化 `workspaceRoot`/`projectPath` + `conversationId`。打开文件不切目录会话。课件发送冻结本轮目标。050 链：空目录新建会话 → UI 首存 `.h5lesson` → 绑定后 `CourseChatPanel` 在当前页插入标题文字 → 保存 → reload → 点选已存 `.h5lesson` → 整课预览 → 离线便携单 HTML。应用成功只认 `[aria-label=实际应用结果] 已应用课件修改`，再核对 archive/HTML 正文。

## 5. 构建准备

本轮 050 前执行 `npm run build:renderer`（CourseChatPanel / CSS）。V02 复跑用同一 dist。未把 `npm run dev` 当证据。未盲跑 `npm run verify`。

## 6. 实际模型路由

050 `configureLuna()`：Codex 原生目录 `refresh: true`，要求 id 匹配 `/luna/i`，Fast 用 `priority`（若存在）。未为追绿换模型。Claude / OpenCode generate 本轮未跑。

## 7. 剩余门与未跑命令

未跑：`npm run verify`、全量 `npm run test:e2e`、从材料起的整课 AI（`r19CurrentTeacherAutomaticLuna`）、Claude DeepSeek generate、OpenCode generate、Word 新实测。CopyMove UI 仍 `test.skip`。PM-01 正文未改。跨轮固定目标仍为可选且未做产品门。

## 8. 命令未跑清单

```
npm run verify
npm run test:e2e
npx playwright test tests/e2e/r19CurrentTeacherAutomaticLuna.spec.ts
npx playwright test tests/e2e/r19TeacherRetainedClaudeDeepSeek.spec.ts
```

## 9. 补充（2026-09-18 收口轮追加；以上原文逐字未改）

第 3 节「任务式 passed 1.4m / 先审 passed 1.7m 独立重跑」的写法保持准确。另有一次**同一次 capture 的合并运行**：`r19-050.log` 末尾 `2 passed (4.3m)`（task-driven 2.2m / review-first 2.1m；marker `闭合电路探究` / `审阅闭合电路`；Codex `gpt-5.6-luna` medium Fast）。两者不矛盾：独立重跑记录各自单跑耗时，合并运行记录两条在同一 worker 内连跑；本轮按 handoff §1 未重跑这两条合并用例。

另两条更正性事实：`r19-050-claude.log` 与 `r19-050.log` 逐字节相同（diff 无输出、均 692 字节、均 Luna 路由），**不能作为 Claude/DeepSeek 通道证据**；`reviews/2026-09-17-frontend-special-evidence/` 下 A1–A6（22:14–22:15）、C1–C5（22:21）、V31-nav-hierarchy / V31-nav-relaunch / V31-project-pick-confirm（22:15）于 09-18 被对应重跑刷新（B1–B4 仍为 09-17 原图），属 09-18 新图，勿与 09-17 旧证据混用。

再一条披露缺口：本文件未被 git 跟踪（无已提交基线），§1–8「逐字未改」只能由本次追加操作自证（§9 为唯一追加段），无法被下一位 reviewer 独立复核。
