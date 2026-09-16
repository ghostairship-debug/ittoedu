# 有界共同目标诊断任务包（三通道共用，运行前冻结）

按 [产品可用性改进方案 6.4.2](../../../../docs/development-plan/R19_PRODUCT_USABILITY_IMPROVEMENT_PLAN.md) 准备：在现成课件中修改状态图形、操作后显隐、进入指定后续页面，并正式交付。输入只含普通教师要求，不提示内部工具名 / 协议 / 提交步骤；脚手架不替模型写答案。

## 文件

| 文件 | 作用 |
|---|---|
| `bounded-goal-lesson.h5lesson` | 课例副本。源：`tests/fixtures/architecture-baseline/slide-heavy.h5lesson`（ARCH-0 代表工程 · Slide-heavy，projectId `arch-0-slide-heavy`，revision 1，sha256 见 `acceptance.json`）。每次运行前从本文件再复制一份运行副本，不直接改本文件 |
| `teacher-request.txt` | 逐字发送的教师请求，无任何内部提示 |
| `acceptance.json` | 冻结验收：允许变化、保持内容、预期可见结果（R1–R5）与实际点击目的地 |

## 课例事实（验收依据，全部来自副本实际内容）

- 位置顺序：`slide-location-intro`（导入·基础态，起始）→ `slide-location-evidence`（导入·证据态）→ `slide-location-practice`（练习页）→ `slide-location-summary`（总结页）。
- `slide-scene-intro` 呈现状态：`slide-state-base`（隐藏 `slide-intro-hero` 图片与 `slide-intro-component` 面板）→ `slide-state-evidence`（显示两者，背景 `#eff6ff`）。
- 播放序列：前两个位置同属一个播放场景（步骤 base → evidence），练习页是下一个播放场景。因此从基础态出发，`step.next` 只推进到 evidence 步骤（仍在导入页），`scene.next` / 精确目标才到练习页——这正是 R4 的判别点。
- 关键元素：`slide-intro-title`（标题文字）、`slide-intro-callout`（蓝色圆角矩形，`#dbeafe` / `#2563eb`，hitPolicy auto，可绑定点击）、`slide-intro-hero`（图片）、`slide-intro-component`（证据面板）。
- 既有规则：`scene.enter` → 图片淡入 + 旁白播放（保持内容，不得破坏）。

## 三个已知失败模式的对照

| 方案 6.1 失败证据 | 本任务包对应验收 |
|---|---|
| 合法状态切换在 Player 未执行 | R3：点击标题后真实可见切换，结构合法不算通过 |
| 要求进入下一页却选择 `step.next` | R4：从基础态点标注必须到练习页；`step.next` 只会停在导入页 |
| 不同状态的图形相同 | R2：两态标注填充/边框必须可区分，记录实际色值 |
| 只执行 `--check` 零提交 | R5：只认宿主 `committed` 回执 + 保存重开后行为保持 |

## 运行约束（冻结）

- 三通道各用独立副本：Codex / OpenCode 用实际目录与路由确认的 Luna（支持则 Fast），Claude 用已确认的 DeepSeek；分别记录配置和实际路径，互不相代。
- 运行前才复制运行副本并打开；`teacher-request.txt` 逐字发送，不补内部协议、ID 列表或 schema 说明。
- 本文件与 `acceptance.json` 在任何通道首次运行前冻结；运行后发现的缺口只记入结果报告，不回改验收。
- 预算沿用既有规则（默认 20 分钟，任务有界）；同一失败复现即停止该假设下的付费重试。
- 验收只计：实际执行 / 失败 / 未执行 / 原任务自动修复后成功（同一有界任务内续接并获 `committed` 且实际结果正确）/ 人工干预；文字自述不计修复。
