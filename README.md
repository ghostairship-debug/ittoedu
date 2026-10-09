# 果铃工作台

面向教师的可编辑课件与通用内容工作台。模型负责内容，软件负责身份、资源、装配、事务、保存与交付；人工编辑与 AI 使用同一正式工程。

当前开发目录为 `D:/果铃工作台` 的 `main`。版本及范围见[当前状态](docs/development-plan/CURRENT_STATUS.md)：正式作者工程为 **Project V10**，运行发布投影为 **Published V3**，组件接口为 **Component API 5**。文档中旧 V9、Runtime API 2/3、Component API 4 记录属于历史或遗留维护材料，不能作为当前生产入口。

当前本地发行包、已验证范围和未完成事项见当前状态与唯一结果；本地打包不等于远端发布或完整产品签收。

## 启动

Windows 10/11 x64、Node.js；首次依赖准备用 `npm ci`。双击 `启动果铃工作台.cmd`，或运行 `npm start`；已有制品可用 `npm run start:quick`。开发使用 `npm run dev`。

外部 MCP 可直接运行后台宿主，无需打开工作台主界面：

```powershell
npm run --silent mcp:server -- --workspace "<绝对目录>" --ready-json
```

连接使用返回的实际 endpoint、workspace 与认证信息，协议为 HTTP MCP。[后台连接样例](scripts/connect-mcp.ts)支持正式打开、应用和用户要求保存时的 `project.save`；客户端断开不关闭共享宿主。

原生工程使用 `.glx`（Project V10），已有当前格式的 `.h5lesson` 可以打开；新建和另存为使用 `.glx`，普通保存保留现有文件路径。

## 文档入口

| 目的 | 入口 |
|---|---|
| 操作和创作 | [用户指南](docs/USER_GUIDE.md) |
| 开发定位、当前剩余与验证 | [开发入口](docs/development-plan/README.md)、[当前状态](docs/development-plan/CURRENT_STATUS.md) |
| 架构与执行规则 | [架构合同](docs/development-plan/ARCHITECTURE_CONTRACT.md)、[工作协议](docs/development-plan/WORKING_PROTOCOL.md)、[AGENTS.md](AGENTS.md) |
| 工程、组件和输出格式 | [文档导航](docs/README.md)、[组件指南](docs/COMPONENT_AUTHORING.md)、[输出指南](docs/PUBLISHED_LESSON_V1.md) |
| 阶段变化 | [路线图](ROADMAP.md)、[变更记录](CHANGELOG.md) |
| 历史原文与证据 | [归档索引](docs/archive/README.md) |

开发验证按变更选择最小有效检查；`typecheck`、测试和发行脚本的当前限制见状态页，不以全量命令代替具体行为证据。
