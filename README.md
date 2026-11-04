# 果铃工作台

果铃工作台是通用办公 Agent。GLX 工程创作是首要卖点和第一核心能力，Office 居第二，目标是高保真播放与预览、AI 全能力改写，通过轻量编辑与专业工具协作实现，无需完整复制重型 Office 引擎。任务管理、视频编辑、图片编辑和邮件管理列为后续能力。

当前开发目录为 `D:/果铃工作台` 的 `main`。版本及范围见[当前状态](docs/development-plan/CURRENT_STATUS.md)：正式作者工程为 **Project 11**，运行发布投影为 **Published 4**，组件接口为 **Component API 5**。现行 Project 10 在文件及恢复读取边界一次转换，后续写出 11；更老格式和旧 API 记录按历史或遗留范围读取。通用程序和容器的实际入口见[能力交接](docs/development-plan/20261020-glx-work-containers/CAPABILITY_HANDOFF.md)。

当前本地发行包、已验证范围和未完成事项见当前状态与唯一结果；本地打包不等于远端发布或完整产品签收。

## 启动

Windows 10/11 x64、Node.js；首次依赖准备用 `npm ci`。双击 `启动果铃工作台.cmd`，或运行 `npm start`；已有制品可用 `npm run start:quick`。开发使用 `npm run dev`。

外部 MCP 可直接运行后台宿主，无需打开工作台主界面：

```powershell
npm run --silent mcp:server -- --workspace "<绝对目录>" --ready-json
```

连接使用返回的实际 endpoint、workspace 与认证信息，协议为 HTTP MCP。[后台连接样例](scripts/connect-mcp.ts)支持正式打开、应用和用户要求保存时的 `project.save`；客户端断开不关闭共享宿主。

原生工程使用 `.glx`（Project 11），已有 Project 10 的 `.glx` 或 `.h5lesson` 可以读取；新建和另存为使用 `.glx`，普通保存保留现有文件路径。需继续使用旧软件的作品应保留原 10 副本。

## 文档入口

| 目的 | 入口 |
|---|---|
| 操作和创作 | [用户指南](docs/USER_GUIDE.md) |
| 开发方法与立即开工 | [核心方法论](DEVELOPMENT.md)、[当前状态](docs/development-plan/CURRENT_STATUS.md)、[下一阶段执行方案](docs/development-plan/NEXT_EXECUTION.md) |
| 按需技术与操作参考 | [开发导航](docs/development-plan/README.md)、[架构合同](docs/development-plan/ARCHITECTURE_CONTRACT.md)、[操作参考](docs/development-plan/WORKING_PROTOCOL.md) |
| 工程、组件和输出格式 | [文档导航](docs/README.md)、[组件指南](docs/COMPONENT_AUTHORING.md)、[输出指南](docs/PUBLISHED_LESSON_V1.md) |
| 阶段变化 | [当前进度与剩余](docs/development-plan/CURRENT_STATUS.md)、[变更记录](CHANGELOG.md) |
| 历史原文与证据 | [归档索引](docs/archive/README.md) |

开发验证按变更选择最小有效检查；`typecheck`、测试和发行脚本的当前限制见状态页，不以全量命令代替具体行为证据。
