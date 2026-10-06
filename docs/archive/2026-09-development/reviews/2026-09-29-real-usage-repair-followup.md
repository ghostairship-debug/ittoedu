> 历史原文：仅对应当时范围；不表示当前任务、授权或实现状态。当前读[CURRENT_STATUS](../../../development-plan/CURRENT_STATUS.md)。

# 2026-09-29 真实使用缺陷修复收口

基线：`ef9a39a57b75caaeacc0953d46851b057b84f455`。修复保留在工作树，未提交 Git。
范围：延续用户授权的缺陷修复；未修改桌面课例原件、实际 RunStore 或恢复日志，未发起真实模型调用。

## 已落地

1. API3 Runtime 显式传递实际 Slide canvas，作者态和运行现场轻编辑采用一致坐标；保留 Flow local 输出语义。
   文件：`publishedSurfaceRuntimeAuthoringTargets.ts`、`publishedSurfaceRuntimeMount.ts`、`SlidePublishedAdapter.ts`。
2. 元素/文字 AI 卡改为标题、可滚动内容、输入与操作区；不再把整张卡滚走。弹层优先选择空间更大的一侧，textarea 有限增高。
   文件：`ElementAiCard.tsx`、`elementCards.css`、`SelectionQuickBar.tsx`。
3. GPT OAuth 原始 output_index 与紧凑 tool index 在 Provider 内正确映射，保留最终身份/参数一致性校验。
   文件：`ChatGPTResponsesProvider.ts`。
4. 资源闭合检查允许来源可证明的 DOM 集合索引及已知 DOM 成员访问；未知 URL、动态方法调用、集合替换/逃逸等继续拒绝。
   文件：`javascriptClosureProof.ts`。
5. 无当前 HTML 预览时由 TaskHtmlPreview 读取正式当前源文并建立任务独立预览，不切换用户标签或保存用户源文件；复用已有预览、版本刷新、停止与清理均走原正式边界。
   文件：`TaskHtmlPreview.ts`、`HtmlActionService.ts`、`HtmlPreviewService.ts`、`ipc.ts`。
6. 导入取消与失败分开；新建后修改但未确认保存的文档不能直接结算为 completed，停止摘要区分创建骨架、已应用和已保存。
   文件：`HtmlImportTools.ts`、`HtmlImportToolService.ts`、`executionOutcome.ts`、`ExecutionEngine.ts`。
7. Builder Skill 明确首次成功导入立即保存课件、后续精修再次保存，不通过删掉互动脚本换取准入。能力制品已同步。

## 本次续接补修

新增 signal-only cancellation 回归，先证实停止信号已到达而取消记录尚未写入时被误记 failed；修复后返回 cancelled，并保留已提交/未知结果优先核实的顺序。
该用例验证零子调用、零新增文档提交和可重复读取一致取消回执。

## 已执行验证

- 聚焦 Vitest：8 文件、129/129 用例通过，无跳过；用例全部使用本地夹具/传输替身，不访问模型供应商。
  文件：`g20ChatGPTProviders`、`g20ExecutionEngine`、`g20ExecutionOutcomeR7`、`g20M24HtmlImport`、`g20HtmlImportClosure`、`g20M15SurfaceRuntimeLightEdit`、`g20HtmlActions`、`g20M15ElementCards`。
- `node node_modules/@playwright/test/cli.js test tests/e2e/g20RealUsageRepairs.spec.ts`：1/1 通过（6.1 秒）。真实隔离 Electron，使用独立 profile 和测试文档。
  覆盖：1024×768 画布、满页与局部 Runtime、0.6/1 倍显示、文字/图片实际点击、两类 AI 卡小窗口可达性、独立 HTML 预览点击/截图/修订/取消/清理。
  测得目标框与内容框最大误差约 0.000012 CSS px；阈值为 1 CSS px。此值仅属于本次夹具，不是用户原课件现场测量。
  证据：`output/g20/repairs-20260929/run-EczsU0/evidence.json`；同目录保存界面截图。
- `npm run typecheck`：renderer/player、Electron、E2E 三套类型检查通过。
- `npm run build:player`、`npm run build:renderer`、`npm run build:electron`：全部成功；未打安装包，未重启用户正在运行的应用。
- 能力清单检查发现来源证据因本次源码修改过期，随后执行 `npm run generate:ai-capabilities` 成功；运行时的两份 generated JSON 与本次构建使用版本一致。
- `git diff --check` 通过。原工作树修改均保留。

## 验证边界与下一步

没有重跑 40 分钟真实模型任务，因此不宣称任务耗时或 Luna 端到端创作成功率已验证。
保存重开测试使用正式文档 writer/archive/driver，但该集成夹具的构建准入为替身；真实 Electron 测试独立覆盖 Runtime 和 HTML 交互，不等于完整艺术/教学验收。
任意跨页共享脚本仍不能保证机械无损拆成独立页面；本次修复没有替用户改变页数、自动删除脚本或自动重写教学互动。
历史电路图课件和恢复日志未被修改，本次没有把旧中间稿补做为成品。
保存当前未保存的工作后，完整退出并重开果铃加载新主进程和前端，再复核用户原概率课件的点击位置。
