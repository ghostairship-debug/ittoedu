> 历史入口原文：2026-10-06 整理前版本，不表示当前协议或验收。

# 果铃工作台

面向教师的互动课件创作与 AI 工作台：把"取得资料 → 理解 → 计算/生成 → 观察修改 → 保存导出"的完整闭环装进一个 Electron 桌面应用,教育课件是首发场景,工作台、文件、会话、工具保持通用。

## 2.0 真实状态(2026-10-02)

- 全部 44 个 S/M 任务 `verified`;241 项验收用例 232 项 `passed`,9 项既定为 Owner 延期(不计入 2.0 完成门)。
- M30-T08 Owner 终局签收已落盘,扩展 2.0 范围(M25–M30 / B19–B24 / 30 项新增验收)整体闭合。
- 权威状态以 `task_registry.json` + `acceptance_cases.json` 同源 JSON 为准;自动化最多证 `engineering candidate`,`accepted` 由 Owner 实际验收。

## 技术栈

- Electron(主进程 / preload / renderer 编辑器 / Published V2 Player 宿主)
- 持久化:Course Project **V9**(`schemaVersion: 9`,V8 `.h5lesson` 拒绝导入)
- 发布物:**Published Course V2**
- 扩展协议:**Runtime API 2/3**(自由运行时)、**Component API 4**(互动组件)
- 统一自建执行器覆盖编辑、图像与受控构建/导入;API/Token Plan 为主、OAuth 可选;外部 Codex / Claude / OpenCode 经同一 MCP Server 使用工具
- 主进程每文档 DocumentSession 为唯一正式 writer/History,renderer 是投影

## 专用文档索引

| 主题 | 入口 |
|---|---|
| 永久开发原则(可用性、简单实现、最小充分验证;模型/软件分工;一致性保护边界) | [AGENTS.md](../../../AGENTS.md) "永久原则" 节 |
| 架构合同(架构不变量与禁止动作) | [docs/development-plan/ARCHITECTURE_CONTRACT.md](../../development-plan/ARCHITECTURE_CONTRACT.md) |
| 工作协议(开发闭环、写锁、停止条件、完成定义) | [docs/development-plan/WORKING_PROTOCOL.md](../../development-plan/WORKING_PROTOCOL.md) |
| 2.0 执行包(任务/批次/验收主索引) | [GPTpro方案/guoling_2_0_execution_plan/00_README.md](../../../GPTpro方案/guoling_2_0_execution_plan/00_README.md) |
| 当前进度与路线图 | [ROADMAP.md](../../../ROADMAP.md) |
| 里程碑变更日志 | [CHANGELOG.md](../../../CHANGELOG.md) |

## 历史归档

历史规划快照、被取代方案与各轮评估只保留在 [docs/archive/](..),不再视为当前实施清单;当前决策以 [AGENTS.md](../../../AGENTS.md)、归档 [果铃2.0收敛方案.md](../2026-09-convergence/果铃2.0收敛方案.md) 与同源 JSON 登记为准。

## 快速开始

Windows 10/11 x64,Node.js LTS。双击根目录 `启动课件编辑器.cmd`,或:

```powershell
npm ci
npm start
```

开发用 `npm run dev`;验证用 `npm run typecheck`、`npm test`、`npm run test:e2e`、`npm run verify`。
