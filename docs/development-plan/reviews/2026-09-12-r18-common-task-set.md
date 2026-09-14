# 1.8 B0 固定代表任务输入

2026-09-12 冻结 `r18-common-tasks-v1`：60 个独立任务、20 个必过核心。正式定义位于 [definitions.ts](../../../tests/fixtures/r18CommonTasks/definitions.ts)，[输入生成与使用说明](../../../tests/fixtures/r18CommonTasks/README.md) 说明已有 ARCH-0 来源、小型补充 fixture、精确 target 与已知准备缺口。该工作只完成 [常规任务方案](../AI_COMMON_TASK_EXECUTION_PLAN.md) 的 B0 定义冻结，不执行 B2–B4，不提供覆盖率成绩。

I01 逐字固定“帮我将这个形状替换为卡通小狗图片”，实际来源 root 为 `C:/Users/74755/Documents/HTML课件编辑器`，文件为 `tests/fixtures/architecture-baseline/slide-heavy.h5lesson`。已读出 `arch-0-slide-heavy`、revision 1、`slide-intro-callout`、`slide-location-intro` / `slide-state-base`，并与原失败会话的选区相符。Codex `gpt-5.6-luna/medium` 固定；原应用记录未给出实际 service tier，记 unknown，禁止填 standard。新会话、固定前置轮后的连续会话，以及其他适用载体各自保留证据。

核心变体包含 Slide 基础态/证据态、Flow 正文/浮层、Spatial 世界及相关 shared/global；Table/Chart 仅在正式支持的 Slide scene/surface、Flow 正文与 Spatial world，input 仅在 Slide scene。全部变体通过才计该任务 1 项，49/60 且核心全过仍是后续代表集门。C01–C05 缺正式包/实例，Q02 缺字节可能被加载器拒绝，均明确留在分母。D 人工保全另报，不能补 AI 分。

验证：`npx vitest run tests/unit/r18CommonTaskDefinitions.test.ts` 3 项通过；`npx tsc --noEmit --pretty false` 通过。真实浏览器解码两份约 4 KB 视频为 320×180；图片可解码并含透明通道。**这些是定义、输入和类型证据，AI 成功任务数尚未执行/计分，不能记为 60 项通过或 1.8/S3 accepted。**
